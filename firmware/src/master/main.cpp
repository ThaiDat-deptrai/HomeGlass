// =============================================================
// ESP TRUNG TÂM (ESP32-S3) - cầu nối App <-> HiveMQ <-> các ESP phòng
// -------------------------------------------------------------
// Việc của ESP trung tâm:
//   1. Nối WiFi (có WiFi dự phòng) + HiveMQ qua TLS (kiểm tra chứng chỉ máy chủ).
//   2. Nhận bảng kênh từ app (hg/node/<số>/config), lưu flash, gửi xuống ESP phòng.
//   3. Nhận lệnh bật/tắt (hg/dev/<key>/set) -> gửi ESP phòng qua ESP-NOW,
//      tự GỬI LẠI nếu rớt gói, ESP phòng báo xong mới báo app (đúng sự thật).
//   4. Theo dõi sức khỏe từng ESP: online/offline, nhiệt độ, lý do khởi động lại.
//   5. Tự chạy lịch hẹn giờ (kể cả khi tắt app).
// Không bao giờ dùng delay() dài: mất mạng vẫn chạy lịch, vẫn điều khiển ESP phòng.
// Giao thức MQTT: docs/giao-thuc.md. Gói ESP-NOW: lib/hgcore/hg_msgs.h
// =============================================================
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_arduino_version.h>
#include <esp_task_wdt.h>

#include <algorithm>
#include <map>
#include <vector>

#include "ca_cert.h"
#include "hg_config.h"
#include "hg_link.h"
#include "hg_outputs.h"
#include "hg_sys.h"
#include "schedules.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Thiếu firmware/include/secrets.h - chép secrets.example.h thành secrets.h rồi điền WiFi, MQTT"
#endif

using namespace hg;

static const uint32_t WDT_TIMEOUT_S = 30;
static const uint32_t CMD_RETRY_MS = 150;     // gửi lại lệnh nếu chưa có ACK: 150, 300, 450... ms
static const uint8_t CMD_MAX_TRIES = 5;
static const uint32_t STATE_WAIT_MS = 8000;   // đã nhận lệnh, chờ servo gạt xong (có thể đang xếp hàng)
static const uint32_t CONFIG_RETRY_MS = 3000;
static const uint32_t TEMP_EVERY_MS = 10000;

static WiFiClientSecure tls;
static PubSubClient mqtt(tls);
static Preferences prefs;
static Outputs outputs;   // thiết bị cắm thẳng vào ESP trung tâm (nếu có)
static Led led;
static Button button;
static Schedules schedules;

// ---------- Thông tin từng ESP ----------
struct NodeInfo {
    bool hasMac = false;
    uint8_t mac[6] = {0};
    uint32_t lastSeen = 0;
    bool online = false;
    bool hasTable = false;
    Table table = {};
    std::vector<String> keys;   // keys[i] = key của thiết bị thứ i trong bảng
    uint32_t cfgSentAt = 0;
    bool hasHb = false;
    MsgHeartbeat hb = {};
    uint32_t healthAt = 0;
    uint32_t hotWarnAt = 0;
    bool bootReported = true;
};
static std::map<uint8_t, NodeInfo> nodes;

struct Route { uint8_t node; uint8_t idx; };
static std::map<String, Route> routes;       // key thiết bị -> ESP nào, dòng nào
static std::map<String, bool> published;     // trạng thái đã báo app (tránh gửi lặp)
static std::map<String, String> attrs;       // cài đặt thiết bị (cầu thang) đang có trên máy chủ

struct Pending {
    uint32_t id;
    String key;
    uint8_t node, idx;
    bool on;
    uint8_t tries;
    uint32_t nextAt;
    bool acked;
    uint32_t ackAt;
};
static std::vector<Pending> pending;
static uint32_t nextCmdId = 1;

// ---------- Trạng thái kết nối ----------
static uint32_t wifiLastOk = 0, wifiConnectedAt = 0;
static bool wifiWasConnected = false, usingBackup = false;
static uint32_t mqttRetryAt = 0, mqttBackoff = 1000;
static bool mqttAuthFail = false, linkOk = false, bootLogPending = true;
static uint32_t beaconAt = 0, tempAt = 0, healthAt = 0, schedAt = 0, nodesAt = 0, statesSaveAt = 0;
static uint16_t savedLocalStates = 0;

static const char *const DEV = "hg/dev/";

