# =============================================================
# PHÁT HÀNH FIRMWARE - tạo file cập nhật qua mạng cho app
# -------------------------------------------------------------
# 1. Build bản CÔNG KHAI (master_ota, node_ota): KHÔNG chứa secrets.h.
# 2. Kiểm tra: trong file .bin không được có mật khẩu WiFi / MQTT / khóa mạng.
#    Có -> DỪNG, không ghi gì (an toàn trước, tiện sau).
# 3. Chép vào firmware/bin/ + ghi manifest.json (phiên bản, dung lượng, SHA-256).
# Sau đó commit + push: app thấy "Có bản mới" và cập nhật được từng ESP.
#
# Chạy:  powershell -ExecutionPolicy Bypass -File tools\phat-hanh-firmware.ps1
# =============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$fw = Join-Path $root 'firmware'
$out = Join-Path $fw 'bin'
$pio = Join-Path $env:USERPROFILE '.platformio\penv\Scripts\pio.exe'

# ----- Phiên bản: đọc từ hg_config.h -----
$cfg = Get-Content (Join-Path $fw 'include\hg_config.h') -Raw
if ($cfg -notmatch '#define HG_FW_VERSION "([^"]+)"') { throw 'Không đọc được HG_FW_VERSION trong hg_config.h' }
$ver = $Matches[1]
Write-Host "Phiên bản firmware: $ver"

# ----- Build -----
Push-Location $fw
try {
    & $pio run -e master_ota -e node_ota
    if ($LASTEXITCODE -ne 0) { throw 'Build lỗi' }
} finally { Pop-Location }

# ----- Các chuỗi bí mật cần chắc chắn KHÔNG có trong file -----
$secrets = @()
$secretFile = Join-Path $fw 'include\secrets.h'
if (Test-Path $secretFile) {
    foreach ($line in Get-Content $secretFile -Encoding UTF8) {
        if ($line -match '^\s*#define\s+(HG_\w+)\s+"([^"]*)"') {
            $name = $Matches[1]; $value = $Matches[2]
            if ($value.Trim().Length -ge 6 -and $name -ne 'HG_MQTT_PORT') { $secrets += @{ name = $name; value = $value } }
        }
    }
} else {
    Write-Warning 'Không thấy secrets.h: bỏ qua bước kiểm tra lộ mật khẩu'
}
$latin1 = [Text.Encoding]::GetEncoding(28591)

function Test-Leak($binPath) {
    $text = $latin1.GetString([IO.File]::ReadAllBytes($binPath))
    foreach ($s in $secrets) {
        $needle = $latin1.GetString([Text.Encoding]::UTF8.GetBytes($s.value))
        if ($text.Contains($needle)) { throw "DỪNG: file $binPath chứa $($s.name) - không được công khai!" }
        $trimmed = $s.value.Trim()
        if ($trimmed -ne $s.value -and $trimmed.Length -ge 6 -and $text.Contains($latin1.GetString([Text.Encoding]::UTF8.GetBytes($trimmed)))) {
            throw "DỪNG: file $binPath chứa $($s.name) - không được công khai!"
        }
    }
}

$kinds = @(
    @{ kind = 'master'; env = 'master_ota'; chip = 'ESP32-S3' },
    @{ kind = 'node'; env = 'node_ota'; chip = 'ESP32-C3' }
)
foreach ($k in $kinds) {
    $bin = Join-Path $fw ".pio\build\$($k.env)\firmware.bin"
    Test-Leak $bin
    $k.bin = $bin
}
Write-Host 'Kiểm tra lộ mật khẩu: không có (an toàn)'

# ----- Chép file + ghi danh sách -----
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out -Filter '*.bin' | Remove-Item -Force   # chỉ giữ bản mới nhất (bản cũ vẫn còn trong lịch sử git)
$manifest = [ordered]@{ v = 1; built = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
foreach ($k in $kinds) {
    $name = "$($k.kind)-$ver.bin"
    $dest = Join-Path $out $name
    Copy-Item $k.bin $dest
    $hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
    $size = (Get-Item $dest).Length
    $manifest[$k.kind] = [ordered]@{ ver = $ver; file = $name; size = $size; sha256 = $hash; chip = $k.chip }
    Write-Host ("{0,-7} {1}  {2:N0} byte  sha256 {3}" -f $k.kind, $name, $size, $hash)
}
$json = $manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $out 'manifest.json'), $json + "`n", (New-Object Text.UTF8Encoding $false))
Write-Host "Đã ghi firmware/bin/manifest.json. Commit + push để app thấy bản $ver."
