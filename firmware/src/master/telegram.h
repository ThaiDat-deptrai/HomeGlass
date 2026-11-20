// =============================================================
// TELEGRAM - bot báo tin + nhận lệnh, chạy ngay trên ESP trung tâm
// -------------------------------------------------------------
// - Chạy ở 1 LUỒNG RIÊNG (lõi 0): mạng Telegram chậm cũng không làm chậm
//   việc bật/tắt đèn, ESP-NOW, lịch hẹn (vòng lặp chính ở lõi 1).
// - Luồng Telegram chỉ lo nói chuyện với api.telegram.org (kiểm tra chứng chỉ
//   thật, xem ca_telegram.h). Hiểu lệnh, quyết định trả lời gì: vòng lặp chính
//   làm (main.cpp), qua 2 hàng đợi vào/ra.
// - Mã bot (token) + danh sách người được phép lưu trong flash (NVS "hgtg"),
//   KHÔNG bao giờ gửi lên MQTT, không nằm trong file cập nhật công khai.
// - Chỉ người đã "kết nối" (nhập mã 4 số từ app trong 5 phút) mới điều khiển được.
// =============================================================
#pragma once
#include <Arduino.h>

namespace tg {

static const uint8_t MAX_CHATS = 4;

// Loại cảnh báo (bật/tắt từng loại trong app)
enum Alert : uint32_t {
    AL_OFFLINE = 1,   // ESP mất kết nối / có lại
    AL_HOT = 2,       // chip quá nóng
    AL_ERROR = 4,     // lỗi: servo kẹt, sụt áp, khởi động lại bất thường...
    AL_OTA = 8,       // cập nhật firmware xong / lỗi
    AL_LIGHTS = 16,   // đèn bật quá lâu (số giờ đặt trong app)
};
static const uint32_t AL_DEFAULT = AL_OFFLINE | AL_HOT | AL_ERROR | AL_OTA;

/** Tin nhận được (đã qua luồng Telegram). */
struct In {
    int64_t chat = 0;
    String from;      // tên người gửi (để chào)
    String text;      // tin nhắn thường
    String cbId;      // bấm nút: mã để trả lời "đã nhận"
    String cbData;    // bấm nút: dữ liệu của nút
};

void begin();
bool configured();
String botName();                 // "@ten_bot" (sau khi kiểm tra mã)
String lastError();
bool online();                    // lần gọi Telegram gần nhất thành công

/** App gửi mã bot mới: luồng Telegram kiểm tra (getMe) rồi mới lưu. */
void setToken(const String &token);
void removeBot();

// ----- Người được phép -----
uint8_t chatCount();
bool allowed(int64_t chat);
bool addChat(int64_t chat);
void clearChats();

// ----- Ghép nối: app bấm "Kết nối điện thoại" -> mã 4 số, hiệu lực 5 phút -----
void startPairing();
String pairingCode();             // "" = không đang ghép
void stopPairing();

// ----- Cảnh báo -----
uint32_t alerts();
void setAlerts(uint32_t mask, uint8_t lightHours);
uint8_t lightHours();             // 0 = không nhắc đèn bật lâu

/** Lấy 1 tin đến (vòng lặp chính gọi). */
bool poll(In &out);

/** Gửi tin. chat = 0: gửi cho mọi người đã kết nối. markup: JSON nút bấm (inline_keyboard) hoặc "". */
void send(int64_t chat, const String &text, const String &markup = "");
/** Trả lời cú bấm nút (tắt vòng xoay trên nút, hiện chữ nhỏ). */
void answer(const String &cbId, const String &text);
/** Cảnh báo: chỉ gửi nếu loại này đang bật; cùng "key" không lặp lại trong 10 phút. */
void alert(Alert kind, const String &key, const String &text, const String &markup = "");

/** Tạm dừng (vd đang tải bản cập nhật firmware: nhường bộ nhớ). */
void pause(bool on);

/** Trạng thái thay đổi -> vòng lặp chính gửi lại hg/node/0/tg cho app. */
bool takeStatusChanged();

/** "tắt Đèn NGỦ" -> "tat den ngu" (bỏ dấu tiếng Việt, chữ thường, chỉ a-z 0-9 cách). */
String fold(const String &s);

}  // namespace tg
