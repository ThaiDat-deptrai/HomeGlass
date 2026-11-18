#include "hg_outputs.h"

#include <Wire.h>
#include <esp_arduino_version.h>

namespace hg {

static const uint8_t LEDC_CH = 0;     // servo chạy lần lượt -> chỉ cần 1 kênh PWM
static const uint8_t LEDC_BITS = 14;  // 16384 bước / chu kỳ 20 ms

static int pinOf(uint8_t ch) {
    if (ch >= 1 && ch <= 8) return HG_CH_PINS[ch - 1];
    return -1;
}

String Outputs::pinName(uint8_t ch) {
    if (ch >= 1 && ch <= 8) return "GPIO" + String(HG_CH_PINS[ch - 1]);
    if (ch >= 9 && ch <= 16) return "PCA9685 cong " + String(ch - 9);
    return "?";
}

void Outputs::begin() {
    Wire.begin(HG_I2C_SDA, HG_I2C_SCL, 400000);
    Wire.beginTransmission(HG_PCA9685_ADDR);
    pca_ = Wire.endTransmission() == 0;
    if (pca_) pcaInit();
}

// ---------- PCA9685 (16 kênh PWM qua I2C, không cần thư viện) ----------
void Outputs::pcaInit() {
    auto reg = [](uint8_t r, uint8_t v) {
        Wire.beginTransmission(HG_PCA9685_ADDR);
        Wire.write(r);
        Wire.write(v);
        Wire.endTransmission();
    };
    reg(0x00, 0x10);           // MODE1: ngủ để đổi tần số
    reg(0xFE, 121);            // 25 MHz / (4096 * 50 Hz) - 1 = 121 -> 50 Hz cho servo
    reg(0x00, 0x20);           // thức dậy + tự tăng địa chỉ
    delayMicroseconds(600);
    reg(0x01, 0x04);           // MODE2: ngõ ra đẩy-kéo
    for (uint8_t p = 0; p < 16; p++) pcaSet(p, 0, 0x1000);  // tắt hết
}

void Outputs::pcaSet(uint8_t port, uint16_t on, uint16_t off) {
    Wire.beginTransmission(HG_PCA9685_ADDR);
    Wire.write(0x06 + 4 * port);
    Wire.write(on & 0xFF);
    Wire.write(on >> 8);
    Wire.write(off & 0xFF);
    Wire.write(off >> 8);
    Wire.endTransmission();
}

// ---------- Servo ----------
static uint16_t angleToUs(int angle) {
    angle = constrain(angle, 0, 180);
    return HG_SERVO_MIN_US + (uint32_t)(HG_SERVO_MAX_US - HG_SERVO_MIN_US) * angle / 180;
}

void Outputs::servoWrite(uint8_t ch, int angle) {
    uint16_t us = angleToUs(angle);
    int pin = pinOf(ch);
    if (pin >= 0) {
        uint32_t duty = (uint32_t)us * ((1u << LEDC_BITS) - 1) / 20000;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcAttach(pin, 50, LEDC_BITS);
        ledcWrite(pin, duty);
#else
        ledcSetup(LEDC_CH, 50, LEDC_BITS);
        ledcAttachPin(pin, LEDC_CH);
        ledcWrite(LEDC_CH, duty);
#endif
    } else if (pca_ && ch >= 9 && ch <= 16) {
        pcaSet(ch - 9, 0, (uint32_t)us * 4096 / 20000);
    }
}

void Outputs::servoStop(uint8_t ch) {
    int pin = pinOf(ch);
    if (pin >= 0) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcDetach(pin);
#else
        ledcDetachPin(pin);
#endif
        pinMode(pin, OUTPUT);
        digitalWrite(pin, LOW);  // ngắt xung: servo nghỉ hẳn
    } else if (pca_ && ch >= 9 && ch <= 16) {
        pcaSet(ch - 9, 0, 0x1000);
    }
}

