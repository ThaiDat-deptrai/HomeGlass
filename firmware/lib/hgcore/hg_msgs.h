// =============================================================
// HG_MSGS - các gói tin ESP-NOW giữa ESP trung tâm và ESP phòng
// -------------------------------------------------------------
// Mỗi gói: [đầu gói 14 byte][nội dung][chữ ký 8 byte]
// Chữ ký = HMAC-SHA256 bằng khóa chung HG_NET_KEY -> ESP lạ / kẻ gian
// không giả được lệnh. Có số thứ tự + giờ để chặn "phát lại" gói cũ.
// Gói gửi riêng (unicast) còn được MÃ HÓA bằng khóa ESP-NOW.
// ĐỔI CẤU TRÚC Ở ĐÂY = phải nạp lại cả trung tâm lẫn ESP phòng (tăng HG_LINK_VER).
// =============================================================
#pragma once
#include <Arduino.h>
#include "hg_config.h"

namespace hg {

static const uint8_t HG_LINK_MAGIC = 0xA7;
static const uint8_t HG_LINK_VER = 1;
static const uint8_t HG_MASTER_ID = 0;
static const uint8_t HG_ANY_ID = 0xFF;        // gửi cho tất cả (beacon, hello)

enum MsgType : uint8_t {
    MSG_BEACON = 1,     // trung tâm -> tất cả: "tôi ở đây", kênh WiFi, giờ chuẩn
    MSG_HELLO = 2,      // ESP phòng -> tất cả: "tôi vừa vào mạng"
    MSG_CONFIG = 3,     // trung tâm -> ESP phòng: bảng kênh
    MSG_CMD = 4,        // trung tâm -> ESP phòng: bật / tắt 1 thiết bị
    MSG_ACK = 5,        // ESP phòng -> trung tâm: đã nhận lệnh
    MSG_STATE = 6,      // ESP phòng -> trung tâm: thiết bị đã BẬT/TẮT xong
    MSG_HEARTBEAT = 7,  // ESP phòng -> trung tâm: sức khỏe + trạng thái mọi kênh
    MSG_NODECMD = 8,    // trung tâm -> ESP phòng: khởi động lại, nháy đèn, xóa cấu hình
    MSG_LOG = 9,        // ESP phòng -> trung tâm: báo lỗi (hiện trong Nhật ký lỗi của app)
    // 20..29: dành cho cập nhật firmware qua mạng (OTA) - bước sau
};

enum Act : uint8_t { ACT_NONE = 0, ACT_SERVO = 1, ACT_RELAY = 2, ACT_STAIRS = 3 };
static const uint8_t FLAG_RELAY_LOW = 0x01;   // relay kích mức THẤP (LOW = bật)

enum AckResult : uint8_t {
    ACK_OK = 0,
    ACK_BAD_INDEX = 1,
    ACK_UNSUPPORTED = 2,  // vd: cầu thang chưa có ở bản firmware này
    ACK_STALE_CONFIG = 3, // bảng kênh 2 bên không khớp -> trung tâm gửi lại bảng rồi thử lại
};

enum NodeCmd : uint8_t { NCMD_REBOOT = 1, NCMD_IDENTIFY = 2, NCMD_FACTORY = 3, NCMD_RESYNC = 4 };

#pragma pack(push, 1)
struct LinkHeader {
    uint8_t magic, ver, type, from, to, len;
    uint32_t seq;   // tăng dần, bắt đầu ngẫu nhiên mỗi lần khởi động
    uint32_t time;  // giờ chuẩn (epoch giây), 0 = chưa có giờ
};

struct Entry {          // 1 dòng bảng kênh
    uint8_t ch;         // kênh 1..16 (cầu thang: 0)
    uint8_t act;        // Act
    uint8_t on, off, rest;  // góc servo (độ)
    uint8_t flags;      // FLAG_*
};

struct Table {
    uint32_t rev;       // = CRC32 của các dòng: 2 bên so khớp bảng bằng số này
    uint8_t n;
    Entry e[HG_MAX_DEVICES];
};

struct MsgBeacon { uint8_t wifiCh; uint8_t flags; char fw[12]; };
struct MsgHello { char fw[12]; uint32_t cfgRev; uint32_t uptime; uint8_t reset; };
struct MsgCmd { uint32_t id; uint32_t rev; uint8_t idx; uint8_t on; };
struct MsgAck { uint32_t id; uint8_t idx; uint8_t result; };
struct MsgState { uint32_t id; uint32_t rev; uint8_t idx; uint8_t on; };
struct MsgHeartbeat {
    uint32_t cfgRev;
    uint32_t uptime;    // giây
    int16_t temp10;     // nhiệt độ chip x10
    uint8_t reset;      // lý do khởi động lại lần trước
    int8_t txDbm;       // công suất phát hiện tại
    uint32_t heap;
    uint16_t states;    // bit i = thiết bị thứ i đang bật
    uint8_t linkPct;    // % beacon nhận được trong 30 giây qua (chất lượng sóng)
    uint8_t flags;      // bit0: có PCA9685, bit1: đang quá nóng
    char fw[12];
};
struct MsgNodeCmd { uint8_t cmd; uint8_t arg; };
struct MsgLog { char text[180]; };
#pragma pack(pop)

static const size_t HG_TAG_LEN = 8;
static const size_t HG_MAX_PAYLOAD = 250 - sizeof(LinkHeader) - HG_TAG_LEN;
static_assert(sizeof(Table) <= HG_MAX_PAYLOAD, "Bảng kênh quá lớn cho 1 gói ESP-NOW");
static_assert(sizeof(MsgLog) <= HG_MAX_PAYLOAD, "Gói log quá lớn");

/** CRC32 bảng kênh (chỉ tính các dòng đang dùng). */
uint32_t tableCrc(const Table &t);

}  // namespace hg
