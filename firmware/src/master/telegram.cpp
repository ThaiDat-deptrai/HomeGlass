#include "telegram.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <deque>
#include <map>

#include "ca_telegram.h"

namespace tg {

static const uint32_t PAIR_MS = 5 * 60 * 1000;
static const uint32_t ALERT_REPEAT_MS = 10 * 60 * 1000;
static const size_t MAX_QUEUE = 24;
static const int POLL_TIMEOUT_S = 3;   // chờ tin mới tối đa 3 giây mỗi lần hỏi (tin đến là về ngay)

struct Out { String method; String body; };

// ---------- Dùng chung giữa 2 luồng: luôn khóa mtx ----------
static SemaphoreHandle_t mtx = nullptr;
static String token, bot, err, pendingToken;
static bool isOnline = false, paused = false, changed = true, badToken = false;
static std::deque<Out> outQ;
static std::deque<In> inQ;

// ---------- Chỉ vòng lặp chính dùng ----------
static int64_t chats[MAX_CHATS] = {0};
static uint8_t nChats = 0;
static String pairCode;
static uint32_t pairUntil = 0;
static uint32_t alertMask = AL_DEFAULT;
static uint8_t lightH = 0;
static std::map<String, uint32_t> alertAt;

struct Lock {
    Lock() { xSemaphoreTake(mtx, portMAX_DELAY); }
    ~Lock() { xSemaphoreGive(mtx); }
};

static void markChanged() { Lock l; changed = true; }

// =============================================================
// Flash
// =============================================================
static void saveChats() {
    Preferences p;
    p.begin("hgtg", false);
    p.putBytes("chats", chats, nChats * sizeof(int64_t));
    p.end();
}

// =============================================================
// Luồng Telegram (lõi 0)
// =============================================================
static int call(HTTPClient &http, WiFiClientSecure &client, const String &tok, const char *method, const String &body, String &resp) {
    String url = "https://api.telegram.org/bot" + tok + "/" + method;
    if (!http.begin(client, url)) return -1;
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(body);
    resp = code > 0 ? http.getString() : "";
    http.end();
    return code;
}

static void setNet(bool ok, const String &e) {
    Lock l;
    if (ok != isOnline || e != err) changed = true;
    isOnline = ok;
    err = e;
}

static void task(void *) {
    WiFiClientSecure client;
    client.setCACert(HG_TELEGRAM_CA);   // chỉ nói chuyện với đúng máy chủ Telegram
    HTTPClient http;
    http.setReuse(true);                // giữ kết nối: đỡ bắt tay TLS mỗi lần (nhanh, mát)
    http.setTimeout((POLL_TIMEOUT_S + 7) * 1000);
    http.setConnectTimeout(8000);
    int64_t offset = 0;
    bool synced = false;
    uint32_t backoff = 0;

    for (;;) {
        String tok, verify;
        bool pause;
        {
            Lock l;
            tok = badToken ? String() : token;
            verify = pendingToken;
            pause = paused;
        }
        if (pause || WiFi.status() != WL_CONNECTED) {
            client.stop();
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        // ----- Mã bot mới từ app: hỏi Telegram "tôi là ai" rồi mới lưu -----
        if (verify.length()) {
            String resp;
            int code = call(http, client, verify, "getMe", "{}", resp);
            JsonDocument d;
            bool ok = code == 200 && !deserializeJson(d, resp) && d["ok"] == true;
            Lock l;
            pendingToken = "";
            changed = true;
            if (ok) {
                token = verify;
                bot = String("@") + (d["result"]["username"] | "");
                err = "";
                badToken = false;
                isOnline = true;
                Preferences p;
                p.begin("hgtg", false);
                p.putString("tok", token);
                p.putString("bot", bot);
                p.end();
                synced = false;
            } else {
                err = code == 401 || code == 404 ? "Mã bot không đúng (dán lại mã BotFather đưa)"
                    : code < 0 ? "Không kết nối được Telegram (mạng / chứng chỉ)"
                    : "Telegram từ chối (mã " + String(code) + ")";
            }
            continue;
        }

        if (!tok.length()) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        // ----- Gửi các tin đang chờ -----
        for (;;) {
            Out o;
            {
                Lock l;
                if (outQ.empty()) break;
                o = outQ.front();
                outQ.pop_front();
            }
            String resp;
            int code = call(http, client, tok, o.method.c_str(), o.body, resp);
            if (code != 200 && o.method == "sendMessage") {
                // Lỗi mạng: gửi lại sau (để đầu hàng đợi); lỗi khác (vd người dùng chặn bot): bỏ
                if (code < 0) {
                    Lock l;
                    outQ.push_front(o);
                    break;
                }
            }
        }

        // ----- Hỏi tin mới -----
        // Lần đầu sau khi khởi động: BỎ các tin cũ (lệnh "bật đèn" gửi lúc ESP đang tắt
        // không được tự chạy bất ngờ khi có điện lại)
        String body = synced
            ? "{\"offset\":" + String((long long)offset) + ",\"timeout\":" + String(POLL_TIMEOUT_S) +
              ",\"limit\":5,\"allowed_updates\":[\"message\",\"callback_query\"]}"
            : String("{\"offset\":-1,\"limit\":1,\"timeout\":0}");
        String resp;
        int code = call(http, client, tok, "getUpdates", body, resp);
        if (code != 200) {
            if (code == 401 || code == 404) {
                Lock l;
                badToken = true;
                err = "Mã bot đã bị thu hồi / sai. Dán mã mới trong app";
                isOnline = false;
                changed = true;
                continue;
            }
            setNet(false, code < 0 ? "Không kết nối được Telegram (mạng / chứng chỉ)" : "Telegram lỗi (mã " + String(code) + ")");
            client.stop();
            backoff = backoff ? std::min<uint32_t>(backoff * 2, 60000) : 2000;
            vTaskDelay(pdMS_TO_TICKS(backoff));
            continue;
        }
        backoff = 0;
        setNet(true, "");

        JsonDocument filter;
        filter["result"][0]["update_id"] = true;
        filter["result"][0]["message"]["chat"]["id"] = true;
        filter["result"][0]["message"]["from"]["first_name"] = true;
        filter["result"][0]["message"]["text"] = true;
        filter["result"][0]["callback_query"]["id"] = true;
        filter["result"][0]["callback_query"]["data"] = true;
        filter["result"][0]["callback_query"]["from"]["first_name"] = true;
        filter["result"][0]["callback_query"]["message"]["chat"]["id"] = true;
        JsonDocument d;
        if (deserializeJson(d, resp, DeserializationOption::Filter(filter))) continue;
        for (JsonObject u : d["result"].as<JsonArray>()) {
            int64_t id = u["update_id"] | (int64_t)0;
            if (id >= offset) offset = id + 1;
            if (!synced) continue;
            In in;
            if (u["callback_query"].is<JsonObject>()) {
                JsonObject q = u["callback_query"];
                in.chat = q["message"]["chat"]["id"] | (int64_t)0;
                in.cbId = q["id"] | "";
                in.cbData = q["data"] | "";
                in.from = q["from"]["first_name"] | "";
            } else if (u["message"].is<JsonObject>()) {
                JsonObject m = u["message"];
                in.chat = m["chat"]["id"] | (int64_t)0;
                in.text = m["text"] | "";
                in.from = m["from"]["first_name"] | "";
            }
            if (!in.chat) continue;
            Lock l;
            if (inQ.size() < MAX_QUEUE) inQ.push_back(in);
        }
        synced = true;
        vTaskDelay(pdMS_TO_TICKS(30));
    }
}

// =============================================================
// Vòng lặp chính gọi
// =============================================================
void begin() {
    mtx = xSemaphoreCreateMutex();
    Preferences p;
    p.begin("hgtg", false);
    token = p.getString("tok", "");
    bot = p.getString("bot", "");
    alertMask = p.getUInt("al", AL_DEFAULT);
    lightH = p.getUChar("lh", 0);
    size_t len = p.getBytesLength("chats");
    nChats = std::min<size_t>(len / sizeof(int64_t), MAX_CHATS);
    if (nChats) p.getBytes("chats", chats, nChats * sizeof(int64_t));
    p.end();
    // Luồng riêng ở lõi 0 (WiFi cũng ở lõi 0), ưu tiên thấp: không tranh với điều khiển đèn
    xTaskCreatePinnedToCore(task, "telegram", 12288, nullptr, 1, nullptr, 0);
}

bool configured() { Lock l; return token.length() > 0; }
String botName() { Lock l; return bot; }
String lastError() { Lock l; return err; }
bool online() { Lock l; return isOnline; }

void setToken(const String &t) {
    Lock l;
    pendingToken = t;
    err = "";
    changed = true;
}

void removeBot() {
    {
        Lock l;
        token = "";
        bot = "";
        err = "";
        badToken = false;
        isOnline = false;
        outQ.clear();
        inQ.clear();
        changed = true;
    }
    nChats = 0;
    pairCode = "";
    Preferences p;
    p.begin("hgtg", false);
    p.clear();
    p.end();
}

uint8_t chatCount() { return nChats; }

bool allowed(int64_t chat) {
    for (uint8_t i = 0; i < nChats; i++) if (chats[i] == chat) return true;
    return false;
}

bool addChat(int64_t chat) {
    if (allowed(chat)) return true;
    if (nChats >= MAX_CHATS) return false;
    chats[nChats++] = chat;
    saveChats();
    markChanged();
    return true;
}

void clearChats() {
    nChats = 0;
    saveChats();
    markChanged();
}

void startPairing() {
    pairCode = String(1000 + esp_random() % 9000);
    pairUntil = millis() + PAIR_MS;
    markChanged();
}

String pairingCode() {
    if (pairCode.length() && (int32_t)(millis() - pairUntil) > 0) {
        pairCode = "";
        markChanged();
    }
    return pairCode;
}

void stopPairing() {
    pairCode = "";
    markChanged();
}

uint32_t alerts() { return alertMask; }
uint8_t lightHours() { return lightH; }

void setAlerts(uint32_t mask, uint8_t hours) {
    alertMask = mask;
    lightH = hours;
    Preferences p;
    p.begin("hgtg", false);
    p.putUInt("al", mask);
    p.putUChar("lh", hours);
    p.end();
    markChanged();
}

bool poll(In &out) {
    Lock l;
    if (inQ.empty()) return false;
    out = inQ.front();
    inQ.pop_front();
    return true;
}

static void enqueue(const String &method, const String &body) {
    Lock l;
    if (!token.length()) return;
    if (outQ.size() >= MAX_QUEUE) outQ.pop_front();  // đầy: bỏ tin cũ nhất, không bao giờ treo
    outQ.push_back({method, body});
}

void send(int64_t chat, const String &text, const String &markup) {
    auto one = [&](int64_t id) {
        JsonDocument d;
        d["chat_id"] = id;
        d["text"] = text;
        d["disable_web_page_preview"] = true;
        if (markup.length()) d["reply_markup"] = serialized(markup);
        String body;
        serializeJson(d, body);
        enqueue("sendMessage", body);
    };
    if (chat) one(chat);
    else for (uint8_t i = 0; i < nChats; i++) one(chats[i]);
}

void answer(const String &cbId, const String &text) {
    JsonDocument d;
    d["callback_query_id"] = cbId;
    if (text.length()) d["text"] = text;
    String body;
    serializeJson(d, body);
    enqueue("answerCallbackQuery", body);
}

void alert(Alert kind, const String &key, const String &text, const String &markup) {
    if (!(alertMask & kind) || !nChats || !configured()) return;
    uint32_t now = millis();
    auto it = alertAt.find(key);
    if (it != alertAt.end() && now - it->second < ALERT_REPEAT_MS) return;
    alertAt[key] = now;
    if (alertAt.size() > 64) alertAt.clear();  // giới hạn bộ nhớ
    send(0, text, markup);
}

void pause(bool on) {
    Lock l;
    paused = on;
}

bool takeStatusChanged() {
    pairingCode();  // mã ghép hết hạn -> cũng tính là đổi
    Lock l;
    bool c = changed;
    changed = false;
    return c;
}

// =============================================================
// Bỏ dấu tiếng Việt: "Tắt ĐÈN ngủ!" -> "tat den ngu"
// =============================================================
static const char *const VN[] = {
    "aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ",
    "dđĐD",
    "eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ",
    "iìíỉĩịIÌÍỈĨỊ",
    "oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ",
    "uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ",
    "yỳýỷỹỵYỲÝỶỸỴ",
};

static uint32_t nextCp(const char *&p) {
    uint8_t c = (uint8_t)*p++;
    if (c < 0x80) return c;
    int extra = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : 1;
    uint32_t cp = c & (0x3F >> extra);
    while (extra-- && (*p & 0xC0) == 0x80) cp = (cp << 6) | ((uint8_t)*p++ & 0x3F);
    return cp;
}

static char baseOf(uint32_t cp) {
    if (cp < 0x80) {
        char c = (char)cp;
        if (c >= 'A' && c <= 'Z') return c - 'A' + 'a';
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) return c;
        return ' ';
    }
    for (const char *group : VN) {
        const char *p = group;
        char base = *group;
        while (*p) if (nextCp(p) == cp) return base;
    }
    return ' ';
}

String fold(const String &s) {
    String out;
    out.reserve(s.length());
    const char *p = s.c_str();
    bool space = true;
    while (*p) {
        char c = baseOf(nextCp(p));
        if (c == ' ') {
            if (!space) out += ' ';
            space = true;
        } else {
            out += c;
            space = false;
        }
    }
    out.trim();
    return out;
}

}  // namespace tg
