<#
  Hotspot_DevDb.ps1 - bagikan akses server Dev/DB (lewat WLAN-NON-CORP) ke perangkat yang menyambung
  ke Mobile Hotspot laptop ini.

  Kenapa bukan NAT: hotspot Windows hanya me-NAT lalu lintas yang keluar lewat koneksi yang dibagikan
  (internet/modem), dan NetNat hanya punya SATU alamat luar (terbukti 26-11: sesi ke DB disamarkan
  dengan IP modem 192.168.100.100 lalu dikirim lewat WLAN-NON-CORP -> tidak pernah dibalas).
  Jadi laptop ini jadi PERANTARA (netsh portproxy): perangkat hotspot menyambung ke
  192.168.137.<24x>:<port>, laptop ini menyambung ke server aslinya dengan alamatnya sendiri.

  Tiap server (HostDev di Data\jaringan-ip.json) dapat alamat perantara sendiri di adapter hotspot
  (192.168.137.240 + urutan) dengan PORT YANG SAMA -> perangkat teman cukup memetakan nama server ke
  alamat itu di file hosts-nya (connection string tidak berubah).

    Hotspot_DevDb.ps1 -Pasang [-OutDir <folder>]          (Administrator) pasang semua penerusan + firewall
    Hotspot_DevDb.ps1 -Cabut                               (Administrator) hapus semuanya
    Hotspot_DevDb.ps1 -Status                              JSON penerusan yang aktif
    Hotspot_DevDb.ps1 -BuatSkripTeman [-OutDir <folder>]   (tanpa admin) buat ulang skrip laptop teman
  -Pasang juga menulis <OutDir>\Hotspot_LaptopTeman.ps1 (pasang/hapus nama server di laptop teman).
  Penerusan lain (mis. buatan sendiri di 0.0.0.0) TIDAK disentuh - hanya alamat 192.168.137.x.
#>
param([switch]$Pasang, [switch]$Cabut, [switch]$Status, [switch]$BuatSkripTeman, [string]$OutDir = '')
$ErrorActionPreference = 'Continue'
$RuleGroup = 'ZeenIQ Hotspot DevDB'
$AliasBase = 240
. "$PSScriptRoot\_KonfigJaringan.ps1"
$K = Get-KonfigJaringan
if (-not $OutDir) { $OutDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\Data')) }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# adapter hotspot = yang punya 192.168.137.1 (dibuat Windows saat hotspot menyala)
function Get-HotspotIf {
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq '192.168.137.1' } | Select-Object -First 1
}
function Get-Proxies {
    $list = @()
    foreach ($l in (netsh interface portproxy show v4tov4 2>$null)) {
        if ($l -match '^\s*(192\.168\.137\.\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s*$') {
            $list += [pscustomobject]@{ Listen = $Matches[1]; ListenPort = [int]$Matches[2]; Connect = $Matches[3]; ConnectPort = [int]$Matches[4] }
        }
    }
    return $list
}
function Remove-All {
    foreach ($p in @(Get-Proxies)) {
        netsh interface portproxy delete v4tov4 listenaddress=$($p.Listen) listenport=$($p.ListenPort) | Out-Null
    }
    Get-NetFirewallRule -Group $RuleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    Get-NetFirewallRule -DisplayName 'ZeenIQ Hotspot DB uji' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^192\.168\.137\.(\d+)$' -and [int]$Matches[1] -ge $AliasBase -and [int]$Matches[1] -lt 255 } |
        Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
}

# Skrip untuk laptop teman: pasang/hapus nama server di file hosts-nya.
# Baris LAMA untuk nama yang sama (mis. "10.239.19.130 devbisssapp01") dinonaktifkan sementara (diberi
# tanda) - kalau tidak, Windows mencoba alamat lama dulu (26-11: "TCP connect to 10.239.19.130:80 failed"
# sebelum memakai alamat perantara). -Hapus mengembalikan baris lama itu.
function New-FriendScript([string[]]$entri) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    $path = Join-Path $OutDir 'Hotspot_LaptopTeman.ps1'
    $list = ($entri | ForEach-Object { "'$_'" }) -join ', '
    $contoh = if ($entri.Count) { ($entri[0] -split '\s+')[1] } else { 'devbisssapp01' }
    $tpl = @'
