// =============================================================
// MÀN HÌNH CÀI ĐẶT - giao diện, âm thanh, thông tin kết nối
// =============================================================

import { html, render, $ } from '../dom.js';
import { ACCENTS, BACKGROUNDS } from '../../core/settings.js';

const THEMES = [
    { id: 'auto', name: 'Tự động', icon: 'fa-circle-half-stroke' },
    { id: 'light', name: 'Sáng', icon: 'fa-sun' },
    { id: 'dark', name: 'Tối', icon: 'fa-moon' }
];

const CONNECTION_TEXT = {
    demo: 'Bản demo (chưa nối thiết bị thật)',
    connecting: 'Đang kết nối…',
    online: 'Đã kết nối',
    offline: 'Mất kết nối'
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

export function mount(root, { home, store, settings, toast }) {
    function draw() {
        const s = settings.get();
        const dark = settings.isDark();
        const themeIndex = THEMES.findIndex(t => t.id === s.theme);
        const usingImage = s.bg?.type === 'image';

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
                    <span class="row__value">${CONNECTION_TEXT[store.status()] || store.status()}</span>
                </div>
            </section>

            <h2 class="section-title">Hệ thống</h2>
            <section class="card group">
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-rotate-left"></i>Khôi phục giao diện mặc định</span>
                    <button class="btn-pill" id="reset">Khôi phục</button>
                </div>
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-circle-info"></i>HomeGlass</span>
                    <a class="row__value" href="https://github.com/ThaiDat-deptrai/HomeGlass" target="_blank" rel="noopener">
                        Bản 0.4 · <i class="fa-brands fa-github"></i> GitHub
                    </a>
                </div>
            </section>
            </div></div>
        `);
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

    draw();
    return offStore;
}
