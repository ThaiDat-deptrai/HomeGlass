// =============================================================
// COMMANDS - hiểu câu lệnh của trợ lý (nói hoặc gõ)
// -------------------------------------------------------------
// Vào:  "tắt đèn phòng khách tầng 1" / "tat den bep" / "turn off kitchen light"
// Ra:   { reply: "Đã tắt 2 đèn ở Phòng khách (Tầng 1).", actions: [...] }
//
// Hiểu được:
//   - Có dấu, KHÔNG dấu, viết hoa thường lộn xộn.
//   - Tiếng Anh cơ bản: turn on/off, light, kitchen, bedroom, all...
//   - Từ đồng nghĩa: mở = bật, đóng/ngắt = tắt, bóng = đèn, nhà bếp = bếp...
//   - Nói lộn thứ tự ("bếp bật đèn") hoặc giọng nói nghe nhầm 1 chữ
//     ("phòng ngũ") -> tìm thiết bị KHỚP NHẤT theo từ khóa.
//   - Loại thiết bị: "bật quạt phòng khách" chỉ bật quạt, không bật đèn.
// Tên phòng, tên thiết bị lấy từ cấu hình nhà -> thêm thiết bị mới trong app
// là nói / gõ được ngay, không phải sửa code.
//
// Hàm này KHÔNG tự bật/tắt gì cả, chỉ trả về danh sách việc cần làm.
// =============================================================

import { isLight } from './config.js';

/**
 * Cụm từ đồng nghĩa / tiếng Anh -> đổi về cách nói chuẩn (đã bỏ dấu).
 * Thứ tự quan trọng: cụm dài trước, cụm ngắn sau.
 */
const PHRASES = [
    // Câu hỏi
    ['how many', 'bao nhieu'], ['are on', 'dang bat'],
    // Kịch bản hay dùng
    ['good night', 'di ngu'], ['go to sleep', 'di ngu'], ['sleep mode', 'di ngu'], ['bedtime', 'di ngu'],
    ['leave home', 'roi nha'], ['leaving home', 'roi nha'], ['going out', 'roi nha'],
    ['i m home', 've nha'], ['im home', 've nha'], ['come home', 've nha'], ['welcome home', 've nha'],
    // Bật / tắt
    ['turn it on', 'bat'], ['turn on', 'bat'], ['switch on', 'bat'], ['bat len', 'bat'], ['mo len', 'bat'], ['khoi dong', 'bat'],
    ['turn it off', 'tat'], ['turn off', 'tat'], ['switch off', 'tat'], ['shut off', 'tat'], ['shut down', 'tat'], ['tat di', 'tat'],
    // Tất cả
    ['everything', 'het'], ['all of', 'het'], ['toan bo', 'het'], ['tat ca', 'het'], ['moi', 'het'],
    // Thiết bị
    ['air conditioner', 'dieu hoa'], ['aircon', 'dieu hoa'], ['may lanh', 'dieu hoa'], ['television', 'tivi'],
    ['bong den', 'den'], ['lights', 'den'], ['light', 'den'], ['lamps', 'den'], ['lamp', 'den'],
    ['fans', 'quat'], ['fan', 'quat'], ['socket', 'o cam'], ['plug', 'o cam'], ['pump', 'may bom'],
    // Phòng
    ['living room', 'phong khach'], ['nha bep', 'bep'], ['phong bep', 'bep'], ['kitchen', 'bep'],
    ['bedroom', 'phong ngu'], ['bathroom', 'phong tam'], ['nha tam', 'phong tam'], ['nha ve sinh', 'toilet'], ['wc', 'toilet'],
    ['garden', 'vuon'], ['yard', 'san'], ['staircase', 'cau thang'], ['stairs', 'cau thang'], ['altar room', 'phong tho'],
    // Tầng
    ['ground floor', 'tang 1'], ['first floor', 'tang 1'], ['tang tret', 'tang 1'], ['downstairs', 'tang 1'],
    ['second floor', 'tang 2'], ['upstairs', 'tang 2'], ['floor', 'tang'],
    // Số
    ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['mot', '1'], ['hai', '2'], ['ba', '3'], ['bon', '4']
];

/** Từ đứng một mình (có ranh giới): on/off/all tiếng Anh. */
const WORDS = { on: 'bat', off: 'tat', open: 'bat', close: 'tat', dong: 'tat', dap: 'tat', all: 'het', the: '', please: '', giup: '', gium: '' };

