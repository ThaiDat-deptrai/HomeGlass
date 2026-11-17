// =============================================================
// SCENES - kịch bản: bấm 1 nút, bật/tắt nhiều thiết bị cùng lúc
// -------------------------------------------------------------
// - Kịch bản CÓ SẴN: tự tính từ cấu hình nhà (không viết cứng tên phòng).
// - Kịch bản TỰ TẠO: mỗi thiết bị chọn Bật / Tắt / Bỏ qua.
//   Tạm lưu trên máy này; khi có MQTT sẽ đồng bộ cho cả nhà.
// =============================================================

const STORAGE_KEY = 'hg.scenes';

export const SCENE_ICONS = [
    'fa-film', 'fa-moon', 'fa-sun', 'fa-door-open', 'fa-house', 'fa-champagne-glasses',
    'fa-book', 'fa-utensils', 'fa-mug-hot', 'fa-music', 'fa-heart', 'fa-star'
];

function buildPresets(home) {
    const lights = home.allDevices.filter(d => d.type === 'light');
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

    return {
        list: () => [...presets, ...custom],
        get: id => [...presets, ...custom].find(s => s.id === id),

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
