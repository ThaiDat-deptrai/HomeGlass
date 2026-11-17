// =============================================================
// DOM - vài hàm nhỏ để dựng giao diện an toàn
// =============================================================

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Biến ký tự đặc biệt thành chữ thường, chống chèn mã HTML (XSS). */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESC[c]);

/** Đánh dấu "chuỗi HTML đã an toàn" (không escape nữa). */
class Safe {
    constructor(text) { this.text = text; }
    toString() { return this.text; }
}

export const raw = text => new Safe(String(text));

/**
 * Mẫu HTML: mọi giá trị chèn vào đều TỰ ĐỘNG được escape,
 * trừ khi nó là kết quả của html`...` khác hoặc raw().
 *   html`<h2>${tenPhong}</h2>`
 */
export function html(strings, ...values) {
    let out = '';
    strings.forEach((part, i) => {
        out += part;
        if (i >= values.length) return;
        const v = values[i];
        if (Array.isArray(v)) out += v.map(x => (x instanceof Safe ? x.text : esc(x))).join('');
        else out += v instanceof Safe ? v.text : esc(v);
    });
    return new Safe(out);
}

/** Đổ mẫu HTML vào một phần tử. */
export function render(el, template) {
    el.innerHTML = String(template);
    return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
