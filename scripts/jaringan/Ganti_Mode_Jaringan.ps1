<#
  Ganti_Mode_Jaringan.ps1 - Tombol "Mode Dev/DB" & "Mode Timesheet (omni)".

  Latar: di laptop ini omni (Sangfor aTrust) dan WLAN-NON-CORP TIDAK bisa dipakai
  bersamaan untuk hal yang sama. Selama omni aktif, agen Sangfor:
    - memutus Wi-Fi tiap tunnel tersambung ("disconnected by the driver"), dan
    - mencegat SEMUA TCP ke 10.x di laptop apa pun tabel rutenya (ping tembus,
      TCP ditutup lokal < 1 ms) kecuali alamat yang dikecualikan profil aTrust.
  Jadi Dev/DB 10.239/10.230/10.161 hanya jalan saat omni OFF; timesheets
  (http://10.28.224.55:8080) & DB 10.28.x hanya jalan saat omni ON.

  Skrip ini TIDAK menyentuh agen aTrust sama sekali (putus/sambung omni tetap
  manual dari ikon tray - pilihan user). Yang diurus cuma Wi-Fi, rute, aturan
  DNS sisa, dan Scheduled Task auto-sambung, supaya keduanya tidak saling pukul.

    MODE DevDb     : pastikan WLAN-NON-CORP + split routing terpasang, auto-sambung
                     dihidupkan lagi, lalu uji satu host Dev. Kalau omni masih
                     aktif -> peringatkan (Dev/DB tetap dicegat sampai omni diputus).
    MODE Timesheet : hentikan auto-sambung (biar Wi-Fi berhenti nyambung ulang &
                     dipukul aTrust), cabut aturan NRPT ISE yang bikin DNS corp jadi
                     lubang hitam saat Wi-Fi mati, lalu ingatkan sambungkan omni.

  Jalankan sebagai Administrator. Dipanggil tab "Jaringan 3 Koneksi" (ElevatedRunner).

  Pemakaian:
    Ganti_Mode_Jaringan.ps1 -Mode DevDb
    Ganti_Mode_Jaringan.ps1 -Mode Timesheet
#>
param(
    [Parameter(Mandatory)][ValidateSet('DevDb', 'Timesheet')][string]$Mode
)

$ErrorActionPreference = 'Continue'
$SsidNonCorp  = 'WLAN-NON-CORP'   # ditimpa dari pengaturan di bawah
$TaskName     = 'ZeenIQ-AutoSambung-WLAN-NON-CORP'
$Nrpt         = '.corp.bi.go.id'
$SetupScript  = Join-Path $PSScriptRoot 'setup_3_koneksi.ps1'
$IseScript    = Join-Path $PSScriptRoot 'Buka_Portal_ISE_via_WLAN.ps1'
. "$PSScriptRoot\_KonfigJaringan.ps1"; $K = Get-KonfigJaringan   # IP dari Data\jaringan-ip.json
$TimesheetUrl = $K.Timesheet.Url
$DevProbe     = $K.ProbeDev
$TsProbe      = $K.Timesheet
$SsidNonCorp  = $K.SsidNonCorp

function Log([string]$Msg, [string]$Color = 'Gray') { Write-Host $Msg -ForegroundColor $Color }
function Test-Port([string]$IP, [int]$Port, [int]$TimeoutMs = 4000) {
    $c = New-Object System.Net.Sockets.TcpClient
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $a = $c.BeginConnect($IP, $Port, $null, $null)
        if ($a.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            try { $c.EndConnect($a); return "OK ($($sw.ElapsedMilliseconds) ms)" }
            catch { return "$($_.Exception.InnerException.SocketErrorCode) ($($sw.ElapsedMilliseconds) ms)" }
        }
        return 'TIMEOUT'
    } catch { return 'ERROR' } finally { $c.Close() }
}
function Get-Atrust {
    Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
        $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'aTrust|Sangfor' -or $_.Name -match 'aTrust|Sangfor')
    } | Select-Object -First 1
}
function Get-CurrentSsid {
    $line = (netsh wlan show interfaces 2>$null) | Where-Object { $_ -match '^\s*SSID\s*:\s*(.+)$' } | Select-Object -First 1
    if ($line -match '^\s*SSID\s*:\s*(.+)$') { return $Matches[1].Trim() }
    return $null
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Log '[BERHENTI] Harus dijalankan sebagai Administrator.' 'Red'; exit 1 }

Log '====================================================================' 'Cyan'
Log "   GANTI MODE JARINGAN -> $Mode" 'Cyan'
Log '   (omni/aTrust tetap diputus/disambung manual dari ikon tray)' 'Cyan'
Log '====================================================================' 'Cyan'
Log ''

$atrust = Get-Atrust

