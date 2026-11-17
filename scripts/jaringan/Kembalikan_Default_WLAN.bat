@echo off
title Kembalikan Setting Jaringan ke Default (Otomatis / DHCP)
cd /d "%~dp0"

:: [AUTO-ELEVATE] Cek hak Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Meminta izin Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ====================================================================
echo      MENGEMBALIKAN SETTING JARINGAN KE DEFAULT (DHCP / OTOMATIS)
echo ====================================================================
echo.

:: 1. Kembalikan Metric & DNS semua adapter fisik (Wi-Fi dan Ethernet) ke Otomatis
echo [1/3] Mengembalikan Metric dan DNS semua adapter ke Otomatis...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetAdapter | Where-Object { $_.InterfaceDescription -notmatch 'aTrust|Sangfor|Virtual|Hyper-V|TAP|Fortinet|Loopback' } | ForEach-Object { Set-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AutomaticMetric Enabled -ErrorAction SilentlyContinue; Write-Host '      Metric otomatis dipulihkan:' $_.Name }; netsh interface ipv4 set dnsservers name='Wi-Fi' source=dhcp >$null 2>&1"

:: 2. Hapus routing manual yang dibuat sebelumnya
echo [2/3] Menghapus static route manual...
route delete 10.0.0.0 >nul 2>&1
route delete 10.149.0.1 >nul 2>&1
route delete 10.149.0.0 >nul 2>&1
route delete 10.160.0.0 >nul 2>&1
route delete 10.161.0.0 >nul 2>&1
route delete 10.161.10.135 >nul 2>&1
route delete 10.230.0.0 >nul 2>&1
route delete 10.239.0.0 >nul 2>&1
route delete 10.240.0.0 >nul 2>&1

:: 3. Flush DNS
echo [3/3] Membersihkan cache DNS Windows...
ipconfig /flushdns >nul

echo.
echo ====================================================================
echo Selesai! Pengaturan Ethernet, Wi-Fi, dan Routing kembali normal.
echo ====================================================================
pause >nul
