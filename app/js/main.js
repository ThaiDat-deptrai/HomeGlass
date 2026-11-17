// =============================================================
// MAIN - điểm khởi động của app
// -------------------------------------------------------------
// Thứ tự:
//   1. Áp cài đặt giao diện (màu, nền, sáng/tối)
//   2. Đọc cấu hình nhà (config/home.json)
//   3. Tạo transport (hiện là demo) + store trạng thái
//   4. Bật router để hiện màn hình
//
// Sơ đồ các lớp (chỉ gọi từ trên xuống, không gọi ngược):
//   ui/views  ->  core (store, scenes, settings, commands)  ->  transport
// =============================================================

import { loadHome, ConfigError } from './core/config.js';
import { createStore } from './core/store.js';
import { createSettings } from './core/settings.js';
import { createScenes } from './core/scenes.js';
import { createDemoTransport } from './transport/demo.js';
import { createRouter } from './ui/router.js';
import { toast } from './ui/toast.js';
import { html, render } from './ui/dom.js';

import * as homeView from './ui/views/home.js';
import * as scenesView from './ui/views/scenes.js';
import * as assistantView from './ui/views/assistant.js';
import * as settingsView from './ui/views/settings.js';

const CONFIG_URL = '../config/home.json';

async function start() {
    const app = document.getElementById('app');
    const settings = createSettings();
    settings.apply();

    let home;
    try {
        home = await loadHome(CONFIG_URL);
    } catch (e) {
        const problems = e instanceof ConfigError ? e.problems : [e.message];
        render(app, html`
            <div class="card error-card">
                <h1><i class="fa-solid fa-triangle-exclamation"></i> Không mở được nhà</h1>
                <p>File <code>config/home.json</code> có vấn đề:</p>
                <ul>${problems.map(p => html`<li>${p}</li>`)}</ul>
            </div>`);
        return;
    }

    const transport = createDemoTransport(home);
    const store = createStore(home, transport);
    const scenes = createScenes(home);

    // Thiết bị không xác nhận trong thời gian cho phép
    store.subscribe(event => {
        if (event.type === 'timeout') {
            const device = home.devices.get(event.key);
            toast(`${device.name} không phản hồi`, 'error');
        }
    });

    createRouter({
        root: app,
        tabbar: document.getElementById('tabbar'),
        ctx: { home, store, scenes, settings, toast },
        routes: {
            '/': { tab: 'home', mount: homeView.mount },
            '/scenes': { tab: 'scenes', mount: scenesView.mount },
            '/assistant': { tab: 'assistant', mount: assistantView.mount },
            '/settings': { tab: 'settings', mount: settingsView.mount }
        }
    });
}

start();
