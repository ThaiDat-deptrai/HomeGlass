// =============================================================
// AUTH - tài khoản MQTT của người dùng + chế độ chạy (thật / demo)
// -------------------------------------------------------------
// Web đưa lên GitHub Pages là CÔNG KHAI: ai cũng đọc được code.
// => KHÔNG BAO GIỜ viết mật khẩu vào code. Người dùng tự nhập ở màn
//    hình đăng nhập, chỉ lưu trên máy của họ:
//      - "Ghi nhớ": lưu lâu dài (localStorage)
//      - không ghi nhớ: chỉ đến khi đóng trình duyệt (sessionStorage)
// Mỗi người trong nhà nên có 1 tài khoản HiveMQ riêng: mất điện thoại
// thì xóa riêng tài khoản đó trên HiveMQ là xong.
// =============================================================

const AUTH_KEY = 'hg.mqtt.auth';
const MODE_KEY = 'hg.mode';
const NOTICE_KEY = 'hg.login.notice';

function readFrom(storage) {
    try {
        const v = JSON.parse(storage.getItem(AUTH_KEY));
        return v && v.username && v.password ? v : null;
    } catch (e) {
        return null;
    }
}

/** { url, username, password } hoặc null */
export function getAuth() {
    return readFrom(localStorage) || readFrom(sessionStorage);
}

export function saveAuth({ url, username, password }, remember) {
    clearAuth();
    const data = JSON.stringify({ url, username, password });
    try {
        (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, data);
    } catch (e) { /* máy chặn lưu: lần sau đăng nhập lại */ }
}

export function clearAuth() {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* bỏ qua */ }
    try { sessionStorage.removeItem(AUTH_KEY); } catch (e) { /* bỏ qua */ }
}

/** 'mqtt' | 'demo' | null (chưa chọn -> hiện màn hình đăng nhập) */
export function getMode() {
    try { return localStorage.getItem(MODE_KEY); } catch (e) { return null; }
}

export function setMode(mode) {
    try {
        if (mode) localStorage.setItem(MODE_KEY, mode);
        else localStorage.removeItem(MODE_KEY);
    } catch (e) { /* bỏ qua */ }
}

/** Lời nhắn cho lần mở màn hình đăng nhập tới (vd "mật khẩu không còn đúng"). */
export function setLoginNotice(text) {
    try { sessionStorage.setItem(NOTICE_KEY, text); } catch (e) { /* bỏ qua */ }
}

export function takeLoginNotice() {
    try {
        const t = sessionStorage.getItem(NOTICE_KEY);
        sessionStorage.removeItem(NOTICE_KEY);
        return t;
    } catch (e) {
        return null;
    }
}