// =============================================================
// Tiện ích
// =============================================================
static String toStr(const uint8_t *p, unsigned int len) {
    String s;
    s.reserve(len + 1);
    for (unsigned int i = 0; i < len; i++) s += (char)p[i];
    return s;
}

static String nodeTopic(uint8_t id, const char *what) { return "hg/node/" + String(id) + "/" + what; }

static bool publishRaw(const String &topic, const String &payload, bool retained) {
    if (!mqtt.connected()) return false;
    return mqtt.publish(topic.c_str(), (const uint8_t *)payload.c_str(), payload.length(), retained);
}

static void publishJson(const String &topic, JsonDocument &doc, bool retained) {
    doc["v"] = 1;
    String s;
    serializeJson(doc, s);
    publishRaw(topic, s, retained);
}

static void publishLog(uint8_t node, const String &msg) {
    Serial.printf("[log] ESP %u: %s\n", node, msg.c_str());
    JsonDocument d;
    d["msg"] = msg;
    publishJson(nodeTopic(node, "log"), d, false);
}

static void publishState(const String &key, bool on) {
    published[key] = on;
    JsonDocument d;
    d["on"] = on;
    publishJson(String(DEV) + key + "/state", d, true);
}

static void publishStatus(uint8_t node, bool online) {
    JsonDocument d;
    d["online"] = online;
    publishJson(nodeTopic(node, "status"), d, true);
}

static void publishTemp(uint8_t node, float t) {
    JsonDocument d;
    d["t"] = roundf(t * 10) / 10;
    if (net.now()) d["ts"] = net.now();
    publishJson(nodeTopic(node, "temp"), d, false);
}

static bool isBadReset(uint8_t code) {
    String r = resetText(code);
    return r == "PANIC" || r == "WATCHDOG" || r == "BROWNOUT";
}

static String resetAdvice(uint8_t code) {
    String r = resetText(code);
    if (r == "BROWNOUT") return " (SỤT ÁP: kiểm tra nguồn, servo có dùng nguồn 5V riêng không?)";
    if (r == "WATCHDOG") return " (bị treo, chó canh đã tự khởi động lại)";
    if (r == "PANIC") return " (lỗi phần mềm, đã tự khởi động lại)";
    return "";
}

// =============================================================
// Lưu / đọc flash
// =============================================================
static void saveIds() {
    std::vector<uint8_t> ids;
    for (auto &kv : nodes) if (kv.second.hasTable) ids.push_back(kv.first);
    prefs.putBytes("ids", ids.data(), ids.size());
}

static void saveConfigJson(uint8_t id, const String &json) {
    String k = "c" + String(id);
    size_t len = prefs.getBytesLength(k.c_str());
    if (len == json.length()) {
        std::vector<uint8_t> old(len);
        prefs.getBytes(k.c_str(), old.data(), len);
        if (!memcmp(old.data(), json.c_str(), len)) return;  // không đổi: khỏi ghi (đỡ mòn flash)
    }
    prefs.putBytes(k.c_str(), json.c_str(), json.length());
}

static String loadBlob(const char *key) {
    size_t len = prefs.getBytesLength(key);
    if (!len) return "";
    std::vector<uint8_t> buf(len);
    prefs.getBytes(key, buf.data(), len);
    return toStr(buf.data(), len);
}

// =============================================================
// Bảng kênh
// =============================================================
static bool parseNodeConfig(const String &json, Table &t, std::vector<String> &keys) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) return false;
    JsonArrayConst list = doc["devices"];
    if (list.isNull()) return false;
    t = {};
    keys.clear();
    for (JsonObjectConst d : list) {
        if (t.n >= HG_MAX_DEVICES) break;
        const char *a = d["a"] | "";
        Entry e = {};
        if (!strcmp(a, "servo")) e.act = ACT_SERVO;
        else if (!strcmp(a, "relay")) e.act = ACT_RELAY;
        else if (!strcmp(a, "stairs")) e.act = ACT_STAIRS;
        else continue;
        e.ch = d["ch"] | 0;
        if (e.act != ACT_STAIRS && (e.ch < 1 || e.ch > 16)) continue;
        e.on = d["on"] | 45;
        e.off = d["off"] | 135;
        e.rest = d["rest"] | 90;
        if ((d["lo"] | 0) != 0) e.flags |= FLAG_RELAY_LOW;
        const char *k = d["k"] | "";
        if (!*k) continue;
        t.e[t.n++] = e;
        keys.push_back(String(k));
    }
    t.rev = tableCrc(t);
    return true;
}

