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

// =============================================================
// Hiệu ứng kiểu iPhone (chỉ dùng trên điện thoại - máy tính giữ nguyên)
// =============================================================
const phoneMotion = () => !reducedMotion() && window.matchMedia('(max-width: 1023px)').matches;

/**
 * Các khối hiện lên lần lượt (nổi từ dưới lên + rõ dần), như mở app trên iPhone.
 * Chỉ chạy cho khối đang nhìn thấy; tối đa ~14 khối để không chậm.
 */
export function riseIn(elements, { step = 38, distance = 18, from = 0 } = {}) {
    if (!phoneMotion()) return;
    const list = [...elements].filter(el => el.offsetParent !== null).slice(0, 14);
    list.forEach((el, i) => {
        el.animate(
            [
                { opacity: 0, transform: `translateY(${distance}px) scale(0.97)` },
                { opacity: 1, transform: 'none' }
            ],
            { duration: 560, delay: from + i * step, easing: EASE_SPRING_SOFT, fill: 'backwards' }
        );
    });
}

/** Lò xo mềm (ít nảy) - giống chuyển động mặc định của iOS. */
export const EASE_SPRING_SOFT = CSS.supports('transition-timing-function', 'linear(0, 1)')
    ? 'linear(0, 0.08 3%, 0.27 9%, 0.56 18%, 0.8 27%, 0.94 36%, 1.01 45%, 1.035 54%, 1.03 63%, 1.01 76%, 1)'
    : EASE_IOS;

/** Viên chọn của thanh "Tầng 1 | Cầu thang | Tầng 2" giãn ra rồi co lại khi trượt (kiểu "giọt nước"). */
export function stretch(thumb, dir = 1) {
    if (!thumb || !phoneMotion()) return;
    thumb.animate(
        [
            { scale: '1 1', transformOrigin: dir > 0 ? 'left center' : 'right center' },
            { scale: '1.16 0.9', offset: 0.35 },
            { scale: '1 1' }
        ],
        { duration: 520, easing: 'ease-out' }
    );
}

/** Bật đèn: vòng sáng lan ra từ icon (giống ánh đèn bừng lên). */
export function bloom(tile) {
    if (!tile || !phoneMotion()) return;
    const icon = tile.querySelector('.tile__icon');
    if (!icon) return;
    const ring = document.createElement('span');
    ring.className = 'bloom';
    const r = icon.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    ring.style.left = `${r.left - t.left + r.width / 2}px`;
    ring.style.top = `${r.top - t.top + r.height / 2}px`;
    tile.appendChild(ring);
    ring.animate(
        [{ transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0.55 }, { transform: 'translate(-50%, -50%) scale(5)', opacity: 0 }],
        { duration: 720, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
    ).onfinish = () => ring.remove();
}

/** Icon trên thanh dưới nhún lên khi được chọn. */
export function hop(el) {
    if (!el || !phoneMotion()) return;
    el.animate(
        [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-5px) scale(1.12)', offset: 0.35 }, { transform: 'translateY(0) scale(1)' }],
        { duration: 520, easing: EASE_SPRING }
    );
}

/** Trượt nội dung mới vào theo hướng vuốt (dùng khi đổi mục bằng vuốt trên điện thoại). */
export function swapIn(el, dir = 1) {
    if (!el || !phoneMotion()) return;
    el.animate(
        [
            { transform: `translateX(${dir * 42}%) scale(0.96)`, opacity: 0 },
            { transform: 'none', opacity: 1 }
        ],
        { duration: 520, easing: EASE_SPRING_SOFT }
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
