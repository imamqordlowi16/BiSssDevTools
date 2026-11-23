<#
  Dual_WiFi.ps1 - mode DUA Wi-Fi sekaligus (fitur baru, skrip lama TIDAK diubah):
    - Kartu Wi-Fi BAWAAN (bukan USB)  -> WLAN-NON-CORP  -> rute Dev/DB 10.x
    - Dongle Wi-Fi USB                -> HUAWEI-7492 (MiFi) atau WLAN-PUBLIC-BI langsung -> jalur Internet

  Kenapa perlu skrip sendiri: skrip 3-koneksi lama (setup_3_koneksi, Auto_Sambung,
  Buka_Portal_ISE -HanyaJikaCaptive, Ganti_Mode) membaca SSID PERTAMA dari
  `netsh wlan show interfaces` & `netsh wlan connect` tanpa interface - dengan dua
  kartu Wi-Fi itu bisa salah adapter. Skrip ini selalu menyebut adapter per nama.
  Daftar subnet/host Dev/DB DIBACA dari setup_3_koneksi.ps1 (AST + SafeGetValue,
  tanpa menjalankan skrip itu) supaya satu sumber kebenaran.

  Pemakaian:
    -Status                       tampilkan kondisi (tanpa admin)
    -Terapkan [-DryRun]           kunci profil, sambungkan, metric, rute (Administrator)
    -Watchdog                     = -Terapkan tanpa banyak output (dipanggil Scheduled Task)
    -Pasang / -Cabut              pasang/hapus Scheduled Task "ZeenIQ-DualWiFi" (Administrator)
    [-LogFile x] [-StatusFile y]
