// =============================================================
// MÀN HÌNH TRỢ LÝ - ra lệnh bằng giọng nói hoặc gõ chữ
// -------------------------------------------------------------
// Phần "hiểu câu lệnh" nằm ở core/commands.js.
// File này chỉ lo: micro, khung trò chuyện, đọc câu trả lời.
// =============================================================

import { html, render, $ } from '../dom.js';
import { interpret } from '../../core/commands.js';

const LANG = 'vi-VN';

export function mount(root, ctx) {
    const { home, store, settings } = ctx;

    // Gợi ý lấy từ cấu hình nhà thật
    const names = [...home.rooms.values()].map(r => r.name);
    const uniqueRoom = [...home.rooms.values()].find(r => names.filter(n => n === r.name).length === 1 && r.devices.length);
    const lastFloor = home.floors[home.floors.length - 1];
    const suggestions = [
        'Tắt hết đèn',
        uniqueRoom && `Bật đèn ${uniqueRoom.name.toLowerCase()}`,
        `Tắt đèn ${lastFloor.name.toLowerCase()}`,
        'Đi ngủ',
        'Có bao nhiêu đèn đang bật?'
    ].filter(Boolean);

    render(root, html`
        <header class="page-head">
            <h1>Trợ lý</h1>
            <p>Nói hoặc gõ lệnh để điều khiển nhà</p>
        </header>

        <section class="assistant">
            <div class="chat" id="chat">
                <div class="bubble bubble--bot">Chào bạn! Bạn muốn bật hay tắt đèn nào?</div>
            </div>

            <button class="orb" id="mic" aria-label="Nhấn để nói">
                <span class="orb__ring"></span><span class="orb__ring"></span>
                <i class="fa-solid fa-microphone"></i>
            </button>
            <p class="assistant__hint" id="hint">Nhấn để nói</p>

            <div class="chips" id="suggest">
                ${suggestions.map(s => html`<button class="chip" data-say="${s}">${s}</button>`)}
            </div>

            <form class="ask card" id="ask">
                <input type="text" id="askInput" placeholder="Hoặc gõ lệnh ở đây…" autocomplete="off" />
                <button type="submit" aria-label="Gửi"><i class="fa-solid fa-paper-plane"></i></button>
            </form>
        </section>
    `);

    const chat = $('#chat', root);
    const mic = $('#mic', root);
    const hint = $('#hint', root);

    function addBubble(text, who) {
        const el = document.createElement('div');
        el.className = `bubble bubble--${who}`;
        el.textContent = text;
        chat.appendChild(el);
        while (chat.children.length > 8) chat.firstElementChild.remove();
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function speak(text) {
        if (!settings.get().voice || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = LANG;
        u.rate = 1;
        window.speechSynthesis.speak(u);
    }

    function handle(text) {
        addBubble(text, 'me');
        const result = interpret(text, ctx);
        if (result.actions) store.setMany(result.actions);
        if (result.scene) ctx.scenes.activate(result.scene.id);
        addBubble(result.reply, 'bot');
        speak(result.reply);
    }

    // ---------- Gõ chữ / bấm gợi ý ----------
    $('#ask', root).addEventListener('submit', e => {
        e.preventDefault();
        const input = $('#askInput', root);
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        handle(text);
    });

    $('#suggest', root).addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (chip) handle(chip.dataset.say);
    });

    // ---------- Giọng nói ----------
    // Nói xong, IM LẶNG khoảng 1,5 giây là app tự gửi lệnh (không phải bấm lại nút).
    const SILENCE_MS = 1500;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let listening = false;
    let heard = '';       // câu đang nghe được (chưa chốt)
    let sent = false;     // câu này đã gửi chưa (để không gửi 2 lần)
    let silenceTimer = null;

    // Hướng dẫn cho quyền micro "nhớ luôn", không phải hỏi lại mỗi lần mở app
    const PERMISSION_HELP = 'Chưa được dùng micro. Bấm biểu tượng ổ khóa cạnh địa chỉ web → Quyền → Micro → chọn "Cho phép" (đừng chọn "Chỉ lần này") để lần sau không hỏi lại.';

    function send() {
        clearTimeout(silenceTimer);
        if (sent) return;
        const text = heard.trim();
        if (!text) return;
        sent = true;
        hint.textContent = 'Nhấn để nói';
        try { recognition.stop(); } catch (e) { /* đã dừng */ }
        handle(text);
    }

    if (!SpeechRecognition) {
        mic.disabled = true;
        hint.textContent = 'Trình duyệt này chưa hỗ trợ nghe giọng nói. Bạn gõ lệnh nhé.';
    } else {
        recognition = new SpeechRecognition();
        recognition.lang = LANG;
        recognition.interimResults = true;
        // continuous = false: Android hay bị lặp chữ ở chế độ nghe liên tục. Tự gửi do đồng hồ im lặng bên dưới lo.
        recognition.continuous = false;

        recognition.onstart = () => {
            listening = true;
            heard = '';
            sent = false;
            mic.classList.add('is-listening');
            hint.textContent = 'Đang nghe… (ngừng nói là tự gửi)';
        };
        recognition.onend = () => {
            listening = false;
            mic.classList.remove('is-listening');
            send(); // trình duyệt tự dừng mà còn câu chưa gửi -> gửi luôn
            if (hint.textContent.startsWith('Đang nghe') || hint.textContent.startsWith('"')) hint.textContent = 'Nhấn để nói';
        };
        recognition.onerror = e => {
            const messages = {
                'not-allowed': PERMISSION_HELP,
                'service-not-allowed': PERMISSION_HELP,
                'no-speech': 'Không nghe thấy gì. Nhấn để thử lại.',
                'audio-capture': 'Không tìm thấy micro.',
                network: 'Lỗi mạng khi nhận giọng nói.',
                aborted: 'Nhấn để nói'
            };
            hint.textContent = messages[e.error] || 'Có lỗi khi nghe. Nhấn để thử lại.';
        };
        recognition.onresult = e => {
            if (sent) return;
            // Ghép cả câu từ đầu (continuous: có thể nhiều đoạn)
            heard = [...e.results].map(r => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
            hint.textContent = `"${heard}"`;
            clearTimeout(silenceTimer);
            if (e.results[e.results.length - 1].isFinal) return send(); // trình duyệt đã chốt câu: gửi ngay
            silenceTimer = setTimeout(send, SILENCE_MS);               // chưa chốt mà im lặng 1,5 giây: tự gửi
        };

        mic.addEventListener('click', () => {
            try {
                if (listening) send();
                else recognition.start();
            } catch (e) {
                hint.textContent = 'Không bắt đầu nghe được. Thử lại nhé.';
            }
        });

        // Biết trước quyền micro đang bị chặn -> hướng dẫn luôn, khỏi bấm thử
        navigator.permissions?.query({ name: 'microphone' }).then(p => {
            const show = () => { if (p.state === 'denied') hint.textContent = PERMISSION_HELP; };
            show();
            p.onchange = show;
        }).catch(() => { /* trình duyệt không hỗ trợ hỏi quyền: bỏ qua */ });
    }

    return () => {
        clearTimeout(silenceTimer);
        try { recognition?.abort(); } catch (e) { /* bỏ qua */ }
        window.speechSynthesis?.cancel();
    };
}
