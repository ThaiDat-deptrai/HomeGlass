#include "hg_sys.h"

#include <esp_ota_ops.h>
#include <esp_system.h>
#include <esp_timer.h>
#include "hg_config.h"

namespace hg {

// ---------- Đèn ----------
void Led::begin() {
#if !HG_LED_RGB
    pinMode(HG_LED_PIN, OUTPUT);
#endif
    write(false);
}

void Led::write(bool on) {
    if (on == last_) return;
    last_ = on;
#if HG_LED_RGB
    neopixelWrite(HG_LED_PIN, on ? r_ : 0, on ? g_ : 0, on ? b_ : 0);
#else
    digitalWrite(HG_LED_PIN, (on != (bool)HG_LED_ACTIVE_LOW) ? HIGH : LOW);
#endif
}

void Led::count(uint8_t n) {
    countLeft_ = n;
    countAt_ = millis() + 400;
}

void Led::loop() {
    uint32_t now = millis();
    if (now < identifyUntil_) {
        write((now / 60) % 2);
        return;
    }
    if (countLeft_) {
        // Mỗi lần nháy: 250 ms sáng, 350 ms tắt
        if (now < countAt_) { write(false); return; }
        uint32_t t = now - countAt_;
        if (t < 250) { write(true); return; }
        if (t < 600) { write(false); return; }
        countLeft_--;
        countAt_ = now;
        return;
    }
    uint32_t t = now - since_;
    switch (pattern_) {
        case LED_OFF: write(false); break;
        case LED_SOLID: write(true); break;
        case LED_SEARCH: write((t / 150) % 2); break;
        case LED_OK: write(t % 3000 < 60); break;
        case LED_ERROR: { uint32_t p = t % 1500; write(p < 120 || (p > 300 && p < 420)); break; }
        default: write(false);
    }
    // Đèn RGB: đổi màu khi đang sáng thì phải ghi lại
#if HG_LED_RGB
    if (last_) neopixelWrite(HG_LED_PIN, r_, g_, b_);
#endif
}

// ---------- Nút BOOT ----------
void Button::begin() { pinMode(HG_BUTTON_PIN, INPUT_PULLUP); }

ButtonEvent Button::loop() {
    bool down = digitalRead(HG_BUTTON_PIN) == LOW;
    uint32_t now = millis();
    if (down && !downAt_) {
        downAt_ = now;
        longFired_ = false;
    }
    if (down && !longFired_ && now - downAt_ >= HG_FACTORY_HOLD_MS) {
        longFired_ = true;
        return BTN_LONG;
    }
    if (!down && downAt_) {
        uint32_t held = now - downAt_;
        downAt_ = 0;
        if (!longFired_ && held > 40 && held < 1500) return BTN_SHORT;
    }
    return BTN_NONE;
}

// ---------- Nhiệt độ ----------
float chipTemp() {
    static float smooth = NAN;
    static uint32_t lastRead = 0;
    if (millis() - lastRead >= 1000 || isnan(smooth)) {
        lastRead = millis();
        float t = temperatureRead();
        if (!isnan(t) && t > -40 && t < 150) smooth = isnan(smooth) ? t : smooth * 0.8f + t * 0.2f;
    }
    return isnan(smooth) ? 0 : smooth;
}

// ---------- Lý do khởi động lại (gửi lên app để biết ESP có bị lỗi không) ----------
uint8_t resetCode() { return (uint8_t)esp_reset_reason(); }

const char *resetText(uint8_t code) {
    switch ((esp_reset_reason_t)code) {
        case ESP_RST_POWERON: return "POWERON";     // mới cấp điện
        case ESP_RST_SW: return "SW";               // tự khởi động lại (cập nhật, lệnh từ app)
        case ESP_RST_PANIC: return "PANIC";         // lỗi phần mềm
        case ESP_RST_INT_WDT:
        case ESP_RST_TASK_WDT:
        case ESP_RST_WDT: return "WATCHDOG";        // bị treo -> chó canh tự khởi động lại
        case ESP_RST_BROWNOUT: return "BROWNOUT";   // SỤT ÁP: kiểm tra nguồn (servo kéo dòng?)
        case ESP_RST_DEEPSLEEP: return "SLEEP";
        case ESP_RST_EXT: return "EXT";
        default: return "OTHER";
    }
}

uint32_t uptimeSec() { return (uint32_t)(esp_timer_get_time() / 1000000ULL); }

// ---------- Bản mới sau khi cập nhật: chạy thử rồi mới "chốt" ----------
static int8_t pendingCache = -1;  // đọc flash 1 lần, các lần sau dùng lại

bool otaPendingVerify() {
    if (pendingCache < 0) {
        esp_ota_img_states_t st;
        const esp_partition_t *running = esp_ota_get_running_partition();
        pendingCache = running && esp_ota_get_state_partition(running, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY;
    }
    return pendingCache == 1;
}

void otaMarkValid() {
    if (!otaPendingVerify()) return;
    if (esp_ota_mark_app_valid_cancel_rollback() == ESP_OK) pendingCache = 0;
}

void otaRollback() {
    // Bản mới chạy không ổn: đánh dấu hỏng + khởi động lại -> bootloader chạy lại bản cũ
    if (otaPendingVerify()) esp_ota_mark_app_invalid_rollback_and_reboot();
    esp_restart();
}

}  // namespace hg

// Arduino gọi hàm này lúc khởi động. Trả về true = "để code tự chốt bản mới sau khi chạy ổn",
// thay vì chốt ngay. Bản mới lỗi (treo, không kết nối được) -> khởi động lại là về bản cũ.
extern "C" bool verifyRollbackLater() { return true; }
