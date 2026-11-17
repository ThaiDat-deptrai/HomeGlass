// =============================================================
// STORE - "bộ nhớ" trạng thái thiết bị và nhiệt độ ESP
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
const HISTORY_MS = 24 * 3600 * 1000; // giữ lịch sử nhiệt độ 24 giờ
const MAX_POINTS = 6000;             // tối đa số điểm mỗi ESP

export function createStore(initialHome, transport) {
    /** key -> { on: true | false | null (chưa rõ), pending: boolean } */
    const states = new Map();
    /** id ESP -> { history: [{ t, v }], last: { t, v } | null } */
    const nodes = new Map();
    const timers = new Map();
    const listeners = new Set();
    let status = 'connecting'; // demo | connecting | online | offline

    const emit = event => listeners.forEach(fn => fn(event));

    function clearTimer(key) {
        clearTimeout(timers.get(key));
        timers.delete(key);
    }

    /** Cấu hình nhà thay đổi (thêm/xóa thiết bị, ESP): cập nhật danh sách theo dõi. */
    function syncHome(home) {
        home.allDevices.forEach(d => {
            if (!states.has(d.key)) states.set(d.key, { on: null, pending: false });
        });
        [...states.keys()].forEach(key => {
            if (!home.devices.has(key)) {
                clearTimer(key);
                states.delete(key);
            }
        });
        home.nodes.forEach(n => {
            if (!nodes.has(n.id)) nodes.set(n.id, { history: [], last: null });
        });
        [...nodes.keys()].forEach(id => {
            if (!home.nodes.has(id)) nodes.delete(id);
        });
        transport.sync?.(home);
    }

    syncHome(initialHome);

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
        },
        /** Nhận 1 hoặc nhiều mẫu nhiệt độ của một ESP: [{ t: thời điểm (ms), v: °C }] */
        onTelemetry(nodeId, samples) {
            const n = nodes.get(nodeId);
            if (!n || !samples.length) return;
            n.history.push(...samples);
            const cutoff = Date.now() - HISTORY_MS;
            let drop = 0;
            while (drop < n.history.length && n.history[drop].t < cutoff) drop++;
            drop = Math.max(drop, n.history.length - MAX_POINTS);
            if (drop > 0) n.history.splice(0, drop);
            n.last = n.history[n.history.length - 1] || null;
            emit({ type: 'telemetry', nodeId });
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
        node: id => nodes.get(id),
        status: () => status,
        transportName: transport.name,
        syncHome,

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
