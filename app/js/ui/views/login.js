// =============================================================
// MÀN HÌNH ĐĂNG NHẬP - hiện trước khi vào app nếu chưa chọn chế độ
// -------------------------------------------------------------
// - Nhập tài khoản MQTT (HiveMQ) -> thử kết nối THẬT trước khi vào app:
//   sai mật khẩu / mất mạng thì báo ngay tại đây, không vào app "chết".
// - "Xem bản demo": vào ngôi nhà ảo, không cần tài khoản.
// Trả về Promise<transport> đã sẵn sàng để đưa cho store.
// =============================================================

import { html, render } from '../dom.js';
import { saveAuth, setMode, takeLoginNotice } from '../../core/auth.js';
import { createMqttTransport, DEFAULT_BROKER } from '../../transport/mqtt.js';

const CONNECT_TIMEOUT_MS = 15000;

export function showLogin(root, { createDemo }) {
    const notice = takeLoginNotice();

    return new Promise(resolve => {
        render(root, html`
            <div class="login">
                <form class="card login__card" autocomplete="on" novalidate>
                    <div class="login__logo"><i class="fa-solid fa-house-signal"></i></div>
                    <h1>HomeGlass</h1>
                    <p class="login__sub">Đăng nhập bằng tài khoản MQTT (HiveMQ) mà chủ nhà cấp cho bạn.</p>

                    <label class="field"><span>Tài khoản</span>
                        <input type="text" id="lUser" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required />
                    </label>
                    <label class="field"><span>Mật khẩu</span>
                        <input type="password" id="lPass" name="password" autocomplete="current-password" required />
                    </label>

                    <details class="login__more">
                        <summary>Nâng cao</summary>
                        <label class="field"><span>Địa chỉ máy chủ</span>
                            <input type="url" id="lUrl" value="${DEFAULT_BROKER}" autocapitalize="off" spellcheck="false" />
                        </label>
                    </details>

                    <label class="login__remember"><input type="checkbox" id="lRemember" checked /> Ghi nhớ trên máy này</label>

                    <p class="login__error" id="lError" role="alert">${notice || ''}</p>

                    <button type="submit" class="btn-pill btn-primary login__go" id="lGo">
                        <i class="fa-solid fa-right-to-bracket"></i><span>Kết nối</span>
                    </button>
                    <button type="button" class="btn-pill login__demo" id="lDemo">
                        <i class="fa-solid fa-flask"></i>Xem bản demo
                        <small>Nhà ảo riêng trên máy này, không cần tài khoản, không đồng bộ</small>
                    </button>
                    <p class="login__note"><i class="fa-solid fa-lock"></i>Mật khẩu chỉ lưu trên máy này, không gửi đi đâu ngoài máy chủ MQTT.</p>
                </form>
            </div>`);

        const form = root.querySelector('form');
        const $ = id => root.querySelector('#' + id);
        const errorEl = $('lError');
        const goBtn = $('lGo');
        let busy = false;
        let trying = null; // transport đang thử

        function setBusy(on) {
            busy = on;
            goBtn.disabled = on;
            goBtn.querySelector('span').textContent = on ? 'Đang kết nối…' : 'Kết nối';
            goBtn.querySelector('i').className = on ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-right-to-bracket';
        }

        form.addEventListener('submit', async e => {
            e.preventDefault();
            if (busy) return;
            const auth = {
                url: $('lUrl').value.trim() || DEFAULT_BROKER,
                username: $('lUser').value.trim(),
                password: $('lPass').value
            };
            if (!auth.username || !auth.password) {
                errorEl.textContent = 'Nhập đủ tài khoản và mật khẩu nhé.';
                return;
            }
            if (!/^wss?:\/\//.test(auth.url)) {
                errorEl.textContent = 'Địa chỉ máy chủ phải bắt đầu bằng wss://';
                return;
            }

            errorEl.textContent = '';
            setBusy(true);
            const transport = createMqttTransport(auth);
            trying = transport;
            transport.open();

            let timer;
            try {
                await Promise.race([
                    transport.firstConnect,
                    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { network: true })), CONNECT_TIMEOUT_MS); })
                ]);
                clearTimeout(timer);
                saveAuth(auth, $('lRemember').checked);
                setMode('mqtt');
                resolve(transport);
            } catch (err) {
                clearTimeout(timer);
                transport.close();
                trying = null;
                setBusy(false);
                errorEl.textContent = err.auth
                    ? 'Sai tài khoản hoặc mật khẩu.'
                    : 'Không kết nối được tới máy chủ. Kiểm tra mạng hoặc địa chỉ máy chủ rồi thử lại.';
                if (err.auth) $('lPass').select();
            }
        });

        $('lDemo').addEventListener('click', () => {
            trying?.close();
            setMode('demo');
            resolve(createDemo());
        });

        if (!notice) $('lUser').focus({ preventScroll: true });
    });
}