#>
param(
    [switch]$Status,
    [switch]$Terapkan,
    [switch]$Watchdog,
    [switch]$Pasang,
    [switch]$Cabut,
    [switch]$DryRun,
    [string]$LogFile = '',
    [string]$StatusFile = ''
)
$ErrorActionPreference = 'Continue'
$TaskName     = 'ZeenIQ-DualWiFi'
$SsidNonCorp  = 'WLAN-NON-CORP'
$SsidUplink   = @('WLAN-PUBLIC-BI', 'HUAWEI-7492')   # urutan = prioritas untuk dongle
# WLAN-PUBLIC-BI LANGSUNG = utama (HUAWEI-7492 cuma extender WLAN-PUBLIC-BI, jadi cadangan).
$SsidUtama      = 'WLAN-PUBLIC-BI'
$MinSinyalUtama = 45   # % sinyal minimal dari dongle sebelum pindah dari HUAWEI
$JedaGagalMenit = 10   # setelah gagal online lewat WLAN-PUBLIC-BI, jangan coba lagi selama ini (anti bolak-balik)
$MetricDongle = 15    # Internet utama
$MetricNonCorp = 50   # hanya Dev/DB lewat rute spesifik
if ($Watchdog) { $Terapkan = $true }
if (-not $LogFile)    { $LogFile    = Join-Path (Join-Path $env:LOCALAPPDATA 'ZeenIQDevTools') 'dual-wifi.log' }
if (-not $StatusFile) { $StatusFile = Join-Path (Join-Path $env:LOCALAPPDATA 'ZeenIQDevTools') 'dual-wifi.status.json' }
foreach ($f in $LogFile, $StatusFile) { $d = Split-Path $f -Parent; if ($d -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
$mulai = (Get-Date).ToString('s')

function Log([string]$m, [string]$c = 'Gray') {
    Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" -Encoding UTF8
    Write-Host $m -ForegroundColor $c
}
function Selesai([string]$hasil, [string]$pesan, [int]$code = 0) {
    Log "[$hasil] $pesan" $(switch ($hasil) { 'OK' { 'Green' } 'GAGAL' { 'Red' } default { 'Yellow' } })
    [ordered]@{ WaktuMulai = $mulai; WaktuSelesai = (Get-Date).ToString('s'); Alasan = $(if ($Watchdog) { 'Watchdog' } else { 'Manual' })
                Hasil = $hasil; Pesan = $pesan; Ssid = "$($script:inSsid) + $($script:dgSsid)"; Gateway = $script:inGw } |
        ConvertTo-Json | Set-Content -Path $StatusFile -Encoding UTF8
    exit $code
}
function Test-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

# ---------------------------------------------------------------- adapter Wi-Fi
function Get-WlanList {
    $out = (netsh wlan show interfaces | Out-String)
    foreach ($b in ($out -split '(?m)^\s*Name\s*:\s*' | Select-Object -Skip 1)) {
        [pscustomobject]@{
            Name        = ($b -split "`r?`n")[0].Trim()
            Description = [regex]::Match($b, '(?m)^\s*Description\s*:\s*(.+?)\s*$').Groups[1].Value
            State       = [regex]::Match($b, '(?m)^\s*State\s*:\s*(.+?)\s*$').Groups[1].Value
            Ssid        = [regex]::Match($b, '(?m)^\s*SSID\s*:\s*(.+?)\s*$').Groups[1].Value
            Signal      = [regex]::Match($b, '(?m)^\s*Signal\s*:\s*(.+?)\s*$').Groups[1].Value
        }
    }
}
function Get-Gw([string]$alias) {
    (Get-NetRoute -InterfaceAlias $alias -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
}
function Get-Ip([string]$alias) {
    (Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
}
function Test-Terlihat([string]$ssid, [string]$iface) {
    for ($i = 0; $i -lt 3; $i++) {
        if ((netsh wlan show networks interface="$iface" 2>$null) -match "^\s*SSID \d+\s*:\s*$([regex]::Escape($ssid))\s*$") { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}
function Test-Profil([string]$ssid, [string]$iface) { (netsh wlan show profile name="$ssid" interface="$iface" 2>$null) -match 'Connection mode' }
# Band yang didukung adapter, dari "Radio types supported" di `netsh wlan show drivers`:
# 802.11a/ac/ax = bisa 5 GHz; cuma b/g/n = 2.4 GHz saja (mis. dongle ZTOP ZT9101).
# WLAN-PUBLIC-BI di kantor memancar di 2.4 GHz (ch 6) DAN 5 GHz (ch 60): dongle 2.4 GHz hanya
# bisa memakai AP 2.4 GHz-nya, yang dari dongle sering lemah/hilang (23-11: tersambung 15:14,
# diputus driver 15:19, gagal sambung ulang -> pindah HUAWEI). Dual-band jauh lebih stabil.
function Get-WlanBand([string]$iface) {
    $out = (netsh wlan show drivers 2>$null | Out-String)
    foreach ($b in ($out -split '(?m)^\s*Interface name\s*:\s*' | Select-Object -Skip 1)) {
        if (($b -split "`r?`n")[0].Trim() -ne $iface) { continue }
        $rt = [regex]::Match($b, '(?m)^\s*Radio types supported\s*:\s*(.+?)\s*$').Groups[1].Value
        if (-not $rt) { return [pscustomobject]@{ Bisa5 = $null; Teks = 'band tidak diketahui' } }
        $bisa5 = $rt -match '802\.11(a|ac|ax)\b'
        return [pscustomobject]@{ Bisa5 = $bisa5; Teks = $(if ($bisa5) { "2.4 + 5 GHz ($rt)" } else { "2.4 GHz saja ($rt)" }) }
    }
    [pscustomobject]@{ Bisa5 = $null; Teks = 'band tidak diketahui' }
}
$Catatan24 = 'dongle 2.4 GHz saja - WLAN-PUBLIC-BI hanya bisa lewat AP 2.4 GHz-nya (sering lemah/putus), AP 5 GHz tidak terjangkau; dongle dual-band (AC/AX) lebih stabil'
# Sinyal suatu SSID per band dari hasil scan satu adapter (band dari nomor channel: 1-14 = 2.4 GHz).
function Get-SsidSinyal([string]$iface, [string]$ssid) {
    $out = (netsh wlan show networks interface="$iface" mode=bssid 2>$null | Out-String)
    $blok = ($out -split '(?m)^SSID \d+\s*:\s*') | Where-Object { ($_ -split "`r?`n")[0].Trim() -eq $ssid } | Select-Object -First 1
    if (-not $blok) { return 'tidak terlihat' }
    $hasil = foreach ($b in ($blok -split '(?m)^\s*BSSID \d+\s*:' | Select-Object -Skip 1)) {
        $sig = [regex]::Match($b, '(?m)^\s*Signal\s*:\s*(\d+%)').Groups[1].Value
        $ch  = [int]('0' + [regex]::Match($b, '(?m)^\s*Channel\s*:\s*(\d+)').Groups[1].Value)
        "$(if ($ch -ge 1 -and $ch -le 14) { '2.4' } else { '5' }) GHz ch$ch $sig"
    }
    if ($hasil) { $hasil -join ', ' } else { 'terlihat' }
}
# Sinyal terkuat (angka %) suatu SSID dari satu adapter; 0 = tidak terlihat. Scan diulang 3x (hasil scan dongle sering kosong sesaat).
function Get-SinyalMaks([string]$iface, [string]$ssid) {
    for ($i = 0; $i -lt 3; $i++) {
        $out = (netsh wlan show networks interface="$iface" mode=bssid 2>$null | Out-String)
        $blok = ($out -split '(?m)^SSID \d+\s*:\s*') | Where-Object { ($_ -split "`r?`n")[0].Trim() -eq $ssid } | Select-Object -First 1
        if ($blok) { return [int](([regex]::Matches($blok, '(?m)^\s*Signal\s*:\s*(\d+)%') | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Maximum).Maximum) }
        Start-Sleep -Seconds 3
    }
    0
}
# Cek Internet lewat satu IP sumber: ONLINE / DITAHAN PORTAL ISE / tidak online / tidak ada respons.
function Test-Online([string]$ip) {
    if (-not $ip) { return 'tidak ada IP' }
    $r = (& curl.exe -s -i -m 8 --interface $ip http://connectivitycheck.gstatic.com/generate_204 2>$null) -join "`n"
    if ($r -match '^HTTP/\S+ 204') { 'ONLINE' } elseif ($r -match '(?im)^Location:.*portal') { 'DITAHAN PORTAL ISE' } elseif ($r) { 'tidak online' } else { 'tidak ada respons' }
}

$wl = @(Get-WlanList)
$in = $wl | Where-Object { $_.Description -notmatch 'USB' } | Select-Object -First 1
$dg = $wl | Where-Object { $_.Description -match 'USB' } | Select-Object -First 1
$script:inSsid = $in.Ssid; $script:dgSsid = $dg.Ssid; $script:inGw = $null
$dgBand = if ($dg) { Get-WlanBand $dg.Name } else { $null }

# ---------------------------------------------------------------- Status (tanpa admin)
if ($Status) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Host "Kartu bawaan : $(if ($in) { "$($in.Name) [$($in.State)] SSID=$($in.Ssid) sinyal=$($in.Signal) IP=$(Get-Ip $in.Name) GW=$(Get-Gw $in.Name)" } else { 'TIDAK ADA' })"
    Write-Host "Dongle USB   : $(if ($dg) { "$($dg.Name) [$($dg.State)] SSID=$($dg.Ssid) sinyal=$($dg.Signal) IP=$(Get-Ip $dg.Name) GW=$(Get-Gw $dg.Name)" } else { 'TIDAK ADA (colok dongle)' })"
    if ($dg) {
        Write-Host "Band dongle  : $($dgBand.Teks) - $($dg.Description)" -ForegroundColor $(if ($dgBand.Bisa5 -eq $false) { 'Yellow' } else { 'Gray' })
        if ($dgBand.Bisa5 -eq $false) { Write-Host "  [!] $Catatan24" -ForegroundColor Yellow }
        Write-Host "WLAN-PUBLIC-BI dari dongle : $(Get-SsidSinyal $dg.Name 'WLAN-PUBLIC-BI')"
        if ($in) { Write-Host "WLAN-PUBLIC-BI dari bawaan : $(Get-SsidSinyal $in.Name 'WLAN-PUBLIC-BI')" }
    }
    foreach ($a in @($in, $dg) | Where-Object { $_ -and (Get-Ip $_.Name) }) {
        Write-Host ("  Internet via {0,-8}: {1}" -f $a.Name, (Test-Online (Get-Ip $a.Name)))
    }
    $met = Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -in @($in.Name, $dg.Name) } | ForEach-Object { "$($_.InterfaceAlias)=$($_.InterfaceMetric)" }
    Write-Host "Metric       : $($met -join ', ')"
    Write-Host "Task watchdog: $(if ($task) { "$TaskName ($($task.State))" } else { 'belum dipasang' })"
    exit 0
}

# ---------------------------------------------------------------- Pasang / Cabut task
if ($Pasang -or $Cabut) {
    if (-not (Test-Admin)) { Write-Host '[BERHENTI] Harus dijalankan sebagai Administrator.' -ForegroundColor Red; exit 1 }
    if ($Cabut) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "[OK] Task '$TaskName' dihapus." -ForegroundColor Green; exit 0
    }
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Watchdog -LogFile `"$LogFile`" -StatusFile `"$StatusFile`""
    $subs = '<QueryList><Query Id="0" Path="Microsoft-Windows-WLAN-AutoConfig/Operational"><Select Path="Microsoft-Windows-WLAN-AutoConfig/Operational">*[System[(EventID=8001 or EventID=8003)]]</Select></Query></QueryList>'
    # Adapter jaringan baru dicolok/dinyalakan (Kernel-PnP 410 "device started", ClassGuid = Net) ->
    # dongle baru langsung dapat profil + metric tanpa klik Terapkan. Juga terpicu oleh adapter
    # virtual (aTrust/Hyper-V); aman karena Terapkan idempoten & menahan diri saat omni aktif.
    $subsPnp = '<QueryList><Query Id="0" Path="Microsoft-Windows-Kernel-PnP/Configuration"><Select Path="Microsoft-Windows-Kernel-PnP/Configuration">*[System[(EventID=410)] and EventData[Data[@Name=''ClassGuid'']=''{4d36e972-e325-11ce-bfc1-08002be10318}'']]</Select></Query></QueryList>'
    $E = { param($s) [System.Security.SecurityElement]::Escape($s) }
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>ZeenIQ Dev Tools - Dual Wi-Fi: kartu bawaan ke WLAN-NON-CORP (Dev/DB), dongle USB ke HUAWEI-7492/WLAN-PUBLIC-BI (Internet). Sambung ulang + rute tiap Wi-Fi putus/tersambung.</Description><Author>ZeenIQ Dev Tools</Author></RegistrationInfo>
  <Triggers>
    <EventTrigger><Enabled>true</Enabled><Subscription>$(& $E $subs)</Subscription><Delay>PT8S</Delay></EventTrigger>
    <EventTrigger><Enabled>true</Enabled><Subscription>$(& $E $subsPnp)</Subscription><Delay>PT15S</Delay></EventTrigger>
    <TimeTrigger><Repetition><Interval>PT10M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$((Get-Date).ToString('s'))</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>$(& $E $userId)</UserId><Delay>PT45S</Delay></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$(& $E $userId)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>$(& $E $argLine)</Arguments><WorkingDirectory>$(& $E $PSScriptRoot)</WorkingDirectory></Exec></Actions>
</Task>
"@
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
    Write-Host "[OK] Task '$TaskName' terpasang (pemicu: Wi-Fi putus/tersambung + adapter baru dicolok + tiap 10 menit + login). Log: $LogFile" -ForegroundColor Green
    exit 0
}

if (-not $Terapkan) { Write-Host 'Pakai: -Status | -Terapkan [-DryRun] | -Pasang | -Cabut' -ForegroundColor Yellow; exit 1 }

# ---------------------------------------------------------------- Terapkan
if (-not (Test-Admin) -and -not $DryRun) { Selesai 'GAGAL' 'Harus dijalankan sebagai Administrator (metric/rute).' 1 }
$mutex = New-Object Threading.Mutex($false, 'Global\ZeenIQ-DualWiFi')
if (-not $mutex.WaitOne(0)) { exit 0 }
if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) { Get-Content $LogFile -Tail 2000 | Set-Content "$LogFile.tmp"; Move-Item "$LogFile.tmp" $LogFile -Force }
Log "==== Dual Wi-Fi $(if ($Watchdog) { '(watchdog)' } else { '' })$(if ($DryRun) { ' DRY RUN' }) ====" 'Cyan'

# omni (aTrust) aktif -> Sangfor memutus Wi-Fi & mencegat 10.x (lihat Fix #9): jangan ikut campur.
if (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'aTrust|Sangfor' -or $_.Name -match 'aTrust|Sangfor') }) {
    Selesai 'LEWAT' 'omni (aTrust) aktif - Dual Wi-Fi ditahan. Putus omni dari tray dulu.'
}
if (-not $in) { Selesai 'LEWAT' 'Kartu Wi-Fi bawaan tidak ditemukan.' }
if (-not $dg) { Selesai 'LEWAT' 'Dongle Wi-Fi USB tidak terpasang - mode Dual Wi-Fi tidak dipakai (skrip 3 koneksi lama berlaku).' }
Log "Bawaan: $($in.Name) [$($in.State) $($in.Ssid)] | Dongle: $($dg.Name) [$($dg.State) $($dg.Ssid)] band $($dgBand.Teks)"
if ($dgBand.Bisa5 -eq $false) { Log "  [!] $Catatan24" 'Yellow' }

function Run([string]$desc, [scriptblock]$sb) {
    if ($DryRun) { Log "  (dry) $desc" 'DarkGray'; return }
    $o = & $sb 2>&1; Log "  $desc -> $((($o | Out-String) -replace '\s+', ' ').Trim())" 'DarkGray'
}

# 1. Profil: dongle punya profil uplink (disalin dari kartu bawaan; kunci PSK tetap
#    terenkripsi mesin, TIDAK diekspor polos). Kartu bawaan: uplink = manual (tidak berebut).
$tmp = Join-Path $env:TEMP "zeeniq-dualwifi-$PID"
foreach ($s in $SsidUplink) {
    if (-not (Test-Profil $s $dg.Name) -and (Test-Profil $s $in.Name)) {
        New-Item -ItemType Directory -Path $tmp -Force | Out-Null
        Run "salin profil $s ke $($dg.Name)" {
            netsh wlan export profile name="$s" interface="$($in.Name)" folder="$tmp" | Out-Null
            $x = Get-ChildItem $tmp -Filter '*.xml' | Select-Object -First 1
            netsh wlan add profile filename="$($x.FullName)" interface="$($dg.Name)" user=all
            Remove-Item $x.FullName -Force
        }
    }
    if (Test-Profil $s $dg.Name) { Run "$($dg.Name)/$s = otomatis" { netsh wlan set profileparameter name="$s" interface="$($dg.Name)" connectionmode=auto } }
    if (Test-Profil $s $in.Name) { Run "$($in.Name)/$s = manual" { netsh wlan set profileparameter name="$s" interface="$($in.Name)" connectionmode=manual } }
}
if (Test-Profil $SsidNonCorp $dg.Name) { Run "$($dg.Name)/$SsidNonCorp = manual" { netsh wlan set profileparameter name="$SsidNonCorp" interface="$($dg.Name)" connectionmode=manual } }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
# Urutan profil di dongle = urutan $SsidUplink, supaya auto-connect Windows juga memilih WLAN-PUBLIC-BI dulu.
$prio = 1
foreach ($s in $SsidUplink) { if (Test-Profil $s $dg.Name) { $p = $prio; Run "$($dg.Name)/$s prioritas $p" { netsh wlan set profileorder name="$s" interface="$($dg.Name)" priority=$p }; $prio++ } }

# 2. Sambungkan yang belum benar.
if ($in.Ssid -ne $SsidNonCorp) {
    if (Test-Terlihat $SsidNonCorp $in.Name) { Run "sambung $($in.Name) -> $SsidNonCorp" { netsh wlan connect name="$SsidNonCorp" interface="$($in.Name)" } }
    else { Log "  $SsidNonCorp tidak terlihat dari $($in.Name) (di luar kantor?)" 'Yellow' }
}
# Dongle: WLAN-PUBLIC-BI langsung bila sinyalnya cukup & tidak sedang jeda-gagal; selain itu cadangan (HUAWEI).
$fileGagal = Join-Path (Split-Path $StatusFile -Parent) 'dual-wifi.public-gagal.txt'
$jedaSisa = if (Test-Path $fileGagal) { [math]::Ceiling($JedaGagalMenit - ((Get-Date) - (Get-Item $fileGagal).LastWriteTime).TotalMinutes) } else { 0 }
$pindahUtama = $false
if ($dg.Ssid -ne $SsidUtama) {
    $sigUtama = Get-SinyalMaks $dg.Name $SsidUtama
    if (-not (Test-Profil $SsidUtama $dg.Name)) { Log "  Dongle belum punya profil $SsidUtama." 'Yellow' }
    elseif ($sigUtama -lt $MinSinyalUtama) { Log "  $SsidUtama dari dongle: $(if ($sigUtama) { "sinyal $sigUtama% < $MinSinyalUtama%" } else { 'tidak terlihat' }) - tetap/pakai cadangan.$(if ($dgBand.Bisa5 -eq $false) { " ($Catatan24)" })" 'Yellow' }
    elseif ($jedaSisa -gt 0) { Log "  $SsidUtama baru saja gagal - coba lagi ~$jedaSisa menit lagi; tetap/pakai cadangan." 'Yellow' }
    else { Run "sambung $($dg.Name) -> $SsidUtama (sinyal $sigUtama%)" { netsh wlan connect name="$SsidUtama" interface="$($dg.Name)" }; $pindahUtama = $true }
}
function Sambung-Cadangan {
    $target = $SsidUplink | Where-Object { $_ -ne $SsidUtama -and (Test-Profil $_ $dg.Name) -and (Test-Terlihat $_ $dg.Name) } | Select-Object -First 1
    if ($target) { Run "sambung $($dg.Name) -> $target (cadangan)" { netsh wlan connect name="$target" interface="$($dg.Name)" } }
    else { Log "  Cadangan $($SsidUplink -join '/') juga tidak terlihat dari dongle." 'Yellow' }
}
if (-not $pindahUtama -and $SsidUplink -notcontains $dg.Ssid) { Sambung-Cadangan }
function Tunggu([int]$detik, [scriptblock]$selesai) {
    $t = Get-Date
    do { Start-Sleep -Seconds 2; $wl = @(Get-WlanList); $script:in = $wl | Where-Object Name -eq $in.Name; $script:dg = $wl | Where-Object Name -eq $dg.Name
         $script:inGw = Get-Gw $script:in.Name
    } until ((& $selesai) -or ((Get-Date) - $t).TotalSeconds -gt $detik)
}
if (-not $DryRun) {
    $okIn = { $script:in.Ssid -ne $SsidNonCorp -or $script:inGw }
    if ($pindahUtama) { Tunggu 40 { (& $okIn) -and $script:dg.Ssid -eq $SsidUtama -and (Get-Gw $script:dg.Name) } }
    else              { Tunggu 30 { (& $okIn) -and ($SsidUplink -notcontains $script:dg.Ssid -or (Get-Gw $script:dg.Name)) } }
    if ($pindahUtama) {
        # Sesi portal ISE terikat MAC: dongle (MAC sendiri) perlu login sendiri -> jalankan login portal sekarang.
        $net = if ($dg.Ssid -eq $SsidUtama) { Test-Online (Get-Ip $dg.Name) } else { "tidak tersambung (SSID=$($dg.Ssid))" }
        if ($net -eq 'DITAHAN PORTAL ISE') {
            $login = Join-Path $PSScriptRoot 'Login_Otomatis_MiFi_Portal.ps1'
            $logDir = Split-Path $StatusFile -Parent
            $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $login -Alasan 'DualWiFi' -LogFile (Join-Path $logDir 'jaringan-login-mifi.log') -StatusFile (Join-Path $logDir 'jaringan-login-mifi.status.json') 2>&1
            Log "  login portal ISE (dongle) -> $((($o | Out-String) -replace '\s+', ' ').Trim())" 'DarkGray'
            Start-Sleep -Seconds 3; $net = Test-Online (Get-Ip $dg.Name)
        }
        if ($net -eq 'ONLINE') { Log "  Dongle ONLINE langsung lewat $SsidUtama." 'Green'; Remove-Item $fileGagal -Force -ErrorAction SilentlyContinue }
        else {
            Log "  $SsidUtama lewat dongle: $net - kembali ke cadangan, jeda $JedaGagalMenit menit." 'Yellow'
            Set-Content -Path $fileGagal -Value "$(Get-Date -Format s) $net" -Encoding UTF8
            Sambung-Cadangan
            Tunggu 30 { $SsidUplink -notcontains $script:dg.Ssid -or (Get-Gw $script:dg.Name) }
        }
    }
} else { $script:inGw = Get-Gw $in.Name }
$script:inSsid = $in.Ssid; $script:dgSsid = $dg.Ssid

# 3. Metric: dongle = Internet utama, kartu bawaan di belakangnya.
$okUplink = $SsidUplink -contains $dg.Ssid
if ($okUplink) { Run "metric $($dg.Name)=$MetricDongle" { Set-NetIPInterface -InterfaceAlias $dg.Name -AddressFamily IPv4 -InterfaceMetric $MetricDongle } }
if ($in.Ssid -eq $SsidNonCorp) { Run "metric $($in.Name)=$MetricNonCorp" { Set-NetIPInterface -InterfaceAlias $in.Name -AddressFamily IPv4 -InterfaceMetric $MetricNonCorp } }

# 4. Rute Dev/DB lewat WLAN-NON-CORP (daftar dibaca dari setup_3_koneksi.ps1, tanpa menjalankannya).
$nRute = 0
if ($in.Ssid -eq $SsidNonCorp -and $script:inGw) {
    $setup = Join-Path $PSScriptRoot 'setup_3_koneksi.ps1'
    $ast = [Management.Automation.Language.Parser]::ParseFile($setup, [ref]$null, [ref]$null)
    $assign = $ast.FindAll({ $args[0] -is [Management.Automation.Language.AssignmentStatementAst] }, $true)
    function Ambil([string]$nama) {
        $a = $assign | Where-Object { $_.Left.VariablePath.UserPath -eq $nama } | Select-Object -First 1
        if ($a) { $a.Right.Expression.SafeGetValue() }
    }
    $subnets = @(Ambil 'SubnetNonCorp'); $hosts = @(Ambil 'Hosts')
    if ($subnets.Count -eq 0) { Selesai 'GAGAL' "Daftar SubnetNonCorp tidak terbaca dari $setup" 3 }
    $prefixes = @($subnets) + @($hosts | ForEach-Object { "$($_.IP)/32" })
    $idx = (Get-NetAdapter -Name $in.Name).InterfaceIndex
    foreach ($p in $prefixes) {
        $ada = Get-NetRoute -DestinationPrefix $p -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -eq $script:inGw -and $_.InterfaceIndex -eq $idx }
        if ($ada) { continue }
        $ip, $bits = $p -split '/'
        $v = [uint32]::MaxValue -shl (32 - [int]$bits) -band [uint32]::MaxValue
        $mask = '{0}.{1}.{2}.{3}' -f (($v -shr 24) -band 255), (($v -shr 16) -band 255), (($v -shr 8) -band 255), ($v -band 255)
        Get-NetRoute -DestinationPrefix $p -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object Protocol -eq 'NetMgmt' |
            ForEach-Object { if (-not $DryRun) { $_ | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue } }
        Run "rute $p via $($script:inGw)" { route.exe add $ip mask $mask $script:inGw metric 1 if $idx }
        $nRute++
    }
}

$pesan = "Bawaan=$($in.Ssid) (GW $($script:inGw)), Dongle=$($dg.Ssid); $nRute rute Dev/DB dipasang/diperbarui."
if ($dgBand.Bisa5 -eq $false) { $pesan += " Catatan: $Catatan24." }
if ($in.Ssid -eq $SsidNonCorp -and $okUplink) { Selesai 'OK' $pesan }
Selesai 'GAGAL' "Belum lengkap: $pesan" 2
