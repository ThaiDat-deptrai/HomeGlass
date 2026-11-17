// =============================================================
// SWIPE - nhận cử chỉ vuốt ngang bằng ngón tay
// -------------------------------------------------------------
// - Tự phân biệt vuốt NGANG (của mình) và cuộn DỌC (để trình duyệt lo).
// - Chỉ dùng cho cảm ứng; trên máy tính dùng chuột bấm như bình thường.
// - Có thể lồng nhau: phần tử bên trong (vd: trang Tầng) được hỏi trước,
//   nếu nó nhận cử chỉ thì phần tử bên ngoài (vd: đổi tab) bỏ qua.
// - Sau khi vuốt sẽ chặn cú "click" đi kèm, để không bật nhầm đèn.
// - Cập nhật vị trí theo nhịp màn hình (requestAnimationFrame): mỗi khung
//   hình chỉ vẽ 1 lần dù ngón tay gửi bao nhiêu sự kiện -> mượt hơn.
// =============================================================

const LOCK_DISTANCE = 10; // px: di chuyển bao nhiêu thì quyết định hướng

/** Vùng không nhận vuốt (tự cuộn ngang, thanh trượt, biểu đồ, ô nhập...). */
const IGNORE = '.chips, input, textarea, select, .chart, .sheet, .no-swipe';

/**
 * onSwipe(el, {
 *   start(dx) -> false nếu không nhận (vd: đang ở mép, không còn trang),
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

    el.addEventListener('pointermove', e => {
        if (e.pointerId !== id || mode === 'skip') return;
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;

        if (mode === null) {
            if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return;
            const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
            // Phần tử bên trong đã nhận cử chỉ này rồi -> nhường
            if (!horizontal || e.hgSwipeClaimed || handlers.start?.(dx) === false) {
                mode = 'skip';
                return;
            }
            mode = 'x';
            e.hgSwipeClaimed = true;
            swallowClick = true;
            try { el.setPointerCapture(id); } catch (err) { /* bỏ qua */ }
        } else {
            e.hgSwipeClaimed = true;
        }

        const dt = e.timeStamp - lastT;
        if (dt > 0) velocity = 0.75 * ((e.clientX - lastX) / dt) + 0.25 * velocity;
        lastX = e.clientX;
        lastT = e.timeStamp;

        latestDx = dx;
        if (!frame) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (mode === 'x') handlers.move?.(latestDx);
            });
        }
    });

    function finish(e, cancelled) {
        if (e.pointerId !== id) return;
        cancelAnimationFrame(frame);
        frame = 0;
        if (mode === 'x') {
            if (cancelled) handlers.cancel?.();
            else handlers.end?.(e.clientX - x0, velocity);
        }
        id = null;
        mode = null;
    }

    el.addEventListener('pointerup', e => finish(e, false));
    el.addEventListener('pointercancel', e => finish(e, true));

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
