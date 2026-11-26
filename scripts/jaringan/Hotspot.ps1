<#
  Hotspot.ps1 - kendalikan Mobile Hotspot Windows (berbagi internet laptop ini ke laptop/HP lain
  lewat Wi-Fi). Memakai API WinRT NetworkOperatorTetheringManager - sama dengan Setelan Windows >
  Jaringan > Hotspot seluler. TIDAK butuh admin.

    Hotspot.ps1 -Status                     JSON: status, SSID, band, klien, sumber internet, daftar sumber
    Hotspot.ps1 -Nyalakan [-Sumber <nama>]  nyalakan (sumber = nama profil koneksi berinternet; kosong = internet utama)
    Hotspot.ps1 -Matikan
    Hotspot.ps1 -Atur -Ssid <nama> [-Band Auto|TwoPointFourGigahertz|FiveGigahertz] [-Sumber <nama>]
        kata sandi dibaca dari STDIN (baris pertama) - tidak pernah lewat command line.
        STDIN kosong = kata sandi tidak diubah.
  Output selalu satu baris JSON (dibaca ZeenIQ Dev Tools).
#>
param(
    [switch]$Status, [switch]$Nyalakan, [switch]$Matikan, [switch]$Atur,
    [string]$Ssid = '', [string]$Band = '', [string]$Sumber = ''
)
$ErrorActionPreference = 'Stop'

function Out-Json($o) { $o | ConvertTo-Json -Compress -Depth 5; exit 0 }
function Fail([string]$m) { [ordered]@{ ok = $false; error = $m } | ConvertTo-Json -Compress; exit 1 }

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime] | Out-Null
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null
} catch { Fail "API Mobile Hotspot Windows tidak tersedia: $($_.Exception.Message)" }

# ---- tunggu operasi async WinRT ----
$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAct = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, [Type]$t) { $task = $asTaskOp.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(30000) | Out-Null; $task.Result }
function AwaitAction($op) { $task = $asTaskAct.Invoke($null, @($op)); $task.Wait(30000) | Out-Null }

$NI = [Windows.Networking.Connectivity.NetworkInformation]
$TM = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]

# profil koneksi yang punya internet (calon sumber)
$profiles = @($NI::GetConnectionProfiles() | Where-Object { $_.GetNetworkConnectivityLevel() -eq 'InternetAccess' })
function Get-SourceProfile {
    if ($Sumber) {
        $p = $profiles | Where-Object { $_.ProfileName -eq $Sumber } | Select-Object -First 1
        if (-not $p) { Fail "Sumber internet '$Sumber' tidak tersambung / tidak punya internet." }
        return $p
    }
    $p = $NI::GetInternetConnectionProfile()
    if (-not $p) { Fail 'Laptop ini tidak punya koneksi internet untuk dibagikan.' }
    return $p
}

$src = Get-SourceProfile
$cap = $TM::GetTetheringCapabilityFromConnectionProfile($src)
if ("$cap" -ne 'Enabled') { Fail "Hotspot tidak bisa dipakai untuk '$($src.ProfileName)': $cap (kartu Wi-Fi/kebijakan Windows tidak mengizinkan)." }
$m = $TM::CreateFromConnectionProfile($src)

function Get-State {
    $c = $m.GetCurrentAccessPointConfiguration()
    $clients = @()
    if ("$($m.TetheringOperationalState)" -eq 'On') {
        try {
            foreach ($cl in $m.GetTetheringClients()) {
                # HostNames berisi campuran nama komputer & alamat IP -> pisahkan
                $hn = @($cl.HostNames | ForEach-Object { "$($_.DisplayName)" } | Where-Object { $_ })
                $ip = @($hn | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' })
                $nm = @($hn | Where-Object { $_ -notmatch '^\d+\.\d+\.\d+\.\d+$' -and $_ -notmatch ':' })
                $mac = "$($cl.MacAddress)"
                if (-not $ip.Count) {   # cadangan: tabel ARP adapter hotspot
                    $ip = @(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                        Where-Object { $_.IPAddress -like '192.168.137.*' -and ($_.LinkLayerAddress -replace '-', ':') -eq $mac } |
                        ForEach-Object IPAddress)
                }
                $clients += [ordered]@{ mac = $mac; nama = ($nm -join ', '); ip = ($ip -join ', ') }
            }
        } catch {}
    }
    $bandOk = @{}
    foreach ($b in 'TwoPointFourGigahertz', 'FiveGigahertz') { try { $bandOk[$b] = [bool]$c.IsBandSupported($b) } catch { $bandOk[$b] = $false } }
    [ordered]@{
        ok = $true
        state = "$($m.TetheringOperationalState)"
        ssid = $c.Ssid
        passphrase = $c.Passphrase
        band = "$($c.Band)"
        band24 = $bandOk['TwoPointFourGigahertz']; band5 = $bandOk['FiveGigahertz']
        clientCount = $m.ClientCount; maxClients = $m.MaxClientCount
        clients = $clients
        source = $src.ProfileName
        sources = @($profiles | ForEach-Object { $_.ProfileName })
    }
}

if ($Status) { Out-Json (Get-State) }

if ($Atur) {
    $c = $m.GetCurrentAccessPointConfiguration()
    if ($Ssid) {
        if ($Ssid.Length -gt 32) { Fail 'Nama hotspot maksimal 32 karakter.' }
        $c.Ssid = $Ssid
    }
    $pw = [Console]::In.ReadLine()
    if ($pw) {
        if ($pw.Length -lt 8 -or $pw.Length -gt 63) { Fail 'Kata sandi hotspot harus 8-63 karakter.' }
        $c.Passphrase = $pw
    }
    if ($Band) {
        if ($Band -ne 'Auto' -and -not $c.IsBandSupported($Band)) { Fail "Frekuensi $Band tidak didukung kartu Wi-Fi ini." }
        $c.Band = $Band
    }
    $wasOn = "$($m.TetheringOperationalState)" -eq 'On'
    AwaitAction ($m.ConfigureAccessPointAsync($c))
    # pengaturan baru berlaku setelah hotspot dinyalakan ulang
    if ($wasOn) {
        Await ($m.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) | Out-Null
        Await ($m.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) | Out-Null
    }
    Out-Json (Get-State)
}

if ($Nyalakan -or $Matikan) {
    $op = if ($Nyalakan) { $m.StartTetheringAsync() } else { $m.StopTetheringAsync() }
    $r = Await $op ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    if ("$($r.Status)" -ne 'Success') {
        $msg = if ($r.AdditionalErrorMessage) { $r.AdditionalErrorMessage } else { "$($r.Status)" }
        Fail "Gagal $(if ($Nyalakan) {'menyalakan'} else {'mematikan'}) hotspot: $msg"
    }
    Start-Sleep -Milliseconds 800
    Out-Json (Get-State)
}

Fail 'Pakai -Status, -Nyalakan, -Matikan, atau -Atur.'