// ---------- Relay ----------
void Outputs::relayWrite(uint8_t ch, bool on, bool activeLow) {
    bool level = on != activeLow;
    int pin = pinOf(ch);
    if (pin >= 0) {
        pinMode(pin, OUTPUT);
        digitalWrite(pin, level ? HIGH : LOW);
    } else if (pca_ && ch >= 9 && ch <= 16) {
        if (level) pcaSet(ch - 9, 0x1000, 0);  // luôn mức cao
        else pcaSet(ch - 9, 0, 0x1000);        // luôn mức thấp
    }
}

void Outputs::apply(const Table &t, uint16_t states) {
    // Dừng servo đang chạy dở (bảng đổi thì chỉ số cũ không còn ý nghĩa)
    if (moving_) servoStop(table_.e[cur_.idx].ch);
    moving_ = false;
    qLen_ = 0;

    table_ = t;
    if (table_.n > HG_MAX_DEVICES) table_.n = HG_MAX_DEVICES;
    states_ = states & ((1u << table_.n) - 1);

    for (uint8_t i = 0; i < table_.n; i++) {
        const Entry &e = table_.e[i];
        bool on = states_ & (1u << i);
        if (e.act == ACT_RELAY) relayWrite(e.ch, on, e.flags & FLAG_RELAY_LOW);
        else if (e.act == ACT_SERVO) servoStop(e.ch);  // servo: KHÔNG quay lúc khởi động, chỉ nhớ trạng thái
    }
}

uint8_t Outputs::set(uint8_t idx, bool on, uint32_t cmdId) {
    if (idx >= table_.n) return ACK_BAD_INDEX;
    const Entry &e = table_.e[idx];
    if (e.act == ACT_STAIRS) return ACK_UNSUPPORTED;
    if (e.ch < 1 || e.ch > 16 || (e.ch > 8 && !pca_)) return ACK_UNSUPPORTED;

    if (e.act == ACT_RELAY) {
        relayWrite(e.ch, on, e.flags & FLAG_RELAY_LOW);
        if (on) states_ |= (1u << idx); else states_ &= ~(1u << idx);
        if (done_) done_(idx, on, cmdId);
        return ACK_OK;
    }
    if (e.act != ACT_SERVO) return ACK_UNSUPPORTED;

    // Servo: đã có lệnh chờ cho cùng thiết bị -> lệnh mới thay lệnh cũ
    for (uint8_t i = 0; i < qLen_; i++) {
        if (queue_[i].idx == idx) {
            queue_[i] = {idx, on, cmdId};
            return ACK_OK;
        }
    }
    if (qLen_ >= HG_MAX_DEVICES) return ACK_UNSUPPORTED;
    queue_[qLen_++] = {idx, on, cmdId};
    return ACK_OK;
}

void Outputs::startJob(const Job &j) {
    cur_ = j;
    moving_ = true;
    phase_ = 1;
    phaseAt_ = millis();
    const Entry &e = table_.e[j.idx];
    servoWrite(e.ch, j.on ? e.on : e.off);
}

void Outputs::loop() {
    if (!moving_) {
        if (!qLen_) return;
        Job j = queue_[0];
        memmove(queue_, queue_ + 1, sizeof(Job) * (qLen_ - 1));
        qLen_--;
        startJob(j);
        return;
    }
    const Entry &e = table_.e[cur_.idx];
    uint32_t elapsed = millis() - phaseAt_;
    if (phase_ == 1 && elapsed >= HG_SERVO_MOVE_MS) {
        servoWrite(e.ch, e.rest);   // về góc nghỉ
        phase_ = 2;
        phaseAt_ = millis();
    } else if (phase_ == 2 && elapsed >= HG_SERVO_REST_MS) {
        servoStop(e.ch);
        moving_ = false;
        if (cur_.on) states_ |= (1u << cur_.idx); else states_ &= ~(1u << cur_.idx);
        if (done_) done_(cur_.idx, cur_.on, cur_.id);
    }
}

}  // namespace hg
