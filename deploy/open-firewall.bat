@echo off
REM ===================================================================
REM  Allow phones on the office LAN to reach the app.
REM
REM  Run as administrator. Without this rule the site works perfectly on
REM  the machine itself and is unreachable from every phone — which reads
REM  like "the app is broken" rather than "the firewall is doing its job".
REM ===================================================================

setlocal
set "PORT=3001"
set "RULE=Office Order (port %PORT%)"

net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
  echo.
  echo [firewall] FAILED - must be run as administrator.
  echo.
  pause
  exit /b 1
)

REM Remove any previous copy so re-running does not stack up duplicates.
netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1

REM Private profile only. This should be reachable from the office network,
REM not from a coffee shop wifi the laptop joins later.
netsh advfirewall firewall add rule ^
  name="%RULE%" ^
  dir=in action=allow protocol=TCP localport=%PORT% ^
  profile=private ^
  description="Office Order group food ordering app"

if "%ERRORLEVEL%"=="0" (
  echo.
  echo [firewall] rule added for TCP %PORT% on the private profile.
  echo.
  echo   If phones still cannot connect, the network is probably classified
  echo   as Public. Check with:
  echo.
  echo     powershell -Command "Get-NetConnectionProfile"
  echo.
  echo   and set it to Private:
  echo.
  echo     powershell -Command "Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private"
  echo.
) else (
  echo [firewall] FAILED to add the rule.
)

pause
