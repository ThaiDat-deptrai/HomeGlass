# 🛡️ Độ bền: hỏng ít, hỏng thì sửa nhanh

Mục tiêu: **một ngày nào đó ESP hay app bị lỗi thì KHÔNG phải viết lại code**.
Phần lớn sự cố sẽ được xử lý bằng cách *nạp lại*, *khôi phục file* hoặc *đọc nhật ký lỗi*.

Tài liệu này ghi các nguyên tắc đã làm (✅) và sẽ làm khi viết phần lõi + firmware (⏳).

---

## 1. Nguyên tắc chung

| Nguyên tắc | Nghĩa là |
|---|---|
| **Cấu hình nằm ngoài code** | Phòng, thiết bị, ESP, kênh, góc servo nằm trong `config/home.json` (và bản chỉnh trong app). Thêm/đổi đèn = sửa trong app, không sửa code. |
| **1 firmware cho mọi ESP phòng** | Tất cả ESP32-C3 chạy chung 1 code, chỉ khác **số ESP**. Hỏng 1 con: nạp code cũ với cùng số, cắm dây theo *phiếu đấu dây* trong app. |
| **Công tắc tay luôn dùng được** | Servo chỉ *gạt* công tắc, không cắt dây. ESP chết, mất mạng, mất điện ESP → vẫn bật đèn bằng tay như bình thường. |
| **Lỗi một chỗ không kéo sập cả hệ thống** | 1 màn hình lỗi không làm hỏng app; 1 ESP chết không làm hỏng ESP khác. |
| **Lỗi phải để lại dấu vết** | App ghi *nhật ký lỗi*, ESP gửi *báo cáo sức khỏe* → nhìn là biết hỏng ở đâu. |
| **Luôn có bản sao lưu** | File sao lưu toàn bộ + code trên GitHub (có gắn nhãn phiên bản). |

---

## 2. App (đã làm ✅)

- ✅ **Chặn lỗi theo từng màn hình**: màn hình nào lỗi thì chỉ màn hình đó hiện thẻ *"gặp sự cố"* (nút **Thử lại** / **Về trang Nhà**). Thanh điều hướng và các màn hình khác vẫn chạy.
- ✅ **Nhật ký lỗi** (*Cài đặt → Nhật ký lỗi*): ghi 40 lỗi gần nhất kèm giờ và phiên bản app. Bấm **Sao chép** rồi gửi cho người sửa. Lỗi lặp lại chỉ tăng bộ đếm, không tràn bộ nhớ.
- ✅ **Bắt cả lỗi "lọt lưới"** (lỗi không ai chặn, lỗi bất đồng bộ).
- ✅ **Mất mạng vẫn mở được**: app nhớ bản `home.json` của lần tải trước.
- ✅ **Cấu hình hỏng không làm trắng màn hình**: bản chỉnh trên máy bị hỏng → tự quay về file gốc. File gốc cũng hỏng → hiện thẻ báo lỗi kèm nút **Khôi phục từ file sao lưu**.
- ✅ **Kiểm tra trước khi lưu**: trùng kênh, thiếu tên, ESP không tồn tại... bị chặn ngay lúc lưu, không để lọt vào ESP.
- ✅ **Sao lưu / khôi phục toàn bộ** (nhà + ESP + kênh + góc servo + kịch bản + lịch hẹn) trong 1 file.
- ✅ **Phiên bản app + tải file theo phiên bản**: điện thoại luôn lấy đủ bộ file mới, không trộn file cũ với mới.
- ✅ **Lớp tách biệt** (`ui → core → transport`): đổi cách kết nối (demo → MQTT) chỉ sửa 1 dòng, không đụng giao diện.

## 3. Phần lõi MQTT (đã làm ✅, bản 0.9)

- ✅ **Tự kết nối lại** khi mất mạng, chờ tăng dần (1s, 2s, 4s… tối đa 30s), không treo app. Mở lại app / có mạng lại → thử ngay.
- ✅ **Mất mạng thì không xếp hàng lệnh**: bấm lúc mất mạng → báo ngay. Không có chuyện 5 phút sau đèn tự bật.
- ✅ **Trạng thái "giữ lại" (retained)**: mở app là thấy ngay đèn nào đang bật, không cần hỏi lại ESP.
- ✅ **Báo ESP mất kết nối** (LWT): ESP chết → app hiện "… không phản hồi: ESP x đang mất kết nối".
- ✅ **Số phiên bản giao thức** trong mỗi gói tin: bản cũ/mới vẫn hiểu nhau, hoặc báo rõ "cần cập nhật".
- ✅ **Tin hỏng / cấu hình hỏng từ máy khác**: bỏ qua + ghi nhật ký, giữ bản đang chạy.
- ✅ **Lỗi của ESP hiện trong Nhật ký lỗi của app** (kênh `hg/node/<số>/log`).
- ✅ **Sai tài khoản** (bị đổi mật khẩu): dừng thử lại, đưa về màn hình đăng nhập.
- ✅ **Bộ test tự động** `tests/mqtt.html`: 35 kiểm tra (rớt mạng, ESP chết, tin hỏng, đồng bộ 2 điện thoại...). Sửa phần lõi xong là chạy lại.

