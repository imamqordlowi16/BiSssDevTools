@echo off
title Mode Dev/DB (WLAN-NON-CORP) - omni putus dari tray dulu
cd /d "%~dp0"

:: [AUTO-ELEVATE] minta Administrator bila belum
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Meminta izin Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Ganti_Mode_Jaringan.ps1" -Mode DevDb

echo.
echo ====================================================================
echo Catatan: kalau server Dev/DB masih belum tembus, pastikan omni (aTrust)
echo sudah DIPUTUS dari ikon tray, lalu jalankan file ini sekali lagi.
echo ====================================================================
echo Tekan sembarang tombol untuk menutup...
pause >nul
