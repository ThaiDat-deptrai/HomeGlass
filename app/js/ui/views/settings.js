// =============================================================
// MÀN HÌNH CÀI ĐẶT - giao diện, âm thanh, thông tin kết nối
// =============================================================

import { html, render, $ } from '../dom.js';
import { ACCENTS, BACKGROUNDS } from '../../core/settings.js';
import { getErrors, clearErrors, errorsText, onErrorsChange } from '../../core/errlog.js';
import { openSheet } from '../sheet.js';

/** Bảng xem nhật ký lỗi: mới nhất lên đầu, sao chép để gửi người sửa. */
function openErrorLog(toast) {
    openSheet({
        title: 'Nhật ký lỗi',
        body(el) {
            const list = getErrors().reverse();
            if (!list.length) {
                render(el, html`<p class="errlog__empty"><i class="fa-solid fa-circle-check"></i>Chưa có lỗi nào. Mọi thứ đang chạy ổn!</p>`);
                return;
            }
            render(el, html`
                <p class="field__hint">Khi app có vấn đề: bấm <strong>Sao chép</strong> rồi gửi nội dung cho người sửa, họ sẽ biết ngay lỗi ở đâu.</p>
                <ol class="errlog">
                    ${list.map(e => html`
                        <li>
                            <div class="errlog__head">
                                <strong>${e.where}</strong>
                                <span>${new Date(e.t).toLocaleString('vi-VN')}${e.count > 1 ? ` · ${e.count} lần` : ''}</span>
                            </div>
                            <code>${e.message}</code>
                        </li>`)}
                </ol>`);
        },
        footer(el, close) {
            const has = getErrors().length > 0;
            render(el, html`
                <button class="btn-pill" id="errClear" ${has ? '' : 'disabled'}><i class="fa-solid fa-trash"></i>Xóa</button>
                <button class="btn-pill btn-primary" id="errCopy" ${has ? '' : 'disabled'}><i class="fa-solid fa-copy"></i>Sao chép</button>`);
            el.querySelector('#errCopy').addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(errorsText());
                    toast('Đã sao chép nhật ký lỗi', 'success');
                } catch (e) {
                    toast('Máy không cho sao chép, hãy chụp màn hình nhé', 'error');
                }
            });
            el.querySelector('#errClear').addEventListener('click', () => {
                if (!confirm('Xóa hết nhật ký lỗi?')) return;
                clearErrors();
                close();
                toast('Đã xóa nhật ký lỗi', 'success');
            });
        }
    });
}

const THEMES = [
    { id: 'auto', name: 'Tự động', icon: 'fa-circle-half-stroke' },
    { id: 'light', name: 'Sáng', icon: 'fa-sun' },
    { id: 'dark', name: 'Tối', icon: 'fa-moon' }
];

const CONNECTION_TEXT = {
    demo: 'Bản demo (chưa nối thiết bị thật)',
    connecting: 'Đang kết nối…',
    online: 'Đã kết nối',
    offline: 'Mất kết nối, đang thử lại…',
    auth: 'Sai tài khoản'
};

/** Thu nhỏ ảnh người dùng chọn để lưu vừa trong máy (tối đa 1600px, JPEG). */
async function fileToDataUrl(file, maxSize = 1600) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
}

