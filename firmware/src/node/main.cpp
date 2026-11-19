// =============================================================
// ESP PHÒNG (ESP32-C3 super mini) - 1 bản firmware CHUNG cho mọi phòng
// -------------------------------------------------------------
// - Không nối WiFi nhà: chỉ nói chuyện với ESP trung tâm qua ESP-NOW
//   (nhanh vài mili giây, ít tốn điện, ít nóng).
// - Tự dò kênh WiFi để tìm ESP trung tâm (router đổi kênh cũng tự theo).
// - Bảng kênh (đèn nào ở kênh nào, servo hay relay, góc bao nhiêu) do app
//   gửi xuống, lưu flash. Thêm đèn = sửa trong app, KHÔNG sửa code.
// - Nhớ trạng thái: mất điện có lại -> relay về đúng trạng thái cũ,
//   servo KHÔNG tự quay (tránh gạt nhầm công tắc).
// - Chạy ở 80 MHz + tự giảm công suất phát khi sóng tốt / khi nóng
//   (C3 super mini tản nhiệt kém).
// - Chỉ khác nhau SỐ ESP: đặt 1 lần qua cổng USB (Serial Monitor), lưu flash.
// =============================================================
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_arduino_version.h>
#include <esp_task_wdt.h>
#include <esp_wifi.h>

#include "hg_config.h"
#include "hg_link.h"
#include "hg_outputs.h"
#include "hg_sys.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Thiếu firmware/include/secrets.h - chép secrets.example.h thành secrets.h (ESP phòng chỉ cần HG_NET_KEY)"
#endif

using namespace hg;

static const uint32_t WDT_TIMEOUT_S = 20;
static const uint32_t SCAN_DWELL_MS = 260;      // nghe mỗi kênh bao lâu khi dò tìm trung tâm
static const uint32_t SAVED_CH_WAIT_MS = 3000;  // ưu tiên nghe kênh đã lưu trước

static Preferences prefs;
static Outputs outputs;
static Led led;
static Button button;

static uint8_t nodeId = 0;
static bool linkOk = false;
static uint8_t masterMac[6] = {0};
static bool hasMaster = false;

// Tìm trung tâm
static bool online = false;
static uint8_t scanCh = 1;
static uint32_t scanAt = 0, searchStart = 0, lastBeacon = 0;
static uint8_t savedCh = 1;

// Định kỳ
static uint32_t hbAt = 0, saveAt = 0, tempAt = 0;
static uint16_t savedStates = 0;

// Chất lượng sóng: đếm beacon nhận được trong 30 giây
static uint8_t beaconHits[15] = {0};
static uint32_t beaconSlotAt = 0;
static uint8_t beaconSlot = 0;

// Công suất phát tự chỉnh
static const wifi_power_t TX_STEPS[] = {WIFI_POWER_8_5dBm, WIFI_POWER_11dBm, WIFI_POWER_13dBm, WIFI_POWER_15dBm, WIFI_POWER_17dBm, WIFI_POWER_19_5dBm};
static const int8_t TX_DBM[] = {8, 11, 13, 15, 17, 19};
static uint8_t txStep = 2;
static uint32_t lastOk = 0, lastFail = 0;
static bool hot = false;

// =============================================================
static void setTx(uint8_t step) {
    txStep = constrain(step, 0, 5);
    WiFi.setTxPower(TX_STEPS[txStep]);
}

/** Mỗi lần gửi heartbeat: rớt nhiều thì tăng sóng, ổn định (hoặc đang nóng) thì giảm cho mát. */
static void adaptTx() {
    uint32_t ok = net.sentOk() - lastOk, fail = net.sentFail() - lastFail;
    lastOk = net.sentOk();
    lastFail = net.sentFail();
    if (fail > 0 && fail * 5 >= ok + fail) setTx(txStep + 1);          // rớt >= 20%: tăng
    else if (fail == 0 && ok >= 3 && txStep > (hot ? 0 : 1)) setTx(txStep - 1);  // ổn: giảm dần
    else if (hot && txStep > 1 && fail == 0) setTx(txStep - 1);
}

