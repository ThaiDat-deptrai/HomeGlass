// =============================================================
// BẢNG ĐIỀU KHIỂN CẦU THANG (nằm giữa Tầng 1 và Tầng 2 ở màn hình Nhà)
// -------------------------------------------------------------
// - Hình cầu thang: từng bậc sáng theo hiệu ứng, y như ESP sẽ làm.
// - Bật/tắt, độ sáng, hiệu ứng, tốc độ.
// - Thông minh: tự bật khi có người, hẹn giờ tắt, ban đêm, đèn nền buổi tối.
// Mọi cài đặt gửi xuống ESP cầu thang qua store.configure() -> chạy cả khi tắt app.
// =============================================================

import { html, render, $, $$ } from '../dom.js';
import { tap } from '../feedback.js';
import { reducedMotion } from '../motion.js';
import {
    STAIRS_DEFAULTS, EFFECTS, DRIVERS, targetLevels, effectOrder, isNight, isAmbient,
    isDimmable, sunsetMinutes, formatMinutes
} from '../../core/stairs.js';

const HOLD_OPTIONS = [{ v: 15, t: '15 giây' }, { v: 30, t: '30 giây' }, { v: 60, t: '1 phút' }, { v: 120, t: '2 phút' }];
const TIMER_OPTIONS = [{ v: 0, t: 'Không' }, { v: 5, t: '5 phút' }, { v: 15, t: '15 phút' }, { v: 30, t: '30 phút' }];

function choice(id, options, value) {
    const i = Math.max(0, options.findIndex(o => o.v === value));
    return html`
        <div class="segmented segmented--block seg-sm" id="${id}" role="tablist" style="--n:${options.length}; --i:${i}">
            <span class="segmented__thumb"></span>
            ${options.map(o => html`<button role="tab" data-v="${o.v}" aria-selected="${o.v === value}">${o.t}</button>`)}
        </div>`;
}

