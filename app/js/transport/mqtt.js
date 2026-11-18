// =============================================================
// TRANSPORT MQTT - nói chuyện với nhà thật qua HiveMQ Cloud
// -------------------------------------------------------------
// Giống hệt transport demo ở bên ngoài (store và giao diện không biết
// đang dùng cái nào), bên trong thì:
//   - Tải thư viện Paho (có kiểm tra chữ ký SRI) chỉ khi cần.
//   - Mất kết nối -> TỰ KẾT NỐI LẠI, chờ tăng dần 1s, 2s, 4s... tối đa 30s
//     (không dồn dập làm treo máy). Mở lại app / có mạng lại -> thử ngay.
//   - Sai tài khoản -> DỪNG, báo "auth" để app hỏi đăng nhập lại
//     (không thử mù quáng mãi).
//   - Mất kết nối thì KHÔNG xếp hàng lệnh: bấm đèn lúc mất mạng mà
//     5 phút sau đèn tự bật là nguy hiểm. Store sẽ báo ngay cho người bấm.
//   - Tin nhắn lạ / hỏng: bỏ qua + ghi nhật ký, không bao giờ làm sập app.
//
// Thêm so với transport demo:
//   onNodeStatus(id, { online?, health? })   ESP online/offline, sức khỏe
//   docs: đồng bộ cấu hình, kịch bản, lịch giữa các điện thoại (core/sync.js)
// =============================================================

import {
    topics, APP_SUBSCRIPTIONS, parseTopic, encode, decode, isNewer, readOn, readOnline, readTemp
} from '../core/protocol.js';
import { logError } from '../core/errlog.js';

/** Địa chỉ máy chủ MQTT (không phải bí mật). Đổi được ở màn hình đăng nhập. */
export const DEFAULT_BROKER = 'wss://130d14182c00498e952cad93f9325420.s1.eu.hivemq.cloud:8884/mqtt';

// Thư viện Paho MQTT; integrity = chữ ký: file trên CDN bị sửa thì trình duyệt từ chối chạy
const PAHO_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/paho-mqtt/1.0.1/mqttws31.min.js';
const PAHO_SRI = 'sha384-FtgI6XBQHroa6RTQqVE29PsMgDmibchdhIXlikZhRqly3P0ZGnfxior+GiKyxF7/';

const PAHO_AUTH_ERROR = 6;         // máy chủ từ chối đăng nhập (CONNACK)
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
const DOCS_SETTLE_MS = 1500;       // chờ các tin "giữ lại" về hết sau khi đăng ký nghe

let pahoPromise = null;

/** Tải Paho 1 lần. Lỗi (mất mạng) thì lần sau tải lại. */
export function loadPaho() {
    if (window.Paho?.MQTT) return Promise.resolve(window.Paho);
    if (!pahoPromise) {
        pahoPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = PAHO_SRC;
            s.integrity = PAHO_SRI;
            s.crossOrigin = 'anonymous';
            s.referrerPolicy = 'no-referrer';
            s.onload = () => (window.Paho?.MQTT ? resolve(window.Paho) : reject(new Error('Thư viện MQTT tải về bị lỗi')));
            s.onerror = () => {
                pahoPromise = null;
                s.remove();
                reject(new Error('Không tải được thư viện MQTT (mất mạng?)'));
            };
            document.head.appendChild(s);
        });
    }
    return pahoPromise;
}

const randomId = () => Math.random().toString(36).slice(2, 10);

/**
 * auth: { url, username, password }
 * Trả về transport. Gọi open() để bắt đầu kết nối (store tự gọi qua connect()).
 * firstConnect: Promise xong khi kết nối lần đầu thành công,
 *               lỗi { auth: true } nếu sai tài khoản, { network: true } nếu không tới được máy chủ.
 */
