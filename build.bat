@echo off
echo [build] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [error] npm install failed.
    exit /b %ERRORLEVEL%
)

echo [build] Compiling extension...
call npm run compile
if %ERRORLEVEL% neq 0 (
    echo [error] Compilation failed.
    exit /b %ERRORLEVEL%
)

echo [build] Packaging extension...
call npm run package
if %ERRORLEVEL% neq 0 (
    echo [error] Packaging failed.
    exit /b %ERRORLEVEL%
)

echo [build] Success! The .vsix file is ready.
pause