export function mountStairs(host, { home, store, settings, toast }, device) {
    const key = device.key;
    const steps = device.steps || 13;
    const location = home.raw.location;
    const driver = DRIVERS[device.driver] ? device.driver : 'mcp23017';
    const dimmable = isDimmable(driver); // PCA9685: chỉnh sáng được; MCP23017: chỉ bật/tắt
    const NEEDS_PCA = html`<span class="needs"><i class="fa-solid fa-lock"></i>Cần mạch PCA9685</span>`;
    const timers = [];
    let lastDir = 'up';
    let previewBrightness = null; // đang kéo thanh độ sáng
    let shown = null;             // mức sáng đang hiện của từng bậc
    let lastOn = null;            // trạng thái bật/tắt lần vẽ trước (để biết khi nào chạy hiệu ứng)

    // Đang chờ ESP xác nhận thì hiện trước trạng thái sắp chuyển sang (cho phản hồi tức thì)
    const effectiveOn = () => {
        const s = state();
        return s.pending ? s.target : s.on === true;
    };

    const attrs = () => ({ ...STAIRS_DEFAULTS, ...store.get(key)?.attrs });
    const state = () => store.get(key) || { on: null, pending: false };

    // ---------- Khung ----------
    function draw() {
        const a = attrs();
        const sunset = formatMinutes(sunsetMinutes(new Date(), location));
        render(host, html`
            <section class="stairs card">
                <header class="stairs__head">
                    <div>
                        <h2>${device.name}</h2>
                        <p class="stairs__status" id="stStatus"></p>
                    </div>
                    <button class="stairs__power" id="stPower" aria-label="Bật/tắt đèn cầu thang"><i class="fa-solid fa-power-off"></i></button>
                </header>

                <div class="stairs__viz" id="stViz" style="--n:${steps}">
                    ${Array.from({ length: steps }, (_, i) => html`<span class="stair" style="--i:${i}"></span>`)}
                    <span class="stairs__walker" id="stWalker"><i class="fa-solid fa-person-walking"></i></span>
                </div>

                ${store.canSimulate ? html`
                    <div class="stairs__demo">
                        <span>Thử cảm biến:</span>
                        <button class="btn-pill" data-sim="up"><i class="fa-solid fa-arrow-up"></i>Có người đi lên</button>
                        <button class="btn-pill" data-sim="down"><i class="fa-solid fa-arrow-down"></i>Đi xuống</button>
                    </div>` : ''}
            </section>

            <section class="card group">
                ${dimmable ? html`
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-sun"></i>Độ sáng</span>
                    <input type="range" id="stBright" min="5" max="100" step="5" value="${a.brightness}" />
                    <span class="row__num" id="stBrightVal">${a.brightness}%</span>
                </div>` : html`
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-sun"></i>Độ sáng</span>
                    ${NEEDS_PCA}
                </div>`}
                <div class="row row--stack">
                    <span class="row__label"><i class="fa-solid fa-wand-magic-sparkles"></i>Hiệu ứng khi bật / tắt</span>
                    <div class="effect-pick" id="stEffect">
                        ${EFFECTS.map(e => {
                            const locked = e.needsDimming && !dimmable;
                            return html`<button data-effect="${e.id}" aria-pressed="${e.id === a.effect}" ${locked ? 'disabled title="Cần mạch PCA9685"' : ''}>
                                <i class="fa-solid ${locked ? 'fa-lock' : e.icon}"></i>${e.label}</button>`;
                        })}
                    </div>
                </div>
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-gauge-high"></i>Tốc độ chạy</span>
                    <input type="range" id="stSpeed" min="30" max="250" step="10" value="${280 - a.speed}" aria-label="Tốc độ (trái chậm, phải nhanh)" />
                </div>
            </section>

            <h2 class="section-title">Thông minh</h2>
            <section class="card group">
                <div class="row">
                    <span class="row__label row__label--wrap"><i class="fa-solid fa-person-walking"></i>
                        <span>Tự bật khi có người<small>Cần 2 cảm biến chuyển động: chân và đầu cầu thang</small></span></span>
                    <button class="switch" role="switch" data-attr="motion" aria-checked="${a.motion}"></button>
                </div>
                ${a.motion ? html`
                <div class="row row--stack row--sub">
                    <span class="row__hint">Hết người bao lâu thì tắt</span>
                    ${choice('stHold', HOLD_OPTIONS, a.holdSec)}
                </div>` : ''}

                <div class="row row--stack">
                    <span class="row__label"><i class="fa-solid fa-hourglass-half"></i>Bật bằng tay thì tự tắt sau</span>
                    ${choice('stTimer', TIMER_OPTIONS, a.timerMin)}
                </div>

                <div class="row">
                    <span class="row__label row__label--wrap"><i class="fa-solid fa-moon"></i>
                        <span>Chế độ ban đêm<small>${dimmable ? 'Sáng dịu để không chói mắt' : 'Ban đêm'}${a.nightGuide ? ', vài bậc sáng làm đèn dẫn đường' : ''}</small></span></span>
                    <button class="switch" role="switch" data-attr="night" aria-checked="${a.night}"></button>
                </div>
                ${a.night ? html`
                <div class="row row--sub">
                    <span class="row__hint">Từ</span>
                    <input type="time" class="time-input" data-attr="nightFrom" value="${a.nightFrom}" />
                    <span class="row__hint">đến</span>
                    <input type="time" class="time-input" data-attr="nightTo" value="${a.nightTo}" />
                </div>
                ${dimmable ? html`
                <div class="row row--sub">
                    <span class="row__hint">Độ sáng ban đêm</span>
                    <input type="range" data-attr="nightLevel" min="5" max="50" step="5" value="${a.nightLevel}" />
                    <span class="row__num">${a.nightLevel}%</span>
                </div>` : ''}
                <div class="row row--sub">
                    <span class="row__hint">Đèn dẫn đường (bậc đầu, cuối và cách 3 bậc luôn sáng)</span>
                    <button class="switch" role="switch" data-attr="nightGuide" aria-checked="${a.nightGuide}"></button>
                </div>` : ''}

                <div class="row">
                    <span class="row__label row__label--wrap"><i class="fa-solid fa-cloud-moon"></i>
                        <span>Đèn nền buổi tối<small>Từ lúc trời tối (hôm nay ≈ ${sunset}) đến ${a.ambientUntil}, sáng mờ cả cầu thang</small></span></span>
                    ${dimmable
                        ? html`<button class="switch" role="switch" data-attr="ambient" aria-checked="${a.ambient}"></button>`
                        : NEEDS_PCA}
                </div>
                ${a.ambient && dimmable ? html`
                <div class="row row--sub">
                    <span class="row__hint">Tắt lúc</span>
                    <input type="time" class="time-input" data-attr="ambientUntil" value="${a.ambientUntil}" />
                    <span class="row__hint">Độ sáng</span>
                    <input type="range" data-attr="ambientLevel" min="5" max="30" step="1" value="${a.ambientLevel}" />
                </div>` : ''}
            </section>

            <section class="card group">
                <div class="row">
                    <span class="row__label"><i class="fa-solid fa-microchip"></i>${home.nodes.get(device.node)?.name || 'Chưa gán ESP'}</span>
                    <span class="row__value">${steps} bậc · ${DRIVERS[driver].label} + D4184</span>
                </div>
                ${dimmable ? '' : html`
                <p class="group__note">Mạch <strong>MCP23017</strong> chỉ bật/tắt từng bậc. Đổi sang <strong>PCA9685</strong> (nối dây giống hệt) để chỉnh độ sáng, hiệu ứng thở, ban đêm sáng dịu và đèn nền. Đổi trong Cài đặt → Phòng & thiết bị.</p>`}
                <a class="row row--link" href="https://github.com/ThaiDat-deptrai/HomeGlass/blob/main/docs/cau-thang.md" target="_blank" rel="noopener">
                    <span class="row__label"><i class="fa-solid fa-diagram-project"></i>Sơ đồ đấu dây & cách hoạt động</span>
                    <i class="fa-solid fa-arrow-up-right-from-square row__go"></i>
                </a>
            </section>
        `);
        shown = null;
        paintStatus();
        paintLevels(false);
    }

    // ---------- Hình cầu thang ----------
    function clearTimers() {
        timers.splice(0).forEach(clearTimeout);
    }

    function levelsNow() {
        const s = state();
        const a = attrs();
        if (previewBrightness !== null) a.brightness = previewBrightness;
        return targetLevels({ on: s.pending ? s.target : s.on === true, attrs: a, steps, location, dimmable });
    }

    let animUntil = 0; // hiệu ứng đang chạy tới lúc nào
    const sameLevels = (x, y) => !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]);

    /** Vẽ mức sáng các bậc. animate = chạy lần lượt theo hiệu ứng. */
    function paintLevels(animate, dir = lastDir) {
        const bars = $$('.stair', host);
        const viz = $('#stViz', host);
        if (!bars.length) return;
        const target = levelsNow();
        const a = attrs();
        const on = effectiveOn();
        viz.classList.toggle('is-breathing', on && dimmable && a.effect === 'breathe' && !reducedMotion());

        // Đang chạy hiệu ứng tới đúng đích này (vd: ESP vừa xác nhận) -> để nó chạy nốt
        if (!animate && performance.now() < animUntil && sameLevels(target, shown)) return;
        clearTimers();

        if (!animate || reducedMotion() || !shown) {
            bars.forEach((b, i) => b.style.setProperty('--lv', target[i]));
            shown = target;
            animUntil = 0;
            return;
        }
        const waves = effectOrder(a.effect, dir, steps);
        waves.forEach((wave, k) => {
            timers.push(setTimeout(() => wave.forEach(i => bars[i].style.setProperty('--lv', target[i])), k * a.speed));
        });
        animUntil = performance.now() + waves.length * a.speed + 60;
        shown = target;
    }

    function paintStatus() {
        const s = state();
        const a = attrs();
        const el = $('#stStatus', host);
        const power = $('#stPower', host);
        if (!el) return;
        let text;
        if (s.pending) text = 'Đang gửi lệnh…';
        else if (s.on === null) text = 'Chưa rõ trạng thái';
        else if (s.on) text = `Đang sáng${dimmable ? ` ${isNight(a) ? a.nightLevel : a.brightness}%` : ''}${a.timerMin ? ` · tự tắt sau ${a.timerMin} phút` : ''}`;
        else if (isNight(a) && a.nightGuide) text = 'Ban đêm · đèn dẫn đường đang sáng';
        else if (isAmbient(a, new Date(), location, dimmable)) text = `Đèn nền ${a.ambientLevel}%`;
        else text = 'Đang tắt';
        if (!s.on && a.motion) text += ' · tự bật khi có người';
        el.textContent = text;
        power.classList.toggle('is-on', s.on === true);
        power.classList.toggle('is-pending', !!s.pending);
        power.setAttribute('aria-pressed', String(s.on === true));
        $('#stBrightVal', host) && ($('#stBrightVal', host).textContent = `${previewBrightness ?? a.brightness}%`);
    }

    /** Hình người nhỏ đi dọc cầu thang khi cảm biến thấy người (chỉ để minh họa). */
    function walk(dir) {
        const w = $('#stWalker', host);
        if (!w || reducedMotion()) return;
        const viz = $('#stViz', host).getBoundingClientRect();
        const from = dir === 'up' ? [0, 0] : [viz.width * 0.62, -viz.height * 0.92];
        const to = dir === 'up' ? [viz.width * 0.62, -viz.height * 0.92] : [0, 0];
        w.animate(
            [
                { transform: `translate(${from[0]}px, ${from[1]}px) scaleX(${dir === 'up' ? 1 : -1})`, opacity: 0 },
                { opacity: 1, offset: 0.12 },
                { opacity: 1, offset: 0.85 },
                { transform: `translate(${to[0]}px, ${to[1]}px) scaleX(${dir === 'up' ? 1 : -1})`, opacity: 0 }
            ],
            { duration: Math.max(1600, steps * attrs().speed * 1.4), easing: 'linear' }
        );
    }

    // ---------- Sự kiện ----------
    host.addEventListener('click', e => {
        if (e.target.closest('#stPower')) {
            tap(settings);
            store.toggle(key);
            return;
        }
        const sim = e.target.closest('[data-sim]');
        if (sim) {
            store.simulate(key, { kind: 'motion', dir: sim.dataset.sim });
            if (!attrs().motion) toast('Đang tắt "Tự bật khi có người"', 'info');
            return;
        }
        const eff = e.target.closest('#stEffect button');
        if (eff) {
            store.configure(key, { effect: eff.dataset.effect });
            $$('#stEffect button', host).forEach(b => b.setAttribute('aria-pressed', String(b === eff)));
            // Xem thử: tắt hết rồi sáng lại theo hiệu ứng mới
            if (state().on) {
                $$('.stair', host).forEach(b => b.style.setProperty('--lv', 0));
                setTimeout(() => paintLevels(true), 250);
            }
            return;
        }
        const sw = e.target.closest('.switch[data-attr]');
        if (sw) {
            store.configure(key, { [sw.dataset.attr]: sw.getAttribute('aria-checked') !== 'true' });
            draw();
            return;
        }
        const seg = e.target.closest('#stHold button, #stTimer button');
        if (seg) {
            const box = seg.closest('.segmented');
            const v = Number(seg.dataset.v);
            store.configure(key, box.id === 'stHold' ? { holdSec: v } : { timerMin: v });
            box.style.setProperty('--i', [...box.querySelectorAll('button')].indexOf(seg));
            $$('button', box).forEach(b => b.setAttribute('aria-selected', String(b === seg)));
            paintStatus();
        }
    });

    host.addEventListener('input', e => {
        if (e.target.id === 'stBright') {
            previewBrightness = Number(e.target.value);
            paintLevels(false);
            paintStatus();
        }
    });

    host.addEventListener('change', e => {
        const t = e.target;
        if (t.id === 'stBright') {
            store.configure(key, { brightness: Number(t.value) });
            previewBrightness = null;
        } else if (t.id === 'stSpeed') {
            store.configure(key, { speed: 280 - Number(t.value) });
            if (state().on) {
                $$('.stair', host).forEach(b => b.style.setProperty('--lv', 0));
                setTimeout(() => paintLevels(true), 200);
            }
        } else if (t.dataset.attr) {
            const value = t.type === 'range' ? Number(t.value) : t.value;
            store.configure(key, { [t.dataset.attr]: value });
            draw();
        }
    });

    const off = store.subscribe(ev => {
        if (ev.key !== key) return;
        if (ev.type === 'event' && ev.kind === 'motion') {
            lastDir = ev.dir;
            walk(ev.dir);
            return;
        }
        if (ev.type !== 'device') return;
        const on = effectiveOn();
        const changed = lastOn !== null && on !== lastOn;
        lastOn = on;
        paintStatus();
        paintLevels(changed);
    });

    // Chế độ ban đêm / đèn nền phụ thuộc giờ -> kiểm tra lại mỗi phút
    const clock = setInterval(() => { paintStatus(); paintLevels(false); }, 60000);

    draw();
    lastOn = effectiveOn();

    return () => {
        off();
        clearTimers();
        clearInterval(clock);
    };
}
