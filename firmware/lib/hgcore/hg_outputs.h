// =============================================================
// HG_OUTPUTS - điều khiển servo SG90 và relay theo BẢNG KÊNH
// -------------------------------------------------------------
// - Bảng kênh do app gửi xuống (qua ESP trung tâm), lưu trong flash: thêm đèn
//   = sửa trong app, KHÔNG sửa code.
// - Servo chạy LẦN LƯỢT từng cái (hàng đợi): nhiều servo quay cùng lúc dễ sụt
//   áp làm ESP khởi động lại. Quay xong về góc nghỉ rồi NGẮT xung -> servo
//   không ghì, không nóng, tay người vẫn gạt công tắc được.
// - Relay: đặt mức chân ngay; hỗ trợ module kích mức thấp (LOW = bật).
// - Kênh 9..16: qua mạch PCA9685 (I2C), tự nhận nếu có cắm.
// =============================================================
#pragma once
#include <Arduino.h>
#include "hg_msgs.h"

namespace hg {

/** Gọi khi 1 thiết bị đã bật/tắt XONG (servo đã gạt, relay đã đóng). */
typedef void (*DoneFn)(uint8_t idx, bool on, uint32_t cmdId);

class Outputs {
public:
    void begin();
    /** Áp bảng kênh mới. states: trạng thái cần giữ (bit i = thiết bị i bật) - relay được đặt lại ngay. */
    void apply(const Table &t, uint16_t states);
    /** Ra lệnh bật/tắt. Trả về AckResult. */
    uint8_t set(uint8_t idx, bool on, uint32_t cmdId);
    void loop();
    void onDone(DoneFn fn) { done_ = fn; }

    const Table &table() const { return table_; }
    uint16_t states() const { return states_; }
    bool busy() const { return moving_ || qLen_ > 0; }
    bool hasPca() const { return pca_; }

    /** Kênh 1..16 -> mô tả chân (để in log / phiếu đấu dây). */
    static String pinName(uint8_t ch);

private:
    struct Job { uint8_t idx; bool on; uint32_t id; };
    void startJob(const Job &j);
    void servoWrite(uint8_t ch, int angle);
    void servoStop(uint8_t ch);
    void relayWrite(uint8_t ch, bool on, bool activeLow);
    void pcaInit();
    void pcaSet(uint8_t port, uint16_t on, uint16_t off);

    Table table_ = {};
    uint16_t states_ = 0;
    bool pca_ = false;
    DoneFn done_ = nullptr;

    Job queue_[HG_MAX_DEVICES];
    uint8_t qLen_ = 0;
    bool moving_ = false;
    Job cur_ = {};
    uint8_t phase_ = 0;     // 1 = đang gạt, 2 = đang về nghỉ
    uint32_t phaseAt_ = 0;
};

}  // namespace hg
