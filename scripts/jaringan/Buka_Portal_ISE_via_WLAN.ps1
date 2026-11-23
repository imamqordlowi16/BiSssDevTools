# Buka portal ISE (DC1ISEPSN02) lewat WLAN-NON-CORP walau Ethernet tetap tersambung.
# Rute dipasang AKTIF saja (hilang saat reboot). Jalankan sebagai Administrator.
param([switch]$Hapus, [switch]$HanyaJikaCaptive)   # -Hapus = cabut NRPT & rute /32; -HanyaJikaCaptive = diam bila Wi-Fi sudah lolos portal / bukan WLAN-NON-CORP
$ErrorActionPreference = 'SilentlyContinue'
$Log = "$PSScriptRoot\Buka_Portal_ISE_via_WLAN.log"
Start-Transcript -Path $Log -Force | Out-Null
$IseHost = 'dc1isepsn02.corp.bi.go.id'
$Url     = "https://$IseHost`:8443/portal/ClientProvisionStart.action?from=CLIENT_PROVISION"
$DnsCorp = @('10.210.81.25','10.210.81.26')
$Nrpt    = '.corp.bi.go.id'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host "[BERHENTI] Harus dijalankan sebagai Administrator." -ForegroundColor Red; Stop-Transcript | Out-Null; exit 1 }

# -Hapus DULU, sebelum syarat Wi-Fi: harus bisa jalan walau Wi-Fi mati (mode
# Timesheet/omni). Aturan NRPT .corp.bi.go.id yang tertinggal mengarahkan semua
# nama *.corp.bi.go.id ke DNS corp yang cuma hidup lewat Wi-Fi -> saat Wi-Fi mati
# web BI gagal di-resolve. Rute /32 basi lewat gateway Wi-Fi lama (10.149.x) ikut
# dibuang. Tidak bergantung pada Wi-Fi tersambung / gateway sekarang.
if ($Hapus) {
    $nrpt = @(Get-DnsClientNrptRule | Where-Object { $_.Namespace -eq $Nrpt })
    if ($nrpt) { $nrpt | Remove-DnsClientNrptRule -Force; Write-Host "[OK] $($nrpt.Count) aturan NRPT $Nrpt dicabut." -ForegroundColor Green }
    else { Write-Host "[LEWAT] Tidak ada aturan NRPT $Nrpt." -ForegroundColor Green }
    $r32 = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -match '/32$' -and $_.NextHop -like '10.149.*' })
    if ($r32) { $r32 | Remove-NetRoute -Confirm:$false; Write-Host "[OK] $($r32.Count) rute /32 via gateway Wi-Fi lama (10.149.x) dicabut." -ForegroundColor Green }
    else { Write-Host "[LEWAT] Tidak ada rute /32 via 10.149.x." -ForegroundColor Green }
    ipconfig /flushdns | Out-Null
    Write-Host "[OK] Aturan ISE via Wi-Fi dibersihkan." -ForegroundColor Green
    Stop-Transcript | Out-Null; exit 0
}