static uint8_t linkPercent() {
    uint16_t sum = 0;
    for (uint8_t h : beaconHits) sum += h;
    return (uint8_t)min<uint16_t>(100, sum * 100 / 15);  // 1 beacon / 2 giây -> 15 trong 30 giây
}

static void beaconTick() {
    if (millis() - beaconSlotAt >= 2000) {
        beaconSlotAt = millis();
        beaconSlot = (beaconSlot + 1) % 15;
        beaconHits[beaconSlot] = 0;
    }
}

// =============================================================
// Lưu / đọc flash
// =============================================================
static void loadTable() {
    Table t = {};
    if (prefs.getBytesLength("tbl") == sizeof(Table)) {
        prefs.getBytes("tbl", &t, sizeof(Table));
        if (t.n > HG_MAX_DEVICES || tableCrc(t) != t.rev) {
            // Dữ liệu trong flash bị hỏng -> bỏ, chờ trung tâm gửi lại (an toàn: không điều khiển bừa)
            Serial.println("[!] Bảng kênh trong flash hỏng, chờ ESP trung tâm gửi lại");
            t = {};
        }
    }
    savedStates = prefs.getUShort("st", 0);
    outputs.apply(t, savedStates);
}

static void saveTable(const Table &t) {
    Table old = {};
    if (prefs.getBytesLength("tbl") == sizeof(Table)) prefs.getBytes("tbl", &old, sizeof(Table));
    if (memcmp(&old, &t, sizeof(Table))) prefs.putBytes("tbl", &t, sizeof(Table));
}

// =============================================================
// Gửi cho trung tâm
// =============================================================
static void sendToMaster(uint8_t type, const void *payload, size_t len) {
    if (!hasMaster || !linkOk) return;
    net.send(masterMac, type, HG_MASTER_ID, payload, len);
}

static void sendHeartbeat() {
    MsgHeartbeat hb = {};
    hb.cfgRev = outputs.table().rev;
    hb.uptime = uptimeSec();
    hb.temp10 = (int16_t)lroundf(chipTemp() * 10);
    hb.reset = resetCode();
    hb.txDbm = TX_DBM[txStep];
    hb.heap = ESP.getFreeHeap();
    hb.states = outputs.states();
    hb.linkPct = linkPercent();
    hb.flags = (outputs.hasPca() ? 1 : 0) | (hot ? 2 : 0);
    strncpy(hb.fw, HG_FW_VERSION, sizeof(hb.fw) - 1);
    sendToMaster(MSG_HEARTBEAT, &hb, sizeof(hb));
    adaptTx();
}

static void sendLog(const String &text) {
    MsgLog m = {};
    strncpy(m.text, text.c_str(), sizeof(m.text) - 1);
    sendToMaster(MSG_LOG, &m, strlen(m.text) + 1);
    Serial.println("[log] " + text);
}

static void sendHello() {
    MsgHello h = {};
    strncpy(h.fw, HG_FW_VERSION, sizeof(h.fw) - 1);
    h.cfgRev = outputs.table().rev;
    h.uptime = uptimeSec();
    h.reset = resetCode();
    net.send(nullptr, MSG_HELLO, HG_ANY_ID, &h, sizeof(h));
}

/** Thiết bị đã bật/tắt xong -> báo trung tâm (gửi 2 lần cho chắc, trung tâm tự bỏ trùng). */
static uint32_t stateRepeatAt = 0;
static MsgState stateRepeat = {};
static void onDone(uint8_t idx, bool on, uint32_t cmdId) {
    MsgState s = {cmdId, outputs.table().rev, idx, (uint8_t)on};
    sendToMaster(MSG_STATE, &s, sizeof(s));
    stateRepeat = s;
    stateRepeatAt = millis() + 40;
    saveAt = millis() + 3000;  // lưu trạng thái sau 3 giây (gộp nhiều lần bấm, đỡ mòn flash)
}

