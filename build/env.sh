# 本机构建环境（Linux）
#   用法：在项目根目录执行   source build/env.sh
#   所有路径按本文件位置自动推导，换机器、换用户名都不用改；
#   需要自定义时用同名环境变量覆盖即可。
#
#   注意：JDK / Android SDK / platform-tools 不在仓库里（体积太大），
#   放到 build/temp/ 下即可，或自行设 JAVA_HOME / ANDROID_SDK / ADB 指过去。

_HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export OWR_ROOT="${OWR_ROOT:-$(cd "$_HERE/.." && pwd)}"

export JDK_HOME="${JDK_HOME:-${JAVA_HOME:-$OWR_ROOT/build/temp/jdk/root/usr/lib/jvm/java-21-openjdk-amd64}}"
export JAVA_HOME="$JDK_HOME"

export ANDROID_SDK="${ANDROID_SDK:-$OWR_ROOT/build/temp/sdk}"
export BT="${BT:-$ANDROID_SDK/build-tools/android-15}"
export ANDROID_JAR="$ANDROID_SDK/platforms/android-35/android.jar"
export ADB="${ADB:-$OWR_ROOT/build/temp/platform-tools/adb}"

# Node / Python 默认用 PATH 里的，可覆盖
export NODE="${NODE:-node}"
export PY="${PY:-python3}"

# 调试脚本要用 ws 模块；装在别处时把 OWR_WS 指向 .../node_modules/ws/index.js
export OWR_WS="${OWR_WS:-}"

export PATH="$JDK_HOME/bin:$BT:$PATH"
chmod +x "$BT"/* 2>/dev/null || true
