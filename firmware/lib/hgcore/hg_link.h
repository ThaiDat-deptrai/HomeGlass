// =============================================================
// HG_LINK - đường truyền ESP-NOW an toàn giữa các ESP
// -------------------------------------------------------------
// - Ký mọi gói (HMAC-SHA256, 8 byte) bằng khóa chung: gói không đúng chữ ký -> vứt.
// - Chặn phát lại: nhớ số thứ tự gói gần đây của từng ESP + so giờ (±90 giây).
// - Gói gửi riêng (unicast) được ESP-NOW mã hóa; gói gửi chung (beacon/hello) chỉ ký.
// - Nhận gói trong "ngắt" WiFi -> đẩy vào hàng đợi, kiểm tra trong loop() (không nghẽn WiFi).
// =============================================================
#pragma once
#include <Arduino.h>
#include "hg_msgs.h"

namespace hg {

struct Packet {
    uint8_t mac[6];
    LinkHeader h;
    uint8_t data[HG_MAX_PAYLOAD];
};

class Link {
public:
    /** keyHex: 64 ký tự hex (HG_NET_KEY). WiFi phải bật (WIFI_STA) trước khi gọi. */
    bool begin(const char *keyHex, uint8_t selfId);
    void setSelfId(uint8_t id) { self_ = id; }

    /** mac = nullptr: gửi cho tất cả. to: số ESP nhận (HG_ANY_ID = tất cả). */
    bool send(const uint8_t *mac, uint8_t type, uint8_t to, const void *payload, size_t len);

    /** Lấy 1 gói đã kiểm tra chữ ký + chống phát lại. false = hết gói. */
    bool poll(Packet &out);

    /** Thêm ESP vào danh sách gửi riêng (có mã hóa nếu còn chỗ). */
    bool addPeer(const uint8_t mac[6]);

    /** Đổi kênh WiFi (ESP phòng dùng khi dò tìm trung tâm). */
    void setChannel(uint8_t ch);
    uint8_t channel() const;

    /** Giờ chuẩn (epoch giây). Trung tâm lấy từ Internet; ESP phòng lấy từ beacon. 0 = chưa có. */
    uint32_t now() const;
    void setTime(uint32_t epoch);

    // Thống kê gửi (để ESP phòng tự chỉnh công suất phát)
    uint32_t sentOk() const { return sentOk_; }
    uint32_t sentFail() const { return sentFail_; }
    uint32_t rejected() const { return rejected_; }  // gói sai chữ ký / phát lại
    bool encrypted() const { return encrypted_; }

    // Dùng nội bộ (callback ESP-NOW)
    void onRecvRaw(const uint8_t *mac, const uint8_t *data, int len);
    void onSent(bool ok) { ok ? sentOk_++ : sentFail_++; }

private:
    bool verify(const uint8_t *buf, size_t len, const uint8_t *tag) const;
    void sign(const uint8_t *buf, size_t len, uint8_t *tag) const;
    bool seenBefore(uint8_t from, uint32_t seq);

    uint8_t key_[32] = {0};
    uint8_t self_ = 0;
    uint32_t seq_ = 0;
    void *queue_ = nullptr;
    bool encrypted_ = true;
    volatile uint32_t sentOk_ = 0, sentFail_ = 0;
    uint32_t rejected_ = 0;
    uint32_t baseEpoch_ = 0, baseMs_ = 0;

    struct Recent { uint8_t id; bool used; uint8_t pos; uint32_t seqs[16]; };
    Recent recent_[24] = {};
};

extern Link net;

/** Đổi chuỗi hex 64 ký tự -> 32 byte. */
bool parseKey(const char *hex, uint8_t out[32]);

}  // namespace hg
