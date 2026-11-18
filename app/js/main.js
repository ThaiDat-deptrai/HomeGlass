// =============================================================
// MAIN - điểm khởi động của app
// -------------------------------------------------------------
// Thứ tự:
//   1. Áp cài đặt giao diện (màu, nền, sáng/tối)
//   2. Đọc cấu hình nhà (bản chỉnh trên máy, hoặc file config/home.json)
//   3. Tạo transport (hiện là demo) + store trạng thái + kịch bản
//   4. Bật router để hiện màn hình
//
// Sơ đồ các lớp (chỉ gọi từ trên xuống, không gọi ngược):
//   ui/views  ->  core (store, scenes, settings, commands, homeData)  ->  transport
// =============================================================

import { parseHome, ConfigError } from './core/config.js';
import { fetchHomeFile, readLocal, writeLocal, clearLocal, downloadJson } from './core/homeData.js';
import { createStore } from './core/store.js';
import { createSettings } from './core/settings.js';
import { createScenes } from './core/scenes.js';
import { createSchedules, startDemoRunner, endActionsOf } from './core/schedules.js';
import { createDemoTransport } from './transport/demo.js';
import { createMqttTransport } from './transport/mqtt.js';
import { getAuth, clearAuth, getMode, setMode, setLoginNotice } from './core/auth.js';
import { createSync } from './core/sync.js';
import { showLogin } from './ui/views/login.js';
import { createRouter } from './ui/router.js';
import { toast } from './ui/toast.js';
import { enablePress, PRESSABLE } from './ui/press.js';
import { bindFeedback, enableTapSound } from './ui/feedback.js';
import { logError, captureGlobalErrors } from './core/errlog.js';
import { enableWheelSwitch, enableTouchSlide } from './ui/wheel.js';
import { html, render } from './ui/dom.js';

import * as homeView from './ui/views/home.js';
import * as temperatureView from './ui/views/temperature.js';
import * as scenesView from './ui/views/scenes.js';
import * as assistantView from './ui/views/assistant.js';
import * as settingsView from './ui/views/settings.js';
import * as manageView from './ui/views/manage.js';

const CONFIG_URL = '../config/home.json';

function showConfigError(app, problems) {
    render(app, html`
        <div class="card error-card">
            <h1><i class="fa-solid fa-triangle-exclamation"></i> Không mở được nhà</h1>
            <p>Cấu hình nhà có vấn đề:</p>
            <ul>${problems.map(p => html`<li>${p}</li>`)}</ul>
            <div class="crash__actions">
                <button class="btn-pill btn-primary" onclick="location.reload()"><i class="fa-solid fa-rotate-right"></i>Tải lại</button>
                <label class="btn-pill"><i class="fa-solid fa-file-import"></i>Khôi phục từ file sao lưu<input type="file" id="rescueFile" accept=".json,application/json" hidden /></label>
            </div>
        </div>`);
    // Cứu hộ: cấu hình hỏng nặng -> nạp lại từ file sao lưu rồi mở lại app
    app.querySelector('#rescueFile')?.addEventListener('change', async e => {
        try {
            const data = JSON.parse(await e.target.files[0].text());
            const home = data?.type === 'homeglass-backup' ? data.home : data;
            parseHome(home); // kiểm tra trước, sai thì báo lỗi
            writeLocal(home);
            location.reload();
        } catch (err) {
            toast(err.problems ? `File lỗi: ${err.problems[0]}` : 'File sao lưu không hợp lệ', 'error', 5000);
        }
    });
}

const LAST_FILE_KEY = 'hg.home.lastFile';

/**
 * Chọn cách kết nối:
 *   - đã đăng nhập  -> MQTT (vào thẳng app; mất mạng thì tự kết nối lại)
 *   - đã chọn demo  -> ngôi nhà ảo
 *   - chưa chọn     -> màn hình đăng nhập
 */
async function pickTransport(app, home) {
    const auth = getAuth();
    if (auth) return createMqttTransport(auth);
    if (getMode() === 'demo') return createDemoTransport(home);
    document.documentElement.classList.add('is-login');
    const transport = await showLogin(app, { createDemo: () => createDemoTransport(home) });
    document.documentElement.classList.remove('is-login');
    return transport;
}

/** Thông báo giống nhau dồn dập (vd bấm kịch bản 6 đèn lúc mất mạng) -> chỉ hiện 1 lần. */
const lastToast = new Map();
function toastOnce(id, text, kind = 'error', ms = 3000) {
    const now = Date.now();
    if (now - (lastToast.get(id) || 0) < ms) return;
    lastToast.set(id, now);
    toast(text, kind);
}

