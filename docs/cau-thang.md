# 🪜 Đèn cầu thang thông minh

Mỗi bậc cầu thang có 1 dải LED đơn sắc. ESP32-C3 điều khiển từng bậc sáng lần lượt, tự bật khi có người, tự tắt, có chế độ ban đêm.

## 🧩 Linh kiện

| Linh kiện | Số lượng | Vai trò |
|---|---|---|
| ESP32-C3 Super Mini | 1 | Bộ não của cầu thang (ESP số 6 trong app) |
| Mạch mở rộng I2C: **PCA9685** (khuyên dùng) hoặc **MCP23017** | 1 (≤ 16 bậc) | 16 ngõ ra điều khiển 16 bậc, chỉ tốn 2 chân ESP |
| Module MOSFET D4184 | **1 cái mỗi bậc** | Đóng/ngắt (và chỉnh sáng) dải LED của bậc đó |
| LED dây đơn sắc 12V | đủ cho mỗi bậc | Ánh sáng |
| Nguồn tổ ong 12V | 1 | Nguồn cho LED |
| Mạch hạ áp 12V → 5V (buck) | 1 | Nguồn cho ESP + mạch mở rộng |
| Cảm biến chuyển động (PIR hoặc radar) | 2 (tùy chọn) | Đặt ở chân và đầu cầu thang |

### PCA9685 hay MCP23017?

| | MCP23017 (bạn đang có) | PCA9685 (khuyên dùng) |
|---|---|---|
| Mỗi bậc | Chỉ **bật / tắt** | **Chỉnh sáng 0–100%** (PWM) |
| Hiệu ứng chạy lên/xuống/từ giữa | ✅ | ✅ (mượt hơn, mờ dần từng bậc) |
| Cảm biến, hẹn giờ, đèn dẫn đường | ✅ | ✅ |
| Chỉnh độ sáng, hiệu ứng thở | ❌ | ✅ |
| Ban đêm sáng dịu, đèn nền buổi tối | ❌ | ✅ |
| Cách nối | I2C (SDA, SCL) | I2C (SDA, SCL), **giống hệt** |

Đổi loại mạch trong app: **Cài đặt → Phòng & thiết bị → Đèn cầu thang → Mạch điều khiển**. App tự ẩn/hiện các tính năng cho đúng loại mạch.

## 🔌 Sơ đồ đấu dây

```
 Nguồn tổ ong 12V
  (+12V) ──────────┬──────────────┬───── ... ──┐
                   │              │            │
               LED bậc 1      LED bậc 2     LED bậc N         (dây + của LED)
                   │              │            │              (dây − của LED ↓)
               D4184 #1       D4184 #2      D4184 #N          ← chân PWM/TRIG nối mạch mở rộng
                   │              │            │                 (kênh 0, 1, ... N-1)
  (GND)  ──────────┴──────────────┴──── ... ───┴──── GND CHUNG (nguồn 12V, ESP, mạch mở rộng)

 ESP32-C3                  PCA9685 / MCP23017
  5V (từ buck) ──────────   (PCA9685: chân V+ nếu cần)
  3V3  ──────────────────   VCC
  GND  ──────────────────   GND   (MCP23017: thêm A0, A1, A2 → GND, RESET → 3V3)
  GPIO 6 (SDA) ──────────   SDA   (điện trở kéo lên 4.7kΩ nếu module chưa có)
  GPIO 7 (SCL) ──────────   SCL
  GPIO 3  ───────────────   Cảm biến chân cầu thang (OUT)
  GPIO 4  ───────────────   Cảm biến đầu cầu thang (OUT)
```

- Mỗi module D4184: **DC+/DC−** nối nguồn 12V, **OUT+/OUT−** nối dải LED, **PWM/TRIG + GND** nối kênh của mạch mở rộng và GND chung.
- Chân GPIO trên là **đề xuất** (tránh các chân khởi động 2, 8, 9 của ESP32-C3). Sẽ chốt khi viết firmware.
- **Bắt buộc nối GND chung** giữa nguồn 12V, ESP và mạch mở rộng.
- Trên 16 bậc: thêm 1 mạch mở rộng nữa, đổi địa chỉ I2C (hàn cầu A0).

## ⚡ Chọn nguồn

```
Công suất cần = số bậc × chiều dài LED mỗi bậc (m) × công suất LED (W/m, ghi trên cuộn LED)
Nguồn tổ ong  ≥ Công suất cần × 1.3   (chừa 30% cho nguồn mát, bền)
```

Ví dụ: 15 bậc × 0,8 m × 5 W/m = 60 W → chọn nguồn **12V ≥ 80W (khoảng 7A)**.

> ⚠️ Nguồn tổ ong có **cọc 220V để hở**. Phải đặt trong hộp kín, có cầu chì, nối đất nếu có. Phần đấu điện 220V nên nhờ người lớn hoặc thợ điện làm cùng.

## 🧠 Cách hoạt động (logic chạy trên ESP cầu thang)

| Tính năng | Cách chạy |
|---|---|
| **Bật / tắt** | Các bậc sáng lần lượt theo hiệu ứng, cách nhau "tốc độ" ms |
| **Hiệu ứng** | Theo hướng đi · Chạy lên · Chạy xuống · Từ giữa ra · Cùng lúc · Thở (cần PCA9685) |
| **Độ sáng** | PCA9685 chỉnh PWM từng bậc. MCP23017 luôn sáng hết cỡ |
| **Tự bật khi có người** | Cảm biến dưới báo → sáng từ dưới lên; cảm biến trên báo → sáng từ trên xuống. Hết người X giây → tắt theo cùng hướng |
| **Hẹn giờ tắt** | Bật bằng tay (app/kịch bản) → tự tắt sau N phút |
| **Ban đêm** | Trong khung giờ (vd 22:00–06:00): bật sáng dịu (PCA9685) và bậc đầu, bậc cuối, cứ 3 bậc 1 bậc luôn sáng làm đèn dẫn đường |
| **Đèn nền buổi tối** | Từ lúc mặt trời lặn đến giờ cài đặt: cả cầu thang sáng rất mờ (cần PCA9685) |

Mọi cài đặt được app gửi xuống và **lưu trong ESP**: tắt điện thoại, mất Internet, cầu thang vẫn chạy đúng.

## 🕒 ESP lấy giờ ở đâu?

- **ESP trung tâm (ESP32-S3)** vào WiFi nhà → lấy giờ chuẩn từ Internet (máy chủ thời gian **NTP**, múi giờ **GMT+7**) lúc khởi động và định kỳ.
- **ESP cầu thang** không cần vào Internet: ESP trung tâm **gửi giờ xuống qua ESP-NOW mỗi phút**.
- **Giờ mặt trời lặn**: ESP tự tính từ ngày tháng + toạ độ nhà (công thức thiên văn, không cần mạng). Thêm `"location": { "lat": ..., "lon": ... }` vào `config/home.json` để chính xác hơn.
- **Mất Internet**: ESP vẫn chạy giờ bằng đồng hồ bên trong (lệch vài giây mỗi ngày). Nếu **vừa mất điện vừa mất mạng**, ESP chưa biết giờ cho tới khi có mạng → muốn chắc chắn thì gắn thêm module **RTC DS3231** (có pin nuôi).
- Đếm ngược kiểu "tắt sau 30 giây / 15 phút" **không cần biết giờ**, ESP tự đếm.
