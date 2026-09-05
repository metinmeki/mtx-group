@echo off
REM ===================================================================
REM  MTX Group Retail Suite - silent-printing launcher
REM
REM  Opens the online POS in Chrome or Edge with --kiosk-printing, so
REM  receipts go straight to the default printer with no print dialog.
REM
REM    run-kiosk.bat  [edge^|chrome]  [url]
REM
REM  Defaults to Edge and https://mtx-group.net/
REM
REM  WHY THE SEPARATE PROFILE (--user-data-dir):
REM  Chromium only applies command-line flags to a NEW browser process.
REM  If Edge or Chrome is already running, launching it again just opens
REM  a tab in the process that is already there and --kiosk-printing is
REM  silently ignored - the dialog keeps appearing and it looks like the
REM  flag does nothing. Pointing at its own profile directory forces a
REM  separate process, so the flag always takes effect, and it keeps the
REM  till window away from the staff's normal browsing, history and
REM  logins.
REM
REM  SET THE RECEIPT PRINTER AS THE WINDOWS DEFAULT FIRST.
REM  --kiosk-printing prints to the default printer without asking, so
REM  whatever is default is what receipts come out of.
REM ===================================================================

setlocal

set "BROWSER=%~1"
if "%BROWSER%"=="" set "BROWSER=edge"

set "URL=%~2"
if "%URL%"=="" set "URL=https://mtx-group.net/"

set "EXE="

REM  %ProgramFiles(x86)% contains brackets, and a bracket inside a ( ... )
REM  block ends the block early - cmd then chokes on the rest of the path.
REM  Copying it into a bracket-free name first avoids that entirely.
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "LAD=%LOCALAPPDATA%"

if /i "%BROWSER%"=="edge"   goto :edge
if /i "%BROWSER%"=="chrome" goto :chrome
echo.
echo   Unknown browser "%BROWSER%" - use "edge" or "chrome".
echo.
pause
exit /b 1

:edge
set "LABEL=Microsoft Edge"
set "PROFILE=%LAD%\MTX-POS-Kiosk\Edge"
call :try "%PF86%\Microsoft\Edge\Application\msedge.exe"
call :try "%PF%\Microsoft\Edge\Application\msedge.exe"
if not defined EXE call :fromregistry msedge.exe
goto :launch

:chrome
set "LABEL=Google Chrome"
set "PROFILE=%LAD%\MTX-POS-Kiosk\Chrome"
call :try "%PF%\Google\Chrome\Application\chrome.exe"
call :try "%PF86%\Google\Chrome\Application\chrome.exe"
call :try "%LAD%\Google\Chrome\Application\chrome.exe"
if not defined EXE call :fromregistry chrome.exe
goto :launch

REM Take the first candidate that exists.
:try
if defined EXE exit /b 0
if exist "%~1" set "EXE=%~1"
exit /b 0

REM Last resort: ask Windows where the browser is installed.
:fromregistry
for /f "usebackq tokens=2,*" %%A in (
  `reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%~1" /ve 2^>nul`
) do if exist "%%B" set "EXE=%%B"
exit /b 0

:launch
if not defined EXE (
  echo.
  echo   Could not find %LABEL% on this machine.
  echo   Install it, or run:  run-kiosk.bat chrome
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting MTX POS
echo     browser : %LABEL%
echo     address : %URL%
echo     printing: silent (Windows default printer)
echo.

REM  run-kiosk.bat edge https://... --check
REM  Prints what it found and exits without opening anything - use it to
REM  verify a new till is set up correctly.
REM  Note the goto rather than an if ( ... ) block: Edge lives under
REM  "Program Files (x86)", and echoing a path containing a bracket inside a
REM  parenthesised block ends the block early and cmd errors out.
if /i "%~3"=="/check" goto :checkonly
if /i "%~3"=="--check" goto :checkonly
goto :golaunch

:checkonly
echo   [check] executable: %EXE%
echo   [check] profile   : %PROFILE%
echo   [check] nothing launched.
echo.
exit /b 0

:golaunch

REM --app             clean window, no address bar or tabs - looks like a till
REM --kiosk-printing  window.print() goes straight to the default printer
REM --user-data-dir   own profile, so the flags actually apply (see above)
REM --no-first-run    skip the welcome/setup screens on a fresh profile
REM --disable-session-crashed-bubble  no "Restore pages?" bar after a power cut
start "" "%EXE%" ^
  --app="%URL%" ^
  --kiosk-printing ^
  --user-data-dir="%PROFILE%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-session-crashed-bubble ^
  --disable-features=Translate,AutofillServerCommunication

endlocal
exit /b 0
