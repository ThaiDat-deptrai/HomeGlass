# 🧱 Kiến trúc app HomeGlass

App được chia thành **3 lớp**. Mỗi lớp chỉ được gọi lớp **ngay bên dưới** nó, không gọi ngược lên.

```
┌─────────────────────────────────────────────┐
│  GIAO DIỆN    app/js/ui/                     │  Vẽ màn hình, nhận thao tác bấm
│  (views, router, toast, sheet…)              │
└───────────────────┬─────────────────────────┘
                    │ gọi
┌───────────────────▼─────────────────────────┐
│  LÕI          app/js/core/                   │  Logic: trạng thái, kịch bản,
│  (store, scenes, commands, settings, config) │  hiểu lệnh giọng nói, cài đặt
└───────────────────┬─────────────────────────┘
                    │ gọi
┌───────────────────▼─────────────────────────┐
│  KẾT NỐI      app/js/transport/              │  Gửi lệnh / nhận trạng thái
│  demo.js (hiện tại)  →  mqtt.js (sắp làm)    │
└─────────────────────────────────────────────┘
```

**Vì sao chia vậy?** Khi chuyển từ bản demo sang điều khiển đèn thật, chỉ cần viết thêm `transport/mqtt.js`. Toàn bộ giao diện và lõi giữ nguyên, không phải sửa.

## 📁 Từng file làm gì

| File | Việc |
|---|---|
| `js/main.js` | Khởi động: áp cài đặt, đọc cấu hình nhà, tạo store, bật router |
| **Lõi** | |
| `core/config.js` | Đọc `config/home.json`, kiểm tra lỗi (trùng mã, sai định dạng), dựng bảng tra |
| `core/store.js` | Giữ trạng thái mọi thiết bị. Bấm → gửi yêu cầu → **chờ xác nhận** → mới đổi màu |
| `core/scenes.js` | Kịch bản có sẵn (tự tính từ cấu hình) + kịch bản tự tạo |
| `core/commands.js` | Hiểu câu lệnh tiếng Việt: "tắt đèn phòng khách tầng 1" → danh sách việc |
| `core/settings.js` | Màu, nền, sáng/tối, độ kính, âm thanh. Lưu trên máy người dùng |
| **Kết nối** | |
| `transport/demo.js` | Ngôi nhà ảo để thử giao diện khi chưa có phần cứng |
| **Giao diện** | |
| `ui/router.js` | Đổi màn hình theo địa chỉ `#/`, `#/scenes`… |
| `ui/views/*.js` | 4 màn hình: Nhà, Kịch bản, Trợ lý, Cài đặt |
| `ui/dom.js` | Hàm `html\`...\`` tự chống chèn mã độc (XSS) |
| `ui/sheet.js`, `ui/toast.js` | Bảng trượt và thông báo nhỏ |
| `css/tokens.css` | **Toàn bộ màu, bo góc, khoảng cách** ở một chỗ |
| `css/components.css` | Nút, ô thiết bị, thanh điều hướng… dùng chung |
| `css/views.css` | Kiểu riêng của từng màn hình |

## 🔌 Một transport cần có gì

Bất kỳ cách kết nối nào (demo, MQTT, sau này có thể là kết nối trong nhà khi mất Internet) chỉ cần đúng 3 thứ:

```js
{
  name: 'mqtt',
  connect({ onState, onStatus }) { /* bắt đầu, báo trạng thái về */ },
  send(key, on) { /* gửi yêu cầu bật/tắt 1 thiết bị */ }
}
```

- `onState(key, on)`: báo "thiết bị `key` đang bật/tắt" (từ ESP xác nhận, hoặc có người bấm công tắc tường).
- `onStatus(status)`: `demo` | `connecting` | `online` | `offline`.
- `key` có dạng `<mã phòng>/<mã thiết bị>`, ví dụ `t1-phong-khach/den-to`.

## 🧪 Chạy thử trên máy

Mở terminal ở thư mục `HomeGlass`, chạy:

```
py -m http.server 5501
```

Rồi mở trình duyệt vào `http://localhost:5501/`. Phải dùng máy chủ web như trên, mở thẳng file `index.html` sẽ không đọc được cấu hình.
