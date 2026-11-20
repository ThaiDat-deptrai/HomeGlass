// =============================================================
// SWIPE - nhận cử chỉ vuốt ngang bằng ngón tay
// -------------------------------------------------------------
// - Tự phân biệt vuốt NGANG (của mình) và cuộn DỌC (để trình duyệt lo).
// - Chỉ dùng cho cảm ứng; trên máy tính dùng chuột bấm như bình thường.
// - Có thể lồng nhau: phần tử bên trong (vd: trang Tầng) được hỏi trước,
//   nếu nó nhận cử chỉ thì phần tử bên ngoài (vd: đổi tab) bỏ qua.
// - Khi đã nhận cử chỉ: theo dõi ngón tay trên TOÀN cửa sổ, nên dù trang
//   bị nhấc ra lớp khác (lúc chuyển trang) vẫn biết khi nào nhấc tay.
// - Cập nhật vị trí theo nhịp màn hình (requestAnimationFrame) cho mượt.
// - Sau khi vuốt sẽ chặn cú "click" đi kèm, để không bật nhầm đèn.
// =============================================================

const LOCK_DISTANCE = 10; // px: di chuyển bao nhiêu thì quyết định hướng

/** Vùng không nhận vuốt (tự cuộn ngang, thanh trượt, biểu đồ, ô nhập...). */
const IGNORE = '.chips, input, textarea, select, .chart, .sheet, .no-swipe, .segmented, .snap-row';

/** Vuốt bắt đầu sát mép trái màn hình = cử chỉ "quay lại" của hệ thống (giống iOS). */
export const EDGE_BACK = 24;

/** Điện thoại / máy tính bảng dọc: vuốt từng mục + hiệu ứng kiểu iPhone. Máy tính giữ nguyên. */
export const isPhone = () => window.matchMedia('(max-width: 1023px)').matches;

/**
 * onSwipe(el, {
 *   start(dx, x0) -> false nếu không nhận (vd: đang ở mép, không còn trang). x0: chỗ đặt ngón tay,
 *   move(dx),
 *   end(dx, velocity)   velocity: px/ms, dương = vuốt sang phải,
 *   cancel()
 * })
 */
export function onSwipe(el, handlers) {
    let id = null;
    let x0 = 0;
    let y0 = 0;
    let mode = null; // null: chưa rõ | 'x': đang vuốt ngang | 'skip'
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let swallowClick = false;
    let frame = 0;
    let latestDx = 0;

    function track(e) {
        const dt = e.timeStamp - lastT;
        if (dt > 0) velocity = 0.75 * ((e.clientX - lastX) / dt) + 0.25 * velocity;
        lastX = e.clientX;
        lastT = e.timeStamp;
        latestDx = e.clientX - x0;
        if (!frame) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (mode === 'x') handlers.move?.(latestDx);
            });
        }
    }

    // ----- Sau khi đã nhận cử chỉ: nghe trên cả cửa sổ -----
    const onWindowMove = e => {
        if (e.pointerId === id && mode === 'x') track(e);
    };
    const onWindowUp = e => finish(e, false);
    const onWindowCancel = e => finish(e, true);

    function listenWindow(on) {
        const fn = on ? 'addEventListener' : 'removeEventListener';
        window[fn]('pointermove', onWindowMove, true);
        window[fn]('pointerup', onWindowUp, true);
        window[fn]('pointercancel', onWindowCancel, true);
    }

    function finish(e, cancelled) {
        if (e.pointerId !== id) return;
        cancelAnimationFrame(frame);
        frame = 0;
        const wasX = mode === 'x';
        id = null;
        mode = null;
        listenWindow(false);
        if (!wasX) return;
        if (cancelled) handlers.cancel?.();
        else handlers.end?.(e.clientX - x0, velocity);
    }

    el.addEventListener('pointerdown', e => {
        swallowClick = false;
        if (e.pointerType === 'mouse' || e.target.closest(IGNORE)) return;
        id = e.pointerId;
        x0 = lastX = e.clientX;
        y0 = e.clientY;
        lastT = e.timeStamp;
        velocity = 0;
        mode = null;
    });

    // ----- Trước khi nhận: quyết định có phải vuốt ngang không -----
    el.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        if (mode === 'x') {
            e.hgSwipeClaimed = true; // báo cho phần tử bên ngoài: cử chỉ này đã có chủ
            return;
        }
        if (mode === 'skip') return;
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;
        if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return;
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
        // Phần tử bên trong đã nhận cử chỉ này rồi -> nhường
        if (!horizontal || e.hgSwipeClaimed || handlers.start?.(dx, x0) === false) {
            mode = 'skip';
            return;
        }
        mode = 'x';
        e.hgSwipeClaimed = true;
        swallowClick = true;
        try { el.setPointerCapture(id); } catch (err) { /* bỏ qua */ }
        listenWindow(true);
        track(e);
    });

    // Nhấc tay khi chưa kịp nhận cử chỉ: chỉ cần quên đi
    el.addEventListener('pointerup', e => { if (e.pointerId === id && mode !== 'x') { id = null; mode = null; } });
    el.addEventListener('pointercancel', e => { if (e.pointerId === id && mode !== 'x') { id = null; mode = null; } });

    // Chặn cú click đi kèm sau khi vừa vuốt
    el.addEventListener('click', e => {
        if (swallowClick) {
            e.stopPropagation();
            e.preventDefault();
            swallowClick = false;
        }
    }, true);
}

/**
 * Quyết định có "lật trang" không khi thả tay:
 * kéo đủ xa (1/4 bề ngang) HOẶC hất đủ nhanh.
 * Trả về -1 (sang trang trước), +1 (trang sau) hoặc 0 (về chỗ cũ).
 */
export function decide(dx, velocity, width) {
    if (dx < -width * 0.25 || velocity < -0.45) return 1;
    if (dx > width * 0.25 || velocity > 0.45) return -1;
    return 0;
}

/** Kéo quá mép thì càng kéo càng nặng tay (giống iOS). */
export const rubber = (dx, width) => (dx / Math.abs(dx || 1)) * (1 - 1 / (Math.abs(dx) / width * 0.55 + 1)) * width;

/**
 * Điện thoại: 1 lần vuốt = đúng 1 mục (không cần kéo xa, hất nhẹ là đủ).
 * Trả về -1 (mục trước), +1 (mục sau) hoặc 0 (về chỗ cũ).
 */
export function decideStep(dx, velocity) {
    if (dx < -36 || velocity < -0.3) return 1;
    if (dx > 36 || velocity > 0.3) return -1;
    return 0;
}

/**
 * Trong lúc kéo: nội dung đi theo ngón tay nhưng "nặng" dần (không lộ trang bên cạnh),
 * để người dùng biết là đang vuốt, nhưng thả tay mới đổi mục.
 */
export const dragFollow = (dx, width) => rubber(dx, width) * 0.55;
