@echo off
title Ethernet Packet Lab Launcher
echo ============================================
echo  Ethernet Packet Generator + Flow Monitor
echo ============================================
echo.

:: Start WPF application (embeds HTTP server on port 8080)
set "EXE=%~dp0EthernetPacketGenerator\EthernetPacketGenerator\bin\x64\Debug\net8.0-windows\EthernetPacketGenerator.exe"
if not exist "%EXE%" (
    echo [ERROR] EthernetPacketGenerator.exe not found.
    echo         Build the project first: dotnet build
    pause
    exit /b 1
)

start "" "%EXE%"
echo.
echo Done. API Server: http://localhost:8080/api/health
echo       Logs:       %~dp0EthernetPacketGenerator\EthernetPacketGenerator\bin\x64\Debug\net8.0-windows\logs\