static void rebuildRoutes() {
    routes.clear();
    for (auto &kv : nodes) {
        if (!kv.second.hasTable) continue;
        for (size_t i = 0; i < kv.second.keys.size(); i++) routes[kv.second.keys[i]] = {kv.first, (uint8_t)i};
    }
}

static void sendConfig(uint8_t id) {
    NodeInfo &n = nodes[id];
    if (!n.hasMac || !n.hasTable || !linkOk) return;
    size_t len = offsetof(Table, e) + n.table.n * sizeof(Entry);
    net.send(n.mac, MSG_CONFIG, id, &n.table, len);
    n.cfgSentAt = millis();
}

/** Trạng thái đã biết (theo key) -> dạng bit cho bảng mới. */
static uint16_t statesFromPublished(const NodeInfo &n) {
    uint16_t s = 0;
    for (size_t i = 0; i < n.keys.size(); i++) {
        auto it = published.find(n.keys[i]);
        if (it != published.end() && it->second) s |= (1u << i);
    }
    return s;
}

static void applyLocalTable() {
    NodeInfo &n = nodes[HG_MASTER_ID];
    if (!n.hasTable) return;
    uint16_t s = savedLocalStates ? savedLocalStates : statesFromPublished(n);
    outputs.apply(n.table, s);
}

static void handleNodeConfig(uint8_t id, const uint8_t *payload, unsigned int len) {
    NodeInfo &n = nodes[id];
    if (len == 0) {
        // ESP đã bị xóa khỏi nhà
        n.hasTable = false;
        n.keys.clear();
        n.table = {};
        prefs.remove(("c" + String(id)).c_str());
        saveIds();
        rebuildRoutes();
        return;
    }
    String json = toStr(payload, len);
    Table t;
    std::vector<String> keys;
    if (!parseNodeConfig(json, t, keys)) {
        publishLog(HG_MASTER_ID, "Bảng kênh của ESP " + String(id) + " bị hỏng, giữ bảng cũ");
        return;
    }
    bool changed = !n.hasTable || n.table.rev != t.rev || n.keys != keys;
    n.table = t;
    n.keys = keys;
    n.hasTable = true;
    rebuildRoutes();
    saveConfigJson(id, json);
    saveIds();
    if (!changed) return;
    Serial.printf("[cfg] ESP %u: %u thiết bị\n", id, t.n);
    if (id == HG_MASTER_ID) applyLocalTable();
    else sendConfig(id);
}

static void loadAll() {
    String ids = loadBlob("ids");
    for (unsigned int i = 0; i < ids.length(); i++) {
        uint8_t id = (uint8_t)ids[i];
        String json = loadBlob(("c" + String(id)).c_str());
        NodeInfo &n = nodes[id];
        if (json.length() && parseNodeConfig(json, n.table, n.keys)) n.hasTable = true;
        String mk = "m" + String(id);
        if (prefs.getBytesLength(mk.c_str()) == 6) {
            prefs.getBytes(mk.c_str(), n.mac, 6);
            n.hasMac = true;
        }
    }
    rebuildRoutes();
    savedLocalStates = prefs.getUShort("s0", 0);
    applyLocalTable();
    String sch = loadBlob("sch");
    if (sch.length()) schedules.load(sch.c_str(), sch.length());
    Serial.printf("[boot] đã đọc %u ESP, %u lịch hẹn từ flash\n", (unsigned)nodes.size(), (unsigned)schedules.size());
}

// =============================================================
// Lệnh bật / tắt
// =============================================================
static void command(const String &key, bool on) {
    auto it = routes.find(key);
    if (it == routes.end()) {
        publishLog(HG_MASTER_ID, "Không có thiết bị \"" + key + "\" trong bảng kênh (chưa gán ESP / kênh?)");
        return;
    }
    Route r = it->second;
    if (r.node == HG_MASTER_ID) {
        uint8_t res = outputs.set(r.idx, on, 0);
        if (res != ACK_OK) publishLog(HG_MASTER_ID, key + ": kênh này không dùng được (thiếu PCA9685?)");
        return;
    }
    // Lệnh mới cho cùng thiết bị thay lệnh cũ đang chờ
    pending.erase(std::remove_if(pending.begin(), pending.end(), [&](const Pending &p) { return p.key == key; }), pending.end());
    pending.push_back({nextCmdId++, key, r.node, r.idx, on, 0, millis(), false, 0});
}

