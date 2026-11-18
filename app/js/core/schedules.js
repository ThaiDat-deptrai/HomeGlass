// =============================================================
// SCHEDULES - hẹn giờ tự chạy kịch bản
// -------------------------------------------------------------
// Mỗi lịch: chạy 1 kịch bản vào
//   - một giờ cố định (vd 06:30), hoặc
//   - lúc mặt trời lặn / mọc (± vài phút, tự đổi theo mùa)
// vào các thứ đã chọn trong tuần.
//
// LỊCH THẬT CHẠY TRÊN ESP TRUNG TÂM (lấy giờ chuẩn từ Internet), nên tắt
// điện thoại vẫn chạy. Ở bản demo chưa có ESP, app tự chạy lịch khi đang mở
// (xem startDemoRunner) để bạn thử được.
// =============================================================

import { sunriseMinutes, sunsetMinutes, formatMinutes } from './sun.js';

const STORAGE_KEY = 'hg.schedules';
const FIRED_KEY = 'hg.schedules.fired';

/** Thứ trong tuần theo kiểu JavaScript: 0 = Chủ nhật, 1 = Thứ 2 ... 6 = Thứ 7 */
export const DAYS = [
    { v: 1, t: 'T2' }, { v: 2, t: 'T3' }, { v: 3, t: 'T4' }, { v: 4, t: 'T5' },
    { v: 5, t: 'T6' }, { v: 6, t: 'T7' }, { v: 0, t: 'CN' }
];

