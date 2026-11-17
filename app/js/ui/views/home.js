// =============================================================
// MÀN HÌNH NHÀ - tổng quan, kịch bản nhanh, tầng -> phòng -> thiết bị
// =============================================================

import { html, render, $, $$ } from '../dom.js';
import { deviceIcon, roomIcon } from '../icons.js';
import { tap } from '../feedback.js';

const FLOOR_KEY = 'hg.ui.floor';

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

export function mount(root, { home, store, scenes, settings, toast }) {
    const lights = home.allDevices.filter(d => d.type === 'light');
    let floorIndex = Math.min(Number(sessionStorage.getItem(FLOOR_KEY)) || 0, home.floors.length - 1);

    render(root, html`
        <header class="home-head">
            <div>
                <p class="home-head__date">${dateText()}</p>
                <h1>${greeting()}</h1>
            </div>
            <div class="status" id="status"><span class="status__dot"></span><span id="statusText"></span></div>
        </header>

        <section class="hero card" id="hero">
            <div class="hero__glow"></div>
            <div class="hero__count" id="heroCount">0</div>
            <div class="hero__text">
                <div class="hero__label" id="heroLabel"></div>
                <div class="hero__sub" id="heroSub"></div>
            </div>
            <button class="btn-pill" id="allOff"><i class="fa-solid fa-power-off"></i>Tắt tất cả</button>
        </section>

        <div class="chips" id="sceneChips"></div>

        <div class="segmented segmented--block" id="floors" role="tablist" style="--n:${home.floors.length}">
            <span class="segmented__thumb"></span>
            ${home.floors.map((f, i) => html`<button role="tab" data-index="${i}">${f.name}</button>`)}
        </div>

        <div id="rooms"></div>
    `);

    const roomsEl = $('#rooms', root);

    // ---------- Vẽ ----------
    function drawStatus() {
        const status = store.status();
        $('#status', root).dataset.state = status;
        $('#statusText', root).textContent = STATUS_TEXT[status] || status;
    }

    function drawHero() {
        const n = store.countOn(lights);
        $('#hero', root).classList.toggle('is-lit', n > 0);
        $('#heroCount', root).textContent = n;
        $('#heroLabel', root).textContent = n > 0 ? 'đèn đang bật' : 'Tất cả đèn đã tắt';
        $('#heroSub', root).textContent = home.floors
            .map(f => `${f.name}: ${store.countOn(lights.filter(d => d.floor === f))}`)
            .join('  ·  ');
        $('#allOff', root).disabled = n === 0;
    }

    function drawChips() {
        render($('#sceneChips', root), html`${scenes.list().map(s => html`
            <button class="chip" data-scene="${s.id}"><i class="fa-solid ${s.icon}"></i>${s.name}</button>`)}`);
    }

    function drawFloorTabs() {
        const el = $('#floors', root);
        el.style.setProperty('--i', floorIndex);
        $$('button', el).forEach((b, i) => b.setAttribute('aria-selected', String(i === floorIndex)));
    }

    function drawTile(key) {
        const tile = roomsEl.querySelector(`.tile[data-key="${CSS.escape(key)}"]`);
        if (!tile) return;
        const state = store.get(key);
        tile.classList.toggle('is-on', state.on === true);
        tile.classList.toggle('is-pending', state.pending);
        tile.classList.toggle('is-unknown', state.on === null && !state.pending);
        tile.setAttribute('aria-pressed', String(state.on === true));
        tile.querySelector('.tile__status').textContent = statusLabel(state);
    }

    function drawRoomMeta(room) {
        const el = roomsEl.querySelector(`.room[data-room="${CSS.escape(room.id)}"]`);
        if (!el) return;
        const n = store.countOn(room.devices);
        el.querySelector('.room__meta').textContent = n ? `${n}/${room.devices.length} đang bật` : 'Đang tắt';
        const allBtn = el.querySelector('.room__all');
        if (allBtn) allBtn.textContent = n ? 'Tắt hết' : 'Bật hết';
    }

    function drawRooms() {
        const floor = home.floors[floorIndex];
        if (!floor.rooms.length) {
            render(roomsEl, html`<div class="card empty"><i class="fa-solid fa-couch"></i>Tầng này chưa có phòng nào.</div>`);
            return;
        }
        render(roomsEl, html`${floor.rooms.map(room => html`
            <section class="room" data-room="${room.id}">
                <header class="room__head">
                    <span class="room__icon"><i class="fa-solid ${roomIcon(room)}"></i></span>
                    <div class="room__title">
                        <h2>${room.name}</h2>
                        <span class="room__meta"></span>
                    </div>
                    ${room.devices.length > 1 ? html`<button class="btn-pill room__all"></button>` : ''}
                </header>
                <div class="tiles">
                    ${room.devices.map(d => html`
                        <button class="tile" data-key="${d.key}">
                            <span class="tile__icon"><i class="fa-solid ${deviceIcon(d)}"></i></span>
                            <span class="tile__name">${d.name}</span>
                            <span class="tile__status"></span>
                        </button>`)}
                </div>
            </section>`)}`);
        floor.rooms.forEach(room => {
            room.devices.forEach(d => drawTile(d.key));
            drawRoomMeta(room);
        });
    }

    // ---------- Sự kiện ----------
    roomsEl.addEventListener('click', e => {
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

    $('#floors', root).addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        floorIndex = Number(btn.dataset.index);
        sessionStorage.setItem(FLOOR_KEY, String(floorIndex));
        drawFloorTabs();
        drawRooms();
    });

    $('#sceneChips', root).addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const scene = scenes.get(chip.dataset.scene);
        tap(settings);
        store.setMany(scene.actions);
        toast(`Đã chạy "${scene.name}"`, 'success');
    });

    $('#allOff', root).addEventListener('click', () => {
        tap(settings);
        store.setMany(lights.map(d => ({ key: d.key, on: false })));
        toast('Đã tắt tất cả đèn', 'success');
    });

    // ---------- Nghe thay đổi ----------
    const offStore = store.subscribe(event => {
        if (event.type === 'status') drawStatus();
        if (event.type === 'device') {
            drawTile(event.key);
            drawRoomMeta(home.devices.get(event.key).room);
            drawHero();
        }
    });
    const offScenes = scenes.onChange(drawChips);

    drawStatus();
    drawHero();
    drawChips();
    drawFloorTabs();
    drawRooms();

    return () => {
        offStore();
        offScenes();
    };
}
