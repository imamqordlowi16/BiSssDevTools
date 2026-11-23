<#
  setup_3_koneksi.ps1 - Split routing 3 koneksi, menyesuaikan jaringan tempat laptop berada.

    MODE KANTOR  (salah satu Wi-Fi - bawaan ATAU dongle USB - tersambung ke SSID WLAN-NON-CORP):
      1. Internet        -> Ethernet / tethering USB HP, atau kalau tidak ada: dongle Wi-Fi (Wi-Fi yang
                            BUKAN WLAN-NON-CORP, mis. ke MiFi/hotspot HP). Default route, metric terendah.
                            Internet lain yang juga aktif jadi cadangan (metric 25).
      2. WLAN-NON-CORP   -> Server Dev & DB 10.239.x / 10.230.x / 10.161.x (/32 + /16)
      3. aTrustVNIC      -> 10.28.224.213:1521

    MODE LUAR KANTOR (rumah / Wi-Fi lain / tanpa Wi-Fi):
      - TIDAK memasang rute 10.x lewat Wi-Fi (itu yang dulu menimpa jalur aTrust)
      - Semua host internal diarahkan lewat aTrustVNIC bila aTrust tersambung
      - Internet tetap lewat Ethernet bila ada, kalau tidak lewat Wi-Fi apa adanya

  Setiap kali dijalankan skrip ini LEBIH DULU membersihkan rute lama (aktif + persisten)
  yang pernah dipasang skrip-skrip sebelumnya, lalu memasang ulang sesuai mode.

  Pemakaian:
    setup_3_koneksi.ps1            # terapkan (perlu Administrator)
    setup_3_koneksi.ps1 -DryRun    # hanya deteksi & tampilkan rencana, tanpa mengubah apa pun
    setup_3_koneksi.ps1 -NoConnect # jangan coba sambung otomatis ke WLAN-NON-CORP
    setup_3_koneksi.ps1 -Internet Dongle      # paksa Internet lewat dongle Wi-Fi walau Ethernet ada
    setup_3_koneksi.ps1 -Internet Ethernet    # paksa Internet lewat Ethernet/USB
    setup_3_koneksi.ps1 -WifiNonCorp Dongle   # sambungkan WLAN-NON-CORP lewat dongle (bawaan untuk Internet)
#>
param(
    [switch]$DryRun,
    [switch]$NoConnect,
    # Jalur Internet: Otomatis = Ethernet/tethering USB bila ada, kalau tidak dongle Wi-Fi (Wi-Fi kedua).
    [ValidateSet('Otomatis', 'Ethernet', 'Dongle')]
    [string]$Internet = 'Otomatis',
    # Adapter yang dipakai saat MENYAMBUNGKAN otomatis ke WLAN-NON-CORP (yang sudah tersambung selalu dikenali,
    # lewat adapter mana pun): Otomatis = yang masih bebas, utamakan Wi-Fi bawaan laptop.
    [ValidateSet('Otomatis', 'Bawaan', 'Dongle')]
    [string]$WifiNonCorp = 'Otomatis'
)

$ErrorActionPreference = 'Continue'
$SsidNonCorp    = 'WLAN-NON-CORP'
$MetricEthernet = 5
$MetricWifi     = 45
$MetricCadangan = 25   # Internet kedua (mis. dongle saat Ethernet juga ada)
$GwNonCorpDefault = '10.149.0.1'   # dipakai hanya bila DHCP WLAN-NON-CORP tidak memberi gateway

# Host internal yang diuji & dirutekan. Port hanya untuk uji koneksi.
$Hosts = @(
    @{ IP = '10.239.19.130'; Port = 18002; Nama = 'devbisssapp01' },
    @{ IP = '10.239.13.100'; Port = 1521;  Nama = 'devbisssdbo01' },
    @{ IP = '10.239.14.38';  Port = 1521;  Nama = 'devgmmpdbs01' },
    @{ IP = '10.230.84.29';  Port = 1521;  Nama = 'DEV02' },
    @{ IP = '10.161.1.82';   Port = 443;   Nama = 'coordinator-impala' },
    @{ IP = '10.161.10.135'; Port = 1521;  Nama = 'dc1sssdb002' }
)
$HostAtrust = @{ IP = '10.28.224.213'; Port = 1521; Nama = 'DB via aTrust' }

# Subnet pendukung yang hanya dipasang di MODE KANTOR (lewat WLAN-NON-CORP)
$SubnetNonCorp = @('10.239.0.0/16', '10.230.0.0/16', '10.161.0.0/16', '10.210.0.0/16', '10.240.0.0/16', '10.149.0.0/16')

