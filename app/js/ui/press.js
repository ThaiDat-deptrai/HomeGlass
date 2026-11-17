// =============================================================
// PRESS - hiệu ứng "chạm" kiểu iPhone cho mọi khối bấm được
// -------------------------------------------------------------
// Vì sao không dùng :active của CSS? Trên điện thoại, :active chỉ bật
// trong tích tắc (hoặc không bật nếu chạm nhanh) -> gần như không thấy.
// Ở đây: chạm vào -> khối lún xuống + hơi mờ NGAY; nhấc tay -> nảy lên
// theo đường cong lò xo. Ngón tay bắt đầu cuộn/vuốt -> khối nhả ra luôn.
//
// Dùng thuộc tính "scale" riêng (không phải "transform") qua Web Animations,
// nên không đụng tới các chuyển động khác của khối (trượt, xoay...).
// =============================================================

import { reducedMotion } from './motion.js';

export const PRESSABLE = [
    '.tile', '.chip', '.scene', '.btn-pill', '.scene__run', '.icon-btn',
    '.stairs__power', '.effect-pick button', '.type-pick button', '.icon-pick button',
    '.tabbar a', '.bg-pick', '.swatch', '.manage-item', '.manage-add', '.legend__item',
    '.orb', '.ask button', '.row--link', '.segmented button', '.tri button', '.switch',
    '.sheet__close', '.room__empty'
].join(', ');

// Khối to lún ít, nút nhỏ lún nhiều hơn (giống iOS)
const BIG = '.tile, .scene, .manage-item, .bg-pick, .row--link, .manage-add, .room__empty';

const MOVE_CANCEL = 10;  // px: di chuyển quá mức này là đang cuộn/vuốt -> nhả
const MIN_HOLD = 90;     // ms: chạm thật nhanh vẫn kịp thấy khối lún

const SPRING = CSS.supports('transition-timing-function', 'linear(0, 1)')
    ? 'linear(0, 0.0336, 0.1191, 0.236, 0.3677, 0.5017, 0.6286, 0.7426, 0.84, 0.9194, 0.9811, 1.0261, 1.0564, 1.0744, 1.0825, 1.083, 1.078, 1.0695, 1.0591, 1.0479, 1.0369, 1.0267, 1.0177, 1.0103, 1.0043, 0.9998, 0.9966, 0.9945, 0.9934, 0.993, 0.9932, 0.9938, 0.9946, 0.9955, 0.9964, 0.9973, 0.9981, 0.9988, 0.9994, 0.9998, 1)'
    : 'cubic-bezier(0.34, 1.56, 0.64, 1)';

function pressDown(el) {
    const depth = el.matches(BIG) ? 0.965 : 0.9;
    el._press?.cancel();
    el._press = el.animate(
        [{ scale: 1, opacity: 1 }, { scale: depth, opacity: 0.82 }],
        { duration: 120, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }
    );
}

function pressUp(el) {
    const cs = getComputedStyle(el);
    const from = { scale: cs.scale === 'none' ? 1 : Number(cs.scale), opacity: Number(cs.opacity) };
    el._press?.cancel();
    el._press = el.animate([from, { scale: 1, opacity: 1 }], { duration: 620, easing: SPRING });
}

export function enablePress(root = document) {
    if (reducedMotion()) return;
    let el = null;
    let x0 = 0;
    let y0 = 0;
    let since = 0;

    const release = () => {
        if (!el) return;
        const target = el;
        el = null;
        const wait = Math.max(0, MIN_HOLD - (performance.now() - since));
        setTimeout(() => pressUp(target), wait);
    };

    root.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const target = e.target.closest(PRESSABLE);
        if (!target || target.disabled) return;
        release();
        el = target;
        x0 = e.clientX;
        y0 = e.clientY;
        since = performance.now();
        pressDown(el);
    }, { passive: true });

    root.addEventListener('pointermove', e => {
        if (el && Math.hypot(e.clientX - x0, e.clientY - y0) > MOVE_CANCEL) release();
    }, { passive: true });

    root.addEventListener('pointerup', release, { passive: true });
    root.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('scroll', release, { passive: true });
}
