@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo       TUM PASSAGEIRO - GERAR NOVA PWA
echo ==============================================
echo.

echo [1/2] Instalando dependencias exatas do projeto...
call npm ci
if errorlevel 1 goto :erro

echo.
echo [2/2] Gerando a pasta dist para publicacao...
call npm run build:web
if errorlevel 1 goto :erro

echo.
echo ==============================================
echo PRONTO. Publique o conteudo da pasta dist.
echo ==============================================
pause
exit /b 0

:erro
echo.
echo ERRO: a geracao nao foi concluida. Veja a mensagem acima.
pause
exit /b 1