# Jalankan di LAPTOP TEMAN (PowerShell sebagai Administrator) saat tersambung ke hotspot.
#   powershell -ExecutionPolicy Bypass -File Hotspot_LaptopTeman.ps1          -> pasang nama server Dev/DB + DNS internet 8.8.8.8
#   powershell -ExecutionPolicy Bypass -File Hotspot_LaptopTeman.ps1 -Hapus   -> kembalikan file hosts & DNS seperti semula
# Dibuat ZeenIQ Dev Tools __WAKTU__. Server diakses lewat laptop pemancar hotspot.
param([switch]$Hapus, [string]$HostsFile = "$env:SystemRoot\System32\drivers\etc\hosts")
$f = $HostsFile
$awal = '# >>> ZeenIQ Hotspot DevDB'; $akhir = '# <<< ZeenIQ Hotspot DevDB'; $tanda = '#ZEENIQ-HOTSPOT# '
$entri = @(__ENTRI__)
$nama = @($entri | ForEach-Object { (($_ -split '\s+')[1]).ToLower() })
$out = @(); $skip = $false; $dimatikan = 0
if (-not (Test-Path $f) -or (Get-Item $f).Length -eq 0) {
    Write-Host "PERINGATAN: file hosts kosong/tidak ada. Pulihkan dulu (lihat petunjuk ZeenIQ) sebelum memasang." -ForegroundColor Yellow
}
foreach ($l in @(Get-Content $f -ErrorAction SilentlyContinue)) {
    if ($l -eq $awal) { $skip = $true; continue }
    if ($l -eq $akhir) { $skip = $false; continue }
    if ($skip) { continue }
    if ($l.StartsWith($tanda)) { $l = $l.Substring($tanda.Length) }   # pulihkan baris lama
    if (-not $Hapus) {
        $t = @((($l -replace '#.*', '').Trim()) -split '\s+' | Where-Object { $_ })
        if ($t.Count -ge 2 -and @($t[1..($t.Count - 1)] | Where-Object { $nama -contains $_.ToLower() }).Count -gt 0) { $l = $tanda + $l; $dimatikan++ }
    }
    $out += $l
}
if (-not $Hapus) { $out += $awal; $out += $entri; $out += $akhir }
# AMAN: jangan pernah menimpa langsung. Dulu Set-Content mengosongkan file dulu lalu gagal menulis
# karena hosts dikunci antivirus ("being used by another process") -> file hosts teman jadi 0 byte.
# Sekarang: cadangan sekali (isi asli), tulis ke file sementara, lalu ganti dengan coba-ulang.
$bak = "$f.zeeniq-backup"
if (-not (Test-Path $bak) -and (Test-Path $f) -and (Get-Item $f).Length -gt 0) { Copy-Item $f $bak -Force }
$tmp = "$f.zeeniq-tmp"
[IO.File]::WriteAllLines($tmp, [string[]]$out, [Text.Encoding]::ASCII)
$ok = $false
for ($i = 0; $i -lt 10 -and -not $ok; $i++) {
    try { Copy-Item $tmp $f -Force -ErrorAction Stop; $ok = ((Get-Item $f).Length -eq (Get-Item $tmp).Length) } catch { Start-Sleep -Milliseconds 700 }
}
Remove-Item $tmp -ErrorAction SilentlyContinue
if (-not $ok) {
    Write-Host "GAGAL menulis file hosts (dikunci program lain, mis. antivirus). File hosts TIDAK diubah. Coba lagi beberapa saat lagi." -ForegroundColor Red
    if (Test-Path $bak) { Write-Host "Cadangan isi asli: $bak" -ForegroundColor Yellow }
    exit 1
}
# ---- DNS internet: DNS bawaan hotspot Windows (192.168.137.1) sering tidak menjawab -> pakai
# 8.8.8.8/8.8.4.4 di adapter yang tersambung ke hotspot. Pengaturan asli dicatat dan dikembalikan
# oleh -Hapus (DNS menempel di adapter, bukan di jaringan -> perlu dikembalikan di Wi-Fi kantor).
$dnsCatat = Join-Path $env:ProgramData 'ZeenIQ-Hotspot-DNS.txt'
if ($Hapus) {
    if (Test-Path $dnsCatat) {
        $alias, $lama = (Get-Content $dnsCatat -Raw).Trim() -split '\|', 2
        if ($lama -eq 'DHCP') { Set-DnsClientServerAddress -InterfaceAlias $alias -ResetServerAddresses -ErrorAction SilentlyContinue }
        else { Set-DnsClientServerAddress -InterfaceAlias $alias -ServerAddresses ($lama -split ',') -ErrorAction SilentlyContinue }
        Remove-Item $dnsCatat -ErrorAction SilentlyContinue
        "DNS adapter '$alias' dikembalikan ($lama)."
    }
} else {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.137.*' } | Select-Object -First 1
    if (-not $ip) {
        Write-Host "Laptop ini belum tersambung ke hotspot (tidak ada alamat 192.168.137.x) - DNS tidak diubah. Sambungkan lalu jalankan lagi." -ForegroundColor Yellow
    } else {
        $alias = $ip.InterfaceAlias
        if (-not (Test-Path $dnsCatat)) {   # catat hanya sekali = pengaturan asli
            $reg = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$((Get-NetAdapter -InterfaceAlias $alias).InterfaceGuid)" -ErrorAction SilentlyContinue).NameServer
            $lama = if ([string]::IsNullOrWhiteSpace($reg)) { 'DHCP' } else { ($reg -split '[ ,]+' | Where-Object { $_ }) -join ',' }
            Set-Content -Path $dnsCatat -Value "$alias|$lama" -Encoding ASCII
        }
        Set-DnsClientServerAddress -InterfaceAlias $alias -ServerAddresses '8.8.8.8', '8.8.4.4'
        "DNS adapter '$alias' diatur ke 8.8.8.8 / 8.8.4.4 (dikembalikan dengan -Hapus)."
    }
}
ipconfig /flushdns | Out-Null
if ($Hapus) { 'File hosts dikembalikan seperti semula.' }
else { "Nama server Dev/DB dipasang ($dimatikan baris lama dinonaktifkan sementara). Uji: Test-NetConnection __CONTOH__ -Port 80" }
'@
    $isi = $tpl.Replace('__ENTRI__', $list).Replace('__WAKTU__', (Get-Date -Format 'yyyy-MM-dd HH:mm')).Replace('__CONTOH__', $contoh)
    Set-Content -Path $path -Value $isi -Encoding UTF8
    return $path
}

