<#
  Login_Otomatis_MiFi_Portal.ps1 - watchdog login portal tamu Cisco ISE
  (WLAN-PUBLIC-BI) untuk MiFi Huawei (HUAWEI-7492, subnet 192.168.8.x).

  Alur: MiFi (Wi-Fi Extender) tersambung ke WLAN-PUBLIC-BI -> laptop tersambung
  ke MiFi (Wi-Fi bawaan ATAU dongle USB). Sesi portal ISE diikat ke MAC MiFi;
  bila habis, semua HTTP dibelokkan ke https://<ise>:8443/portal/gateway?...
  Skrip ini mendeteksinya lalu mengisi form "Sign On" (user.username /
  user.password / token) dengan kredensial tersimpan.

  SEMUA request di-bind ke IP MiFi (curl --interface) - tidak perlu rute
  permanen / admin, dan Ethernet + rute ISE WLAN-NON-CORP tidak terganggu.
  Password: dibaca dari file DPAPI (Export-Clixml, hanya user ini yang bisa
  membuka), dikirim ke curl lewat STDIN (-K -), tidak pernah di command line.

  Dijalankan Scheduled Task "ZeenIQ-LoginOtomatis-MiFi-Portal" tiap 2 menit
  (lihat Pasang_LoginOtomatis_MiFi.ps1). Uji manual tanpa mengirim login:
    powershell -File Login_Otomatis_MiFi_Portal.ps1 -DryRun
    powershell -File Login_Otomatis_MiFi_Portal.ps1 -DryRun -PortalUrl "<url portal>"
#>
param(
    [string]$LogFile = '',
    [string]$StatusFile = '',
    [string]$CredFile = '',
    [string]$Alasan = 'Manual',
    # Subnet MiFi/modem yang tersambung lewat Wi-Fi ATAU kabel USB (RNDIS): HUAWEI 192.168.8.x, XinXun 192.168.100.x
    [string[]]$MifiSubnet = @('192.168.8.', '192.168.100.'),
    [string[]]$Ssids = @('WLAN-PUBLIC-BI', 'HUAWEI-7492', 'XinXun-7787'),   # XinXun-7787 = modem 4G dengan 'Internet Wi-Fi' ke WLAN-PUBLIC-BI
    [string]$PortalUrl = '',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'ZeenIQDevTools'
if (-not $CredFile)   { $CredFile   = Join-Path $base 'mifi-portal.cred.xml' }
if (-not $LogFile)    { $LogFile    = Join-Path $base 'mifi-portal-login.log' }
if (-not $StatusFile) { $StatusFile = Join-Path $base 'mifi-portal-login.status.json' }
foreach ($f in $LogFile, $StatusFile) { $d = Split-Path $f -Parent; if ($d -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }

$curl  = Join-Path $env:SystemRoot 'System32\curl.exe'
$ua    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
$probe = 'http://connectivitycheck.gstatic.com/generate_204'
$mulai = (Get-Date).ToString('s')
$interaktif = $DryRun -or $PortalUrl -or $Alasan -eq 'Manual'

function Log([string]$m) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Alasan] $m"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    if ($interaktif) { Write-Host $line }
}
function Status([string]$hasil, [string]$pesan, $captive = $null, [string]$ip = '') {
    [ordered]@{
        WaktuMulai = $mulai; WaktuSelesai = (Get-Date).ToString('s'); Alasan = $Alasan
        Hasil = $hasil; Pesan = $pesan; Ssid = 'WLAN-PUBLIC-BI (via MiFi)'; Gateway = $ip; Captive = $captive
    } | ConvertTo-Json | Set-Content -Path $StatusFile -Encoding UTF8
}
function Selesai([string]$hasil, [string]$pesan, $captive = $null, [string]$ip = '', [int]$code = 0, [switch]$TanpaLog) {
    if (-not $TanpaLog) { Log "[$hasil] $pesan" }
    Status $hasil $pesan $captive $ip
    exit $code
}

# Satu instance saja (task tiap 2 menit + tombol Uji bisa tumpang tindih).
$mutex = New-Object Threading.Mutex($false, 'Local\ZeenIQ-LoginOtomatis-MiFi-Portal')
if (-not $mutex.WaitOne(0)) { if ($interaktif) { Write-Host 'Instance lain sedang jalan - lewati.' }; exit 0 }

