<#
  Auto_Sambung_WLAN_NON_CORP.ps1 - "Watchdog" WLAN-NON-CORP.

  Dijalankan otomatis oleh Scheduled Task (dipasang lewat
  Pasang_AutoSambung_WLAN_NON_CORP.ps1 / tab "Jaringan 3 Koneksi" di ZeenIQ Dev
  Tools) tiap kali Wi-Fi putus / tersambung / login Windows. Tugasnya:

    1. Bila Wi-Fi tidak tersambung ke WLAN-NON-CORP tapi SSID itu terlihat
       -> sambungkan lagi (netsh wlan connect). Default hanya saat Wi-Fi PUTUS;
       dengan -PaksaPindah juga pindah dari SSID lain.
    2. Begitu tersambung & dapat gateway -> pasang ulang split routing 3 koneksi
       (setup_3_koneksi.ps1 -NoConnect) - rute non-persisten hilang tiap Wi-Fi
       putus, jadi harus dipasang ulang.
    3. Cek captive portal ISE (Cisco). Sesi ISE diikat ke MAC Wi-Fi (MAC
       randomization profil WLAN-NON-CORP memang Disabled), jadi setelah
       sambung ulang biasanya TIDAK perlu provisioning lagi -> diam. Hanya bila
       sesi ISE sudah habis, portal dibuka lewat Wi-Fi (Buka_Portal_ISE_via_WLAN.ps1
       -HanyaJikaCaptive) supaya tinggal klik di browser.

  Idempoten & hemat: kalau rute sudah benar untuk gateway yang sama dan baru
  dipasang < 2 menit lalu, langkah 2 dilewati. Satu instance saja yang jalan
  (mutex) karena event Wi-Fi sering datang beruntun.

  Status run terakhir ditulis JSON ke -StatusFile (dibaca tab app), log teks
  ke -LogFile. Jalankan sebagai Administrator (Scheduled Task RunLevel Highest).

  Pemakaian:
    Auto_Sambung_WLAN_NON_CORP.ps1 [-PaksaPindah] [-TungguDtk 30] [-LogFile x] [-StatusFile y] [-Alasan "event"]
#>
param(
    [switch]$PaksaPindah,
    [int]$TungguDtk = 30,
    [string]$LogFile = "$PSScriptRoot\Auto_Sambung_WLAN_NON_CORP.log",
    [string]$StatusFile = "$PSScriptRoot\Auto_Sambung_WLAN_NON_CORP.status.json",
    [string]$Alasan = 'manual'
)

$ErrorActionPreference = 'Continue'
$SsidNonCorp = 'WLAN-NON-CORP'
$SetupScript = Join-Path $PSScriptRoot 'setup_3_koneksi.ps1'
$IseScript   = Join-Path $PSScriptRoot 'Buka_Portal_ISE_via_WLAN.ps1'
$Mulai       = Get-Date

# ---------------------------------------------------------------- log & status
foreach ($p in @($LogFile, $StatusFile)) {
    $d = Split-Path $p -Parent
    if ($d -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
# Log dipangkas kalau > 1 MB biar tidak membengkak (tiap event Wi-Fi nulis).
if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) {
    Get-Content $LogFile -Tail 400 | Set-Content $LogFile -Encoding UTF8
}
function Log([string]$Msg, [string]$Color = 'Gray') {
    $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Msg
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}
$script:Status = [ordered]@{
    WaktuMulai  = $Mulai.ToString('o')
    WaktuSelesai= $null
    Alasan      = $Alasan
    Hasil       = 'BERJALAN'      # OK | LEWAT | GAGAL | BERJALAN
    Pesan       = ''
    Ssid        = $null
    Gateway     = $null
    Disambungkan= $false
    RuteDipasang= $false
    Captive     = $null           # $true/$false/$null (tidak dicek)
}
function Selesai([string]$Hasil, [string]$Pesan, [string]$Color = 'Gray') {
    $script:Status.Hasil = $Hasil
    $script:Status.Pesan = $Pesan
    $script:Status.WaktuSelesai = (Get-Date).ToString('o')
    Log "[$Hasil] $Pesan" $Color
    try { $script:Status | ConvertTo-Json -Depth 3 | Set-Content -Path $StatusFile -Encoding UTF8 } catch {}
    if ($script:Mutex) { try { $script:Mutex.ReleaseMutex() } catch {}; $script:Mutex.Dispose() }
}

# ---------------------------------------------------------------- satu instance
$script:Mutex = New-Object System.Threading.Mutex($false, 'Global\ZeenIQ-AutoSambung-WLAN-NON-CORP')
if (-not $script:Mutex.WaitOne(0)) {
    Log "Instance lain masih berjalan, keluar. (pemicu: $Alasan)" 'DarkGray'
    $script:Mutex.Dispose(); $script:Mutex = $null
    exit 0
}
Log "==== Auto-sambung $SsidNonCorp (pemicu: $Alasan; paksa pindah: $PaksaPindah) ====" 'Cyan'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Selesai 'GAGAL' 'Harus dijalankan sebagai Administrator (task RunLevel Highest).' 'Red'; exit 1 }

