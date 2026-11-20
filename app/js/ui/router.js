// =============================================================
// ROUTER - đổi màn hình theo địa chỉ (#/, #/scenes, ...)
// -------------------------------------------------------------
// - Mỗi màn hình là 1 hàm: mount(root, ctx) -> trả về hàm dọn dẹp.
// - Chuyển trang kiểu iOS (xem ui/transition.js): trang mới trượt đè lên,
//   trang dưới lùi chậm và tối dần; chuyển động theo LÒ XO có đà.
// - Bấm tab hay vuốt đều dùng chung một hiệu ứng -> cảm giác nhất quán.
// - Vuốt: trang bám ngón tay 1:1, thả tay thì lò xo nhận luôn vận tốc vuốt.
// - Màn hình con (vd: Quản lý thiết bị) vuốt sang phải để quay lại.
// - Máy tính: vệt sáng trên menu trái chạy theo con trỏ chuột.
// =============================================================

import { onSwipe, decide, rubber } from './swipe.js';
import { reducedMotion, spring, EASE_SPRING, hop, riseIn } from './motion.js';
import { beginTransition } from './transition.js';
import { logError } from '../core/errlog.js';

export function createRouter({ root, tabbar, routes, tabs, ctx }) {
    let current = null; // { path, view, cleanup }
    let moving = null;  // chuyển trang đang chạy: { t, path, view, cleanup, dir, anim }
    const links = tabbar.querySelector('.tabbar__links');
    const linkEls = [...links.querySelectorAll('a')];
    links.style.setProperty('--n', tabs.length);

    const credit = document.createElement('footer');
    credit.className = 'credit';
    credit.innerHTML = `© ${new Date().getFullYear()} HomeGlass · Bản quyền thuộc về <strong>Thái Đạt</strong>`;

    const pathNow = () => {
        const p = location.hash.replace(/^#/, '') || '/';
        return routes[p] ? p : '/';
    };
    const hashOf = path => (path === '/' ? '#/' : '#' + path);

    /** Vị trí trên thanh tab (màn hình con thì tính theo màn hình cha). */
    const tabIndex = path => tabs.indexOf(routes[path].parent || path);

    function direction(from, to) {
        if (!from) return 0;
        if (routes[to].parent === from) return 1;   // vào màn hình con
        if (routes[from].parent === to) return -1;  // quay ra màn hình cha
        return Math.sign(tabIndex(to) - tabIndex(from));
    }

    let paintedIndex = -1;
    function paintTabbar(path, progress = null) {
        const i = tabIndex(path);
        links.style.setProperty('--i', progress ?? i);
        if (paintedIndex !== -1 && paintedIndex !== i) hop(linkEls[i]?.querySelector('i')); // icon nhún lên (điện thoại)
        paintedIndex = i;
        linkEls.forEach(a => {
            if (a.dataset.path === tabs[i]) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
    }

    function newView() {
        const view = document.createElement('div');
        view.className = 'view';
        return view;
    }

    /**
     * Dựng 1 màn hình mà KHÔNG để lỗi của nó làm sập cả app:
     * màn hình nào lỗi thì chỉ màn hình đó hiện thẻ "gặp sự cố" (kèm nút thử lại),
     * thanh điều hướng và các màn hình khác vẫn dùng bình thường. Lỗi được ghi vào nhật ký.
     */
    function safeMount(path, view, animate = false) {
        try {
            const cleanup = routes[path].mount(view, ctx);
            // Điện thoại: các khối nổi lên lần lượt khi mở màn hình (màn hình Nhà tự làm kiểu riêng)
            if (animate && path !== '/') requestAnimationFrame(() => riseIn(view.children, { from: 40, step: 45 }));
            return cleanup;
        } catch (e) {
            logError(`Mở màn hình ${path}`, e);
            view.innerHTML = `
                <div class="card crash">
                    <i class="fa-solid fa-heart-crack"></i>
                    <h2>Màn hình này gặp sự cố</h2>
                    <p>Lỗi đã được ghi vào <strong>Cài đặt → Nhật ký lỗi</strong>. Các phần khác của app vẫn dùng bình thường.</p>
                    <div class="crash__actions">
                        <button class="btn-pill btn-primary" data-crash="retry"><i class="fa-solid fa-rotate-right"></i>Thử lại</button>
                        <a class="btn-pill" href="#/"><i class="fa-solid fa-house"></i>Về trang Nhà</a>
                    </div>
                </div>`;
            view.querySelector('[data-crash="retry"]').addEventListener('click', () => api.refresh());
            return null;
        }
    }

    function safeCleanup(fn) {
        if (typeof fn !== 'function') return;
        try { fn(); } catch (e) { logError('Dọn dẹp màn hình', e); }
    }

    /** Gắn thẳng (không hiệu ứng): lần đầu mở app, hoặc vẽ lại. */
    function mountDirect(path, animate = false) {
        safeCleanup(current?.cleanup);
        const view = newView();
        root.replaceChildren(view, credit);
        current = { path, view, cleanup: safeMount(path, view, animate) };
        paintTabbar(path);
    }

    // ---------- Chuyển trang có hiệu ứng ----------

    /** Tạo trang mới trên "tấm" chuyển cảnh. dir: +1 đi tới, -1 quay lại. */
    function startMove(path, dir) {
        const view = newView();
        const t = beginTransition(current.view, view, dir);
        const cleanup = safeMount(path, view, true);
        moving = { t, path, view, cleanup, dir, anim: null, p: 0 };
        return moving;
    }

    function setProgress(p) {
        moving.p = p;
        moving.t.set(p);
        const from = tabIndex(current.path);
        const to = tabIndex(moving.path);
        if (from !== to) {
            tabbar.classList.add('is-dragging');
            links.style.setProperty('--i', from + (to - from) * Math.max(0, Math.min(1, p)));
        }
    }

    /** Kết thúc: commit = sang trang mới; không thì ở lại trang cũ. */
    function endMove(commit) {
        const m = moving;
        moving = null;
        tabbar.classList.remove('is-dragging');
        if (commit) {
            safeCleanup(current.cleanup);
            root.replaceChildren(m.view, credit);
            m.t.done();
            current = { path: m.path, view: m.view, cleanup: m.cleanup };
            window.scrollTo(0, 0);
            paintTabbar(m.path);
            if (location.hash !== hashOf(m.path)) location.hash = hashOf(m.path);
        } else {
            safeCleanup(m.cleanup);
            root.replaceChildren(current.view, credit);
            m.t.done();
            window.scrollTo(0, m.t.scrollY);
            paintTabbar(current.path);
        }
    }

    /** Thả lò xo từ vị trí hiện tại tới 1 (sang trang) hoặc 0 (quay về). */
    function settle(commit, velocity = 0) {
        const m = moving;
        m.anim?.stop();
        m.anim = spring({
            from: m.p,
            to: commit ? 1 : 0,
            velocity,
            onUpdate: setProgress,
            onDone: () => { if (moving === m) endMove(commit); }
        });
    }

    /** Đang chuyển dở mà lại bấm sang trang khác: cho chuyển cũ xong ngay. */
    function finishMoving() {
        if (!moving) return;
        moving.anim?.stop();
        setProgress(1);
        endMove(true);
    }

    function go(path) {
        finishMoving();
        if (path === current.path) return;
        const dir = direction(current.path, path);
        if (!dir || reducedMotion()) return mountDirect(path);
        startMove(path, dir);
        settle(true, 0);
    }

    window.addEventListener('hashchange', () => {
        const path = pathNow();
        if (moving && moving.path === path) return; // địa chỉ đổi do chính chuyển cảnh này
        if (path !== current?.path) go(path);
    });

    // ---------- Vuốt ngang ----------
    function targetOf(dx) {
        const route = routes[current.path];
        if (route.parent) return dx > 0 ? route.parent : null; // màn hình con: chỉ vuốt về
        const i = tabs.indexOf(current.path) + (dx < 0 ? 1 : -1);
        return tabs[i] || null;
    }

    let edgeDrag = false; // đang kéo ở mép (không còn trang): chỉ cho "nặng tay" rồi bật về

    onSwipe(root, {
        start(dx) {
            if (moving) return false;
            const target = targetOf(dx);
            if (!target) {
                if (routes[current.path].parent && dx < 0) return false;
                edgeDrag = true;
                return true;
            }
            edgeDrag = false;
            startMove(target, direction(current.path, target));
            return true;
        },
        move(dx) {
            const W = window.innerWidth;
            if (edgeDrag) {
                current.view.style.transform = `translateX(${rubber(dx, W) * 0.3}px)`;
                return;
            }
            // Đi tới: kéo sang trái (dx âm) mới tăng tiến độ; quay lại: kéo sang phải
            setProgress(moving.dir > 0 ? -dx / W : dx / W);
        },
        end(dx, velocity) {
            const W = window.innerWidth;
            if (edgeDrag) {
                edgeDrag = false;
                const from = current.view.style.transform;
                current.view.style.transform = '';
                if (from && !reducedMotion()) {
                    current.view.animate([{ transform: from }, { transform: 'translateX(0)' }], { duration: 560, easing: EASE_SPRING });
                }
                return;
            }
            const step = decide(dx, velocity, W);
            const commit = step === moving.dir;
            // Vận tốc ngón tay (px/ms) -> vận tốc tiến độ (phần/giây) cho lò xo
            const v = (moving.dir > 0 ? -velocity : velocity) / W * 1000;
            settle(commit, v);
        },
        cancel() {
            if (edgeDrag) {
                edgeDrag = false;
                current.view.style.transform = '';
                return;
            }
            if (moving) settle(false, 0);
        }
    });

    // Chuyển app sang nền (khóa màn hình, đổi app) giữa lúc đang kéo: trả trang về chỗ cũ
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && moving && !moving.anim) {
            moving.anim = { stop() {} };
            setProgress(0);
            endMove(false);
        }
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

    mountDirect(pathNow(), true);

    const api = {
        current: () => current?.path,
        /** Vẽ lại màn hình hiện tại (vd: sau khi sửa cấu hình), giữ vị trí cuộn. */
        refresh() {
            finishMoving();
            const y = window.scrollY;
            mountDirect(current.path);
            window.scrollTo(0, y);
        }
    };
    return api;
}
