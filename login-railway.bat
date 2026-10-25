@echo off
echo Logging in to Railway... > "%TEMP%\railway_bat.log"
railway login >> "%TEMP%\railway_bat.log" 2>&1
echo Done with code %ERRORLEVEL% >> "%TEMP%\railway_bat.log"
