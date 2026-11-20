# 📡 Giao thức MQTT của HomeGlass (phiên bản 1)

Đây là "bản hợp đồng" giữa **app** và **ESP**. App đã làm đúng theo file này. Firmware ESP trung tâm cũng phải làm đúng như vậy.
Code nguồn của giao thức: [`app/js/core/protocol.js`](../app/js/core/protocol.js).
Bản mẫu hành vi của ESP trung tâm: [`tools/esp-sim.js`](../tools/esp-sim.js).

```
Điện thoại ──WSS 8884──► HiveMQ Cloud ◄──TLS 8883── ESP32-S3 trung tâm (số 0) ──ESP-NOW──► ESP32-C3 phòng (1, 2, 3…)
```

Chỉ **ESP trung tâm** nói chuyện với MQTT. Các ESP phòng chỉ nói chuyện với ESP trung tâm qua ESP-NOW.
Vì vậy ESP trung tâm **thay mặt** các ESP phòng gửi trạng thái, nhiệt độ, online/offline lên MQTT.

## 1. Quy tắc chung

- Mọi tin nhắn là **JSON** và có số phiên bản `"v": 1`. Ví dụ: `{"v":1,"on":true}`.
- Bên nhận gặp `v` lớn hơn số mình biết: **vẫn đọc** các trường quen thuộc, bỏ qua trường lạ, ghi cảnh báo "cần cập nhật". **Không được** làm sập máy.
- Để firmware dễ viết, app cũng hiểu kiểu đơn giản: `"1"`/`"0"`, `"ON"`/`"OFF"`, `"online"`/`"offline"`, `23.5`.
- **Giữ lại** (retained) = máy chủ nhớ tin cuối cùng. Ai vào sau vẫn nhận được ngay.
- Gửi chuỗi **rỗng** có cờ giữ lại = xóa tin đang được giữ.
- QoS 1 cho mọi tin.
- `key` thiết bị = `<mã phòng>/<mã thiết bị>`, ví dụ `t1-phong-khach/den-to`. Mã chỉ gồm `a-z 0-9 -`.

## 2. Thiết bị

| Kênh | Ai gửi | Giữ lại | Nội dung |
|---|---|---|---|
| `hg/dev/<key>/set` | app | không | `{"v":1,"on":true}`: **yêu cầu** bật/tắt |
| `hg/dev/<key>/state` | ESP trung tâm | **có** | `{"v":1,"on":true}`: đèn **đang thật sự** bật/tắt |
| `hg/dev/<key>/cfg` | app | không | `{"v":1,"timerMin":5,...}`: đổi cài đặt (cầu thang) |
| `hg/dev/<key>/attrs` | ESP trung tâm | **có** | cài đặt hiện tại của thiết bị (cầu thang) |
| `hg/dev/<key>/event` | ESP trung tâm | không | `{"v":1,"kind":"motion","dir":"up"}`: cảm biến thấy người |

**Quy tắc vàng:** app bấm thì gửi `set`. Chỉ khi ESP gửi `state` thì app mới đổi màu. Quá 4 giây không có `state` thì app báo "không phản hồi".
Có người gạt **công tắc tường** bằng tay: servo **không tự biết** chuyện đó, nên app vẫn hiện trạng thái cũ. Muốn app hiện đúng cả lúc gạt tay thì cần gắn thêm cảm biến (quang trở cạnh bóng đèn, hoặc cảm biến dòng). Phần này làm ở bước cảm biến. Khi đó ESP gửi `state` như bình thường. Nút "Bấm công tắc tường" trên trang ESP giả lập là để thử trường hợp đã có cảm biến.

## 3. Bộ điều khiển ESP

| Kênh | Ai gửi | Giữ lại | Nội dung |
|---|---|---|---|
| `hg/node/<số>/config` | app | **có** | **bảng kênh** của ESP đó (xem dưới) |
| `hg/node/<số>/status` | ESP trung tâm | **có** | `{"v":1,"online":true}` |
| `hg/node/<số>/temp` | ESP trung tâm | không | `{"v":1,"t":45.2}` (có thể thêm `"ts"`: giây Unix) |
| `hg/node/<số>/health` | ESP trung tâm | **có** | `{"v":1,"fw":"0.1.0","up":3600,"rssi":-61,"heap":182000,"reset":"POWERON"}` |
| `hg/node/<số>/log` | ESP trung tâm | không | `{"v":1,"msg":"Servo kênh 2 không quay"}`: hiện trong **Nhật ký lỗi** của app |
| `hg/node/<số>/cmd` | app | không | `{"v":1,"cmd":"identify"}`: `identify` (nháy đèn 10 giây để tìm ESP), `reboot`, `resync` (gửi lại trạng thái) |
| `hg/node/<số>/ota` | app | **không** (chỉ chạy 1 lần) | cập nhật firmware: `{"v":1,"url":"https://thaidat-deptrai.github.io/HomeGlass/firmware/bin/node-0.2.0.bin","sha256":"<64 hex>","size":767248,"ver":"0.2.0"}` |
| `hg/node/<số>/update` | ESP trung tâm | không | tiến độ cập nhật: `{"v":1,"stage":"download\|send\|reboot\|done\|error","pct":40,"msg":"..."}` |
| `hg/node/0/tgcmd` | app | **không** | bot Telegram: `{"v":1,"cmd":"token","token":"..."}` / `pair` / `unpair` / `test` / `remove` / `{"cmd":"alerts","alerts":15,"lh":3}` |
| `hg/node/0/tg` | ESP trung tâm | **có** | tình trạng bot: `{"v":1,"on":true,"bot":"@ten_bot","ok":true,"chats":1,"pair":"4821","alerts":15,"lh":0,"err":"..."}` (**không bao giờ** có mã bot) |

