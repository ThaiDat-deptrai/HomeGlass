// =============================================================
// MÀN HÌNH QUẢN LÝ PHÒNG & THIẾT BỊ (Cài đặt -> Phòng & thiết bị)
// -------------------------------------------------------------
// Thêm / sửa / xóa phòng, thiết bị, bộ điều khiển ESP ngay trong app.
// Không cần sửa code hay file JSON bằng tay.
// Mọi thay đổi đi qua core/homeData.js rồi ctx.saveHome() kiểm tra lại.
// =============================================================

import { html, render, $, $$ } from '../dom.js';
import { openSheet } from '../sheet.js';
import { DEVICE_TYPES, deviceIcon, roomIcon, typeLabel } from '../icons.js';
import * as edit from '../../core/homeData.js';

const FLOOR_KEY = 'hg.ui.manageFloor';

const nodeText = (home, id) => (id === null || id === undefined ? 'Chưa gán ESP' : home.nodes.get(id)?.name || `ESP ${id}`);

export function mount(root, ctx) {
    const { home, toast } = ctx;
    let floorIndex = Math.min(Number(sessionStorage.getItem(FLOOR_KEY)) || 0, home.floors.length - 1);

    /** Lưu cấu hình mới; báo lỗi dễ hiểu nếu có gì sai. */
    function save(data, message) {
        try {
            ctx.saveHome(data);
            if (message) toast(message, 'success');
            return true;
        } catch (e) {
            toast(e.problems ? e.problems[0] : 'Không lưu được thay đổi', 'error');
            return false;
        }
    }

    // ---------- Vẽ ----------
    function draw() {
        const floor = home.floors[floorIndex];
        render(root, html`
            <header class="page-head">
                <a class="back-link" href="#/settings"><i class="fa-solid fa-chevron-left"></i>Cài đặt</a>
                <h1>Phòng & thiết bị</h1>
                <p>${ctx.homeSource() === 'local' ? 'Đang dùng bản đã chỉnh trên máy này' : 'Đang dùng file cấu hình gốc'}</p>
            </header>

            <div class="segmented segmented--block" id="mFloors" role="tablist" style="--n:${home.floors.length}; --i:${floorIndex}">
                <span class="segmented__thumb"></span>
                ${home.floors.map((f, i) => html`<button role="tab" data-index="${i}" aria-selected="${i === floorIndex}">${f.name}</button>`)}
            </div>

            <div class="manage-rooms">
                ${floor.rooms.map(room => html`
                    <section class="card manage-room" data-room="${room.id}">
                        <header class="manage-room__head">
                            <span class="room__icon"><i class="fa-solid ${roomIcon(room)}"></i></span>
                            <div class="room__title">
                                <h2>${room.name}</h2>
                                <span class="room__meta">${room.devices.length} thiết bị · ${nodeText(home, room.node)}</span>
                            </div>
                            <button class="icon-btn" data-act="edit-room" aria-label="Sửa phòng ${room.name}"><i class="fa-solid fa-pen"></i></button>
                        </header>
                        <ul class="manage-list">
                            ${room.devices.map(d => html`
                                <li>
                                    <button class="manage-item" data-act="edit-device" data-key="${d.key}">
                                        <span class="manage-item__icon"><i class="fa-solid ${deviceIcon(d)}"></i></span>
                                        <span class="manage-item__text">
                                            <strong>${d.name}</strong>
                                            <small>${typeLabel(d)} · ${d.node === null ? 'Chưa gán ESP' : nodeText(home, d.node) + (d.ch ? ` · Relay ${d.ch}` : ' · Chưa chọn relay')}</small>
                                        </span>
                                        <i class="fa-solid fa-chevron-right manage-item__go"></i>
                                    </button>
                                </li>`)}
                            <li>
                                <button class="manage-add" data-act="add-device"><i class="fa-solid fa-plus"></i>Thêm thiết bị</button>
                            </li>
                        </ul>
                    </section>`)}
                <button class="manage-add manage-add--room card" data-act="add-room"><i class="fa-solid fa-plus"></i>Thêm phòng vào ${floor.name}</button>
            </div>

            <h2 class="section-title">Bộ điều khiển ESP</h2>
            <section class="card group">
                ${[...home.nodes.values()].map(n => html`
                    <div class="row">
                        <span class="row__label"><i class="fa-solid ${n.id === 0 ? 'fa-server' : 'fa-microchip'}"></i>${n.name}</span>
                        <span class="row__value">${n.board} · số ${n.id}</span>
                        <button class="icon-btn" data-act="edit-node" data-node="${n.id}" aria-label="Sửa ${n.name}"><i class="fa-solid fa-pen"></i></button>
                    </div>`)}
                <div class="row">
                    <button class="manage-add" data-act="add-node"><i class="fa-solid fa-plus"></i>Thêm ESP</button>
                </div>
            </section>

            <h2 class="section-title">File cấu hình</h2>
            <section class="card group">
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-download"></i>Tải về file home.json</span>
                    <button class="btn-pill" data-act="export">Tải về</button>
                </div>
                ${ctx.homeSource() === 'local' ? html`
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-rotate-left"></i>Bỏ chỉnh sửa, dùng file gốc</span>
                    <button class="btn-pill btn-danger" data-act="reset">Khôi phục</button>
                </div>` : ''}
                <p class="group__note">Thay đổi hiện lưu trên máy này. Khi nối MQTT ở bước sau, cấu hình sẽ tự đồng bộ cho cả nhà và ESP.</p>
            </section>
        `);
    }

    // ---------- Các ô chọn dùng chung trong form ----------
    // Thiết bị: "Theo phòng" (dùng ESP của phòng) hoặc chọn ESP riêng.
    // Phòng: "Chưa gán" hoặc chọn ESP.
    const nodeOptions = (selected, forDevice = false) => html`
        ${forDevice
            ? html`<option value="inherit" ${selected === 'inherit' ? 'selected' : ''}>Theo phòng</option>`
            : html`<option value="" ${selected === null ? 'selected' : ''}>Chưa gán</option>`}
        ${[...home.nodes.values()].map(n => html`<option value="${n.id}" ${selected === n.id ? 'selected' : ''}>${n.name} (số ${n.id})</option>`)}`;

    const roomOptions = selected => html`${home.floors.map(f => html`
        <optgroup label="${f.name}">
            ${f.rooms.map(r => html`<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${r.name}</option>`)}
        </optgroup>`)}`;

    const readNode = value => (value === '' ? null : value === 'inherit' ? undefined : Number(value));

    // ---------- Form thiết bị ----------
    function deviceSheet(device, roomId) {
        let type = device?.type || 'light';
        openSheet({
            title: device ? 'Sửa thiết bị' : 'Thêm thiết bị',
            body(el) {
                render(el, html`
                    <label class="field"><span>Tên</span>
                        <input type="text" id="dName" maxlength="30" placeholder="Ví dụ: Quạt trần" value="${device?.name || ''}" />
                    </label>
                    <div class="field"><span>Loại</span>
                        <div class="type-pick" id="dType">
                            ${Object.entries(DEVICE_TYPES).map(([id, t]) => html`
                                <button type="button" data-type="${id}" aria-pressed="${id === type}"><i class="fa-solid ${t.icon}"></i>${t.label}</button>`)}
                        </div>
                    </div>
                    <label class="field"><span>Phòng</span>
                        <select id="dRoom">${roomOptions(device?.room.id || roomId)}</select>
                    </label>
                    <div class="field-row">
                        <label class="field"><span>Bộ điều khiển</span>
                            <select id="dNode">${nodeOptions(device ? (device.ownNode ?? 'inherit') : 'inherit', true)}</select>
                        </label>
                        <label class="field field--small"><span>Relay số</span>
                            <input type="number" id="dCh" min="1" max="16" placeholder="–" value="${device?.ch ?? ''}" />
                        </label>
                    </div>
                    <p class="field__hint">"Theo phòng": dùng ESP đã gán cho phòng. Relay số = chân relay trên ESP nối tới thiết bị này.</p>
                `);
                el.addEventListener('click', e => {
                    const btn = e.target.closest('#dType button');
                    if (!btn) return;
                    type = btn.dataset.type;
                    $$('#dType button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
                });
            },
            footer(el, close) {
                render(el, html`
                    ${device ? html`<button class="btn-pill btn-danger" data-act="delete"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}
                    <span class="sheet__spacer"></span>
                    <button class="btn-pill" data-act="cancel">Hủy</button>
                    <button class="btn-pill btn-primary" data-act="save"><i class="fa-solid fa-check"></i>Lưu</button>`);
                el.addEventListener('click', e => {
                    const act = e.target.closest('button')?.dataset.act;
                    if (act === 'cancel') return close();
                    if (act === 'delete') {
                        if (!confirm(`Xóa "${device.name}"?`)) return;
                        if (save(edit.removeDevice(home.raw, device.key), 'Đã xóa thiết bị')) close();
                        return;
                    }
                    if (act !== 'save') return;

                    const name = $('#dName').value.trim();
                    if (!name) return toast('Bạn chưa đặt tên thiết bị', 'error');
                    const chRaw = $('#dCh').value;
                    const ch = chRaw === '' ? null : Number(chRaw);
                    if (ch !== null && (!Number.isInteger(ch) || ch < 1 || ch > 16)) return toast('Relay số phải từ 1 đến 16', 'error');
                    const node = readNode($('#dNode').value);
                    const fields = { name, type, ch, node: node === undefined ? null : node };
                    const targetRoom = $('#dRoom').value;

                    if (device) {
                        const result = edit.updateDevice(home.raw, device.key, { ...fields, roomId: targetRoom });
                        // Đổi phòng -> mã đổi: báo kịch bản TRƯỚC khi lưu (lưu xong sẽ dọn mã cũ)
                        ctx.scenes.renameKey(device.key, result.key);
                        if (save(result.data, 'Đã lưu thiết bị')) close();
                        else ctx.scenes.renameKey(result.key, device.key);
                    } else {
                        const result = edit.addDevice(home.raw, targetRoom, fields);
                        if (save(result.data, `Đã thêm "${name}"`)) close();
                    }
                });
            }
        });
    }

    // ---------- Form phòng ----------
    function roomSheet(room) {
        const floor = home.floors[floorIndex];
        openSheet({
            title: room ? 'Sửa phòng' : 'Thêm phòng',
            body(el) {
                render(el, html`
                    <label class="field"><span>Tên phòng</span>
                        <input type="text" id="rName" maxlength="30" placeholder="Ví dụ: Phòng làm việc" value="${room?.name || ''}" />
                    </label>
                    <label class="field"><span>Tầng</span>
                        <select id="rFloor">${home.floors.map(f => html`<option value="${f.id}" ${f.id === (room?.floor.id || floor.id) ? 'selected' : ''}>${f.name}</option>`)}</select>
                    </label>
                    <label class="field"><span>Bộ điều khiển của phòng</span>
                        <select id="rNode">${nodeOptions(room ? room.node : null)}</select>
                    </label>
                    ${room?.devices.length ? html`<p class="field__hint">Xóa phòng sẽ xóa luôn ${room.devices.length} thiết bị trong phòng.</p>` : ''}
                `);
            },
            footer(el, close) {
                render(el, html`
                    ${room ? html`<button class="btn-pill btn-danger" data-act="delete"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}
                    <span class="sheet__spacer"></span>
                    <button class="btn-pill" data-act="cancel">Hủy</button>
                    <button class="btn-pill btn-primary" data-act="save"><i class="fa-solid fa-check"></i>Lưu</button>`);
                el.addEventListener('click', e => {
                    const act = e.target.closest('button')?.dataset.act;
                    if (act === 'cancel') return close();
                    if (act === 'delete') {
                        if (!confirm(`Xóa phòng "${room.name}" và ${room.devices.length} thiết bị bên trong?`)) return;
                        if (save(edit.removeRoom(home.raw, room.id), 'Đã xóa phòng')) close();
                        return;
                    }
                    if (act !== 'save') return;
                    const name = $('#rName').value.trim();
                    if (!name) return toast('Bạn chưa đặt tên phòng', 'error');
                    const floorId = $('#rFloor').value;
                    const node = readNode($('#rNode').value);
                    if (room) {
                        if (save(edit.updateRoom(home.raw, room.id, { name, floorId, node }), 'Đã lưu phòng')) close();
                    } else {
                        const result = edit.addRoom(home.raw, floorId, { name, node });
                        if (save(result.data, `Đã thêm "${name}"`)) close();
                    }
                });
            }
        });
    }

    // ---------- Form ESP ----------
    function nodeSheet(node) {
        openSheet({
            title: node ? 'Sửa bộ điều khiển' : 'Thêm bộ điều khiển',
            body(el) {
                render(el, html`
                    <label class="field"><span>Tên</span>
                        <input type="text" id="nName" maxlength="30" placeholder="Ví dụ: ESP phòng khách" value="${node?.name || ''}" />
                    </label>
                    <label class="field"><span>Loại mạch</span>
                        <select id="nBoard">
                            ${['ESP32-C3', 'ESP32-S3', 'ESP32'].map(b => html`<option ${b === (node?.board || 'ESP32-C3') ? 'selected' : ''}>${b}</option>`)}
                        </select>
                    </label>
                    ${node ? html`<p class="field__hint">Số của ESP này là <strong>${node.id}</strong>. Khi nạp code cho mạch, đặt đúng số này.</p>` : ''}
                `);
            },
            footer(el, close) {
                render(el, html`
                    ${node && node.id !== 0 ? html`<button class="btn-pill btn-danger" data-act="delete"><i class="fa-solid fa-trash"></i>Xóa</button>` : ''}
                    <span class="sheet__spacer"></span>
                    <button class="btn-pill" data-act="cancel">Hủy</button>
                    <button class="btn-pill btn-primary" data-act="save"><i class="fa-solid fa-check"></i>Lưu</button>`);
                el.addEventListener('click', e => {
                    const act = e.target.closest('button')?.dataset.act;
                    if (act === 'cancel') return close();
                    if (act === 'delete') {
                        if (!confirm(`Xóa "${node.name}"? Phòng và thiết bị đang gán vào nó sẽ thành "Chưa gán".`)) return;
                        if (save(edit.removeNode(home.raw, node.id), 'Đã xóa bộ điều khiển')) close();
                        return;
                    }
                    if (act !== 'save') return;
                    const name = $('#nName').value.trim();
                    const board = $('#nBoard').value;
                    if (!name) return toast('Bạn chưa đặt tên', 'error');
                    if (node) {
                        if (save(edit.updateNode(home.raw, node.id, { name, board }), 'Đã lưu')) close();
                    } else {
                        const result = edit.addNode(home.raw, { name, board });
                        if (save(result.data, `Đã thêm "${name}" (số ${result.id})`)) close();
                    }
                });
            }
        });
    }

    // ---------- Sự kiện ----------
    root.addEventListener('click', e => {
        const floorBtn = e.target.closest('#mFloors button');
        if (floorBtn) {
            floorIndex = Number(floorBtn.dataset.index);
            sessionStorage.setItem(FLOOR_KEY, String(floorIndex));
            draw();
            return;
        }
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const roomId = btn.closest('.manage-room')?.dataset.room;
        switch (btn.dataset.act) {
            case 'add-device': return deviceSheet(null, roomId);
            case 'edit-device': return deviceSheet(home.devices.get(btn.dataset.key));
            case 'add-room': return roomSheet(null);
            case 'edit-room': return roomSheet(home.rooms.get(roomId));
            case 'add-node': return nodeSheet(null);
            case 'edit-node': return nodeSheet(home.nodes.get(Number(btn.dataset.node)));
            case 'export':
                ctx.exportHome();
                return toast('Đã tải file home.json', 'success');
            case 'reset':
                if (confirm('Bỏ mọi chỉnh sửa và dùng lại file cấu hình gốc?')) {
                    ctx.resetHome();
                    toast('Đã dùng lại file gốc', 'info');
                }
        }
    });

    draw();
    return () => {};
}