export function mount(root, ctx) {
    const { home, store, settings, toast, logout } = ctx;
    const isDemo = store.transportName === 'demo';
    function draw() {
        const s = settings.get();
        const dark = settings.isDark();
        const themeIndex = THEMES.findIndex(t => t.id === s.theme);
        const usingImage = s.bg?.type === 'image';
        const errCount = getErrors().length;

        render(root, html`
            <header class="page-head">
                <h1>Cài đặt</h1>
                <p>Chỉnh giao diện theo ý bạn</p>
            </header>

            <div class="settings-cols"><div class="settings-col">
            <h2 class="section-title">Giao diện</h2>
            <section class="card group">
                <div class="row row--stack">
                    <span class="row__label"><i class="fa-solid fa-circle-half-stroke"></i>Chế độ</span>
                    <div class="segmented segmented--block" id="theme" style="--n:3; --i:${themeIndex}">
                        <span class="segmented__thumb"></span>
                        ${THEMES.map(t => html`
                            <button data-theme="${t.id}" aria-selected="${t.id === s.theme}"><i class="fa-solid ${t.icon}"></i>${t.name}</button>`)}
                    </div>
                </div>

                <div class="row row--stack">
                    <span class="row__label"><i class="fa-solid fa-palette"></i>Màu nhấn</span>
                    <div class="swatches" id="accents">
                        ${ACCENTS.map(c => html`
                            <button class="swatch" data-color="${c}" style="--c:${c}" aria-pressed="${c === s.accent}" aria-label="Màu ${c}"></button>`)}
                        <label class="swatch swatch--custom" aria-label="Chọn màu khác">
                            <i class="fa-solid fa-eye-dropper"></i>
                            <input type="color" id="accentCustom" value="${s.accent}" />
                        </label>
                    </div>
                </div>

                <div class="row row--stack">
                    <span class="row__label"><i class="fa-solid fa-image"></i>Hình nền</span>
                    <div class="bg-picks" id="bgPicks">
                        ${Object.entries(BACKGROUNDS).map(([id, bg]) => {
                            const [b1, b2, b3, base] = dark ? bg.dark : bg.light;
                            return html`
                                <button class="bg-pick" data-bg="${id}" aria-pressed="${!usingImage && s.bg?.id === id}"
                                        style="--b1:${b1}; --b2:${b2}; --b3:${b3}; --base:${base}">
                                    <span>${bg.name}</span>
                                </button>`;
                        })}
                        <label class="bg-pick bg-pick--upload" aria-pressed="${usingImage}">
                            <i class="fa-solid fa-upload"></i>
                            <span>${usingImage ? 'Đổi ảnh' : 'Ảnh của bạn'}</span>
                            <input type="file" id="bgFile" accept="image/*" hidden />
                        </label>
                    </div>
                </div>

                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-droplet"></i>Độ đậm kính</span>
                    <input type="range" id="glass" min="0" max="100" value="${s.glass}" />
                </div>
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-wand-magic-sparkles"></i>Độ mờ kính</span>
                    <input type="range" id="blur" min="0" max="40" value="${s.blur}" />
                </div>
            </section>

            </div><div class="settings-col">
            <h2 class="section-title">Âm thanh</h2>
            <section class="card group">
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-volume-high"></i>Tiếng khi bấm</span>
                    <button class="switch" role="switch" data-key="sound" aria-checked="${s.sound}"></button>
                </div>
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-comment-dots"></i>Trợ lý trả lời bằng giọng nói</span>
                    <button class="switch" role="switch" data-key="voice" aria-checked="${s.voice}"></button>
                </div>
            </section>

            <h2 class="section-title">Ngôi nhà</h2>
            <section class="card group">
                <a class="row row--link" href="#/manage">
                    <span class="row__label"><i class="fa-solid fa-sliders"></i>Phòng & thiết bị</span>
                    <span class="row__value">${home.rooms.size} khu vực · ${home.allDevices.length} thiết bị · ${home.nodes.size} ESP</span>
                    <i class="fa-solid fa-chevron-right row__go"></i>
                </a>
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-wifi"></i>Kết nối</span>
                    <span class="row__value conn conn--${store.status()}">${CONNECTION_TEXT[store.status()] || store.status()}</span>
                </div>
                <div class="row">
                    <span class="row__label row__label--wrap"><i class="fa-solid ${isDemo ? 'fa-flask' : 'fa-user'}"></i>
                        <span>${isDemo ? 'Đang xem bản demo' : store.transportUser}<small>${isDemo
                            ? 'Nhà ảo riêng trên máy này: các máy KHÔNG đồng bộ với nhau'
                            : 'Cấu hình, kịch bản, lịch hẹn tự đồng bộ giữa các máy cùng nhà'}</small></span></span>
                    <button class="btn-pill ${isDemo ? 'btn-primary' : ''}" id="logout">${isDemo ? 'Đăng nhập nhà thật' : 'Đăng xuất'}</button>
                </div>
            </section>

            <h2 class="section-title">Sao lưu & khôi phục</h2>
            <section class="card group">
                <div class="row">
                    <span class="row__label row__label--wrap"><i class="fa-solid fa-box-archive"></i>
                        <span>Sao lưu toàn bộ<small>Nhà, ESP, kênh, góc servo, kịch bản, lịch hẹn giờ - trong 1 file</small></span></span>
                    <button class="btn-pill btn-primary" data-act="backup">Tải về</button>
                </div>
                <div class="row">
                    <span class="row__label row__label--wrap"><i class="fa-solid fa-file-import"></i>
                        <span>Khôi phục từ file<small>Chọn file sao lưu (hoặc home.json) đã tải trước đó</small></span></span>
                    <label class="btn-pill">Chọn file<input type="file" id="restoreFile" accept=".json,application/json" hidden /></label>
                </div>
                <div class="row">
                    <span class="row__label row__label--wrap"><i class="fa-solid fa-download"></i>
                        <span>Chỉ tải home.json<small>Cấu hình nhà, để đưa lên GitHub làm bản gốc</small></span></span>
                    <button class="btn-pill" data-act="export">Tải về</button>
                </div>
                ${ctx.homeSource() === 'local' ? html`
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-rotate-left"></i>Bỏ chỉnh sửa, dùng file gốc</span>
                    <button class="btn-pill btn-danger" data-act="reset-home">Khôi phục</button>
                </div>` : ''}
                <p class="group__note">Nên sao lưu mỗi khi thêm/sửa thiết bị. Đổi điện thoại, xóa dữ liệu trình duyệt hay ESP trung tâm hỏng: chỉ cần khôi phục lại file là xong.</p>
            </section>

            <h2 class="section-title">Hệ thống</h2>
            <section class="card group">
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-rotate-left"></i>Khôi phục giao diện mặc định</span>
                    <button class="btn-pill" id="reset">Khôi phục</button>
                </div>
                <button class="row row--link row--btn" id="errlog">
                    <span class="row__label"><i class="fa-solid fa-bug"></i>Nhật ký lỗi</span>
                    <span class="row__value ${errCount ? 'is-bad' : ''}">${errCount ? `${errCount} lỗi` : 'Không có lỗi'}</span>
                    <i class="fa-solid fa-chevron-right row__go"></i>
                </button>
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-circle-info"></i>HomeGlass</span>
                    <a class="row__value" href="https://github.com/ThaiDat-deptrai/HomeGlass" target="_blank" rel="noopener">
                        Bản ${window.HG_VERSION} · <i class="fa-brands fa-github"></i> GitHub
                    </a>
                </div>
            </section>
            </div></div>
        `);
    }

    /** Khôi phục từ file sao lưu toàn bộ hoặc home.json thường. */
    async function restore(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        let data;
        try {
            data = JSON.parse(await file.text());
        } catch (err) {
            return toast('File không đọc được (không phải JSON)', 'error');
        }
        const full = data?.type === 'homeglass-backup';
        const what = full ? 'nhà + kịch bản + lịch hẹn giờ' : 'cấu hình nhà';
        if (!confirm(`Khôi phục ${what} từ "${file.name}"? Dữ liệu hiện tại sẽ bị thay thế.`)) return;
        try {
            ctx.importBackup(data);
            toast(`Đã khôi phục ${what}`, 'success');
        } catch (err) {
            toast(err.problems ? `File lỗi: ${err.problems[0]}` : 'File không đúng định dạng HomeGlass', 'error', 5000);
        }
    }

    /** Lưu cài đặt; báo lỗi dễ hiểu nếu máy hết chỗ (ảnh quá lớn). */
    function save(patch, redraw = true) {
        try {
            settings.set(patch);
        } catch (e) {
            toast('Không lưu được (ảnh quá lớn?). Thử ảnh nhỏ hơn nhé.', 'error');
            return;
        }
        if (redraw) draw();
    }

    // ---------- Sự kiện ----------
    root.addEventListener('click', e => {
        const themeBtn = e.target.closest('#theme button');
        if (themeBtn) return save({ theme: themeBtn.dataset.theme });

        const swatch = e.target.closest('.swatch[data-color]');
        if (swatch) return save({ accent: swatch.dataset.color });

        const bg = e.target.closest('.bg-pick[data-bg]');
        if (bg) return save({ bg: { type: 'preset', id: bg.dataset.bg } });

        const sw = e.target.closest('.switch');
        if (sw) return save({ [sw.dataset.key]: sw.getAttribute('aria-checked') !== 'true' });

        if (e.target.closest('#errlog')) return openErrorLog(toast);

        // ----- Sao lưu & khôi phục -----
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'backup') {
            ctx.exportBackup();
            return toast('Đã tải file sao lưu toàn bộ', 'success');
        }
        if (act === 'export') {
            ctx.exportHome();
            return toast('Đã tải file home.json', 'success');
        }
        if (act === 'reset-home') {
            if (!confirm('Bỏ mọi chỉnh sửa và dùng lại file cấu hình gốc?')) return;
            try {
                ctx.resetHome();
                toast('Đã dùng lại file gốc', 'info');
            } catch (err) {
                toast(err.message, 'error');
            }
            return;
        }

        if (e.target.closest('#logout')) {
            if (!isDemo && !confirm('Đăng xuất khỏi nhà trên máy này?')) return;
            return logout();
        }

        if (e.target.closest('#reset')) {
            if (!confirm('Đưa giao diện về mặc định?')) return;
            settings.reset();
            draw();
            toast('Đã khôi phục giao diện mặc định', 'success');
        }
    });

    // Kéo thanh trượt: áp ngay, KHÔNG vẽ lại trang (để không đứt thao tác kéo)
    root.addEventListener('input', e => {
        if (e.target.id === 'glass') save({ glass: Number(e.target.value) }, false);
        if (e.target.id === 'blur') save({ blur: Number(e.target.value) }, false);
        if (e.target.id === 'accentCustom') save({ accent: e.target.value }, false);
    });

    root.addEventListener('change', async e => {
        if (e.target.id === 'accentCustom') return draw();
        if (e.target.id === 'restoreFile') return restore(e.target);
        if (e.target.id !== 'bgFile') return;
        const file = e.target.files[0];
        if (!file) return;
        try {
            const src = await fileToDataUrl(file);
            save({ bg: { type: 'image', src, id: settings.get().bg?.id || 'ocean' } });
            toast('Đã đổi hình nền', 'success');
        } catch (err) {
            toast('Không đọc được ảnh này', 'error');
        }
    });

    const offStore = store.subscribe(event => {
        if (event.type === 'status') draw();
    });

    const offErrors = onErrorsChange(draw); // có lỗi mới -> số đếm cập nhật ngay

    draw();
    return () => { offStore(); offErrors(); };
}