**Bot Telegram** chạy ngay trên ESP trung tâm (luồng riêng ở lõi 0, `firmware/src/master/telegram.*`), kiểm tra chứng chỉ thật của api.telegram.org (`ca_telegram.h`). Mã bot + danh sách người được phép nằm trong flash (NVS `hgtg`). Người lạ nhắn bot: chỉ nhận câu "bot riêng". Ghép nối: app bấm "Kết nối điện thoại" → mã 4 số hiệu lực 5 phút → link `t.me/<bot>?start=<mã>`. Lúc khởi động, bot **bỏ** các tin nhắn cũ (lệnh gửi lúc ESP tắt không tự chạy khi có điện lại). Bảng kênh có thêm `n` (tên hiển thị) để bot hiểu "tắt đèn ngủ".

**Cập nhật firmware qua mạng (OTA):** app đọc `firmware/bin/manifest.json` (tạo bằng `tools/phat-hanh-firmware.ps1`), thấy bản mới hơn `fw` trong `health` thì hiện nút "Cập nhật". ESP trung tâm **chỉ** tải file có địa chỉ bắt đầu bằng `HG_OTA_URL_PREFIX` (hg_config.h) và **chỉ** cài khi SHA-256 + loại chip khớp. ESP phòng nhận file từ trung tâm qua ESP-NOW (gói 20–24, `hg_msgs.h`), tự kiểm SHA-256 lần nữa. Bản mới phải tự "chốt" (trung tâm: lên được MQTT trong 10 phút; ESP phòng: thấy trung tâm trong 5 phút), không thì tự quay về bản cũ. File cập nhật **không chứa mật khẩu**: WiFi/MQTT/khóa mạng nằm trong flash từng ESP từ lần nạp USB.

ESP trung tâm gửi `temp` của **mọi ESP mỗi 10 giây** (app coi mất kết nối sau 30 giây không có tin), còn `health` thì mỗi phút.

### Bảng kênh (`hg/node/<số>/config`)

```json
{
  "v": 1,
  "rev": 1763456789000,
  "devices": [
    { "k": "t1-phong-khach/den-to", "ch": 0, "a": "servo", "on": 45, "off": 135, "rest": 90 },
    { "k": "t2-phong-ngu-2/den-tu", "ch": 3, "a": "relay", "lo": 1 },
    { "k": "cau-thang/den", "a": "stairs", "steps": 15, "drv": "mcp23017" }
  ]
}
```

- `k` = key thiết bị, `ch` = kênh (chân), `a` = cách bật tắt.
- Servo: quay tới `on` / `off` độ, rồi **về `rest`** để tay người vẫn gạt được công tắc.
- `lo: 1`: relay kích **mức thấp** (LOW = bật). Bật/tắt bằng ô "Relay kích mức thấp" trong app.
- Kênh 1–8 là chân GPIO trực tiếp, kênh 9–16 đi qua mạch PCA9685. Bảng chân ở [`firmware/include/hg_config.h`](../firmware/include/hg_config.h) và `CHANNEL_PINS` trong `protocol.js`, **hai chỗ phải giống nhau**.
- ESP trung tâm đánh số bảng bằng **CRC32 nội dung**. Bảng hai bên không khớp thì lệnh bị từ chối và bảng được gửi lại, nên **không bao giờ gạt nhầm đèn** khi vừa sửa cấu hình.
- Thiết bị chưa gán ESP hoặc chưa chọn kênh thì **không có** trong bảng. App sẽ chặn ngay khi bấm.
- `rev` tăng mỗi lần sửa. ESP trung tâm chuyển bảng xuống ESP phòng qua ESP-NOW, và ESP phòng **lưu vào flash**.
- ESP bị xóa khỏi nhà: app gửi chuỗi rỗng (giữ lại) để xóa bảng.

**Nhờ bảng kênh mà thêm đèn mới không cần sửa code:** thêm trong app → app gửi bảng mới → ESP tự dùng.

### "Di chúc" (LWT) của ESP trung tâm

Khi kết nối, ESP trung tâm đăng ký di chúc `hg/node/0/status` = `{"v":1,"online":false}` (giữ lại).
Nếu nó rớt mạng hay mất điện, **máy chủ tự gửi** tin này, và app biết ngay "ESP trung tâm mất kết nối".
Kết nối lại xong thì ESP gửi `{"v":1,"online":true}` và gửi lại `state` của mọi thiết bị.

