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

    // ---------- Vuốt để đổi tab (trang bên cạnh chạy theo ngón tay) ----------
    // Lúc bắt đầu vuốt: dựng sẵn trang bên cạnh ở một lớp cố định, nằm sát mép màn hình.
    // Kéo tay: cả 2 trang cùng dịch theo ngón tay (chỉ đổi transform -> rất nhẹ).
    // Thả tay: đủ xa/đủ nhanh thì trượt hẳn sang trang mới, không thì trượt về.
    let peek = null; // { path, view, cleanup, dir }

    function targetOf(dx) {
        const route = routes[current.path];
        if (route.parent) return dx > 0 ? route.parent : null; // màn hình con: chỉ vuốt về
        const i = tabs.indexOf(current.path) + (dx < 0 ? 1 : -1);
        return tabs[i] || null;
    }

    function mountPeek(path, dir) {
        const cs = getComputedStyle(root);
        const r = root.getBoundingClientRect();
        const padL = parseFloat(cs.paddingLeft);
        const padR = parseFloat(cs.paddingRight);
        const view = document.createElement('div');
        view.className = 'view view--peek is-moving';
        Object.assign(view.style, {
            top: `${parseFloat(cs.paddingTop)}px`,
            left: `${r.left + padL}px`,
            width: `${r.width - padL - padR}px`,
            transform: `translateX(${dir * window.innerWidth}px)`
        });
        document.body.appendChild(view);
        return { path, view, dir, cleanup: routes[path].mount(view, ctx) };
    }

    function dropPeek() {
        if (!peek) return;
        if (typeof peek.cleanup === 'function') peek.cleanup();
        peek.view.remove();
        peek = null;
    }

    /** Trang "ló" trở thành trang chính (không dựng lại, giữ nguyên những gì đã vẽ). */
    function adoptPeek() {
        const p = peek;
        peek = null;
        if (typeof current?.cleanup === 'function') current.cleanup();
        p.view.getAnimations().forEach(a => a.cancel());
        p.view.classList.remove('view--peek', 'is-moving');
        p.view.removeAttribute('style');
        const credit = root.querySelector('.credit');
        root.replaceChildren(p.view, credit);
        current = { path: p.path, view: p.view, cleanup: p.cleanup };
        paintTabbar(p.path);
        window.scrollTo(0, 0);
        // Đổi địa chỉ cho khớp; hashchange thấy trùng trang hiện tại nên bỏ qua
        const hash = p.path === '/' ? '#/' : '#' + p.path;
        if (location.hash !== hash) location.hash = hash;
    }

    /** Đặt vị trí 2 trang theo độ lệch x của trang hiện tại. */
    function placePages(x) {
        current.view.style.transform = `translateX(${x}px)`;
        if (peek) peek.view.style.transform = `translateX(${x + peek.dir * window.innerWidth}px)`;
    }

    function settleSwipe(commit, velocity) {
        const W = window.innerWidth;
        const v = current.view;
        const from = dragX;
        const to = commit ? -peek.dir * W : 0;
        const distance = Math.abs(to - from);
        // Hất nhanh -> trượt nhanh; kéo chậm -> trượt êm. Luôn trong 160–420 ms.
        const speed = Math.max(Math.abs(velocity), 0.9);
        const duration = reducedMotion() ? 0 : Math.round(Math.min(420, Math.max(160, distance / speed)));
        const easing = commit ? 'cubic-bezier(0.2, 0.75, 0.25, 1)' : EASE_SPRING;
        tabbar.classList.remove('is-dragging');
        dragX = 0;

        const anims = [v.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration, easing, fill: 'forwards' })];
        if (peek) {
            const p0 = from + peek.dir * W;
            const p1 = to + peek.dir * W;
            anims.push(peek.view.animate([{ transform: `translateX(${p0}px)` }, { transform: `translateX(${p1}px)` }], { duration, easing, fill: 'forwards' }));
        }
        if (commit) paintTabbar(peek.path);
        else paintTabbar(current.path);

        anims[0].onfinish = () => {
            if (commit) {
                adoptPeek();
            } else {
                anims.forEach(a => a.cancel());
                v.style.transform = '';
                v.classList.remove('is-moving');
                dropPeek();
            }
        };
    }

    onSwipe(root, {
        start(dx) {
            if (routes[current.path].parent && dx < 0) return false;
            dropPeek();
            current.view.classList.add('is-moving');
            const target = targetOf(dx);
            if (target) peek = mountPeek(target, dx < 0 ? 1 : -1);
            return true;
        },
        move(dx) {
            const W = window.innerWidth;
            // Có trang bên cạnh: bám ngón tay 1:1. Ở mép (không còn trang): kéo nặng tay.
            const towardPeek = peek && Math.sign(dx) === -peek.dir;
            dragX = towardPeek ? dx : rubber(dx, W) * 0.35;
            placePages(dragX);
            if (towardPeek) {
                tabbar.classList.add('is-dragging');
                links.style.setProperty('--i', tabIndex(current.path) + peek.dir * Math.min(1, Math.abs(dx) / W));
            }
        },
        end(dx, velocity) {
            const step = decide(dx, velocity, window.innerWidth);
            const commit = !!peek && step === peek.dir && Math.sign(dx) === -peek.dir;
            settleSwipe(commit, velocity);
        },
        cancel: () => settleSwipe(false, 0)
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