# ---------------------------------------------------------------- 0. omni (aTrust) aktif?
# Kalau omni/aTrust sedang tersambung JANGAN sentuh Wi-Fi. Sangfor memutus Wi-Fi
# tiap tunnel aktif ("disconnected by the driver") DAN mencegat semua TCP ke 10.x
# apa pun tabel rutenya, jadi menyambung ulang cuma bikin Wi-Fi putus-nyambung
# tanpa guna (akar masalah 2026-11-17). Diam sampai user memutus omni dari tray.
# Dev/DB lewat WLAN-NON-CORP hanya mungkin saat omni OFF -> tombol "Mode Dev/DB".
$atrustUp = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'aTrust|Sangfor' -or $_.Name -match 'aTrust|Sangfor')
} | Select-Object -First 1
if ($atrustUp) {
    Selesai 'LEWAT' "omni (aTrust) sedang aktif - auto-sambung WLAN-NON-CORP ditahan (Sangfor memutus Wi-Fi & mencegat 10.x selama omni nyala). Putus omni dari ikon aTrust untuk memakai Dev/DB lewat Wi-Fi." 'Yellow'
    exit 0
}

# ---------------------------------------------------------------- fungsi bantu
# Bisa ada 2 Wi-Fi (bawaan laptop + dongle USB untuk Internet). SSID dibaca PER adapter.
function Get-WlanSsids {
    $map = @{}; $name = $null
    foreach ($l in (netsh wlan show interfaces 2>$null)) {
        if ($l -match '^\s*Name\s*:\s*(.+)$') { $name = $Matches[1].Trim() }
        elseif ($name -and $l -match '^\s*SSID\s*:\s*(.+)$') { $map[$name] = $Matches[1].Trim() }
    }
    return $map
}
function Get-WifiAll {
    @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object {
        $_.Status -notin 'Disabled', 'Not Present' -and ($_.InterfaceDescription -match 'Wireless|Wi-Fi|802\.11|WiFi|WLAN' -or $_.Name -match '^Wi-Fi|WLAN')
    })
}
# adapter Wi-Fi yang masih bebas (tidak tersambung ke SSID mana pun), utamakan Wi-Fi bawaan (bukan USB)
function Get-WifiBebas {
    $s = Get-WlanSsids
    Get-WifiAll | Where-Object { -not $s.ContainsKey($_.Name) } |
        Sort-Object @{ Expression = { $_.InterfaceDescription -match 'USB' } } | Select-Object -First 1
}
# WLAN-NON-CORP bila ada adapter yang tersambung ke sana; $null bila masih ada Wi-Fi bebas
# (dongle yang dipakai Internet tidak dihitung sebagai "Wi-Fi di SSID lain"); selain itu SSID lain.
function Get-CurrentSsid {
    $s = Get-WlanSsids
    if ($s.Values -contains $SsidNonCorp) { return $SsidNonCorp }
    if (Get-WifiBebas) { return $null }
    return ($s.Values | Select-Object -First 1)
}
function Get-WifiAdapter {
    $s = Get-WlanSsids
    $up = @(Get-WifiAll | Where-Object Status -eq 'Up')
    $nc = $up | Where-Object { $s[$_.Name] -eq $SsidNonCorp } | Select-Object -First 1
    if ($nc) { return $nc }
    return ($up | Select-Object -First 1)
}
function Get-WifiGateway {
    $w = Get-WifiAdapter
    if (-not $w) { return $null }
    (Get-NetRoute -InterfaceIndex $w.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric | Select-Object -First 1).NextHop
}
function Get-WifiIp {
    $w = Get-WifiAdapter
    if (-not $w) { return $null }
    (Get-NetIPAddress -InterfaceIndex $w.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
}
function Test-SsidTerlihat {
    # Daftar scan bisa basi sesaat setelah putus -> coba beberapa kali.
    for ($i = 0; $i -lt 4; $i++) {
        $nets = netsh wlan show networks 2>$null
        if ($nets -match "^\s*SSID \d+\s*:\s*$([regex]::Escape($SsidNonCorp))\s*$") { return $true }
        Start-Sleep -Seconds 4
    }
    return $false
}
function Wait-WifiSiap([int]$Detik) {
    $t = Get-Date
    do {
        $ssid = Get-CurrentSsid
        $gw = $null
        if ($ssid -eq $SsidNonCorp) { $gw = Get-WifiGateway }
        if ($gw) { return $gw }
        Start-Sleep -Seconds 2
    } until (((Get-Date) - $t).TotalSeconds -gt $Detik)
    return $null
}

# ---------------------------------------------------------------- 1. sambung
$wifiAda = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object {
    $_.InterfaceDescription -match 'Wireless|Wi-Fi|802\.11|WiFi|WLAN' -or $_.Name -match '^Wi-Fi|WLAN'
}
if (-not $wifiAda) { Selesai 'LEWAT' 'Tidak ada adapter Wi-Fi di komputer ini.' 'Yellow'; exit 0 }
if ($wifiAda | Where-Object Status -eq 'Disabled') {
    Selesai 'LEWAT' 'Adapter Wi-Fi dalam keadaan Disabled - tidak disentuh.' 'Yellow'; exit 0
}

$ssid = Get-CurrentSsid
$script:Status.Ssid = $ssid
if ($ssid -eq $SsidNonCorp) {
    Log "Wi-Fi sudah tersambung ke $SsidNonCorp." 'Green'
} else {
    if ($ssid -and -not $PaksaPindah) {
        Selesai 'LEWAT' "Wi-Fi tersambung ke SSID lain ($ssid) - dibiarkan (aktifkan 'paksa pindah' bila mau selalu ke $SsidNonCorp)." 'Yellow'
        exit 0
    }
    Log "Wi-Fi $(if ($ssid) { "di SSID lain ($ssid)" } else { 'tidak tersambung' }) - cari $SsidNonCorp..." 'Yellow'
    if (-not (Test-SsidTerlihat)) {
        Selesai 'LEWAT' "$SsidNonCorp tidak terlihat (di luar kantor?) - tidak ada yang dilakukan." 'Yellow'
        exit 0
    }
    Log "$SsidNonCorp terlihat, menyambungkan (maks $TungguDtk dtk)..." 'Cyan'
    $bebas = Get-WifiBebas
    $out = if ($bebas) { netsh wlan connect name="$SsidNonCorp" interface="$($bebas.Name)" 2>&1 } else { netsh wlan connect name="$SsidNonCorp" 2>&1 }
    Log "  netsh: $(($out -join ' ').Trim())" 'DarkGray'
    $gw = Wait-WifiSiap $TungguDtk
    $ssid = Get-CurrentSsid
    $script:Status.Ssid = $ssid
    if (-not $gw) {
        Selesai 'GAGAL' "Gagal tersambung ke $SsidNonCorp dalam $TungguDtk dtk (SSID sekarang: $(if ($ssid) { $ssid } else { '-' }))." 'Red'
        exit 2
    }
    $script:Status.Disambungkan = $true
    Log "Tersambung ke $SsidNonCorp, gateway $gw." 'Green'
}

# ---------------------------------------------------------------- 2. rute
$gw = Wait-WifiSiap $TungguDtk
if (-not $gw) { Selesai 'GAGAL' "Tersambung ke $SsidNonCorp tapi belum dapat gateway DHCP dalam $TungguDtk dtk." 'Red'; exit 3 }
$script:Status.Gateway = $gw
$wifi = Get-WifiAdapter

# Rute sudah benar? (rute /16 utama via gateway Wi-Fi sekarang) + baru saja dipasang -> lewati.
$ruteAda = [bool](Get-NetRoute -DestinationPrefix '10.239.0.0/16' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                  Where-Object { $_.NextHop -eq $gw -and $_.InterfaceIndex -eq $wifi.InterfaceIndex })
$baruSaja = $false
if ((Test-Path $StatusFile)) {
    try {
        $prev = Get-Content $StatusFile -Raw | ConvertFrom-Json
        if ($prev.RuteDipasang -and $prev.Gateway -eq $gw -and $prev.WaktuSelesai) {
            $baruSaja = ((Get-Date) - [datetime]$prev.WaktuSelesai).TotalMinutes -lt 2
        }
    } catch {}
}
if ($ruteAda -and $baruSaja) {
    Log "Rute Dev/DB via $gw sudah terpasang < 2 menit lalu - lewati setup." 'DarkGray'
    $script:Status.RuteDipasang = $true
} else {
    if (-not (Test-Path $SetupScript)) { Selesai 'GAGAL' "setup_3_koneksi.ps1 tidak ditemukan di $PSScriptRoot" 'Red'; exit 4 }
    Log "Memasang ulang split routing (setup_3_koneksi.ps1 -NoConnect)..." 'Cyan'
    $outSetup = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript -NoConnect 2>&1
    $outSetup | ForEach-Object { Add-Content -Path $LogFile -Value ("    " + $_) -Encoding UTF8 }
    $ruteAda = [bool](Get-NetRoute -DestinationPrefix '10.239.0.0/16' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                      Where-Object { $_.NextHop -eq $gw })
    $script:Status.RuteDipasang = $ruteAda
    if ($ruteAda) { Log "Rute Dev/DB via $gw terpasang." 'Green' }
    else { Log "Rute 10.239.0.0/16 via $gw TIDAK terlihat setelah setup - cek log setup di atas." 'Red' }
}

# ---------------------------------------------------------------- 3. ISE (Cisco)
$wifiIp = Get-WifiIp
$captive = $null
if ($wifiIp) {
    $probe = & curl.exe -s -m 8 --interface $wifiIp -o NUL -D - http://detectportal.firefox.com/success.txt 2>$null
    $captive = [bool](($probe -join "`n") -match 'Location:.*corp\.bi\.go\.id')
}
$script:Status.Captive = $captive
if ($captive -eq $true) {
    Log "Sesi ISE (Cisco) sudah habis - WLAN-NON-CORP ditahan captive portal. Membuka portal lewat Wi-Fi..." 'Yellow'
    if (Test-Path $IseScript) {
        $outIse = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $IseScript -HanyaJikaCaptive 2>&1
        $outIse | ForEach-Object { Add-Content -Path $LogFile -Value ("    " + $_) -Encoding UTF8 }
    }
    Selesai 'OK' "Tersambung & rute terpasang; sesi ISE habis -> portal dibuka di browser, selesaikan provisioning lalu jalankan 'Aktifkan 3 Koneksi' / tunggu run berikutnya." 'Yellow'
    exit 0
}
if ($captive -eq $false) { Log "Sesi ISE masih berlaku - tidak perlu provisioning Cisco lagi." 'Green' }
else { Log "Probe captive portal dilewati (IP Wi-Fi belum ada)." 'DarkGray' }

$pesan = if ($script:Status.Disambungkan) { "Wi-Fi disambungkan ulang ke $SsidNonCorp" } else { "Wi-Fi sudah di $SsidNonCorp" }
$pesan += $(if ($script:Status.RuteDipasang) { ", rute Dev/DB via $gw terpasang" } else { ", rute Dev/DB GAGAL" })
$pesan += $(if ($captive -eq $false) { ", sesi ISE masih berlaku." } else { "." })
Selesai $(if ($script:Status.RuteDipasang) { 'OK' } else { 'GAGAL' }) $pesan $(if ($script:Status.RuteDipasang) { 'Green' } else { 'Red' })
exit $(if ($script:Status.RuteDipasang) { 0 } else { 5 })
