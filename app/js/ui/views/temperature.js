// =============================================================
// MÀN HÌNH NHIỆT ĐỘ - theo dõi độ nóng của từng bộ điều khiển ESP
// -------------------------------------------------------------
// ESP32 có sẵn cảm biến đo nhiệt độ chip. Chip quá nóng có thể treo
// hoặc hỏng -> cần theo dõi. Ngưỡng giống code ESP cũ:
//   >= 55°C: hơi nóng     >= 60°C: quá nhiệt (ESP tự ngủ để nguội)
// =============================================================

import { html, render, $, $$ } from '../dom.js';
import { createLineChart } from '../chart.js';
import { rollNumber } from '../motion.js';

const WARN = 55;
const CRIT = 60;
const OFFLINE_MS = 30000; // quá 30 giây không có tin -> coi như mất kết nối
const RANGE_KEY = 'hg.ui.range';

const RANGES = [
    { label: '1 giờ', ms: 3600e3 },
    { label: '6 giờ', ms: 6 * 3600e3 },
    { label: '24 giờ', ms: 24 * 3600e3 }
];

const STATUS = {
    good: { label: 'Bình thường', icon: 'fa-circle-check' },
    warn: { label: 'Hơi nóng', icon: 'fa-triangle-exclamation' },
    crit: { label: 'Quá nhiệt', icon: 'fa-fire' },
    off: { label: 'Mất kết nối', icon: 'fa-plug-circle-xmark' }
};

const pad2 = n => String(n).padStart(2, '0');
const hhmm = t => `${pad2(new Date(t).getHours())}:${pad2(new Date(t).getMinutes())}`;

function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return `${s} giây trước`;
    if (s < 3600) return `${Math.round(s / 60)} phút trước`;
    return `${Math.round(s / 3600)} giờ trước`;
}

