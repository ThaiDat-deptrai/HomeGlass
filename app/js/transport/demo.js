// =============================================================
// TRANSPORT GIẢ LẬP (DEMO)
// -------------------------------------------------------------
// Đóng vai "ngôi nhà ảo": nhận lệnh, chờ một chút rồi xác nhận,
// giống hệt cách ESP thật sẽ trả lời. Dùng để làm và thử giao diện
// khi chưa có phần cứng.
//
// Mọi transport đều có đúng 3 thứ:
//   name                       tên hiển thị
//   connect({onState,onStatus}) bắt đầu, báo trạng thái về store
//   send(key, on)              gửi yêu cầu bật/tắt 1 thiết bị
// Sau này transport/mqtt.js cũng chỉ cần đúng 3 thứ này.
// =============================================================

const STORAGE_KEY = 'hg.demo.states';

// Vài đèn bật sẵn để màn hình trông "có người ở"
const DEFAULT_ON = ['t1-phong-khach/den-to', 't2-phong-ngu-2/den-ngu', 't2-phong-tho/den-tho'];

export function createDemoTransport(home) {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) { /* bỏ qua */ }

    const states = {};
    home.allDevices.forEach(d => {
        states[d.key] = saved && d.key in saved ? !!saved[d.key] : DEFAULT_ON.includes(d.key);
    });

    const persist = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
        } catch (e) { /* bỏ qua */ }
    };

    let handlers = null;

    return {
        name: 'demo',

        connect(h) {
            handlers = h;
            handlers.onStatus('demo');
            Object.entries(states).forEach(([key, on]) => handlers.onState(key, on));
        },

        send(key, on) {
            // Giả lập độ trễ mạng + relay đóng: 150–400 ms
            setTimeout(() => {
                states[key] = on;
                persist();
                handlers.onState(key, on);
            }, 150 + Math.random() * 250);
        }
    };
}
