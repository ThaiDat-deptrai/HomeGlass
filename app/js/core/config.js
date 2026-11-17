// =============================================================
// CONFIG - đọc và kiểm tra file khai báo nhà (config/home.json)
// -------------------------------------------------------------
// Đây là NGUỒN DUY NHẤT về tầng / phòng / thiết bị.
// Giao diện không hề viết cứng tên phòng hay tên đèn nào.
// =============================================================

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class ConfigError extends Error {
    constructor(problems) {
        super('Cấu hình nhà có lỗi');
        this.problems = problems;
    }
}

export async function loadHome(url) {
    let data;
    try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
    } catch (e) {
        throw new ConfigError(['Không đọc được file ' + url + ' (' + e.message + ')']);
    }
    return parseHome(data);
}

/**
 * Kiểm tra dữ liệu và dựng sẵn các bảng tra nhanh.
 * Mỗi thiết bị có một "key" duy nhất trong cả nhà: "<mã phòng>/<mã thiết bị>"
 *   ví dụ: "t1-phong-khach/den-to"
 */
export function parseHome(data) {
    const problems = [];
    const rooms = new Map();
    const devices = new Map();

    if (!data || !Array.isArray(data.floors)) {
        throw new ConfigError(['Thiếu danh sách "floors" (các tầng).']);
    }

    const floors = data.floors.map(f => {
        const floor = { id: f.id, name: f.name || f.id, rooms: [] };
        if (!ID_PATTERN.test(f.id || '')) problems.push(`Mã tầng không hợp lệ: "${f.id}"`);

        (f.rooms || []).forEach(r => {
            const room = { id: r.id, name: r.name || r.id, node: r.node ?? null, floor, devices: [] };
            if (!ID_PATTERN.test(r.id || '')) problems.push(`Mã phòng không hợp lệ: "${r.id}"`);
            if (rooms.has(r.id)) problems.push(`Trùng mã phòng: "${r.id}"`);
            rooms.set(r.id, room);

            (r.devices || []).forEach(d => {
                const key = `${r.id}/${d.id}`;
                if (!ID_PATTERN.test(d.id || '')) problems.push(`Mã thiết bị không hợp lệ: "${d.id}" (phòng ${r.id})`);
                if (devices.has(key)) problems.push(`Trùng mã thiết bị: "${key}"`);
                const device = {
                    key,
                    id: d.id,
                    name: d.name || d.id,
                    type: d.type || 'light',
                    ch: d.ch ?? null,
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
        allDevices: [...devices.values()]
    };
}
