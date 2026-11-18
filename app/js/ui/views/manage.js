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

const FLOOR_KEY = 'hg.ui.manageFloor';

const nodeText = (home, id) => (id === null || id === undefined ? 'Chưa gán ESP' : home.nodes.get(id)?.name || `ESP ${id}`);

export function mount(root, ctx) {
    const { home, toast } = ctx;
    let floorIndex = Math.min(Number(sessionStorage.getItem(FLOOR_KEY)) || 0, home.floors.length - 1);

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
                                            <small>${typeLabel(d)}${d.actuator === 'servo' ? ' · Servo' : d.actuator === 'relay' ? ' · Relay' : ''} · ${d.node === null ? 'Chưa gán ESP' : nodeText(home, d.node) + (d.type === 'stairs' ? ` · ${d.steps} bậc` : d.ch ? ` · kênh ${d.ch}` : ' · chưa chọn kênh')}</small>
                                            ${conflicts.has(d.key) ? html`<small class="warn"><i class="fa-solid fa-triangle-exclamation"></i>Trùng kênh với ${conflicts.get(d.key).name} (${conflicts.get(d.key).room.name})</small>` : ''}
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
                ${[...home.nodes.values()].map(n => {
                    const count = devicesOf(n.id).length;
                    return html`
                    <button class="row row--link row--btn" data-act="edit-node" data-node="${n.id}">
                        <span class="row__label"><i class="fa-solid ${n.id === 0 ? 'fa-server' : 'fa-microchip'}"></i>${n.name}</span>
                        <span class="row__value">số ${n.id} · ${count ? `${count} thiết bị` : 'chưa gắn gì'}</span>
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
                    <div class="field" id="dServoField"><span>Góc servo (độ)</span>
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
                        <label class="field field--small" id="dChField"><span id="dChLabel">Relay số</span>
                            <input type="number" id="dCh" min="1" max="16" placeholder="–" value="${device?.ch ?? ''}" />
                        </label>
                        <label class="field field--small" id="dStepsField"><span>Số bậc</span>
                            <input type="number" id="dSteps" min="2" max="32" value="${device?.steps ?? 15}" />
                        </label>
                    </div>
                    <div class="row" id="dLowField">
                        <span class="row__label row__label--wrap"><i class="fa-solid fa-arrow-down-short-wide"></i>
                            <span>Relay kích mức thấp<small>Bật nếu relay chạy NGƯỢC (bấm bật mà relay tắt). Không phải sửa code.</small></span></span>
                        <button type="button" class="switch" role="switch" id="dLow" aria-checked="${device?.relayLow === true}"></button>
                    </div>
                    <label class="field" id="dDriverField"><span>Mạch điều khiển các bậc</span>
                        <select id="dDriver">
                            ${Object.entries(DRIVERS).map(([id, d]) => html`<option value="${id}" ${id === (device?.driver || 'mcp23017') ? 'selected' : ''}>${d.label} — ${d.note}</option>`)}
                        </select>
                    </label>
                    <p class="field__hint" id="dHint"></p>
                `);
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
                        ? 'Mỗi bậc 1 dải LED + 1 module D4184, nối vào mạch mở rộng MCP23017 (tối đa 16 bậc / 1 mạch).'
                        : servo
                            ? 'Servo SG90 gạt công tắc tường sang BẬT/TẮT rồi về góc nghỉ (tay người vẫn bấm được). Không đụng điện 220V. Kênh servo = chân PWM / kênh mạch PCA9685 trên ESP.'
                            : '"Theo phòng": dùng ESP đã gán cho phòng. Relay số = chân relay trên ESP nối tới thiết bị này.';
                };
                paintType();
                el.addEventListener('click', e => {
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
                    if (ch !== null && (!Number.isInteger(ch) || ch < 1 || ch > 16)) return toast('Relay số phải từ 1 đến 16', 'error');
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

    /** Tình trạng ESP (bản thật): online, phiên bản, nhiệt độ, sóng + nút tìm / khởi động lại. */
    function healthHtml(node) {
        if (ctx.store.transportName === 'demo') return '';
        const s = ctx.store.node(node.id);
        const h = s?.health;
        const state = s?.online === true ? 'online' : s?.online === false ? 'offline' : 'connecting';
        const label = { online: 'Đang chạy', offline: 'Mất kết nối', connecting: 'Chưa có tin' }[state];
        const parts = h ? [
            h.fw && `bản ${h.fw}`,
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
            </div>`;
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
                    ${node ? healthHtml(node) : ''}
                    ${node ? wiringHtml(node) : ''}
                `);
                el.addEventListener('click', e => {
                    const ncmd = e.target.closest('[data-ncmd]');
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
        }
    });

    draw();
    return () => {};
}
