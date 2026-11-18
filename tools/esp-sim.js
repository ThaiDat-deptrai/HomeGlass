// =============================================================
// ESP GIẢ LẬP - đóng vai ESP trung tâm + các ESP phòng, nói ĐÚNG giao thức
// -------------------------------------------------------------
// Dùng để thử app với máy chủ MQTT thật khi CHƯA có mạch:
//   mở tools/esp-gia-lap.html trên máy tính, đăng nhập, rồi bấm đèn trên điện thoại.
// Đây cũng là "bản mẫu" hành vi mà firmware ESP trung tâm phải làm theo
// (xem docs/giao-thuc.md):
//   - Có "di chúc" (LWT): rớt mạng -> máy chủ tự báo ESP 0 offline.
//   - Nhận bảng kênh hg/node/<số>/config -> biết thiết bị nào ở ESP nào, kênh nào.
//   - Nhận lệnh .../set -> gạt servo / đóng relay -> báo lại .../state (giữ lại).
//   - Thiết bị không có trong bảng -> báo lỗi lên hg/node/0/log.
//   - Gửi nhiệt độ + báo cáo sức khỏe định kỳ.
// =============================================================

import { topics, encode, decode, parseTopic, readOn } from '../app/js/core/protocol.js';

const MASTER = 0;
const TEMP_EVERY_MS = 10000;
const HEALTH_EVERY_MS = 60000;
const STATES_KEY = 'hg.sim.states';

const memoryStorage = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

/**
 * Paho: thư viện Paho (thật hoặc giả để test)
 * opts: { url, username, password, log(text, kind), onChange(), storage }
 */
