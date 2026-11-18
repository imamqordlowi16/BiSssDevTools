@echo off
title Mode Timesheet (omni) - sambungkan omni dari tray
cd /d "%~dp0"

:: [AUTO-ELEVATE] minta Administrator bila belum
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Meminta izin Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Ganti_Mode_Jaringan.ps1" -Mode Timesheet

echo.
echo ====================================================================
echo Catatan: sambungkan omni (aTrust) dari ikon tray, lalu buka
echo   http://10.28.224.55:8080/timesheets
echo ====================================================================
echo Tekan sembarang tombol untuk menutup...
pause >nul