# SSID per adapter dari netsh (BUKAN Get-NetConnectionProfile.Name - itu nama profil jaringan Windows,
# bisa "WLAN-NON-CORP 4"). Bisa ada 2 Wi-Fi (bawaan + dongle USB): pilih yang di WLAN-NON-CORP.
$ssidMap = @{}; $nm = $null
foreach ($l in (netsh wlan show interfaces 2>$null)) {
    if ($l -match '^\s*Name\s*:\s*(.+)$') { $nm = $Matches[1].Trim() }
    elseif ($nm -and $l -match '^\s*SSID\s*:\s*(.+)$') { $ssidMap[$nm] = $Matches[1].Trim() }
}
$wifiAllUp = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'Wireless|Wi-Fi|WLAN|802\.11' })
$wifi = $wifiAllUp | Where-Object { $ssidMap[$_.Name] -eq 'WLAN-NON-CORP' } | Select-Object -First 1
if (-not $wifi) { $wifi = $wifiAllUp | Select-Object -First 1 }
if (-not $wifi) { Write-Host "[BERHENTI] Wi-Fi tidak tersambung." -ForegroundColor Red; Stop-Transcript | Out-Null; exit 1 }
$ssid = $ssidMap[$wifi.Name]
$ssid = if ($ssid) { $ssid } else { (Get-NetConnectionProfile -InterfaceIndex $wifi.InterfaceIndex).Name }
$wifiGw = (Get-NetRoute -InterfaceIndex $wifi.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$wifiIp = (Get-NetIPAddress -InterfaceIndex $wifi.InterfaceIndex -AddressFamily IPv4).IPAddress
Write-Host "Wi-Fi: $($wifi.Name) ($ssid)  IP=$wifiIp  GW=$wifiGw"
if (-not $wifiGw) { Write-Host "[BERHENTI] Wi-Fi tidak punya gateway DHCP." -ForegroundColor Red; Stop-Transcript | Out-Null; exit 1 }
if ($HanyaJikaCaptive) {
    if ($ssid -ne 'WLAN-NON-CORP') { Write-Host "[LEWAT] Wi-Fi bukan WLAN-NON-CORP ($ssid)."; Stop-Transcript | Out-Null; exit 0 }
    $probe = & curl.exe -s -m 8 --interface $wifiIp -o NUL -D - http://detectportal.firefox.com/success.txt 2>$null
    if (-not ($probe -match 'Location:.*corp\.bi\.go\.id')) { Write-Host "[LEWAT] WLAN-NON-CORP sudah lolos captive portal ISE, tidak perlu buka portal." -ForegroundColor Green; Stop-Transcript | Out-Null; exit 0 }
    Write-Host "WLAN-NON-CORP masih di captive portal ISE -> buka portal lewat Wi-Fi." -ForegroundColor Yellow
}

# (-Hapus sudah ditangani di atas, sebelum syarat Wi-Fi.)

# 1. Buang rute basi yang next-hop-nya bukan gateway Wi-Fi sekarang (aktif + persisten)
Write-Host "[1/4] Bersihkan rute basi ke 10.x via Wi-Fi ..."
foreach ($store in 'ActiveStore','PersistentStore') {
    Get-NetRoute -AddressFamily IPv4 -PolicyStore $store | Where-Object {
        $_.DestinationPrefix -like '10.*' -and $_.NextHop -ne '0.0.0.0' -and $_.NextHop -like '10.149.*' -and $_.NextHop -ne $wifiGw
    } | ForEach-Object { Write-Host "   hapus [$store] $($_.DestinationPrefix) via $($_.NextHop)"; $_ | Remove-NetRoute -PolicyStore $store -Confirm:$false }
}

# 2. Rute ke DNS corp & subnet 10.210/16 via Wi-Fi (aktif saja)
Write-Host "[2/4] Pasang rute 10.210.0.0/16 via $wifiGw ..."
if (-not (Get-NetRoute -DestinationPrefix '10.210.0.0/16' -AddressFamily IPv4 | Where-Object NextHop -eq $wifiGw)) {
    route.exe add 10.210.0.0 mask 255.255.0.0 $wifiGw metric 1 if $wifi.InterfaceIndex | Out-Null
}

# 3. DNS: nama *.corp.bi.go.id selalu ditanya ke DNS corp lewat Wi-Fi (NRPT), lalu resolve host ISE
Write-Host "[3/4] Aturan NRPT $Nrpt -> $($DnsCorp -join ',') ..."
Get-DnsClientNrptRule | Where-Object { $_.Namespace -eq $Nrpt } | Remove-DnsClientNrptRule -Force
Add-DnsClientNrptRule -Namespace $Nrpt -NameServers $DnsCorp -Comment 'ISE portal via WLAN-NON-CORP' | Out-Null
ipconfig /flushdns | Out-Null
$iseIp = $null
foreach ($s in $DnsCorp) { $iseIp = (Resolve-DnsName $IseHost -Server $s -Type A -QuickTimeout | Where-Object IPAddress).IPAddress | Select-Object -First 1; if ($iseIp) { break } }
if (-not $iseIp) {
    Write-Host "[GAGAL] $IseHost tidak bisa di-resolve lewat DNS corp ($($DnsCorp -join ',')) via Wi-Fi." -ForegroundColor Red
    Write-Host "        Cek: ping -S $wifiIp 10.210.81.25 ; pastikan Wi-Fi masih $ssid." -ForegroundColor Yellow
    Stop-Transcript | Out-Null; exit 2
}
Write-Host "   $IseHost = $iseIp"

# 4. Rute /32 ke ISE via Wi-Fi, uji TCP 8443, buka browser
Write-Host "[4/4] Rute $iseIp/32 via $wifiGw & uji port 8443 ..."
Get-NetRoute -DestinationPrefix "$iseIp/32" -AddressFamily IPv4 | Where-Object NextHop -ne $wifiGw | Remove-NetRoute -Confirm:$false
if (-not (Get-NetRoute -DestinationPrefix "$iseIp/32" -AddressFamily IPv4)) { route.exe add $iseIp mask 255.255.255.255 $wifiGw metric 1 if $wifi.InterfaceIndex | Out-Null }
$t = Test-NetConnection $iseIp -Port 8443 -WarningAction SilentlyContinue
$via = (Find-NetRoute -RemoteIPAddress $iseIp | Where-Object DestinationPrefix | Select-Object -First 1)
Write-Host ("   jalur: {0} via {1}  | TCP 8443: {2}" -f $via.DestinationPrefix, $via.NextHop, $(if ($t.TcpTestSucceeded) {'OK'} else {'GAGAL'})) -ForegroundColor $(if ($t.TcpTestSucceeded) {'Green'} else {'Red'})
# Ambil URL redirect captive portal (berisi sessionId+token) dengan probe HTTP yang dipaksa keluar lewat Wi-Fi
$redir = $null
try { $hdr = & curl.exe -s -m 8 --interface $wifiIp -o NUL -D - http://detectportal.firefox.com/success.txt 2>$null
      $redir = ($hdr | Select-String -Pattern '^Location:\s*(\S+)' | Select-Object -First 1).Matches.Groups[1].Value } catch {}
if ($redir -match 'corp\.bi\.go\.id') { Write-Host "   URL redirect ISE (dengan sessionId) ditemukan."; $Url = $redir }
else { Write-Host "   Tidak ada redirect captive portal via Wi-Fi (mungkin sudah lolos provisioning); buka URL langsung." -ForegroundColor Yellow }
if ($t.TcpTestSucceeded) { Start-Process $Url; Write-Host "[OK] Portal dibuka di browser. Setelah provisioning selesai, boleh jalankan: -Hapus" -ForegroundColor Green }
Stop-Transcript | Out-Null


