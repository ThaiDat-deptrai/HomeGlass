// =============================================================
// TRANSPORT GIẢ LẬP (DEMO)
// -------------------------------------------------------------
// Đóng vai "ngôi nhà ảo": nhận lệnh, chờ một chút rồi xác nhận,
// giống hệt cách ESP thật sẽ trả lời. Kèm nhiệt độ giả của từng ESP
// và một "ESP cầu thang" ảo (cảm biến, hẹn giờ tắt).
// Dùng để làm và thử giao diện khi chưa có phần cứng.
//
// Mọi transport đều có:
//   name                                       tên hiển thị
//   connect({ onState, onStatus, onTelemetry, onAttrs, onEvent })
//   send(key, on)                              gửi yêu cầu bật/tắt
//   configure(key, patch)          (tùy chọn)  đổi cài đặt thiết bị (cầu thang...)
//   sync(home)                     (tùy chọn)  cấu hình nhà vừa đổi
// Sau này transport/mqtt.js cũng chỉ cần đúng những thứ này.
// =============================================================

import { STAIRS_DEFAULTS } from '../core/stairs.js';

const STORAGE_KEY = 'hg.demo.states';
const ATTRS_KEY = 'hg.demo.attrs';
const LIVE_EVERY_MS = 5000;           // ESP gửi nhiệt độ mỗi 5 giây
const BACKFILL_STEP_MS = 5 * 60000;   // lịch sử giả: 5 phút một điểm
const DAY_MS = 24 * 3600000;

// Vài đèn bật sẵn để màn hình trông "có người ở"
const DEFAULT_ON = ['t1-phong-khach/den-to', 't2-phong-ngu-2/den-ngu', 't2-phong-tho/den-tho'];

const load = key => {
    try {
        return JSON.parse(localStorage.getItem(key));
    } catch (e) {
        return null;
    }
};
const save = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* bỏ qua */ }
};

export function createDemoTransport(initialHome) {
    let home = initialHome;
    let handlers = null;
    let timer = null;

    // ----- Trạng thái + cài đặt thiết bị (nhớ qua các lần mở app) -----
    const saved = load(STORAGE_KEY);
    const savedAttrs = load(ATTRS_KEY) || {};
    const states = {};
    const attrs = {};
    const offTimers = {}; // hẹn giờ tự tắt (cầu thang)

    function setState(key, on) {
        states[key] = on;
        save(STORAGE_KEY, states);
        handlers?.onState(key, on);
    }

    function scheduleOff(key, ms) {
        clearTimeout(offTimers[key]);
        if (ms > 0) offTimers[key] = setTimeout(() => setState(key, false), ms);
    }

    // ----- Nhiệt độ giả: mỗi ESP một mức nền + dao động ngày/đêm + nhiễu -----
    const temps = new Map();
    const baseTemp = id => (id === 0 ? 46 : 38 + (id * 37) % 7);
    function sample(id, t) {
        const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
        const target = baseTemp(id) + 2.6 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
        const prev = temps.get(id) ?? target;
        const v = prev + (target - prev) * 0.25 + (Math.random() - 0.5) * 0.9;
        temps.set(id, v);
        return Math.round(v * 10) / 10;
    }

    function tick() {
        const t = Date.now();
        home.nodes.forEach(n => handlers.onTelemetry(n.id, [{ t, v: sample(n.id, t) }]));
    }

    function backfill(id) {
        const now = Date.now();
        const samples = [];
        for (let t = now - DAY_MS; t <= now; t += BACKFILL_STEP_MS) samples.push({ t, v: sample(id, t) });
        handlers.onTelemetry(id, samples);
    }

    function sync(h) {
        home = h;
        h.allDevices.forEach(d => {
            if (!(d.key in states)) {
                states[d.key] = saved && d.key in saved ? !!saved[d.key] : DEFAULT_ON.includes(d.key);
                handlers?.onState(d.key, states[d.key]);
            }
            if (d.type === 'stairs' && !attrs[d.key]) {
                attrs[d.key] = { ...STAIRS_DEFAULTS, ...savedAttrs[d.key] };
                handlers?.onAttrs(d.key, attrs[d.key]);
            }
        });
        // ESP mới thêm: tạo sẵn lịch sử để biểu đồ không trống
        if (handlers) h.nodes.forEach(n => { if (!temps.has(n.id)) backfill(n.id); });
    }

    return {
        name: 'demo',
        sync,

        connect(h) {
            handlers = h;
            handlers.onStatus('demo');
            sync(home); // tạo trạng thái + lịch sử nhiệt độ cho mọi ESP
            Object.entries(states).forEach(([key, on]) => handlers.onState(key, on));
            Object.entries(attrs).forEach(([key, a]) => handlers.onAttrs(key, a));
            clearInterval(timer);
            timer = setInterval(tick, LIVE_EVERY_MS);
        },

        send(key, on) {
            // Giả lập độ trễ: relay đóng ngay (150–400 ms), servo phải quay gạt công tắc (500–800 ms)
            const servo = home.devices.get(key)?.actuator === 'servo';
            setTimeout(() => {
                setState(key, on);
                // Cầu thang bật bằng tay + có hẹn giờ -> tự tắt
                const a = attrs[key];
                if (a) scheduleOff(key, on && a.timerMin ? a.timerMin * 60000 : 0);
            }, servo ? 500 + Math.random() * 300 : 150 + Math.random() * 250);
        },

        configure(key, patch) {
            if (!attrs[key]) return;
            attrs[key] = { ...attrs[key], ...patch };
            save(ATTRS_KEY, attrs);
            setTimeout(() => handlers.onAttrs(key, attrs[key]), 120);
        },

        /** Giả lập cảm biến chuyển động của cầu thang thấy người. */
        simulate(key, { kind, dir }) {
            const a = attrs[key];
            if (!a || kind !== 'motion') return;
            handlers.onEvent(key, { kind: 'motion', dir });
            if (!a.motion) return;
            if (!states[key]) setState(key, true);
            scheduleOff(key, a.holdSec * 1000); // hết người -> tắt sau holdSec giây
        }
    };
}