# ---- IIS/http.sys lokal vs port 80 di alamat perantara ----
# IIS (http.sys, PID 4) mendengarkan port 80 di SEMUA alamat -> 192.168.137.24x:80 dijawab IIS laptop
# ini, bukan diteruskan (26-11: laptop teman melihat halaman IIS laptop ini / 404). Solusi: daftar
# "iplisten" http.sys diisi semua alamat laptop KECUALI 192.168.137.x -> IIS tetap jalan di localhost,
# IP WLAN-NON-CORP, IP modem, dst.; alamat hotspot bebas untuk portproxy. Yang ditambahkan dicatat di
# file supaya -Cabut hanya menghapus milik skrip ini.
$IpListenFile = Join-Path $OutDir 'hotspot-iplisten.txt'
function Get-IpListen { @(netsh http show iplisten 2>$null | Where-Object { $_ -match '^\s+(\S+)\s*$' -and $_ -notmatch '[-:]{5}' } | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[0-9a-fA-F:.]+$' }) }
function Restart-HttpSys {
    # menghentikan http.sys ikut menghentikan IIS & layanan HTTP lain; nyalakan lagi yang tadinya jalan
    $jalan = @(Get-Service W3SVC, WAS, iphlpsvc -ErrorAction SilentlyContinue | Where-Object Status -eq 'Running' | ForEach-Object Name)
    net stop http /y 2>&1 | Out-Null
    foreach ($s in @('WAS', 'W3SVC', 'iphlpsvc')) { if ($jalan -contains $s) { Start-Service $s -ErrorAction SilentlyContinue } }
}
function Set-IisAwayFromHotspot {
    if (-not (Get-Service W3SVC -ErrorAction SilentlyContinue)) { return }
    $ada = Get-IpListen
    $mau = @('127.0.0.1', '::1') + @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '192.168.137.*' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
        ForEach-Object IPAddress)
    $baru = @($mau | Where-Object { $ada -notcontains $_ } | Select-Object -Unique)
    if (-not $baru.Count) { return }
    foreach ($ip in $baru) { netsh http add iplisten ipaddress=$ip 2>&1 | Out-Null }
    Add-Content -Path $IpListenFile -Value $baru -Encoding ASCII
    Restart-HttpSys
    Write-Host "  [i] IIS laptop ini tidak lagi menjawab di alamat hotspot (tetap di: $($mau -join ', '))." -ForegroundColor DarkGray
}
function Undo-IisAwayFromHotspot {
    if (-not (Test-Path $IpListenFile)) { return }
    foreach ($ip in @(Get-Content $IpListenFile | Where-Object { $_ })) { netsh http delete iplisten ipaddress=$ip 2>&1 | Out-Null }
    Remove-Item $IpListenFile -ErrorAction SilentlyContinue
    Restart-HttpSys
    Write-Host '  [i] IIS laptop ini kembali mendengarkan di semua alamat.' -ForegroundColor DarkGray
}

# ---- penerusan LAMA di 0.0.0.0 (semua alamat) dengan port yang sama ----
# 26-11: aturan lama "0.0.0.0:1521 -> 10.161.10.135" merebut SEMUA sambungan 1521 (termasuk ke
# 192.168.137.241) -> DB teman mendarat di server yang salah (ORA-12514). Selama berbagi, aturan lama
# dengan port bentrok dinonaktifkan sementara, dicatat, dan dikembalikan persis oleh -Cabut.
$OldRulesFile = Join-Path $OutDir 'hotspot-portproxy-lama.txt'
function Get-WildcardProxies {
    $list = @()
    foreach ($l in (netsh interface portproxy show v4tov4 2>$null)) {
        if ($l -match '^\s*(0\.0\.0\.0|\*)\s+(\d+)\s+(\S+)\s+(\d+)\s*$') {
            $list += [pscustomobject]@{ Listen = $Matches[1]; ListenPort = [int]$Matches[2]; Connect = $Matches[3]; ConnectPort = [int]$Matches[4] }
        }
    }
    return $list
}
function Suspend-ConflictingOld([int[]]$ports) {
    $bentrok = @(Get-WildcardProxies | Where-Object { $ports -contains $_.ListenPort })
    foreach ($o in $bentrok) {
        Add-Content -Path $OldRulesFile -Value "$($o.Listen)|$($o.ListenPort)|$($o.Connect)|$($o.ConnectPort)" -Encoding ASCII
        netsh interface portproxy delete v4tov4 listenaddress=$($o.Listen) listenport=$($o.ListenPort) | Out-Null
        Write-Host "  [i] Penerusan lama $($o.Listen):$($o.ListenPort) -> $($o.Connect):$($o.ConnectPort) dinonaktifkan sementara (bentrok)." -ForegroundColor DarkGray
    }
}
function Restore-OldRules {
    if (-not (Test-Path $OldRulesFile)) { return }
    foreach ($l in @(Get-Content $OldRulesFile | Where-Object { $_ })) {
        $a, $p, $c, $cp = $l -split '\|'
        netsh interface portproxy add v4tov4 listenaddress=$a listenport=$p connectaddress=$c connectport=$cp | Out-Null
        Write-Host "  [i] Penerusan lama $($a):$p -> $($c):$cp dikembalikan." -ForegroundColor DarkGray
    }
    Remove-Item $OldRulesFile -ErrorAction SilentlyContinue
}

if ($Status) {
    $hs = Get-HotspotIf
    $px = @(Get-Proxies)
    [ordered]@{
        ok = $true; hotspot = [bool]$hs; count = $px.Count
        items = @($px | ForEach-Object {
            $c = $_; $h = $K.HostDev | Where-Object { $_.IP -eq $c.Connect } | Select-Object -First 1
            [ordered]@{ nama = "$($h.Nama)"; alias = $c.Listen; port = $c.ListenPort; server = "$($c.Connect):$($c.ConnectPort)" } })
    } | ConvertTo-Json -Compress -Depth 4
    exit 0
}

if ($BuatSkripTeman) {
    $e = @()
    foreach ($p in @(Get-Proxies)) {
        $h = $K.HostDev | Where-Object { $_.IP -eq $p.Connect } | Select-Object -First 1
        foreach ($n in @($h.Hostname)) { if ($n) { $e += "$($p.Listen)  $n" } }
    }
    $e = @($e | Select-Object -Unique)
    if (-not $e.Count) { Write-Host 'Belum ada penerusan aktif - klik Bagikan Dev/DB dulu.'; exit 2 }
    Write-Host "[OK] Skrip laptop teman: $(New-FriendScript $e)"
    exit 0
}

if (-not $admin) { Write-Host '[BERHENTI] Perlu Administrator (portproxy, firewall, alamat IP).' -ForegroundColor Red; exit 1 }

if ($Cabut) {
    Remove-All
    Restore-OldRules
    Undo-IisAwayFromHotspot
    Restart-Service iphlpsvc -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Penerusan Dev/DB untuk hotspot dihapus (portproxy, firewall '$RuleGroup', alamat perantara)." -ForegroundColor Green
    exit 0
}

if (-not $Pasang) { Write-Host 'Pakai -Pasang, -Cabut, -Status, atau -BuatSkripTeman.'; exit 1 }

$hs = Get-HotspotIf
if (-not $hs) { Write-Host '[BERHENTI] Hotspot belum menyala (tidak ada adapter 192.168.137.1). Nyalakan hotspot dulu.' -ForegroundColor Red; exit 2 }

# portproxy butuh layanan IP Helper
Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service iphlpsvc -ErrorAction SilentlyContinue

Remove-All
Restore-OldRules   # pemasangan ulang: kembalikan dulu yang pernah dinonaktifkan, lalu nilai ulang
# server web (port 80/443) diteruskan -> pastikan IIS laptop ini tidak "merebut" alamat hotspot
if (@($K.HostDev | Where-Object { $_.Port -in 80, 443 }).Count) { Set-IisAwayFromHotspot }
$hosts = @($K.HostDev)
Suspend-ConflictingOld @($hosts | ForEach-Object { [int]$_.Port } | Select-Object -Unique)
$baris = @()
$i = 0
foreach ($h in $hosts) {
    $alias = "192.168.137.$($AliasBase + $i)"; $i++
    New-NetIPAddress -InterfaceIndex $hs.InterfaceIndex -IPAddress $alias -PrefixLength 24 -SkipAsSource $true -ErrorAction SilentlyContinue | Out-Null
    netsh interface portproxy add v4tov4 listenaddress=$alias listenport=$($h.Port) connectaddress=$($h.IP) connectport=$($h.Port) | Out-Null
    New-NetFirewallRule -DisplayName "ZeenIQ Hotspot DevDB - $($h.Nama)" -Group $RuleGroup -Direction Inbound -Protocol TCP `
        -LocalAddress $alias -LocalPort $h.Port -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
    # uji: laptop ini bisa menjangkau server aslinya?
    $c = New-Object Net.Sockets.TcpClient; $ok = $false
    try { $ok = $c.ConnectAsync($h.IP, [int]$h.Port).Wait(3000) } catch {} finally { $c.Close() }
    Write-Host ("  [{0}] {1,-20} {2}:{3,-5} -> {4}:{5}" -f $(if ($ok) { 'OK' } else { '!!' }), $h.Nama, $alias, $h.Port, $h.IP, $h.Port) -ForegroundColor $(if ($ok) { 'Green' } else { 'Yellow' })
    foreach ($n in @($h.Hostname)) { if ($n) { $baris += "$alias  $n" } }
}

# Layanan portproxy (iphlpsvc) hanya mencoba bind saat aturan ditambahkan / saat start - alamat
# perantara yang masih "Tentative" (baru dibuat) gagal di-bind dan TIDAK dicoba lagi (26-11: tidak satu
# pun 192.168.137.24x LISTENING). Tunggu alamat siap, lalu start ulang layanan dan periksa.
for ($w = 0; $w -lt 20; $w++) {
    $belum = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.137.2*' -and $_.AddressState -ne 'Preferred' })
    if (-not $belum.Count) { break }; Start-Sleep -Milliseconds 500
}
Restart-Service iphlpsvc -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$listen = @(netstat -ano -p tcp | Select-String 'LISTENING' | ForEach-Object { ($_.Line.Trim() -split '\s+')[1] })
$gagal = @()
$i = 0
foreach ($h in $hosts) {
    $alias = "192.168.137.$($AliasBase + $i)"; $i++
    if ($listen -notcontains "$($alias):$($h.Port)") { $gagal += "$($h.Nama) ($($alias):$($h.Port))" }
}

$teman = New-FriendScript $baris
Write-Host ""
if ($gagal.Count) { Write-Host "[!] Belum aktif mendengarkan: $($gagal -join ', ') - port itu dipakai program lain di laptop ini." -ForegroundColor Yellow }
Write-Host "[OK] $($hosts.Count - $gagal.Count)/$($hosts.Count) server Dev/DB aktif dibagikan ke perangkat hotspot." -ForegroundColor Green
Write-Host "     Untuk laptop teman: salin & jalankan (Admin) $teman" -ForegroundColor Cyan
