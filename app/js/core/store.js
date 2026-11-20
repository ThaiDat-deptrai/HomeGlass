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

import { isAssigned } from './protocol.js';

const CONFIRM_TIMEOUT_MS = 4000;
const HISTORY_MS = 24 * 3600 * 1000; // giữ lịch sử nhiệt độ 24 giờ
const MAX_POINTS = 6000;             // tối đa số điểm mỗi ESP

// Lưu lịch sử nhiệt độ trên máy: tải lại trang / mở lại app vẫn còn biểu đồ.
// Gọn: mỗi ESP tối đa 1 điểm / phút, dạng [giây, °C x10]. 7 ESP x 24 giờ ≈ 150 KB.
const SAVE_KEY = 'hg.temp.history';
const SAVE_EVERY_MS = 60 * 1000;
const SAVE_STEP_S = 60;

function loadSavedHistory() {
    try {
        const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (!saved || saved.v !== 1 || typeof saved.nodes !== 'object') return new Map();
        const cutoff = Date.now() - HISTORY_MS;
        const out = new Map();
        Object.entries(saved.nodes).forEach(([id, rows]) => {
            if (!Array.isArray(rows)) return;
            const pts = rows
                .filter(r => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]))
                .map(([s, v10]) => ({ t: s * 1000, v: v10 / 10 }))
                .filter(p => p.t >= cutoff && p.t <= Date.now() + 60000);
            if (pts.length) out.set(Number(id), pts);
        });
        return out;
    } catch (e) {
        return new Map();
    }
}

function saveHistory(nodes) {
    const out = {};
    nodes.forEach((n, id) => {
        const rows = [];
        let lastS = -Infinity;
        n.history.forEach(p => {
            const s = Math.round(p.t / 1000);
            if (s - lastS < SAVE_STEP_S) return;
            lastS = s;
            rows.push([s, Math.round(p.v * 10)]);
        });
        if (rows.length) out[id] = rows;
    });
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, nodes: out }));
    } catch (e) { /* đầy bộ nhớ: bỏ qua, lần sau thử lại */ }
}

