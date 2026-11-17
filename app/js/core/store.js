// =============================================================
// STORE - "bộ nhớ" trạng thái của mọi thiết bị
// -------------------------------------------------------------
// Nguyên tắc quan trọng nhất của app:
//   Bấm nút  ->  gửi YÊU CẦU  ->  chờ thiết bị XÁC NHẬN  ->  mới đổi màu.
// Nhờ vậy app luôn hiện đúng tình trạng thật của đèn,
// kể cả khi có người bật bằng công tắc tường.
//
// Store không biết MQTT là gì: nó chỉ nói chuyện với "transport".
// Hôm nay transport là bản giả lập (demo), sau này đổi sang MQTT
// thì store và giao diện KHÔNG phải sửa.
// =============================================================

const CONFIRM_TIMEOUT_MS = 4000;

export function createStore(home, transport) {
    /** key -> { on: true | false | null (chưa rõ), pending: boolean } */
    const states = new Map(home.allDevices.map(d => [d.key, { on: null, pending: false }]));
    const timers = new Map();
    const listeners = new Set();
    let status = 'connecting'; // demo | connecting | online | offline

    const emit = event => listeners.forEach(fn => fn(event));

    function clearTimer(key) {
        clearTimeout(timers.get(key));
        timers.delete(key);
    }

    // ----- Transport báo về -----
    transport.connect({
        onState(key, on) {
            const s = states.get(key);
            if (!s) return; // thiết bị không có trong cấu hình: bỏ qua
            clearTimer(key);
            s.on = !!on;
            s.pending = false;
            emit({ type: 'device', key });
        },
        onStatus(next) {
            status = next;
            emit({ type: 'status', status });
        }
    });

    // ----- Giao diện gọi -----
    function set(key, on) {
        const s = states.get(key);
        if (!s || s.pending) return;
        s.pending = true;
        emit({ type: 'device', key });

        transport.send(key, !!on);

        clearTimer(key);
        timers.set(key, setTimeout(() => {
            s.pending = false;
            emit({ type: 'device', key });
            emit({ type: 'timeout', key });
        }, CONFIRM_TIMEOUT_MS));
    }

    return {
        get: key => states.get(key),
        status: () => status,
        transportName: transport.name,

        set,
        toggle(key) {
            const s = states.get(key);
            if (s) set(key, !s.on);
        },
        /** Gửi nhiều lệnh một lúc (kịch bản). Bỏ qua cái đã đúng trạng thái. */
        setMany(actions) {
            let sent = 0;
            actions.forEach(({ key, on }) => {
                const s = states.get(key);
                if (s && s.on !== !!on) {
                    set(key, on);
                    sent++;
                }
            });
            return sent;
        },

        /** Đếm số thiết bị đang bật trong một danh sách. */
        countOn: devices => devices.filter(d => states.get(d.key)?.on === true).length,

        /** Đăng ký nghe thay đổi. Trả về hàm để hủy đăng ký. */
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}
