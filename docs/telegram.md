# Bot Telegram cho HomeGlass

Bot chạy **ngay trên ESP trung tâm**: không cần máy tính hay máy chủ riêng, tắt app vẫn báo tin. Cần firmware **0.3.0** trở lên.

## Cài (làm 1 lần, khoảng 2 phút)

1. Mở Telegram, tìm **@BotFather** (có dấu tích xanh), gửi `/newbot`.
2. Đặt tên bot (vd *Nhà Đạt*), rồi tên đăng nhập kết thúc bằng `bot` (vd *nha_dat_bot*).
3. BotFather gửi lại 1 mã dài dạng `123456789:AAH...`. Sao chép.
4. App: **Cài đặt → Thông báo Telegram** → dán mã → **Lưu mã**. Chờ vài giây thấy tên bot là xong.
5. Bấm **Kết nối điện thoại** → **Mở Telegram để kết nối** → bấm **Bắt đầu / Start**. Bot chào là xong.

Người nhà muốn dùng: mỗi người bấm **Kết nối thêm điện thoại** 1 lần (tối đa 4 người).

## Dùng

- Bấm nút bot gửi: **Trạng thái**, **Bật/tắt đèn**, **Tắt hết**.
- Hoặc gõ (có dấu hay không dấu đều được): `bật đèn ngủ`, `tắt đèn phòng thờ`, `tắt hết`, `trạng thái`, `đèn`.
- Bot chỉ trả lời "Đã bật" khi ESP báo **đã bật thật** (giống app). ESP không phản hồi thì bot báo lỗi.

## Bot báo cho bạn khi

Bật / tắt từng loại trong app:
- ESP mất kết nối hơn 2 phút, và khi có lại
- ESP quá nóng (từ 70°C)
- Lỗi: servo kẹt, sụt áp, khởi động lại bất thường
- Cập nhật firmware xong / lỗi
- Đèn bật quá N giờ (mặc định tắt), kèm nút **Tắt luôn**
- ESP trung tâm mất máy chủ MQTT hơn 5 phút (bot vẫn dùng được, vì đi thẳng Internet)

Cùng 1 cảnh báo không lặp lại trong 10 phút.

## An toàn

- Mã bot chỉ nằm trong flash ESP trung tâm. App không lưu, máy chủ MQTT không giữ lại, không có trong file cập nhật công khai.
- Chỉ người đã kết nối (bằng mã 4 số từ app, hiệu lực 5 phút) mới điều khiển được. Người lạ nhắn: bot chỉ trả lời "bot riêng".
- ESP kiểm tra đúng chứng chỉ của api.telegram.org: không ai giả được Telegram để lấy mã.
- Lỡ lộ mã bot: nhắn @BotFather `/revoke` để lấy mã mới, dán lại trong app.
- Mất điện rồi có lại: các lệnh gửi lúc ESP tắt bị bỏ, không tự bật đèn bất ngờ.
