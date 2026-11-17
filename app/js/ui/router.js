// =============================================================
// ROUTER - đổi màn hình theo địa chỉ (#/, #/scenes, ...)
// -------------------------------------------------------------
// - Mỗi màn hình là 1 hàm: mount(root, ctx) -> trả về hàm dọn dẹp.
// - Chuyển trang kiểu iOS: trang cũ trượt ra, trang mới trượt vào CÙNG LÚC.
// - Vuốt ngang bằng ngón tay để sang tab bên cạnh (trang bám theo ngón tay).
// - Màn hình con (vd: Quản lý thiết bị) vuốt sang phải để quay lại.
// - Máy tính: vệt sáng trên menu trái chạy theo con trỏ chuột.
//
// Bí quyết cho mượt trên điện thoại: trong lúc trang đang di chuyển,
// tạm tắt hiệu ứng kính mờ (class "is-moving") vì làm mờ lại nền
// ở mỗi khung hình rất nặng. Nền là màu loang nên mắt gần như không thấy khác.
// =============================================================

import { onSwipe, decide, rubber } from './swipe.js';
import { reducedMotion, EASE_IOS, EASE_SPRING } from './motion.js';

const EASE_OUT = 'cubic-bezier(0.4, 0, 1, 1)';

export function createRouter({ root, tabbar, routes, tabs, ctx }) {
    let current = null;   // { path, view, cleanup }
    let dragX = 0;        // trang đang bị kéo lệch bao nhiêu px (để trượt tiếp cho liền mạch)
    const links = tabbar.querySelector('.tabbar__links');
    const linkEls = [...links.querySelectorAll('a')];
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
        linkEls.forEach(a => {
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
     * Đổi trang. dir: +1 = sang phải (tab sau), -1 = sang trái, 0 = không hiệu ứng.
     * Trang cũ được "tách" ra một lớp cố định để trượt đi, trong khi trang mới trượt vào.
     */
    function go(path, dir) {
        const old = current?.view;
        const animate = dir && old && !reducedMotion();
        let ghost = null;

        if (animate) {
            old.style.transform = ''; // đo vị trí gốc (chưa tính phần đang bị kéo lệch)
            const r = old.getBoundingClientRect();
            ghost = old;
            ghost.classList.add('view--ghost', 'is-moving');
            Object.assign(ghost.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px` });
            document.body.appendChild(ghost); // rời khỏi #app nên không bị xóa khi gắn trang mới
        }

        mountView(path);
        window.scrollTo(0, 0);
        if (!animate) return;

        const distance = Math.min(root.clientWidth * 0.32, 180);
        ghost.animate(
            [
                { transform: `translateX(${dragX}px)`, opacity: 1 },
                { transform: `translateX(${-dir * distance}px)`, opacity: 0 }
            ],
            { duration: 240, easing: EASE_OUT, fill: 'forwards' }
        ).onfinish = () => ghost.remove();

        const view = current.view;
        view.classList.add('is-moving');
        const enter = view.animate(
            [
                { transform: `translateX(${dir * distance}px)`, opacity: 0 },
                { transform: 'translateX(0)', opacity: 1 }
            ],
            { duration: 420, easing: EASE_IOS }
        );
        enter.onfinish = enter.oncancel = () => view.classList.remove('is-moving');
        dragX = 0;
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
        dragX = 0;
        if (!from || reducedMotion()) {
            v.classList.remove('is-moving');
            return;
        }
        const back = v.animate([{ transform: from }, { transform: 'translateX(0)' }], { duration: 480, easing: EASE_SPRING });
        back.onfinish = back.oncancel = () => v.classList.remove('is-moving');
    }

    onSwipe(root, {
        start(dx) {
            if (routes[current.path].parent && dx < 0) return false;
            current.view.classList.add('is-moving');
            return true;
        },
        move(dx) {
            const w = root.clientWidth;
            const target = targetOf(dx);
            dragX = target ? dx * 0.85 : rubber(dx, w) * 0.35;
            current.view.style.transform = `translateX(${dragX}px)`;
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

    // ---------- Máy tính: menu trái bám theo con trỏ chuột ----------
    links.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const a = e.target.closest('a');
        if (!a) return;
        links.style.setProperty('--h', linkEls.indexOf(a));
        links.classList.add('is-hovering');
    });
    links.addEventListener('pointerleave', () => links.classList.remove('is-hovering'));
    tabbar.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const r = tabbar.getBoundingClientRect();
        tabbar.style.setProperty('--mx', `${e.clientX - r.left}px`);
        tabbar.style.setProperty('--my', `${e.clientY - r.top}px`);
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
