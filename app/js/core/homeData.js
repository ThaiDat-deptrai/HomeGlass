// =============================================================
// HOME DATA - đọc / lưu / chỉnh sửa cấu hình nhà ngay trong app
// -------------------------------------------------------------
// Nguồn cấu hình:
//   1. File config/home.json (bản gốc trong repo)
//   2. Bản đã chỉnh trong app (lưu trên máy này) - được ưu tiên
//
// Khi có MQTT (giai đoạn lõi), bản chỉnh sẽ được gửi lên broker để
// cả nhà và ESP trung tâm cùng nhận -> thêm thiết bị KHÔNG cần sửa code.
//
// Các hàm sửa đều "thuần": nhận dữ liệu cũ, trả về bản sao mới,
// không đụng vào bản cũ (dễ kiểm tra, dễ hoàn tác).
// =============================================================

const LOCAL_KEY = 'hg.home.local';

export async function fetchHomeFile(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Không đọc được ${url} (HTTP ${res.status})`);
    return res.json();
}

export function readLocal() {
    try {
        return JSON.parse(localStorage.getItem(LOCAL_KEY));
    } catch (e) {
        return null;
    }
}

export function writeLocal(data) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

export function clearLocal() {
    localStorage.removeItem(LOCAL_KEY);
}

/** Tải cấu hình hiện tại về máy dưới dạng file home.json. */
export function downloadJson(data, filename = 'home.json') {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Tạo mã từ tên ----------

/** "Đèn phòng khách" -> "den-phong-khach" */
export function slugify(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'muc';
}

function uniqueId(base, taken) {
    let id = base;
    let i = 2;
    while (taken.has(id)) id = `${base}-${i++}`;
    return id;
}

const clone = data => structuredClone(data);
const allRooms = data => data.floors.flatMap(f => f.rooms || []);
const findRoom = (data, roomId) => allRooms(data).find(r => r.id === roomId);

function splitKey(key) {
    const i = key.indexOf('/');
    return [key.slice(0, i), key.slice(i + 1)];
}

/** Bỏ các trường rỗng để file JSON gọn gàng. */
function compactDevice(d) {
    const out = { id: d.id, name: d.name, type: d.type || 'light', ch: d.ch ?? null };
    if (d.node !== null && d.node !== undefined) out.node = d.node;
    if (out.type !== 'stairs') {
        out.actuator = d.actuator === 'servo' ? 'servo' : 'relay';
        if (out.actuator === 'servo' && d.servo) out.servo = { on: d.servo.on, off: d.servo.off, rest: d.servo.rest };
    }
    if (out.type === 'stairs') {
        out.steps = d.steps ?? 15;
        out.driver = d.driver ?? 'mcp23017';
        delete out.ch; // cầu thang dùng mạch mở rộng riêng, không dùng 1 relay
    }
    return out;
}

// ---------- Phòng ----------

export function addRoom(data, floorId, { name, node = null }) {
    const next = clone(data);
    const floor = next.floors.find(f => f.id === floorId);
    const taken = new Set(allRooms(next).map(r => r.id));
    const id = uniqueId(`${floorId}-${slugify(name)}`, taken);
    floor.rooms = floor.rooms || [];
    floor.rooms.push({ id, name: name.trim(), node, devices: [] });
    return { data: next, id };
}

export function updateRoom(data, roomId, { name, floorId, node }) {
    const next = clone(data);
    const fromFloor = next.floors.find(f => (f.rooms || []).some(r => r.id === roomId));
    const room = fromFloor.rooms.find(r => r.id === roomId);
    if (name !== undefined) room.name = name.trim();
    if (node !== undefined) room.node = node;
    if (floorId && floorId !== fromFloor.id) {
        fromFloor.rooms = fromFloor.rooms.filter(r => r !== room);
        const to = next.floors.find(f => f.id === floorId);
        to.rooms = to.rooms || [];
        to.rooms.push(room);
    }
    return next;
}

export function removeRoom(data, roomId) {
    const next = clone(data);
    next.floors.forEach(f => { f.rooms = (f.rooms || []).filter(r => r.id !== roomId); });
    return next;
}

// ---------- Thiết bị ----------

export function addDevice(data, roomId, { name, type = 'light', node = null, ch = null, steps = null, driver = null, actuator = 'servo', servo = null }) {
    const next = clone(data);
    const room = findRoom(next, roomId);
    room.devices = room.devices || [];
    const id = uniqueId(slugify(name), new Set(room.devices.map(d => d.id)));
    room.devices.push(compactDevice({ id, name: name.trim(), type, node, ch, steps, driver, actuator, servo }));
    return { data: next, key: `${roomId}/${id}` };
}

/** Sửa thiết bị; nếu đổi phòng thì key đổi theo -> trả về key mới. */
export function updateDevice(data, key, { name, type, roomId, node, ch, steps, driver, actuator, servo }) {
    const next = clone(data);
    const [oldRoomId, deviceId] = splitKey(key);
    const oldRoom = findRoom(next, oldRoomId);
    const device = oldRoom.devices.find(d => d.id === deviceId);

    if (name !== undefined) device.name = name.trim();
    if (type !== undefined) device.type = type;
    if (node !== undefined) device.node = node;
    if (ch !== undefined) device.ch = ch;
    if (steps !== undefined && steps !== null) device.steps = steps;
    if (driver !== undefined && driver !== null) device.driver = driver;
    if (actuator !== undefined && actuator !== null) device.actuator = actuator;
    if (servo !== undefined && servo !== null) device.servo = servo;

    let newKey = key;
    if (roomId && roomId !== oldRoomId) {
        oldRoom.devices = oldRoom.devices.filter(d => d !== device);
        const room = findRoom(next, roomId);
        room.devices = room.devices || [];
        device.id = uniqueId(device.id, new Set(room.devices.map(d => d.id)));
        room.devices.push(device);
        newKey = `${roomId}/${device.id}`;
    }

    const target = findRoom(next, newKey.split('/')[0]);
    target.devices = target.devices.map(d => (d === device ? compactDevice(d) : d));
    return { data: next, key: newKey };
}

export function removeDevice(data, key) {
    const next = clone(data);
    const [roomId, deviceId] = splitKey(key);
    const room = findRoom(next, roomId);
    room.devices = room.devices.filter(d => d.id !== deviceId);
    return next;
}

// ---------- Bộ điều khiển ESP ----------

export function addNode(data, { name, board = 'ESP32-C3' }) {
    const next = clone(data);
    next.nodes = next.nodes || [];
    const id = next.nodes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
    next.nodes.push({ id, name: name.trim() || `ESP ${id}`, board });
    return { data: next, id };
}

export function updateNode(data, id, { name, board }) {
    const next = clone(data);
    const node = next.nodes.find(n => n.id === id);
    if (name !== undefined) node.name = name.trim() || node.name;
    if (board !== undefined) node.board = board;
    return next;
}

/**
 * Chuyển TẤT CẢ phòng/thiết bị đang dùng ESP "from" sang ESP "to"
 * (vd: ESP 2 hỏng, tạm cắm dây sang ESP 5). Kênh giữ nguyên.
 */
export function moveNodeDevices(data, from, to) {
    const next = clone(data);
    allRooms(next).forEach(r => {
        if (r.node === from) r.node = to;
        (r.devices || []).forEach(d => { if (d.node === from) d.node = to; });
    });
    return next;
}

/** Xóa ESP: phòng/thiết bị đang gán vào nó chuyển về "chưa gán". */
export function removeNode(data, id) {
    const next = clone(data);
    next.nodes = (next.nodes || []).filter(n => n.id !== id);
    allRooms(next).forEach(r => {
        if (r.node === id) r.node = null;
        (r.devices || []).forEach(d => { if (d.node === id) delete d.node; });
    });
    return next;
}
