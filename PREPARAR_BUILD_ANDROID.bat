@echo off
setlocal
cd /d "%~dp0"
set EXPO_NO_GIT_STATUS=1

echo.
echo === TUM Passageiro - preparando dependencias ===
call npm install
if errorlevel 1 goto :erro

echo.
echo === Alinhando Expo SDK 54 ===
call npx expo install expo@~54.0.37 expo-constants@~18.0.14 expo-file-system@~19.0.24 expo-system-ui@~6.0.9
if errorlevel 1 goto :erro

echo.
echo === Expo Doctor ===
call npx expo-doctor
if errorlevel 1 goto :erro

echo.
echo === Testando bundle Android ===
call npx expo export --platform android --clear
if errorlevel 1 goto :erro

echo.
echo === Gerando projeto Android limpo ===
call npx expo prebuild --platform android --clean
if errorlevel 1 goto :erro

echo.
echo === Gerando APK Release ===
cd android
call gradlew.bat clean assembleRelease
if errorlevel 1 goto :erro

echo.
echo ===============================================
echo BUILD CONCLUIDO
 echo APKs gerados:
for /r "%CD%\app\build\outputs\apk" %%F in (*release.apk) do echo %%F
echo.
echo Para a maioria dos celulares atuais, instale o APK arm64-v8a.
 echo ===============================================
pause
exit /b 0

:erro
echo.
echo ===============================================
echo O BUILD PAROU EM UMA ETAPA COM ERRO.
echo Tire uma foto das primeiras linhas do erro e envie ao ChatGPT.
echo ===============================================
pause
exit /b 1
