// =============================================================
// CONFIG - kiểm tra cấu hình nhà và dựng bảng tra nhanh
// -------------------------------------------------------------
// Cấu hình là NGUỒN DUY NHẤT về tầng / phòng / thiết bị / ESP.
// Giao diện không hề viết cứng tên phòng hay tên đèn nào.
// (Đọc / lưu / sửa cấu hình: xem core/homeData.js)
// =============================================================

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Góc servo mặc định (độ): gạt công tắc sang BẬT, sang TẮT, rồi về góc NGHỈ
 * (về nghỉ để tay người vẫn bấm công tắc được, servo không bị ghì).
 */
export const SERVO_DEFAULTS = { on: 45, off: 135, rest: 90 };

/**
 * Tìm thiết bị dùng TRÙNG KÊNH trên cùng 1 ESP (2 đèn chung 1 chân -> bấm 1 cái gạt luôn cái kia).
 * Trả về Map: key thiết bị -> thiết bị đang trùng với nó.
 */
export function channelConflicts(home) {
    const seen = new Map();
    const out = new Map();
    home.allDevices.forEach(d => {
        if (d.type === 'stairs' || d.node === null || d.node === undefined || d.ch === null || d.ch === undefined) return;
        const slot = `${d.node}:${d.ch}`;
        const other = seen.get(slot);
        if (other) {
            out.set(d.key, other);
            if (!out.has(other.key)) out.set(other.key, d);
        } else {
            seen.set(slot, d);
        }
    });
    return out;
}

/** Thiết bị nào (ngoài "exceptKey") đang dùng kênh ch của ESP node? */
export function deviceOnChannel(home, node, ch, exceptKey) {
    if (node === null || node === undefined || ch === null || ch === undefined) return null;
    return home.allDevices.find(d => d.key !== exceptKey && d.type !== 'stairs' && d.node === node && d.ch === ch) || null;
}

/** Đèn cầu thang cũng tính là "đèn" (đếm số đèn bật, kịch bản tắt hết đèn...). */
export const isLight = device => device.type === 'light' || device.type === 'stairs';

export class ConfigError extends Error {
    constructor(problems) {
        super('Cấu hình nhà có lỗi');
        this.problems = problems;
    }
}

/**
 * Kiểm tra dữ liệu và dựng sẵn các bảng tra nhanh.
 * Mỗi thiết bị có một "key" duy nhất trong cả nhà: "<mã phòng>/<mã thiết bị>"
 *   ví dụ: "t1-phong-khach/den-to"
 * Mỗi ESP (node) có số id: 0 = trung tâm (ESP32-S3), 1, 2, 3... = các ESP32-C3.
 */
export function parseHome(data) {
    const problems = [];
    const nodes = new Map();
    const rooms = new Map();
    const devices = new Map();

    if (!data || !Array.isArray(data.floors)) {
        throw new ConfigError(['Thiếu danh sách "floors" (các tầng).']);
    }

    // ----- Bộ điều khiển ESP -----
    (data.nodes || []).forEach(n => {
        if (!Number.isInteger(n.id) || n.id < 0 || n.id > 250) {
            problems.push(`Số ESP không hợp lệ: "${n.id}" (phải là số nguyên 0–250)`);
            return;
        }
        if (nodes.has(n.id)) problems.push(`Trùng số ESP: ${n.id}`);
        nodes.set(n.id, {
            id: n.id,
            name: n.name || `ESP ${n.id}`,
            board: n.board || (n.id === 0 ? 'ESP32-S3' : 'ESP32-C3')
        });
    });

    const checkNode = (id, where) => {
        if (id !== null && !nodes.has(id)) problems.push(`${where} gán vào ESP số ${id}, nhưng không có ESP này trong "nodes"`);
    };

    // ----- Tầng -> phòng -> thiết bị -----
    const floors = data.floors.map(f => {
        // type "stairs" = khu cầu thang (nằm giữa 2 tầng, có màn hình điều khiển riêng)
        const floor = { id: f.id, name: f.name || f.id, type: f.type === 'stairs' ? 'stairs' : 'floor', rooms: [] };
        if (!ID_PATTERN.test(f.id || '')) problems.push(`Mã tầng không hợp lệ: "${f.id}"`);

        (f.rooms || []).forEach(r => {
            const room = { id: r.id, name: r.name || r.id, node: r.node ?? null, floor, devices: [] };
            if (!ID_PATTERN.test(r.id || '')) problems.push(`Mã phòng không hợp lệ: "${r.id}"`);
            if (rooms.has(r.id)) problems.push(`Trùng mã phòng: "${r.id}"`);
            checkNode(room.node, `Phòng "${room.name}"`);
            rooms.set(r.id, room);

            (r.devices || []).forEach(d => {
                const key = `${r.id}/${d.id}`;
                if (!ID_PATTERN.test(d.id || '')) problems.push(`Mã thiết bị không hợp lệ: "${d.id}" (phòng ${r.id})`);
                if (devices.has(key)) problems.push(`Trùng mã thiết bị: "${key}"`);
                const ownNode = d.node ?? null;
                checkNode(ownNode, `Thiết bị "${d.name || d.id}"`);
                if (d.type === 'stairs' && !(Number.isInteger(d.steps) && d.steps >= 2 && d.steps <= 32)) {
                    problems.push(`Cầu thang "${d.name || d.id}" cần số bậc "steps" từ 2 đến 32`);
                }
                const device = {
                    key,
                    id: d.id,
                    name: d.name || d.id,
                    type: d.type || 'light',
                    ch: d.ch ?? null,
                    steps: d.steps ?? null,     // cầu thang: số bậc
                    driver: d.driver ?? null,   // cầu thang: mạch điều khiển (mcp23017 | pca9685)
                    // Cách bật tắt: 'servo' = SG90 gạt công tắc tường (không đụng 220V), 'relay' = rơ-le
                    actuator: d.type === 'stairs' ? null : (d.actuator === 'relay' ? 'relay' : d.actuator === 'servo' ? 'servo' : 'relay'),
                    servo: d.actuator === 'servo' ? { ...SERVO_DEFAULTS, ...d.servo } : null,
                    // Module relay kích mức THẤP (LOW = bật): nhiều module relay 5V loại phổ biến là kiểu này
                    relayLow: d.type !== 'stairs' && d.actuator !== 'servo' && d.relayLow === true,
                    ownNode,                   // ESP ghi riêng cho thiết bị (nếu có)
                    node: ownNode ?? room.node, // ESP thực sự điều khiển
                    room,
                    floor
                };
                devices.set(key, device);
                room.devices.push(device);
            });

            floor.rooms.push(room);
        });
        return floor;
    });

    if (problems.length) throw new ConfigError(problems);

    return {
        name: data.home || 'Nhà của tôi',
        floors,
        rooms,
        devices,
        nodes,
        allDevices: [...devices.values()],
        raw: data
    };
}
