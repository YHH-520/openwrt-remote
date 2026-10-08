#!/usr/bin/env bash
# ============================================================
# OpenWrt Remote 一键构建脚本 (Linux 版)
# 用法: ./build.sh [输出APK名，默认 owr-<版本>-c<版本号>.apk]
#
# 本机工具链：apt 解包的 JDK21 + Google build-tools_r35 / platform-35
#   （路径见 ../../build/env.sh，可用 JAVA_HOME / BT / ANDROID_JAR 覆盖）
# 与 docs/build.bat（Windows 版）等价
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../docs/scripts
ROOT="$(cd "$HERE/../.." && pwd)"       # OpenWrtRemote-Handoff/
BASE="$(cd "$ROOT/.." && pwd)"          # 11OpenWRTXM/
TEMP="$BASE/build/temp"
WORK="$BASE/build/work"
OUT="$ROOT/output"
OUT_APK="$ROOT/apk"          # 历史版本仓库：每个版本留一份，便于回滚

# ---- 工具链定位（环境变量优先）----
[ -f "$BASE/build/env.sh" ] && . "$BASE/build/env.sh" || true

JDKHOME="${JAVA_HOME:-$TEMP/jdk/root/usr/lib/jvm/java-21-openjdk-amd64}"
BT="${BT:-$TEMP/sdk/build-tools/android-15}"
PLATFORM="${ANDROID_JAR:-$TEMP/sdk/platforms/android-35/android.jar}"

# 源码目录下所有 .java 一起编译（目前只有 MainActivity；路由器原生页面跑在它的内嵌覆盖层里）
SRCS="$(find "$ROOT/src" -maxdepth 1 -name '*.java' | sort)"
MANIFEST="$ROOT/src/AndroidManifest.xml"
RES="$ROOT/src/res"
ASSETS_WWW="$ROOT/src/www"
KEYSTORE="$ROOT/keystore/release.keystore"
# 签名口令从环境变量读，不进仓库：export OWR_KS_PASS='你的口令'
KS_PASS="${OWR_KS_PASS:?请先设置签名口令：export OWR_KS_PASS=...}"
KS_ALIAS=OWR
APP_VER=1.0.17
VER_CODE=19

# 输出文件名带版本号：低版本会一直留在 apk/ 里，方便回滚对比
SIGNED="${1:-owr-${APP_VER}-c${VER_CODE}.apk}"
MIN_SDK=26
TARGET_SDK=35

export JAVA_HOME="$JDKHOME"
export PATH="$JDKHOME/bin:$BT:$PATH"

# ---- 给 JVM 压住地址空间 ----
# 本机给 shell 的虚拟内存硬上限只有 4GB（ulimit -H -v），而 JDK21 默认按物理内存的
# 1/4 预留堆（这台机器 14GB → 3.5GB），光这一项就把地址空间占满，
# javac 直接报 "Failed to reserve memory for metaspace" 且堆栈全是 mmap 失败。
# 显式压小堆 / 元空间 / 代码缓存后，整条链（javac、d8、apksigner）都能在 4GB 内跑完。
JVM_TUNE="-Xmx768m -XX:MaxMetaspaceSize=192m -XX:ReservedCodeCacheSize=64m -XX:CompressedClassSpaceSize=96m"
export DEFAULT_JVM_OPTS="$JVM_TUNE"      # d8 / apksigner 的启动脚本读这个
export JAVA_OPTS="$JVM_TUNE"
export _JAVA_OPTIONS="$JVM_TUNE"          # 兜底：所有 java 进程都吃

for p in "$JDKHOME/bin/javac" "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$PLATFORM"; do
  [ -e "$p" ] || { echo "缺失依赖: $p"; exit 1; }
done

rm -rf "$WORK"; mkdir -p "$WORK/dex" "$WORK/classes" "$OUT" "$OUT_APK"

echo "[1/7] aapt2 compile res"
"$BT/aapt2" compile --dir "$RES" -o "$WORK/compiled_res.zip"

echo "[2/7] aapt2 link"
"$BT/aapt2" link -o "$WORK/base.apk" --manifest "$MANIFEST" -I "$PLATFORM" \
  --version-code "$VER_CODE" --version-name "$APP_VER" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" "$WORK/compiled_res.zip"

echo "[3/7] javac"
# -J 是把选项透传给 javac 自己那个 JVM（见上面 JVM_TUNE 的说明）
javac -J-Xmx768m -J-XX:MaxMetaspaceSize=192m -J-XX:ReservedCodeCacheSize=64m \
  -encoding UTF-8 --release 8 -classpath "$PLATFORM" -d "$WORK/classes" $SRCS

echo "[4/7] d8"
( cd "$WORK" && "$BT/d8" --lib "$PLATFORM" --min-api "$MIN_SDK" --output dex \
    $(find classes -name '*.class') )

echo "[5/7] 注入 assets/www + classes.dex"
python3 "$ROOT/docs/scripts/inject_assets.py" \
  "$WORK/base.apk" "$ASSETS_WWW" "$WORK/dex/classes.dex" "$WORK/base-with-assets.apk"

echo "[6/7] zipalign"
"$BT/zipalign" -f 4 "$WORK/base-with-assets.apk" "$WORK/aligned.apk"

echo "[7/7] apksigner"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias "$KS_ALIAS" --out "$OUT/$SIGNED" "$WORK/aligned.apk"

cp -f "$OUT/$SIGNED" "$OUT_APK/$SIGNED"
echo "BUILD OK: $OUT/$SIGNED  (已归档到 apk/$SIGNED)"
"$BT/apksigner" verify --print-certs "$OUT/$SIGNED" | head -4