## 4. Firmware ESP (bản 0.1 ✅, chờ thử trên mạch)

| Việc | Tác dụng |
|---|---|
| ✅ **Watchdog** | ESP bị treo → tự khởi động lại sau 20–30 giây, và báo lên app lý do. |
| ✅ **Không dùng `delay()` chặn** | Mất WiFi/MQTT vẫn nhận lệnh ESP-NOW, vẫn chạy servo và lịch hẹn; kết nối lại chạy ngầm, chờ tăng dần 1 → 30 giây. |
| ✅ **WiFi dự phòng** | WiFi chính mất 30 giây → tự đổi sang WiFi thứ 2 (nếu có). |
| ✅ **Cấu hình lưu trong flash** (có mã CRC) | Mất điện bật lại vẫn nhớ bảng kênh. Dữ liệu hỏng → bỏ, chờ trung tâm gửi lại (không điều khiển bừa). |
| ✅ **Bảng kênh có số CRC** | Bảng 2 bên lệch nhau → lệnh bị từ chối + gửi lại bảng → không bao giờ gạt nhầm đèn. |
| ✅ **Lệnh có xác nhận + gửi lại** | Rớt gói → gửi lại tới 5 lần; servo gạt XONG mới báo app. |
| ✅ **Servo về góc nghỉ rồi ngắt xung** | Không ghì công tắc, không nóng servo, tay vẫn gạt được. |
| ✅ **Hàng đợi servo** + nguồn 5V riêng | Nhiều servo không chạy cùng lúc → không sụt áp làm ESP khởi động lại. |
| ✅ **Chống nóng C3** | 80 MHz, không nối WiFi nhà, tự giảm công suất phát; quá 80°C tự hạ mức thấp nhất + báo app. |
| ✅ **An toàn ESP-NOW** | Chữ ký HMAC + chống phát lại + mã hóa: ESP lạ không giả được lệnh. |
| ✅ **TLS kiểm tra chứng chỉ** | ESP trung tâm chỉ gửi mật khẩu cho đúng máy chủ HiveMQ thật. |
| ✅ **Báo cáo sức khỏe** | Nhiệt độ (10 giây/lần), phiên bản, thời gian chạy, lý do khởi động lại, chất lượng sóng → app. |
| ✅ **Gửi lỗi lên MQTT** | Sụt áp, servo kẹt, chip nóng... hiện trong Nhật ký lỗi của app. |
| ✅ **Tìm ESP / khởi động lại từ app** | Nút "Nháy đèn tìm ESP" + "Khởi động lại" trong trang mỗi ESP. |
| ✅ **Khôi phục cài đặt gốc** | Giữ nút BOOT 10 giây → xóa bảng kênh (giữ số ESP), trung tâm tự gửi lại. |
| ✅ **ESP trung tâm giữ lịch hẹn** | App tắt, điện thoại hết pin → lịch vẫn chạy (giờ lấy từ Internet). |
| ⏳ **Cập nhật qua WiFi (OTA) có quay lui** | Nạp code mới mà lỗi → ESP tự quay về bản cũ đang chạy tốt. Bước tiếp theo. |
| ⏳ **DS3231** (tùy chọn) | Mất điện + mất Internet cùng lúc vẫn biết giờ để chạy lịch. |

## 5. Quy trình khi có sự cố

1. **App lỗi** → *Cài đặt → Nhật ký lỗi → Sao chép* → gửi nội dung đó.
2. **1 ESP phòng chết** → mở *Cài đặt → Phòng & thiết bị → ESP đó*: làm theo *phiếu đấu dây* và *hướng dẫn thay ESP* (nạp cùng code, cùng số). Không phải sửa code.
3. **Muốn chuyển đèn sang ESP khác** → nút *chuyển hết thiết bị* trong trang ESP.
4. **Cấu hình rối tung** → *Khôi phục từ file sao lưu* (nhớ sao lưu định kỳ, nhất là sau khi thêm/sửa thiết bị).
5. **Code mới bị lỗi** → quay về phiên bản cũ trên GitHub (mỗi bản ổn định được gắn nhãn `v0.x`).
6. **GitHub mất / xóa nhầm** → khôi phục từ thư mục sao lưu trên máy (`HomeGlass-SaoLuu`, tự cập nhật sau mỗi commit): [`sao-luu.md`](sao-luu.md).

> ⚠️ Việc gì đụng tới điện 220V: nhờ người lớn hoặc thợ điện. Hệ thống được thiết kế để phần lớn đèn **không cần đụng vào dây 220V** (servo gạt công tắc).
