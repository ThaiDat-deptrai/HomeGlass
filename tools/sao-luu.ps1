# =============================================================
# SAO LUU HomeGlass vao mot thu muc tren may (phong khi GitHub gap su co)
# -------------------------------------------------------------
# Tao ra (mac dinh canh thu muc HomeGlass):
#   HomeGlass-SaoLuu\
#     ban-moi-nhat\   code moi nhat, mo ra xem duoc ngay
#     lich-su\        moi lan commit = 1 file .bundle chua TOAN BO lich su git
#     DOC-TRUOC.txt   cach khoi phuc
# Cach khoi phuc: xem docs/sao-luu.md
#
# Chay tay:            powershell -ExecutionPolicy Bypass -File tools\sao-luu.ps1
# Tu dong moi commit:  powershell -ExecutionPolicy Bypass -File tools\sao-luu.ps1 -Install
# (File nay chi dung chu khong dau de PowerShell 5 doc dung tren moi may.)
# =============================================================
param(
    [string]$Dest = '',
    [int]$Keep = 40,
    [switch]$Install,
    [switch]$Quiet
)

# 'Continue': git ghi tien do ra stderr, PowerShell 5 se tuong la loi neu de 'Stop'.
# Thay vao do kiem tra $LASTEXITCODE sau moi lenh git quan trong.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Dest) { $Dest = Join-Path (Split-Path -Parent $repo) 'HomeGlass-SaoLuu' }

function Say($text) { if (-not $Quiet) { Write-Host $text } }

# ----- Cai tu dong: sao luu sau moi lan commit -----
if ($Install) {
    $hook = Join-Path $repo '.git\hooks\post-commit'
    $body = "#!/bin/sh`n# Tu dong sao luu HomeGlass sau moi commit (tools/sao-luu.ps1)`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/sao-luu.ps1 -Quiet || true`n"
    [System.IO.File]::WriteAllText($hook, $body, (New-Object System.Text.UTF8Encoding($false)))
    Say "Da cai: tu dong sao luu vao '$Dest' sau moi lan commit."
}

# ----- Thong tin ban hien tai -----
$commit = (git -C $repo rev-parse --short HEAD).Trim()
$ver = '?'
$m = Select-String -Path (Join-Path $repo 'app\index.html') -Pattern "HG_VERSION = '([^']+)'" | Select-Object -First 1
if ($m) { $ver = $m.Matches[0].Groups[1].Value }

$history = Join-Path $Dest 'lich-su'
New-Item -ItemType Directory -Force -Path $history | Out-Null

# ----- 1. Toan bo lich su git (1 file) -----
$existing = Get-ChildItem -Path $history -Filter "*_$commit.bundle" -ErrorAction SilentlyContinue
if ($existing) {
    Say "Ban $commit da duoc sao luu truoc do, bo qua lich su."
} else {
    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
    $bundle = Join-Path $history "HomeGlass_v$($ver)_$($stamp)_$commit.bundle"
    git -C $repo bundle create "$bundle" --all --quiet
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $bundle)) { throw "Khong tao duoc file lich su $bundle" }
    git -C $repo bundle verify --quiet "$bundle"
    if ($LASTEXITCODE -ne 0) { throw "File lich su bi loi: $bundle" }
    Say "Lich su: $bundle"
}

# ----- 2. Ban code moi nhat (mo ra xem duoc ngay) -----
$latest = Join-Path $Dest 'ban-moi-nhat'
$zip = Join-Path $Dest 'tam.zip'
git -C $repo archive --format=zip -o "$zip" HEAD
if ($LASTEXITCODE -ne 0) { throw 'Khong tao duoc ban code moi nhat' }
if (Test-Path $latest) { Remove-Item -Recurse -Force -LiteralPath $latest -ErrorAction Stop }
Expand-Archive -Path $zip -DestinationPath $latest -ErrorAction Stop
Remove-Item -Force -LiteralPath $zip
Say "Ban moi nhat: $latest"

# ----- 3. Chi giu $Keep ban lich su gan nhat (moi ban chi vai tram KB) -----
Get-ChildItem -Path $history -Filter '*.bundle' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep | Remove-Item -Force

# ----- 4. Huong dan -----
$guide = @"
SAO LUU HOMEGLASS
Ban moi nhat: v$ver (commit $commit), luc $(Get-Date -Format 'dd/MM/yyyy HH:mm')

- ban-moi-nhat\  : code moi nhat, mo ra xem / chay duoc ngay.
- lich-su\       : moi file .bundle chua TOAN BO lich su git tai thoi diem do.

KHOI PHUC khi GitHub mat / xoa nham:
  git clone "duong-dan\lich-su\<file moi nhat>.bundle" HomeGlass
Chi tiet: ban-moi-nhat\docs\sao-luu.md

Luu y: mat khau WiFi/MQTT (secrets.h) KHONG co o day (khong bao gio dua vao git).
Hay tu cat file secrets.h o mot cho rieng. Thinh thoang chep ca thu muc nay ra USB / Google Drive.
"@
Set-Content -Path (Join-Path $Dest 'DOC-TRUOC.txt') -Value $guide -Encoding ASCII

$dirty = git -C $repo status --porcelain
if ($dirty) { Say "Chu y: con thay doi CHUA commit, chung chua duoc sao luu." }
Say "Xong. Thu muc sao luu: $Dest"
