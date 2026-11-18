// =============================================================
// ERRLOG - "hộp đen" ghi lại lỗi của app
// -------------------------------------------------------------
// Mọi lỗi (code chạy sai, màn hình hỏng, mất kết nối...) được ghi lại
// kèm thời gian và phiên bản app, lưu trên máy (tối đa 40 dòng mới nhất).
// Khi có sự cố: Cài đặt -> Nhật ký lỗi -> Sao chép -> gửi cho người sửa.
// Nhờ vậy không phải đoán mò "nó bị gì".
// =============================================================

const KEY = 'hg.errlog';
const MAX = 40;

let entries = [];
try {
    entries = JSON.parse(localStorage.getItem(KEY) || '[]');
} catch (e) { entries = []; }

const listeners = new Set();

function persist() {
    try {
        localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (e) { /* bỏ qua: hết chỗ lưu cũng không được làm app chết */ }
    listeners.forEach(fn => fn());
}

/** Ghi 1 lỗi. where: lỗi xảy ra ở đâu (vd "màn hình Nhà"). */
export function logError(where, error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : '';
    const last = entries[entries.length - 1];
    // Lỗi lặp lại liên tục: chỉ tăng bộ đếm, không ghi tràn nhật ký
    if (last && last.where === where && last.message === message) {
        last.count = (last.count || 1) + 1;
        last.t = Date.now();
    } else {
        entries.push({ t: Date.now(), where, message, stack, version: window.HG_VERSION || '?' });
        if (entries.length > MAX) entries = entries.slice(-MAX);
    }
    persist();
    console.error(`[HomeGlass] ${where}:`, error);
}

export const getErrors = () => [...entries];

export function clearErrors() {
    entries = [];
    persist();
}

/** Bản text để sao chép gửi người sửa. */
export function errorsText() {
    const head = `HomeGlass ${window.HG_VERSION || '?'} · ${navigator.userAgent}`;
    return [head, ...entries.map(e => {
        const time = new Date(e.t).toLocaleString('vi-VN');
        return `[${time}] (${e.version}) ${e.where}: ${e.message}${e.count > 1 ? ` (x${e.count})` : ''}${e.stack ? '\n' + e.stack : ''}`;
    })].join('\n\n');
}

export function onErrorsChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Bắt cả những lỗi "lọt lưới" (không ai try/catch). Gọi 1 lần lúc khởi động. */
export function captureGlobalErrors() {
    window.addEventListener('error', e => {
        // Lỗi tải ảnh/font... không phải lỗi code -> bỏ qua
        if (!e.error && !e.message) return;
        logError('Lỗi chưa bắt', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', e => logError('Lỗi bất đồng bộ', e.reason));
}
