// =============================================================
// TELEGRAM - cài bot báo tin / điều khiển nhà qua Telegram (Cài đặt -> Telegram)
// -------------------------------------------------------------
// Bot chạy NGAY TRÊN ESP trung tâm (không cần máy chủ riêng, tắt app vẫn báo).
// App chỉ: gửi mã bot 1 lần, bấm "Kết nối điện thoại", bật/tắt từng loại cảnh báo.
// Mã bot được gửi thẳng xuống ESP trung tâm (không giữ lại trên máy chủ MQTT),
// app không lưu, ESP không bao giờ gửi ngược lên -> không lộ.
// =============================================================

import { html, render, $ } from '../dom.js';
import { openSheet } from '../sheet.js';

// Khớp tg::Alert trong firmware/src/master/telegram.h
const ALERTS = [
    { bit: 1, icon: 'fa-plug-circle-xmark', label: 'ESP mất kết nối / có lại', note: 'Sau 2 phút mất hẳn (khởi động lại thì không báo)' },
    { bit: 2, icon: 'fa-temperature-high', label: 'ESP quá nóng', note: 'Từ 70°C' },
    { bit: 4, icon: 'fa-triangle-exclamation', label: 'Lỗi', note: 'Servo kẹt, sụt áp, khởi động lại bất thường…' },
    { bit: 8, icon: 'fa-cloud-arrow-down', label: 'Cập nhật firmware xong / lỗi', note: '' }
];
const LIGHT_HOURS = [0, 1, 2, 3, 4, 6, 8, 12];

