// =============================================================
// FEEDBACK - tiếng "tách" và rung nhẹ khi bấm
// -------------------------------------------------------------
// - MỌI nút bấm được (danh sách PRESSABLE ở ui/press.js) đều kêu "tách",
//   không chỉ vài nút như trước. Kêu lúc nhấc tay (bấm thật), không kêu
//   khi ngón tay chỉ lướt qua để cuộn trang.
// - Trình duyệt "đóng băng" bộ phát âm thanh khi app chạy nền / màn hình
//   tắt -> mỗi lần kêu đều đánh thức lại (resume), nên không bị mất tiếng.
// - Một cú bấm chỉ kêu 1 lần dù nhiều chỗ cùng gọi tap().
// =============================================================

let audioCtx = null;
let boundSettings = null;
let lastTap = 0;

const isTouch = window.matchMedia('(pointer: coarse)').matches;
const DEDUPE_MS = 250;

/** Gắn cài đặt 1 lần lúc khởi động (để biết người dùng có bật tiếng không). */
export function bindFeedback(settings) {
    boundSettings = settings;
}

function context() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Ctx();
    // Bị đóng băng (chạy nền, iPhone khóa màn hình...) -> đánh thức lại
    if (audioCtx.state !== 'running') audioCtx.resume?.().catch(() => {});
    return audioCtx;
}

/** Tiếng "tách" ngắn, gọn như bàn phím iPhone. */
function click(ctx) {
    const t = ctx.currentTime + 0.003;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.03);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
}

export function tap(settings = boundSettings) {
    const now = performance.now();
    if (now - lastTap < DEDUPE_MS) return; // cú bấm này đã kêu rồi
    lastTap = now;

    if (isTouch && navigator.vibrate) {
        try { navigator.vibrate(8); } catch (e) { /* bỏ qua */ }
    }
    if (!settings?.get().sound) return;
    try {
        const ctx = context();
        if (ctx) click(ctx);
    } catch (e) {
        /* Trình duyệt không cho phát tiếng: bỏ qua, không làm hỏng cú bấm */
    }
}

/**
 * Bật tiếng cho mọi nút. pressable: bộ chọn CSS các khối bấm được.
 * Âm thanh trên web chỉ được mở trong lúc người dùng chạm -> mở sẵn ở lần chạm đầu.
 */
export function enableTapSound(pressable) {
    const unlock = () => { if (boundSettings?.get().sound) context(); };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && audioCtx) context(); });

    document.addEventListener('click', e => {
        const el = e.target.closest?.(pressable);
        if (el && !el.disabled) tap();
    }, true);
}