ESP phòng không có MQTT. ESP trung tâm tự theo dõi chúng (gói ESP-NOW định kỳ). Mất tín hiệu khoảng 30 giây thì gửi `status` offline thay cho ESP đó.

## 4. Dữ liệu chung của cả nhà (đồng bộ giữa các điện thoại)

| Kênh | Nội dung |
|---|---|
| `hg/home/config` | `{"v":1,"rev":…,"by":"tên","data":{…home.json…}}` |
| `hg/home/scenes` | `{"v":1,"rev":…,"by":"tên","list":[…kịch bản tự tạo…]}` |
| `hg/home/schedules` | `{"v":1,"rev":…,"by":"tên","tz":420,"location":null,"list":[…]}` |

Tất cả đều **giữ lại**. Bản nào có `rev` lớn hơn thì thắng.
Điện thoại mới đăng nhập sẽ tự lấy bản trên máy chủ. Sửa trên máy này thì máy kia tự cập nhật (code: [`core/sync.js`](../app/js/core/sync.js)).

**Lịch hẹn giờ** gửi kèm sẵn danh sách lệnh, để ESP trung tâm khỏi phải hiểu "kịch bản":

```json
{ "id": "h-1", "kind": "sunset", "offset": 15, "time": "18:00", "days": [1,2,3,4,5],
  "enabled": true, "sceneId": "c-abc", "actions": [{ "k": "t1-san/den-san", "on": true }],
  "end": { "kind": "sunrise", "time": "06:00", "offset": 0 },
  "endActions": [{ "k": "t1-san/den-san", "on": false }] }
```

`end` (có thể `null`) là **giờ tắt**. Đến giờ đó, ESP chạy `endActions`, tức là tắt lại những thiết bị mà kịch bản đã bật.
Nếu giờ tắt sớm hơn hoặc bằng giờ bật (ví dụ bật lúc mặt trời lặn, tắt lúc mặt trời mọc), thì tắt vào **hôm sau**.

`kind`: `time` (giờ cố định), `sunset` / `sunrise` (mặt trời lặn / mọc, cộng `offset` phút). `days`: 0 = Chủ nhật … 6 = Thứ 7. `tz`: số phút lệch so với giờ UTC.

## 5. Việc ESP trung tâm phải làm (tóm tắt cho firmware)

1. Kết nối WiFi rồi MQTT (TLS 8883), có **di chúc**. Rớt thì tự kết nối lại, chờ tăng dần, **không dùng `delay()` chặn**.
2. Nghe `hg/node/+/config`, `hg/dev/+/+/set`, `hg/dev/+/+/cfg`, `hg/home/schedules`.
3. Nhận `set` → tra bảng kênh → gửi lệnh ESP-NOW cho đúng ESP phòng → ESP phòng gạt servo / đóng relay → báo lại → gửi `state` (giữ lại).
4. Thiết bị không có trong bảng → gửi `log`. **Không đoán bừa.**
5. Mỗi phút gửi `temp` + `health` của mình và của các ESP phòng.
6. Chạy lịch hẹn giờ theo giờ Internet (NTP), kể cả khi không ai mở app.

Làm thử không cần mạch: mở [`tools/esp-gia-lap.html`](../tools/esp-gia-lap.html), nó làm đúng các việc trên.

## 6. ESP trung tâm ↔ ESP phòng (ESP-NOW)

Định dạng gói nằm ở [`firmware/lib/hgcore/hg_msgs.h`](../firmware/lib/hgcore/hg_msgs.h). Tóm tắt:

- Mỗi gói có **chữ ký HMAC-SHA256** bằng khóa chung `HG_NET_KEY`. Gói không đúng chữ ký thì bị vứt, nên ESP lạ không giả được lệnh.
- **Chống phát lại**: mỗi gói có số thứ tự và giờ chuẩn. Gói trùng, hoặc lệch giờ quá 90 giây, đều bị vứt.
- Gói gửi riêng được **mã hóa** (khóa ESP-NOW lấy từ `HG_NET_KEY`). Hết chỗ mã hóa (khoảng 7 ESP) thì vẫn chạy, chỉ còn chữ ký.
- Trung tâm phát **beacon** mỗi 2 giây: kênh WiFi và giờ chuẩn. ESP phòng mất beacon 12 giây thì tự dò lại kênh 1–13.
- Lệnh: trung tâm gửi `CMD`. ESP phòng trả `ACK` ngay, rồi trả `STATE` khi servo gạt **xong**. Không có ACK thì gửi lại 5 lần (150, 300, 450… ms).
- ESP phòng gửi **heartbeat** mỗi 10 giây: nhiệt độ, công suất phát, chất lượng sóng, trạng thái mọi kênh, lý do khởi động lại.

## 7. Đổi giao thức về sau

- Chỉ **thêm** trường mới: không cần tăng `v`, bên cũ tự bỏ qua trường lạ.
- Đổi ý nghĩa / bỏ trường: tăng `v` lên 2. Trong một thời gian, bên mới vẫn phải hiểu cả `v:1`.
- Mọi thay đổi phải sửa cả 3 chỗ: `protocol.js`, `esp-sim.js`, file này. Chạy lại `tests/mqtt.html`.
