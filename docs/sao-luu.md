# 💾 Sao lưu code trên máy (phòng khi GitHub gặp sự cố)

Code HomeGlass được giữ ở **3 nơi**:

1. Thư mục làm việc `HomeGlass\` trên máy.
2. GitHub: https://github.com/ThaiDat-deptrai/HomeGlass
3. **Thư mục sao lưu** `HomeGlass-SaoLuu\`, nằm cạnh thư mục `HomeGlass\`. Nó **tự cập nhật sau mỗi lần commit**.

## Trong thư mục sao lưu có gì

| | |
|---|---|
| `ban-moi-nhat\` | Code mới nhất, mở ra xem / chạy được ngay |
| `lich-su\*.bundle` | Mỗi file chứa **toàn bộ lịch sử** git ở thời điểm đó (các bản, nhãn `v0.x`). Giữ 40 bản gần nhất |
| `DOC-TRUOC.txt` | Tóm tắt cách khôi phục |

## Khôi phục

**GitHub mất / xóa nhầm repo:** mở terminal ở chỗ muốn đặt code, chạy:

```bash
git clone "D:\Test Html cho Smart Home\HomeGlass-SaoLuu\lich-su\<file mới nhất>.bundle" HomeGlass
```

Bạn có lại đủ code và lịch sử. Muốn đẩy lên GitHub mới thì:

```bash
git remote set-url origin https://github.com/<tài-khoản>/HomeGlass.git
```

```bash
git push -u origin main --tags
```

**Lỡ sửa hỏng code trên máy:** dùng `ban-moi-nhat\`, hoặc quay về một bản cũ có nhãn (`git checkout v0.8.0`).

## Sao lưu bằng tay / cài lại tự động

```bash
powershell -ExecutionPolicy Bypass -File tools\sao-luu.ps1
```

Tải code về máy mới thì chạy thêm `-Install` để bật lại chế độ tự sao lưu sau mỗi commit:

```bash
powershell -ExecutionPolicy Bypass -File tools\sao-luu.ps1 -Install
```

## ⚠️ Lưu ý

- **Mật khẩu WiFi/MQTT** (`secrets.h` của ESP) **không** nằm trong git, nên cũng không có trong bản sao lưu. Hãy tự cất file đó ở chỗ riêng (USB, ghi ra giấy).
- Thư mục sao lưu nằm **cùng máy**. Máy hỏng ổ cứng là mất cả hai. Thỉnh thoảng hãy chép cả thư mục `HomeGlass-SaoLuu` ra USB hoặc Google Drive.