/** Bỏ dấu, viết thường, đổi từ đồng nghĩa / tiếng Anh về cách nói chuẩn. */
export function normalize(text) {
    let t = String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    t = ' ' + t + ' ';
    PHRASES.forEach(([from, to]) => { t = t.split(' ' + from + ' ').join(' ' + to + ' '); });
    t = t.split(' ').map(w => (w in WORDS ? WORDS[w] : w)).join(' ');
    return t.replace(/\s+/g, ' ').trim();
}

/** Tên trong cấu hình cũng đi qua ĐÚNG bộ chuẩn hóa như câu nói -> hai bên luôn so khớp được. */
const plain = text => normalize(text);

const has = (text, phrase) => !!phrase && (' ' + text + ' ').includes(' ' + phrase + ' ');

/** Trong các tên khớp, bỏ tên ngắn nếu nó nằm trong một tên dài hơn cũng khớp. */
function keepLongest(items, getName) {
    return items.filter(a => !items.some(b => b !== a && getName(b) !== getName(a) && has(getName(b), getName(a))));
}

const where = device => (device.room.name === device.floor.name
    ? device.room.name
    : `${device.room.name} (${device.floor.name})`);

// ---------- Loại thiết bị ----------
const TYPE_WORDS = [
    ['fan', ['quat']], ['ac', ['dieu hoa']], ['plug', ['o cam']], ['tv', ['tivi']], ['pump', ['may bom']]
];
function wantedType(text) {
    const found = TYPE_WORDS.find(([, words]) => words.some(w => has(text, w)));
    return found ? found[0] : null;
}

// ---------- So khớp gần đúng (giọng nói nghe nhầm 1 chữ) ----------
function distance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return row[b.length];
}
/** Hai từ coi như giống nhau: trùng hẳn, hoặc từ dài (>= 4 chữ) sai đúng 1 chữ. Số thì phải trùng. */
const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && !/\d/.test(a + b) && distance(a, b) <= 1);

// Từ không mang nghĩa "chỗ nào / cái nào"
const FILLER = new Set(['bat', 'tat', 'het', 'den', 'phong', 'tang', 'cho', 'minh', 'toi', 'em', 'anh', 'voi', 'nhe', 'nha', 'di', 'cai', 'o', 'trong', 'cua', 'lai', 'len', 'xuong', 'ngay', 'luon', 'a', 'the', 'is', 'in']);

/**
 * Dự phòng khi không khớp chính xác: chấm điểm từng thiết bị theo từ khóa.
 * Mọi từ khóa trong câu phải có trong (tên thiết bị + tên phòng + tên tầng).
 */
function fuzzyTargets(text, devices) {
    const words = text.split(' ').filter(w => w && !FILLER.has(w));
    if (!words.length) return [];
    let best = [];
    let bestScore = 0;
    devices.forEach(d => {
        const parts = [[plain(d.name), 3], [plain(d.room.name), 2], [plain(d.floor.name), 1]];
        let score = 0;
        const covered = words.every(w => {
            const hit = parts.find(([p]) => p.split(' ').some(x => sameWord(w, x)));
            if (hit) score += hit[1];
            return !!hit;
        });
        if (!covered) return;
        if (score > bestScore) { bestScore = score; best = [d]; }
        else if (score === bestScore) best.push(d);
    });
    return best;
}

const HELP = 'Mình chưa hiểu. Thử nói: "bật đèn bếp", "tắt hết đèn tầng 2" hoặc "turn off kitchen light".';

