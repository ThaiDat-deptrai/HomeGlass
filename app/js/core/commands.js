// =============================================================
// COMMANDS - hiểu câu lệnh tiếng Việt của trợ lý
// -------------------------------------------------------------
// Vào:  "tắt đèn phòng khách tầng 1"
// Ra:   { reply: "Đã tắt 2 đèn ở Phòng khách (Tầng 1).", actions: [...] }
//
// Hàm này KHÔNG tự bật/tắt gì cả, chỉ trả về danh sách việc cần làm.
// Tên phòng, tên đèn đều lấy từ cấu hình nhà, không viết cứng.
// =============================================================

import { isLight } from './config.js';

/** Bỏ dấu, viết thường, đổi "một/hai" thành số để so khớp dễ hơn. */
export function normalize(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\bmot\b/g, '1')
        .replace(/\bhai\b/g, '2')
        .replace(/\bba\b/g, '3')
        .replace(/\s+/g, ' ')
        .trim();
}

const has = (text, phrase) => (' ' + text + ' ').includes(' ' + phrase + ' ');

/** Trong các tên khớp, bỏ tên ngắn nếu nó nằm trong một tên dài hơn cũng khớp. */
function keepLongest(items, getName) {
    return items.filter(a => !items.some(b => b !== a && getName(b) !== getName(a) && has(getName(b), getName(a))));
}

const where = device => (device.room.name === device.floor.name
    ? device.room.name
    : `${device.room.name} (${device.floor.name})`);

export function interpret(text, { home, store, scenes }) {
    const t = normalize(text);
    if (!t) return { reply: 'Mình chưa nghe rõ, bạn nói lại nhé.' };

    // ----- Chào hỏi -----
    if (/^(xin )?chao\b/.test(t)) return { reply: 'Chào bạn! Bạn muốn bật hay tắt đèn nào?' };
    if (has(t, 'cam on')) return { reply: 'Không có gì!' };

    // ----- Hỏi số đèn đang bật -----
    if (/(bao nhieu|may) (cai |bong )?den/.test(t)) {
        const lights = home.allDevices.filter(isLight);
        const n = store.countOn(lights);
        return { reply: n ? `Đang có ${n} đèn bật.` : 'Tất cả đèn đang tắt.' };
    }

    // ----- Kịch bản: nói đúng tên là chạy -----
    const scene = scenes.list().find(s => has(t, normalize(s.name)));
    if (scene) return { reply: `Đã chạy kịch bản "${scene.name}".`, actions: scene.actions, scene };

    // ----- Bật hay tắt? -----
    const wantOn = /\b(bat|mo)\b/.test(t);
    const wantOff = /\b(tat|ngat)\b/.test(t);
    if (wantOn === wantOff) {
        return { reply: 'Mình chưa hiểu. Thử nói: "bật đèn bếp" hoặc "tắt hết đèn".' };
    }
    const on = wantOn;
    const verb = on ? 'bật' : 'tắt';

    // ----- Phạm vi: tầng -----
    const floor = home.floors.find(f => has(t, normalize(f.name)));
    let pool = home.allDevices.filter(d => !floor || d.floor === floor);

    // ----- Tên thiết bị cụ thể ("đèn ngủ", "đèn phòng thờ"...) -----
    let named = pool.filter(d => {
        const name = normalize(d.name);
        return name !== 'den' && has(t, name);
    });
    named = keepLongest(named, d => normalize(d.name));

    // Xóa tên thiết bị khỏi câu, để "đèn phòng thờ" không bị hiểu nhầm là phòng "Phòng thờ"
    let rest = ' ' + t + ' ';
    named.forEach(d => { rest = rest.replace(' ' + normalize(d.name) + ' ', ' '); });
    rest = rest.trim();

    // ----- Phạm vi: phòng -----
    let rooms = [...home.rooms.values()].filter(r => (!floor || r.floor === floor) && has(rest, normalize(r.name)));
    rooms = keepLongest(rooms, r => normalize(r.name));

    // Cùng tên phòng ở 2 tầng (vd: Phòng khách) mà không nói tầng -> hỏi lại
    if (rooms.length > 1 && new Set(rooms.map(r => normalize(r.name))).size === 1) {
        return { reply: `Có ${rooms.length} "${rooms[0].name}": ${rooms.map(r => r.floor.name).join(' và ')}. Bạn nói rõ tầng nhé.` };
    }
    if (rooms.length) pool = pool.filter(d => rooms.includes(d.room));

    // ----- Chọn thiết bị đích -----
    let targets;
    const all = /\b(tat ca|het|toan bo)\b/.test(rest);

    if (named.length) {
        targets = rooms.length ? named.filter(d => rooms.includes(d.room)) : named;
        if (!targets.length) {
            return { reply: `Mình không thấy "${named[0].name}" ở ${rooms[0].name}.` };
        }
        // Cùng tên ở nhiều phòng mà không nói phòng -> hỏi lại
        if (!rooms.length && targets.length > 1) {
            return { reply: `Có ${targets.length} "${targets[0].name}": ở ${targets.map(d => d.room.name).join(' và ')}. Bạn nói rõ phòng nhé.` };
        }
    } else if (rooms.length || floor || all) {
        targets = pool.filter(isLight);
    } else if (has(t, 'den')) {
        return { reply: `Bạn muốn ${verb} đèn phòng nào? Hoặc nói "${verb} hết đèn".` };
    } else {
        return { reply: 'Mình chưa hiểu. Thử nói: "bật đèn bếp" hoặc "tắt hết đèn".' };
    }

    if (!targets.length) return { reply: 'Chỗ đó chưa có đèn nào trong cấu hình.' };

    // ----- Câu trả lời -----
    const actions = targets.map(d => ({ key: d.key, on }));
    let reply;
    if (targets.length === 1) {
        reply = `Đã ${verb} ${targets[0].name} ở ${where(targets[0])}.`;
    } else if (rooms.length === 1) {
        reply = `Đã ${verb} ${targets.length} đèn ở ${where(targets[0])}.`;
    } else if (floor) {
        reply = `Đã ${verb} ${targets.length} đèn ở ${floor.name}.`;
    } else {
        reply = `Đã ${verb} ${targets.length} đèn.`;
    }
    return { reply, actions };
}