# Semua prefix yang pernah dipasang skrip lama -> selalu dibersihkan dulu
$PrefixKelola = @($SubnetNonCorp) + @('10.0.0.0/8') + @($Hosts | ForEach-Object { "$($_.IP)/32" }) + @("$($HostAtrust.IP)/32")

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "       KONFIGURASI SPLIT ROUTING 3 KONEKSI SIMULTAN" -ForegroundColor Cyan
Write-Host "   Ethernet -> Internet | WLAN-NON-CORP -> Dev/DB | aTrust -> 10.28.224.213" -ForegroundColor Cyan
if ($DryRun) { Write-Host "       MODE: DRY RUN - tidak ada yang diubah" -ForegroundColor Magenta }
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# ====================================================================
# 0. HAK ADMINISTRATOR
# ====================================================================
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $DryRun) {
    Write-Host "[BERHENTI] Wajib dijalankan sebagai Administrator (route/metric gagal diam-diam tanpa itu)." -ForegroundColor Red
    Write-Host "           Jalankan lewat Aktifkan_3_Koneksi_Simultan.bat, atau pakai -DryRun untuk sekadar melihat." -ForegroundColor Yellow
    return
}

# ====================================================================
# FUNGSI BANTU
# ====================================================================
function Test-PortQuick {
    param([string]$TargetHost, [int]$Port, [int]$TimeoutMs = 4000)
    $client = New-Object System.Net.Sockets.TcpClient
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $ar = $client.BeginConnect($TargetHost, $Port, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            try { $client.EndConnect($ar); return "OK ($($sw.ElapsedMilliseconds) ms)" }
            catch { return "$($_.Exception.InnerException.SocketErrorCode) ($($sw.ElapsedMilliseconds) ms)" }
        }
        return "TIMEOUT"
    } catch { return "ERROR" } finally { $client.Close() }
}

# SSID per adapter Wi-Fi (bisa lebih dari satu: Wi-Fi bawaan + dongle USB).
# Hasil: hashtable NamaAdapter -> SSID (hanya yang tersambung).
function Get-WlanSsids {
    $map = @{}; $name = $null
    foreach ($l in (netsh wlan show interfaces 2>$null)) {
        if ($l -match '^\s*Name\s*:\s*(.+)$') { $name = $Matches[1].Trim() }
        elseif ($name -and $l -match '^\s*SSID\s*:\s*(.+)$') { $map[$name] = $Matches[1].Trim() }
    }
    return $map
}