// =============================================================
// Nhận từ trung tâm
// =============================================================
static uint32_t beaconCount = 0;
static bool debugBeacon = false;   // gõ "debug" trong Serial để xem từng beacon

static void onBeacon(const Packet &p) {
    if (p.h.from != HG_MASTER_ID || p.h.len < sizeof(MsgBeacon)) return;
    beaconCount++;
    if (debugBeacon) Serial.printf("[beacon] #%u t=%lu ms kênh %u\n", (unsigned)beaconCount, (unsigned long)millis(), net.channel());
    // Giờ chuẩn: chỉ cho đi tới (gói beacon cũ bị phát lại không kéo lùi được giờ)
    uint32_t mine = net.now();
    if (!mine || p.h.time + 90 >= mine) net.setTime(p.h.time);
    beaconHits[beaconSlot] = min<uint8_t>(beaconHits[beaconSlot] + 1, 2);
    lastBeacon = millis();

    if (!hasMaster || memcmp(masterMac, p.mac, 6)) {
        memcpy(masterMac, p.mac, 6);
        hasMaster = true;
        net.addPeer(masterMac);
        prefs.putBytes("mm", masterMac, 6);
    }
    if (!online) {
        online = true;
        uint8_t ch = net.channel();
        if (ch != savedCh) { savedCh = ch; prefs.putUChar("ch", ch); }
        Serial.printf("[link] đã thấy ESP trung tâm ở kênh %u\n", ch);
        sendHello();
        hbAt = millis() - HG_HEARTBEAT_MS + 300;  // heartbeat ngay sau đó
    }
}

static void onConfig(const Packet &p) {
    if (p.h.len < offsetof(Table, e)) return;
    Table t = {};
    memcpy(&t, p.data, min<size_t>(p.h.len, sizeof(Table)));
    if (t.n > HG_MAX_DEVICES || tableCrc(t) != t.rev) {
        sendLog("Bảng kênh nhận được bị lỗi, đang chờ gửi lại");
        return;
    }
    // Giữ trạng thái của các thiết bị không đổi kênh / cách bật tắt
    const Table &old = outputs.table();
    uint16_t states = 0;
    for (uint8_t i = 0; i < t.n; i++) {
        for (uint8_t j = 0; j < old.n; j++) {
            if (old.e[j].ch == t.e[i].ch && old.e[j].act == t.e[i].act && (outputs.states() & (1u << j))) states |= (1u << i);
        }
    }
    if (t.rev != old.rev) {
        outputs.apply(t, states);
        saveTable(t);
        saveAt = millis() + 1000;
        Serial.printf("[cfg] bảng kênh mới: %u thiết bị\n", t.n);
        for (uint8_t i = 0; i < t.n; i++) {
            const Entry &e = t.e[i];
            if (e.ch > 8 && !outputs.hasPca()) sendLog("Kênh " + String(e.ch) + " cần mạch PCA9685 (I2C chân 20/21) nhưng chưa thấy mạch");
        }
    }
    sendHeartbeat();  // báo ngay "đã nhận bảng"
}

static void onCmd(const Packet &p) {
    if (p.h.len < sizeof(MsgCmd)) return;
    MsgCmd c;
    memcpy(&c, p.data, sizeof(c));
    MsgAck a = {c.id, c.idx, ACK_OK};
    if (c.rev != outputs.table().rev) a.result = ACK_STALE_CONFIG;
    else a.result = outputs.set(c.idx, c.on, c.id);
    sendToMaster(MSG_ACK, &a, sizeof(a));
}

static void factoryReset() {
    Serial.println("[!] Xóa cấu hình (giữ số ESP), khởi động lại...");
    uint8_t id = nodeId;
    prefs.clear();
    if (id) prefs.putUChar("id", id);
    delay(100);
    ESP.restart();
}

