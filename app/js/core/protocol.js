// =============================================================
// PROTOCOL - "ngôn ngữ" chung giữa app và ESP qua MQTT
// -------------------------------------------------------------
// Toàn bộ tên kênh (topic) và cách đóng gói tin nhắn nằm ở ĐÂY,
// app, ESP giả lập (tools/) và tài liệu cho firmware (docs/giao-thuc.md)
// đều theo đúng file này. Đổi giao thức = sửa 1 chỗ.
//
// Mọi tin nhắn là JSON có số phiên bản "v". Bên nhận gặp số lớn hơn
// số mình biết thì vẫn đọc những trường quen thuộc và ghi cảnh báo
// "cần cập nhật" -> app cũ và ESP mới (hoặc ngược lại) không làm sập nhau.
//
// Đọc kỹ: docs/giao-thuc.md
// =============================================================

/** Phiên bản giao thức. Chỉ tăng khi đổi cách đóng gói KHÔNG tương thích. */
export const PROTOCOL = 1;

const ROOT = 'hg';

export const topics = {
    // ----- Thiết bị (key = "<mã phòng>/<mã thiết bị>") -----
    deviceSet: key => `${ROOT}/dev/${key}/set`,       // app -> ESP: yêu cầu bật/tắt
    deviceState: key => `${ROOT}/dev/${key}/state`,   // ESP -> app: đang bật/tắt (giữ lại)
    deviceCfg: key => `${ROOT}/dev/${key}/cfg`,       // app -> ESP: đổi cài đặt (cầu thang...)
    deviceAttrs: key => `${ROOT}/dev/${key}/attrs`,   // ESP -> app: cài đặt hiện tại (giữ lại)
    deviceEvent: key => `${ROOT}/dev/${key}/event`,   // ESP -> app: sự kiện (cảm biến thấy người)

    // ----- Bộ điều khiển ESP (id = số ESP) -----
    nodeStatus: id => `${ROOT}/node/${id}/status`,    // online/offline (giữ lại, có "di chúc" LWT)
    nodeTemp: id => `${ROOT}/node/${id}/temp`,        // nhiệt độ chip
    nodeHealth: id => `${ROOT}/node/${id}/health`,    // sức khỏe: thời gian chạy, sóng WiFi... (giữ lại)
    nodeLog: id => `${ROOT}/node/${id}/log`,          // ESP báo lỗi
    nodeConfig: id => `${ROOT}/node/${id}/config`,    // bảng kênh -> thiết bị của ESP đó (giữ lại)
    nodeCmd: id => `${ROOT}/node/${id}/cmd`,          // app -> ESP: reboot | identify | resync

    // ----- Dữ liệu chung của cả nhà (giữ lại, đồng bộ giữa các điện thoại) -----
    doc: name => `${ROOT}/home/${name}`               // config | scenes | schedules
};

/** Các kênh app cần nghe. */
export const APP_SUBSCRIPTIONS = [
    `${ROOT}/dev/+/+/state`,
    `${ROOT}/dev/+/+/attrs`,
    `${ROOT}/dev/+/+/event`,
    `${ROOT}/node/+/status`,
    `${ROOT}/node/+/temp`,
    `${ROOT}/node/+/health`,
    `${ROOT}/node/+/log`,
    `${ROOT}/home/+`
];

/** Tên các "tài liệu chung" đồng bộ qua kênh hg/home/<tên>. */
export const DOCS = ['config', 'scenes', 'schedules'];

/**
 * Tách tên kênh thành ý nghĩa.
 *   hg/dev/t1-bep/den-bep/state -> { kind: 'dev', key: 't1-bep/den-bep', what: 'state' }
 *   hg/node/3/temp              -> { kind: 'node', id: 3, what: 'temp' }
 *   hg/home/scenes              -> { kind: 'home', name: 'scenes' }
 * Kênh lạ -> null (bỏ qua, không làm lỗi).
 */
export function parseTopic(topic) {
    const p = String(topic).split('/');
    if (p[0] !== ROOT) return null;
    if (p[1] === 'dev' && p.length === 5) return { kind: 'dev', key: `${p[2]}/${p[3]}`, what: p[4] };
    if (p[1] === 'node' && p.length === 4 && /^\d+$/.test(p[2])) return { kind: 'node', id: Number(p[2]), what: p[3] };
    if (p[1] === 'home' && p.length === 3) return { kind: 'home', name: p[2] };
    return null;
}

