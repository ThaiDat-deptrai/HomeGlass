// =============================================================
// HG_SECRETS - mật khẩu WiFi, tài khoản MQTT, khóa mạng ESP-NOW
// -------------------------------------------------------------
// Các "bí mật" KHÔNG nằm trong file firmware dùng để cập nhật qua mạng
// (file đó để công khai trên GitHub). Chúng nằm trong FLASH của từng ESP:
//   - Nạp qua USB (có firmware/include/secrets.h): lúc khởi động tự chép
//     secrets.h vào flash (chỉ ghi khi khác, đỡ mòn flash).
//   - Cập nhật qua mạng (bản công khai, build với HG_PUBLIC_BUILD):
//     không có secrets.h -> đọc lại từ flash, giữ nguyên như cũ.
// => Đổi mật khẩu WiFi: sửa secrets.h rồi nạp USB 1 lần.
// =============================================================
#pragma once
#include <Arduino.h>

namespace hg {

struct Secrets {
    String wifiSsid, wifiPass, wifiSsid2, wifiPass2;
    String mqttHost, mqttUser, mqttPass;
    uint16_t mqttPort = 8883;
    String netKey;  // 64 ký tự hex
};

/** Đọc bí mật từ flash (bản nạp USB thì cập nhật flash từ secrets.h trước). false = thiếu khóa mạng. */
bool loadSecrets(Secrets &out);

/** true nếu bản firmware này có secrets.h bên trong (bản nạp USB). */
bool secretsBuiltIn();

}  // namespace hg