async function start() {
    const app = document.getElementById('app');
    captureGlobalErrors();

    const settings = createSettings();
    settings.apply();

    // ----- Đọc cấu hình: ưu tiên bản đã chỉnh trong app -----
    // Mất mạng / GitHub lỗi -> dùng bản file gốc đã nhớ từ lần trước, app vẫn mở được.
    let fileData = null;
    try {
        fileData = await fetchHomeFile(CONFIG_URL);
        try { localStorage.setItem(LAST_FILE_KEY, JSON.stringify(fileData)); } catch (e) { /* bỏ qua */ }
    } catch (e) {
        logError('Tải config/home.json', e);
        try { fileData = JSON.parse(localStorage.getItem(LAST_FILE_KEY)); } catch (err) { fileData = null; }
    }

    let source = 'file';
    let home;
    const local = readLocal();
    if (local) {
        try {
            home = parseHome(local);
            source = 'local';
        } catch (e) {
            logError('Bản chỉnh trên máy bị hỏng', e);
            clearLocal(); // bản chỉnh bị hỏng: quay về file gốc
            toast('Bản chỉnh trên máy bị lỗi, đã dùng lại file gốc', 'error');
        }
    }
    if (!home) {
        if (!fileData) return showConfigError(app, ['Không tải được file cấu hình và trên máy chưa có bản nào. Kiểm tra mạng rồi tải lại.']);
        try {
            home = parseHome(fileData);
        } catch (e) {
            logError('File cấu hình gốc bị lỗi', e);
            return showConfigError(app, e instanceof ConfigError ? e.problems : [e.message]);
        }
    }

    const transport = await pickTransport(app, home);
    const startedAt = Date.now();
    const store = createStore(home, transport);
    const scenes = createScenes(home);
    scenes.watch(store); // kịch bản đang bật sẽ tự "tắt" khi thiết bị bị đổi khác đi
    const schedules = createSchedules(home.raw.location);

    // Bản demo: app tự chạy lịch hẹn khi đang mở (bản thật: ESP trung tâm chạy)
    if (transport.name === 'demo') {
        startDemoRunner(schedules, (sceneId) => {
            const scene = scenes.get(sceneId);
            if (!scene) return;
            store.setMany(scene.actions);
            scenes.activate(scene.id);
            toast(`⏰ Đã chạy "${scene.name}" theo lịch hẹn`, 'success', 4000);
        }, (sceneId) => {
            const scene = scenes.get(sceneId);
            if (!scene) return;
            store.setMany(endActionsOf(scene));
            toast(`⏰ Hết giờ "${scene.name}": đã tắt lại`, 'success', 4000);
        });
    }

    // Đang gõ phím trên điện thoại: ẩn thanh dưới để bàn phím không đẩy nó che mất ô nhập
    const TYPING = 'input[type="text"], input[type="number"], input[type="search"], textarea, select';
    document.addEventListener('focusin', e => {
        if (e.target.matches?.(TYPING)) document.documentElement.classList.add('is-typing');
    });
    document.addEventListener('focusout', e => {
        if (e.target.matches?.(TYPING)) document.documentElement.classList.remove('is-typing');
    });

    // Báo lỗi điều khiển bằng lời dễ hiểu
    store.subscribe(event => {
        const device = event.key ? ctx.home.devices.get(event.key) : null;
        if (event.type === 'timeout' && device) {
            const node = ctx.home.nodes.get(device.node);
            const nodeDown = node && store.node(node.id)?.online === false;
            toast(nodeDown ? `${device.name} không phản hồi: ${node.name} đang mất kết nối` : `${device.name} không phản hồi`, 'error', 4000);
        }
        if (event.type === 'offline') {
            toastOnce('offline', store.status() === 'connecting' ? 'Đang kết nối tới nhà, thử lại sau giây lát…' : 'Chưa kết nối được tới nhà. App đang tự kết nối lại…');
        }
        if (event.type === 'unassigned' && device) {
            toastOnce('unassigned:' + device.key, `${device.name} chưa gán ESP / kênh (Cài đặt → Phòng & thiết bị)`, 'error', 2000);
        }
        // Tài khoản bị đổi mật khẩu / bị xóa trên HiveMQ -> đăng nhập lại
        if (event.type === 'status' && event.status === 'auth') {
            transport.close?.();
            clearAuth();
            setMode(null);
            setLoginNotice('Tài khoản hoặc mật khẩu không còn đúng. Đăng nhập lại nhé.');
            location.reload();
        }
    });

    function applyHome(next) {
        ctx.home = next;
        store.syncHome(next);
        scenes.syncHome(next);
        router.refresh();
    }

    const ctx = {
        home,
        store,
        scenes,
        schedules,
        settings,
        toast,
        homeSource: () => source,

        /**
         * Lưu cấu hình mới (từ màn hình Quản lý thiết bị).
         * Ném ConfigError nếu dữ liệu sai -> màn hình tự báo lỗi.
         */
        saveHome(data) {
            const next = parseHome(data);
            writeLocal(data);
            source = 'local';
            applyHome(next);
            sync?.configChanged(); // gửi cho các điện thoại khác + ESP
        },
        /** Bỏ mọi chỉnh sửa, dùng lại file config/home.json. */
        resetHome() {
            if (!fileData) throw new Error('Chưa tải được file gốc (mất mạng?)');
            clearLocal();
            source = 'file';
            applyHome(parseHome(fileData));
            sync?.configChanged();
        },

        /** Đăng xuất (bản thật) hoặc rời bản demo -> về màn hình đăng nhập. */
        logout() {
            transport.close?.();
            clearAuth();
            setMode(null);
            location.reload();
        },
        exportHome: () => downloadJson(ctx.home.raw),

        /** Sao lưu TOÀN BỘ: cấu hình nhà + kịch bản tự tạo + lịch hẹn giờ, trong 1 file. */
        exportBackup() {
            const d = new Date();
            const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            downloadJson({
                type: 'homeglass-backup',
                version: 1,
                exportedAt: d.toISOString(),
                home: ctx.home.raw,
                scenes: scenes.exportCustom(),
                schedules: schedules.list()
            }, `homeglass-sao-luu-${stamp}.json`);
        },

        /**
         * Khôi phục từ file: nhận cả file sao lưu toàn bộ lẫn file home.json thường.
         * Ném lỗi nếu file sai (màn hình tự báo).
         */
        importBackup(obj) {
            const isBackup = obj && obj.type === 'homeglass-backup';
            ctx.saveHome(isBackup ? obj.home : obj);
            if (isBackup) {
                scenes.importCustom(obj.scenes);
                schedules.importAll(obj.schedules);
            }
            return isBackup ? 'full' : 'home';
        }
    };

    // ----- Đồng bộ giữa các điện thoại + gửi bảng kênh xuống ESP (chỉ bản thật) -----
    const REMOTE_TEXT = {
        config: 'Cấu hình nhà vừa được cập nhật',
        scenes: 'Kịch bản vừa được cập nhật',
        schedules: 'Lịch hẹn giờ vừa được cập nhật'
    };
    const sync = transport.docs ? createSync({
        docs: transport.docs,
        scenes,
        schedules,
        by: transport.user || '',
        app: {
            home: () => ctx.home,
            /** Cấu hình từ máy khác: kiểm tra kỹ, sai thì ném lỗi (sync bỏ qua, giữ bản đang dùng). */
            applyRemoteHome(data) {
                const next = parseHome(data);
                writeLocal(data);
                source = 'local';
                applyHome(next);
            }
        },
        onRemote(name, by) {
            if (Date.now() - startedAt < 5000) return; // lúc mới mở app: lặng lẽ lấy bản mới nhất
            toast(`${REMOTE_TEXT[name]}${by ? ` (bởi ${by})` : ''}`, 'success', 3500);
        }
    }) : null;

    const router = createRouter({
        root: app,
        tabbar: document.getElementById('tabbar'),
        ctx,
        tabs: ['/', '/temperature', '/scenes', '/assistant', '/settings'],
        routes: {
            '/': { mount: homeView.mount },
            '/temperature': { mount: temperatureView.mount },
            '/scenes': { mount: scenesView.mount },
            '/assistant': { mount: assistantView.mount },
            '/settings': { mount: settingsView.mount },
            '/manage': { mount: manageView.mount, parent: '/settings' }
        }
    });

    enablePress(); // chạm vào khối nào cũng lún xuống + nảy lên như iPhone
    bindFeedback(settings);
    enableTapSound(PRESSABLE); // mọi nút đều kêu "tách" (nếu bật trong Cài đặt)
    enableWheelSwitch(); // máy tính: lăn chuột trên thanh chọn / menu trái để đổi mục
    enableTouchSlide();  // điện thoại: lướt ngón tay dọc thanh chọn / thanh tab để đổi mục

    // Vẽ xong khung hình đầu tiên rồi mới bật hiệu ứng chuyển động
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('is-ready')));
}

start().catch(e => {
    // Lỗi nặng lúc mở app: ghi lại và hiện thẻ báo lỗi thay vì màn hình trắng
    logError('Khởi động app', e);
    showConfigError(document.getElementById('app'), [`Lỗi khi mở app: ${e?.message || e}`]);
});