export function interpret(text, { home, store, scenes }) {
    const t = normalize(text);
    if (!t) return { reply: 'Mình chưa nghe rõ, bạn nói lại nhé.' };

    // ----- Chào hỏi -----
    if (/^(xin )?chao\b|^(hello|hi|hey)\b/.test(t)) return { reply: 'Chào bạn! Bạn muốn bật hay tắt đèn nào?' };
    if (has(t, 'cam on') || /\bthank/.test(t)) return { reply: 'Không có gì!' };

    // ----- Hỏi số đèn đang bật -----
    if (/(bao nhieu|may) (cai |bong )?den/.test(t)) {
        const lights = home.allDevices.filter(isLight);
        const n = store.countOn(lights);
        return { reply: n ? `Đang có ${n} đèn bật.` : 'Tất cả đèn đang tắt.' };
    }

    // ----- Kịch bản: nói đúng tên là chạy -----
    const scene = scenes.list().find(s => has(t, plain(s.name)));
    if (scene) return { reply: `Đã chạy kịch bản "${scene.name}".`, actions: scene.actions, scene };

    // ----- Bật hay tắt? -----
    const wantOn = /\b(bat|mo)\b/.test(t);
    const wantOff = /\b(tat|ngat)\b/.test(t);
    if (wantOn === wantOff) return { reply: HELP };
    const on = wantOn;
    const verb = on ? 'bật' : 'tắt';

    // ----- Phạm vi: tầng -----
    const floor = home.floors.find(f => has(t, plain(f.name)));
    let pool = home.allDevices.filter(d => !floor || d.floor === floor);

    // ----- Tên thiết bị cụ thể ("đèn ngủ", "đèn phòng thờ"...) -----
    let named = pool.filter(d => {
        const name = plain(d.name);
        return name !== 'den' && has(t, name);
    });
    named = keepLongest(named, d => plain(d.name));

    // Xóa tên thiết bị khỏi câu, để "đèn phòng thờ" không bị hiểu nhầm là phòng "Phòng thờ"
    let rest = ' ' + t + ' ';
    named.forEach(d => { rest = rest.replace(' ' + plain(d.name) + ' ', ' '); });
    rest = rest.trim();

    // ----- Phạm vi: phòng -----
    let rooms = [...home.rooms.values()].filter(r => (!floor || r.floor === floor) && has(rest, plain(r.name)));
    rooms = keepLongest(rooms, r => plain(r.name));

    // Cùng tên phòng ở 2 tầng (vd: Phòng khách) mà không nói tầng -> hỏi lại
    if (rooms.length > 1 && new Set(rooms.map(r => plain(r.name))).size === 1) {
        return { reply: `Có ${rooms.length} "${rooms[0].name}": ${rooms.map(r => r.floor.name).join(' và ')}. Bạn nói rõ tầng nhé.` };
    }
    if (rooms.length) pool = pool.filter(d => rooms.includes(d.room));

    // ----- Chọn thiết bị đích -----
    const type = wantedType(rest);
    const ofType = d => (type ? d.type === type : isLight(d));
    let targets;
    const all = has(rest, 'het');

    if (named.length) {
        targets = rooms.length ? named.filter(d => rooms.includes(d.room)) : named;
        if (!targets.length) return { reply: `Mình không thấy "${named[0].name}" ở ${rooms[0].name}.` };
        // Cùng tên ở nhiều phòng mà không nói phòng -> hỏi lại
        if (!rooms.length && targets.length > 1) {
            return { reply: `Có ${targets.length} "${targets[0].name}": ở ${targets.map(d => d.room.name).join(' và ')}. Bạn nói rõ phòng nhé.` };
        }
    } else if (rooms.length || floor || all) {
        targets = pool.filter(ofType);
        if (!targets.length && type) return { reply: `Chỗ đó chưa có ${type === 'fan' ? 'quạt' : 'thiết bị loại này'} trong cấu hình.` };
    } else {
        // ----- Không khớp chính xác: tìm gần đúng theo từ khóa -----
        targets = fuzzyTargets(t, home.allDevices.filter(d => !type || d.type === type));
        if (!targets.length) {
            if (has(t, 'den')) return { reply: `Bạn muốn ${verb} đèn phòng nào? Hoặc nói "${verb} hết đèn".` };
            return { reply: HELP };
        }
        // Khớp nhiều thiết bị cùng tên ở nhiều phòng -> hỏi lại
        const roomsHit = new Set(targets.map(d => d.room));
        if (targets.length > 1 && roomsHit.size > 1 && new Set(targets.map(d => plain(d.name))).size === 1) {
            return { reply: `Có ${targets.length} "${targets[0].name}": ở ${[...roomsHit].map(r => r.name).join(' và ')}. Bạn nói rõ phòng nhé.` };
        }
        if (roomsHit.size === 1 && targets.length > 1) rooms = [...roomsHit];
    }

    if (!targets.length) return { reply: 'Chỗ đó chưa có đèn nào trong cấu hình.' };

    // ----- Câu trả lời -----
    const actions = targets.map(d => ({ key: d.key, on }));
    const what = type === 'fan' ? 'quạt' : 'đèn';
    let reply;
    if (targets.length === 1) {
        reply = `Đã ${verb} ${targets[0].name} ở ${where(targets[0])}.`;
    } else if (rooms.length === 1) {
        reply = `Đã ${verb} ${targets.length} ${what} ở ${where(targets[0])}.`;
    } else if (floor) {
        reply = `Đã ${verb} ${targets.length} ${what} ở ${floor.name}.`;
    } else {
        reply = `Đã ${verb} ${targets.length} ${what}.`;
    }
    return { reply, actions };
}