# Log dipangkas > 1 MB.
if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) {
    Get-Content $LogFile -Tail 2000 | Set-Content "$LogFile.tmp" -Encoding UTF8; Move-Item "$LogFile.tmp" $LogFile -Force
}

# 1. Adapter Wi-Fi (bawaan ATAU dongle USB) yang tersambung ke WLAN-PUBLIC-BI langsung atau ke MiFi.
#    Dicari per SSID dari `netsh wlan show interfaces` (bisa >1 adapter), fallback subnet MiFi.
$ip = $null; $via = $null
$blok = (netsh wlan show interfaces | Out-String) -split '(?m)^\s*Name\s*:\s*'
foreach ($b in $blok) {
    $nama = ($b -split "`r?`n")[0].Trim()
    $ssid = [regex]::Match($b, '(?m)^\s*SSID\s*:\s*(.+?)\s*$').Groups[1].Value
    $state = [regex]::Match($b, '(?m)^\s*State\s*:\s*(.+?)\s*$').Groups[1].Value
    if (-not $nama -or $state -ne 'connected' -or $Ssids -notcontains $ssid) { continue }
    $a = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $nama -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
    if ($a) { $ip = $a.IPAddress; $via = "$nama/$ssid"; break }
}
if (-not $ip) {
    $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $ipx = $_.IPAddress; @($MifiSubnet | Where-Object { $ipx.StartsWith($_) }).Count -gt 0 } | Select-Object -First 1
    if ($a) { $ip = $a.IPAddress; $via = "$($a.InterfaceAlias)/MiFi" }
}
if (-not $ip) { Selesai 'LEWAT' "Tidak ada Wi-Fi yang tersambung ke $($Ssids -join ' / ') - lewati." -TanpaLog:(-not $interaktif) }

