// =============================================================
// SETTINGS - cài đặt giao diện, lưu trên máy người dùng
// =============================================================

const STORAGE_KEY = 'hg.settings';

const DEFAULTS = {
    theme: 'auto',                      // auto | light | dark
    accent: '#2c6bff',                  // màu nhấn
    bg: { type: 'preset', id: 'ocean' }, // hoặc { type: 'image', src: 'data:...' }
    glass: 55,                          // độ đậm kính 0–100
    blur: 20,                           // độ mờ kính (px)
    sound: true,                        // tiếng "tách" khi bấm
    voice: true                         // trợ lý trả lời bằng giọng nói
};

export const ACCENTS = ['#2c6bff', '#7c5cff', '#e93d82', '#e5484d', '#f76b15', '#30a46c', '#12a594', '#0090ff'];

// Mỗi nền: [đốm 1, đốm 2, đốm 3, màu nền] cho chủ đề sáng và tối
export const BACKGROUNDS = {
    ocean: { name: 'Đại dương', light: ['#b7cdff', '#e4d6ff', '#c4eeff', '#e7eefc'], dark: ['#1c3683', '#3a1c6b', '#0e4a5a', '#0a0f20'] },
    sunset: { name: 'Hoàng hôn', light: ['#ffd0b8', '#ffc2dd', '#ffe7b0', '#fdf0ea'], dark: ['#6b2a1c', '#5a1c4a', '#6b4a12', '#160d10'] },
    forest: { name: 'Rừng xanh', light: ['#bfeccf', '#d5f0b8', '#b8e8e6', '#eaf6ee'], dark: ['#0f4a2c', '#2c4a12', '#0e4648', '#08130e'] },
    lavender: { name: 'Oải hương', light: ['#d9ccff', '#ffcdf0', '#c9d8ff', '#f1edfc'], dark: ['#3b2a80', '#5c1c58', '#1c2f70', '#0e0b1c'] },
    graphite: { name: 'Than chì', light: ['#dfe3ea', '#e9e6ee', '#dde7ea', '#f0f2f5'], dark: ['#262b36', '#2b2633', '#1f2c30', '#0c0d10'] }
};

export function createSettings() {
    let current = { ...DEFAULTS };
    try {
        current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch (e) { /* dữ liệu hỏng: dùng mặc định */ }

    const listeners = new Set();
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const isDark = () => current.theme === 'dark' || (current.theme === 'auto' && darkQuery.matches);

    /** Đưa cài đặt hiện tại lên giao diện (biến CSS). */
    function apply() {
        const root = document.documentElement;
        const bgEl = document.getElementById('bg');

        if (current.theme === 'auto') delete root.dataset.theme;
        else root.dataset.theme = current.theme;

        root.style.setProperty('--accent', current.accent);
        root.style.setProperty('--glass-strength', String(current.glass / 100));
        root.style.setProperty('--blur', current.blur + 'px');

        // Nền
        const preset = BACKGROUNDS[current.bg?.id] || BACKGROUNDS.ocean;
        const [b1, b2, b3, base] = isDark() ? preset.dark : preset.light;
        root.style.setProperty('--blob-1', b1);
        root.style.setProperty('--blob-2', b2);
        root.style.setProperty('--blob-3', b3);
        root.style.setProperty('--bg-base', base);

        if (current.bg?.type === 'image' && current.bg.src) {
            bgEl.style.setProperty('--bg-image', `url("${current.bg.src}")`);
            bgEl.classList.add('bg--image');
        } else {
            bgEl.style.removeProperty('--bg-image');
            bgEl.classList.remove('bg--image');
        }

        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', base);
    }

    darkQuery.addEventListener('change', () => {
        if (current.theme === 'auto') apply();
    });

    return {
        get: () => current,
        isDark,
        apply,

        /** Đổi một vài cài đặt. Ném lỗi nếu máy hết chỗ lưu (ảnh quá lớn). */
        set(patch) {
            const next = { ...current, ...patch };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); // có thể ném QuotaExceededError
            current = next;
            apply();
            listeners.forEach(fn => fn(current));
        },

        reset() {
            localStorage.removeItem(STORAGE_KEY);
            current = { ...DEFAULTS };
            apply();
            listeners.forEach(fn => fn(current));
        },

        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}
