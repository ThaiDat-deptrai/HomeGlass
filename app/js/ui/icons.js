// =============================================================
// ICONS - chọn biểu tượng theo loại thiết bị / tên phòng
// =============================================================

export const DEVICE_TYPES = {
    light: { label: 'Đèn', icon: 'fa-lightbulb' },
    fan: { label: 'Quạt', icon: 'fa-fan' },
    plug: { label: 'Ổ cắm', icon: 'fa-plug' },
    lock: { label: 'Khóa', icon: 'fa-lock' }
};

export const deviceIcon = device => (DEVICE_TYPES[device.type] || DEVICE_TYPES.light).icon;

// Dò theo mã phòng (không dấu). Cái nào khớp trước thì dùng.
const ROOM_ICONS = [
    [/vuon/, 'fa-seedling'],
    [/san/, 'fa-sun'],
    [/phong-khach/, 'fa-couch'],
    [/bep|phong-an/, 'fa-utensils'],
    [/phong-tho/, 'fa-hands-praying'],
    [/phong-ngu/, 'fa-bed'],
    [/phong-tam|toilet|wc/, 'fa-bath']
];

export function roomIcon(room) {
    const hit = ROOM_ICONS.find(([pattern]) => pattern.test(room.id));
    return hit ? hit[1] : 'fa-door-open';
}