static void pendingLoop() {
    uint32_t now = millis();
    for (auto it = pending.begin(); it != pending.end();) {
        Pending &p = *it;
        NodeInfo &n = nodes[p.node];
        if (!p.acked) {
            if ((int32_t)(now - p.nextAt) >= 0) {
                if (p.tries >= CMD_MAX_TRIES || !n.hasMac || !n.hasTable || !linkOk) {
                    // Không với tới ESP: app tự báo "không phản hồi" (có kèm "ESP đang mất kết nối")
                    Serial.printf("[cmd] %s: ESP %u không trả lời\n", p.key.c_str(), p.node);
                    it = pending.erase(it);
                    continue;
                }
                MsgCmd c = {p.id, n.table.rev, p.idx, (uint8_t)p.on};
                net.send(n.mac, MSG_CMD, p.node, &c, sizeof(c));
                p.tries++;
                p.nextAt = now + CMD_RETRY_MS * p.tries;
            }
        } else if (now - p.ackAt > STATE_WAIT_MS) {
            publishLog(p.node, p.key + ": đã nhận lệnh nhưng không báo xong (servo kẹt / mất điện servo?)");
            it = pending.erase(it);
            continue;
        }
        ++it;
    }
}

static bool hasPending(const String &key) {
    for (const auto &p : pending) if (p.key == key) return true;
    return false;
}

static void onLocalDone(uint8_t idx, bool on, uint32_t) {
    NodeInfo &n = nodes[HG_MASTER_ID];
    if (idx < n.keys.size()) publishState(n.keys[idx], on);
    statesSaveAt = millis() + 3000;  // lưu trạng thái sau 3 giây (gộp nhiều lần bấm)
}

