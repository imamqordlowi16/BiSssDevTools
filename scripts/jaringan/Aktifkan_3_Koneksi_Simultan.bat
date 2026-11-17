@echo off
title Aktifkan 3 Koneksi (Ethernet + WLAN-NON-CORP + Sangfor aTrust)
cd /d "%~dp0"

:: [AUTO-ELEVATE] Cek hak Administrator, jika belum otomatis minta UAC
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Meminta izin Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: [1] Split routing 3 koneksi (Ethernet=Internet, WLAN-NON-CORP=Dev/DB, aTrust)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_3_koneksi.ps1"

:: [2] Bila WLAN-NON-CORP masih tertahan captive portal ISE (dc1isepsn02), buka portalnya
::     lewat Wi-Fi walau Ethernet tetap tersambung. Diam bila sudah lolos / bukan WLAN-NON-CORP.
echo.
echo ====================================================================
echo [ISE] Cek captive portal WLAN-NON-CORP...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Buka_Portal_ISE_via_WLAN.ps1" -HanyaJikaCaptive
echo.
echo Bila portal ISE terbuka: selesaikan provisioning di browser, lalu jalankan bat ini sekali lagi
echo agar uji jalur Dev/DB lewat Wi-Fi diulang.
echo ====================================================================
echo Tekan sembarang tombol untuk menutup jendela ini...
pause >nul
