// =============================================================
// WHEEL - lăn chuột trên các thanh chọn để đổi lựa chọn (máy tính)
// -------------------------------------------------------------
// Rê chuột lên thanh "Tầng 1 | Cầu thang | Tầng 2", thanh "1 giờ | 6 giờ | 24 giờ",
// các thanh chọn dạng viên thuốc khác, hoặc menu bên trái -> lăn chuột:
//   lăn xuống / sang phải = mục kế tiếp, lăn lên / sang trái = mục trước.
// Dùng lại đúng cú "bấm" của mục đó nên mọi hiệu ứng đều chạy như khi bấm tay.
// =============================================================

const STEP_DELTA = 60;   // lăn bao nhiêu thì đổi 1 mục (bánh xe chuột thường ~100 mỗi nấc)
const COOLDOWN_MS = 220; // nghỉ giữa 2 lần đổi, để lăn nhanh không nhảy quá nhiều mục

export function enableWheelSwitch() {
    let acc = 0;
    let lastTarget = null;
    let lastFire = 0;

    window.addEventListener('wheel', e => {
        const bar = e.target.closest('.segmented, .tabbar__links');
        if (!bar || e.ctrlKey) return; // ctrl + lăn = phóng to trang, để nguyên
        e.preventDefault(); // đang ở trên thanh chọn: lăn để đổi mục, không cuộn trang

        if (bar !== lastTarget) {
            acc = 0;
            lastTarget = bar;
        }
        acc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        const now = performance.now();
        if (Math.abs(acc) < STEP_DELTA || now - lastFire < COOLDOWN_MS) return;

        const dir = Math.sign(acc);
        acc = 0;
        lastFire = now;

        const items = bar.classList.contains('tabbar__links')
            ? [...bar.querySelectorAll('a')]
            : [...bar.querySelectorAll('button:not([disabled])')];
        const current = items.findIndex(el => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page');
        const next = items[Math.max(0, Math.min(items.length - 1, current + dir))];
        if (next && next !== items[current]) next.click();
    }, { passive: false });
}

// =============================================================
// ĐIỆN THOẠI: lướt ngón tay dọc thanh chọn -> mục được chọn chạy theo ngón tay
// (giống thanh chọn của iPhone). Dùng cho mọi thanh viên thuốc + thanh tab dưới cùng.
// =============================================================
const BARS = '.segmented, .tabbar__links';
const SLIDE_LOCK = 8; // px: lướt ngang bao nhiêu thì nhận là đang lướt trên thanh

const itemsOf = bar => (bar.classList.contains('tabbar__links')
    ? [...bar.querySelectorAll('a')]
    : [...bar.querySelectorAll('button:not([disabled])')]);

const selectedOf = bar => itemsOf(bar).find(el => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page') || null;

/** Mục nằm dưới ngón tay (lướt quá 2 đầu thì lấy mục đầu / cuối). */
function itemAt(bar, x) {
    const items = itemsOf(bar);
    if (!items.length) return null;
    const rects = items.map(el => el.getBoundingClientRect());
    if (x <= rects[0].left) return items[0];
    if (x >= rects[rects.length - 1].right) return items[items.length - 1];
    return items.find((el, i) => x >= rects[i].left && x <= rects[i].right) || null;
}

export function enableTouchSlide() {
    let bar = null;
    let id = null;
    let x0 = 0;
    let y0 = 0;
    let sliding = false;
    let last = null;
    let swallowUntil = 0;

    window.addEventListener('pointerdown', e => {
        bar = null;
        if (e.pointerType === 'mouse') return;
        const b = e.target.closest?.(BARS);
        if (!b) return;
        bar = b;
        id = e.pointerId;
        x0 = e.clientX;
        y0 = e.clientY;
        sliding = false;
        last = selectedOf(b);
    }, true);

    window.addEventListener('pointermove', e => {
        if (!bar || e.pointerId !== id) return;
        if (!sliding) {
            const dx = Math.abs(e.clientX - x0);
            const dy = Math.abs(e.clientY - y0);
            if (dy > SLIDE_LOCK && dy > dx) { bar = null; return; } // đang cuộn dọc: bỏ
            if (dx < SLIDE_LOCK) return;
            sliding = true;
        }
        e.hgSwipeClaimed = true; // báo cho cử chỉ vuốt trang: cú này đã có chủ
        const item = itemAt(bar, e.clientX);
        if (item && item !== last) {
            last = item;
            item.click(); // dùng đúng cú "bấm" của mục đó -> mọi hiệu ứng, tiếng, rung đều chạy
        }
    }, true);

    const end = e => {
        if (!bar || e.pointerId !== id) return;
        if (sliding) swallowUntil = performance.now() + 350; // chặn cú click đi kèm lúc nhấc tay
        bar = null;
        sliding = false;
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);

    window.addEventListener('click', e => {
        if (e.isTrusted && performance.now() < swallowUntil && e.target.closest?.(BARS)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
}
