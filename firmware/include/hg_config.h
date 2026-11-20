// =============================================================
// HG_CONFIG - chân cắm + các mốc thời gian, dùng chung cho mọi ESP
// -------------------------------------------------------------
// "Kênh" trong app (1..16) = chân nào trên ESP:
//   Kênh 1..8  -> chân GPIO trực tiếp (bảng dưới, chọn cho GỌN DÂY)
//   Kênh 9..16 -> mạch mở rộng PCA9685 (cổng 0..7), nối qua I2C
// App hiện đúng bảng này trong "Phiếu đấu dây" (app/js/core/protocol.js).
// ĐỔI BẢNG NÀY THÌ PHẢI ĐỔI CẢ BÊN APP.
// =============================================================
#pragma once
#include <Arduino.h>

#define HG_FW_VERSION "0.2.1"

// Cập nhật qua mạng: ESP trung tâm CHỈ tải firmware từ địa chỉ bắt đầu bằng chuỗi này,
// và chỉ cài khi mã SHA-256 khớp với mã app gửi kèm (app đọc từ firmware/bin/manifest.json).
#define HG_OTA_URL_PREFIX "https://thaidat-deptrai.github.io/HomeGlass/firmware/bin/"

#if defined(CONFIG_IDF_TARGET_ESP32C3)
// ESP32-C3 super mini (cổng USB hướng lên, đọc từ trên xuống):
//   Cạnh có chân nguồn: 5V GND 3V3 [4] [3] (2) [1] [0]   <- kênh 1-4 (hợp cho servo: sát GND)
//   Cạnh còn lại:       [5] [6] [7] (8) (9) [10] 20 21    <- kênh 5-8; 20/21 = I2C (SDA/SCL)
//   (2), (8), (9) là chân khởi động -> KHÔNG dùng. 8 = đèn xanh trên mạch, 9 = nút BOOT.
static const int8_t HG_CH_PINS[8] = {4, 3, 1, 0, 5, 6, 7, 10};
#define HG_I2C_SDA 20
#define HG_I2C_SCL 21
#define HG_LED_PIN 8
#define HG_LED_ACTIVE_LOW 1
#define HG_LED_RGB 0
#define HG_BUTTON_PIN 9
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
// ESP32-S3 DevKitC-1 N16R8: 1 hàng chân liền nhau 4 5 6 7 15 16 17 18, I2C ngay sau (8, 9).
// Tránh 26-37 (bộ nhớ PSRAM/flash), 0/3/45/46 (chân khởi động), 19/20 (USB).
static const int8_t HG_CH_PINS[8] = {4, 5, 6, 7, 15, 16, 17, 18};
#define HG_I2C_SDA 8
#define HG_I2C_SCL 9
#define HG_LED_PIN 48          // đèn RGB trên mạch (bản v1.1 là chân 38: sửa ở đây nếu đèn không sáng)
#define HG_LED_ACTIVE_LOW 0
#define HG_LED_RGB 1
#define HG_BUTTON_PIN 0
#else
#error "Chỉ hỗ trợ ESP32-C3 (ESP phòng) và ESP32-S3 (ESP trung tâm)"
#endif

#define HG_MAX_DEVICES 16      // tối đa thiết bị trên 1 ESP
#define HG_PCA9685_ADDR 0x40

// ----- Mốc thời gian (ms) -----
static const uint32_t HG_BEACON_MS = 2000;        // trung tâm phát "tôi ở đây" + giờ chuẩn
static const uint32_t HG_HEARTBEAT_MS = 10000;    // ESP phòng báo sức khỏe (app coi mất kết nối sau 30 giây)
static const uint32_t HG_NODE_TIMEOUT_MS = 35000; // trung tâm coi ESP phòng mất kết nối
static const uint32_t HG_LINK_LOST_MS = 12000;    // ESP phòng không thấy trung tâm -> dò lại kênh WiFi
static const uint32_t HG_HEALTH_MS = 60000;       // gửi báo cáo sức khỏe lên app
static const uint32_t HG_FACTORY_HOLD_MS = 10000; // giữ nút BOOT 10 giây = xóa cấu hình

// ----- Nhiệt độ chip (°C) -----
static const float HG_TEMP_WARN = 70.0f;          // báo vàng trên app
static const float HG_TEMP_HOT = 80.0f;           // tự giảm công suất phát sóng để mát lại

// ----- Servo SG90 -----
static const uint16_t HG_SERVO_MIN_US = 500;      // xung ứng với 0°
static const uint16_t HG_SERVO_MAX_US = 2400;     // xung ứng với 180°
static const uint16_t HG_SERVO_MOVE_MS = 450;     // thời gian gạt tới góc BẬT/TẮT
static const uint16_t HG_SERVO_REST_MS = 350;     // thời gian về góc nghỉ rồi NGẮT xung (servo hết tốn điện, hết nóng)
