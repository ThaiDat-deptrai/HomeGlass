# 🦾 Bật tắt đèn bằng servo SG90 (không đụng điện 220V)

Thay vì đấu relay vào dây điện 220V, mỗi công tắc tường được gắn **1 servo SG90**. Servo gạt công tắc sang BẬT hoặc TẮT, rồi quay về góc nghỉ. Công tắc tường vẫn bấm tay bình thường.

> Trong nhà hiện tại: **mọi đèn dùng servo**, trừ **Đèn tủ, Đèn giường, Đèn cây** (Phòng ngủ 2) dùng relay. Đổi được trong app: **Cài đặt → Phòng & thiết bị → chọn thiết bị → Cách bật tắt**.

## 🔁 Servo làm gì khi có lệnh

```
Lệnh BẬT:  quay tới góc "Gạt BẬT" (vd 45°)  → giữ ~0,3 giây → quay về "Nghỉ" (vd 90°)
Lệnh TẮT:  quay tới góc "Gạt TẮT" (vd 135°) → giữ ~0,3 giây → quay về "Nghỉ"
Xong:      ngắt xung PWM (servo thả lỏng, không kêu rè rè, không nóng, đỡ tốn điện)
```

- Ba góc **Gạt BẬT / Gạt TẮT / Nghỉ** chỉnh riêng cho từng công tắc trong app (mỗi công tắc lắp lệch một chút).
- **Góc nghỉ** để cần servo nằm giữa, không chạm công tắc → tay người bấm được bình thường.
- Cách chỉnh: bắt đầu từ 45 / 135 / 90, bấm thử, tăng giảm vài độ đến khi gạt dứt khoát mà không ghì quá.

## 🔌 Nối dây

```
 Nguồn 5V riêng (≥ 2A)  ──── dây đỏ  (V+) của mọi servo
 GND chung              ──── dây nâu (GND) của mọi servo + GND của ESP
 ESP32-C3 GPIO / PCA9685 ─── dây cam (tín hiệu) của từng servo
```

- **Không lấy nguồn servo từ chân 3V3 hay 5V của ESP**: SG90 lúc quay có thể kéo tới ~0,7A, ESP sẽ bị sụt áp và khởi động lại.
- Mỗi servo nên có 1 tụ **470µF–1000µF** sát chân nguồn để chống sụt áp lúc nhiều servo cùng quay.
- ESP32-C3 chỉ có **6 kênh PWM**. Phòng nào nhiều hơn 6 servo, hoặc muốn gọn dây: dùng mạch **PCA9685** (16 kênh, nối I2C, cùng loại mạch khuyên dùng cho cầu thang).
- "Kênh servo" trong app = số chân PWM / số kênh PCA9685 nối với servo đó.

## ⚠️ Điều cần biết: app có biết đèn đang sáng hay tắt không?

Relay thì ESP **biết chắc** vì chính nó đóng/ngắt. Servo chỉ **gạt hộ**: nếu có người **bấm tay** công tắc, ESP không biết.

| Cách | Độ chính xác | Ghi chú |
|---|---|---|
| Nhớ lệnh cuối cùng (mặc định) | Đúng khi chỉ điều khiển qua app | Bấm tay thì app có thể hiện sai |
| **Cảm biến ánh sáng** (quang trở / BH1750) cạnh bóng đèn | Biết chắc đèn sáng hay tắt | Rẻ, không đụng 220V. Khuyên dùng cho đèn hay bấm tay |
| Công tắc hành trình nhỏ sau cần gạt | Biết vị trí công tắc | Lắp cơ khí khó hơn |

Với cách mặc định, app gửi lệnh rõ ràng "gạt sang BẬT" hoặc "gạt sang TẮT" (không phải "đảo trạng thái"), nên dù có người bấm tay, lần bấm tiếp theo trên app vẫn đưa công tắc về đúng vị trí mong muốn.

## 🧠 Logic firmware (ESP phòng)

1. Nhận lệnh `{ thiết bị, bật/tắt }` từ ESP trung tâm.
2. Thiết bị dùng relay → đóng/ngắt chân relay. Dùng servo → chạy chuỗi góc ở trên.
3. Mỗi lúc chỉ cho **1 servo quay** (xếp hàng) để nguồn 5V không bị sụt.
4. Báo lại trạng thái cho ESP trung tâm → app đổi màu ô đèn.
