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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let listening = false;

    if (!SpeechRecognition) {
        mic.disabled = true;
        hint.textContent = 'Trình duyệt này chưa hỗ trợ nghe giọng nói. Bạn gõ lệnh nhé.';
    } else {
        recognition = new SpeechRecognition();
        recognition.lang = LANG;
        recognition.interimResults = true;

        recognition.onstart = () => {
            listening = true;
            mic.classList.add('is-listening');
            hint.textContent = 'Đang nghe…';
        };
        recognition.onend = () => {
            listening = false;
            mic.classList.remove('is-listening');
            if (hint.textContent === 'Đang nghe…') hint.textContent = 'Nhấn để nói';
        };
        recognition.onerror = e => {
            const messages = {
                'not-allowed': 'Chưa được cấp quyền micro.',
                'no-speech': 'Không nghe thấy gì. Nhấn để thử lại.',
                'audio-capture': 'Không tìm thấy micro.',
                network: 'Lỗi mạng khi nhận giọng nói.'
            };
            hint.textContent = messages[e.error] || 'Có lỗi khi nghe. Nhấn để thử lại.';
        };
        recognition.onresult = e => {
            const last = e.results[e.results.length - 1];
            const text = last[0].transcript.trim();
            if (last.isFinal) {
                hint.textContent = 'Nhấn để nói';
                if (text) handle(text);
            } else {
                hint.textContent = `"${text}"`;
            }
        };

        mic.addEventListener('click', () => {
            try {
                if (listening) recognition.stop();
                else recognition.start();
            } catch (e) {
                hint.textContent = 'Không bắt đầu nghe được. Thử lại nhé.';
            }
        });
    }

    return () => {
        try { recognition?.abort(); } catch (e) { /* bỏ qua */ }
        window.speechSynthesis?.cancel();
    };
}
