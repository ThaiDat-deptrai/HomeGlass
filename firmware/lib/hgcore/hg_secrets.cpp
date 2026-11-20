#include "hg_secrets.h"

#include <Preferences.h>

// Bản công khai (cập nhật qua mạng) KHÔNG được chứa secrets.h
#if !defined(HG_PUBLIC_BUILD) && __has_include("secrets.h")
#include "secrets.h"
#define HG_HAS_SECRETS 1
#endif

namespace hg {

static void putIfChanged(Preferences &p, const char *key, const char *value) {
    if (p.getString(key, "") != value) p.putString(key, value);
}

bool secretsBuiltIn() {
#ifdef HG_HAS_SECRETS
    return true;
#else
    return false;
#endif
}

bool loadSecrets(Secrets &s) {
    Preferences p;
    p.begin("hgsec", false);
#ifdef HG_HAS_SECRETS
    putIfChanged(p, "key", HG_NET_KEY);
#ifdef HG_ROLE_MASTER
    // Chỉ ESP trung tâm cần WiFi + MQTT: ESP phòng không giữ mật khẩu WiFi (lỡ mất 1 mạch cũng không lộ)
    putIfChanged(p, "ssid", HG_WIFI_SSID);
    putIfChanged(p, "pass", HG_WIFI_PASS);
    putIfChanged(p, "ssid2", HG_WIFI_SSID2);
    putIfChanged(p, "pass2", HG_WIFI_PASS2);
    putIfChanged(p, "host", HG_MQTT_HOST);
    putIfChanged(p, "user", HG_MQTT_USER);
    putIfChanged(p, "mpass", HG_MQTT_PASS);
    if (p.getUShort("port", 0) != HG_MQTT_PORT) p.putUShort("port", HG_MQTT_PORT);
#endif
#endif
    s.netKey = p.getString("key", "");
    s.wifiSsid = p.getString("ssid", "");
    s.wifiPass = p.getString("pass", "");
    s.wifiSsid2 = p.getString("ssid2", "");
    s.wifiPass2 = p.getString("pass2", "");
    s.mqttHost = p.getString("host", "");
    s.mqttUser = p.getString("user", "");
    s.mqttPass = p.getString("mpass", "");
    s.mqttPort = p.getUShort("port", 8883);
    p.end();
    return s.netKey.length() == 64;
}

}  // namespace hg
