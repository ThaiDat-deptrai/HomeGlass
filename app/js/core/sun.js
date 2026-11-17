// =============================================================
// SUN - giờ mặt trời mọc / lặn (công thức NOAA rút gọn)
// -------------------------------------------------------------
// ESP trung tâm tính y hệt, không cần Internet. Mặc định toạ độ giữa
// Việt Nam; thêm "location": { "lat": ..., "lon": ... } vào home.json
// để chính xác hơn. Kết quả: phút trong ngày theo giờ Việt Nam (GMT+7).
// =============================================================

const RAD = Math.PI / 180;

function solar(date, { lat = 16, lon = 106 } = {}) {
    const start = new Date(date.getFullYear(), 0, 0);
    const day = Math.floor((date - start) / 864e5);
    const g = (2 * Math.PI / 365) * (day - 1);
    const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
        - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
        + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = Math.acos(Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl))
        - Math.tan(lat * RAD) * Math.tan(decl)) / RAD;
    return { lon, ha, eqtime };
}

export function sunsetMinutes(date, location, tz = 7) {
    const { lon, ha, eqtime } = solar(date, location);
    return Math.round(720 - 4 * (lon - ha) - eqtime + tz * 60);
}

export function sunriseMinutes(date, location, tz = 7) {
    const { lon, ha, eqtime } = solar(date, location);
    return Math.round(720 - 4 * (lon + ha) - eqtime + tz * 60);
}

export const formatMinutes = m => {
    const v = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
