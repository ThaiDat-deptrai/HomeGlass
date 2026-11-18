// =============================================================
// SYNC - đồng bộ dữ liệu chung giữa các điện thoại và ESP trung tâm
// -------------------------------------------------------------
// 3 "tài liệu chung", mỗi cái nằm ở 1 kênh "giữ lại" trên MQTT:
//   hg/home/config     cấu hình nhà (phòng, thiết bị, ESP, kênh, góc servo)
//   hg/home/scenes     kịch bản tự tạo
//   hg/home/schedules  lịch hẹn giờ (kèm sẵn danh sách lệnh để ESP trung tâm chạy)
// Kèm theo: hg/node/<số>/config = bảng kênh gọn cho từng ESP.
//
// Quy tắc: mỗi tài liệu có số "rev" (thời điểm sửa). Bản nào rev lớn hơn thì thắng.
//   - Sửa trên điện thoại A -> rev mới -> gửi lên -> điện thoại B nhận và dùng luôn.
//   - Máy mới đăng nhập lần đầu (rev = 0) -> lấy bản trên máy chủ.
//   - Máy chủ chưa có gì -> máy đầu tiên gửi bản của mình lên (rev = 1,
//     để bất kỳ lần sửa thật nào sau này cũng thắng nó).
// Dữ liệu nhận về bị hỏng -> bỏ qua + ghi nhật ký, giữ nguyên bản đang chạy.
// =============================================================

import { DOCS, buildNodeConfigs } from './protocol.js';
import { logError } from './errlog.js';

const REV_KEY = 'hg.sync.revs';
const NODES_KEY = 'hg.sync.nodes';

const load = (storage, key, fallback) => {
    try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
};
const store = (storage, key, value) => {
    try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* bỏ qua */ }
};

/**
 * docs:      transport.docs (kênh đồng bộ)
 * app:       { home(), applyRemoteHome(data) }  cấu hình hiện tại + cách áp bản nhận về
 * scenes, schedules: các bộ quản lý kịch bản / lịch
 * by:        tên người sửa (hiện cho máy khác biết)
 */
export function createSync({ docs, app, scenes, schedules, by = '', storage = localStorage, onRemote }) {
    const revs = { config: 0, scenes: 0, schedules: 0, ...load(storage, REV_KEY, {}) };
    const remote = {};       // rev đang có trên máy chủ
    const lastSent = {};     // nội dung đã gửi (để không gửi lại khi không đổi gì)
    let publishedNodes = load(storage, NODES_KEY, []);
    let ready = false;       // đã nhận xong các tin "giữ lại" lúc mới kết nối chưa
    let waiting = [];        // tài liệu nhận trước khi sẵn sàng (áp theo đúng thứ tự)
    let applying = false;    // đang áp bản nhận về -> không coi là "mình vừa sửa"

    const saveRevs = () => store(storage, REV_KEY, revs);

    // ----- Đóng gói từng tài liệu -----
    const content = {
        config: () => ({ data: app.home().raw }),
        scenes: () => ({ list: scenes.exportCustom() }),
        schedules: () => {
            const home = app.home();
            return {
                location: home.raw.location || null,
                tz: -new Date().getTimezoneOffset(), // phút lệch giờ so với UTC (Việt Nam: 420)
                list: schedules.list().map(s => {
                    const actions = scenes.get(s.sceneId)?.actions || [];
                    return {
                        ...s,
                        // ESP trung tâm không cần biết kịch bản: gửi luôn danh sách lệnh cần chạy
                        actions: actions.map(a => ({ k: a.key, on: !!a.on })),
                        // Đến giờ tắt: tắt lại những gì kịch bản đã bật
                        endActions: s.end ? actions.filter(a => a.on).map(a => ({ k: a.key, on: false })) : []
                    };
                })
            };
        }
    };

    function publishNodeConfigs(rev) {
        const tables = buildNodeConfigs(app.home(), rev);
        tables.forEach((table, id) => docs.publishNodeConfig(id, table));
        // ESP đã bị xóa khỏi nhà: xóa bảng cũ trên máy chủ
        publishedNodes.filter(id => !tables.has(id)).forEach(id => docs.publishNodeConfig(id, null));
        publishedNodes = [...tables.keys()];
        store(storage, NODES_KEY, publishedNodes);
    }

    function publish(name) {
        if (!docs.connected()) return false;
        const body = content[name]();
        const ok = docs.publishDoc(name, { rev: revs[name], by, ...body });
        if (!ok) return false;
        remote[name] = revs[name];
        lastSent[name] = JSON.stringify(body);
        if (name === 'config') publishNodeConfigs(revs[name]);
        return true;
    }

    /** Trên máy này vừa sửa gì đó. */
    function localChanged(name) {
        if (applying) return;
        const body = JSON.stringify(content[name]());
        if (body === lastSent[name]) return; // không đổi gì thật (vd chỉ bấm chạy kịch bản)
        revs[name] = Math.max(Date.now(), (revs[name] || 0) + 1);
        saveRevs();
        if (ready) publish(name);
        // Lịch gửi kèm lệnh của kịch bản -> kịch bản / cấu hình đổi thì lịch cũng phải gửi lại
        if (name !== 'schedules') localChanged('schedules');
    }

    function apply(name, doc) {
        const rev = Number(doc?.rev) || 0;
        if (rev <= (revs[name] || 0)) return;
        applying = true;
        try {
            if (name === 'config') app.applyRemoteHome(doc.data);
            if (name === 'scenes') scenes.importCustom(doc.list);
            if (name === 'schedules') schedules.importAll((doc.list || []).map(({ actions, endActions, ...s }) => s));
            revs[name] = rev;
            saveRevs();
            lastSent[name] = JSON.stringify(content[name]());
            onRemote?.(name, doc.by);
        } catch (e) {
            logError(`Nhận "${name}" từ máy khác (bỏ qua, giữ bản đang dùng)`, e);
        } finally {
            applying = false;
        }
    }

    docs.onDoc((name, doc) => {
        if (!DOCS.includes(name)) return;
        remote[name] = doc ? Number(doc.rev) || 0 : undefined;
        if (!doc) return;
        if (ready) apply(name, doc);
        else waiting.push([name, doc]);
    });

    // Kết nối xong (cả lần đầu và mỗi lần kết nối lại)
    docs.onReady(() => {
        // Áp theo thứ tự: cấu hình trước (kịch bản/lịch cần biết thiết bị nào còn)
        const got = new Map(waiting);
        waiting = [];
        DOCS.forEach(name => { if (got.has(name)) apply(name, got.get(name)); });
        ready = true;
        // Máy chủ chưa có / đang giữ bản cũ hơn máy này -> gửi bản của máy này lên
        DOCS.forEach(name => {
            if (remote[name] === undefined || remote[name] < (revs[name] || 0)) {
                if (!revs[name]) { revs[name] = 1; saveRevs(); }
                publish(name);
            }
        });
    });

    // Mất kết nối: lần kết nối lại sẽ nhận lại các tin "giữ lại" -> xếp hàng áp đúng thứ tự như lần đầu
    docs.onLost(() => { ready = false; });

    // Bản đang có trên máy này coi như "đã gửi" -> chỉ gửi khi thật sự sửa
    DOCS.forEach(name => { lastSent[name] = JSON.stringify(content[name]()); });

    scenes.onChange(() => localChanged('scenes'));
    schedules.onChange(() => localChanged('schedules'));

    return {
        /** Gọi sau khi cấu hình nhà được sửa trên máy này. */
        configChanged: () => localChanged('config'),
        revs: () => ({ ...revs })
    };
}
