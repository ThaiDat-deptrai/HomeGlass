// =============================================================
// SHEET - bảng trượt lên từ dưới (dùng cho form tạo/sửa)
// =============================================================

/**
 * openSheet({ title, body(el, close), footer(el, close) })
 * - body: hàm dựng nội dung
 * - footer: hàm dựng hàng nút dưới cùng (không bắt buộc)
 */
export function openSheet({ title, body, footer }) {
    const root = document.getElementById('sheet-root');
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.innerHTML = `
        <div class="sheet card" role="dialog" aria-modal="true">
            <div class="sheet__grip"></div>
            <header class="sheet__head">
                <h2></h2>
                <button class="sheet__close" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <div class="sheet__body"></div>
            <footer class="sheet__foot"></footer>
        </div>`;
    overlay.querySelector('h2').textContent = title;

    function close() {
        overlay.classList.remove('show');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.remove(), 280);
    }
    function onKey(e) {
        if (e.key === 'Escape') close();
    }

    overlay.addEventListener('click', e => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('.sheet__close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    body(overlay.querySelector('.sheet__body'), close);
    const foot = overlay.querySelector('.sheet__foot');
    if (footer) footer(foot, close);
    else foot.remove();

    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    return close;
}
