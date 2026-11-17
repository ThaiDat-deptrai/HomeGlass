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