export function openTelegram(ctx) {
    const { store, toast } = ctx;
    let off = null;
    let verifying = false;
    let lastChats = null;

    openSheet({
        title: 'Thông báo Telegram',
        onClose: () => off?.(),
        body(el) {
            const draw = () => render(el, bodyHtml());

            function bodyHtml() {
                if (!store.canTelegram) {
                    return html`<p class="field__hint">Bot Telegram chạy trên ESP trung tâm thật. Đăng nhập nhà thật (không phải bản demo) để cài.</p>`;
                }
                if (store.status() !== 'online') {
                    return html`<p class="field__hint"><i class="fa-solid fa-wifi"></i> Đang chờ kết nối tới nhà…</p>`;
                }
                const s = store.telegramState();
                if (!s) {
                    return html`<p class="field__hint">ESP trung tâm chưa báo tình trạng bot. Cần firmware <strong>0.3.0</strong> trở lên: vào <strong>Phòng & thiết bị → Trung tâm → Cập nhật</strong>.</p>`;
                }
                if (!s.on) return setupHtml(s);
                return mainHtml(s);
            }

            // ----- Chưa có bot: 2 bước tạo bot -----
            function setupHtml(s) {
                return html`
                    <p class="tg-lead"><i class="fa-brands fa-telegram"></i>ESP trung tâm tự nhắn Telegram cho bạn khi có sự cố, và bạn nhắn lại để bật / tắt đèn. Tắt app vẫn chạy.</p>
                    <ol class="steps tg-steps">
                        <li>Mở Telegram, tìm <a href="https://t.me/BotFather" target="_blank" rel="noopener"><strong>@BotFather</strong></a> (có dấu tích xanh), gửi <code>/newbot</code>.</li>
                        <li>Đặt tên bot (vd <em>Nhà Đạt</em>), rồi tên đăng nhập kết thúc bằng <code>bot</code> (vd <em>nha_dat_bot</em>).</li>
                        <li>BotFather gửi lại 1 mã dài dạng <code>123456789:AAH…</code>. Sao chép, dán vào ô dưới.</li>
                    </ol>
                    <label class="field"><span>Mã bot (token)</span>
                        <input type="text" id="tgToken" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="123456789:AAH..." />
                    </label>
                    ${s.err ? html`<p class="ota-msg ota-msg--bad"><i class="fa-solid fa-triangle-exclamation"></i>${s.err}</p>` : ''}
                    ${verifying && !s.err ? html`<p class="field__hint"><i class="fa-solid fa-circle-notch fa-spin"></i> ESP trung tâm đang kiểm tra mã với Telegram…</p>` : ''}
                    <button class="btn-pill btn-primary" data-tg="token"><i class="fa-solid fa-check"></i>Lưu mã</button>
                    <p class="field__hint tg-safe"><i class="fa-solid fa-lock"></i>Mã chỉ được lưu trong ESP trung tâm. App và máy chủ MQTT không giữ lại.</p>`;
            }

            // ----- Đã có bot -----
            function mainHtml(s) {
                const botLink = s.bot ? `https://t.me/${s.bot.replace(/^@/, '')}` : null;
                const pairLink = s.pair && botLink ? `${botLink}?start=${s.pair}` : null;
                return html`
                    <div class="tg-card">
                        <span class="tg-card__icon"><i class="fa-brands fa-telegram"></i></span>
                        <div>
                            <strong>${botLink ? html`<a href="${botLink}" target="_blank" rel="noopener">${s.bot}</a>` : 'Bot'}</strong>
                            <small class="${s.ok ? 'is-good' : 'is-bad'}">${s.ok ? 'Đang chạy' : s.err || 'Đang kết nối Telegram…'} · ${s.chats ? `${s.chats} người đã kết nối` : 'chưa ai kết nối'}</small>
                        </div>
                    </div>

                    ${s.pair ? html`
                    <div class="tg-pair">
                        <p>Mã kết nối (hiệu lực 5 phút)</p>
                        <div class="tg-pair__code">${s.pair}</div>
                        ${pairLink ? html`<a class="btn-pill btn-primary" href="${pairLink}" target="_blank" rel="noopener"><i class="fa-brands fa-telegram"></i>Mở Telegram để kết nối</a>` : ''}
                        <small>Bấm nút trên rồi bấm <strong>Bắt đầu / Start</strong> trong Telegram. Hoặc gõ mã ${s.pair} cho bot.</small>
                    </div>` : html`
                    <button class="btn-pill btn-primary" data-tg="pair"><i class="fa-solid fa-mobile-screen"></i>${s.chats ? 'Kết nối thêm điện thoại' : 'Kết nối điện thoại'}</button>`}

                    <div class="field"><span>Báo cho tôi khi</span>
                        <div class="card group tg-alerts">
                            ${ALERTS.map(a => html`
                                <div class="row">
                                    <span class="row__label row__label--wrap"><i class="fa-solid ${a.icon}"></i><span>${a.label}${a.note ? html`<small>${a.note}</small>` : ''}</span></span>
                                    <button type="button" class="switch" role="switch" data-alert="${a.bit}" aria-checked="${(alertSetting().alerts & a.bit) !== 0}"></button>
                                </div>`)}
                            <div class="row">
                                <span class="row__label row__label--wrap"><i class="fa-solid fa-lightbulb"></i><span>Nhắc đèn bật quá lâu<small>Kèm nút "Tắt luôn"</small></span></span>
                                <select id="tgHours">
                                    ${LIGHT_HOURS.map(h => html`<option value="${h}" ${h === alertSetting().lh ? 'selected' : ''}>${h ? `Sau ${h} giờ` : 'Không nhắc'}</option>`)}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="move-row">
                        <button class="btn-pill" data-tg="test" ${s.chats ? '' : 'disabled'}><i class="fa-solid fa-paper-plane"></i>Gửi tin thử</button>
                        <button class="btn-pill" data-tg="unpair" ${s.chats ? '' : 'disabled'}><i class="fa-solid fa-user-slash"></i>Gỡ mọi điện thoại</button>
                        <button class="btn-pill btn-danger" data-tg="remove"><i class="fa-solid fa-trash"></i>Xóa bot</button>
                    </div>
                    <p class="field__hint">Trong Telegram: bấm nút hoặc gõ <em>bật đèn ngủ</em>, <em>tắt hết</em>, <em>trạng thái</em>. Chỉ người đã kết nối mới điều khiển được.</p>`;
            }

            const sendCmd = cmd => {
                const ok = store.telegram(cmd);
                if (!ok) toast('Chưa kết nối tới nhà', 'error');
                return ok;
            };

            // Cài đặt cảnh báo vừa đổi mà ESP chưa kịp báo lại: dùng bản đang chờ (không dùng số cũ, kẻo đổi ngược)
            let want = null;
            const alertSetting = () => {
                const s = store.telegramState();
                return want || { alerts: s?.alerts ?? 15, lh: s?.lh || 0 };
            };
            const sendAlerts = next => {
                want = next;
                sendCmd({ cmd: 'alerts', ...next });
            };

            el.addEventListener('click', e => {
                const sw = e.target.closest('[data-alert]');
                if (sw) {
                    const cur = alertSetting();
                    const mask = cur.alerts ^ Number(sw.dataset.alert);
                    sw.setAttribute('aria-checked', String((mask & Number(sw.dataset.alert)) !== 0));
                    sendAlerts({ alerts: mask, lh: cur.lh });
                    return;
                }
                const act = e.target.closest('[data-tg]')?.dataset.tg;
                if (!act) return;
                if (act === 'token') {
                    const token = $('#tgToken', el).value.trim();
                    if (!/^\d{5,}:[\w-]{20,}$/.test(token)) return toast('Mã chưa đúng dạng. Chép nguyên mã BotFather gửi (dạng 123456789:AAH...)', 'error', 4500);
                    if (sendCmd({ cmd: 'token', token })) {
                        verifying = true;
                        draw();
                    }
                    return;
                }
                if (act === 'unpair' && !confirm('Gỡ mọi điện thoại đã kết nối? Họ sẽ không điều khiển được và không nhận cảnh báo nữa.')) return;
                if (act === 'remove' && !confirm('Xóa bot khỏi ESP trung tâm? Muốn dùng lại phải dán mã bot lần nữa.')) return;
                if (sendCmd({ cmd: act }) && act === 'test') toast('Đã gửi tin thử, xem Telegram nhé', 'success');
            });

            el.addEventListener('change', e => {
                if (e.target.id !== 'tgHours') return;
                sendAlerts({ alerts: alertSetting().alerts, lh: Number(e.target.value) });
            });

            draw();
            off = store.subscribe(ev => {
                if (ev.type === 'status') return draw();
                if (ev.type !== 'node' || ev.nodeId !== 0) return;
                const s = store.telegramState();
                if (s?.on) verifying = false;
                if (want && s && s.alerts === want.alerts && (s.lh || 0) === want.lh) want = null; // ESP đã nhận
                if (s && lastChats !== null && s.chats > lastChats) toast('Đã kết nối điện thoại với bot 🎉', 'success');
                if (s) lastChats = s.chats;
                // Đang gõ mã bot: đừng vẽ lại làm mất chữ
                if (document.activeElement?.id === 'tgToken' && !s?.on) return;
                draw();
            });
            lastChats = store.telegramState()?.chats ?? null;
        }
    });
}