$jar = [IO.Path]::GetTempFileName()
$OutputEncoding = New-Object Text.UTF8Encoding($false)   # stdin ke curl: UTF-8 (password non-ASCII aman)
function CurlMifi([string[]]$a, [string]$stdin = $null) {
    $args2 = @('-s', '-k', '-m', '20', '--interface', $ip, '-A', $ua, '-c', $jar, '-b', $jar) + $a
    if ($null -ne $stdin) { return (($stdin | & $curl @args2) -join "`n") }
    return ((& $curl @args2) -join "`n")
}
function PortalDariProbe([string]$resp) {
    $m = [regex]::Match($resp, '(?im)^Location:\s*(https://\S+/portal/gateway\S*)')
    if (-not $m.Success) { $m = [regex]::Match($resp, 'URL=(https://[^"\s]+/portal/gateway[^"\s]*)') }
    if ($m.Success) { return [Net.WebUtility]::HtmlDecode($m.Groups[1].Value) } else { return $null }
}
function PisahUrl([string]$resp) {
    $i = $resp.LastIndexOf('__URL__')
    if ($i -lt 0) { return @($resp, '') }
    return @($resp.Substring(0, $i), $resp.Substring($i + 7).Trim())
}
function Cfg([string]$s) { $s.Replace('\', '\\').Replace('"', '\"') }

try {
    # 2. Cek internet lewat MiFi.
    if (-not $PortalUrl) {
        $r = CurlMifi @('-i', $probe)
        if ($r -match '^HTTP/\S+ 204') { Selesai 'OK' "Online lewat $via ($ip) - sesi portal masih berlaku." $false $ip -TanpaLog:(-not $interaktif) }
        $PortalUrl = PortalDariProbe $r
        if (-not $PortalUrl) {
            $snip = if ($r) { ($r.Substring(0, [Math]::Min(120, $r.Length)) -replace "`r?`n", ' | ') } else { '(tidak ada respons)' }
            Selesai 'GAGAL' "Tidak online & tidak ada redirect portal ISE: $snip (MiFi belum tersambung ke WLAN-PUBLIC-BI?)" $null $ip 2
        }
    }
    Log "Sesi portal habis -> $(([uri]$PortalUrl).GetLeftPart('Path'))"

    # 3. Buka portal, ambil token form Sign On.
    $page, $url = PisahUrl (CurlMifi @('-L', '-w', '__URL__%{url_effective}', $PortalUrl))
    if (-not $url) { Selesai 'GAGAL' "Portal ISE tidak menjawab lewat $via." $true $ip 3 }
    $origin = ([uri]$url).GetLeftPart('Authority')
    $token  = [regex]::Match($page, 'name="token" value="([^"]+)"').Groups[1].Value
    $portal = [regex]::Match($page, 'name="portal" value="([^"]+)"').Groups[1].Value
    if (-not $token -or $page -notmatch 'LoginSubmit\.action') { Selesai 'GAGAL' 'Form login (LoginSubmit.action) tidak ditemukan di halaman portal.' $true $ip 3 }

    if ($DryRun) { Selesai 'OK' "DryRun: form login ditemukan (token $($token.Substring(0, [Math]::Min(6, $token.Length)))..., portal $portal). Login TIDAK dikirim." $true $ip }

    # 4. Kirim login (kredensial lewat stdin).
    if (-not (Test-Path $CredFile)) { Selesai 'GAGAL' "Kredensial belum disimpan ($CredFile) - klik 'Simpan Kredensial' di tab Jaringan." $true $ip 4 }
    $c = Import-Clixml $CredFile
    $cfg = "data-urlencode = `"user.username=$(Cfg $c.UserName)`"`n" +
           "data-urlencode = `"user.password=$(Cfg $c.GetNetworkCredential().Password)`"`n" +
           "data-urlencode = `"token=$(Cfg $token)`"`n" +
           "data-urlencode = `"portal=$(Cfg $portal)`"`n"
    $resp, $url = PisahUrl (CurlMifi @('-L', '-K', '-', '-w', '__URL__%{url_effective}', "$origin/portal/LoginSubmit.action?from=LOGIN") $cfg)
    $cfg = $null; $c = $null

    # 5. Halaman lanjutan (AUP / Continue) bila portal memintanya.
    for ($i = 0; $i -lt 3; $i++) {
        # Halaman Sign On memuat form tersembunyi AupView.action (hanya MELIHAT AUP) - jangan dikirim.
        # Masih ada form login = login belum lolos -> berhenti.
        if ($resp -match 'LoginSubmit\.action') { break }
        $f = [regex]::Match($resp, '<form[^>]*action="([^"]*(AupSubmit|Continue|PostAccess|Success)[^"]*)"', 'IgnoreCase')
        if (-not $f.Success) { break }
        $a = @('-L', '-w', '__URL__%{url_effective}')
        foreach ($h in [regex]::Matches($resp, '<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"')) { $a += @('--data-urlencode', "$($h.Groups[1].Value)=$($h.Groups[2].Value)") }
        if ($f.Groups[1].Value -match 'Aup') { $a += @('--data-urlencode', 'aupAccepted=true') }
        $act = $f.Groups[1].Value
        if ($act -notmatch '^https?:') { $act = if ($act.StartsWith('/')) { "$origin$act" } else { "$origin/portal/$act" } }
        $resp, $url = PisahUrl (CurlMifi ($a + $act))
    }
    # 5b. Halaman "Success": sejak 24-11 siang ISE TIDAK langsung membuka internet - JavaScript halaman
    #     itu (page.init doCoA:'true') yang memanggil DoCoA.action lalu memantau CheckCoAStatus.action.
    #     Tanpa langkah ini login "berhasil" tapi tetap tertahan portal (terbukti di HP 25-11:
    #     DoCoA -> {"status":"success"} -> CheckCoAStatus -> "complete" -> online).
    $sukses = ($resp -match '(?is)<title[^>]*>\s*Success\s*</title>') -or ($resp -match 'You now have Internet access')
    if ($resp -match "doCoA\s*:\s*'true'") {
        $js = { param($k) [regex]::Match($resp, "\b$k\s*:\s*'([^']*)'").Groups[1].Value }
        $coaUrl = & $js 'coaUrl'; if (-not $coaUrl) { $coaUrl = 'DoCoA.action' }
        $pollUrl = & $js 'coaPollingUrl'
        $delay = [regex]::Match($resp, "\bcoaDelay\s*:\s*'?(\d+)").Groups[1].Value; if (-not $delay) { $delay = '2' }
        $tok = [regex]::Match($resp, 'name="token"\s+value="([^"]+)"').Groups[1].Value; if (-not $tok) { $tok = $token }
        $sid = & $js 'sessionId'
        $base = if ($url) { ([uri]$url).GetLeftPart('Path') -replace '[^/]*$', '' } else { "$origin/portal/" }
        Log "Login diterima portal - meminta akses dibuka ($coaUrl)..."
        Start-Sleep -Seconds ([int]$delay)
        $a = @('--data-urlencode', "delayToCoA=$delay", '--data-urlencode', "coaType=$(& $js 'coaType')",
               '--data-urlencode', "coaSource=$(& $js 'coaSource')", '--data-urlencode', "coaReason=$(& $js 'coaReason')",
               '--data-urlencode', 'waitForCoA=true', '--data-urlencode', "token=$tok")
        if ($sid) { $a += @('--data-urlencode', "portalSessionId=$sid") }
        $r = CurlMifi ($a + "$base$coaUrl")
        Log "DoCoA: $(($r -replace '\s+', ' ').Substring(0, [Math]::Min(160, ($r -replace '\s+', ' ').Length)))"
        if ($pollUrl) {
            for ($i = 0; $i -lt 5; $i++) {
                Start-Sleep -Seconds 2
                $p = CurlMifi @('--data-urlencode', "token=$tok", "$base$pollUrl")
                if ($p -match '(?i)success|complete') { Log "CheckCoAStatus: $(($p -replace '\s+', ' ').Substring(0, [Math]::Min(120, ($p -replace '\s+', ' ').Length)))"; break }
            }
        }
    }

    # Halaman Success memuat templat popup "Your session has timed out" - itu BUKAN error.
    $pesanPortal = if ($sukses) { '' } else { [regex]::Match($resp, '(?is)class="[^"]*(error|cisco-ise-login-error|ui-state-error|alert)[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,200})').Groups[2].Value.Trim() }
    if (-not $pesanPortal -and -not $sukses) {
        # pesan umum ISE yang tidak selalu ber-class error
        $pesanPortal = [regex]::Match($resp, '(?i)(maximum[^<]{0,80}|exceed[^<]{0,80}|expired[^<]{0,80}|suspended[^<]{0,80}|invalid[^<]{0,80}|not authorized[^<]{0,80}|batas[^<]{0,80}|kedaluwarsa[^<]{0,80})').Groups[1].Value.Trim()
    }
    # Simpan halaman terakhir dari portal (tanpa nilai input tersembunyi/token) untuk dianalisis kalau gagal.
    $jejak = "$LogFile.terakhir.html"
    try {
        "<!-- $(Get-Date -Format s) URL: $url -->`n" + ($resp -replace '(?i)(value=")[^"]*(")', '$1***$2') | Set-Content -Path $jejak -Encoding UTF8
    } catch {}

    # 6. Verifikasi.
    #    ISE butuh waktu menerapkan otorisasi (CoA): 23-11 16:35 cek 5 detik -> masih portal ("GAGAL"),
    #    padahal beberapa saat kemudian ONLINE. Jadi cek ulang tiap 5 detik sampai 30 detik.
    for ($i = 0; $i -lt 6; $i++) {
        Start-Sleep -Seconds 5
        if ((CurlMifi @('-i', $probe)) -match '^HTTP/\S+ 204') { Selesai 'OK' "Login portal BERHASIL - internet lewat $via aktif lagi ($ip), $(5 * ($i + 1)) detik setelah login." $true $ip }
    }
    Selesai 'GAGAL' ("Login dikirim tapi masih ditahan portal." + $(if ($pesanPortal) { " Pesan portal: $pesanPortal" } else { " Tidak ada pesan error dari portal - halaman terakhir disimpan di $jejak untuk dicek." })) $true $ip 5
}
finally {
    Remove-Item $jar -ErrorAction SilentlyContinue
    $mutex.ReleaseMutex()
}