export function createStore(initialHome, transport) {
    /** key -> { on: true | false | null (chưa rõ), pending: boolean } */
    const states = new Map();
    /**
     * id ESP -> { history: [{ t, v }], last: { t, v } | null,
     *             online: true | false | null (chưa rõ), health: { fw, up, rssi, heap, reset, at } | null }
     */
    const nodes = new Map();
    const timers = new Map();
    const listeners = new Set();
    let status = 'connecting'; // demo | connecting | online | offline | auth (sai tài khoản)
    let home = initialHome;

    const emit = event => listeners.forEach(fn => fn(event));

    function clearTimer(key) {
        clearTimeout(timers.get(key));
        timers.delete(key);
    }

    /** Cấu hình nhà thay đổi (thêm/xóa thiết bị, ESP): cập nhật danh sách theo dõi. */
    function syncHome(next) {
        home = next;
        home.allDevices.forEach(d => {
            // attrs: cài đặt riêng của thiết bị "xịn" (cầu thang: độ sáng, hiệu ứng, hẹn giờ...)
            if (!states.has(d.key)) states.set(d.key, { on: null, pending: false, attrs: {} });
        });
        [...states.keys()].forEach(key => {
            if (!home.devices.has(key)) {
                clearTimer(key);
                states.delete(key);
            }
        });
        home.nodes.forEach(n => {
            if (!nodes.has(n.id)) nodes.set(n.id, { history: [], last: null, online: null, health: null });
        });
        [...nodes.keys()].forEach(id => {
            if (!home.nodes.has(id)) nodes.delete(id);
        });
        transport.sync?.(home);
    }

    syncHome(initialHome);

    // Bản thật: lấy lại lịch sử nhiệt độ đã lưu + lưu định kỳ (bản demo tự sinh số liệu, không cần)
    const persist = transport.name !== 'demo';
    if (persist) {
        loadSavedHistory().forEach((pts, id) => {
            const n = nodes.get(id);
            if (!n) return;
            n.history = pts;
            n.last = null; // điểm cũ: chưa coi là "đang chạy" cho tới khi có tin mới
        });
        const save = () => saveHistory(nodes);
        setInterval(save, SAVE_EVERY_MS);
        document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
        window.addEventListener('pagehide', save);
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
        },
        /** ESP báo online/offline hoặc gửi báo cáo sức khỏe. */
        onNodeStatus(nodeId, patch) {
            const n = nodes.get(nodeId);
            if (!n) return;
            Object.assign(n, patch);
            emit({ type: 'node', nodeId });
        },
        /** Thiết bị báo cài đặt hiện tại của nó (độ sáng, hiệu ứng...). */
        onAttrs(key, attrs) {
            const s = states.get(key);
            if (!s) return;
            s.attrs = { ...s.attrs, ...attrs };
            emit({ type: 'device', key });
        },
        /** Sự kiện từ thiết bị, vd cầu thang: { kind: 'motion', dir: 'up' | 'down' } */
        onEvent(key, detail) {
            if (states.has(key)) emit({ type: 'event', key, ...detail });
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
    /** Có gửi lệnh được không? Không được thì báo lý do ngay (không bắt người bấm chờ 4 giây). */
    function blockedReason(key) {
        if (status === 'demo') return null;
        if (status !== 'online') return 'offline';
        const device = home.devices.get(key);
        if (device && !isAssigned(device)) return 'unassigned';
        return null;
    }

    function set(key, on) {
        const s = states.get(key);
        if (!s || s.pending) return false;
        const reason = blockedReason(key);
        if (reason) {
            emit({ type: reason, key });
            return false;
        }
        s.pending = true;
        s.target = !!on; // trạng thái đang chờ chuyển sang
        emit({ type: 'device', key });

        // Mất kết nối đúng lúc bấm: transport không xếp hàng lệnh -> hủy chờ, báo ngay
        if (transport.send(key, !!on) === false) {
            s.pending = false;
            emit({ type: 'device', key });
            emit({ type: 'offline', key });
            return false;
        }

        clearTimer(key);
        timers.set(key, setTimeout(() => {
            s.pending = false;
            emit({ type: 'device', key });
            emit({ type: 'timeout', key });
        }, CONFIRM_TIMEOUT_MS));
        return true;
    }

    return {
        get: key => states.get(key),
        node: id => nodes.get(id),
        status: () => status,
        transportName: transport.name,
        transportUser: transport.user || null,
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
                if (s && s.on !== !!on && set(key, on)) sent++;
            });
            return sent;
        },

        /**
         * Đổi cài đặt của thiết bị (không phải bật/tắt): hiện ngay trên app,
         * đồng thời gửi xuống thiết bị. Thiết bị báo lại -> onAttrs.
         */
        configure(key, patch) {
            const s = states.get(key);
            if (!s) return;
            s.attrs = { ...s.attrs, ...patch };
            emit({ type: 'device', key });
            transport.configure?.(key, patch);
        },

        /** Lệnh cho 1 ESP: 'identify' (nháy đèn) | 'reboot' | 'resync'. Trả về false nếu chưa kết nối. */
        nodeCommand: (nodeId, cmd) => transport.command?.(nodeId, cmd) ?? false,

        /** Cập nhật firmware 1 ESP qua mạng. false = chưa kết nối / bản demo. */
        nodeUpdate(nodeId, info) {
            if (status !== 'online' || typeof transport.ota !== 'function') return false;
            const n = nodes.get(nodeId);
            if (n) {
                n.ota = { stage: 'request', pct: 0, msg: 'Đang gửi yêu cầu…', at: Date.now() };
                emit({ type: 'node', nodeId });
            }
            return transport.ota(nodeId, info);
        },
        canUpdate: typeof transport.ota === 'function',

        /** Bot Telegram: tình trạng (do ESP trung tâm báo) + gửi lệnh cài đặt. */
        telegramState: () => nodes.get(0)?.tg || null,
        telegram(cmd) {
            if (status !== 'online' || typeof transport.telegram !== 'function') return false;
            return transport.telegram(cmd);
        },
        canTelegram: typeof transport.telegram === 'function',

        /** Chỉ dùng khi thử (demo): giả lập cảm biến thấy người. */
        simulate: (key, detail) => transport.simulate?.(key, detail),
        canSimulate: typeof transport.simulate === 'function',

        /** Đếm số thiết bị đang bật trong một danh sách. */
        countOn: devices => devices.filter(d => states.get(d.key)?.on === true).length,

        /** Đăng ký nghe thay đổi. Trả về hàm để hủy đăng ký. */
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}
