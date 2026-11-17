// =============================================================
// TRANSITION - chuyển trang kiểu iOS (chồng lớp + thị sai)
// -------------------------------------------------------------
//   Đi tới (tab sau): trang MỚI trượt từ phải vào, ĐÈ lên trang cũ (có bóng đổ);
//                     trang cũ chỉ lùi chậm ~30% và tối dần.
//   Quay lại:         trang HIỆN TẠI trượt sang phải, lộ trang trước ở bên dưới
//                     (trang dưới tiến ra từ chỗ lùi, sáng dần).
//
// Cách làm: trong lúc chuyển, mỗi trang nằm trên một "tấm" toàn màn hình có nền
// giống hệt nền app (để trang trên che được trang dưới). Chỉ đổi transform/opacity
// -> card đồ họa tự xử lý, không bắt trình duyệt sắp xếp lại bố cục.
// =============================================================

const PARALLAX = 0.3; // trang dưới chỉ dịch 30% quãng đường
const DIM = 0.3;      // trang dưới tối tối đa 30%

function makeStage(view, scrollY) {
    const bg = document.getElementById('bg');
    const stage = document.createElement('div');
    stage.className = `${bg.className} stage`;
    const image = bg.style.getPropertyValue('--bg-image');
    if (image) stage.style.setProperty('--bg-image', image);

    const inner = document.createElement('div');
    inner.className = 'app stage__app';
    inner.style.transform = `translateY(${-scrollY}px)`;
    inner.appendChild(view);
    stage.appendChild(inner);
    document.body.appendChild(stage);
    view.classList.add('is-moving'); // tạm tắt kính mờ cho nhẹ
    return stage;
}

/**
 * Bắt đầu chuyển từ fromView (đang hiện) sang toView (trang mới, đang trống).
 * dir = +1 đi tới, -1 quay lại. Trả về { set(p), done(keepTo) } với p: 0 -> 1.
 */
export function beginTransition(fromView, toView, dir) {
    const scrollY = window.scrollY;
    const fromStage = makeStage(fromView, scrollY);
    const toStage = makeStage(toView, 0);
    (dir > 0 ? toStage : fromStage).classList.add('stage--top');
    (dir > 0 ? fromStage : toStage).classList.add('stage--under');
    const W = window.innerWidth;

    function set(p) {
        const q = Math.max(0, Math.min(1, p));
        if (dir > 0) {
            toStage.style.transform = `translate3d(${W * (1 - q)}px, 0, 0)`;
            fromStage.style.transform = `translate3d(${-PARALLAX * W * q}px, 0, 0)`;
            fromStage.style.setProperty('--dim', String(DIM * q));
        } else {
            fromStage.style.transform = `translate3d(${W * q}px, 0, 0)`;
            toStage.style.transform = `translate3d(${-PARALLAX * W * (1 - q)}px, 0, 0)`;
            toStage.style.setProperty('--dim', String(DIM * (1 - q)));
        }
    }
    set(0);

    return {
        set,
        scrollY,
        /** Dọn các tấm, trả trang về cho router (router tự gắn trang nào vào #app). */
        done() {
            fromView.classList.remove('is-moving');
            toView.classList.remove('is-moving');
            fromStage.remove();
            toStage.remove();
        }
    };
}
