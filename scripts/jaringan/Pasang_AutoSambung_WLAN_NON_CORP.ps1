<#
  Pasang_AutoSambung_WLAN_NON_CORP.ps1 - pasang / cabut Scheduled Task
  "ZeenIQ-AutoSambung-WLAN-NON-CORP" yang menjalankan Auto_Sambung_WLAN_NON_CORP.ps1
  (lihat komentar di skrip itu) tiap kali:

    - Wi-Fi putus          (Microsoft-Windows-WLAN-AutoConfig/Operational, Event 8003)
    - Wi-Fi tersambung     (Event 8001)  -> pasang ulang rute walau Windows sendiri yang menyambung
    - Login Windows        (tunda 40 dtk) -> rute non-persisten hilang tiap boot

  Task jalan sebagai USER YANG LOGIN SEKARANG dengan RunLevel Highest (bukan
  SYSTEM) supaya: 802.1X PEAP pakai kredensial cache user itu, dan browser
  portal ISE bisa dibuka di sesi desktop user kalau sesi ISE habis.
  Konsekuensi: user ini harus anggota Administrators (sama seperti syarat UAC
  tombol lain di tab Jaringan).

  Pemakaian (Administrator):
    -Pasang [-PaksaPindah] [-LogFile x] [-StatusFile y]   pasang/perbarui task
    -Cabut                                                hapus task
    -JalankanSekarang                                     picu task sekarang (uji)
    -Pasang -TampilkanXml                                 cetak XML task saja, tanpa admin (uji)
#>
param(
    [switch]$Pasang,
    [switch]$Cabut,
    [switch]$JalankanSekarang,
    [switch]$PaksaPindah,
    [switch]$TampilkanXml,
    [string]$LogFile = '',
    [string]$StatusFile = ''
)

$ErrorActionPreference = 'Stop'
$TaskName   = 'ZeenIQ-AutoSambung-WLAN-NON-CORP'
$AutoScript = Join-Path $PSScriptRoot 'Auto_Sambung_WLAN_NON_CORP.ps1'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $TampilkanXml) { Write-Host "[BERHENTI] Harus dijalankan sebagai Administrator." -ForegroundColor Red; exit 1 }

if ($Cabut) {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($t) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[OK] Task '$TaskName' dihapus. Wi-Fi tidak lagi disambungkan otomatis." -ForegroundColor Green
    } else {
        Write-Host "[OK] Task '$TaskName' memang belum terpasang." -ForegroundColor Green
    }
    exit 0
}

if ($JalankanSekarang) {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) { Write-Host "[BERHENTI] Task '$TaskName' belum terpasang - klik 'Pasang Auto-sambung' dulu." -ForegroundColor Red; exit 2 }
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "[OK] Task '$TaskName' dipicu. Hasil ditulis ke log/status (lihat status di tab Jaringan setelah ~30-60 dtk)." -ForegroundColor Green
    # Tunggu sebentar supaya hasil awal kebaca di jendela ini.
    $t0 = Get-Date
    do { Start-Sleep -Seconds 2; $st = (Get-ScheduledTask -TaskName $TaskName).State } until ($st -ne 'Running' -or ((Get-Date) - $t0).TotalSeconds -gt 90)
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host ("  State: {0} | Last run: {1} | Last result: {2}" -f $st, $info.LastRunTime, $info.LastTaskResult)
    $sf = ($t.Actions[0].Arguments -replace '.*-StatusFile\s+"([^"]+)".*', '$1')
    if ($sf -and (Test-Path $sf)) { Get-Content $sf -Raw | Write-Host }
    exit 0
}

if (-not $Pasang) { Write-Host "Pakai -Pasang, -Cabut, atau -JalankanSekarang."; exit 1 }
if (-not (Test-Path $AutoScript)) { Write-Host "[BERHENTI] $AutoScript tidak ditemukan." -ForegroundColor Red; exit 3 }

# User yang login (bukan SYSTEM). Saat dipanggil lewat UAC dari akun yang sama,
# ini = user desktop sekarang.
$userId = "$env:USERDOMAIN\$env:USERNAME"
$args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$AutoScript`"", '-Alasan', 'task')
if ($PaksaPindah) { $args += '-PaksaPindah' }
if ($LogFile)     { $args += @('-LogFile', "`"$LogFile`"") }
if ($StatusFile)  { $args += @('-StatusFile', "`"$StatusFile`"") }
$argLine = $args -join ' '

$subsWlan = @'
<QueryList><Query Id="0" Path="Microsoft-Windows-WLAN-AutoConfig/Operational"><Select Path="Microsoft-Windows-WLAN-AutoConfig/Operational">*[System[(EventID=8001 or EventID=8003)]]</Select></Query></QueryList>
'@.Trim()

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>ZeenIQ Dev Tools - sambung ulang Wi-Fi WLAN-NON-CORP otomatis, pasang ulang split routing 3 koneksi, cek sesi ISE (Cisco). Dipasang dari tab Jaringan 3 Koneksi.</Description>
    <Author>ZeenIQ Dev Tools</Author>
  </RegistrationInfo>
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>$([System.Security.SecurityElement]::Escape($subsWlan))</Subscription>
      <Delay>PT5S</Delay>
    </EventTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$([System.Security.SecurityElement]::Escape($userId))</UserId>
      <Delay>PT40S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$([System.Security.SecurityElement]::Escape($userId))</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$([System.Security.SecurityElement]::Escape($argLine))</Arguments>
      <WorkingDirectory>$([System.Security.SecurityElement]::Escape($PSScriptRoot))</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

if ($TampilkanXml) { Write-Output $xml; exit 0 }

Write-Host "Memasang task '$TaskName' untuk user $userId ..." -ForegroundColor Cyan
Write-Host "  Skrip   : $AutoScript"
Write-Host "  Pemicu  : Wi-Fi putus (8003) / tersambung (8001) / login Windows (+40 dtk)"
Write-Host "  Opsi    : paksa pindah dari SSID lain = $PaksaPindah"
if ($LogFile)    { Write-Host "  Log     : $LogFile" }
if ($StatusFile) { Write-Host "  Status  : $StatusFile" }

Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
$t = Get-ScheduledTask -TaskName $TaskName
Write-Host "[OK] Task terpasang (State: $($t.State))." -ForegroundColor Green
Write-Host "     Mulai sekarang: tiap WLAN-NON-CORP putus, Wi-Fi disambungkan lagi + rute Dev/DB dipasang ulang otomatis." -ForegroundColor Green
Write-Host "     Portal ISE (Cisco) hanya dibuka bila sesi ISE memang sudah habis." -ForegroundColor Green
exit 0