export function createMqttTransport(auth) {
    const url = auth.url || DEFAULT_BROKER;
    const clientId = `hg-app-${randomId()}`;

    let handlers = null;
    let client = null;
    let connected = false;
    let opened = false;
    let closed = false;
    let status = 'connecting';
    let retryDelay = RETRY_MIN_MS;
    let retryTimer = null;
    let settleTimer = null;
    let warnedNewer = false;

    const docListeners = new Set();
    const readyListeners = new Set();
    const lostListeners = new Set();

    let firstDone = false;
    let resolveFirst, rejectFirst;
    const firstConnect = new Promise((res, rej) => { resolveFirst = res; rejectFirst = rej; });
    firstConnect.catch(() => {}); // không ai chờ thì cũng không báo "lỗi chưa bắt"

    function setStatus(next) {
        if (status === next) return;
        status = next;
        handlers?.onStatus(next);
    }

    function finishFirst(error) {
        if (firstDone) return;
        firstDone = true;
        if (error) rejectFirst(error);
        else resolveFirst();
    }

    // ---------- Kết nối + tự kết nối lại ----------
    function scheduleRetry() {
        if (closed || status === 'auth') return;
        clearTimeout(retryTimer);
        const wait = retryDelay * (0.8 + Math.random() * 0.4); // lệch ngẫu nhiên: nhiều máy không dồn cùng lúc
        retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2);
        retryTimer = setTimeout(attempt, wait);
    }

    /** Thử lại NGAY (mở lại app, có mạng lại). */
    function retryNow() {
        if (closed || connected || status === 'auth' || !opened) return;
        retryDelay = RETRY_MIN_MS;
        clearTimeout(retryTimer);
        attempt();
    }

    async function attempt() {
        if (closed) return;
        clearTimeout(retryTimer);
        setStatus('connecting');

        let Paho;
        try {
            Paho = await loadPaho();
        } catch (e) {
            logError('Kết nối nhà', e);
            setStatus('offline');
            finishFirst(Object.assign(new Error(e.message), { network: true }));
            return scheduleRetry();
        }
        if (closed) return;

        // Bỏ client cũ (nếu còn) để không có 2 kết nối song song
        if (client) {
            const old = client;
            client = null;
            try { old.disconnect(); } catch (e) { /* đã ngắt rồi */ }
        }

        let c;
        try {
            c = new Paho.MQTT.Client(url, clientId);
        } catch (e) {
            logError('Địa chỉ máy chủ MQTT sai', e);
            setStatus('offline');
            finishFirst(Object.assign(new Error('Địa chỉ máy chủ không hợp lệ'), { network: true }));
            return;
        }
        client = c;

        c.onConnectionLost = resp => {
            if (client !== c) return;
            connected = false;
            clearTimeout(settleTimer);
            lostListeners.forEach(fn => safe(fn, 'Mất kết nối'));
            if (resp?.errorCode) logError('Mất kết nối tới nhà', resp.errorMessage || `mã ${resp.errorCode}`);
            setStatus('offline');
            scheduleRetry();
        };

        c.onMessageArrived = m => {
            if (client !== c) return;
            try {
                onMessage(m.destinationName, m.payloadString, m.retained);
            } catch (e) {
                logError(`Tin nhắn hỏng ở ${m.destinationName}`, e);
            }
        };

        try {
            c.connect({
                userName: auth.username,
                password: auth.password,
                useSSL: url.startsWith('wss://'),
                timeout: 10,
                keepAliveInterval: 30,
                cleanSession: true,
                mqttVersion: 4,
                onSuccess() {
                    if (client !== c) return;
                    connected = true;
                    retryDelay = RETRY_MIN_MS;
                    setStatus('online');
                    finishFirst();
                    if (handlers) subscribeAll();
                },
                onFailure(err) {
                    if (client !== c) return;
                    connected = false;
                    if (err?.errorCode === PAHO_AUTH_ERROR) {
                        logError('Đăng nhập nhà', 'Máy chủ từ chối tài khoản');
                        setStatus('auth');
                        finishFirst(Object.assign(new Error('Sai tài khoản hoặc mật khẩu'), { auth: true }));
                        return; // sai tài khoản: không thử lại
                    }
                    logError('Kết nối nhà', err?.errorMessage || 'không rõ lỗi');
                    setStatus('offline');
                    finishFirst(Object.assign(new Error('Không kết nối được tới máy chủ'), { network: true }));
                    scheduleRetry();
                }
            });
        } catch (e) {
            logError('Kết nối nhà', e);
            setStatus('offline');
            finishFirst(Object.assign(new Error(e.message), { network: true }));
            scheduleRetry();
        }
    }

    function subscribeAll() {
        const c = client;
        let left = APP_SUBSCRIPTIONS.length;
        const done = () => {
            if (--left > 0 || client !== c) return;
            // Tin "giữ lại" về ngay sau khi đăng ký: chờ chút cho về hết rồi mới báo "sẵn sàng"
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => readyListeners.forEach(fn => safe(fn, 'Đồng bộ')), DOCS_SETTLE_MS);
        };
        APP_SUBSCRIPTIONS.forEach(filter => {
            try {
                c.subscribe(filter, {
                    qos: 1,
                    onSuccess: done,
                    onFailure: e => {
                        logError(`Không nghe được kênh ${filter}`, e?.errorMessage || 'bị từ chối');
                        done();
                    }
                });
            } catch (e) {
                logError(`Không nghe được kênh ${filter}`, e);
                done();
            }
        });
    }

    function safe(fn, where) {
        try { fn(); } catch (e) { logError(where, e); }
    }

    /** Gửi 1 tin. Mất kết nối -> trả false (không xếp hàng). */
    function publish(topic, payload, { retained = false, qos = 1 } = {}) {
        if (!connected || !client) return false;
        try {
            const m = new window.Paho.MQTT.Message(payload);
            m.destinationName = topic;
            m.qos = qos;
            m.retained = retained;
            client.send(m);
            return true;
        } catch (e) {
            logError(`Gửi tới ${topic}`, e);
            return false;
        }
    }

    // ---------- Nhận tin ----------
    function onMessage(topic, payload, retained) {
        const t = parseTopic(topic);
        if (!t || !handlers) return;
        const data = decode(payload);
        if (data && isNewer(data) && !warnedNewer) {
            warnedNewer = true;
            logError('Giao thức', `Thiết bị dùng giao thức v${data.v}, mới hơn app - hãy cập nhật app`);
        }

        if (t.kind === 'dev') {
            if (!data) return;
            if (t.what === 'state') {
                const on = readOn(data);
                if (on !== null) handlers.onState(t.key, on);
            } else if (t.what === 'attrs') {
                const { v, ...attrs } = data;
                handlers.onAttrs(t.key, attrs);
            } else if (t.what === 'event' && !retained) {
                handlers.onEvent(t.key, { kind: data.kind, dir: data.dir });
            }
            return;
        }

        if (t.kind === 'node') {
            if (t.what === 'status') {
                const online = readOnline(data);
                if (online !== null) handlers.onNodeStatus?.(t.id, { online });
                else if (!data) handlers.onNodeStatus?.(t.id, { online: null }); // ESP đã bị xóa
            } else if (t.what === 'temp') {
                const v = readTemp(data);
                if (v === null) return;
                const ts = Number(data.ts);
                handlers.onTelemetry(t.id, [{ t: ts > 1e9 ? ts * 1000 : Date.now(), v }]);
            } else if (t.what === 'health' && data) {
                const { v, ...health } = data;
                handlers.onNodeStatus?.(t.id, { health: { ...health, at: Date.now() } });
            } else if (t.what === 'log' && data && !retained) {
                logError(`ESP ${t.id}`, data.msg ?? data.value ?? payload);
            }
            return;
        }

        if (t.kind === 'home') {
            docListeners.forEach(fn => {
                try { fn(t.name, data); } catch (e) { logError(`Đồng bộ "${t.name}"`, e); }
            });
        }
    }

    // ---------- Mở lại app / có mạng lại -> kết nối lại ngay ----------
    const onVisible = () => { if (!document.hidden) retryNow(); };
    const onOnline = () => retryNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    function open() {
        if (opened || closed) return;
        opened = true;
        attempt();
    }

    return {
        name: 'mqtt',
        user: auth.username,
        firstConnect,
        open,

        connect(h) {
            handlers = h;
            handlers.onStatus(status);
            open();
            if (connected) subscribeAll();
        },

        send(key, on) {
            return publish(topics.deviceSet(key), encode({ on: !!on }));
        },

        configure(key, patch) {
            return publish(topics.deviceCfg(key), encode(patch));
        },

        sync() { /* cấu hình mới được core/sync.js gửi đi */ },

        /** Kênh đồng bộ dữ liệu chung (core/sync.js dùng). */
        docs: {
            connected: () => connected,
            onDoc(fn) { docListeners.add(fn); return () => docListeners.delete(fn); },
            onReady(fn) { readyListeners.add(fn); return () => readyListeners.delete(fn); },
            onLost(fn) { lostListeners.add(fn); return () => lostListeners.delete(fn); },
            publishDoc: (name, obj) => publish(topics.doc(name), encode(obj), { retained: true }),
            /** Gửi bảng kênh cho 1 ESP; table = null để xóa (ESP đã bị xóa khỏi nhà). */
            publishNodeConfig: (id, table) => publish(topics.nodeConfig(id), table ? encode(table) : '', { retained: true })
        },

        /** Đăng xuất / đổi tài khoản: ngắt hẳn, không tự kết nối lại. */
        close() {
            closed = true;
            clearTimeout(retryTimer);
            clearTimeout(settleTimer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
            const c = client;
            client = null;
            connected = false;
            try { c?.disconnect(); } catch (e) { /* bỏ qua */ }
        }
    };
}
