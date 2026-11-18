#include "schedules.h"

#include <ArduinoJson.h>
#include <math.h>
#include <time.h>

static SchedTime parseTime(JsonVariantConst v) {
    SchedTime t;
    const char *kind = v["kind"] | "time";
    t.kind = !strcmp(kind, "sunset") ? 1 : !strcmp(kind, "sunrise") ? 2 : 0;
    const char *hm = v["time"] | "00:00";
    int h = 0, m = 0;
    sscanf(hm, "%d:%d", &h, &m);
    t.minutes = constrain(h, 0, 23) * 60 + constrain(m, 0, 59);
    t.offset = v["offset"] | 0;
    return t;
}

static void parseActions(JsonArrayConst arr, std::vector<SchedAction> &out) {
    out.clear();
    for (JsonObjectConst a : arr) {
        const char *k = a["k"] | "";
        if (*k) out.push_back({String(k), a["on"] | false});
    }
}

bool Schedules::load(const char *json, size_t len) {
    if (!json || !len) {
        list_.clear();
        return true;
    }
    JsonDocument doc;
    if (deserializeJson(doc, json, len)) return false;
    JsonArrayConst arr = doc["list"];
    if (arr.isNull()) return false;

    std::vector<Schedule> next;
    for (JsonObjectConst s : arr) {
        Schedule sc;
        sc.id = (const char *)(s["id"] | "");
        sc.enabled = s["enabled"] | true;
        sc.days = 0;
        for (JsonVariantConst d : s["days"].as<JsonArrayConst>()) {
            int v = d.as<int>();
            if (v >= 0 && v <= 6) sc.days |= (1 << v);
        }
        sc.start = parseTime(s);
        sc.hasEnd = !s["end"].isNull();
        if (sc.hasEnd) sc.end = parseTime(s["end"]);
        parseActions(s["actions"], sc.actions);
        parseActions(s["endActions"], sc.endActions);
        if (sc.id.length()) next.push_back(sc);
    }
    list_ = next;
    if (!doc["location"].isNull()) {
        lat_ = doc["location"]["lat"] | 16.0f;
        lon_ = doc["location"]["lon"] | 106.0f;
    }
    tzMin_ = doc["tz"] | 420;
    return true;
}

// Giống hệt app/js/core/sun.js
int Schedules::minutesOf(const SchedTime &t, int yday) const {
    if (t.kind == 0) return t.minutes;
    const double RAD = M_PI / 180.0;
    double g = (2 * M_PI / 365.0) * (yday - 1);
    double eqtime = 229.18 * (0.000075 + 0.001868 * cos(g) - 0.032077 * sin(g)
        - 0.014615 * cos(2 * g) - 0.040849 * sin(2 * g));
    double decl = 0.006918 - 0.399912 * cos(g) + 0.070257 * sin(g) - 0.006758 * cos(2 * g)
        + 0.000907 * sin(2 * g) - 0.002697 * cos(3 * g) + 0.00148 * sin(3 * g);
    double x = cos(90.833 * RAD) / (cos(lat_ * RAD) * cos(decl)) - tan(lat_ * RAD) * tan(decl);
    double ha = acos(fmax(-1.0, fmin(1.0, x))) / RAD;
    double tzHours = tzMin_ / 60.0;
    double m = t.kind == 1
        ? 720 - 4 * (lon_ - ha) - eqtime + tzHours * 60   // lặn
        : 720 - 4 * (lon_ + ha) - eqtime + tzHours * 60;  // mọc
    return (int)lround(m) + t.offset;
}

bool Schedules::alreadyFired(const String &key, uint32_t mark) {
    for (auto &f : fired_) {
        if (f.key == key) {
            if (f.mark == mark) return true;
            f.mark = mark;
            return false;
        }
    }
    fired_.push_back({key, mark});
    return false;
}

void Schedules::loop(uint32_t epoch, RunFn run) {
    if (!epoch || list_.empty()) return;
    time_t local = (time_t)epoch + tzMin_ * 60;
    struct tm now, yest;
    gmtime_r(&local, &now);
    time_t y = local - 86400;
    gmtime_r(&y, &yest);
    int minuteNow = now.tm_hour * 60 + now.tm_min;
    uint32_t dayNum = (uint32_t)(local / 86400);

    for (const Schedule &s : list_) {
        if (!s.enabled) continue;
        auto due = [&](int at, const String &key, const std::vector<SchedAction> &acts) {
            // Đến giờ (cho trễ tối đa 2 phút, phòng khi vừa khởi động lại) và hôm nay chưa chạy
            if (minuteNow >= at && minuteNow - at <= 2 && !alreadyFired(key, dayNum * 1440 + at)) {
                for (const auto &a : acts) run(a.key, a.on);
            }
        };
        bool today = s.days & (1 << now.tm_wday);
        int startToday = minutesOf(s.start, now.tm_yday + 1);
        if (today) due(startToday, s.id, s.actions);

        if (s.hasEnd) {
            // Giờ tắt hôm nay thuộc lần bật hôm nay (cùng ngày) hoặc lần bật hôm qua (qua đêm)
            int endToday = minutesOf(s.end, now.tm_yday + 1);
            bool sameDay = today && endToday > startToday;
            bool yesterdayOn = s.days & (1 << yest.tm_wday);
            bool overnight = yesterdayOn && minutesOf(s.end, yest.tm_yday + 1) <= minutesOf(s.start, yest.tm_yday + 1);
            if (sameDay || overnight) due(endToday, s.id + ":end", s.endActions);
        }
    }
}