/** Đóng gói: luôn kèm số phiên bản giao thức. */
export const encode = (obj = {}) => JSON.stringify({ v: PROTOCOL, ...obj });

/**
 * Mở gói. Trả về object (có thể rỗng) hoặc null nếu tin rỗng.
 * Chấp nhận cả kiểu đơn giản để firmware dễ viết: "1" / "0" / "ON" / "OFF" / "online" / 23.5
 */
export function decode(payload) {
    if (payload === null || payload === undefined || payload === '') return null;
    const text = String(payload).trim();
    try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object' && !Array.isArray(data)) return data;
        return { value: data };
    } catch (e) {
        return { value: text };
    }
}

/** ESP dùng giao thức mới hơn app? */
export const isNewer = data => Number(data?.v) > PROTOCOL;

/** Đọc trạng thái bật/tắt từ nhiều kiểu viết. Không hiểu -> null. */
export function readOn(data) {
    const raw = data?.on ?? data?.value;
    if (raw === true || raw === 1) return true;
    if (raw === false || raw === 0) return false;
    const s = String(raw ?? '').trim().toLowerCase();
    if (['1', 'on', 'true', 'bat', 'bật'].includes(s)) return true;
    if (['0', 'off', 'false', 'tat', 'tắt'].includes(s)) return false;
    return null;
}

/** Đọc online/offline. Không hiểu -> null. */
export function readOnline(data) {
    const raw = data?.online ?? data?.value;
    if (raw === true || raw === 1) return true;
    if (raw === false || raw === 0) return false;
    const s = String(raw ?? '').trim().toLowerCase();
    if (['online', '1', 'true'].includes(s)) return true;
    if (['offline', '0', 'false'].includes(s)) return false;
    return null;
}

/** Đọc nhiệt độ (°C). Không hợp lệ -> null. */
export function readTemp(data) {
    const v = Number(data?.t ?? data?.value);
    return Number.isFinite(v) && v > -40 && v < 150 ? v : null;
}

/**
 * Bảng kênh của từng ESP, tính từ cấu hình nhà.
 * ESP chỉ cần bảng này (gọn, vài trăm byte) chứ không cần cả file home.json.
 *   Map: số ESP -> { rev, devices: [{ k, ch, a, on, off, rest } | { k, a: 'stairs', steps, drv }] }
 *   k = key thiết bị, ch = kênh (chân), a = cách bật tắt: 'servo' | 'relay' | 'stairs'
 * Thiết bị chưa gán ESP hoặc chưa chọn kênh thì không có trong bảng.
 */
export function buildNodeConfigs(home, rev) {
    const out = new Map();
    home.nodes.forEach(n => out.set(n.id, { rev, devices: [] }));
    home.allDevices.forEach(d => {
        const table = out.get(d.node);
        if (!table) return;
        if (d.type === 'stairs') {
            table.devices.push({ k: d.key, a: 'stairs', steps: d.steps, drv: d.driver || 'mcp23017' });
            return;
        }
        if (d.ch === null || d.ch === undefined) return;
        const entry = { k: d.key, ch: d.ch, a: d.actuator };
        if (d.actuator === 'servo') Object.assign(entry, { on: d.servo.on, off: d.servo.off, rest: d.servo.rest });
        if (d.actuator === 'relay' && d.relayLow) entry.lo = 1;
        table.devices.push(entry);
    });
    return out;
}

/**
 * Kênh 1..16 -> chân nào trên ESP. PHẢI GIỐNG firmware/include/hg_config.h.
 * Kênh 9..16 đi qua mạch mở rộng PCA9685 (cổng 0..7).
 */
export const CHANNEL_PINS = {
    'ESP32-C3': [4, 3, 1, 0, 5, 6, 7, 10],
    'ESP32-S3': [4, 5, 6, 7, 15, 16, 17, 18]
};

/** "GPIO4" / "PCA9685 cổng 2" / "–" */
export function pinLabel(board, ch) {
    if (!Number.isInteger(ch)) return '–';
    if (ch >= 9 && ch <= 16) return `PCA9685 cổng ${ch - 9}`;
    const pins = CHANNEL_PINS[board] || CHANNEL_PINS['ESP32-C3'];
    return ch >= 1 && ch <= 8 ? `GPIO${pins[ch - 1]}` : '–';
}

/** Thiết bị đã đủ thông tin để ESP điều khiển chưa (có ESP, có kênh)? */
export function isAssigned(device) {
    if (device.node === null || device.node === undefined) return false;
    return device.type === 'stairs' || (device.ch !== null && device.ch !== undefined);
}
