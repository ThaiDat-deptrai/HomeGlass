// =============================================================
// ROUTER - đổi màn hình theo địa chỉ (#/, #/scenes, ...)
// -------------------------------------------------------------
// - Mỗi màn hình là 1 hàm: mount(root, ctx) -> trả về hàm dọn dẹp.
// - Chuyển tab: trang trượt theo hướng (sang phải = tab sau).
// - Vuốt ngang bằng ngón tay để sang tab bên cạnh.
// - Màn hình con (vd: Quản lý thiết bị) vuốt sang phải để quay lại.
// =============================================================

import { onSwipe, decide, rubber } from './swipe.js';
import { slideIn, reducedMotion, EASE_SPRING } from './motion.js';

export function createRouter({ root, tabbar, routes, tabs, ctx }) {
    let current = null; // { path, view, cleanup }
    const links = tabbar.querySelector('.tabbar__links');
    links.style.setProperty('--n', tabs.length);

    const pathNow = () => {
        const p = location.hash.replace(/^#/, '') || '/';
        return routes[p] ? p : '/';
    };

    /** Vị trí trên thanh tab (màn hình con thì tính theo màn hình cha). */
    const tabIndex = path => tabs.indexOf(routes[path].parent || path);

    function direction(from, to) {
        if (!from) return 0;
        if (routes[to].parent === from) return 1;   // vào màn hình con
        if (routes[from].parent === to) return -1;  // quay ra màn hình cha
        return Math.sign(tabIndex(to) - tabIndex(from));
    }

    function paintTabbar(path) {
        const i = tabIndex(path);
        links.style.setProperty('--i', i);
        links.querySelectorAll('a').forEach(a => {
            if (a.dataset.path === tabs[i]) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
    }

    function mountView(path) {
        if (typeof current?.cleanup === 'function') current.cleanup();
        const view = document.createElement('div');
        view.className = 'view';
        const credit = document.createElement('footer');
        credit.className = 'credit';
        credit.innerHTML = `© ${new Date().getFullYear()} HomeGlass · Bản quyền thuộc về <strong>Thái Đạt</strong>`;
        root.replaceChildren(view, credit);
        current = { path, view, cleanup: routes[path].mount(view, ctx) };
        paintTabbar(path);
    }

    /**
     * Đổi trang: trang mới trượt vào theo hướng (tab sau: từ phải, tab trước: từ trái).
     * Tự làm bằng Web Animations nên chạy giống nhau trên mọi trình duyệt, kể cả iPhone đời cũ.
     */
    function go(path, dir) {
        mountView(path);
        window.scrollTo(0, 0);
        if (dir) slideIn(current.view, dir, 56);
    }

    window.addEventListener('hashchange', () => {
        const path = pathNow();
        if (path !== current?.path) go(path, direction(current?.path, path));
    });

    // ---------- Vuốt để đổi tab ----------
    function targetOf(dx) {
        const route = routes[current.path];
        if (route.parent) return dx > 0 ? route.parent : null; // màn hình con: chỉ vuốt về
        const i = tabs.indexOf(current.path) + (dx < 0 ? 1 : -1);
        return tabs[i] || null;
    }

    function springBack() {
        const v = current.view;
        tabbar.classList.remove('is-dragging');
        paintTabbar(current.path);
        const from = v.style.transform;
        v.style.transform = '';
        v.style.opacity = '';
        if (from && !reducedMotion()) {
            v.animate([{ transform: from }, { transform: 'translateX(0)' }], { duration: 520, easing: EASE_SPRING });
        }
    }

    onSwipe(root, {
        start: dx => !routes[current.path].parent || dx > 0,
        move(dx) {
            const w = root.clientWidth;
            const target = targetOf(dx);
            const x = target ? dx * 0.55 : rubber(dx, w) * 0.35;
            current.view.style.transform = `translateX(${x}px)`;
            current.view.style.opacity = String(1 - Math.min(Math.abs(x) / w, 0.6) * 0.5);
            if (target && !routes[current.path].parent) {
                tabbar.classList.add('is-dragging');
                links.style.setProperty('--i', tabIndex(current.path) - Math.max(-1, Math.min(1, dx / w)));
            }
        },
        end(dx, velocity) {
            const step = decide(dx, velocity, root.clientWidth);
            const target = targetOf(dx);
            const wanted = step !== 0 && Math.sign(-dx) === step;
            if (wanted && target) {
                tabbar.classList.remove('is-dragging');
                location.hash = target === '/' ? '#/' : '#' + target;
            } else {
                springBack();
            }
        },
        cancel: springBack
    });

    mountView(pathNow());

    return {
        current: () => current?.path,
        /** Vẽ lại màn hình hiện tại (vd: sau khi sửa cấu hình), giữ vị trí cuộn. */
        refresh() {
            const y = window.scrollY;
            mountView(current.path);
            window.scrollTo(0, y);
        }
    };
}