switch ($Mode) {

    'DevDb' {
        # Dev/DB 10.x lewat WLAN-NON-CORP. Butuh omni OFF.
        if ($atrust) {
            Log '[PERINGATAN] omni (aTrust) MASIH AKTIF.' 'Yellow'
            Log '  Selama omni nyala, Sangfor mencegat semua koneksi ke server Dev/DB 10.x' 'Yellow'
            Log '  (ping tembus tapi koneksi ditutup di laptop) DAN sering memutus Wi-Fi.' 'Yellow'
            Log '  >> Putuskan omni dari ikon aTrust di tray (klik kanan -> Disconnect),' 'Yellow'
            Log '     lalu klik "Mode Dev/DB" ini sekali lagi. Rute tetap dipasang sekarang' 'Yellow'
            Log '     supaya begitu omni mati, Dev/DB langsung jalan.' 'Yellow'
            Log ''
        }

        # 1. Hidupkan lagi auto-sambung (kalau terpasang & sempat dimatikan mode Timesheet)
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            if ($task.State -eq 'Disabled') { Enable-ScheduledTask -TaskName $TaskName | Out-Null; Log "[OK] Auto-sambung $SsidNonCorp dihidupkan lagi." 'Green' }
            else { Log "[OK] Auto-sambung $SsidNonCorp sudah aktif." 'Green' }
        } else {
            Log "[INFO] Auto-sambung belum dipasang (opsional: tombol 'Pasang Auto-sambung')." 'DarkGray'
        }
        Log ''

        # 2. Pasang WLAN-NON-CORP + split routing (setup_3_koneksi.ps1 menyambung Wi-Fi sendiri bila SSID terlihat)
        if (-not (Test-Path $SetupScript)) { Log "[BERHENTI] setup_3_koneksi.ps1 tidak ditemukan di $PSScriptRoot" 'Red'; exit 2 }
        Log '[..] Memasang WLAN-NON-CORP + split routing 3 koneksi...' 'Cyan'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
        Log ''

        # 3. Uji satu host Dev
        $ssid = Get-CurrentSsid
        $hasil = Test-Port $DevProbe.IP $DevProbe.Port
        Log "[UJI] $($DevProbe.Nama) $($DevProbe.IP):$($DevProbe.Port) => $hasil" ($(if ($hasil -like 'OK*') { 'Green' } else { 'Red' }))
        Log ''
        if ($hasil -like 'OK*') {
            Log "[SELESAI] Mode Dev/DB aktif. Wi-Fi: $ssid. Server Dev/DB lewat WLAN-NON-CORP jalan." 'Green'
        } elseif (Get-Atrust) {
            Log "[SELESAI] Rute sudah dipasang, TAPI omni masih aktif -> Dev/DB masih dicegat. Putus omni dari tray, lalu jalankan lagi." 'Yellow'
        } else {
            Log "[SELESAI] Rute dipasang tapi uji Dev gagal. Cek Wi-Fi tersambung ke $SsidNonCorp (sekarang: $(if ($ssid) { $ssid } else { '-' })) & portal ISE lewat tombol 'Buka Portal ISE via Wi-Fi'." 'Yellow'
        }
    }

    'Timesheet' {
        # Timesheets/DB 10.28.x lewat omni. Wi-Fi WLAN-NON-CORP tidak diperlukan,
        # dan auto-sambung yang terus menyambung ulang Wi-Fi malah dipukul aTrust.
        # 1. Hentikan auto-sambung
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            if ($task.State -ne 'Disabled') { Disable-ScheduledTask -TaskName $TaskName | Out-Null; Log "[OK] Auto-sambung $SsidNonCorp dihentikan (biar Wi-Fi tidak terus nyambung & dipukul omni)." 'Green' }
            else { Log "[OK] Auto-sambung $SsidNonCorp memang sudah berhenti." 'Green' }
        } else {
            Log "[INFO] Auto-sambung tidak terpasang - tidak ada yang dihentikan." 'DarkGray'
        }

        # 2. Cabut aturan NRPT ISE sisa (bikin DNS corp jadi lubang hitam saat Wi-Fi mati)
        if (Test-Path $IseScript) {
            Log '[..] Mencabut aturan NRPT/rute ISE sisa (Buka_Portal_ISE_via_WLAN.ps1 -Hapus)...' 'Cyan'
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $IseScript -Hapus
        } else {
            $nrpt = @(Get-DnsClientNrptRule | Where-Object { $_.Namespace -eq $Nrpt })
            if ($nrpt) { $nrpt | Remove-DnsClientNrptRule -Force; ipconfig /flushdns | Out-Null; Log "[OK] $($nrpt.Count) aturan NRPT $Nrpt dicabut." 'Green' }
        }
        Log ''

        # 3. Status omni + ingatkan sambungkan dari tray
        if ($atrust) {
            Log '[OK] omni (aTrust) terdeteksi aktif.' 'Green'
        } else {
            Log '[PERLU AKSI] omni (aTrust) belum aktif.' 'Yellow'
            Log '  >> Sambungkan omni dari ikon aTrust di tray (klik kanan -> Connect / login).' 'Yellow'
        }
        Log ''

        # 4. Uji timesheets (cuma berhasil kalau omni sudah tersambung)
        $hasil = Test-Port $TsProbe.IP $TsProbe.Port
        Log "[UJI] $($TsProbe.Nama) $($TsProbe.IP):$($TsProbe.Port) => $hasil" ($(if ($hasil -like 'OK*') { 'Green' } else { 'Yellow' }))
        if ($hasil -like 'OK*') {
            Log "[SELESAI] Mode Timesheet aktif - $TimesheetUrl siap dibuka." 'Green'
            try { Start-Process $TimesheetUrl } catch {}
        } else {
            Log "[SELESAI] Auto-sambung berhenti & DNS dibereskan. Timesheets belum tembus - sambungkan omni dari tray dulu, lalu buka $TimesheetUrl." 'Yellow'
        }
    }
}

exit 0
