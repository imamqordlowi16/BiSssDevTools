<#
  Pasang_LoginOtomatis_MiFi.ps1 - kelola login otomatis portal WLAN-PUBLIC-BI
  lewat MiFi Huawei (lihat Login_Otomatis_MiFi_Portal.ps1). TIDAK butuh admin:
  task jalan sebagai user ini (RunLevel Limited), tanpa rute permanen.

    -SimpanKredensial [-CredFile x]                 dialog Windows -> file DPAPI (hanya user ini)
    -HapusKredensial  [-CredFile x]
    -Pasang [-LogFile x] [-StatusFile y] [-CredFile z]   task tiap 2 menit + saat login
    -Cabut                                          hapus task
    -JalankanSekarang                               jalankan watchdog sekarang (output tampil)
#>
param(
    [switch]$SimpanKredensial,
    [switch]$HapusKredensial,
    [switch]$Pasang,
    [switch]$Cabut,
    [switch]$JalankanSekarang,
    [string]$LogFile = '',
    [string]$StatusFile = '',
    [string]$CredFile = ''
)
$ErrorActionPreference = 'Stop'
$TaskName = 'ZeenIQ-LoginOtomatis-MiFi-Portal'
$Watchdog = Join-Path $PSScriptRoot 'Login_Otomatis_MiFi_Portal.ps1'
if (-not $CredFile) { $CredFile = Join-Path (Join-Path $env:LOCALAPPDATA 'ZeenIQDevTools') 'mifi-portal.cred.xml' }

if ($SimpanKredensial) {
    $c = Get-Credential -Message 'Username & password portal WLAN-PUBLIC-BI (Cisco ISE "Sign On")'
    if (-not $c -or -not $c.UserName) { Write-Host '[BATAL] Kredensial tidak disimpan.' -ForegroundColor Yellow; exit 1 }
    $d = Split-Path $CredFile -Parent; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    $c | Export-Clixml -Path $CredFile
    Write-Host "[OK] Kredensial '$($c.UserName)' tersimpan terenkripsi (DPAPI, hanya user $env:USERNAME di PC ini): $CredFile" -ForegroundColor Green
    exit 0
}

if ($HapusKredensial) {
    Remove-Item $CredFile -ErrorAction SilentlyContinue
    Write-Host "[OK] Kredensial dihapus." -ForegroundColor Green
    exit 0
}

if ($Cabut) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[OK] Task '$TaskName' dihapus - login portal kembali manual." -ForegroundColor Green
    } else { Write-Host "[OK] Task '$TaskName' memang belum terpasang." -ForegroundColor Green }
    exit 0
}

if ($JalankanSekarang) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Watchdog, '-Alasan', 'Uji')
    if ($LogFile) { $a += @('-LogFile', $LogFile) }; if ($StatusFile) { $a += @('-StatusFile', $StatusFile) }; if ($CredFile) { $a += @('-CredFile', $CredFile) }
    & powershell.exe @a
    exit $LASTEXITCODE
}

if ($Pasang) {
    if (-not (Test-Path $Watchdog)) { Write-Host "[BERHENTI] Skrip watchdog tidak ada: $Watchdog" -ForegroundColor Red; exit 1 }
    if (-not (Test-Path $CredFile)) { Write-Host "[PERINGATAN] Kredensial belum disimpan - task tetap dipasang, tapi login baru jalan setelah 'Simpan Kredensial'." -ForegroundColor Yellow }
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$Watchdog`" -Alasan Jadwal -CredFile `"$CredFile`""
    if ($LogFile)    { $arg += " -LogFile `"$LogFile`"" }
    if ($StatusFile) { $arg += " -StatusFile `"$StatusFile`"" }
    # conhost --headless: tidak ada jendela konsol yang berkedip tiap 2 menit.
    $action    = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless powershell.exe $arg"
    $user      = "$env:USERDOMAIN\$env:USERNAME"
    $tJadwal   = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
    $tLogon    = New-ScheduledTaskTrigger -AtLogOn -User $user
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $tJadwal, $tLogon -Settings $settings -Principal $principal `
        -Description 'ZeenIQ Dev Tools: login otomatis portal Cisco ISE WLAN-PUBLIC-BI lewat MiFi HUAWEI-7492 (tiap 2 menit, hanya bila sesi habis).' -Force | Out-Null
    Write-Host "[OK] Task '$TaskName' terpasang untuk $user - cek tiap 2 menit + saat login, tanpa admin." -ForegroundColor Green
    exit 0
}

Write-Host 'Pakai: -SimpanKredensial | -HapusKredensial | -Pasang | -Cabut | -JalankanSekarang' -ForegroundColor Yellow
exit 1