export const KINDS = {
    time: { label: 'Giờ cố định', icon: 'fa-clock' },
    sunset: { label: 'Mặt trời lặn', icon: 'fa-cloud-sun' },
    sunrise: { label: 'Mặt trời mọc', icon: 'fa-sun' }
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Phút trong ngày lịch sẽ chạy, cho một ngày cụ thể. */
export function triggerMinutes(s, date, location) {
    if (s.kind === 'sunset') return sunsetMinutes(date, location) + (s.offset || 0);
    if (s.kind === 'sunrise') return sunriseMinutes(date, location) + (s.offset || 0);
    const [h, m] = String(s.time || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/**
 * GIỜ TẮT (không bắt buộc): s.end = { kind, time, offset } | null
 * Đến giờ tắt -> tắt lại những thiết bị mà kịch bản đã BẬT (đèn kịch bản tắt sẵn thì để nguyên).
 * Giờ tắt sớm hơn (hoặc bằng) giờ bật -> tắt vào HÔM SAU (vd bật 18:00, tắt 06:00 sáng mai).
 */
export function normalizeEnd(end) {
    if (!end || !KINDS[end.kind]) return null;
    return { kind: end.kind, time: end.time || '23:00', offset: Number(end.offset) || 0 };
}

/** Giờ tắt rơi vào hôm sau so với ngày bật? */
export function endsNextDay(s, date, location) {
    return !!s.end && triggerMinutes(s.end, date, location) <= triggerMinutes(s, date, location);
}

/** Lệnh tắt lúc hết giờ: các thiết bị kịch bản đã bật -> tắt. */
export const endActionsOf = scene => (scene?.actions || []).filter(a => a.on).map(a => ({ key: a.key, on: false }));

/** "23:00" / "Mặt trời mọc" (+ "hôm sau" nếu qua ngày) */
export function endText(s, location, date = new Date()) {
    if (!s.end) return '';
    const base = s.end.kind === 'time' ? s.end.time : whenText(s.end, location, date);
    return `${base}${endsNextDay(s, date, location) ? ' hôm sau' : ''}`;
}

/** Lần chạy tới (Date) tính từ "from", hoặc null nếu lịch đang tắt / không chọn ngày nào. */
export function nextRun(s, from = new Date(), location) {
    if (!s.enabled || !s.days?.length) return null;
    for (let add = 0; add < 8; add++) {
        const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add);
        if (!s.days.includes(day.getDay())) continue;
        const minutes = triggerMinutes(s, day, location);
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
        if (at > from) return at;
    }
    return null;
}

export function daysText(days = []) {
    const set = new Set(days);
    if (set.size === 7) return 'Hằng ngày';
    if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Thứ 2 – Thứ 6';
    if (set.size === 2 && set.has(6) && set.has(0)) return 'Cuối tuần';
    if (!set.size) return 'Chưa chọn ngày';
    return DAYS.filter(d => set.has(d.v)).map(d => d.t).join(', ');
}

/** "06:30" / "Mặt trời lặn +15 phút (≈ 17:42)" */
export function whenText(s, location, date = new Date()) {
    if (s.kind === 'time') return s.time;
    const base = KINDS[s.kind].label;
    const off = s.offset ? ` ${s.offset > 0 ? '+' : '−'}${Math.abs(s.offset)} phút` : '';
    return `${base}${off} (≈ ${formatMinutes(triggerMinutes(s, date, location))})`;
}

/** "Hôm nay 18:30", "Mai 06:30", "Thứ 2 06:30" */
export function relativeText(at, now = new Date()) {
    if (!at) return 'Đang tắt';
    const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d1 = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const diff = Math.round((d1 - d0) / 864e5);
    if (diff === 0) return `Hôm nay ${hm}`;
    if (diff === 1) return `Mai ${hm}`;
    return `${DAYS.find(d => d.v === at.getDay()).t === 'CN' ? 'Chủ nhật' : 'Thứ ' + (at.getDay() + 1)} ${hm}`;
}

export function createSchedules(location) {
    const listeners = new Set();
    let list = [];
    try {
        list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) { list = []; }
    list = list.filter(s => s && s.id && s.sceneId);

    function persist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        listeners.forEach(fn => fn());
    }

    return {
        location,
        list: () => [...list],
        forScene: sceneId => list.filter(s => s.sceneId === sceneId),
        get: id => list.find(s => s.id === id),

        /** Lịch sắp chạy nhất trước (lịch đang tắt xếp cuối). */
        upcoming(now = new Date()) {
            return list
                .map(s => ({ s, at: nextRun(s, now, location) }))
                .sort((a, b) => (a.at ? a.at.getTime() : Infinity) - (b.at ? b.at.getTime() : Infinity));
        },

        save(s) {
            const item = {
                id: s.id || 'h-' + Date.now().toString(36),
                sceneId: s.sceneId,
                kind: KINDS[s.kind] ? s.kind : 'time',
                time: s.time || '18:00',
                offset: Number(s.offset) || 0,
                days: Array.isArray(s.days) ? [...new Set(s.days)] : ALL_DAYS,
                enabled: s.enabled !== false,
                end: normalizeEnd(s.end)
            };
            const i = list.findIndex(x => x.id === item.id);
            if (i >= 0) list[i] = item;
            else list.push(item);
            persist();
            return item;
        },

        setEnabled(id, enabled) {
            const s = list.find(x => x.id === id);
            if (!s) return;
            s.enabled = enabled;
            persist();
        },

        remove(id) {
            list = list.filter(s => s.id !== id);
            persist();
        },

        /** Khôi phục từ bản sao lưu: thay toàn bộ lịch. */
        importAll(items) {
            list = (Array.isArray(items) ? items : [])
                .filter(s => s && s.id && s.sceneId)
                .map(s => ({
                    id: s.id,
                    sceneId: s.sceneId,
                    kind: KINDS[s.kind] ? s.kind : 'time',
                    time: s.time || '18:00',
                    offset: Number(s.offset) || 0,
                    days: Array.isArray(s.days) ? s.days : ALL_DAYS,
                    enabled: s.enabled !== false,
                    end: normalizeEnd(s.end)
                }));
            persist();
        },

        /** Kịch bản bị xóa -> xóa luôn lịch của nó. */
        removeScene(sceneId) {
            const before = list.length;
            list = list.filter(s => s.sceneId !== sceneId);
            if (list.length !== before) persist();
        },

        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}

/**
 * CHỈ DÙNG Ở BẢN DEMO: app tự chạy lịch khi đang mở.
 * (Bản thật: ESP trung tâm chạy, kể cả khi tắt app.)
 * runScene(sceneId, schedule) được gọi đúng 1 lần cho mỗi lần đến giờ.
 * runEnd(sceneId, schedule): đến GIỜ TẮT của lịch.
 */
export function startDemoRunner(schedules, runScene, runEnd) {
    let fired = {};
    try {
        fired = JSON.parse(localStorage.getItem(FIRED_KEY) || '{}');
    } catch (e) { fired = {}; }

    function check() {
        const now = new Date();
        const today = now.toDateString();
        const minuteNow = now.getHours() * 60 + now.getMinutes();
        schedules.list().forEach(s => {
            if (!s.enabled) return;
            const due = (at, key, fn) => {
                const mark = `${today}|${at}`;
                // Đến giờ (cho trễ tối đa 2 phút, phòng khi máy ngủ) và hôm nay chưa chạy
                if (minuteNow >= at && minuteNow - at <= 2 && fired[key] !== mark) {
                    fired[key] = mark;
                    try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch (e) { /* bỏ qua */ }
                    fn(s.sceneId, s);
                }
            };
            if (s.days.includes(now.getDay())) due(triggerMinutes(s, now, schedules.location), s.id, runScene);
            if (s.end && runEnd) {
                // Giờ tắt hôm nay thuộc lần bật hôm nay (cùng ngày) hoặc lần bật hôm qua (qua đêm)
                const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                const sameDay = s.days.includes(now.getDay()) && !endsNextDay(s, now, schedules.location);
                const overnight = s.days.includes(yesterday.getDay()) && endsNextDay(s, yesterday, schedules.location);
                if (sameDay || overnight) due(triggerMinutes(s.end, now, schedules.location), s.id + ':end', runEnd);
            }
        });
    }

    check();
    return setInterval(check, 15000);
}
