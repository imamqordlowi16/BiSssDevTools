<#
  Cadangan_Internet.ps1 - watchdog internet modem (XinXun/MiFi yang menangkap WLAN-PUBLIC-BI)
  dengan cadangan WLAN-NON-CORP.

  Tiap menit (Scheduled Task "ZeenIQ-Cadangan-Internet"):
    - cek internet LEWAT MODEM (curl --interface <IP modem>, probe generate_204)
        204            -> sehat
        redirect portal -> dianggap sehat (sesi portal habis = urusan Login_Otomatis_MiFi_Portal.ps1)
        tidak ada jawaban -> gagal
    - gagal $BatasGagal x berturut-turut DAN WLAN-NON-CORP bisa internet
        -> jalur internet utama pindah ke WLAN-NON-CORP (metric Wi-Fi 5, modem 100)
    - modem sehat lagi $BatasGagal x berturut-turut -> kembali ke modem (modem 5, Wi-Fi 45,
      sama dengan setup_3_koneksi.ps1). Rute Dev/DB 10.x (/16, /32) tidak disentuh.

  Pemakaian:
    Cadangan_Internet.ps1                    cek sekali (dipakai task; output ke log/status)
    Cadangan_Internet.ps1 -Pasang            pasang task tiap 1 menit (perlu Administrator)
    Cadangan_Internet.ps1 -Cabut             hapus task & kembalikan jalur ke modem
    Cadangan_Internet.ps1 -JalankanSekarang  picu task sekarang
