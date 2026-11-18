// =============================================================
// SCENES - kịch bản: bấm 1 nút, bật/tắt nhiều thiết bị cùng lúc
// -------------------------------------------------------------
// - Kịch bản CÓ SẴN: tự tính từ cấu hình nhà (không viết cứng tên phòng).
// - Kịch bản TỰ TẠO: mỗi thiết bị chọn Bật / Tắt / Bỏ qua.
//   Tạm lưu trên máy này; khi có MQTT sẽ đồng bộ cho cả nhà.
// =============================================================

import { isLight } from './config.js';

const STORAGE_KEY = 'hg.scenes';
const ACTIVE_KEY = 'hg.scene.active';

export const SCENE_ICONS = [
    'fa-film', 'fa-moon', 'fa-sun', 'fa-door-open', 'fa-house', 'fa-champagne-glasses',
    'fa-book', 'fa-utensils', 'fa-mug-hot', 'fa-music', 'fa-heart', 'fa-star'
];

function buildPresets(home) {
    const lights = home.allDevices.filter(isLight);
    const firstFloor = home.floors[0];

    return [
        {
            id: 'di-ngu', name: 'Đi ngủ', icon: 'fa-moon', preset: true,
            note: 'Tắt hết, chỉ để đèn ngủ',
            actions: lights.map(d => ({ key: d.key, on: d.id === 'den-ngu' }))
        },
        {
            id: 'roi-nha', name: 'Rời nhà', icon: 'fa-door-open', preset: true,
            note: 'Tắt toàn bộ đèn trong nhà',
            actions: lights.map(d => ({ key: d.key, on: false }))
        },
        {
            id: 've-nha', name: 'Về nhà', icon: 'fa-house', preset: true,
            note: 'Bật đèn sân và phòng khách tầng dưới',
            actions: lights
                .filter(d => d.floor === firstFloor && /(^|-)(san|phong-khach)$/.test(d.room.id))
                .map(d => ({ key: d.key, on: true }))
        },
        {
            id: 'sang-het', name: 'Bật tất cả', icon: 'fa-sun', preset: true,
            note: 'Bật toàn bộ đèn trong nhà',
            actions: lights.map(d => ({ key: d.key, on: true }))
        }
    ];
}

export function createScenes(initialHome) {
    let home = initialHome;
    let presets = buildPresets(home);
    const listeners = new Set();

    let custom = [];
    try {
        custom = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) { custom = []; }

    // Bỏ các hành động trỏ tới thiết bị không còn trong cấu hình
    const clean = list => list
        .filter(s => s && s.id && s.name && Array.isArray(s.actions))
        .map(s => ({ ...s, preset: false, actions: s.actions.filter(a => home.devices.has(a.key)) }));

    custom = clean(custom);

    function persist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
        listeners.forEach(fn => fn());
    }

    // ----- Kịch bản đang bật -----
    // Bấm chạy kịch bản -> nó "sáng" lên. Khi có thiết bị TRONG kịch bản bị đổi
    // khác đi (bấm tay, công tắc tường, kịch bản khác...) -> kịch bản tự "tắt".
    let activeId = null;
    try {
        activeId = localStorage.getItem(ACTIVE_KEY);
    } catch (e) { /* bỏ qua */ }

    function setActive(id) {
        if (id === activeId) return;
        activeId = id;
        try {
            if (id) localStorage.setItem(ACTIVE_KEY, id);
            else localStorage.removeItem(ACTIVE_KEY);
        } catch (e) { /* bỏ qua */ }
        listeners.forEach(fn => fn());
    }

    const find = id => [...presets, ...custom].find(s => s.id === id);

    /** Còn đúng với kịch bản không? (thiết bị đang chờ thì xét theo trạng thái nó sắp chuyển sang) */
    function stillTrue(scene, store) {
        return scene.actions.every(a => {
            const s = store.get(a.key);
            if (!s) return true;
            if (s.pending) return s.target === !!a.on;
            return s.on === null || s.on === !!a.on;
        });
    }

    return {
        list: () => [...presets, ...custom],
        get: find,

        activeId: () => activeId,
        activate: id => setActive(id),

        /** Theo dõi thiết bị: kịch bản đang bật mà bị phá vỡ thì tắt nó đi. */
        watch(store) {
            const check = () => {
                if (!activeId) return;
                const scene = find(activeId);
                if (!scene || !stillTrue(scene, store)) setActive(null);
            };
            store.subscribe(e => { if (e.type === 'device' || e.type === 'timeout') check(); });
            check();
        },

        /** Thêm mới (không có id) hoặc cập nhật (có id) một kịch bản tự tạo. */
        save({ id, name, icon, actions }) {
            const scene = {
                id: id || 'c-' + Date.now().toString(36),
                name: name.trim(),
                icon: icon || 'fa-star',
                preset: false,
                actions
            };
            const index = custom.findIndex(s => s.id === scene.id);
            if (index >= 0) custom[index] = scene;
            else custom.push(scene);
            persist();
            return scene;
        },

        remove(id) {
            custom = custom.filter(s => s.id !== id);
            if (activeId === id) setActive(null);
            persist();
        },

        /** Sao lưu / khôi phục: danh sách kịch bản tự tạo. */
        exportCustom: () => custom.map(({ preset, ...s }) => s),
        importCustom(list) {
            custom = clean(Array.isArray(list) ? list : []);
            persist();
        },

        /** Thiết bị đổi phòng -> mã đổi: cập nhật các kịch bản đang dùng nó. */
        renameKey(oldKey, newKey) {
            if (oldKey === newKey) return;
            custom.forEach(s => s.actions.forEach(a => { if (a.key === oldKey) a.key = newKey; }));
            persist();
        },

        /** Cấu hình nhà thay đổi: tính lại kịch bản có sẵn, dọn thiết bị đã xóa. */
        syncHome(next) {
            home = next;
            presets = buildPresets(home);
            custom = clean(custom);
            persist();
        },

        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}
