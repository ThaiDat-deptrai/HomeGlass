// =============================================================
// MÀN HÌNH KỊCH BẢN - chạy, tạo, sửa, xóa kịch bản
// =============================================================

import { html, render, $, $$ } from '../dom.js';
import { openSheet } from '../sheet.js';
import { tap } from '../feedback.js';
import { SCENE_ICONS } from '../../core/scenes.js';

function summary(scene) {
    const on = scene.actions.filter(a => a.on).length;
    const off = scene.actions.length - on;
    return [on && `${on} bật`, off && `${off} tắt`].filter(Boolean).join(' · ') || 'Chưa có thiết bị';
}

export function mount(root, { home, store, scenes, settings, toast }) {
    function sceneCard(scene) {
        const active = scenes.activeId() === scene.id;
        return html`
            <article class="scene card ${active ? 'is-active' : ''}" data-id="${scene.id}">
                <span class="scene__icon"><i class="fa-solid ${scene.icon}"></i></span>
                <div class="scene__text">
                    <h3>${scene.name}${active ? html` <span class="scene__badge">Đang bật</span>` : ''}</h3>
                    <p>${scene.note || summary(scene)}</p>
                </div>
                ${scene.preset ? '' : html`
                    <button class="icon-btn" data-act="edit" aria-label="Sửa"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn icon-btn--danger" data-act="delete" aria-label="Xóa"><i class="fa-solid fa-trash"></i></button>`}
                <button class="scene__run" data-act="run" aria-label="Chạy"><i class="fa-solid fa-play"></i></button>
            </article>`;
    }

    function draw() {
        const all = scenes.list();
        const presets = all.filter(s => s.preset);
        const custom = all.filter(s => !s.preset);
        render(root, html`
            <header class="page-head page-head--row">
                <div>
                    <h1>Kịch bản</h1>
                    <p>Bấm một lần, cả nhà làm theo</p>
                </div>
                <button class="btn-pill btn-primary" id="addScene"><i class="fa-solid fa-plus"></i>Tạo mới</button>
            </header>

            <h2 class="section-title">Có sẵn</h2>
            <div class="scene-grid">${presets.map(sceneCard)}</div>

            <h2 class="section-title">Của tôi</h2>
            ${custom.length
                ? html`<div class="scene-grid">${custom.map(sceneCard)}</div>`
                : html`<div class="card empty"><i class="fa-solid fa-wand-magic-sparkles"></i>Chưa có kịch bản riêng.<br>Bấm "Tạo mới" để tự chọn đèn nào bật, đèn nào tắt.</div>`}
        `);
    }

    // ---------- Form tạo / sửa ----------
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
                    <button class="btn-pill" data-act="cancel">Hủy</button>
                    <button class="btn-pill btn-primary" data-act="save"><i class="fa-solid fa-check"></i>Lưu</button>`);
                el.addEventListener('click', e => {
                    const act = e.target.closest('button')?.dataset.act;
                    if (act === 'cancel') return close();
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
        const card = e.target.closest('.scene');
        if (!btn || !card) return;
        const scene = scenes.get(card.dataset.id);
        if (!scene) return;

        if (btn.dataset.act === 'run') {
            tap(settings);
            store.setMany(scene.actions);
            scenes.activate(scene.id);
            toast(`Đã chạy "${scene.name}"`, 'success');
        } else if (btn.dataset.act === 'edit') {
            openEditor(scene);
        } else if (btn.dataset.act === 'delete') {
            if (confirm(`Xóa kịch bản "${scene.name}"?`)) {
                scenes.remove(scene.id);
                toast('Đã xóa kịch bản', 'info');
            }
        }
    });

    const off = scenes.onChange(draw);
    draw();
    return off;
}
