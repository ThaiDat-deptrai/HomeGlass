// =============================================================
// SHEET - bảng trượt lên từ dưới (dùng cho form tạo/sửa)
// -------------------------------------------------------------
// Đóng bằng: nút X, bấm ra ngoài, phím Esc, hoặc KÉO XUỐNG (như iOS).
// =============================================================

import { EASE_IOS } from './motion.js';

/**
 * openSheet({ title, body(el, close), footer(el, close) })
 * - body: hàm dựng nội dung
 * - footer: hàm dựng hàng nút dưới cùng (không bắt buộc)
 */
export function openSheet({ title, body, footer, onClose }) {
    const root = document.getElementById('sheet-root');
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.innerHTML = `
        <div class="sheet card" role="dialog" aria-modal="true">
            <div class="sheet__drag">
                <div class="sheet__grip"></div>
                <header class="sheet__head">
                    <h2></h2>
                    <button class="sheet__close" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>
                </header>
            </div>
            <div class="sheet__body"></div>
            <footer class="sheet__foot"></footer>
        </div>`;
    overlay.querySelector('h2').textContent = title;
    const sheet = overlay.querySelector('.sheet');
    let closed = false;

    function close() {
        if (closed) return;
        closed = true;
        overlay.classList.remove('show');
        if (!root.querySelector('.sheet-overlay.show')) document.documentElement.classList.remove('has-sheet');
        try { onClose?.(); } catch (e) { /* bỏ qua */ }
        document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.remove(), 360);
    }
    function onKey(e) {
        if (e.key === 'Escape') close();
    }

    overlay.addEventListener('click', e => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('.sheet__close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    // ----- Kéo xuống để đóng -----
    const handle = overlay.querySelector('.sheet__drag');
    let startY = null;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    handle.addEventListener('pointerdown', e => {
        if (e.target.closest('.sheet__close')) return;
        startY = lastY = e.clientY;
        lastT = e.timeStamp;
        speed = 0;
        handle.setPointerCapture(e.pointerId);
        sheet.style.transition = 'none';
    });
    handle.addEventListener('pointermove', e => {
        if (startY === null) return;
        const dy = Math.max(0, e.clientY - startY);
        const dt = e.timeStamp - lastT;
        if (dt > 0) speed = (e.clientY - lastY) / dt;
        lastY = e.clientY;
        lastT = e.timeStamp;
        sheet.style.transform = `translateY(${dy}px)`;
    });
    const release = e => {
        if (startY === null) return;
        const dy = Math.max(0, e.clientY - startY);
        startY = null;
        sheet.style.transition = '';
        if (dy > 120 || speed > 0.6) {
            sheet.style.transform = '';
            close();
        } else {
            sheet.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 380, easing: EASE_IOS });
            sheet.style.transform = '';
        }
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);

    body(overlay.querySelector('.sheet__body'), close);
    const foot = overlay.querySelector('.sheet__foot');
    if (footer) footer(foot, close);
    else foot.remove();

    root.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.classList.add('show');
        document.documentElement.classList.add('has-sheet'); // trang sau lùi vào (điện thoại)
    });
    return close;
}
