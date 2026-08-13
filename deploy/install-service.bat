@echo off
REM ===================================================================
REM  Install Office Order as a Windows service using NSSM.
REM
REM  Run this from an ELEVATED command prompt (right-click, "Run as
REM  administrator"). Without elevation every nssm command fails with a
REM  permissions error that is easy to mistake for a broken download.
REM
REM  NSSM must be on PATH, or sitting next to this file as nssm.exe.
REM  Get it once, on a machine with internet, from nssm.cc — it is a
REM  single executable with no installer.
REM ===================================================================

setlocal

set "SERVICE=OfficeOrder"
set "HERE=%~dp0"
set "ROOT=%HERE%.."

REM Elevation check: "net session" only succeeds as administrator.
net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
  echo.
  echo [install] FAILED - this must be run as administrator.
  echo [install] Right-click cmd.exe and choose "Run as administrator", then run this again.
  echo.
  pause
  exit /b 1
)

where nssm >nul 2>&1
if "%ERRORLEVEL%"=="0" (
  set "NSSM=nssm"
) else (
  if exist "%HERE%nssm.exe" (
    set "NSSM=%HERE%nssm.exe"
  ) else (
    echo.
    echo [install] FAILED - nssm.exe not found.
    echo.
    echo   Put nssm.exe next to this file, or on PATH.
    echo   Download it once from nssm.cc on a machine with internet:
    echo   it is a single .exe, no installer, nothing to configure.
    echo.
    pause
    exit /b 1
  )
)

echo [install] using %NSSM%
echo [install] installing service "%SERVICE%"

"%NSSM%" install %SERVICE% "%HERE%start.bat"
if not "%ERRORLEVEL%"=="0" (
  echo [install] nssm install failed - is the service already installed?
  echo [install] to reinstall:  %NSSM% remove %SERVICE% confirm
  pause
  exit /b 1
)

REM Where it runs, and what it is called in services.msc.
"%NSSM%" set %SERVICE% AppDirectory "%ROOT%\app"
"%NSSM%" set %SERVICE% DisplayName "Office Order"
"%NSSM%" set %SERVICE% Description "Group food ordering for the office. Serves the app on port 3001."

REM Start with Windows, and come back by itself if it ever dies.
"%NSSM%" set %SERVICE% Start SERVICE_AUTO_START
"%NSSM%" set %SERVICE% AppExit Default Restart
"%NSSM%" set %SERVICE% AppRestartDelay 5000

REM Keep logs on disk. When something breaks, this file is the only account of
REM what happened — there is no monitoring on this machine and no internet to
REM search from.
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
"%NSSM%" set %SERVICE% AppStdout "%ROOT%\logs\service.log"
"%NSSM%" set %SERVICE% AppStderr "%ROOT%\logs\service.log"
REM Rotate at 10 MB so the log cannot quietly fill the disk over a year.
"%NSSM%" set %SERVICE% AppRotateFiles 1
"%NSSM%" set %SERVICE% AppRotateOnline 1
"%NSSM%" set %SERVICE% AppRotateBytes 10485760

REM Tells start.bat it is running headless, so it never waits on `pause`.
"%NSSM%" set %SERVICE% AppEnvironmentExtra NSSM_SERVICE=1

echo [install] starting...
"%NSSM%" start %SERVICE%

echo.
echo [install] done. Useful commands:
echo.
echo   %NSSM% status  %SERVICE%
echo   %NSSM% restart %SERVICE%
echo   %NSSM% stop    %SERVICE%
echo   %NSSM% edit    %SERVICE%      (GUI)
echo   %NSSM% remove  %SERVICE% confirm
echo.
echo   Logs: %ROOT%\logs\service.log
echo.
pause