// =============================================================
// ESP phòng
// =============================================================
static void rememberMac(uint8_t id, const uint8_t mac[6]) {
    NodeInfo &n = nodes[id];
    if (n.hasMac && !memcmp(n.mac, mac, 6)) return;
    // ESP mới (thay ESP hỏng) dùng lại số cũ: nhận luôn, vì gói đã có chữ ký đúng khóa mạng
    memcpy(n.mac, mac, 6);
    n.hasMac = true;
    net.addPeer(mac);
    prefs.putBytes(("m" + String(id)).c_str(), mac, 6);
    Serial.printf("[link] ESP %u = %02X:%02X:%02X:%02X:%02X:%02X\n", id, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static void markSeen(uint8_t id) {
    NodeInfo &n = nodes[id];
    n.lastSeen = millis();
    if (!n.online) {
        n.online = true;
        publishStatus(id, true);
    }
}

static void publishNodeHealth(uint8_t id) {
    NodeInfo &n = nodes[id];
    if (!n.hasHb) return;
    n.healthAt = millis();
    JsonDocument d;
    d["fw"] = String(n.hb.fw).substring(0, 11);
    d["up"] = n.hb.uptime;
    d["temp"] = n.hb.temp10 / 10.0f;
    d["heap"] = n.hb.heap;
    d["reset"] = resetText(n.hb.reset);
    d["tx"] = n.hb.txDbm;
    d["link"] = n.hb.linkPct;
    d["pca"] = (bool)(n.hb.flags & 1);
    d["hot"] = (bool)(n.hb.flags & 2);
    d["cfg"] = n.hasTable && n.hb.cfgRev == n.table.rev ? "ok" : "dang-gui";
    publishJson(nodeTopic(id, "health"), d, true);
}

static void handlePacket(const Packet &p) {
    uint8_t id = p.h.from;
    if (id == HG_MASTER_ID) return;  // có 2 ESP trung tâm? bỏ qua
    NodeInfo &n = nodes[id];

    switch (p.h.type) {
        case MSG_HELLO: {
            rememberMac(id, p.mac);
            markSeen(id);
            n.bootReported = false;  // ESP vừa khởi động: heartbeat đầu sẽ cho biết vì sao
            if (n.hasTable) sendConfig(id);
            Serial.printf("[link] ESP %u vào mạng\n", id);
            break;
        }
        case MSG_HEARTBEAT: {
            if (p.h.len < sizeof(MsgHeartbeat)) break;
            memcpy(&n.hb, p.data, sizeof(MsgHeartbeat));
            n.hasHb = true;
            rememberMac(id, p.mac);
            markSeen(id);
            float t = n.hb.temp10 / 10.0f;
            publishTemp(id, t);
            if (!n.bootReported) {
                n.bootReported = true;
                if (isBadReset(n.hb.reset)) publishLog(id, String("Vừa khởi động lại do ") + resetText(n.hb.reset) + resetAdvice(n.hb.reset));
                publishNodeHealth(id);
            }
            if (!n.healthAt || millis() - n.healthAt > HG_HEALTH_MS) publishNodeHealth(id);
            if (t >= HG_TEMP_WARN && (!n.hotWarnAt || millis() - n.hotWarnAt > 600000)) {
                n.hotWarnAt = millis();
                publishLog(id, "Chip đang nóng " + String(t, 1) + "°C - kiểm tra chỗ đặt ESP có thoáng không");
            }
            if (n.hasTable) {
                if (n.hb.cfgRev != n.table.rev) {
                    if (millis() - n.cfgSentAt > 2000) sendConfig(id);
                } else {
                    // Đồng bộ trạng thái (vd ESP vừa khởi động lại): chỉ báo cái khác với app
                    for (size_t i = 0; i < n.keys.size(); i++) {
                        bool on = n.hb.states & (1u << i);
                        const String &key = n.keys[i];
                        if (hasPending(key)) continue;
                        auto it = published.find(key);
                        if (it == published.end() || it->second != on) publishState(key, on);
                    }
                }
            }
            break;
        }
        case MSG_ACK: {
            if (p.h.len < sizeof(MsgAck)) break;
            MsgAck a;
            memcpy(&a, p.data, sizeof(a));
            markSeen(id);
            for (auto it = pending.begin(); it != pending.end(); ++it) {
                if (it->id != a.id) continue;
                if (a.result == ACK_OK) {
                    if (!it->acked) { it->acked = true; it->ackAt = millis(); }
                } else if (a.result == ACK_STALE_CONFIG) {
                    sendConfig(id);                      // gửi lại bảng rồi thử lại lệnh
                    it->nextAt = millis() + 300;
                } else {
                    publishLog(id, it->key + (a.result == ACK_UNSUPPORTED
                        ? ": ESP này chưa điều khiển được loại thiết bị / kênh này"
                        : ": sai dòng bảng kênh"));
                    pending.erase(it);
                }
                break;
            }
            break;
        }
        case MSG_STATE: {
            if (p.h.len < sizeof(MsgState)) break;
            MsgState s;
            memcpy(&s, p.data, sizeof(s));
            markSeen(id);
            if (n.hasTable && s.rev == n.table.rev && s.idx < n.keys.size()) publishState(n.keys[s.idx], s.on);
            pending.erase(std::remove_if(pending.begin(), pending.end(), [&](const Pending &x) { return x.id == s.id && s.id; }), pending.end());
            break;
        }
        case MSG_LOG: {
            String text = toStr(p.data, strnlen((const char *)p.data, p.h.len));
            markSeen(id);
            publishLog(id, text);
            break;
        }
        default:
            break;
    }
}

static void nodesLoop() {
    for (auto &kv : nodes) {
        uint8_t id = kv.first;
        NodeInfo &n = kv.second;
        if (id == HG_MASTER_ID) continue;
        if (n.online && millis() - n.lastSeen > HG_NODE_TIMEOUT_MS) {
            n.online = false;
            publishStatus(id, false);
            Serial.printf("[link] ESP %u mất kết nối\n", id);
        }
        if (n.online && n.hasTable && n.hasHb && n.hb.cfgRev != n.table.rev && millis() - n.cfgSentAt > CONFIG_RETRY_MS) sendConfig(id);
    }
}

// =============================================================
// MQTT
// =============================================================
static bool parseOn(const uint8_t *payload, unsigned int len, bool &on) {
    JsonDocument d;
    if (!deserializeJson(d, payload, len) && d.is<JsonObject>()) {
        JsonVariant v = d["on"];
        if (v.is<bool>()) { on = v.as<bool>(); return true; }
        if (v.is<int>()) { on = v.as<int>() != 0; return true; }
        return false;
    }
    String s = toStr(payload, len);
    s.trim();
    s.toLowerCase();
    if (s == "1" || s == "on" || s == "true") { on = true; return true; }
    if (s == "0" || s == "off" || s == "false") { on = false; return true; }
    return false;
}

static void handleAttrsPatch(const String &key, const uint8_t *payload, unsigned int len) {
    JsonDocument patch;
    if (deserializeJson(patch, payload, len) || !patch.is<JsonObject>()) return;
    JsonDocument cur;
    auto it = attrs.find(key);
    if (it != attrs.end()) deserializeJson(cur, it->second);
    for (JsonPair kv : patch.as<JsonObject>()) {
        if (strcmp(kv.key().c_str(), "v")) cur[kv.key()] = kv.value();
    }
    cur["v"] = 1;
    String s;
    serializeJson(cur, s);
    attrs[key] = s;
    publishRaw(String(DEV) + key + "/attrs", s, true);
    // Bước sau (firmware cầu thang): chuyển cài đặt này xuống ESP cầu thang
}

static void reboot() {
    publishStatus(HG_MASTER_ID, false);
    mqtt.disconnect();
    delay(200);
    ESP.restart();
}

static void factoryReset() {
    Serial.println("[!] Xóa toàn bộ cấu hình, khởi động lại...");
    prefs.clear();
    reboot();
}

static void handleNodeCmd(uint8_t id, const uint8_t *payload, unsigned int len) {
    JsonDocument d;
    if (deserializeJson(d, payload, len)) return;
    String cmd = d["cmd"] | "";
    uint8_t code = cmd == "reboot" ? NCMD_REBOOT : cmd == "identify" ? NCMD_IDENTIFY
        : cmd == "factory" ? NCMD_FACTORY : cmd == "resync" ? NCMD_RESYNC : 0;
    if (!code) return;
    if (id == HG_MASTER_ID) {
        if (code == NCMD_REBOOT) reboot();
        else if (code == NCMD_IDENTIFY) led.identify();
        else if (code == NCMD_FACTORY) factoryReset();
        return;
    }
    NodeInfo &n = nodes[id];
    if (!n.hasMac) return publishLog(HG_MASTER_ID, "ESP " + String(id) + " chưa từng vào mạng");
    MsgNodeCmd c = {code, 0};
    for (int i = 0; i < 3; i++) net.send(n.mac, MSG_NODECMD, id, &c, sizeof(c));  // gửi 3 lần cho chắc
}

static void handleSchedules(const uint8_t *payload, unsigned int len) {
    String json = toStr(payload, len);
    if (!schedules.load(json.c_str(), json.length())) {
        publishLog(HG_MASTER_ID, "Lịch hẹn giờ nhận được bị hỏng, giữ lịch cũ");
        return;
    }
    if (loadBlob("sch") != json) prefs.putBytes("sch", json.c_str(), json.length());
    Serial.printf("[sched] %u lịch hẹn\n", (unsigned)schedules.size());
}

static void onMqtt(char *topicC, uint8_t *payload, unsigned int len) {
    String topic(topicC);
    if (topic.startsWith(DEV)) {
        int last = topic.lastIndexOf('/');
        String what = topic.substring(last + 1);
        String key = topic.substring(strlen(DEV), last);
        if (what == "set") {
            bool on;
            if (parseOn(payload, len, on)) command(key, on);
        } else if (what == "cfg") {
            handleAttrsPatch(key, payload, len);
        } else if (what == "attrs") {
            attrs[key] = toStr(payload, len);
        }
        return;
    }
    if (topic.startsWith("hg/node/")) {
        int a = 8, b = topic.indexOf('/', a);
        if (b <= a) return;
        String idStr = topic.substring(a, b);
        for (unsigned int i = 0; i < idStr.length(); i++) if (!isDigit(idStr[i])) return;
        int id = idStr.toInt();
        if (id < 0 || id > 250) return;
        String what = topic.substring(b + 1);
        if (what == "config") handleNodeConfig((uint8_t)id, payload, len);
        else if (what == "cmd") handleNodeCmd((uint8_t)id, payload, len);
        return;
    }
    if (topic == "hg/home/schedules") handleSchedules(payload, len);
}

static void publishMasterHealth() {
    healthAt = millis();
    JsonDocument d;
    d["fw"] = HG_FW_VERSION;
    d["up"] = uptimeSec();
    d["temp"] = chipTemp();
    d["heap"] = ESP.getFreeHeap();
    d["psram"] = ESP.getFreePsram();
    d["rssi"] = WiFi.RSSI();
    d["wifi"] = usingBackup ? "du-phong" : "chinh";
    d["ch"] = WiFi.channel();
    d["reset"] = resetText(resetCode());
    d["sched"] = schedules.size();
    d["enc"] = net.encrypted();
    d["rejected"] = net.rejected();
    publishJson(nodeTopic(HG_MASTER_ID, "health"), d, true);
}

static void connectMqtt() {
    String cid = "hg-master-" + WiFi.macAddress();
    cid.replace(":", "");
    const char *will = "{\"v\":1,\"online\":false}";
    Serial.printf("[mqtt] đang nối %s...\n", HG_MQTT_HOST);
    esp_task_wdt_reset();
    bool ok = mqtt.connect(cid.c_str(), HG_MQTT_USER, HG_MQTT_PASS, nodeTopic(HG_MASTER_ID, "status").c_str(), 1, true, will, true);
    esp_task_wdt_reset();
    if (!ok) {
        int st = mqtt.state();
        mqttAuthFail = st == 4 || st == 5;
        char err[120] = {0};
        tls.lastError(err, sizeof(err));
        Serial.printf("[mqtt] lỗi %d%s %s\n", st, mqttAuthFail ? " (SAI tài khoản / mật khẩu MQTT)" : "", err);
        mqttRetryAt = millis() + (mqttAuthFail ? 60000 : mqttBackoff);
        mqttBackoff = std::min<uint32_t>(mqttBackoff * 2, 30000);
        return;
    }
    Serial.println("[mqtt] đã kết nối");
    mqttBackoff = 1000;
    mqttAuthFail = false;
    publishStatus(HG_MASTER_ID, true);
    const char *subs[] = {"hg/node/+/config", "hg/node/+/cmd", "hg/dev/+/+/set", "hg/dev/+/+/cfg", "hg/dev/+/+/attrs", "hg/home/schedules"};
    for (const char *s : subs) mqtt.subscribe(s, 1);
    publishMasterHealth();
    for (auto &kv : nodes) if (kv.first != HG_MASTER_ID && kv.second.online) publishStatus(kv.first, true);
    if (bootLogPending) {
        bootLogPending = false;
        if (isBadReset(resetCode())) publishLog(HG_MASTER_ID, String("Vừa khởi động lại do ") + resetText(resetCode()) + resetAdvice(resetCode()));
    }
}

// =============================================================
// WiFi
// =============================================================
static void wifiBegin(bool backup) {
    usingBackup = backup;
    WiFi.disconnect();
    if (backup) WiFi.begin(HG_WIFI_SSID2, HG_WIFI_PASS2);
    else WiFi.begin(HG_WIFI_SSID, HG_WIFI_PASS);
    wifiLastOk = millis();
    Serial.printf("[wifi] đang nối %s\n", backup ? HG_WIFI_SSID2 : HG_WIFI_SSID);
}

static void wifiLoop() {
    bool up = WiFi.status() == WL_CONNECTED;
    if (up) {
        if (!wifiWasConnected) {
            wifiConnectedAt = millis();
            Serial.printf("[wifi] đã nối, IP %s, kênh %d, sóng %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.channel(), WiFi.RSSI());
        }
        wifiWasConnected = true;
        wifiLastOk = millis();
        return;
    }
    wifiWasConnected = false;
    // Mất WiFi 30 giây: thử lại (đổi sang WiFi dự phòng nếu có)
    if (millis() - wifiLastOk > 30000) wifiBegin(strlen(HG_WIFI_SSID2) ? !usingBackup : false);
}

static void ledLoop() {
    if (!linkOk) { led.color(40, 0, 0); led.set(LED_ERROR); }
    else if (WiFi.status() != WL_CONNECTED) { led.color(0, 0, 40); led.set(LED_SEARCH); }
    else if (mqttAuthFail) { led.color(40, 0, 0); led.set(LED_ERROR); }
    else if (!mqtt.connected()) { led.color(40, 25, 0); led.set(LED_SEARCH); }
    else { led.color(0, 30, 0); led.set(LED_OK); }
    led.loop();
}

static void serialLoop() {
    if (!Serial.available()) return;
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line == "info") {
        Serial.printf("HomeGlass trung tâm %s | WiFi %s (%d dBm, kênh %d) | MQTT %s | %u ESP | %u lịch | %.1f°C | khởi động do %s\n",
            HG_FW_VERSION, WiFi.status() == WL_CONNECTED ? "OK" : "chưa", WiFi.RSSI(), WiFi.channel(),
            mqtt.connected() ? "OK" : "chưa", (unsigned)nodes.size(), (unsigned)schedules.size(), chipTemp(), resetText(resetCode()));
        for (auto &kv : nodes) {
            Serial.printf("  ESP %u: %s, %u thiết bị%s\n", kv.first, kv.second.online ? "online" : "offline",
                kv.second.table.n, kv.second.hasHb ? (", " + String(kv.second.hb.temp10 / 10.0f, 1) + "°C").c_str() : "");
        }
    } else if (line == "reboot") {
        reboot();
    } else if (line == "factory") {
        factoryReset();
    } else if (line.length()) {
        Serial.println("Lệnh: info | reboot | factory");
    }
}

// =============================================================
void setup() {
    Serial.begin(115200);
    delay(300);
    Serial.printf("\n=== HomeGlass ESP trung tâm %s (khởi động do %s) ===\n", HG_FW_VERSION, resetText(resetCode()));

    led.begin();
    button.begin();
    prefs.begin("hgm", false);

    outputs.begin();
    outputs.onDone(onLocalDone);
    loadAll();

    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);          // không ngủ: ESP-NOW nhận lệnh tức thì
    WiFi.setAutoReconnect(true);
    WiFi.setHostname("homeglass-trung-tam");
    wifiBegin(false);

    linkOk = net.begin(HG_NET_KEY, HG_MASTER_ID);
    if (!linkOk) Serial.println("[!] HG_NET_KEY trong secrets.h sai (cần đúng 64 ký tự hex, khác toàn số 0)");
    for (auto &kv : nodes) if (kv.second.hasMac && kv.first != HG_MASTER_ID) net.addPeer(kv.second.mac);

    configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");  // giờ chuẩn UTC

    tls.setCACert(HG_ROOT_CA);
    tls.setHandshakeTimeout(20);
    mqtt.setServer(HG_MQTT_HOST, HG_MQTT_PORT);
    mqtt.setBufferSize(16384);
    mqtt.setKeepAlive(30);
    mqtt.setSocketTimeout(10);
    mqtt.setCallback(onMqtt);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
    esp_task_wdt_config_t wdt = {WDT_TIMEOUT_S * 1000, 0, true};
    esp_task_wdt_reconfigure(&wdt);
#else
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
    esp_task_wdt_add(NULL);
}

void loop() {
    esp_task_wdt_reset();
    uint32_t now = millis();

    wifiLoop();
    if (WiFi.status() == WL_CONNECTED) {
        if (mqtt.connected()) {
            mqtt.loop();
        } else if ((int32_t)(now - mqttRetryAt) >= 0) {
            // TLS cần giờ chuẩn để kiểm tra chứng chỉ: chờ tối đa 20 giây
            if (net.now() || now - wifiConnectedAt > 20000) connectMqtt();
        }
    }

    Packet p;
    while (net.poll(p)) handlePacket(p);

    if (linkOk && now - beaconAt >= HG_BEACON_MS) {
        beaconAt = now;
        MsgBeacon b = {};
        b.wifiCh = net.channel();
        b.flags = mqtt.connected() ? 1 : 0;
        strncpy(b.fw, HG_FW_VERSION, sizeof(b.fw) - 1);
        net.send(nullptr, MSG_BEACON, HG_ANY_ID, &b, sizeof(b));
    }

    pendingLoop();
    outputs.loop();
    if (now - nodesAt >= 1000) { nodesAt = now; nodesLoop(); }
    if (now - tempAt >= TEMP_EVERY_MS) { tempAt = now; publishTemp(HG_MASTER_ID, chipTemp()); }
    if (now - healthAt >= HG_HEALTH_MS) publishMasterHealth();
    if (now - schedAt >= 5000) {
        schedAt = now;
        schedules.loop(net.now(), [](const String &key, bool on) { command(key, on); });
    }
    if (statesSaveAt && (int32_t)(now - statesSaveAt) >= 0) {
        statesSaveAt = 0;
        if (outputs.states() != savedLocalStates) {
            savedLocalStates = outputs.states();
            prefs.putUShort("s0", savedLocalStates);
        }
    }

    switch (button.loop()) {
        case BTN_SHORT: led.identify(); break;
        case BTN_LONG: factoryReset(); break;
        default: break;
    }
    ledLoop();
    serialLoop();
    chipTemp();
    delay(1);  // nhường CPU cho WiFi
}
