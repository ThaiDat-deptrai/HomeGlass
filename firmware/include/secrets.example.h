// =============================================================
// MẪU FILE BÍ MẬT - chép file này thành "secrets.h" (cùng thư mục) rồi điền.
// secrets.h đã bị .gitignore chặn: KHÔNG BAO GIỜ lên GitHub.
// Mọi ESP (trung tâm + phòng) dùng CHUNG 1 file secrets.h.
// =============================================================
#pragma once

// ----- WiFi nhà (chỉ ESP trung tâm dùng) -----
#define HG_WIFI_SSID "TEN_WIFI"
#define HG_WIFI_PASS "MAT_KHAU_WIFI"
// WiFi dự phòng (vd: WiFi tầng 2 / điểm phát điện thoại). Bỏ trống "" nếu không có.
#define HG_WIFI_SSID2 ""
#define HG_WIFI_PASS2 ""

// ----- Máy chủ MQTT (HiveMQ) - chỉ ESP trung tâm dùng -----
#define HG_MQTT_HOST "130d14182c00498e952cad93f9325420.s1.eu.hivemq.cloud"
#define HG_MQTT_PORT 8883
#define HG_MQTT_USER "esp-gia-lap"
#define HG_MQTT_PASS "MAT_KHAU_MQTT"

// ----- Khóa mạng nội bộ ESP-NOW (ký + mã hóa lệnh giữa các ESP) -----
// 64 ký tự hex. TẤT CẢ ESP phải giống hệt nhau. Lộ khóa này = tạo khóa mới rồi nạp lại mọi ESP.
// Tạo khóa mới (PowerShell): -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
#define HG_NET_KEY "0000000000000000000000000000000000000000000000000000000000000000"
