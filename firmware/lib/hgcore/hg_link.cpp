#include "hg_link.h"

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <mbedtls/md.h>
#include <time.h>

namespace hg {

Link net;

static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static const uint32_t VALID_EPOCH = 1700000000UL;  // trước 11/2023 = chưa có giờ thật
static const uint32_t TIME_WINDOW_S = 90;

struct RawPacket {
    uint8_t mac[6];
    uint8_t len;
    uint8_t buf[250];
};

// ---------- Callback của ESP-NOW (chạy trong tác vụ WiFi: chỉ copy rồi đi) ----------
#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void recvCb(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
    net.onRecvRaw(info->src_addr, data, len);
}
static void sentCb(const wifi_tx_info_t *, esp_now_send_status_t status) {
    net.onSent(status == ESP_NOW_SEND_SUCCESS);
}
#else
static void recvCb(const uint8_t *mac, const uint8_t *data, int len) { net.onRecvRaw(mac, data, len); }
static void sentCb(const uint8_t *, esp_now_send_status_t status) { net.onSent(status == ESP_NOW_SEND_SUCCESS); }
#endif

bool parseKey(const char *hex, uint8_t out[32]) {
    if (!hex || strlen(hex) != 64) return false;
    for (int i = 0; i < 32; i++) {
        char pair[3] = {hex[i * 2], hex[i * 2 + 1], 0};
        char *end = nullptr;
        long v = strtol(pair, &end, 16);
        if (*end != 0) return false;
        out[i] = (uint8_t)v;
    }
    // Khóa toàn số 0 = chưa đổi khóa mẫu -> từ chối cho an toàn
    for (int i = 0; i < 32; i++) if (out[i]) return true;
    return false;
}

uint32_t tableCrc(const Table &t) {
    // CRC32 chuẩn (đa thức 0xEDB88320), đủ để 2 bên biết bảng có khớp không
    uint32_t crc = 0xFFFFFFFF;
    const uint8_t *p = reinterpret_cast<const uint8_t *>(t.e);
    size_t n = (size_t)min<uint8_t>(t.n, HG_MAX_DEVICES) * sizeof(Entry);
    for (size_t i = 0; i < n; i++) {
        crc ^= p[i];
        for (int b = 0; b < 8; b++) crc = (crc >> 1) ^ (0xEDB88320 & (-(int32_t)(crc & 1)));
    }
    crc ^= t.n * 0x9E3779B1u;  // khác số dòng -> khác CRC (cả khi bảng rỗng)
    return ~crc;
}

bool Link::begin(const char *keyHex, uint8_t selfId) {
    self_ = selfId;
    if (!parseKey(keyHex, key_)) return false;
    seq_ = esp_random();
    if (!queue_) queue_ = xQueueCreate(24, sizeof(RawPacket));

    if (esp_now_init() != ESP_OK) return false;
    esp_now_register_recv_cb(recvCb);
    esp_now_register_send_cb(sentCb);
    // Khóa mã hóa chung (PMK) = 16 byte đầu của khóa mạng
    esp_now_set_pmk(key_);

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, BROADCAST_MAC, 6);
    peer.channel = 0;          // 0 = kênh hiện tại
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;      // gửi chung không mã hóa được, nhưng vẫn có chữ ký
    if (!esp_now_is_peer_exist(BROADCAST_MAC)) esp_now_add_peer(&peer);
    return true;
}

bool Link::addPeer(const uint8_t mac[6]) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = 0;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = true;
    memcpy(peer.lmk, key_ + 16, 16);  // khóa riêng (LMK) = 16 byte sau của khóa mạng
    esp_err_t err = esp_now_is_peer_exist(mac) ? esp_now_mod_peer(&peer) : esp_now_add_peer(&peer);
    if (err == ESP_OK) return true;
    // Hết chỗ mã hóa (giới hạn ~7 ESP): vẫn chạy, gói vẫn có chữ ký chống giả mạo
    peer.encrypt = false;
    encrypted_ = false;
    err = esp_now_is_peer_exist(mac) ? esp_now_mod_peer(&peer) : esp_now_add_peer(&peer);
    return err == ESP_OK;
}

void Link::setChannel(uint8_t ch) {
    if (ch < 1 || ch > 13) return;
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
}

uint8_t Link::channel() const {
    uint8_t primary = 1;
    wifi_second_chan_t second;
    esp_wifi_get_channel(&primary, &second);
    return primary;
}

