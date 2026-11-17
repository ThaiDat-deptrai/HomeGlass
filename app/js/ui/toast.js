// =============================================================
// TOAST - thông báo nhỏ hiện vài giây rồi tự tắt
// =============================================================

const ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    info: 'fa-circle-info'
};

export function toast(message, type = 'info', ms = 2600) {
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<i class="fa-solid ${ICONS[type] || ICONS.info}"></i><span></span>`;
    el.querySelector('span').textContent = message;
    root.appendChild(el);

    // Chỉ giữ tối đa 3 thông báo cùng lúc
    while (root.children.length > 3) root.firstElementChild.remove();

    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, ms);
}
