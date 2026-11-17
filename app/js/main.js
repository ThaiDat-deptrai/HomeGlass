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
import { createSchedules, startDemoRunner } from './core/schedules.js';
import { createDemoTransport } from './transport/demo.js';
import { createRouter } from './ui/router.js';
import { toast } from './ui/toast.js';
import { enablePress } from './ui/press.js';
import { enableWheelSwitch } from './ui/wheel.js';
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
        </div>`);
}

async function start() {
    const app = document.getElementById('app');

    const settings = createSettings();
    settings.apply();

    // ----- Đọc cấu hình: ưu tiên bản đã chỉnh trong app -----
    let fileData;
    try {
        fileData = await fetchHomeFile(CONFIG_URL);
    } catch (e) {
        return showConfigError(app, [e.message]);
    }

    let source = 'file';
    let home;
    const local = readLocal();
    if (local) {
        try {
            home = parseHome(local);
            source = 'local';
        } catch (e) {
            clearLocal(); // bản chỉnh bị hỏng: quay về file gốc
            toast('Bản chỉnh trên máy bị lỗi, đã dùng lại file gốc', 'error');
        }
    }
    if (!home) {
        try {
            home = parseHome(fileData);
        } catch (e) {
            return showConfigError(app, e instanceof ConfigError ? e.problems : [e.message]);
        }
    }

    const transport = createDemoTransport(home);
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

    // Thiết bị không xác nhận trong thời gian cho phép
    store.subscribe(event => {
        if (event.type === 'timeout') {
            const device = ctx.home.devices.get(event.key);
            if (device) toast(`${device.name} không phản hồi`, 'error');
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
        },
        /** Bỏ mọi chỉnh sửa, dùng lại file config/home.json. */
        resetHome() {
            clearLocal();
            source = 'file';
            applyHome(parseHome(fileData));
        },
        exportHome: () => downloadJson(ctx.home.raw)
    };

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
    enableWheelSwitch(); // máy tính: lăn chuột trên thanh chọn / menu trái để đổi mục

    // Vẽ xong khung hình đầu tiên rồi mới bật hiệu ứng chuyển động
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('is-ready')));
}

start();
