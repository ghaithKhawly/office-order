@echo off
REM ===================================================================
REM  Office Order — start the server
REM
REM  Double-click to run it in a window, or point NSSM at this file to
REM  run it as a Windows service. See DEPLOY-WINDOWS.md.
REM
REM  Expects the portable layout:
REM
REM    office-order\
REM      node\node.exe        <- pinned runtime, see NODE-VERSION.txt
REM      app\                 <- this repo, with node_modules already installed
REM      deploy\start.bat     <- you are here
REM ===================================================================

setlocal

REM Resolve paths relative to this file, never the working directory. A Windows
REM service starts in C:\Windows\System32, and a relative path there would
REM create a second, empty database somewhere nobody thinks to look.
set "HERE=%~dp0"
set "ROOT=%HERE%.."
set "NODE_EXE=%ROOT%\node\node.exe"
set "APP=%ROOT%\app"

REM Prefer the pinned node.exe next to the app. Fall back to one on PATH, but
REM say so — a version mismatch is the single most likely cause of a failure
REM here, because better-sqlite3 ships a prebuilt binary per Node ABI.
if exist "%NODE_EXE%" (
  set "NODE=%NODE_EXE%"
) else (
  echo [start] node\node.exe not found, falling back to node on PATH
  echo [start] if this fails with a better-sqlite3 error, see DEPLOY-WINDOWS.md
  set "NODE=node"
)

if not exist "%APP%\server\src\index.js" (
  echo.
  echo [start] FAILED - cannot find the app at "%APP%"
  echo [start] Expected layout:  office-order\node\  office-order\app\  office-order\deploy\
  echo.
  exit /b 1
)

if not exist "%APP%\server\node_modules\better-sqlite3" (
  echo.
  echo [start] FAILED - server\node_modules is missing.
  echo.
  echo   This folder must be copied from a machine that ran "npm install"
  echo   on Windows x64 with the same Node major version. It cannot be
  echo   installed here: this machine has no internet.
  echo.
  echo   See "Installing without internet" in DEPLOY-WINDOWS.md.
  echo.
  exit /b 1
)

cd /d "%APP%"

echo [start] node:    %NODE%
echo [start] app:     %APP%
echo [start] data:    %APP%\server\data
echo.

"%NODE%" server\src\index.js

REM Only reached if the server exits. NSSM will restart it; a human running this
REM by hand gets to read the error instead of watching the window vanish.
set "CODE=%ERRORLEVEL%"
echo.
echo [start] server exited with code %CODE%
if not "%CODE%"=="0" (
  echo [start] check the message above, then see the troubleshooting section
  echo [start] of DEPLOY-WINDOWS.md
  if "%NSSM_SERVICE%"=="" pause
)
exit /b %CODE%
