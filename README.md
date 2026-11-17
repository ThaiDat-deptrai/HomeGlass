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
| `app/` | App điện thoại (web cài được lên màn hình chính) |
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

Mỗi phòng có `node`: số thứ tự con ESP32-C3 điều khiển phòng đó (1, 2, 3…). `id` của phòng không được trùng trong cả nhà.

## 🔒 Bảo mật

- **Không bao giờ** ghi mật khẩu vào code. ESP dùng file `secrets.h` (đã chặn trong `.gitignore`), app thì người dùng tự đăng nhập.
- Mỗi người trong nhà một tài khoản HiveMQ riêng, ESP một tài khoản riêng.

## 🗺️ Lộ trình

| Giai đoạn | Việc | Trạng thái |
|---|---|---|
| 0. Khảo sát | Liệt kê tầng, phòng, thiết bị, linh kiện | ⏳ Đang làm |
| 1. Nền móng | Master + 1 node mẫu + app cơ bản + đăng nhập | ⬜ |
| 2. Nhân rộng | Lắp từng phòng: tầng 2 trước, rồi tầng 1 | ⬜ |
| 3. Nâng cao | Kịch bản, hẹn giờ, cảm biến, giọng nói, chạy khi mất mạng | ⬜ |

Nguyên tắc: **chạy chắc 1 phòng rồi mới nhân rộng.**

---

Made with ❤️ by Thái Đạt · Lớp 11 · [@ThaiDat-deptrai](https://github.com/ThaiDat-deptrai)