static void onNodeCmd(const Packet &p) {
    if (p.h.len < sizeof(MsgNodeCmd)) return;
    MsgNodeCmd c;
    memcpy(&c, p.data, sizeof(c));
    static uint32_t lastAt = 0;
    if (millis() - lastAt < 1500 && c.cmd != NCMD_RESYNC) return;  // trung tâm gửi 3 lần: chỉ làm 1 lần
    lastAt = millis();
    switch (c.cmd) {
        case NCMD_REBOOT: sendLog("Khởi động lại theo lệnh từ app"); delay(100); ESP.restart(); break;
        case NCMD_IDENTIFY: led.identify(); break;
        case NCMD_FACTORY: factoryReset(); break;
        case NCMD_RESYNC: sendHeartbeat(); break;
    }
}

// =============================================================
// Đặt số ESP qua cổng USB (chỉ cần làm 1 lần)
// =============================================================
static void serialLoop() {
    if (!Serial.available()) return;
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.startsWith("id ") || (nodeId == 0 && line.length() && isDigit(line[0]))) {
        int id = line.startsWith("id ") ? line.substring(3).toInt() : line.toInt();
        if (id < 1 || id > 250) {
            Serial.println("Số ESP phải từ 1 đến 250");
            return;
        }
        prefs.putUChar("id", (uint8_t)id);
        Serial.printf("Đã đặt số ESP = %d. Khởi động lại...\n", id);
        delay(200);
        ESP.restart();
    } else if (line == "info") {
        Serial.printf("HomeGlass ESP phòng %s | số ESP %u | %s | kênh %u | sóng %u%% | phát %d dBm | %.1f°C | %u thiết bị | PCA9685 %s | khởi động do %s\n",
            HG_FW_VERSION, nodeId, online ? "đã nối trung tâm" : "đang tìm trung tâm", net.channel(), linkPercent(), TX_DBM[txStep],
            chipTemp(), outputs.table().n, outputs.hasPca() ? "có" : "không", resetText(resetCode()));
        for (uint8_t i = 0; i < outputs.table().n; i++) {
            const Entry &e = outputs.table().e[i];
            Serial.printf("  %u. kênh %u (%s) %s %s\n", i, e.ch, Outputs::pinName(e.ch).c_str(),
                e.act == ACT_SERVO ? "servo" : e.act == ACT_RELAY ? "relay" : "cau thang",
                outputs.states() & (1u << i) ? "BẬT" : "tắt");
        }
        Serial.printf("  beacon nhận %u | gói bị từ chối %u | gửi OK %u, lỗi %u | mã hóa %s\n",
            (unsigned)beaconCount, (unsigned)net.rejected(), (unsigned)net.sentOk(), (unsigned)net.sentFail(), net.encrypted() ? "có" : "không");
    } else if (line == "debug") {
        debugBeacon = !debugBeacon;
        Serial.println(debugBeacon ? "Bật log từng beacon" : "Tắt log từng beacon");
    } else if (line == "reboot") {
        ESP.restart();
    } else if (line == "factory") {
        factoryReset();
    } else if (line.length()) {
        Serial.println("Lệnh: id <số> | info | debug | reboot | factory");
    }
}

