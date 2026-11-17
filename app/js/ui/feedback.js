// =============================================================
// FEEDBACK - tiếng "tách" và rung nhẹ khi bấm
// =============================================================

let audioCtx = null;

export function tap(settings) {
    if (navigator.vibrate) navigator.vibrate(8);
    if (!settings.get().sound) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.06);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.06);
    } catch (e) {
        /* Trình duyệt không cho phát tiếng: bỏ qua */
    }
}
