// =============================================================
// MÀN HÌNH NHÀ - tổng quan, kịch bản nhanh, tầng -> phòng -> thiết bị
// -------------------------------------------------------------
// Các tầng nằm cạnh nhau như trang sách: vuốt ngang hoặc bấm
// "Tầng 1 | Tầng 2" để lật. Trên máy tính, phòng xếp thành thẻ nhiều cột.
// =============================================================

import { html, render, $, $$ } from '../dom.js';
import { deviceIcon, roomIcon } from '../icons.js';
import { tap } from '../feedback.js';
import { pop, rollNumber, reducedMotion } from '../motion.js';
import { onSwipe, decide, rubber } from '../swipe.js';

const FLOOR_KEY = 'hg.ui.floor';
const PAGE_GAP = 32; // khớp với .pager__track { gap }

const STATUS_TEXT = {
    demo: 'Bản demo',
    connecting: 'Đang kết nối…',
    online: 'Đã kết nối',
    offline: 'Mất kết nối'
};

function greeting() {
    const h = new Date().getHours();
    if (h < 11) return 'Chào buổi sáng';
    if (h < 14) return 'Chào buổi trưa';
    if (h < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
}

function dateText() {
    const text = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusLabel(state) {
    if (state.pending) return 'Đang gửi…';
    if (state.on === null) return 'Chưa rõ';
    return state.on ? 'Đang bật' : 'Đang tắt';
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function roomHtml(room) {
    return html`
        <section class="room" data-room="${room.id}">
            <header class="room__head">
                <span class="room__icon"><i class="fa-solid ${roomIcon(room)}"></i></span>
                <div class="room__title">
                    <h2>${room.name}</h2>
                    <span class="room__meta"></span>
                </div>
                ${room.devices.length ? html`<button class="btn-pill room__all"></button>` : ''}
            </header>
            ${room.devices.length
                ? html`<div class="tiles">
                    ${room.devices.map(d => html`
                        <button class="tile" data-key="${d.key}" data-type="${d.type}">
                            <span class="tile__icon"><i class="fa-solid ${deviceIcon(d)}"></i></span>
                            <span class="tile__name">${d.name}</span>
                            <span class="tile__status"></span>
                        </button>`)}
                  </div>`
                : html`<a class="room__empty" href="#/manage"><i class="fa-solid fa-plus"></i>Thêm thiết bị cho phòng này</a>`}
        </section>`;
}

export function mount(root, { home, store, scenes, settings, toast }) {
    const lights = home.allDevices.filter(d => d.type === 'light');
    const others = home.allDevices.filter(d => d.type !== 'light');
    const floors = home.floors;
    let floorIndex = clamp(Number(sessionStorage.getItem(FLOOR_KEY)) || 0, 0, floors.length - 1);

    render(root, html`
        <header class="home-head">
            <div>
                <p class="home-head__date">${dateText()}</p>
                <h1>${greeting()}</h1>
            </div>
            <div class="status" id="status"><span class="status__dot"></span><span id="statusText"></span></div>
        </header>

        <div class="home-top">
            <section class="hero card" id="hero">
                <div class="hero__glow"></div>
                <div class="hero__count"><span id="heroCount">0</span></div>
                <div class="hero__text">
                    <div class="hero__label" id="heroLabel"></div>
                    <div class="hero__sub" id="heroSub"></div>
                </div>
                <button class="btn-pill" id="allOff"><i class="fa-solid fa-power-off"></i>Tắt tất cả</button>
            </section>

            <section class="quick">
                <h2 class="section-title quick__title">Kịch bản nhanh</h2>
                <div class="chips" id="sceneChips"></div>
            </section>
        </div>

        <div class="floor-bar" ${floors.length < 2 ? 'hidden' : ''}>
            <div class="segmented segmented--block" id="floors" role="tablist" style="--n:${floors.length}; --i:${floorIndex}">
                <span class="segmented__thumb"></span>
                ${floors.map((f, i) => html`<button role="tab" data-index="${i}">${f.name}</button>`)}
            </div>
        </div>

        <div class="pager" id="pager">
            <div class="pager__track" id="track">
                ${floors.map((f, i) => html`
                    <div class="pager__page" data-index="${i}" role="tabpanel" aria-label="${f.name}">
                        ${f.rooms.length
                            ? html`<div class="rooms">${f.rooms.map(roomHtml)}</div>`
                            : html`<div class="card empty"><i class="fa-solid fa-couch"></i>${f.name} chưa có phòng nào.<br><a href="#/manage">Thêm phòng</a></div>`}
                    </div>`)}
            </div>
        </div>
    `);

    const pager = $('#pager', root);
    const track = $('#track', root);
    const pages = $$('.pager__page', root);
    const seg = $('#floors', root);
    const lastOn = new Map(); // để biết thiết bị nào vừa ĐỔI trạng thái (cho hiệu ứng nảy)

    // ---------- Vẽ ----------
    function drawStatus() {
        const status = store.status();
        $('#status', root).dataset.state = status;
        $('#statusText', root).textContent = STATUS_TEXT[status] || status;
    }

    function drawHero() {
        const n = store.countOn(lights);
        const extra = store.countOn(others);
        $('#hero', root).classList.toggle('is-lit', n > 0);
        rollNumber($('#heroCount', root), n);
        $('#heroLabel', root).textContent = n > 0 ? 'đèn đang bật' : 'Tất cả đèn đã tắt';
        const perFloor = floors.map(f => `${f.name}: ${store.countOn(lights.filter(d => d.floor === f))}`).join('  ·  ');
        $('#heroSub', root).textContent = extra ? `${perFloor}  ·  +${extra} thiết bị khác` : perFloor;
        $('#allOff', root).disabled = n + extra === 0;
    }

    /** Kịch bản đang chạy thì chip "sáng" lên như đèn bật. */
    function drawChips() {
        const active = scenes.activeId();
        render($('#sceneChips', root), html`${scenes.list().map(s => html`
            <button class="chip ${s.id === active ? 'is-active' : ''}" data-scene="${s.id}" aria-pressed="${s.id === active}">
                <i class="fa-solid ${s.icon}"></i>${s.name}
            </button>`)}`);
    }

    function drawTile(key) {
        const tile = track.querySelector(`.tile[data-key="${CSS.escape(key)}"]`);
        if (!tile) return;
        const state = store.get(key);
        tile.classList.toggle('is-on', state.on === true);
        tile.classList.toggle('is-pending', state.pending);
        tile.classList.toggle('is-unknown', state.on === null && !state.pending);
        tile.setAttribute('aria-pressed', String(state.on === true));
        tile.querySelector('.tile__status').textContent = statusLabel(state);
        if (lastOn.has(key) && lastOn.get(key) !== state.on && state.on !== null) {
            pop(tile.querySelector('.tile__icon'));
        }
        lastOn.set(key, state.on);
    }

    function drawRoomMeta(room) {
        const el = track.querySelector(`.room[data-room="${CSS.escape(room.id)}"]`);
        if (!el) return;
        const n = store.countOn(room.devices);
        el.querySelector('.room__meta').textContent = !room.devices.length
            ? 'Chưa có thiết bị'
            : n ? `${n}/${room.devices.length} đang bật` : 'Đang tắt';
        const allBtn = el.querySelector('.room__all');
        if (allBtn) allBtn.textContent = n ? 'Tắt hết' : 'Bật hết';
    }

    // ---------- Lật trang tầng ----------
    // Trong lúc trượt: cả trang cũ và trang mới đều hiện (is-peek), tắt kính mờ (is-moving).
    // Trượt xong ("settle"): ẩn trang cũ, bật lại kính mờ.
    const pageWidth = () => (pages[0]?.getBoundingClientRect().width || pager.clientWidth) + PAGE_GAP;
    let settleTimer = 0;

    function settle() {
        clearTimeout(settleTimer);
        pager.classList.remove('is-moving');
        pages.forEach(p => p.classList.remove('is-peek'));
    }

    function placeTrack(dx = 0, animate = false) {
        if (animate && !reducedMotion()) {
            pager.classList.add('is-moving');
            track.style.transition = 'transform 0.5s var(--ease-ios)';
            clearTimeout(settleTimer);
            settleTimer = setTimeout(settle, 520);
        } else {
            track.style.transition = 'none';
        }
        track.style.transform = `translateX(${-floorIndex * pageWidth() + dx}px)`;
    }

    function drawFloorTabs(progress = floorIndex) {
        seg.style.setProperty('--i', clamp(progress, 0, floors.length - 1));
        $$('button', seg).forEach((b, i) => b.setAttribute('aria-selected', String(i === floorIndex)));
    }

    function showFloor(index, animate = true) {
        const previous = floorIndex;
        floorIndex = index;
        sessionStorage.setItem(FLOOR_KEY, String(index));
        pages.forEach((p, i) => {
            p.classList.toggle('is-active', i === index);
            // Trang cũ (và trang vừa ló ra khi kéo) vẫn hiện trong lúc trượt,
            // để không bị "biến mất" giữa chừng. settle() sẽ ẩn sau khi trượt xong.
            if (animate && i === previous && i !== index) p.classList.add('is-peek');
            p.toggleAttribute('inert', i !== index);
        });
        placeTrack(0, animate);
        if (!animate) settle();
        drawFloorTabs();
    }

    onSwipe(pager, {
        start(dx) {
            const target = floorIndex + (dx < 0 ? 1 : -1);
            if (target < 0 || target >= floors.length) return false; // ở mép: nhường cho vuốt đổi tab
            clearTimeout(settleTimer);
            pages[target].classList.add('is-peek');
            pager.classList.add('is-moving');
            seg.classList.add('is-dragging');
            return true;
        },
        move(dx) {
            const w = pageWidth();
            const target = floorIndex + (dx < 0 ? 1 : -1);
            const ok = target >= 0 && target < floors.length;
            if (ok) pages[target].classList.add('is-peek');
            const x = ok ? dx : rubber(dx, w) * 0.4;
            placeTrack(x);
            drawFloorTabs(floorIndex - x / w);
        },
        end(dx, velocity) {
            seg.classList.remove('is-dragging');
            const step = decide(dx, velocity, pageWidth());
            const target = floorIndex + step;
            if (step && target >= 0 && target < floors.length) {
                tap(settings);
                showFloor(target);
            } else {
                showFloor(floorIndex);
            }
        },
        cancel() {
            seg.classList.remove('is-dragging');
            showFloor(floorIndex);
        }
    });

    // ---------- Sự kiện ----------
    track.addEventListener('click', e => {
        const tile = e.target.closest('.tile');
        if (tile) {
            tap(settings);
            store.toggle(tile.dataset.key);
            return;
        }
        const allBtn = e.target.closest('.room__all');
        if (allBtn) {
            const room = home.rooms.get(allBtn.closest('.room').dataset.room);
            const turnOn = store.countOn(room.devices) === 0;
            tap(settings);
            store.setMany(room.devices.map(d => ({ key: d.key, on: turnOn })));
        }
    });

    seg.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (btn) showFloor(Number(btn.dataset.index));
    });

    $('#sceneChips', root).addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const scene = scenes.get(chip.dataset.scene);
        tap(settings);
        store.setMany(scene.actions);
        scenes.activate(scene.id);
        toast(`Đã chạy "${scene.name}"`, 'success');
    });

    $('#allOff', root).addEventListener('click', () => {
        tap(settings);
        store.setMany(home.allDevices.map(d => ({ key: d.key, on: false })));
        toast('Đã tắt tất cả', 'success');
    });

    const onResize = () => placeTrack();
    window.addEventListener('resize', onResize);

    // ---------- Nghe thay đổi ----------
    const offStore = store.subscribe(event => {
        if (event.type === 'status') drawStatus();
        if (event.type === 'device') {
            const device = home.devices.get(event.key);
            if (!device) return;
            drawTile(event.key);
            drawRoomMeta(device.room);
            drawHero();
        }
    });
    const offScenes = scenes.onChange(drawChips);

    drawStatus();
    drawChips();
    home.allDevices.forEach(d => drawTile(d.key));
    home.rooms.forEach(drawRoomMeta);
    drawHero();
    showFloor(floorIndex, false);

    return () => {
        offStore();
        offScenes();
        clearTimeout(settleTimer);
        window.removeEventListener('resize', onResize);
    };
}
