// =============================================================
// STAIRS - logic đèn cầu thang
// -------------------------------------------------------------
// Phần cứng (xem docs/cau-thang.md):
//   ESP32-C3 super mini -> mạch mở rộng I2C -> mỗi bậc 1 module D4184 -> LED dây đơn sắc
//   - MCP23017: mỗi bậc chỉ BẬT/TẮT (không chỉnh sáng được)
//   - PCA9685 : mỗi bậc chỉnh sáng 0–100% (đủ tính năng: độ sáng, thở, ban đêm dịu, đèn nền)
//
// Logic thật CHẠY TRÊN ESP cầu thang (để điện thoại tắt vẫn hoạt động).
// File này mô tả cùng logic đó để app hiện XEM TRƯỚC đúng như ESP sẽ làm.
// =============================================================

/** Cài đặt mặc định (ESP cũng dùng đúng các giá trị này lần đầu chạy). */
export const STAIRS_DEFAULTS = {
    brightness: 80,      // % độ sáng khi bật
    effect: 'follow',    // cách sáng lần lượt các bậc (xem EFFECTS)
    speed: 90,           // ms giữa 2 bậc khi chạy hiệu ứng
    motion: true,        // tự bật khi cảm biến thấy người
    holdSec: 30,         // hết người bao nhiêu giây thì tắt
    timerMin: 0,         // bật bằng tay thì tự tắt sau bao nhiêu phút (0 = không tự tắt)
    night: true,         // chế độ ban đêm
    nightFrom: '22:00',
    nightTo: '06:00',
    nightLevel: 15,      // % độ sáng ban đêm (đỡ chói mắt khi vừa ngủ dậy)
    nightGuide: true,    // ban đêm: chỉ vài bậc sáng mờ làm "đèn dẫn đường"
    ambient: false,      // đèn nền buổi tối: sáng mờ từ lúc trời tối
    ambientLevel: 8,
    ambientUntil: '23:00'
};

export const EFFECTS = [
    { id: 'follow', label: 'Theo hướng đi', icon: 'fa-person-walking' },
    { id: 'up', label: 'Chạy lên', icon: 'fa-arrow-up' },
    { id: 'down', label: 'Chạy xuống', icon: 'fa-arrow-down' },
    { id: 'center', label: 'Từ giữa ra', icon: 'fa-arrows-up-down' },
    { id: 'all', label: 'Cùng lúc', icon: 'fa-bolt' },
    { id: 'breathe', label: 'Thở', icon: 'fa-wind', needsDimming: true }
];

export const DRIVERS = {
    mcp23017: { label: 'MCP23017', note: 'Mỗi bậc chỉ bật / tắt', dimmable: false },
    pca9685: { label: 'PCA9685', note: 'Mỗi bậc chỉnh sáng được (khuyên dùng)', dimmable: true }
};

/** Mạch này có chỉnh độ sáng được không? */
export const isDimmable = driver => !!DRIVERS[driver]?.dimmable;

const toMinutes = hhmm => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

const nowMinutes = d => d.getHours() * 60 + d.getMinutes();

/** Giờ hiện tại có nằm trong khoảng [from, to) không? (hỗ trợ qua nửa đêm, vd 22:00 -> 06:00) */
export function inWindow(date, from, to) {
    const n = nowMinutes(date);
    const a = typeof from === 'number' ? from : toMinutes(from);
    const b = typeof to === 'number' ? to : toMinutes(to);
    return a <= b ? n >= a && n < b : n >= a || n < b;
}

// Giờ mặt trời: dùng chung với lịch hẹn của kịch bản (xem core/sun.js)
import { sunsetMinutes, formatMinutes } from './sun.js';

export { sunsetMinutes, formatMinutes };

/** Đang trong giờ ban đêm? */
export const isNight = (a, date = new Date()) => a.night && inWindow(date, a.nightFrom, a.nightTo);

/** Đang trong giờ đèn nền (từ lúc mặt trời lặn đến ambientUntil)? Cần mạch chỉnh sáng. */
export const isAmbient = (a, date = new Date(), location, dimmable = true) =>
    dimmable && a.ambient && !isNight(a, date) && inWindow(date, sunsetMinutes(date, location), a.ambientUntil);

/** Bậc dẫn đường ban đêm: bậc đầu, bậc cuối và cứ 3 bậc một bậc ở giữa. */
export const isGuideStep = (i, steps) => i === 0 || i === steps - 1 || i % 3 === 0;

/**
 * Mức sáng mong muốn của từng bậc (0..1).
 * on = đang bật (bằng tay hoặc do có người).
 * dimmable = false (MCP23017): bậc nào sáng thì sáng hết cỡ (chỉ bật/tắt).
 */
export function targetLevels({ on, attrs, steps, date = new Date(), location, dimmable = true }) {
    const a = { ...STAIRS_DEFAULTS, ...attrs };
    const night = isNight(a, date);
    const level = v => (dimmable ? v : v > 0 ? 1 : 0);
    let out;
    if (on) {
        const v = (night ? a.nightLevel : a.brightness) / 100;
        out = Array.from({ length: steps }, () => v);
    } else if (night && a.nightGuide) {
        out = Array.from({ length: steps }, (_, i) => (isGuideStep(i, steps) ? a.nightLevel / 100 / 2 : 0));
    } else if (isAmbient(a, date, location, dimmable)) {
        out = Array.from({ length: steps }, () => a.ambientLevel / 100);
    } else {
        out = Array.from({ length: steps }, () => 0);
    }
    return out.map(level);
}

/**
 * Thứ tự các bậc sáng lên theo hiệu ứng. Trả về mảng "đợt": mỗi đợt là danh sách bậc
 * cùng sáng một lúc. Bậc 0 = bậc dưới cùng.
 */
export function effectOrder(effect, dir, steps) {
    const idx = Array.from({ length: steps }, (_, i) => i);
    const up = idx.map(i => [i]);
    const down = [...idx].reverse().map(i => [i]);
    switch (effect) {
        case 'up': return up;
        case 'down': return down;
        case 'follow': return dir === 'down' ? down : up;
        case 'center': {
            const mid = (steps - 1) / 2;
            const waves = [];
            for (let d = 0; d <= Math.ceil(mid); d++) {
                const wave = idx.filter(i => Math.abs(i - mid) <= d && Math.abs(i - mid) > d - 1);
                if (wave.length) waves.push(wave);
            }
            return waves;
        }
        default: return [idx]; // all, breathe: tất cả cùng lúc
    }
}
