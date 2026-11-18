// =============================================================
// MÁY CHỦ MQTT GIẢ (chạy trong trình duyệt, không cần mạng)
// -------------------------------------------------------------
// Bắt chước đúng thứ Paho làm, đủ để test phần lõi:
//   đăng nhập (sai mật khẩu -> mã lỗi 6), tin "giữ lại", ký tự + và #,
//   "di chúc" (LWT) khi rớt mạng, rớt mạng / máy chủ sập.
// =============================================================

export function createFakeBroker({ users = {} } = {}) {
    const retained = new Map();
    const clients = new Set();
    let down = false;

    function match(filter, topic) {
        const f = filter.split('/');
        const t = topic.split('/');
        for (let i = 0; i < f.length; i++) {
            if (f[i] === '#') return true;
            if (i >= t.length) return false;
            if (f[i] !== '+' && f[i] !== t[i]) return false;
        }
        return f.length === t.length;
    }

    function route(topic, payload, retain) {
        if (retain) {
            if (payload === '') retained.delete(topic);
            else retained.set(topic, payload);
        }
        clients.forEach(c => { if (c.subs.some(f => match(f, topic))) c._deliver(topic, payload, false); });
    }

    class Message {
        constructor(payload) {
            this.payloadString = payload;
            this.destinationName = '';
            this.qos = 0;
            this.retained = false;
        }
    }

    class Client {
        constructor(uri, clientId) {
            this.uri = uri;
            this.clientId = clientId;
            this.subs = [];
            this.connected = false;
        }

        connect(opts) {
            setTimeout(() => {
                if (down) return opts.onFailure?.({ errorCode: 7, errorMessage: 'AMQJS0007E Socket error' });
                if (!(opts.userName in users) || users[opts.userName] !== opts.password) {
                    return opts.onFailure?.({ errorCode: 6, errorMessage: 'AMQJS0006E Bad Connack return code:5 Connection Refused: not authorized.' });
                }
                this.connected = true;
                this.subs = [];
                this.will = opts.willMessage || null;
                clients.add(this);
                opts.onSuccess?.();
            }, 5);
        }

        subscribe(filter, opts) {
            if (!this.connected) throw new Error('AMQJS0011E Invalid state not connected.');
            this.subs.push(filter);
            setTimeout(() => {
                opts?.onSuccess?.();
                retained.forEach((payload, topic) => { if (match(filter, topic)) this._deliver(topic, payload, true); });
            }, 2);
        }

        send(message) {
            if (!this.connected) throw new Error('AMQJS0011E Invalid state not connected.');
            const { destinationName, payloadString, retained: r } = message;
            setTimeout(() => route(destinationName, payloadString, r), 1);
        }

        /** Ngắt đàng hoàng: KHÔNG gửi di chúc. */
        disconnect() {
            this.connected = false;
            clients.delete(this);
        }

        _deliver(topic, payload, isRetained) {
            setTimeout(() => {
                if (this.connected) this.onMessageArrived?.({ destinationName: topic, payloadString: payload, retained: isRetained });
            }, 1);
        }

        /** Rớt mạng bất ngờ: máy chủ gửi di chúc của client này. */
        _drop() {
            if (!this.connected) return;
            this.connected = false;
            clients.delete(this);
            if (this.will) route(this.will.destinationName, this.will.payloadString, this.will.retained);
            setTimeout(() => this.onConnectionLost?.({ errorCode: 8, errorMessage: 'AMQJS0008I Socket closed.' }), 1);
        }
    }

    return {
        Paho: { MQTT: { Client, Message } },
        retained,
        clients,
        /** Gửi 1 tin như một máy khác. */
        publish: (topic, payload, retain = false) => route(topic, payload, retain),
        /** Máy chủ sập: rớt hết, không cho kết nối lại. */
        setDown(value) {
            down = value;
            if (value) [...clients].forEach(c => c._drop());
        }
    };
}
