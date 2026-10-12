@echo off
rem Lets `qlcn <command>` work from cmd and PowerShell alike, whatever the execution policy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0qlcn.ps1" %*
exit /b %ERRORLEVEL%
