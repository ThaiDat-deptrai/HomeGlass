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

## 3. Phần lõi MQTT (sẽ làm ⏳)

- ⏳ **Tự kết nối lại** khi mất mạng, chờ tăng dần (1s, 2s, 4s… tối đa 30s), không treo app.
- ⏳ **Trạng thái "giữ lại" (retained)**: mở app là thấy ngay đèn nào đang bật, không cần hỏi lại ESP.
- ⏳ **Báo ESP mất kết nối** (LWT): ESP chết → app hiện "ESP x mất kết nối" thay vì bấm mãi không ăn.
- ⏳ **Số phiên bản giao thức** trong mỗi gói tin: sau này đổi định dạng thì bản cũ/mới vẫn hiểu nhau hoặc báo rõ "cần cập nhật".
- ⏳ **Lệnh có hạn chờ**: bấm mà ESP không xác nhận sau 4s → báo "không phản hồi" (giao diện đã có sẵn).

## 4. Firmware ESP (sẽ làm ⏳)

| Việc | Tác dụng |
|---|---|
| **Watchdog** | ESP bị treo → tự khởi động lại sau vài giây. |
| **Không dùng `delay()` chặn** | Mất WiFi/MQTT vẫn nhận lệnh ESP-NOW, vẫn chạy servo; kết nối lại chạy ngầm, chờ tăng dần. |
| **Cấu hình lưu trong flash** (có mã kiểm tra) | Mất điện bật lại vẫn nhớ bảng servo/relay. Dữ liệu hỏng → dùng giá trị mặc định an toàn (servo về góc nghỉ). |
| **Servo về góc nghỉ** sau khi gạt | Không ghì công tắc, không nóng servo, tay vẫn gạt được. |
| **Hàng đợi servo** + nguồn 5V riêng | Nhiều servo không chạy cùng lúc → không sụt áp làm ESP khởi động lại. |
| **Báo cáo sức khỏe** mỗi phút | Thời gian chạy, lý do khởi động lại lần trước, sóng WiFi, RAM trống, phiên bản firmware → hiện trong app. |
| **Gửi lỗi lên MQTT** | ESP gặp lỗi gì cũng ghi vào kênh nhật ký, xem được trong app. |
| **Cập nhật qua WiFi (OTA) có quay lui** | Nạp code mới mà lỗi → ESP tự quay về bản cũ đang chạy tốt. |
| **Khôi phục cài đặt gốc** | Giữ nút BOOT 10 giây → xóa cấu hình, chờ nhận lại từ ESP trung tâm. |
| **ESP trung tâm giữ lịch hẹn** | App tắt, điện thoại hết pin → lịch vẫn chạy (giờ lấy từ Internet, dự phòng DS3231). |

## 5. Quy trình khi có sự cố

1. **App lỗi** → *Cài đặt → Nhật ký lỗi → Sao chép* → gửi nội dung đó.
2. **1 ESP phòng chết** → mở *Cài đặt → Phòng & thiết bị → ESP đó*: làm theo *phiếu đấu dây* và *hướng dẫn thay ESP* (nạp cùng code, cùng số). Không phải sửa code.
3. **Muốn chuyển đèn sang ESP khác** → nút *chuyển hết thiết bị* trong trang ESP.
4. **Cấu hình rối tung** → *Khôi phục từ file sao lưu* (nhớ sao lưu định kỳ, nhất là sau khi thêm/sửa thiết bị).
5. **Code mới bị lỗi** → quay về phiên bản cũ trên GitHub (mỗi bản ổn định được gắn nhãn `v0.x`).

> ⚠️ Việc gì đụng tới điện 220V: nhờ người lớn hoặc thợ điện. Hệ thống được thiết kế để phần lớn đèn **không cần đụng vào dây 220V** (servo gạt công tắc).
