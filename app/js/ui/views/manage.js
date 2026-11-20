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
import { DRIVERS } from '../../core/stairs.js';
import { SERVO_DEFAULTS, channelConflicts, deviceOnChannel } from '../../core/config.js';
import { pinLabel } from '../../core/protocol.js';
import { onSwipe, decideStep, dragFollow, rubber, isPhone, EDGE_BACK } from '../swipe.js';
import { stretch, swapIn, reducedMotion, EASE_SPRING_SOFT } from '../motion.js';
import { loadManifest, latestFor, updateState, OTA_STAGE_TEXT } from '../../core/firmware.js';

const FLOOR_KEY = 'hg.ui.manageFloor';
const SORT_KEY = 'hg.ui.sortMode';

const nodeText = (home, id) => (id === null || id === undefined ? 'Chưa gán ESP' : home.nodes.get(id)?.name || `ESP ${id}`);

/** "kênh 1 · GPIO4" - kèm luôn chân cắm cho khỏi nhầm. */
function channelText(home, d) {
    if (!d.ch) return 'chưa chọn kênh';
    const board = home.nodes.get(d.node)?.board;
    return `kênh ${d.ch} · ${board ? pinLabel(board, d.ch) : '?'}`;
}

export function mount(root, ctx) {
    const { home, toast } = ctx;
    let floorIndex = Math.min(Number(sessionStorage.getItem(FLOOR_KEY)) || 0, home.floors.length - 1);
    let sortMode = sessionStorage.getItem(SORT_KEY) === '1';

    // Danh sách firmware mới nhất (để hiện "Có bản mới" + nút cập nhật). null = đang đọc, false = lỗi.
    let manifest = null;
    const onManifest = new Set();
    if (ctx.store.canUpdate) {
        loadManifest().then(m => {
            manifest = m || false;
            onManifest.forEach(fn => fn());
            if (m) draw();
        });
    }

    /** Các thiết bị mà ESP này thực sự điều khiển (kể cả "theo phòng"), xếp theo kênh. */
    const devicesOf = id => home.allDevices
        .filter(d => d.node === id)
        .sort((a, b) => (a.ch ?? 99) - (b.ch ?? 99));

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
        const conflicts = channelConflicts(home);
        render(root, html`
            <header class="page-head">
                <a class="back-link" href="#/settings"><i class="fa-solid fa-chevron-left"></i>Cài đặt</a>
                <div class="page-head__row">
                    <h1>Phòng & thiết bị</h1>
                    <button class="btn-pill ${sortMode ? 'btn-primary' : ''}" data-act="sort" aria-pressed="${sortMode}">
                        <i class="fa-solid ${sortMode ? 'fa-check' : 'fa-arrow-down-up-across-line'}"></i>${sortMode ? 'Xong' : 'Sắp xếp'}
                    </button>
                </div>
                <p>${sortMode
                    ? 'Bấm mũi tên để đổi chỗ phòng / đèn. Thứ tự này hiện y hệt ở màn hình Nhà.'
                    : ctx.homeSource() === 'local' ? 'Đang dùng bản đã chỉnh trên máy này' : 'Đang dùng file cấu hình gốc'}</p>
            </header>

            <div class="segmented segmented--block" id="mFloors" role="tablist" style="--n:${home.floors.length}; --i:${floorIndex}">
                <span class="segmented__thumb"></span>
                ${home.floors.map((f, i) => html`<button role="tab" data-index="${i}" aria-selected="${i === floorIndex}">${f.name}</button>`)}
            </div>

            <div class="manage-rooms ${sortMode ? 'is-sorting' : ''}">
                ${floor.rooms.map((room, ri) => html`
                    <section class="card manage-room" data-room="${room.id}">
                        <header class="manage-room__head">
                            <span class="room__icon"><i class="fa-solid ${roomIcon(room)}"></i></span>
                            <div class="room__title">
                                <h2>${room.name}</h2>
                                <span class="room__meta">${room.devices.length} thiết bị · ${nodeText(home, room.node)}</span>
                            </div>
                            ${sortMode ? html`
                                <span class="sort-btns">
                                    <button class="icon-btn" data-act="room-up" ${ri === 0 ? 'disabled' : ''} aria-label="Đưa ${room.name} lên"><i class="fa-solid fa-chevron-up"></i></button>
                                    <button class="icon-btn" data-act="room-down" ${ri === floor.rooms.length - 1 ? 'disabled' : ''} aria-label="Đưa ${room.name} xuống"><i class="fa-solid fa-chevron-down"></i></button>
                                </span>`
                            : html`<button class="icon-btn" data-act="edit-room" aria-label="Sửa phòng ${room.name}"><i class="fa-solid fa-pen"></i></button>`}
                        </header>
                        <ul class="manage-list">
                            ${room.devices.map((d, di) => html`
                                <li class="${sortMode ? 'sort-row' : ''}">
                                    <button class="manage-item" data-act="${sortMode ? '' : 'edit-device'}" data-key="${d.key}">
                                        <span class="manage-item__icon"><i class="fa-solid ${deviceIcon(d)}"></i></span>
                                        <span class="manage-item__text">
                                            <strong>${d.name}</strong>
                                            <small>${typeLabel(d)}${d.actuator === 'servo' ? ' · Servo' : d.actuator === 'relay' ? ' · Relay' : ''} · ${d.node === null ? 'Chưa gán ESP' : nodeText(home, d.node) + (d.type === 'stairs' ? ` · ${d.steps} bậc` : ` · ${channelText(home, d)}`)}</small>
                                            ${conflicts.has(d.key) ? html`<small class="warn"><i class="fa-solid fa-triangle-exclamation"></i>Trùng kênh với ${conflicts.get(d.key).name} (${conflicts.get(d.key).room.name})</small>` : ''}
                                        </span>
                                        ${sortMode ? '' : html`<i class="fa-solid fa-chevron-right manage-item__go"></i>`}
                                    </button>
                                    ${sortMode ? html`
                                    <span class="sort-btns">
                                        <button class="icon-btn" data-act="dev-up" data-key="${d.key}" ${di === 0 ? 'disabled' : ''} aria-label="Đưa ${d.name} lên"><i class="fa-solid fa-chevron-up"></i></button>
                                        <button class="icon-btn" data-act="dev-down" data-key="${d.key}" ${di === room.devices.length - 1 ? 'disabled' : ''} aria-label="Đưa ${d.name} xuống"><i class="fa-solid fa-chevron-down"></i></button>
                                    </span>` : ''}
                                </li>`)}
                            ${sortMode ? '' : html`
                            <li>
                                <button class="manage-add" data-act="add-device"><i class="fa-solid fa-plus"></i>Thêm thiết bị</button>
                            </li>`}
                        </ul>
                    </section>`)}
                ${sortMode ? '' : html`<button class="manage-add manage-add--room card" data-act="add-room"><i class="fa-solid fa-plus"></i>Thêm phòng vào ${floor.name}</button>`}
            </div>

            <h2 class="section-title">Bộ điều khiển ESP</h2>
            <section class="card group">
                ${[...home.nodes.values()].map(n => {
                    const count = devicesOf(n.id).length;
                    const fw = ctx.store.node(n.id)?.health?.fw;
                    const hasNew = updateState(fw, latestFor(manifest, n.id)) === 'update';
                    return html`
                    <button class="row row--link row--btn" data-act="edit-node" data-node="${n.id}">
                        <span class="row__label"><i class="fa-solid ${n.id === 0 ? 'fa-server' : 'fa-microchip'}"></i>${n.name}</span>
                        <span class="row__value">${hasNew ? html`<span class="new-dot">Có bản mới</span>` : ''}số ${n.id} · ${count ? `${count} thiết bị` : 'chưa gắn gì'}</span>
                        <i class="fa-solid fa-chevron-right row__go"></i>
                    </button>`;
                })}
                <div class="row">
                    <button class="manage-add" data-act="add-node"><i class="fa-solid fa-plus"></i>Thêm ESP</button>
                </div>
            </section>

            <p class="group__note"><i class="fa-solid fa-box-archive"></i> Sao lưu / khôi phục: xem ở <a href="#/settings">Cài đặt → Sao lưu & khôi phục</a>.</p>
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
        let actuator = device?.actuator || 'servo';
        const angles = { ...SERVO_DEFAULTS, ...device?.servo };
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
                    <div class="field" id="dActField"><span>Cách bật tắt</span>
                        <div class="segmented segmented--block" id="dAct" role="tablist" style="--n:2; --i:${actuator === 'relay' ? 1 : 0}">
                            <span class="segmented__thumb"></span>
                            <button type="button" role="tab" data-act-type="servo" aria-selected="${actuator === 'servo'}"><i class="fa-solid fa-hand-pointer"></i>Servo gạt công tắc</button>
                            <button type="button" role="tab" data-act-type="relay" aria-selected="${actuator === 'relay'}"><i class="fa-solid fa-plug"></i>Relay</button>
                        </div>
                    </div>
                    <div class="field" id="dServoField"><span class="field__label-row">Góc servo (độ)
                            <button type="button" class="btn-pill btn-sm" id="dSwap" title="Đổi góc BẬT và TẮT cho nhau (công tắc lắp ngược)"><i class="fa-solid fa-right-left"></i>Đảo chiều</button></span>
                        <div class="angle-row">
                            <label><small>Gạt BẬT</small><input type="number" id="dOn" min="0" max="180" value="${angles.on}" /></label>
                            <label><small>Gạt TẮT</small><input type="number" id="dOff" min="0" max="180" value="${angles.off}" /></label>
                            <label><small>Về nghỉ</small><input type="number" id="dRest" min="0" max="180" value="${angles.rest}" /></label>
                        </div>
                    </div>
                    <div class="field-row">
                        <label class="field"><span>Bộ điều khiển</span>
                            <select id="dNode">${nodeOptions(device ? (device.ownNode ?? 'inherit') : 'inherit', true)}</select>
                        </label>
                        <label class="field" id="dChField"><span id="dChLabel">Relay số</span>
                            <select id="dCh"></select>
                        </label>
                        <label class="field field--small" id="dStepsField"><span>Số bậc</span>
                            <input type="number" id="dSteps" min="2" max="32" value="${device?.steps ?? 13}" />
                        </label>
                    </div>
                    <p class="pin-hint" id="dPin" aria-live="polite"></p>
                    <div class="row" id="dLowField">
                        <span class="row__label row__label--wrap"><i class="fa-solid fa-arrow-down-short-wide"></i>
                            <span>Relay kích mức thấp<small>Bật nếu relay chạy NGƯỢC (bấm bật mà relay tắt). Không phải sửa code.</small></span></span>
                        <button type="button" class="switch" role="switch" id="dLow" aria-checked="${device?.relayLow === true}"></button>
                    </div>
                    <label class="field" id="dDriverField"><span>Mạch điều khiển các bậc</span>
                        <select id="dDriver">
                            ${Object.entries(DRIVERS).map(([id, d]) => html`<option value="${id}" ${id === (device?.driver || 'pca9685') ? 'selected' : ''}>${d.label} — ${d.note}</option>`)}
                        </select>
                    </label>
                    <p class="field__hint" id="dHint"></p>
                `);
                // ----- Ô chọn kênh: mỗi kênh ghi luôn CHÂN cắm trên ESP, kênh đã dùng thì ghi đang dùng cho gì -----
                let chosenCh = device?.ch ?? null;
                const effectiveNode = () => {
                    const v = readNode($('#dNode', el).value);
                    return v === undefined ? (home.rooms.get($('#dRoom', el).value)?.node ?? null) : v;
                };
                const paintChannels = () => {
                    const nodeId = effectiveNode();
                    const node = home.nodes.get(nodeId);
                    const board = node?.board || 'ESP32-C3';
                    const select = $('#dCh', el);
                    const opts = [`<option value="">– Chưa chọn –</option>`];
                    for (let ch = 1; ch <= 16; ch++) {
                        const used = nodeId !== null ? deviceOnChannel(home, nodeId, ch, device?.key) : null;
                        const pin = pinLabel(board, ch);
                        const label = `Kênh ${ch} — ${pin}${used ? ` (đang dùng: ${used.name})` : ''}`;
                        opts.push(`<option value="${ch}"${ch === chosenCh ? ' selected' : ''}>${label.replace(/</g, '&lt;')}</option>`);
                    }
                    select.innerHTML = opts.join('');
                    const hint = $('#dPin', el);
                    if (type === 'stairs') { hint.hidden = true; return; }
                    hint.hidden = false;
                    if (nodeId === null) {
                        hint.innerHTML = '<i class="fa-solid fa-circle-info"></i>Chưa gán ESP: chọn <strong>Bộ điều khiển</strong> (hoặc gán ESP cho phòng) để biết cắm chân nào.';
                    } else if (!chosenCh) {
                        hint.innerHTML = `<i class="fa-solid fa-circle-info"></i>Chọn kênh: mỗi kênh là 1 chân trên <strong>${node?.name || 'ESP ' + nodeId}</strong> (${board}).`;
                    } else {
                        const where = chosenCh >= 9 ? `cổng <strong>${chosenCh - 9}</strong> của mạch mở rộng PCA9685` : `chân <strong>${pinLabel(board, chosenCh)}</strong>`;
                        hint.innerHTML = `<i class="fa-solid fa-plug"></i>Cắm dây ${actuator === 'servo' && type !== 'stairs' ? 'tín hiệu servo (dây cam/vàng)' : 'chân IN của relay'} vào ${where} trên <strong>${node?.name || 'ESP ' + nodeId}</strong> (${board}).`;
                    }
                };

                // Cầu thang: hỏi số bậc thay cho số relay
                const paintType = () => {
                    const stairs = type === 'stairs';
                    const servo = !stairs && actuator === 'servo';
                    $('#dChField', el).hidden = stairs;
                    $('#dActField', el).hidden = stairs;
                    $('#dServoField', el).hidden = !servo;
                    $('#dLowField', el).hidden = stairs || servo;
                    $('#dStepsField', el).hidden = !stairs;
                    $('#dDriverField', el).hidden = !stairs;
                    $('#dChLabel', el).textContent = servo ? 'Kênh servo' : 'Relay số';
                    $('#dAct', el).style.setProperty('--i', actuator === 'relay' ? 1 : 0);
                    $$('#dAct button', el).forEach(b => b.setAttribute('aria-selected', String(b.dataset.actType === actuator)));
                    $('#dHint', el).textContent = stairs
                        ? 'Mỗi bậc 1 dải LED 12V + 1 module D4184, nối vào mạch PCA9685 (tối đa 16 bậc / 1 mạch, chỉnh sáng được). Nhà có 2 cầu thang thì thêm 2 thiết bị loại Cầu thang.'
                        : servo
                            ? 'Servo SG90 gạt công tắc tường sang BẬT/TẮT rồi về góc nghỉ (tay người vẫn bấm được). Không đụng điện 220V. Kênh servo = chân PWM / kênh mạch PCA9685 trên ESP.'
                            : '"Theo phòng": dùng ESP đã gán cho phòng. Relay số = chân relay trên ESP nối tới thiết bị này.';
                    paintChannels();
                };
                paintType();
                $('#dCh', el).addEventListener('change', e => {
                    chosenCh = e.target.value === '' ? null : Number(e.target.value);
                    paintChannels();
                });
                $('#dNode', el).addEventListener('change', paintChannels);
                $('#dRoom', el).addEventListener('change', paintChannels);
                el.addEventListener('click', e => {
                    if (e.target.closest('#dSwap')) {
                        const on = $('#dOn', el);
                        const off = $('#dOff', el);
                        [on.value, off.value] = [off.value, on.value];
                        return;
                    }
                    const low = e.target.closest('#dLow');
                    if (low) {
                        low.setAttribute('aria-checked', String(low.getAttribute('aria-checked') !== 'true'));
                        return;
                    }
                    const act = e.target.closest('#dAct button');
                    if (act) {
                        actuator = act.dataset.actType;
                        paintType();
                        return;
                    }
                    const btn = e.target.closest('#dType button');
                    if (!btn) return;
                    type = btn.dataset.type;
                    $$('#dType button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
                    paintType();
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
                    if (ch !== null && (!Number.isInteger(ch) || ch < 1 || ch > 16)) return toast('Kênh phải từ 1 đến 16', 'error');
                    const node = readNode($('#dNode').value);
                    const steps = Number($('#dSteps').value);
                    if (type === 'stairs' && !(Number.isInteger(steps) && steps >= 2 && steps <= 32)) {
                        return toast('Số bậc phải từ 2 đến 32', 'error');
                    }
                    let servo = null;
                    if (type !== 'stairs' && actuator === 'servo') {
                        servo = { on: Number($('#dOn').value), off: Number($('#dOff').value), rest: Number($('#dRest').value) };
                        if (Object.values(servo).some(a => !Number.isInteger(a) || a < 0 || a > 180)) {
                            return toast('Góc servo phải là số từ 0 đến 180', 'error');
                        }
                    }
                    const fields = {
                        name, type, ch,
                        node: node === undefined ? null : node,
                        steps: type === 'stairs' ? steps : null,
                        driver: type === 'stairs' ? $('#dDriver').value : null,
                        actuator: type === 'stairs' ? null : actuator,
                        servo,
                        relayLow: type !== 'stairs' && actuator === 'relay' && $('#dLow').getAttribute('aria-checked') === 'true'
                    };
                    const targetRoom = $('#dRoom').value;

                    // Chặn trùng kênh: ESP thực sự điều khiển = ESP riêng của thiết bị, hoặc ESP của phòng
                    if (type !== 'stairs' && ch !== null) {
                        const effNode = fields.node ?? home.rooms.get(targetRoom)?.node ?? null;
                        const other = deviceOnChannel(home, effNode, ch, device?.key);
                        if (other) {
                            return toast(`Kênh ${ch} của ${nodeText(home, effNode)} đang dùng cho ${other.name} (${other.room.name}). Chọn kênh khác nhé.`, 'error', 4500);
                        }
                    }

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

    /**
     * "Phiếu đấu dây" của 1 ESP: kênh nào nối thiết bị nào, servo góc bao nhiêu.
     * Dùng khi bảo trì: ESP hỏng -> nạp code cho ESP mới cùng số, cắm dây đúng bảng này là chạy lại.
     */
    function wiringHtml(node) {
        const list = devicesOf(node.id);
        const others = [...home.nodes.values()].filter(n => n.id !== node.id && n.id !== 0);
        return html`
            <div class="field"><span>Phiếu đấu dây (${list.length} thiết bị)</span>
                ${list.length ? html`
                <table class="data-table wiring">
                    <thead><tr><th>Kênh</th><th>Chân</th><th>Thiết bị</th><th>Cách</th></tr></thead>
                    <tbody>${list.map(d => html`
                        <tr>
                            <td>${d.type === 'stairs' ? 'I2C' : d.ch ?? '–'}</td>
                            <td>${d.type === 'stairs' ? 'SDA/SCL' : pinLabel(node.board, d.ch)}</td>
                            <td>${d.name}<small>${d.room.name}</small></td>
                            <td>${d.type === 'stairs' ? `${d.steps} bậc` : d.actuator === 'servo' ? `Servo ${d.servo.on}°/${d.servo.off}°/${d.servo.rest}°` : d.relayLow ? 'Relay (mức thấp)' : 'Relay'}</td>
                        </tr>`)}
                    </tbody>
                </table>` : html`<p class="field__hint">Chưa có thiết bị nào dùng ESP này.</p>`}
            </div>
            ${list.length && node.id !== 0 ? html`
            <div class="field"><span>ESP này hỏng?</span>
                <ol class="steps">
                    <li>Nạp code chung vào ESP mới, đặt <strong>số ESP = ${node.id}</strong>.</li>
                    <li>Cắm dây đúng theo phiếu ở trên (chụp màn hình lại cho chắc).</li>
                    <li>Cấp điện: ESP trung tâm tự gửi lại cấu hình (kênh, góc servo). Không phải cài gì thêm.</li>
                </ol>
                ${others.length ? html`
                <p class="field__hint">Hoặc tạm chuyển hết sang ESP khác đang rảnh kênh:</p>
                <div class="move-row">
                    <select id="nMoveTo">${others.map(n => html`<option value="${n.id}">${n.name} (số ${n.id})</option>`)}</select>
                    <button type="button" class="btn-pill" id="nMove"><i class="fa-solid fa-right-left"></i>Chuyển hết</button>
                </div>` : ''}
            </div>` : ''}`;
    }

    const RESET_TEXT = {
        POWERON: 'mới cấp điện', SW: 'tự khởi động lại', PANIC: 'lỗi phần mềm (đã tự cứu)',
        WATCHDOG: 'bị treo (đã tự cứu)', BROWNOUT: 'SỤT ÁP - kiểm tra nguồn', OTHER: 'khác'
    };
    const uptimeText = s => (s >= 86400 ? `${Math.floor(s / 86400)} ngày` : s >= 3600 ? `${Math.floor(s / 3600)} giờ` : `${Math.max(1, Math.floor(s / 60))} phút`);

    /** Phần mềm ESP: bản đang chạy, bản mới, nút cập nhật + tiến độ. */
    function firmwareHtml(node, s, h) {
        const latest = latestFor(manifest, node.id);
        const ota = s?.ota && Date.now() - s.ota.at < 5 * 60e3 ? s.ota : null;
        const busy = ota && !['done', 'error'].includes(ota.stage);
        const state = updateState(h?.fw, latest);
        let body;
        if (busy) {
            const pct = Number.isFinite(ota.pct) ? ota.pct : 0;
            body = html`
                <div class="ota">
                    <div class="ota__text"><span>${OTA_STAGE_TEXT[ota.stage] || ota.stage}…</span><strong>${pct}%</strong></div>
                    <div class="ota__bar"><span style="width:${pct}%"></span></div>
                    <small>Đừng rút điện ESP trong lúc này. Lỗi giữa chừng thì ESP tự chạy tiếp bản cũ.</small>
                </div>`;
        } else if (state === 'update') {
            body = html`<button type="button" class="btn-pill btn-primary" data-ncmd="update"><i class="fa-solid fa-cloud-arrow-down"></i>Cập nhật lên bản ${latest.ver}</button>`;
        } else if (state === 'old-usb') {
            body = html`<p class="field__hint">Bản ${h.fw} chưa cập nhật qua mạng được. Nạp qua USB <strong>1 lần</strong> bản ${latest.ver} (docs/nap-code.md), từ lần sau bấm cập nhật ngay tại đây.</p>`;
        } else if (state === 'latest') {
            body = html`<span class="fw-ok"><i class="fa-solid fa-circle-check"></i>Đang dùng bản mới nhất</span>`;
        } else {
            body = html`<span class="field__hint">${!h?.fw ? 'Chờ ESP báo phiên bản…' : manifest === null ? 'Đang kiểm tra bản mới…' : 'Chưa có danh sách bản mới'}</span>`;
        }
        return html`
            <div class="field"><span>Phần mềm${h?.fw ? ` · bản ${h.fw}` : ''}</span>
                <div class="fw-row">${body}</div>
                ${ota?.stage === 'error' ? html`<p class="ota-msg ota-msg--bad"><i class="fa-solid fa-triangle-exclamation"></i>${ota.msg || 'Cập nhật lỗi'}</p>` : ''}
                ${ota?.stage === 'done' ? html`<p class="ota-msg ota-msg--good"><i class="fa-solid fa-circle-check"></i>${ota.msg || 'Cập nhật xong'}</p>` : ''}
            </div>`;
    }

    /** Tình trạng ESP (bản thật): online, phiên bản, nhiệt độ, sóng + nút tìm / khởi động lại. */
    function healthHtml(node) {
        if (ctx.store.transportName === 'demo') return '';
        const s = ctx.store.node(node.id);
        const h = s?.health;
        const state = s?.online === true ? 'online' : s?.online === false ? 'offline' : 'connecting';
        const label = { online: 'Đang chạy', offline: 'Mất kết nối', connecting: 'Chưa có tin' }[state];
        const parts = h ? [
            Number.isFinite(h.up) && `chạy ${uptimeText(h.up)}`,
            Number.isFinite(h.temp) && `${h.temp.toFixed(1)}°C`,
            Number.isFinite(h.link) && `sóng ${h.link}%`,
            Number.isFinite(h.rssi) && `WiFi ${h.rssi} dBm`,
            h.reset && `lần khởi động trước: ${RESET_TEXT[h.reset] || h.reset}`
        ].filter(Boolean) : [];
        return html`
            <div class="field"><span>Tình trạng</span>
                <p class="node-health"><span class="conn conn--${state}">${label}</span>${parts.length ? ` · ${parts.join(' · ')}` : ''}</p>
                <div class="move-row">
                    <button type="button" class="btn-pill" data-ncmd="identify"><i class="fa-solid fa-lightbulb"></i>Nháy đèn tìm ESP</button>
                    <button type="button" class="btn-pill" data-ncmd="reboot"><i class="fa-solid fa-rotate-right"></i>Khởi động lại</button>
                </div>
            </div>
            ${firmwareHtml(node, s, h)}`;
    }

    // ---------- Form ESP ----------
    function nodeSheet(node) {
        let offNode = null;
        openSheet({
            title: node ? 'Sửa bộ điều khiển' : 'Thêm bộ điều khiển',
            onClose: () => offNode?.(),
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
                    ${node ? html`<div id="nHealth"></div>` : ''}
                    ${node ? wiringHtml(node) : ''}
                `);
                // Tình trạng + tiến độ cập nhật tự vẽ lại khi ESP báo tin mới
                if (node) {
                    const paintHealth = () => {
                        const box = $('#nHealth', el);
                        if (box) render(box, healthHtml(node));
                    };
                    paintHealth();
                    onManifest.add(paintHealth);
                    const off = ctx.store.subscribe(ev => { if (ev.type === 'node' && ev.nodeId === node.id) paintHealth(); });
                    offNode = () => { off(); onManifest.delete(paintHealth); };
                }
                el.addEventListener('click', e => {
                    const ncmd = e.target.closest('[data-ncmd]');
                    if (ncmd?.dataset.ncmd === 'update') {
                        const latest = latestFor(manifest, node.id);
                        if (!latest) return;
                        if (!confirm(`Cập nhật ${node.name} lên bản ${latest.ver}?\n\nMất khoảng 1 phút. Thiết bị trên ESP này tạm không điều khiển được trong lúc khởi động lại. Lỗi giữa chừng thì ESP tự chạy tiếp bản cũ.`)) return;
                        const sent = ctx.store.nodeUpdate(node.id, latest);
                        if (!sent) toast('Chưa kết nối tới nhà', 'error');
                        return;
                    }
                    if (ncmd) {
                        const cmd = ncmd.dataset.ncmd;
                        if (cmd === 'reboot' && !confirm(`Khởi động lại ${node.name}?`)) return;
                        const sent = ctx.store.nodeCommand(node.id, cmd);
                        toast(sent ? (cmd === 'identify' ? `${node.name} sẽ nháy đèn nhanh 10 giây` : `Đã gửi lệnh khởi động lại ${node.name}`) : 'Chưa kết nối tới nhà', sent ? 'success' : 'error');
                        return;
                    }
                    if (!e.target.closest('#nMove')) return;
                    const to = Number($('#nMoveTo', el).value);
                    const target = home.nodes.get(to);
                    const n = devicesOf(node.id).length;
                    if (!target || !confirm(`Chuyển ${n} thiết bị từ "${node.name}" sang "${target.name}"? Số kênh giữ nguyên, nhớ cắm dây sang ESP mới đúng kênh.`)) return;
                    const before = channelConflicts(home).size;
                    if (save(edit.moveNodeDevices(home.raw, node.id, to), `Đã chuyển ${n} thiết bị sang ${target.name}`)) {
                        if (channelConflicts(ctx.home).size > before) toast('Có thiết bị bị trùng kênh trên ESP mới - xem cảnh báo đỏ trong danh sách', 'error', 5000);
                        $('.sheet__close')?.click();
                    }
                });
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
    /** Đổi tầng (điện thoại: nội dung trượt vào theo hướng, viên chọn giãn ra). */
    function setFloor(index) {
        const dir = Math.sign(index - floorIndex);
        if (!dir || index < 0 || index >= home.floors.length) return;
        floorIndex = index;
        sessionStorage.setItem(FLOOR_KEY, String(floorIndex));
        draw();
        stretch($('#mFloors .segmented__thumb', root), dir);
        swapIn($('.manage-rooms', root), dir);
    }

    // Điện thoại: vuốt ở bất kỳ đâu = đổi đúng 1 tầng. Vuốt từ sát mép trái = quay lại Cài đặt.
    let dragEl = null;
    onSwipe(root, {
        start(dx, x0) {
            if (!isPhone() || home.floors.length < 2 || x0 < EDGE_BACK) return false;
            dragEl = $('.manage-rooms', root);
            return !!dragEl;
        },
        move(dx) {
            if (!dragEl) return;
            const w = root.clientWidth || window.innerWidth;
            const target = floorIndex + (dx < 0 ? 1 : -1);
            const d = target >= 0 && target < home.floors.length ? dragFollow(dx, w) : rubber(dx, w) * 0.22;
            dragEl.style.transform = `translateX(${d}px)`;
            dragEl.style.opacity = String(1 - Math.min(Math.abs(d) / w, 1) * 0.4);
        },
        end(dx, velocity) {
            const el = dragEl;
            dragEl = null;
            if (!el) return;
            const step = decideStep(dx, velocity);
            const target = floorIndex + step;
            if (step && target >= 0 && target < home.floors.length) return setFloor(target);
            const from = el.style.transform;
            el.style.transform = '';
            el.style.opacity = '';
            if (from && !reducedMotion()) el.animate([{ transform: from }, { transform: 'none' }], { duration: 500, easing: EASE_SPRING_SOFT });
        },
        cancel() {
            if (!dragEl) return;
            dragEl.style.transform = '';
            dragEl.style.opacity = '';
            dragEl = null;
        }
    });

    root.addEventListener('click', e => {
        const floorBtn = e.target.closest('#mFloors button');
        if (floorBtn) {
            setFloor(Number(floorBtn.dataset.index));
            return;
        }
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const roomId = btn.closest('.manage-room')?.dataset.room;
        switch (btn.dataset.act) {
            case 'sort':
                sortMode = !sortMode;
                sessionStorage.setItem(SORT_KEY, sortMode ? '1' : '0');
                if (!sortMode) toast('Đã lưu thứ tự mới', 'success');
                return draw();
            case 'room-up':
            case 'room-down':
                return save(edit.moveRoom(home.raw, roomId, btn.dataset.act === 'room-up' ? -1 : 1));
            case 'dev-up':
            case 'dev-down':
                return save(edit.moveDevice(home.raw, btn.dataset.key, btn.dataset.act === 'dev-up' ? -1 : 1));
            case 'add-device': return deviceSheet(null, roomId);
            case 'edit-device': return deviceSheet(home.devices.get(btn.dataset.key));
            case 'add-room': return roomSheet(null);
            case 'edit-room': return roomSheet(home.rooms.get(roomId));
            case 'add-node': return nodeSheet(null);
            case 'edit-node': return nodeSheet(home.nodes.get(Number(btn.dataset.node)));
        }
    });

    draw();
    return () => {};
}
