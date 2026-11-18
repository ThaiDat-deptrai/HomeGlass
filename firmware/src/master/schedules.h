// =============================================================
// SCHEDULES - ESP trung tâm tự chạy lịch hẹn giờ (tắt điện thoại vẫn chạy)
// -------------------------------------------------------------
// Nhận danh sách lịch từ kênh hg/home/schedules (app gửi kèm sẵn lệnh cần chạy),
// lưu vào flash -> mất Internet vẫn chạy đúng giờ (đã lấy giờ chuẩn thì ESP tự đếm tiếp).
// Mất điện bật lại: cần có Internet để lấy lại giờ (gắn thêm DS3231 thì khỏi cần - bước sau).
// Giờ mặt trời mọc / lặn tính y hệt app (core/sun.js, công thức NOAA).
// =============================================================
#pragma once
#include <Arduino.h>
#include <vector>

struct SchedAction { String key; bool on; };

struct SchedTime {
    uint8_t kind = 0;   // 0 = giờ cố định, 1 = mặt trời lặn, 2 = mặt trời mọc
    int16_t minutes = 0; // giờ cố định: phút trong ngày
    int16_t offset = 0;  // mặt trời: lệch bao nhiêu phút
};

struct Schedule {
    String id;
    bool enabled = true;
    uint8_t days = 0x7F;  // bit 0 = Chủ nhật ... bit 6 = Thứ 7
    SchedTime start;
    bool hasEnd = false;
    SchedTime end;
    std::vector<SchedAction> actions, endActions;
};

typedef void (*RunFn)(const String &key, bool on);

class Schedules {
public:
    /** Đọc JSON từ app. Sai định dạng -> giữ nguyên lịch cũ, trả về false. */
    bool load(const char *json, size_t len);
    /** Gọi mỗi vài giây. epoch = giờ chuẩn (0 = chưa có giờ -> không chạy). */
    void loop(uint32_t epoch, RunFn run);
    size_t size() const { return list_.size(); }

    /** Phút trong ngày của 1 mốc giờ (cho ngày có "day of year" = yday, 1..366). */
    int minutesOf(const SchedTime &t, int yday) const;

private:
    std::vector<Schedule> list_;
    float lat_ = 16, lon_ = 106;   // giữa Việt Nam (giống app)
    int tzMin_ = 420;              // GMT+7
    struct Fired { String key; uint32_t mark; };
    std::vector<Fired> fired_;
    bool alreadyFired(const String &key, uint32_t mark);
};
