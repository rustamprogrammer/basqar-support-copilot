@echo off
chcp 65001 >nul
title Basqar - Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-public.ps1" -Action Stop
set "SITE_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %SITE_EXIT_CODE%
