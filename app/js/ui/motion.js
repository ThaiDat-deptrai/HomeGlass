// =============================================================
// MOTION - các hiệu ứng chuyển động nhỏ (dùng Web Animations API)
// -------------------------------------------------------------
// Nguyên tắc cho mượt: chỉ animate transform và opacity
// (card đồ họa xử lý được, không bắt trình duyệt vẽ lại bố cục).
// =============================================================

export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Lò xo thật (giải phương trình dao động tắt dần theo từng khung hình).
 * Khác đường cong cố định: lò xo NHẬN VẬN TỐC ban đầu -> hất tay nhanh thì
 * trang bay tiếp nhanh, kéo chậm thì trượt êm. Đây là "bí mật" cảm giác iOS.
 *   from, to: giá trị đầu/cuối   velocity: đơn vị/giây lúc bắt đầu
 *   stiffness, damping: độ cứng, độ hãm (mặc định gần với iOS)
 */
export function spring({ from, to, velocity = 0, stiffness = 230, damping = 30, onUpdate, onDone }) {
    let x = from;
    let v = velocity;
    let last = performance.now();
    let frame = 0;
    let finished = false;

    const done = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        clearTimeout(safety);
        onUpdate(to);
        onDone?.();
    };

    const step = now => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const n = Math.max(1, Math.ceil(dt / 0.004)); // chia nhỏ bước để ổn định
        const h = dt / n;
        for (let i = 0; i < n; i++) {
            const a = -stiffness * (x - to) - damping * v;
            v += a * h;
            x += v * h;
        }
        onUpdate(x);
        if (Math.abs(x - to) < 0.0015 && Math.abs(v) < 0.05) return done();
        frame = requestAnimationFrame(step);
    };

    // Dự phòng: trình duyệt ngừng vẽ (thu nhỏ cửa sổ...) thì vẫn kết thúc, không bị kẹt
    const safety = setTimeout(done, 1500);

    if (reducedMotion()) done();
    else frame = requestAnimationFrame(step);
    return { stop: () => { finished = true; cancelAnimationFrame(frame); clearTimeout(safety); }, finish: done };
}

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
