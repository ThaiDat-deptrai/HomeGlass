// =============================================================
// ROUTER - đổi màn hình theo địa chỉ (#/, #/scenes, ...)
// -------------------------------------------------------------
// Mỗi màn hình là 1 hàm: mount(root, ctx) -> trả về hàm dọn dẹp.
// Khi rời màn hình, router gọi hàm dọn dẹp để gỡ các đăng ký nghe.
// =============================================================

export function createRouter({ root, tabbar, routes, ctx }) {
    let cleanup = null;

    function go() {
        const path = location.hash.replace(/^#/, '') || '/';
        const route = routes[path] || routes['/'];

        if (typeof cleanup === 'function') cleanup();
        root.innerHTML = '';
        const view = document.createElement('div');
        view.className = 'view';
        root.appendChild(view);
        cleanup = route.mount(view, ctx);

        tabbar.querySelectorAll('a').forEach(a => {
            if (a.dataset.tab === route.tab) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
        window.scrollTo(0, 0);
    }

    window.addEventListener('hashchange', go);
    go();
}