export function createEspSim(Paho, { url, username, password, log = () => {}, onChange = () => {}, storage = memoryStorage() }) {
    const tables = new Map();   // số ESP -> danh sách thiết bị trong bảng kênh
    const attrs = {};           // cài đặt thiết bị (cầu thang)
    const dead = new Set();     // ESP đang "rút điện"
    let states = {};
    try { states = JSON.parse(storage.getItem(STATES_KEY)) || {}; } catch (e) { states = {}; }

    let client = null;
    let connected = false;
    let stopped = false;
    let timers = [];
    const startedAt = Date.now();

    function send(topic, payload, retained = false) {
        if (!connected) return;
        const m = new Paho.MQTT.Message(payload);
        m.destinationName = topic;
        m.qos = 1;
        m.retained = retained;
        client.send(m);
    }
    const pub = (topic, obj, retained = false) => send(topic, obj === null ? '' : encode(obj), retained);

    const findDevice = key => {
        for (const [nodeId, list] of tables) {
            const dev = list.find(d => d.k === key);
            if (dev) return { nodeId, dev };
        }
        return null;
    };

    function setState(key, on) {
        states[key] = on;
        try { storage.setItem(STATES_KEY, JSON.stringify(states)); } catch (e) { /* bỏ qua */ }
        pub(topics.deviceState(key), { on }, true);
        onChange();
    }

    function health(id) {
        pub(topics.nodeHealth(id), {
            fw: 'gia-lap-1',
            up: Math.round((Date.now() - startedAt) / 1000),
            rssi: -50 - Math.round(Math.random() * 20),
            heap: 150000 + Math.round(Math.random() * 30000),
            reset: 'POWERON'
        }, true);
    }

    function announce(id) {
        pub(topics.nodeStatus(id), { online: !dead.has(id) }, true);
        if (!dead.has(id)) health(id);
    }

    function onMessage(topic, payload) {
        const t = parseTopic(topic);
        if (!t) return;

        // Bảng kênh của 1 ESP
        if (t.kind === 'node' && t.what === 'config') {
            const data = decode(payload);
            if (!data) {
                tables.delete(t.id);
                pub(topics.nodeStatus(t.id), null, true); // ESP đã bị xóa khỏi nhà
                log(`ESP ${t.id}: đã bị xóa khỏi nhà`, 'warn');
                onChange();
                return;
            }
            const list = Array.isArray(data.devices) ? data.devices : [];
            tables.set(t.id, list);
            log(`ESP ${t.id}: nhận bảng kênh (${list.length} thiết bị)`);
            if (t.id !== MASTER) announce(t.id);
            list.forEach(d => {
                if (!(d.k in states)) states[d.k] = false;
                pub(topics.deviceState(d.k), { on: !!states[d.k] }, true);
                if (d.a === 'stairs' && !attrs[d.k]) attrs[d.k] = {};
            });
            onChange();
            return;
        }

        if (t.kind !== 'dev') return;
        const found = findDevice(t.key);

        if (t.what === 'set') {
            if (!found) {
                pub(topics.nodeLog(MASTER), { msg: `Không có thiết bị "${t.key}" trong bảng kênh` });
                log(`Lệnh cho "${t.key}" nhưng không có trong bảng kênh`, 'warn');
                return;
            }
            if (dead.has(found.nodeId)) {
                log(`Lệnh cho "${t.key}" nhưng ESP ${found.nodeId} đang rút điện -> im lặng`, 'warn');
                return;
            }
            const on = readOn(decode(payload));
            if (on === null) return;
            // Servo quay gạt công tắc lâu hơn relay
            const wait = found.dev.a === 'servo' ? 600 : 200;
            log(`${t.key}: ${on ? 'BẬT' : 'TẮT'} (${found.dev.a}${found.dev.ch !== undefined ? `, kênh ${found.dev.ch}` : ''}${found.dev.a === 'servo' ? `, quay ${on ? found.dev.on : found.dev.off}° rồi về ${found.dev.rest}°` : ''})`);
            setTimeout(() => setState(t.key, on), wait);
            return;
        }

        if (t.what === 'cfg' && found && !dead.has(found.nodeId)) {
            const { v, ...patch } = decode(payload) || {};
            attrs[t.key] = { ...attrs[t.key], ...patch };
            pub(topics.deviceAttrs(t.key), attrs[t.key], true);
            log(`${t.key}: đổi cài đặt ${JSON.stringify(patch)}`);
        }
    }

    function tickTemps() {
        tables.forEach((_, id) => {
            if (dead.has(id)) return;
            const v = Math.round((id === MASTER ? 45 : 38 + (id * 3) % 7) * 10 + (Math.random() - 0.5) * 20) / 10;
            pub(topics.nodeTemp(id), { t: v });
        });
    }

    function connect() {
        stopped = false;
        client = new Paho.MQTT.Client(url, `hg-esp-sim-${Math.random().toString(36).slice(2, 8)}`);
        // "Di chúc": rớt mạng bất ngờ -> máy chủ tự gửi tin ESP trung tâm offline
        const will = new Paho.MQTT.Message(encode({ online: false }));
        will.destinationName = topics.nodeStatus(MASTER);
        will.qos = 1;
        will.retained = true;

        client.onConnectionLost = resp => {
            connected = false;
            timers.forEach(clearInterval);
            timers = [];
            onChange();
            if (stopped) return;
            log(`Mất kết nối (${resp?.errorMessage || 'không rõ'}), thử lại sau 3 giây`, 'warn');
            setTimeout(() => { if (!stopped) connect(); }, 3000);
        };
        client.onMessageArrived = m => {
            try { onMessage(m.destinationName, m.payloadString); } catch (e) { log(`Lỗi xử lý ${m.destinationName}: ${e.message}`, 'error'); }
        };
        client.connect({
            userName: username,
            password,
            useSSL: url.startsWith('wss://'),
            timeout: 10,
            keepAliveInterval: 30,
            cleanSession: true,
            willMessage: will,
            onSuccess() {
                connected = true;
                log('Đã kết nối máy chủ MQTT', 'ok');
                announce(MASTER);
                ['hg/node/+/config', 'hg/dev/+/+/set', 'hg/dev/+/+/cfg'].forEach(f => client.subscribe(f, { qos: 1 }));
                timers.push(setInterval(tickTemps, TEMP_EVERY_MS));
                timers.push(setInterval(() => tables.forEach((_, id) => { if (!dead.has(id)) health(id); }), HEALTH_EVERY_MS));
                onChange();
            },
            onFailure(err) {
                connected = false;
                log(`Không kết nối được: ${err?.errorMessage || 'không rõ'}`, 'error');
                onChange();
                if (err?.errorCode !== 6 && !stopped) setTimeout(connect, 3000);
            }
        });
    }

    return {
        connect,
        /** Ngắt đàng hoàng (báo offline trước khi đi). */
        disconnect() {
            stopped = true;
            timers.forEach(clearInterval);
            timers = [];
            pub(topics.nodeStatus(MASTER), { online: false }, true);
            try { client?.disconnect(); } catch (e) { /* bỏ qua */ }
            connected = false;
            onChange();
        },
        isConnected: () => connected,
        tables,
        states: () => ({ ...states }),
        isDead: id => dead.has(id),

        /** Giả lập có người bấm công tắc tường (servo không đụng tới, đèn vẫn đổi). */
        wallSwitch(key) {
            const found = findDevice(key);
            if (!found || dead.has(found.nodeId)) return;
            log(`${key}: có người bấm công tắc tường`);
            setState(key, !states[key]);
        },

        /** Giả lập rút điện / cắm lại 1 ESP phòng. */
        setDead(id, isDead) {
            if (isDead) dead.add(id); else dead.delete(id);
            log(`ESP ${id}: ${isDead ? 'RÚT ĐIỆN' : 'cắm điện lại'}`, isDead ? 'warn' : 'ok');
            announce(id);
            if (!isDead) (tables.get(id) || []).forEach(d => pub(topics.deviceState(d.k), { on: !!states[d.k] }, true));
            onChange();
        },

        /** Chỉ để test: giả lập rớt mạng bất ngờ. */
        get client() { return client; }
    };
}