uint32_t Link::now() const {
    if (self_ == HG_MASTER_ID) {
        time_t t = time(nullptr);
        return (uint32_t)t >= VALID_EPOCH ? (uint32_t)t : 0;
    }
    if (!baseEpoch_) return 0;
    return baseEpoch_ + (millis() - baseMs_) / 1000;
}

void Link::setTime(uint32_t epoch) {
    if (epoch < VALID_EPOCH) return;
    baseEpoch_ = epoch;
    baseMs_ = millis();
}

void Link::sign(const uint8_t *buf, size_t len, uint8_t *tag) const {
    uint8_t full[32];
    mbedtls_md_context_t ctx;
    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
    mbedtls_md_hmac_starts(&ctx, key_, sizeof(key_));
    mbedtls_md_hmac_update(&ctx, buf, len);
    mbedtls_md_hmac_finish(&ctx, full);
    mbedtls_md_free(&ctx);
    memcpy(tag, full, HG_TAG_LEN);
}

bool Link::verify(const uint8_t *buf, size_t len, const uint8_t *tag) const {
    uint8_t expect[HG_TAG_LEN];
    sign(buf, len, expect);
    uint8_t diff = 0;  // so sánh không lộ thời gian
    for (size_t i = 0; i < HG_TAG_LEN; i++) diff |= expect[i] ^ tag[i];
    return diff == 0;
}

bool Link::send(const uint8_t *mac, uint8_t type, uint8_t to, const void *payload, size_t len) {
    if (len > HG_MAX_PAYLOAD) return false;
    uint8_t buf[250];
    LinkHeader h;
    h.magic = HG_LINK_MAGIC;
    h.ver = HG_LINK_VER;
    h.type = type;
    h.from = self_;
    h.to = to;
    h.len = (uint8_t)len;
    h.seq = ++seq_;
    h.time = now();
    memcpy(buf, &h, sizeof(h));
    if (len) memcpy(buf + sizeof(h), payload, len);
    size_t body = sizeof(h) + len;
    sign(buf, body, buf + body);
    return esp_now_send(mac ? mac : BROADCAST_MAC, buf, body + HG_TAG_LEN) == ESP_OK;
}

void Link::onRecvRaw(const uint8_t *mac, const uint8_t *data, int len) {
    if (!queue_ || len < (int)(sizeof(LinkHeader) + HG_TAG_LEN) || len > 250) return;
    RawPacket raw;
    memcpy(raw.mac, mac, 6);
    raw.len = (uint8_t)len;
    memcpy(raw.buf, data, len);
    xQueueSend((QueueHandle_t)queue_, &raw, 0);  // đầy thì bỏ (không bao giờ chặn WiFi)
}

bool Link::seenBefore(uint8_t from, uint32_t seq) {
    Recent *slot = nullptr;
    for (auto &r : recent_) {
        if (r.used && r.id == from) { slot = &r; break; }
    }
    if (!slot) {
        for (auto &r : recent_) if (!r.used) { slot = &r; break; }
        if (!slot) slot = &recent_[esp_random() % 24];
        *slot = Recent{from, true, 0, {}};
    }
    for (uint32_t s : slot->seqs) if (s == seq && s != 0) return true;
    slot->seqs[slot->pos] = seq;
    slot->pos = (slot->pos + 1) % 16;
    return false;
}

bool Link::poll(Packet &out) {
    RawPacket raw;
    while (queue_ && xQueueReceive((QueueHandle_t)queue_, &raw, 0) == pdTRUE) {
        LinkHeader h;
        memcpy(&h, raw.buf, sizeof(h));
        size_t body = sizeof(h) + h.len;
        bool ok = h.magic == HG_LINK_MAGIC && h.ver == HG_LINK_VER
            && body + HG_TAG_LEN == raw.len
            && (h.to == self_ || h.to == HG_ANY_ID)
            && h.from != self_
            && verify(raw.buf, body, raw.buf + body);
        if (ok) {
            // Chống phát lại gói cũ: lệch giờ quá xa (khi 2 bên đều có giờ) hoặc trùng số thứ tự
            uint32_t mine = now();
            if (h.time && mine && h.type != MSG_BEACON) {
                uint32_t diff = h.time > mine ? h.time - mine : mine - h.time;
                if (diff > TIME_WINDOW_S) ok = false;
            }
            if (ok && seenBefore(h.from, h.seq)) ok = false;
        }
        if (!ok) {
            rejected_++;
            continue;
        }
        memcpy(out.mac, raw.mac, 6);
        out.h = h;
        memcpy(out.data, raw.buf + sizeof(h), h.len);
        return true;
    }
    return false;
}

}  // namespace hg
