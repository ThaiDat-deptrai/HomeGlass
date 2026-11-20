// =============================================================
// FIRMWARE - bản firmware mới nhất cho ESP (cập nhật qua mạng)
// -------------------------------------------------------------
// Danh sách bản mới: firmware/bin/manifest.json trên GitHub Pages
// (tạo bằng tools/phat-hanh-firmware.ps1). App đọc danh sách, so với
// phiên bản ESP đang chạy (ESP báo trong "sức khỏe"), có bản mới thì
// hiện nút "Cập nhật". Bấm -> gửi { url, sha256, size, ver } cho ESP trung tâm;
// trung tâm tải file, kiểm tra SHA-256, cài cho đúng ESP.
// Luôn dùng địa chỉ GitHub gốc (kể cả khi mở app ở máy mình) vì ESP trung tâm
// chỉ chấp nhận file từ đúng địa chỉ này (firmware/include/hg_config.h).
// =============================================================

export const FIRMWARE_BASE = 'https://thaidat-deptrai.github.io/HomeGlass/firmware/bin/';

let cache = null;      // { at, data }
let loading = null;

/** Đọc danh sách bản mới (nhớ 10 phút). Lỗi mạng -> null. */
export async function loadManifest(force = false) {
    if (!force && cache && Date.now() - cache.at < 10 * 60e3) return cache.data;
    if (loading) return loading;
    loading = fetch(`${FIRMWARE_BASE}manifest.json?t=${Date.now()}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
            const ok = data && data.v === 1 && (data.master || data.node);
            cache = { at: Date.now(), data: ok ? data : null };
            return cache.data;
        })
        .catch(() => null)
        .finally(() => { loading = null; });
    return loading;
}

/** "0.10.2" > "0.9.9"? So từng số. */
export function compareVersion(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return Math.sign(d);
    }
    return 0;
}

/** ESP số 0 = trung tâm (ESP32-S3), còn lại = ESP phòng (ESP32-C3). */
export const kindOf = nodeId => (nodeId === 0 ? 'master' : 'node');

/** Bản mới cho ESP này (hoặc null nếu không có / chưa đọc được). */
export function latestFor(manifest, nodeId) {
    const f = manifest?.[kindOf(nodeId)];
    if (!f || !f.file || !f.sha256 || !f.size || !f.ver) return null;
    return { ver: f.ver, size: f.size, sha256: f.sha256, url: FIRMWARE_BASE + f.file };
}

/**
 * Tình trạng cập nhật của 1 ESP:
 *   'unknown'  chưa biết bản đang chạy   'latest' đã mới nhất
 *   'old-usb'  bản quá cũ, chưa có cập nhật qua mạng (phải nạp USB 1 lần)
 *   'update'   có bản mới, bấm được
 */
export function updateState(currentVer, latest) {
    if (!latest || !currentVer) return 'unknown';
    if (compareVersion(currentVer, latest.ver) >= 0) return 'latest';
    if (compareVersion(currentVer, '0.2.0') < 0) return 'old-usb'; // OTA có từ bản 0.2.0
    return 'update';
}

/** Chữ tiếng Việt cho từng bước cập nhật (trung tâm báo về). */
export const OTA_STAGE_TEXT = {
    request: 'Đang gửi yêu cầu',
    download: 'ESP trung tâm đang tải bản mới',
    send: 'Đang gửi xuống ESP',
    reboot: 'Đang khởi động bản mới',
    done: 'Cập nhật xong',
    error: 'Cập nhật lỗi'
};