#>
param(
    [switch]$Pasang,
    [switch]$Cabut,
    [switch]$JalankanSekarang,
    [string]$Alasan = 'Manual',
    [string]$LogFile = '',
    [string]$StatusFile = '',
    [string[]]$ModemSubnet = @('192.168.100.', '192.168.8.'),
    [int]$BatasGagal = 2
)
$ErrorActionPreference = 'Continue'
$TaskName = 'ZeenIQ-Cadangan-Internet'
$base = Join-Path $env:LOCALAPPDATA 'ZeenIQDevTools'
if (-not $LogFile)    { $LogFile    = Join-Path $base 'cadangan-internet.log' }
if (-not $StatusFile) { $StatusFile = Join-Path $base 'cadangan-internet.status.json' }
$StateFile = "$StatusFile.state"
foreach ($f in $LogFile, $StatusFile) { $d = Split-Path $f -Parent; if ($d -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
$MetricUtama = 5; $MetricWifi = 45; $MetricTurun = 100   # sama dengan setup_3_koneksi.ps1
$interaktif = $Alasan -eq 'Manual'

function Log([string]$m, [string]$c = 'Gray') {
    Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Alasan] $m" -Encoding UTF8
    if ($interaktif -or $Pasang -or $Cabut -or $JalankanSekarang) { Write-Host $m -ForegroundColor $c }
}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

. "$PSScriptRoot\_KonfigJaringan.ps1"
$K = Get-KonfigJaringan

function Get-Gw([int]$i) {
    (Get-NetRoute -InterfaceIndex $i -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
}
# Modem = adapter Up dengan IP di subnet modem (lewat kabel USB/RNDIS ATAU Wi-Fi) + punya gateway.
function Get-Modem {
    foreach ($a in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue) {
        $ip = $a.IPAddress
        if (-not @($ModemSubnet | Where-Object { $ip.StartsWith($_) }).Count) { continue }
        $n = Get-NetAdapter -InterfaceIndex $a.InterfaceIndex -ErrorAction SilentlyContinue
        if ($n.Status -eq 'Up' -and (Get-Gw $a.InterfaceIndex)) { return [pscustomobject]@{ Index = $a.InterfaceIndex; Nama = $n.Name; IP = $ip } }
    }
    return $null
}
# Cadangan = adapter Wi-Fi yang tersambung ke WLAN-NON-CORP + punya gateway.
function Get-Cadangan {
    $nama = $null
    foreach ($l in (netsh wlan show interfaces 2>$null)) {
        if ($l -match '^\s*Name\s*:\s*(.+)$') { $cur = $Matches[1].Trim() }
        elseif ($cur -and $l -match '^\s*SSID\s*:\s*(.+)$' -and $Matches[1].Trim() -eq $K.SsidNonCorp) { $nama = $cur }
    }
    if (-not $nama) { return $null }
    $n = Get-NetAdapter -Name $nama -ErrorAction SilentlyContinue
    $a = Get-NetIPAddress -InterfaceAlias $nama -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
    if ($n.Status -eq 'Up' -and $a -and (Get-Gw $n.InterfaceIndex)) { return [pscustomobject]@{ Index = $n.InterfaceIndex; Nama = $nama; IP = $a.IPAddress } }
    return $null
}
# OK / PORTAL / MATI untuk satu adapter ($a = objek dari Get-Modem / Get-Cadangan).
# curl --interface <IP> TIDAK bisa diandalkan sendirian di Windows: paket bisa tetap keluar lewat
# rute default (adapter lain) atau bind gagal (errno 10049) -> adapter sehat terbaca MATI
# (26-11: WLAN-NON-CORP dikira tanpa internet padahal Windows menilainya "Internet").
# Jadi: curl dulu; bila bukan 204, pakai penilaian NCSI Windows per adapter.
function Test-Lewat($a) {
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    $code = (& $curl -s -m 8 --interface $a.IP -o NUL -w '%{http_code}' 'http://connectivitycheck.gstatic.com/generate_204' 2>$null) -join ''
    if ($code -eq '204') { return 'OK' }
    if ($code -match '^(200|30[1278])$') { return 'PORTAL' }
    $ncsi = "$((Get-NetConnectionProfile -InterfaceIndex $a.Index -ErrorAction SilentlyContinue | Select-Object -First 1).IPv4Connectivity)"
    if ($ncsi -eq 'Internet') { return 'OK' }
    return 'MATI'
}
function Set-Jalur([string]$mode, $modem, $cad) {
    if ($mode -eq 'Cadangan') {
        Set-NetIPInterface -InterfaceIndex $cad.Index -AddressFamily IPv4 -InterfaceMetric $MetricUtama -ErrorAction SilentlyContinue
        if ($modem) { Set-NetIPInterface -InterfaceIndex $modem.Index -AddressFamily IPv4 -InterfaceMetric $MetricTurun -ErrorAction SilentlyContinue }
    } else {
        if ($modem) { Set-NetIPInterface -InterfaceIndex $modem.Index -AddressFamily IPv4 -InterfaceMetric $MetricUtama -ErrorAction SilentlyContinue }
        if ($cad)   { Set-NetIPInterface -InterfaceIndex $cad.Index -AddressFamily IPv4 -InterfaceMetric $MetricWifi -ErrorAction SilentlyContinue }
    }
}
function Save-Status([string]$hasil, [string]$pesan, $st) {
    $st | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
    [ordered]@{ WaktuSelesai = (Get-Date).ToString('s'); Alasan = $Alasan; Hasil = $hasil; Pesan = $pesan; Mode = $st.Mode } |
        ConvertTo-Json | Set-Content -Path $StatusFile -Encoding UTF8
}

# ======================= kelola task =======================
if ($Cabut) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    $m = Get-Modem; $c = Get-Cadangan
    if ($admin) { Set-Jalur 'Modem' $m $c }
    Remove-Item $StateFile -ErrorAction SilentlyContinue
    Log "[OK] Task '$TaskName' dihapus - cadangan otomatis mati, jalur internet dikembalikan ke modem." 'Green'
    exit 0
}
if ($JalankanSekarang) {
    if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { Write-Host "[BERHENTI] Task '$TaskName' belum terpasang." -ForegroundColor Red; exit 2 }
    Start-ScheduledTask -TaskName $TaskName; Start-Sleep -Seconds 15
    if (Test-Path $StatusFile) { Get-Content $StatusFile -Raw | Write-Host }
    exit 0
}
if ($Pasang) {
    if (-not $admin) { Write-Host '[BERHENTI] -Pasang perlu Administrator (mengubah metric jaringan).' -ForegroundColor Red; exit 1 }
    $userId = "$env:USERDOMAIN\$env:USERNAME"
    $argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Alasan Jadwal -LogFile `"$LogFile`" -StatusFile `"$StatusFile`""
    $E = { param($s) [System.Security.SecurityElement]::Escape($s) }
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>ZeenIQ Dev Tools - internet modem (WLAN-PUBLIC-BI) putus -> pindah ke WLAN-NON-CORP, pulih -> kembali ke modem. Cek tiap 1 menit.</Description><Author>ZeenIQ Dev Tools</Author></RegistrationInfo>
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$((Get-Date).ToString('s'))</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>$(& $E $userId)</UserId><Delay>PT30S</Delay></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$(& $E $userId)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>$(& $E $argLine)</Arguments></Exec></Actions>
</Task>
"@
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
    Log "[OK] Task '$TaskName' terpasang - internet modem dicek tiap menit, cadangan: $($K.SsidNonCorp)." 'Green'
    exit 0
}

# ======================= cek (tiap menit) =======================
$st = [pscustomobject]@{ Mode = 'Modem'; Gagal = 0; Pulih = 0 }
if (Test-Path $StateFile) { try { $st = Get-Content $StateFile -Raw | ConvertFrom-Json } catch {} }
$modem = Get-Modem
$cad = Get-Cadangan

if (-not $modem) {
    if ($st.Mode -eq 'Cadangan') { $st.Mode = 'Modem'; Log 'Modem tidak tersambung lagi - mode cadangan selesai (Windows otomatis memakai adapter yang ada).' }
    $st.Gagal = 0; $st.Pulih = 0
    Save-Status 'LEWAT' 'Modem tidak tersambung - tidak ada yang diawasi.' $st
    if ($interaktif) { Write-Host 'Modem tidak tersambung.' }
    exit 0
}

$hasil = Test-Lewat $modem
if ($st.Mode -eq 'Modem') {
    if ($hasil -ne 'MATI') {
        if ($st.Gagal -gt 0) { Log "Internet modem pulih ($hasil) setelah $($st.Gagal)x gagal." }
        $st.Gagal = 0
        Save-Status 'OK' "Internet lewat modem $($modem.Nama) ($($modem.IP)): $hasil" $st
    } else {
        $st.Gagal++
        Log "Internet modem $($modem.Nama) TIDAK menjawab ($($st.Gagal)/$BatasGagal)." 'Yellow'
        if ($st.Gagal -ge $BatasGagal) {
            if (-not $cad) {
                Save-Status 'GAGAL' "Internet modem mati, tapi $($K.SsidNonCorp) tidak tersambung - tidak ada cadangan." $st
                Log "Tidak bisa pindah: $($K.SsidNonCorp) tidak tersambung." 'Red'
            } elseif ((Test-Lewat $cad) -eq 'OK') {
                if ($admin) { Set-Jalur 'Cadangan' $modem $cad }
                $st.Mode = 'Cadangan'; $st.Gagal = 0; $st.Pulih = 0
                Log "[PINDAH] Internet dipindah ke $($K.SsidNonCorp) ($($cad.Nama)) - WLAN-PUBLIC-BI lewat modem putus." 'Cyan'
                Save-Status 'CADANGAN' "Internet lewat $($K.SsidNonCorp) (cadangan) - modem putus." $st
            } else {
                Save-Status 'GAGAL' "Modem dan $($K.SsidNonCorp) sama-sama tidak bisa internet." $st
                Log "Tidak pindah: $($K.SsidNonCorp) juga tidak bisa internet." 'Red'
            }
        } else { Save-Status 'PERINGATAN' "Internet modem tidak menjawab ($($st.Gagal)/$BatasGagal)." $st }
    }
} else {
    # mode cadangan: tunggu modem pulih stabil
    if ($hasil -eq 'OK') {
        $st.Pulih++
        if ($st.Pulih -ge $BatasGagal) {
            if ($admin) { Set-Jalur 'Modem' $modem $cad }
            $st.Mode = 'Modem'; $st.Pulih = 0; $st.Gagal = 0
            Log "[KEMBALI] Internet modem stabil lagi - jalur internet kembali ke modem ($($modem.Nama))." 'Green'
            Save-Status 'OK' "Kembali ke modem $($modem.Nama) - WLAN-PUBLIC-BI pulih." $st
        } else { Save-Status 'CADANGAN' "Masih lewat cadangan; modem mulai pulih ($($st.Pulih)/$BatasGagal)." $st }
    } else {
        $st.Pulih = 0
        Save-Status 'CADANGAN' "Internet lewat $($K.SsidNonCorp) (cadangan) - modem masih $hasil." $st
    }
}
if ($interaktif) { Get-Content $StatusFile -Raw | Write-Host }
