# 🔌 Nạp code cho ESP (từng bước)

Có **2 loại** ESP, nhưng chỉ có **1 dự án**: [`firmware/`](../firmware/).

| | Mạch | Nạp bản | Việc |
|---|---|---|---|
| **ESP trung tâm** | ESP32-S3 N16R8 | `master` | Nối WiFi + HiveMQ, chuyển lệnh, chạy lịch hẹn |
| **ESP phòng** | ESP32-C3 super mini | `node` | Gạt servo / đóng relay. **Mọi phòng nạp CHUNG 1 bản** |

## 1. Cài công cụ (làm 1 lần)

1. Cài **VS Code**: https://code.visualstudio.com
2. Mở VS Code, bấm biểu tượng **Extensions** (4 ô vuông bên trái), tìm **PlatformIO IDE** rồi bấm **Install**. Đợi cài xong (vài phút), khởi động lại VS Code.
3. **File → Open Folder…** và chọn thư mục `HomeGlass\firmware`.

PlatformIO sẽ tự tải mọi thư viện cần thiết. Bạn không phải cài thêm gì như Arduino IDE.

## 2. Điền file bí mật (làm 1 lần)

Mở `firmware/include/secrets.h` (đã có sẵn trên máy bạn, **không lên GitHub**) và điền:

- `HG_WIFI_SSID`, `HG_WIFI_PASS`: tên và mật khẩu WiFi nhà.
- `HG_WIFI_SSID2`, `HG_WIFI_PASS2`: WiFi dự phòng (không có thì để `""`).
- `HG_MQTT_USER`, `HG_MQTT_PASS`: tài khoản HiveMQ cho ESP (ví dụ `esp-gia-lap`).
- `HG_NET_KEY`: **đã tạo ngẫu nhiên sẵn, đừng sửa.** Mọi ESP dùng chung khóa này.

> 💾 Chép file `secrets.h` ra USB hoặc ghi chú riêng. Mất máy tính mà không còn file này thì phải tạo khóa mới và nạp lại tất cả ESP.

## 3. Nạp ESP trung tâm (S3)

1. Cắm S3 vào máy tính bằng cổng ghi **COM** (hoặc **UART**). Nếu mạch có 2 cổng USB, đừng cắm cổng "USB".
2. Mở **Terminal** của VS Code (Terminal → New Terminal), chạy:

```bash
pio run -e master -t upload
```

```bash
pio device monitor
```

3. Màn hình log phải hiện lần lượt: `[wifi] đã nối…`, rồi `[mqtt] đã kết nối`.
4. Đèn RGB trên mạch: **xanh lá chớp mỗi 3 giây** là ổn.

| Đèn S3 | Nghĩa |
|---|---|
| Xanh dương nháy nhanh | Đang nối WiFi |
| Vàng nháy nhanh | Đã có WiFi, đang nối HiveMQ |
| Xanh lá chớp 3 giây/lần | Mọi thứ OK |
| Đỏ chớp 2 cái | Sai mật khẩu MQTT hoặc sai khóa mạng (xem log) |

## 4. Nạp ESP phòng (C3 super mini)

1. Cắm C3 vào máy tính (cổng USB-C duy nhất), rồi chạy:

```bash
pio run -e node -t upload
```

```bash
pio device monitor
```

2. **Lần đầu**, log sẽ hỏi `Chưa đặt số ESP. Gõ số (vd: 3) rồi Enter`. Gõ **đúng số ESP** mà app ghi cho phòng đó (Cài đặt → Phòng & thiết bị → ESP), rồi Enter.
3. ESP tự khởi động lại, tìm ESP trung tâm, nhận bảng kênh từ app. Log hiện `[link] đã thấy ESP trung tâm…` và `[cfg] bảng kênh mới…`.
4. Số ESP được **lưu vĩnh viễn**. Nạp lại code, mất điện hay cập nhật cũng không mất. Đổi số thì gõ `id 5` trong log.

> Nạp không được (báo không thấy cổng)? Giữ nút **BOOT**, bấm **RESET** một cái, thả **BOOT**, rồi nạp lại.

| Đèn xanh C3 | Nghĩa |
|---|---|
| Sáng đứng | Chưa đặt số ESP |
| Nháy nhanh | Đang tìm ESP trung tâm |
| Chớp 3 giây/lần | Đã nối, mọi thứ OK |
| Chớp 2 cái | Sai khóa mạng (`HG_NET_KEY` khác ESP trung tâm) |

**Nút BOOT trên C3:**
- **Bấm nhanh**: đèn nháy đúng **số ESP** (nháy 3 cái là ESP 3). Tiện khi quên con nào là con nào.
- **Giữ 10 giây**: xóa bảng kênh (giữ lại số ESP). ESP trung tâm sẽ tự gửi lại.

Trong app còn có nút **Nháy đèn tìm ESP**: Cài đặt → Phòng & thiết bị → bấm vào 1 ESP.

## 5. Đấu dây ESP phòng (C3 super mini)

```
          ┌──── USB-C ────┐
     5V ──┤●             ●├── GPIO5   kênh 5
    GND ──┤●             ●├── GPIO6   kênh 6
    3V3 ──┤●             ●├── GPIO7   kênh 7
  GPIO4 ──┤● kênh 1      ●├── GPIO8   (đèn trên mạch - không dùng)
  GPIO3 ──┤● kênh 2      ●├── GPIO9   (nút BOOT - không dùng)
  GPIO2 ──┤● (không dùng)●├── GPIO10  kênh 8
  GPIO1 ──┤● kênh 3      ●├── GPIO20  SDA  (PCA9685 / cảm biến I2C)
  GPIO0 ──┤● kênh 4      ●├── GPIO21  SCL
          └───────────────┘
```

