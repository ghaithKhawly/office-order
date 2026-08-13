@echo off
REM ===================================================================
REM  Restore the database from a backup file.
REM
REM    restore-backup.bat "C:\path\to\app-2026-08-13-0900.db"
REM
REM  A backup you have never restored is a backup you do not have, so this
REM  exists as a script rather than as a paragraph of instructions someone
REM  has to follow correctly while the office is waiting for lunch.
REM ===================================================================

setlocal

set "HERE=%~dp0"
set "ROOT=%HERE%.."
set "DATA=%ROOT%\app\server\data"
set "SRC=%~1"
set "SERVICE=OfficeOrder"

if "%SRC%"=="" (
  echo.
  echo  Usage:  restore-backup.bat "path\to\app-YYYY-MM-DD-HHMM.db"
  echo.
  echo  Available backups in %DATA%\backups:
  echo.
  if exist "%DATA%\backups" (
    dir /b /o-n "%DATA%\backups\app-*.db" 2>nul
  ) else (
    echo   (none found)
  )
  echo.
  exit /b 1
)

if not exist "%SRC%" (
  echo [restore] FAILED - no such file: %SRC%
  exit /b 1
)

echo.
echo  This will REPLACE the current database with:
echo    %SRC%
echo.
echo  The current one is kept as app.db.replaced-{timestamp}, so this is
echo  reversible if you picked the wrong file.
echo.
set /p CONFIRM="Type YES to continue: "
if not "%CONFIRM%"=="YES" (
  echo [restore] cancelled.
  exit /b 1
)

REM The server holds the file open; it must be stopped first. On Windows the
REM copy simply fails while it is running, which is safer than a torn file.
where nssm >nul 2>&1
if "%ERRORLEVEL%"=="0" (
  echo [restore] stopping service...
  nssm stop %SERVICE% >nul 2>&1
) else (
  echo [restore] NSSM not found - make sure the app is not running, then continue.
  pause
)

set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%-%TIME:~0,2%%TIME:~3,2%"
set "STAMP=%STAMP: =0%"

if exist "%DATA%\app.db" (
  echo [restore] keeping the current database as app.db.replaced-%STAMP%
  move /y "%DATA%\app.db" "%DATA%\app.db.replaced-%STAMP%" >nul
)

REM The -wal and -shm files belong to the database being replaced. Leaving them
REM behind would let SQLite apply another database's journal over the restored
REM file, which is a genuinely destructive mistake.
if exist "%DATA%\app.db-wal" del /q "%DATA%\app.db-wal"
if exist "%DATA%\app.db-shm" del /q "%DATA%\app.db-shm"

copy /y "%SRC%" "%DATA%\app.db" >nul
if not "%ERRORLEVEL%"=="0" (
  echo [restore] FAILED to copy the file. Is the server still running?
  exit /b 1
)

echo [restore] restored.

where nssm >nul 2>&1
if "%ERRORLEVEL%"=="0" (
  echo [restore] starting service...
  nssm start %SERVICE% >nul 2>&1
  echo [restore] done - open the app and check Setup for the server health panel.
) else (
  echo [restore] done - start the app again with start.bat
)

echo.
pause