# adapter Wi-Fi yang tersambung ke WLAN-NON-CORP (bukan sekadar SSID pertama di netsh)
function Get-NonCorpWifi {
    $ssids = Get-WlanSsids
    $nama = $ssids.Keys | Where-Object { $ssids[$_] -eq $SsidNonCorp } | Select-Object -First 1
    if ($nama) { return Get-NetAdapter -Name $nama -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' }
    return $null
}

function Get-DefaultGateway([int]$IfIndex) {
    (Get-NetRoute -InterfaceIndex $IfIndex -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric | Select-Object -First 1).NextHop
}

function Get-IfIPv4([int]$IfIndex) {
    (Get-NetIPAddress -InterfaceIndex $IfIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
}

# Hapus rute STATIS (Protocol NetMgmt) untuk prefix ini dari ActiveStore + PersistentStore.
# Rute on-link bawaan adapter/DHCP (Protocol Local) tidak disentuh.
# route.exe delete tidak selalu membersihkan registry -> rute persisten basi hidup lagi tiap boot.
function Remove-RouteBothStores([string]$Prefix) {
    $n = 0
    foreach ($store in 'ActiveStore', 'PersistentStore') {
        $found = @(Get-NetRoute -DestinationPrefix $Prefix -AddressFamily IPv4 -PolicyStore $store -ErrorAction SilentlyContinue |
                   Where-Object { $_.Protocol -eq 'NetMgmt' })
        foreach ($r in $found) {
            if ($DryRun) { Write-Host "    (dry) hapus $Prefix via $($r.NextHop) if $($r.InterfaceIndex) [$store]" -ForegroundColor DarkGray }
            else { $r | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue }
            $n++
        }
    }
    return $n
}

function ConvertTo-Mask([int]$Bits) {
    $v = if ($Bits -eq 0) { 0 } else { [uint32]::MaxValue -shl (32 - $Bits) -band [uint32]::MaxValue }
    return ('{0}.{1}.{2}.{3}' -f (($v -shr 24) -band 255), (($v -shr 16) -band 255), (($v -shr 8) -band 255), ($v -band 255))
}

# Pasang rute AKTIF saja (tanpa -p) lewat route.exe - terbukti jalan di mesin ini.
# Sengaja tidak persisten: rute persisten yang gateway-nya tak ada di jaringan lain = jebakan.
function Add-Route([string]$Prefix, [int]$IfIndex, [string]$Gw, [string]$Ket) {
    $ip, $bits = $Prefix -split '/'
    $mask = ConvertTo-Mask ([int]$bits)
    if ($DryRun) { Write-Host ("  (dry) {0,-18} -> if {1} via {2}  ({3})" -f $Prefix, $IfIndex, $Gw, $Ket) -ForegroundColor DarkGray; return }
    $out = & route.exe add $ip mask $mask $Gw metric 1 if $IfIndex 2>&1
    if ($LASTEXITCODE -eq 0 -and ($out -join ' ') -notmatch 'fail|error|gagal') {
        Write-Host ("  [OK] {0,-18} -> if {1} via {2}  ({3})" -f $Prefix, $IfIndex, $Gw, $Ket) -ForegroundColor Green
    } else {
        Write-Host ("  [GAGAL] {0,-18}: {1}" -f $Prefix, (($out -join ' ').Trim())) -ForegroundColor Red
    }
}

# ====================================================================
# 1. DETEKSI ADAPTER & JARINGAN
# ====================================================================
Write-Host "[1/6] Mendeteksi adapter dan jaringan..." -ForegroundColor Yellow

$wifiAll = @(Get-NetAdapter | Where-Object {
    $_.Status -ne 'Not Present' -and ($_.InterfaceDescription -match 'Wireless|Wi-Fi|802\.11|WiFi' -or $_.Name -match '^Wi-Fi|WLAN')
})
# Wi-Fi untuk WLAN-NON-CORP = adapter yang SSID-nya WLAN-NON-CORP (bukan dongle yang tersambung ke HP/MiFi)
$wifi = Get-NonCorpWifi
$modeKantor = [bool]$wifi

# Coba sambung ke WLAN-NON-CORP bila SSID-nya terlihat tapi belum tersambung.
# Pakai adapter Wi-Fi yang BELUM tersambung ke jaringan lain (dongle yang dipakai Internet tidak diganggu),
# utamakan Wi-Fi bawaan laptop (bukan USB).
if (-not $modeKantor -and -not $NoConnect -and -not $DryRun -and $wifiAll) {
    $ssidsNow = Get-WlanSsids
    $bebas = @($wifiAll | Where-Object { -not $ssidsNow.ContainsKey($_.Name) })
    $kandidat = switch ($WifiNonCorp) {
        'Bawaan' { $wifiAll | Where-Object { $_.InterfaceDescription -notmatch 'USB' } | Select-Object -First 1 }
        'Dongle' { $wifiAll | Where-Object { $_.InterfaceDescription -match 'USB' } | Select-Object -First 1 }
        default  { $bebas | Sort-Object @{ Expression = { $_.InterfaceDescription -match 'USB' } } | Select-Object -First 1 }
    }
    $terlihat = (netsh wlan show networks 2>$null) -match "^\s*SSID \d+\s*:\s*$([regex]::Escape($SsidNonCorp))\s*$"
    if (-not $kandidat) {
        Write-Host "  [!] Semua adapter Wi-Fi sudah tersambung ke jaringan lain - $SsidNonCorp tidak disambungkan otomatis." -ForegroundColor Yellow
    } elseif ($terlihat) {
        Write-Host "  [..] SSID $SsidNonCorp terlihat, menyambungkan lewat $($kandidat.Name) (maks 25 dtk)..." -ForegroundColor Cyan
        netsh wlan connect name="$SsidNonCorp" interface="$($kandidat.Name)" | Out-Null
        $t = Get-Date
        do {
            Start-Sleep -Seconds 2
            $wifi = Get-NonCorpWifi
            $gwOk = $wifi -and [bool](Get-DefaultGateway $wifi.InterfaceIndex)
        } until ($gwOk -or ((Get-Date) - $t).TotalSeconds -gt 25)
        $modeKantor = [bool]$wifi
        if (-not $modeKantor) { Write-Host "  [!] Gagal tersambung ke $SsidNonCorp, lanjut sebagai MODE LUAR KANTOR." -ForegroundColor Yellow }
    }
}
$ssid = if ($wifi) { $SsidNonCorp } else { $null }

# aTrust: hanya adapter yang Up (ada adapter Sangfor lama 'Not Present' yang harus diabaikan)
$atrust = Get-NetAdapter | Where-Object {
    $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'aTrust|Sangfor' -or $_.Name -match 'aTrust|Sangfor')
} | Select-Object -First 1

# Jalur Internet (variabel $ethernet dipakai di bawah = "adapter Internet"):
#   - Ethernet : kabel LAN / tethering USB HP / adaptor USB-LAN yang Up dan punya gateway
#   - Dongle   : adapter Wi-Fi LAIN (bukan yang di WLAN-NON-CORP) yang Up dan punya gateway, mis. dongle USB ke MiFi/HP
# Mode Kantor tanpa Ethernet/dongle: Internet lewat WLAN-NON-CORP sendiri (seperti dulu).
$excludeIdx = @($wifi.InterfaceIndex, $atrust.InterfaceIndex) | Where-Object { $_ }
$kabel = @(Get-NetAdapter | Where-Object {
    $_.Status -eq 'Up' -and $excludeIdx -notcontains $_.InterfaceIndex -and
    $_.InterfaceDescription -notmatch 'aTrust|Sangfor|Virtual|Hyper-V|TAP|Fortinet|Loopback|Bluetooth|Wireless|Wi-Fi|802\.11' -and
    $_.Name -notmatch '^vEthernet' -and (Get-DefaultGateway $_.InterfaceIndex)
})
$dongle = @($wifiAll | Where-Object {
    $_.Status -eq 'Up' -and $excludeIdx -notcontains $_.InterfaceIndex -and (Get-DefaultGateway $_.InterfaceIndex)
})
$ethernet = switch ($Internet) {
    'Ethernet' { $kabel | Select-Object -First 1 }
    'Dongle'   { $dongle | Select-Object -First 1 }
    default    { @($kabel) + @($dongle) | Select-Object -First 1 }
}
if (-not $ethernet -and $Internet -ne 'Otomatis') {
    Write-Host "  [!] -Internet $Internet diminta tapi adapter itu tidak aktif / tanpa gateway; pakai yang tersedia." -ForegroundColor Yellow
    $ethernet = @($kabel) + @($dongle) | Select-Object -First 1
}
$jenisInternet = if (-not $ethernet) { '' } elseif ($dongle -contains $ethernet) { 'dongle Wi-Fi' } else { 'Ethernet/USB' }
# cadangan Internet lain yang Up (mis. Ethernet dicabut nanti) -> metric menengah, tidak menyalip jalur utama
$cadangan = @(@($kabel) + @($dongle) | Where-Object { $_ -and $_.InterfaceIndex -ne $ethernet.InterfaceIndex })

$wifiGw = $null; $ethGw = $null; $atrustGw = $null
if ($wifi)     { $wifiGw = Get-DefaultGateway $wifi.InterfaceIndex; if ($modeKantor -and -not $wifiGw) { $wifiGw = $GwNonCorpDefault } }
if ($ethernet) { $ethGw  = Get-DefaultGateway $ethernet.InterfaceIndex }
if ($atrust) {
    # aTrust tidak punya default route; ambil next-hop yang paling banyak dipakai rute VNIC-nya
    $atrustGw = (Get-NetRoute -InterfaceIndex $atrust.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                 Where-Object { $_.NextHop -ne '0.0.0.0' } | Group-Object NextHop |
                 Sort-Object Count -Descending | Select-Object -First 1).Name
    if (-not $atrustGw) {
        # VNIC tanpa next-hop (point-to-point): rutekan on-link lewat IP VNIC itu sendiri
        $atrustGw = '0.0.0.0'
    }
}

function Show-If($label, $ad, $gw, $extra) {
    if ($ad) {
        $ip = Get-IfIPv4 $ad.InterfaceIndex
        Write-Host ("  [+] {0,-14}: {1} (Index {2}, IP {3}, GW {4}) {5}" -f $label, $ad.Name, $ad.InterfaceIndex, $ip, $(if ($gw) { $gw } else { '-' }), $extra) -ForegroundColor Green
    } else {
        Write-Host ("  [-] {0,-14}: tidak aktif" -f $label) -ForegroundColor DarkGray
    }
}
$ssidMap = Get-WlanSsids
Show-If 'Internet'   $ethernet $ethGw    $(if ($ethernet) { "[$jenisInternet]" + $(if ($ssidMap[$ethernet.Name]) { " SSID: $($ssidMap[$ethernet.Name])" } else { '' }) } else { '' })
foreach ($c in $cadangan) { Show-If 'Cadangan' $c (Get-DefaultGateway $c.InterfaceIndex) '(Internet cadangan)' }
Show-If 'WLAN-NON-CORP' $wifi  $wifiGw   $(if ($ssid) { "SSID: $ssid" } else { '' })
Show-If 'aTrustVNIC' $atrust   $atrustGw ''
Write-Host ""
if ($modeKantor) {
    Write-Host "  >> MODE KANTOR: Wi-Fi tersambung ke $SsidNonCorp -> Dev/DB lewat Wi-Fi." -ForegroundColor Cyan
} else {
    Write-Host "  >> MODE LUAR KANTOR: Wi-Fi bukan $SsidNonCorp -> Dev/DB lewat aTrust (bila tersambung)." -ForegroundColor Cyan
    if (-not $atrust) { Write-Host "     aTrust belum tersambung. Sambungkan aTrust lalu jalankan ulang skrip ini." -ForegroundColor Yellow }
}
Write-Host ""

# ====================================================================
# 2. BERSIHKAN RUTE LAMA (AKTIF + PERSISTEN)
# ====================================================================
Write-Host "[2/6] Membersihkan rute lama milik skrip ini (aktif + persisten)..." -ForegroundColor Yellow
$total = 0
foreach ($p in $PrefixKelola) { $total += Remove-RouteBothStores $p }
# Rute /32 gateway lama (dipasang versi sebelumnya)
$total += Remove-RouteBothStores "$GwNonCorpDefault/32"
Write-Host "  [OK] $total entri rute lama dibersihkan." -ForegroundColor Green
Write-Host ""

# ====================================================================
# 3. PRIORITAS INTERNET
# ====================================================================
Write-Host "[3/6] Mengatur prioritas jalur Internet..." -ForegroundColor Yellow
if ($ethernet -and $ethGw) {
    if (-not $DryRun) { Set-NetIPInterface -InterfaceIndex $ethernet.InterfaceIndex -AddressFamily IPv4 -InterfaceMetric $MetricEthernet -ErrorAction SilentlyContinue }
    Write-Host "  [OK] $($ethernet.Name) metric = $MetricEthernet (Internet utama)." -ForegroundColor Green
    if ($wifi) {
        if (-not $DryRun) { Set-NetIPInterface -InterfaceIndex $wifi.InterfaceIndex -AddressFamily IPv4 -InterfaceMetric $MetricWifi -ErrorAction SilentlyContinue }
        Write-Host "  [OK] $($wifi.Name) metric = $MetricWifi (bukan jalur Internet utama)." -ForegroundColor Green
    }
    foreach ($c in $cadangan) {
        if (-not $DryRun) { Set-NetIPInterface -InterfaceIndex $c.InterfaceIndex -AddressFamily IPv4 -InterfaceMetric $MetricCadangan -ErrorAction SilentlyContinue }
        Write-Host "  [OK] $($c.Name) metric = $MetricCadangan (Internet cadangan)." -ForegroundColor Green
    }
} else {
    if ($ethernet) { Write-Host "  [!] $($ethernet.Name) Up tapi tanpa gateway; Internet lewat Wi-Fi." -ForegroundColor Yellow }
    else           { Write-Host "  [-] Ethernet tidak aktif; Internet lewat Wi-Fi." -ForegroundColor DarkGray }
    if ($wifi) {
        if (-not $DryRun) { Set-NetIPInterface -InterfaceIndex $wifi.InterfaceIndex -AddressFamily IPv4 -AutomaticMetric Enabled -ErrorAction SilentlyContinue }
        Write-Host "  [OK] $($wifi.Name) metric otomatis (jalur Internet)." -ForegroundColor Green
    }
}
Write-Host ""

# ====================================================================
# 4. PASANG RUTE SESUAI MODE
# ====================================================================
Write-Host "[4/6] Memasang rute (hanya aktif, tidak persisten)..." -ForegroundColor Yellow
if ($modeKantor -and $wifi -and $wifiGw) {
    foreach ($s in $SubnetNonCorp) { Add-Route $s $wifi.InterfaceIndex $wifiGw 'subnet via WLAN-NON-CORP' }
    foreach ($h in $Hosts)         { Add-Route "$($h.IP)/32" $wifi.InterfaceIndex $wifiGw $h.Nama }
} elseif ($atrust) {
    foreach ($h in $Hosts)         { Add-Route "$($h.IP)/32" $atrust.InterfaceIndex $atrustGw "$($h.Nama) via aTrust" }
} else {
    Write-Host "  [-] Tidak ada WLAN-NON-CORP maupun aTrust: rute Dev/DB tidak dipasang." -ForegroundColor DarkGray
}
if ($atrust) {
    Add-Route "$($HostAtrust.IP)/32" $atrust.InterfaceIndex $atrustGw $HostAtrust.Nama
} else {
    Write-Host "  [-] aTrust tidak aktif: rute $($HostAtrust.IP) dibiarkan ke aTrust saat tersambung nanti." -ForegroundColor DarkGray
}
Write-Host ""

# ====================================================================
# 5. HOSTS FILE
# ====================================================================
Write-Host "[5/6] Mendaftarkan hostname internal ke file hosts..." -ForegroundColor Yellow
try {
    $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
    $hostsContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
    $entries = @(
        '10.239.19.130  devbisssapp01  devbisssapp01.corp.bi.go.id',
        '10.239.14.38   devgmmpdbs01   devgmmpdbs01.corp.bi.go.id',
        '10.239.13.100  devbisssdbo01  devbisssdbo01.corp.bi.go.id',
        '10.230.84.29   DEV02          dev02                      dev02.corp.bi.go.id',
        '10.161.1.82    coordinator-impala.apps.dc1pdaecsr01.corp.bi.go.id',
        '10.161.10.135  dc1sssdb002.corp.bi.go.id  dc1sssdbo02.corp.bi.go.id  sss.corp.bi.go.id'
    )
    $toAdd = @()
    foreach ($e in $entries) {
        $parts = $e -split '\s+'
        if ($hostsContent -notmatch "(?m)^\s*$([regex]::Escape($parts[0]))\s+.*\b$([regex]::Escape($parts[1]))\b") { $toAdd += $e }
    }
    if ($toAdd.Count -gt 0 -and -not $DryRun) { Add-Content -Path $hostsPath -Value ($toAdd -join "`r`n") }
    Write-Host "  [OK] $($toAdd.Count) entri hosts baru ditambahkan (sisanya sudah ada)." -ForegroundColor Green
} catch {
    Write-Host "  [!] Gagal memperbarui file hosts: $($_.Exception.Message)" -ForegroundColor Red
}
if (-not $DryRun) { ipconfig /flushdns | Out-Null }
Write-Host ""

if ($DryRun) {
    Write-Host "Dry run selesai. Jalankan Aktifkan_3_Koneksi_Simultan.bat untuk menerapkan." -ForegroundColor Magenta
    return
}

# ====================================================================
# 6. VERIFIKASI JALUR & UJI KONEKSI
# ====================================================================
Write-Host "[6/6] Verifikasi jalur yang dipilih Windows + uji TCP..." -ForegroundColor Yellow
$semua = @($Hosts) + @($HostAtrust) + @(@{ IP = '1.1.1.1'; Port = 443; Nama = 'Internet' })
$gagal = 0
foreach ($h in $semua) {
    $r = Find-NetRoute -RemoteIPAddress $h.IP -ErrorAction SilentlyContinue | Where-Object DestinationPrefix | Select-Object -First 1
    $hasil = Test-PortQuick -TargetHost $h.IP -Port $h.Port
    $ok = $hasil -like 'OK*'
    if (-not $ok) { $gagal++ }
    $color = if ($ok) { 'Green' } else { 'Red' }
    Write-Host ("  {0,-20} {1,-15}:{2,-5} via {3,-14} => {4}" -f $h.Nama, $h.IP, $h.Port, $r.InterfaceAlias, $hasil) -ForegroundColor $color
}
Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
if ($gagal -eq 0) {
    Write-Host "SEMUA JALUR AKTIF (Internet + Dev/DB + aTrust)." -ForegroundColor Green
} else {
    Write-Host "$gagal target belum tersambung. Catatan:" -ForegroundColor Yellow
    Write-Host "  - AccessDenied (~5 dtk) = ditolak kebijakan aTrust, bukan masalah rute." -ForegroundColor Gray
    Write-Host "  - TIMEOUT di MODE LUAR KANTOR = host itu tidak tersedia lewat aTrust." -ForegroundColor Gray
    Write-Host "  - Gateway berubah tiap sambung ulang Wi-Fi/aTrust -> jalankan ulang skrip ini." -ForegroundColor Gray
}
Write-Host "====================================================================" -ForegroundColor Cyan
