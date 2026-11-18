# 🏠 HomeGlass

Hệ thống nhà thông minh cho **cả căn nhà 2 tầng**: điều khiển đèn, quạt, ổ cắm, khóa cửa… bằng app trên điện thoại, ở nhà hay ở ngoài đều được.

> Bản demo cũ (chỉ tầng 2) nằm ở repo [SmartHome_Project](https://github.com/ThaiDat-deptrai/SmartHome_Project), giữ lại để tham khảo.

---

## 🧱 Hệ thống gồm những gì

```
📱 App điện thoại (web cài được)
        │  Internet
        ▼
☁️ HiveMQ Cloud (MQTT - "bưu điện" trung gian, miễn phí)
        │  Internet
        ▼
📡 ESP32-S3 MASTER (trung tâm, nối WiFi nhà)
        │  ESP-NOW (sóng trực tiếp giữa các ESP)
   ┌────┴─────┬──────────┐
   ▼          ▼          ▼
ESP32-C3   ESP32-C3   ESP32-C3 ...   (mỗi phòng 1 con)
 relay      relay      servo
 💡 đèn     🌀 quạt     🚪 khóa
```

## 📁 Cấu trúc thư mục

| Thư mục | Chứa gì |
|---|---|
| `config/home.json` | **Khai báo cả nhà**: tầng → phòng → thiết bị. Sửa ở đây là app và ESP tự hiểu |
| `app/` | App điện thoại (web cài được lên màn hình chính). Cấu trúc code: xem [`docs/kien-truc.md`](docs/kien-truc.md) |
| `firmware/master/` | Code cho ESP32-S3 (trung tâm) |
| `firmware/node/` | Code cho ESP32-C3 (**dùng chung** cho mọi phòng, chỉ đổi số node) |
| `docs/` | Hướng dẫn, sơ đồ đi dây |

## ⚙️ Cấu hình nhà (`config/home.json`)

Mỗi thiết bị là **1 dòng**:

```json
{ "id": "den-ngu", "name": "Đèn ngủ", "type": "light", "ch": 1 }
```

| Trường | Ý nghĩa |
|---|---|
| `id` | Mã viết thường, không dấu, nối bằng gạch ngang. Không trùng trong cùng phòng |
| `name` | Tên hiện trên app (có dấu thoải mái) |
| `type` | Loại thiết bị: `light` (đèn), `fan` (quạt), `plug` (ổ cắm), `lock` (khóa cửa)… |
| `ch` | Thiết bị nối vào **relay số mấy** trên ESP32-C3 của phòng đó |

Mỗi phòng có `node`: số thứ tự con ESP32-C3 điều khiển phòng đó (1, 2, 3…).

- `id` của phòng bắt đầu bằng tầng (`t1-`, `t2-`) để không trùng trong cả nhà, ví dụ `t1-phong-khach` và `t2-phong-khach`.
- `node` hoặc `ch` là `null` nghĩa là **chưa chốt**: chờ biết con ESP nào, relay nào đi dây tới thiết bị đó.
- **Giữ công tắc tường**: vẫn bật tắt tay được như bình thường, kể cả khi mất mạng hay ESP hỏng.

## 🔒 Bảo mật

- **Không bao giờ** ghi mật khẩu vào code. ESP dùng file `secrets.h` (đã chặn trong `.gitignore`), app thì người dùng tự đăng nhập.
- Mỗi người trong nhà một tài khoản HiveMQ riêng, ESP một tài khoản riêng.

## 🗺️ Lộ trình

| Giai đoạn | Việc | Trạng thái |
|---|---|---|
| 0. Khảo sát | Liệt kê tầng, phòng, thiết bị, linh kiện | ✅ Xong danh sách nhà |
| 1a. Giao diện | 6 màn hình, vuốt đổi tầng/tab, nhiệt độ ESP, quản lý thiết bị trong app (dữ liệu demo) | ✅ Bản 0.2 |
| 1a++. Lịch & servo | Hẹn giờ tự chạy kịch bản (giờ cố định / mặt trời lặn, mọc). Đèn bật tắt bằng servo SG90 gạt công tắc: [`docs/cong-tac-servo.md`](docs/cong-tac-servo.md) | ✅ Bản 0.6 (giao diện) |
| 1a+++. Độ bền | Nhật ký lỗi, màn hình lỗi không làm sập app, mất mạng vẫn mở, khôi phục từ file sao lưu: [`docs/do-ben.md`](docs/do-ben.md) | ✅ Bản 0.8 |
| 1a+. Cầu thang | Khu "Cầu thang" giữa 2 tầng: hiệu ứng, cảm biến, hẹn giờ, ban đêm. Phần cứng: [`docs/cau-thang.md`](docs/cau-thang.md) | ✅ Bản 0.4 (giao diện) |
| 1b. Phần lõi | Kết nối MQTT thật, đăng nhập, đồng bộ giữa các điện thoại, bảng kênh cho ESP, ESP giả lập. Giao thức: [`docs/giao-thuc.md`](docs/giao-thuc.md) | ✅ Bản 0.9 |
| 1c. Firmware | ESP trung tâm (S3) + ESP phòng (C3, 1 bản chung): ESP-NOW có chữ ký + mã hóa, servo xếp hàng, chống nóng, lịch hẹn chạy trên ESP. Nạp code: [`docs/nap-code.md`](docs/nap-code.md) | 🧪 Bản 0.1 (chờ thử trên mạch) |
| 1d. OTA | Cập nhật firmware qua mạng, tự quay về bản cũ nếu lỗi | ⏳ Tiếp theo |
| 1e. Cảm biến | Thư viện cảm biến (PIR, mmWave, VL53L0X...) + luật tự động khai báo trong app | ⏳ |
| 2. Nhân rộng | Lắp từng phòng: tầng 2 trước, rồi tầng 1 | ⬜ |
| 3. Nâng cao | Kịch bản, hẹn giờ, cảm biến, giọng nói, chạy khi mất mạng | ⬜ |

Nguyên tắc: **chạy chắc 1 phòng rồi mới nhân rộng.**

---

Made with ❤️ by Thái Đạt · Lớp 11 · [@ThaiDat-deptrai](https://github.com/ThaiDat-deptrai)