export function mount(root, { home, store }) {
    const nodes = [...home.nodes.values()];

    if (!nodes.length) {
        render(root, html`
            <header class="page-head"><h1>Nhiệt độ ESP</h1></header>
            <div class="card empty"><i class="fa-solid fa-microchip"></i>Chưa khai báo bộ điều khiển ESP nào.<br>
                <a href="#/manage">Thêm ESP trong Cài đặt → Phòng & thiết bị</a></div>`);
        return () => {};
    }

    // Màu đi theo ESP (theo thứ tự khai báo), KHÔNG đổi khi ẩn/hiện chuỗi khác
    const colorOf = new Map(nodes.map((n, i) => [n.id, `--series-${(i % 8) + 1}`]));
    const roomsOf = id => [...home.rooms.values()].filter(r => r.node === id).map(r => r.name);
    const hidden = new Set();
    let rangeIndex = Math.min(Number(sessionStorage.getItem(RANGE_KEY)) || 0, RANGES.length - 1);
    let showTable = false;

    render(root, html`
        <header class="page-head">
            <h1>Nhiệt độ ESP</h1>
            <p>Độ nóng của ${nodes.length} bộ điều khiển · tự cập nhật</p>
        </header>

        <section class="stats" id="stats">
            <div class="stat card"><span class="stat__label">Nóng nhất</span><span class="stat__value"><span id="statMax">–</span>°C</span><span class="stat__sub" id="statMaxName"></span></div>
            <div class="stat card"><span class="stat__label">Trung bình</span><span class="stat__value"><span id="statAvg">–</span>°C</span><span class="stat__sub">các ESP đang chạy</span></div>
            <div class="stat card"><span class="stat__label">Đang hoạt động</span><span class="stat__value"><span id="statOnline">–</span>/${nodes.length}</span><span class="stat__sub" id="statAlert"></span></div>
        </section>

        <div class="temp-bar">
            <div class="segmented" id="ranges" role="tablist" style="--n:${RANGES.length}; --i:${rangeIndex}">
                <span class="segmented__thumb"></span>
                ${RANGES.map((r, i) => html`<button role="tab" data-index="${i}">${r.label}</button>`)}
            </div>
        </div>

        <section class="card chart-card">
            <div class="legend" id="legend">
                ${nodes.map(n => html`
                    <button class="legend__item" data-node="${n.id}" aria-pressed="true">
                        <span class="legend__key" style="background: var(${colorOf.get(n.id)})"></span>${n.name}
                    </button>`)}
            </div>
            <div id="chart"></div>
            <div class="chart-card__foot">
                <span class="chart-card__hint"><i class="fa-solid fa-hand-pointer"></i>Chạm hoặc rê lên biểu đồ để xem từng thời điểm</span>
                <button class="btn-pill" id="tableToggle"><i class="fa-solid fa-table"></i><span>Bảng số liệu</span></button>
            </div>
            <div class="table-wrap" id="table" hidden></div>
        </section>

        <h2 class="section-title">Từng bộ điều khiển</h2>
        <div class="node-grid" id="nodes">
            ${nodes.map(n => html`
                <article class="node card" data-node="${n.id}">
                    <header class="node__head">
                        <span class="legend__key" style="background: var(${colorOf.get(n.id)})"></span>
                        <div class="node__title">
                            <h3>${n.name}</h3>
                            <span>${n.board}${roomsOf(n.id).length ? ' · ' + roomsOf(n.id).join(', ') : ''}</span>
                        </div>
                        <span class="badge" data-state="off"><i class="fa-solid"></i><span></span></span>
                    </header>
                    <div class="node__temp"><span class="node__value">–</span><small>°C</small></div>
                    <div class="node__range"><span class="node__minmax"></span><span class="node__ago"></span></div>
                </article>`)}
        </div>
    `);

    const chart = createLineChart($('#chart', root), {
        threshold: CRIT,
        thresholdLabel: `Ngưỡng quá nhiệt ${CRIT}°C`,
        label: 'Biểu đồ nhiệt độ các ESP theo thời gian'
    });

    function statusOf(node) {
        const last = store.node(node.id)?.last;
        if (!last || Date.now() - last.t > OFFLINE_MS) return 'off';
        if (last.v >= CRIT) return 'crit';
        if (last.v >= WARN) return 'warn';
        return 'good';
    }

    const windowNow = () => {
        const to = Date.now();
        return [to - RANGES[rangeIndex].ms, to];
    };

    function pointsIn(node, [from, to]) {
        return (store.node(node.id)?.history || []).filter(p => p.t >= from && p.t <= to);
    }

    function drawChart() {
        chart.update(
            nodes.map(n => ({
                id: n.id,
                name: n.name,
                color: colorOf.get(n.id),
                points: store.node(n.id)?.history || [],
                hidden: hidden.has(n.id)
            })),
            windowNow()
        );
    }

    function drawStats() {
        const live = nodes.filter(n => statusOf(n) !== 'off');
        const values = live.map(n => ({ n, v: store.node(n.id).last.v }));
        if (values.length) {
            const max = values.reduce((a, b) => (b.v > a.v ? b : a));
            const avg = values.reduce((s, x) => s + x.v, 0) / values.length;
            $('#statMax', root).textContent = max.v.toFixed(1);
            $('#statMaxName', root).textContent = max.n.name;
            $('#statAvg', root).textContent = avg.toFixed(1);
        }
        rollNumber($('#statOnline', root), live.length);
        const hot = nodes.filter(n => ['warn', 'crit'].includes(statusOf(n))).length;
        $('#statAlert', root).textContent = hot ? `${hot} ESP đang nóng` : 'Không có cảnh báo';
    }

    function drawNodes() {
        const range = windowNow();
        nodes.forEach(n => {
            const card = root.querySelector(`.node[data-node="${n.id}"]`);
            const state = statusOf(n);
            const last = store.node(n.id)?.last;
            const badge = card.querySelector('.badge');
            badge.dataset.state = state;
            badge.querySelector('i').className = `fa-solid ${STATUS[state].icon}`;
            badge.querySelector('span').textContent = STATUS[state].label;
            card.querySelector('.node__value').textContent = last ? last.v.toFixed(1) : '–';
            const pts = pointsIn(n, range);
            card.querySelector('.node__minmax').textContent = pts.length
                ? `Thấp ${Math.min(...pts.map(p => p.v)).toFixed(1)}° · Cao ${Math.max(...pts.map(p => p.v)).toFixed(1)}°`
                : 'Chưa có dữ liệu';
            card.querySelector('.node__ago').textContent = last ? ago(last.t) : '';
            card.classList.toggle('is-hidden-series', hidden.has(n.id));
        });
    }

    /** Bảng số liệu: cho ai không xem được biểu đồ / cần số chính xác. */
    function drawTable() {
        const box = $('#table', root);
        box.hidden = !showTable;
        $('#tableToggle span', root).textContent = showTable ? 'Ẩn bảng' : 'Bảng số liệu';
        if (!showTable) return;
        const [from, to] = windowNow();
        const rows = 12;
        const times = Array.from({ length: rows }, (_, i) => to - (i * (to - from)) / (rows - 1));
        const shown = nodes.filter(n => !hidden.has(n.id));
        const valueAt = (n, t) => {
            const pts = store.node(n.id)?.history || [];
            let best = null;
            for (const p of pts) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
            return best && Math.abs(best.t - t) < (to - from) / rows ? best.v.toFixed(1) : '–';
        };
        render(box, html`
            <table class="data-table">
                <thead><tr><th>Giờ</th>${shown.map(n => html`<th>${n.name}</th>`)}</tr></thead>
                <tbody>${times.map(t => html`<tr><td>${hhmm(t)}</td>${shown.map(n => html`<td>${valueAt(n, t)}</td>`)}</tr>`)}</tbody>
            </table>`);
    }

    function drawRanges() {
        const seg = $('#ranges', root);
        seg.style.setProperty('--i', rangeIndex);
        $$('button', seg).forEach((b, i) => b.setAttribute('aria-selected', String(i === rangeIndex)));
    }

    function drawAll() {
        drawChart();
        drawStats();
        drawNodes();
        drawTable();
    }

    // ---------- Sự kiện ----------
    $('#ranges', root).addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        rangeIndex = Number(btn.dataset.index);
        sessionStorage.setItem(RANGE_KEY, String(rangeIndex));
        drawRanges();
        drawAll();
    });

    $('#legend', root).addEventListener('click', e => {
        const item = e.target.closest('.legend__item');
        if (!item) return;
        const id = Number(item.dataset.node);
        if (hidden.has(id)) hidden.delete(id);
        else if (hidden.size < nodes.length - 1) hidden.add(id); // luôn chừa ít nhất 1 đường
        item.setAttribute('aria-pressed', String(!hidden.has(id)));
        drawAll();
    });

    $('#tableToggle', root).addEventListener('click', () => {
        showTable = !showTable;
        drawTable();
    });

    // Dữ liệu mới về: gom lại, tối đa 1 lần vẽ mỗi giây cho nhẹ máy
    let timer = null;
    const offStore = store.subscribe(event => {
        if (event.type !== 'telemetry' || timer) return;
        timer = setTimeout(() => {
            timer = null;
            drawAll();
        }, 1000);
    });

    drawRanges();
    drawAll();

    return () => {
        offStore();
        clearTimeout(timer);
        chart.destroy();
    };
}