// =============================================================
void setup() {
    Serial.begin(115200);
    led.begin();
    button.begin();
    prefs.begin("hgn", false);
    nodeId = prefs.getUChar("id", 0);

    // Đặt relay về trạng thái cũ NGAY khi có điện (trước cả WiFi)
    outputs.begin();
    outputs.onDone(onDone);
    loadTable();

    setCpuFrequencyMhz(80);  // đủ nhanh cho servo / ESP-NOW, mát hơn nhiều so với 160 MHz
    delay(1500);             // chờ cổng USB sẵn sàng để kịp thấy log
    Serial.printf("\n=== HomeGlass ESP phòng %s | số ESP %u | khởi động do %s ===\n", HG_FW_VERSION, nodeId, resetText(resetCode()));

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    setTx(2);

    if (nodeId == 0) {
        Serial.println(">>> Chưa đặt số ESP. Gõ số (vd: 3) rồi Enter. <<<");
        led.set(LED_SOLID);
    }
    linkOk = net.begin(HG_NET_KEY, nodeId ? nodeId : 254);
    if (!linkOk) {
        Serial.println("[!] HG_NET_KEY trong secrets.h sai (cần 64 ký tự hex, giống hệt ESP trung tâm)");
        led.set(LED_ERROR);
    }
    if (prefs.getBytesLength("mm") == 6) {
        prefs.getBytes("mm", masterMac, 6);
        hasMaster = true;
        net.addPeer(masterMac);
    }
    savedCh = prefs.getUChar("ch", 1);
    scanCh = savedCh;
    net.setChannel(savedCh);
    searchStart = millis();

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
    serialLoop();
    led.loop();
    outputs.loop();
    chipTemp();
    beaconTick();

    switch (button.loop()) {
        case BTN_SHORT: led.count(nodeId); break;   // nháy đúng số ESP
        case BTN_LONG: factoryReset(); break;
        default: break;
    }

    if (nodeId == 0 || !linkOk) { delay(5); return; }  // chưa đặt số / sai khóa: chỉ chờ

    Packet p;
    while (net.poll(p)) {
        switch (p.h.type) {
            case MSG_BEACON: onBeacon(p); break;
            case MSG_CONFIG: if (p.h.from == HG_MASTER_ID) onConfig(p); break;
            case MSG_CMD: if (p.h.from == HG_MASTER_ID) onCmd(p); break;
            case MSG_NODECMD: if (p.h.from == HG_MASTER_ID) onNodeCmd(p); break;
            default: break;
        }
    }

    // Mất beacon quá lâu -> dò lại kênh (router đổi kênh, trung tâm khởi động lại...)
    // So sánh có dấu: lastBeacon có thể mới hơn "now" vài ms (vừa nhận gói trong cùng vòng lặp)
    if (online && (int32_t)(now - lastBeacon) > (int32_t)HG_LINK_LOST_MS) {
        online = false;
        searchStart = now;
        Serial.println("[link] mất ESP trung tâm, đang dò lại...");
    }
    if (!online) {
        led.set(LED_SEARCH);
        // Nghe kênh đã lưu trước, rồi mới quét lần lượt kênh 1..13
        if (now - searchStart > SAVED_CH_WAIT_MS && now - scanAt >= SCAN_DWELL_MS) {
            scanAt = now;
            scanCh = scanCh % 13 + 1;
            net.setChannel(scanCh);
        }
    } else {
        led.set(LED_OK);
        if (now - hbAt >= HG_HEARTBEAT_MS) {
            hbAt = now - (esp_random() % 800);  // lệch ngẫu nhiên: nhiều ESP không gửi trùng lúc
            sendHeartbeat();
        }
    }

    if (stateRepeatAt && (int32_t)(now - stateRepeatAt) >= 0) {
        stateRepeatAt = 0;
        sendToMaster(MSG_STATE, &stateRepeat, sizeof(stateRepeat));
    }
    if (saveAt && (int32_t)(now - saveAt) >= 0 && !outputs.busy()) {
        saveAt = 0;
        if (outputs.states() != savedStates) {
            savedStates = outputs.states();
            prefs.putUShort("st", savedStates);
        }
    }
    if (now - tempAt >= 5000) {
        tempAt = now;
        float t = chipTemp();
        bool wasHot = hot;
        hot = t >= HG_TEMP_HOT || (hot && t > HG_TEMP_HOT - 5);  // trễ 5°C cho khỏi bật tắt liên tục
        if (hot && !wasHot) {
            setTx(0);
            sendLog("Chip nóng " + String(t, 1) + "°C: đã giảm công suất phát cho mát. Kiểm tra chỗ đặt ESP có kín không");
        }
    }
    delay(1);
}
