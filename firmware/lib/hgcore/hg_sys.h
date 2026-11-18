// =============================================================
// HG_SYS - đèn báo, nút BOOT, nhiệt độ chip, lý do khởi động lại
// -------------------------------------------------------------
// Đèn trên mạch cho biết ESP đang thế nào mà KHÔNG cần cắm máy tính:
//   nháy nhanh liên tục   = đang tìm WiFi / ESP trung tâm
//   chớp ngắn mỗi 3 giây  = mọi thứ ổn
//   sáng đứng             = chưa đặt số ESP (cắm USB, mở Serial Monitor)
//   chớp 2 cái liên tục   = lỗi (sai khóa mạng, sai mật khẩu...)
//   nháy rất nhanh 10 giây = app bấm "Tìm ESP này"
// Nút BOOT: bấm nhanh = nháy số ESP (3 cái = ESP 3), giữ 10 giây = xóa cấu hình.
// =============================================================
#pragma once
#include <Arduino.h>

namespace hg {

enum LedPattern : uint8_t { LED_OFF, LED_SOLID, LED_SEARCH, LED_OK, LED_ERROR, LED_IDENTIFY, LED_COUNT };

class Led {
public:
    void begin();
    void set(LedPattern p) { if (p != pattern_) { pattern_ = p; since_ = millis(); } }
    /** Nháy đúng n lần (để biết số ESP) rồi quay lại kiểu cũ. */
    void count(uint8_t n);
    /** Nháy rất nhanh trong 10 giây (app bấm "Tìm ESP này"). */
    void identify() { identifyUntil_ = millis() + 10000; }
    /** Màu cho đèn RGB (chỉ ESP trung tâm). */
    void color(uint8_t r, uint8_t g, uint8_t b) { r_ = r; g_ = g; b_ = b; }
    void loop();

private:
    void write(bool on);
    LedPattern pattern_ = LED_SEARCH;
    uint32_t since_ = 0;
    uint32_t identifyUntil_ = 0;
    uint8_t countLeft_ = 0;
    uint32_t countAt_ = 0;
    uint8_t r_ = 0, g_ = 0, b_ = 40;
    bool last_ = false;
};

enum ButtonEvent : uint8_t { BTN_NONE, BTN_SHORT, BTN_LONG };

class Button {
public:
    void begin();
    ButtonEvent loop();
    /** Đang giữ nút bao lâu (ms), 0 = không giữ. */
    uint32_t heldMs() const { return downAt_ ? millis() - downAt_ : 0; }

private:
    uint32_t downAt_ = 0;
    bool longFired_ = false;
};

/** Nhiệt độ chip đã làm mượt (°C). Gọi thường xuyên (mỗi giây). */
float chipTemp();
uint8_t resetCode();
const char *resetText(uint8_t code);
uint32_t uptimeSec();

}  // namespace hg
