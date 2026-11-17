// =============================================================
// MÀN HÌNH KỊCH BẢN - chạy, tạo, sửa, xóa kịch bản + HẸN GIỜ tự chạy
// =============================================================

import { html, render, $, $$ } from '../dom.js';
import { openSheet } from '../sheet.js';
import { tap } from '../feedback.js';
import { SCENE_ICONS } from '../../core/scenes.js';
import { DAYS, KINDS, nextRun, daysText, whenText, relativeText } from '../../core/schedules.js';

const OFFSETS = [-60, -30, -15, 0, 15, 30, 60];
const QUICK_DAYS = [
    { label: 'Hằng ngày', days: [0, 1, 2, 3, 4, 5, 6] },
    { label: 'T2 – T6', days: [1, 2, 3, 4, 5] },
    { label: 'Cuối tuần', days: [6, 0] }
];

function summary(scene) {
    const on = scene.actions.filter(a => a.on).length;
    const off = scene.actions.length - on;
    return [on && `${on} bật`, off && `${off} tắt`].filter(Boolean).join(' · ') || 'Chưa có thiết bị';
}

export function mount(root, ctx) {
    const { home, store, scenes, schedules, settings, toast } = ctx;
    const location = schedules.location;

    /** Lần chạy sắp tới gần nhất của 1 kịch bản (nếu có lịch). */
    function nextOfScene(sceneId) {
        const times = schedules.forScene(sceneId).map(s => nextRun(s, new Date(), location)).filter(Boolean);
        return times.length ? new Date(Math.min(...times)) : null;
    }

    function sceneCard(scene) {
        const active = scenes.activeId() === scene.id;
        const next = nextOfScene(scene.id);
        const count = schedules.forScene(scene.id).length;
        return html`
            <article class="scene card ${active ? 'is-active' : ''}" data-id="${scene.id}">
                <span class="scene__icon"><i class="fa-solid ${scene.icon}"></i></span>
                <div class="scene__text">
                    <h3>${scene.name}${active ? html` <span class="scene__badge">Đang bật</span>` : ''}</h3>
                    <p>${next ? html`<span class="scene__next"><i class="fa-solid fa-clock"></i>${relativeText(next)}</span> · ` : ''}${scene.note || summary(scene)}</p>
                </div>
                <button class="icon-btn ${count ? 'icon-btn--on' : ''}" data-act="schedule" aria-label="Hẹn giờ ${scene.name}">
                    <i class="fa-solid fa-clock"></i>${count ? html`<span class="icon-btn__count">${count}</span>` : ''}
                </button>
                ${scene.preset ? '' : html`<button class="icon-btn" data-act="edit" aria-label="Sửa"><i class="fa-solid fa-pen"></i></button>`}
                <button class="scene__run" data-act="run" aria-label="Chạy"><i class="fa-solid fa-play"></i></button>
            </article>`;
    }

    function scheduleRow({ s, at }) {
        const scene = scenes.get(s.sceneId);
        return html`
            <div class="sched ${s.enabled ? '' : 'is-off'}" data-sched="${s.id}">
                <span class="sched__icon"><i class="fa-solid ${KINDS[s.kind].icon}"></i></span>
                <button class="sched__main" data-act="edit-sched">
                    <strong>${s.kind === 'time' ? s.time : KINDS[s.kind].label}</strong>
                    <span>${scene ? scene.name : 'Kịch bản đã xóa'} · ${daysText(s.days)}</span>
                    <small>${s.enabled ? `Lần tới: ${relativeText(at)}` : 'Đang tắt'}${s.kind !== 'time' ? ` · ${whenText(s, location)}` : ''}</small>
                </button>
                <button class="switch" role="switch" data-act="toggle-sched" aria-checked="${s.enabled}" aria-label="Bật/tắt lịch"></button>
            </div>`;
    }

    function draw() {
        const all = scenes.list();
        const presets = all.filter(s => s.preset);
        const custom = all.filter(s => !s.preset);
        const upcoming = schedules.upcoming();
        render(root, html`
            <header class="page-head page-head--row">
                <div>
                    <h1>Kịch bản</h1>
                    <p>Bấm một lần, cả nhà làm theo</p>
                </div>
                <button class="btn-pill btn-primary" id="addScene"><i class="fa-solid fa-plus"></i>Tạo mới</button>
            </header>

            <div class="section-row">
                <h2 class="section-title">Lịch hẹn giờ</h2>
                <button class="btn-pill" data-act="add-sched"><i class="fa-solid fa-plus"></i>Hẹn giờ</button>
            </div>
            ${upcoming.length
                ? html`<section class="card group sched-list">${upcoming.map(scheduleRow)}</section>`
                : html`<div class="card empty empty--sm"><i class="fa-solid fa-clock"></i>Chưa có lịch hẹn.<br>Ví dụ: tự bật "Về nhà" lúc trời tối, tự chạy "Đi ngủ" lúc 23:00.</div>`}

            <h2 class="section-title">Có sẵn</h2>
            <div class="scene-grid">${presets.map(sceneCard)}</div>

            <h2 class="section-title">Của tôi</h2>
            ${custom.length
                ? html`<div class="scene-grid">${custom.map(sceneCard)}</div>`
                : html`<div class="card empty"><i class="fa-solid fa-wand-magic-sparkles"></i>Chưa có kịch bản riêng.<br>Bấm "Tạo mới" để tự chọn đèn nào bật, đèn nào tắt.</div>`}
        `);
    }

    // ---------- Form hẹn giờ ----------
    function openSchedule(existing, sceneId) {
        const s = existing
            ? { ...existing, days: [...existing.days] }
            : { sceneId: sceneId || scenes.list()[0]?.id, kind: 'time', time: '18:00', offset: 0, days: [0, 1, 2, 3, 4, 5, 6], enabled: true };

        openSheet({
            title: existing ? 'Sửa lịch hẹn' : 'Hẹn giờ kịch bản',
            body(el) {
                render(el, html`
                    <label class="field"><span>Chạy kịch bản</span>
                        <select id="schScene">
                            ${scenes.list().map(sc => html`<option value="${sc.id}" ${sc.id === s.sceneId ? 'selected' : ''}>${sc.name}</option>`)}
                        </select>
                    </label>

                    <div class="field"><span>Khi nào</span>
                        <div class="segmented segmented--block" id="schKind" role="tablist" style="--n:3">
                            <span class="segmented__thumb"></span>
                            ${Object.entries(KINDS).map(([id, k]) => html`<button type="button" role="tab" data-kind="${id}"><i class="fa-solid ${k.icon}"></i>${k.label}</button>`)}
                        </div>
                    </div>

                    <label class="field" id="schTimeField"><span>Giờ</span>
                        <input type="time" id="schTime" class="time-input time-input--big" value="${s.time}" />
                    </label>
                    <div class="field" id="schOffsetField"><span>Lệch so với giờ mặt trời</span>
                        <div class="chip-pick" id="schOffset">
                            ${OFFSETS.map(o => html`<button type="button" data-off="${o}">${o === 0 ? 'Đúng giờ' : (o > 0 ? '+' : '−') + Math.abs(o) + ' phút'}</button>`)}
                        </div>
                        <p class="field__hint" id="schSunHint"></p>
                    </div>

                    <div class="field"><span>Lặp lại</span>
                        <div class="day-pick" id="schDays">
                            ${DAYS.map(d => html`<button type="button" data-day="${d.v}">${d.t}</button>`)}
                        </div>
                        <div class="chip-pick chip-pick--sm" id="schQuick">
                            ${QUICK_DAYS.map((q, i) => html`<button type="button" data-quick="${i}">${q.label}</button>`)}
                        </div>
                    </div>

                    <div class="row">
                        <span class="row__label"><i class="fa-solid fa-power-off"></i>Bật lịch này</span>
                        <button class="switch" role="switch" id="schEnabled" aria-checked="${s.enabled}"></button>
                    </div>

                    <p class="field__hint"><i class="fa-solid fa-circle-info"></i> Lịch chạy trên ESP trung tâm (giờ lấy từ Internet), tắt điện thoại vẫn chạy. Bản demo hiện tại: app tự chạy lịch khi đang mở.</p>
                `);

                const paint = () => {
                    const kinds = Object.keys(KINDS);
                    const seg = $('#schKind', el);
                    seg.style.setProperty('--i', kinds.indexOf(s.kind));
                    $$('button', seg).forEach(b => b.setAttribute('aria-selected', String(b.dataset.kind === s.kind)));
                    $('#schTimeField', el).hidden = s.kind !== 'time';
                    $('#schOffsetField', el).hidden = s.kind === 'time';
                    $$('#schOffset button', el).forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.off) === s.offset)));
                    $$('#schDays button', el).forEach(b => b.setAttribute('aria-pressed', String(s.days.includes(Number(b.dataset.day)))));
                    if (s.kind !== 'time') $('#schSunHint', el).textContent = `Hôm nay: ${whenText(s, location)}. Giờ tự đổi theo mùa.`;
                };
                paint();

                el.addEventListener('click', e => {
                    const kind = e.target.closest('#schKind button');
                    if (kind) { s.kind = kind.dataset.kind; return paint(); }
                    const off = e.target.closest('#schOffset button');
                    if (off) { s.offset = Number(off.dataset.off); return paint(); }
                    const day = e.target.closest('#schDays button');
                    if (day) {
                        const v = Number(day.dataset.day);
                        s.days = s.days.includes(v) ? s.days.filter(d => d !== v) : [...s.days, v];
                        return paint();
                    }
                    const quick = e.target.closest('#schQuick button');
                    if (quick) { s.days = [...QUICK_DAYS[Number(quick.dataset.quick)].days]; return paint(); }
                    const sw = e.target.closest('#schEnabled');
                    if (sw) {
                        s.enabled = !s.enabled;
                        sw.setAttribute('aria-checked', String(s.enabled));
                    }
                });
                el.addEventListener('change', e => {
                    if (e.target.id === 'schTime') s.time = e.target.value || s.time;
                    if (e.target.id === 'schScene') s.sceneId = e.target.value;
                });
            },
            footer(el, close) {
                render(el, html`
                    ${existing ? html`<button class="btn-pill btn-danger" data-act="delete"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}
                    <span class="sheet__spacer"></span>
                    <button class="btn-pill" data-act="cancel">Hủy</button>
                    <button class="btn-pill btn-primary" data-act="save"><i class="fa-solid fa-check"></i>Lưu</button>`);
                el.addEventListener('click', e => {
                    const act = e.target.closest('button')?.dataset.act;
                    if (act === 'cancel') return close();
                    if (act === 'delete') {
                        schedules.remove(existing.id);
                        toast('Đã xóa lịch hẹn', 'info');
                        return close();
                    }
                    if (act !== 'save') return;
                    s.time = $('#schTime').value || s.time;
                    s.sceneId = $('#schScene').value;
                    if (!s.days.length) return toast('Chọn ít nhất 1 ngày trong tuần', 'error');
                    const saved = schedules.save(s);
                    const at = nextRun(saved, new Date(), location);
                    toast(at ? `Đã hẹn: ${relativeText(at)}` : 'Đã lưu lịch (đang tắt)', 'success');
                    close();
                });
            }
        });
    }

    // ---------- Form tạo / sửa kịch bản ----------
    function openEditor(scene) {
        // key -> 'on' | 'off' | 'skip'
        const choice = new Map(home.allDevices.map(d => [d.key, 'skip']));
        (scene?.actions || []).forEach(a => choice.set(a.key, a.on ? 'on' : 'off'));
        let icon = scene?.icon || SCENE_ICONS[0];

        openSheet({
            title: scene ? 'Sửa kịch bản' : 'Kịch bản mới',
            body(el) {
                render(el, html`
                    <label class="field">
                        <span>Tên kịch bản</span>
                        <input type="text" id="sceneName" maxlength="30" placeholder="Ví dụ: Xem phim" value="${scene?.name || ''}" />
                    </label>

                    <div class="field">
                        <span>Biểu tượng</span>
                        <div class="icon-pick" id="iconPick">
                            ${SCENE_ICONS.map(i => html`<button type="button" data-icon="${i}"><i class="fa-solid ${i}"></i></button>`)}
                        </div>
                    </div>

                    <div class="field">
                        <span>Mỗi thiết bị sẽ…</span>
                        ${home.floors.map(floor => html`
                            ${floor.rooms.map(room => html`
                                <div class="pick-room">${room.name} <small>${floor.name}</small></div>
                                ${room.devices.map(d => html`
                                    <div class="pick-row" data-key="${d.key}">
                                        <span>${d.name}</span>
                                        <div class="tri">
                                            <button type="button" data-val="on">Bật</button>
                                            <button type="button" data-val="off">Tắt</button>
                                            <button type="button" data-val="skip">Bỏ qua</button>
                                        </div>
                                    </div>`)}`)}`)}
                    </div>
                `);

                const paintIcons = () => $$('#iconPick button', el)
                    .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.icon === icon)));
                const paintRow = row => $$('.tri button', row)
                    .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === choice.get(row.dataset.key))));

                paintIcons();
                $$('.pick-row', el).forEach(paintRow);

                el.addEventListener('click', e => {
                    const iconBtn = e.target.closest('#iconPick button');
                    if (iconBtn) {
                        icon = iconBtn.dataset.icon;
                        paintIcons();
                        return;
                    }
                    const triBtn = e.target.closest('.tri button');
                    if (triBtn) {
                        const row = triBtn.closest('.pick-row');
                        choice.set(row.dataset.key, triBtn.dataset.val);
                        paintRow(row);
                    }
                });
            },
            footer(el, close) {
                render(el, html`
                    ${scene ? html`<button class="btn-pill btn-danger" data-act="delete"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}
                    <span class="sheet__spacer"></span>
                    <button class="btn-pill" data-act="cancel">Hủy</button>
                    <button class="btn-pill btn-primary" data-act="save"><i class="fa-solid fa-check"></i>Lưu</button>`);
                el.addEventListener('click', e => {
                    const act = e.target.closest('button')?.dataset.act;
                    if (act === 'cancel') return close();
                    if (act === 'delete') {
                        const n = schedules.forScene(scene.id).length;
                        if (!confirm(`Xóa kịch bản "${scene.name}"${n ? ` và ${n} lịch hẹn của nó` : ''}?`)) return;
                        scenes.remove(scene.id);
                        schedules.removeScene(scene.id);
                        toast('Đã xóa kịch bản', 'info');
                        return close();
                    }
                    if (act !== 'save') return;

                    const name = $('#sceneName').value.trim();
                    const actions = [...choice]
                        .filter(([, val]) => val !== 'skip')
                        .map(([key, val]) => ({ key, on: val === 'on' }));
                    if (!name) return toast('Bạn chưa đặt tên kịch bản', 'error');
                    if (!actions.length) return toast('Chọn ít nhất 1 thiết bị Bật hoặc Tắt', 'error');

                    scenes.save({ id: scene?.id, name, icon, actions });
                    toast(scene ? 'Đã cập nhật kịch bản' : 'Đã tạo kịch bản', 'success');
                    close();
                });
            }
        });
    }

    // ---------- Sự kiện ----------
    root.addEventListener('click', e => {
        if (e.target.closest('#addScene')) return openEditor(null);

        const btn = e.target.closest('[data-act]');
        if (!btn) return;

        // Lịch hẹn
        if (btn.dataset.act === 'add-sched') return openSchedule(null);
        const row = btn.closest('.sched');
        if (row) {
            const s = schedules.get(row.dataset.sched);
            if (!s) return;
            if (btn.dataset.act === 'toggle-sched') {
                tap(settings);
                schedules.setEnabled(s.id, !s.enabled);
                toast(s.enabled ? 'Đã tắt lịch' : `Đã bật lịch · ${relativeText(nextRun({ ...s, enabled: true }, new Date(), location))}`, 'info');
            } else if (btn.dataset.act === 'edit-sched') {
                openSchedule(s);
            }
            return;
        }

        // Thẻ kịch bản
        const card = btn.closest('.scene');
        if (!card) return;
        const scene = scenes.get(card.dataset.id);
        if (!scene) return;

        if (btn.dataset.act === 'run') {
            tap(settings);
            store.setMany(scene.actions);
            scenes.activate(scene.id);
            toast(`Đã chạy "${scene.name}"`, 'success');
        } else if (btn.dataset.act === 'edit') {
            openEditor(scene);
        } else if (btn.dataset.act === 'schedule') {
            const own = schedules.forScene(scene.id);
            if (own.length === 1) openSchedule(own[0]);
            else openSchedule(null, scene.id);
        }
    });

    const offScenes = scenes.onChange(draw);
    const offSched = schedules.onChange(draw);
    const clock = setInterval(draw, 60000); // "Lần tới: ..." luôn đúng
    draw();
    return () => {
        offScenes();
        offSched();
        clearInterval(clock);
    };
}
