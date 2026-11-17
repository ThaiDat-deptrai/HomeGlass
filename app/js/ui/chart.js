// =============================================================
// CHART - biểu đồ đường nhiều chuỗi (SVG), không cần thư viện
// -------------------------------------------------------------
// - 1 trục dọc duy nhất (°C), lưới mờ, nét 2px.
// - Rê chuột / chạm-kéo: đường dọc bám theo thời điểm gần nhất,
//   bảng nhỏ hiện giá trị của TẤT CẢ các chuỗi tại thời điểm đó.
// - Phím ← → cũng di chuyển được (cho người dùng bàn phím).
// - Tên chuỗi luôn chèn bằng textContent (không chèn HTML).
// =============================================================

const NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 240;
const M = { top: 16, right: 14, bottom: 28, left: 40 };

function svg(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

const pad2 = n => String(n).padStart(2, '0');
const hhmm = t => {
    const d = new Date(t);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Bước chia "đẹp" cho trục dọc: 1, 2, 2.5, 5, 10... */
function niceStep(span, ticks = 4) {
    const raw = span / ticks;
    const p = 10 ** Math.floor(Math.log10(raw));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Vị trí điểm đầu tiên có t >= x (tìm nhị phân, mảng đã sắp theo thời gian). */
function lowerBound(points, t) {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].t < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function nearest(points, t) {
    if (!points.length) return null;
    const i = lowerBound(points, t);
    const a = points[i - 1];
    const b = points[i];
    if (!a) return b;
    if (!b) return a;
    return t - a.t <= b.t - t ? a : b;
}

/** Gộp bớt điểm khi quá dày (lấy trung bình theo cụm) để vẽ nhanh. */
function thin(points, max) {
    if (points.length <= max) return points;
    const out = [];
    const size = points.length / max;
    for (let i = 0; i < max; i++) {
        const from = Math.floor(i * size);
        const to = Math.max(from + 1, Math.floor((i + 1) * size));
        let t = 0;
        let v = 0;
        for (let j = from; j < to; j++) {
            t += points[j].t;
            v += points[j].v;
        }
        out.push({ t: t / (to - from), v: v / (to - from) });
    }
    return out;
}

/**
 * createLineChart(host, { unit, threshold, thresholdLabel, label })
 *   .update(series, [from, to])   series: [{ id, name, color: '--series-1', points: [{t,v}], hidden }]
 *   .destroy()
 */
export function createLineChart(host, { unit = '°C', threshold = null, thresholdLabel = '', label = '' } = {}) {
    host.classList.add('chart');
    host.tabIndex = 0;
    host.setAttribute('aria-label', `${label}. Dùng phím mũi tên trái phải để xem giá trị theo thời gian.`);

    const root = svg('svg', { class: 'chart__svg', role: 'img', 'aria-label': label });
    const tip = document.createElement('div');
    tip.className = 'chart__tip';
    tip.hidden = true;
    host.replaceChildren(root, tip);

    let series = [];
    let range = [Date.now() - 3600e3, Date.now()];
    let width = 0;
    let hoverT = null;
    let hideTimer = null;
    let x = () => 0;
    let y = () => 0;
    let hoverLayer = null;

    const fmt = v => `${v.toFixed(1)}${unit}`;
    const visible = () => series.filter(s => !s.hidden);
    const inRange = s => s.points.slice(lowerBound(s.points, range[0]), lowerBound(s.points, range[1] + 1));

    function draw() {
        width = host.clientWidth;
        if (!width) return;
        root.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
        root.setAttribute('width', width);
        root.setAttribute('height', HEIGHT);
        root.replaceChildren();

        const shown = visible().map(s => ({ s, pts: inRange(s) }));
        let lo = Infinity;
        let hi = -Infinity;
        shown.forEach(({ pts }) => pts.forEach(p => {
            lo = Math.min(lo, p.v);
            hi = Math.max(hi, p.v);
        }));
        if (!Number.isFinite(lo)) {
            lo = 30;
            hi = 50;
        }
        // Hiện luôn ngưỡng quá nhiệt nếu nó không quá xa dữ liệu
        if (threshold !== null && threshold - hi < 15) hi = Math.max(hi, threshold);

        const step = niceStep(Math.max(hi - lo, 4));
        const y0 = Math.floor((lo - step * 0.25) / step) * step;
        const y1 = Math.ceil((hi + step * 0.25) / step) * step;
        const iw = width - M.left - M.right;
        const ih = HEIGHT - M.top - M.bottom;

        x = t => M.left + ((t - range[0]) / (range[1] - range[0])) * iw;
        y = v => M.top + (1 - (v - y0) / (y1 - y0)) * ih;

        // ----- Lưới + nhãn trục dọc -----
        const grid = svg('g', { class: 'chart__grid' });
        for (let v = y0; v <= y1 + 1e-9; v += step) {
            grid.append(svg('line', { x1: M.left, x2: width - M.right, y1: y(v), y2: y(v) }));
            const lab = svg('text', { x: M.left - 8, y: y(v) + 4, class: 'chart__ylab' });
            lab.textContent = `${Math.round(v * 10) / 10}°`;
            grid.append(lab);
        }

        // ----- Nhãn trục ngang (giờ:phút), canh theo giờ địa phương -----
        const span = range[1] - range[0];
        const tick = span <= 3600e3 ? 15 * 60e3 : span <= 6 * 3600e3 ? 3600e3 : 4 * 3600e3;
        const offset = new Date().getTimezoneOffset() * 60e3;
        for (let t = Math.ceil((range[0] - offset) / tick) * tick + offset; t <= range[1]; t += tick) {
            const px = x(t);
            if (px < M.left + 16 || px > width - M.right - 16) continue;
            const lab = svg('text', { x: px, y: HEIGHT - 8, class: 'chart__xlab' });
            lab.textContent = hhmm(t);
            grid.append(lab);
        }
        root.append(grid);

        // ----- Đường ngưỡng -----
        if (threshold !== null && threshold >= y0 && threshold <= y1) {
            const g = svg('g', { class: 'chart__threshold' });
            g.append(svg('line', { x1: M.left, x2: width - M.right, y1: y(threshold), y2: y(threshold) }));
            const t = svg('text', { x: width - M.right, y: y(threshold) - 6 });
            t.textContent = thresholdLabel;
            g.append(t);
            root.append(g);
        }

        // ----- Các đường dữ liệu -----
        const lines = svg('g', { class: 'chart__lines' });
        shown.forEach(({ s, pts }) => {
            const p = thin(pts, Math.max(60, Math.floor(iw / 2)));
            if (p.length < 2) return;
            const d = p.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)} ${y(q.v).toFixed(1)}`).join('');
            lines.append(svg('path', { d, class: 'chart__line', style: `stroke: var(${s.color})` }));
        });
        root.append(lines);

        hoverLayer = svg('g', { class: 'chart__hover' });
        root.append(hoverLayer);
        if (hoverT !== null) drawHover();
    }

    function drawHover() {
        hoverLayer.replaceChildren();
        const rows = visible()
            .map(s => ({ s, p: nearest(inRange(s), hoverT) }))
            .filter(r => r.p);
        if (!rows.length) {
            tip.hidden = true;
            return;
        }

        const t = rows[0].p.t; // bám vào thời điểm có dữ liệu gần nhất
        const px = x(t);
        hoverLayer.append(svg('line', { x1: px, x2: px, y1: M.top, y2: HEIGHT - M.bottom, class: 'chart__cross' }));
        rows.forEach(({ s, p }) => {
            hoverLayer.append(svg('circle', { cx: x(p.t), cy: y(p.v), r: 4.5, class: 'chart__dot', style: `fill: var(${s.color})` }));
        });

        tip.replaceChildren();
        const head = document.createElement('div');
        head.className = 'chart__tiptime';
        head.textContent = hhmm(t);
        tip.append(head);
        rows.sort((a, b) => b.p.v - a.p.v).forEach(({ s, p }) => {
            const row = document.createElement('div');
            row.className = 'chart__tiprow';
            const key = document.createElement('span');
            key.className = 'chart__key';
            key.style.background = `var(${s.color})`;
            const value = document.createElement('strong');
            value.textContent = fmt(p.v);
            const name = document.createElement('span');
            name.textContent = s.name;
            row.append(key, value, name);
            tip.append(row);
        });
        tip.hidden = false;
        const tw = tip.offsetWidth;
        const left = px + 14 + tw > width ? px - 14 - tw : px + 14;
        tip.style.transform = `translate(${Math.max(0, left)}px, ${M.top}px)`;
    }

    function hide() {
        hoverT = null;
        hoverLayer?.replaceChildren();
        tip.hidden = true;
    }

    function pointAt(e) {
        const r = root.getBoundingClientRect();
        const px = Math.max(M.left, Math.min(width - M.right, e.clientX - r.left));
        hoverT = range[0] + ((px - M.left) / (width - M.left - M.right)) * (range[1] - range[0]);
        clearTimeout(hideTimer);
        drawHover();
    }

    host.addEventListener('pointermove', pointAt);
    host.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse') {
            try { host.setPointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
        }
        pointAt(e);
    });
    host.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    host.addEventListener('pointerup', e => {
        if (e.pointerType !== 'mouse') hideTimer = setTimeout(hide, 2000);
    });
    host.addEventListener('keydown', e => {
        const span = range[1] - range[0];
        if (e.key === 'Escape') return hide();
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        hoverT = Math.max(range[0], Math.min(range[1], (hoverT ?? range[1]) + (e.key === 'ArrowLeft' ? -1 : 1) * span / 40));
        drawHover();
    });

    const ro = new ResizeObserver(() => {
        if (host.clientWidth !== width) draw();
    });
    ro.observe(host);

    return {
        update(nextSeries, nextRange) {
            series = nextSeries;
            range = nextRange;
            draw();
        },
        destroy() {
            ro.disconnect();
            clearTimeout(hideTimer);
        }
    };
}