- Hình trên chỉ để dễ hình dung. **Luôn cắm theo chữ in trên mạch** (số GPIO), vì mỗi lô mạch có thể in mặt trước/sau khác nhau.
- **Kênh 1–4** nằm cùng cạnh với GND, nên dây servo ngắn và gọn. Hợp để cắm **servo**.
- **Kênh 5–8** ở cạnh còn lại, hợp để cắm **relay**.
- **Kênh 9–16**: thêm 1 mạch **PCA9685** vào chân 20/21. ESP tự nhận ra, không phải sửa code.
- Trong app, **Phiếu đấu dây** của mỗi ESP ghi rõ kênh nào là chân GPIO nào.

**Nguồn servo (quan trọng):**

```
Nguồn 5V riêng (≥ 2A) ──┬── dây ĐỎ của mọi servo
                        └── 5V của ESP (hoặc cấp ESP bằng USB)
GND nguồn ──────────────┬── dây NÂU của mọi servo
                        └── GND của ESP          ← BẮT BUỘC nối chung GND
GPIO kênh 1..4 ───────────── dây CAM (tín hiệu) của từng servo
```

- **Không lấy điện servo từ chân 3V3 của ESP.** Servo quay sẽ kéo sụt áp làm ESP khởi động lại. App sẽ báo "SỤT ÁP" nếu chuyện này xảy ra.
- Mỗi servo nên có 1 tụ 470–1000 µF sát chân nguồn.
- Firmware cho servo **quay lần lượt từng cái**, không quay cùng lúc, và **ngắt xung khi về góc nghỉ** để servo không nóng.

**Relay:**
- Relay chạy ngược (bấm bật mà relay tắt): vào app, sửa thiết bị đó, bật **"Relay kích mức thấp"**. Không phải sửa code.

## 6. Đấu dây ESP trung tâm (S3), nếu muốn cắm thiết bị thẳng vào

Kênh 1–8: GPIO **4, 5, 6, 7, 15, 16, 17, 18** (một hàng chân liền nhau). I2C: SDA **8**, SCL **9**.
Thường ESP trung tâm **không cần** cắm thiết bị gì. Đặt nó chỗ sóng WiFi tốt (gần router).

## 7. Nhiệt độ (C3 super mini nóng nhanh)

Firmware đã làm sẵn:
- Chạy ở **80 MHz** (thay vì 160 MHz) và **không nối WiFi nhà** (chỉ nghe ESP-NOW).
- **Tự giảm công suất phát** khi sóng tốt. Quá 80°C thì giảm mức thấp nhất và báo lên app.
- Servo được ngắt xung sau mỗi lần gạt.

Phần bạn nên làm: đừng đặt C3 trong hộp kín sát nguồn tổ ong hay sát module relay. Khoan vài lỗ thoáng cho hộp. Tab **Nhiệt độ** trong app hiện nhiệt độ từng ESP, báo vàng từ 70°C, đỏ từ 80°C (cảm biến đo lõi chip nên 50-60°C là bình thường).

## 7b. Cập nhật firmware qua mạng (không cần cắm USB)

Có từ bản **0.2.0**. Mạch đang chạy bản 0.1.x thì phải nạp USB **1 lần** bản 0.2.0 (như mục 3, 4). Lần nạp USB này cũng chép WiFi, MQTT, khóa mạng từ `secrets.h` vào flash của mạch.

Từ đó về sau:
1. Mình (hoặc bạn) sửa code, tăng `HG_FW_VERSION` trong `firmware/include/hg_config.h`.
2. Chạy `powershell -ExecutionPolicy Bypass -File tools\phat-hanh-firmware.ps1`. Script tạo file cập nhật **không có mật khẩu**, tự kiểm tra lại cho chắc, rồi ghi `firmware/bin/manifest.json`.
3. Commit + push. Khoảng 10 phút sau, app hiện **"Có bản mới"** ở **Cài đặt → Phòng & thiết bị → Bộ điều khiển ESP**.
4. Bấm vào từng ESP → **Cập nhật**. Mỗi ESP mất khoảng 1 phút. Cập nhật ESP phòng trước, ESP trung tâm sau cùng.

Mất điện / rớt sóng giữa chừng thì không sao: ESP vẫn chạy bản cũ. Bản mới lỗi thì ESP tự quay về bản cũ.

**Đừng** nạp file trong `firmware/bin/` qua USB cho mạch mới tinh: file đó không có mật khẩu, mạch sẽ không vào được mạng. Mạch mới thì nạp bản `master` / `node` như mục 3, 4.

## 8. Khi có sự cố

| Hiện tượng | Xem gì |
|---|---|
| Đèn C3 nháy nhanh mãi | ESP trung tâm có đang chạy không? Gõ `info` trong log C3 để xem |
| App báo "ESP x mất kết nối" | Xem đèn trên ESP đó. Bấm nút BOOT, nếu nó nháy số thì ESP vẫn sống |
| App báo "SỤT ÁP" | Nguồn servo yếu hoặc chưa nối chung GND |
| Thay ESP hỏng | Nạp bản `node`, gõ **đúng số cũ**. Trung tâm tự gửi lại bảng kênh. Cắm dây theo Phiếu đấu dây |
| Đổi router WiFi | Sửa `secrets.h`, nạp lại qua USB **chỉ ESP trung tâm** (cập nhật qua mạng không đổi được mật khẩu WiFi). ESP phòng tự dò kênh mới |
| Cập nhật qua mạng báo lỗi | Đọc dòng đỏ dưới nút Cập nhật / Nhật ký lỗi. ESP vẫn chạy bản cũ, bấm lại là được |

Gõ trong log (Serial Monitor): `info` (xem tình trạng), `reboot`, `factory` (xóa cấu hình).
