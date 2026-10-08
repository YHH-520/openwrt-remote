@echo off
REM ============================================================
REM OpenWrt Remote 一键构建脚本 (Windows cmd)
REM 用法: build.bat
REM 依赖: temp\jdk17\jdk-17.0.2, temp\android-sdk2, python
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

REM ---- 路径（按需修改，建议用绝对路径）----
set BASE=%~dp0..
set SRC=%BASE%\src\com\owr\remote\MainActivity.java
set MANIFEST=%BASE%\AndroidManifest.xml
set RES=%BASE%\res
set ASSETS_WWW=%BASE%\src\www
set KEYSTORE=%BASE%\keystore\release.keystore
if "%OWR_KS_PASS%"=="" (echo 请先设置签名口令: set OWR_KS_PASS=你的口令 & exit /b 1)
set KS_PASS=%OWR_KS_PASS%
set KS_ALIAS=OWR
set APP_VER=1.0.02

set JDK=%BASE%\..\temp\jdk17\jdk-17.0.2
set SDK=%BASE%\..\temp\android-sdk2
set BT=%SDK%\build-tools\35.0.0
set PLATFORM=%SDK%\platforms\android-35\android.jar
set OUT=%BASE%\out
set DEXOUT=%OUT%\dex
set CLASSES=%OUT%\classes

if not exist "%OUT%" mkdir "%OUT%"
if not exist "%DEXOUT%" mkdir "%DEXOUT%"
if not exist "%CLASSES%" mkdir "%CLASSES%"

set ERR=0

echo [1/6] aapt2 compile res...
"%BT%\aapt2.exe" compile --dir "%RES%" -o "%OUT%\compiled_res.zip"
if errorlevel 1 (echo FAILED compile & set ERR=1)

echo [2/6] aapt2 link (不 -A, assets 用 python 注入)...
"%BT%\aapt2.exe" link -o "%OUT%\base.apk" --manifest "%MANIFEST%" -I "%PLATFORM%" --version-code 4 --version-name %APP_VER% --min-sdk-version 26 --target-sdk-version 35 "%OUT%\compiled_res.zip"
if errorlevel 1 (echo FAILED link & set ERR=1)

echo [3/6] javac...
"%JDK%\bin\javac.exe" -encoding UTF-8 -classpath "%PLATFORM%" -d "%CLASSES%" "%SRC%"
if errorlevel 1 (echo FAILED javac & set ERR=1)

echo [4/6] d8 (注意相对路径/空目录)...
pushd "%OUT%"
"%BT%\d8.bat" --lib "%PLATFORM%" --min-api 26 --output dex "classes\com\owr\remote\MainActivity.class"
if errorlevel 1 (echo FAILED d8 & set ERR=1)
popd

echo [5/6] python 注入 assets/www + classes.dex...
python "%BASE%\scripts\inject_assets.py" "%OUT%\base.apk" "%ASSETS_WWW%" "%DEXOUT%\classes.dex" "%OUT%\base-with-assets.apk"
if errorlevel 1 (echo FAILED inject & set ERR=1)

echo [6/6] zipalign + apksigner...
"%BT%\zipalign.exe" -f 4 "%OUT%\base-with-assets.apk" "%OUT%\aligned.apk"
if errorlevel 1 (echo FAILED zipalign & set ERR=1)
"%BT%\apksigner.bat" sign --ks "%KEYSTORE%" --ks-pass pass:%KS_PASS% --key-pass pass:%KS_PASS% --ks-key-alias %KS_ALIAS% --out "%OUT%\signed-final13.apk" "%OUT%\aligned.apk"
if errorlevel 1 (echo FAILED apksigner & set ERR=1)

if %ERR%==0 (echo BUILD OK: %OUT%\signed-final13.apk) else (echo BUILD FAILED)
endlocal
