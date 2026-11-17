// =============================================================
// ICONS - chọn biểu tượng theo loại thiết bị / tên phòng
// =============================================================

/** Các loại thiết bị app hỗ trợ (thêm loại mới chỉ cần thêm 1 dòng). */
export const DEVICE_TYPES = {
    light: { label: 'Đèn', icon: 'fa-lightbulb' },
    fan: { label: 'Quạt', icon: 'fa-fan' },
    ac: { label: 'Điều hòa', icon: 'fa-snowflake' },
    plug: { label: 'Ổ cắm', icon: 'fa-plug' },
    tv: { label: 'Tivi', icon: 'fa-tv' },
    pump: { label: 'Máy bơm', icon: 'fa-faucet-drip' },
    stairs: { label: 'Cầu thang', icon: 'fa-stairs' },
    other: { label: 'Khác', icon: 'fa-power-off' }
};

const typeOf = device => DEVICE_TYPES[device.type] || DEVICE_TYPES.light;

export const deviceIcon = device => typeOf(device).icon;
export const typeLabel = device => typeOf(device).label;

// Dò theo mã phòng (không dấu). Cái nào khớp trước thì dùng.
const ROOM_ICONS = [
    [/vuon/, 'fa-seedling'],
    [/san/, 'fa-sun'],
    [/phong-khach/, 'fa-couch'],
    [/bep|phong-an/, 'fa-utensils'],
    [/phong-tho/, 'fa-hands-praying'],
    [/phong-ngu/, 'fa-bed'],
    [/phong-tam|toilet|wc/, 'fa-bath'],
    [/cau-thang/, 'fa-stairs'],
    [/gara|garage|xe/, 'fa-car'],
    [/lam-viec|hoc/, 'fa-laptop']
];

export function roomIcon(room) {
    const hit = ROOM_ICONS.find(([pattern]) => pattern.test(room.id));
    return hit ? hit[1] : 'fa-door-open';
}
