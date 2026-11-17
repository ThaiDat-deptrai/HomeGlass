// =============================================================
// MOTION - các hiệu ứng chuyển động nhỏ (dùng Web Animations API)
// -------------------------------------------------------------
// Nguyên tắc cho mượt: chỉ animate transform và opacity
// (card đồ họa xử lý được, không bắt trình duyệt vẽ lại bố cục).
// =============================================================

export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Icon "nảy" lên một cái khi thiết bị vừa đổi trạng thái. */
export function pop(el) {
    if (!el || reducedMotion()) return;
    el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
        { duration: 420, easing: EASE_SPRING }
    );
}

/**
 * Đổi số kiểu "lăn": số cũ trượt đi, số mới trượt vào.
 * Số tăng -> lăn lên, số giảm -> lăn xuống.
 */
export function rollNumber(el, value) {
    const old = Number(el.dataset.value);
    el.dataset.value = String(value);
    if (Number.isNaN(old) || old === value || reducedMotion()) {
        el.textContent = String(value);
        return;
    }
    const dir = value > old ? 1 : -1;
    el.animate(
        [
            { transform: 'translateY(0)', opacity: 1 },
            { transform: `translateY(${-40 * dir}%)`, opacity: 0 }
        ],
        { duration: 140, easing: 'ease-in' }
    ).onfinish = () => {
        el.textContent = String(value);
        el.animate(
            [
                { transform: `translateY(${40 * dir}%)`, opacity: 0 },
                { transform: 'translateY(0)', opacity: 1 }
            ],
            { duration: 320, easing: EASE_SPRING }
        );
    };
}

/** Nội dung mới hiện vào: trượt nhẹ theo hướng rồi rõ dần. */
export function slideIn(el, direction = 1, distance = 24) {
    if (!el || reducedMotion()) return;
    el.animate(
        [
            { transform: `translateX(${distance * direction}px)`, opacity: 0 },
            { transform: 'translateX(0)', opacity: 1 }
        ],
        { duration: 380, easing: EASE_IOS }
    );
}

/**
 * Đổi chiều cao một phần tử cho mượt (vd: tầng 1 nhiều phòng hơn tầng 2).
 * Gọi: const done = smoothHeight(el); ...thay nội dung...; done();
 */
export function smoothHeight(el) {
    const from = el.offsetHeight;
    return () => {
        const to = el.offsetHeight;
        if (from === to || reducedMotion()) return;
        el.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: 380, easing: EASE_IOS });
    };
}
