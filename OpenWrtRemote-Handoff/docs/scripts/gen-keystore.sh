#!/usr/bin/env bash
# 生成一把自己的签名密钥（仓库里不放私钥）
#
#   用法：export OWR_KS_PASS='你的口令'
#         bash docs/scripts/gen-keystore.sh [输出路径]
#
# 参数与 README 里记录的一致：别名 OWR、RSA 2048、有效期 10000 天。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KS="${1:-$HERE/../../keystore/release.keystore}"
ALIAS="${OWR_KS_ALIAS:-OWR}"

: "${OWR_KS_PASS:?请先设置签名口令：export OWR_KS_PASS=...}"
mkdir -p "$(dirname "$KS")"
if [ -e "$KS" ]; then echo "已存在，先删掉再来：$KS"; exit 1; fi

# -J 是给 keytool 自己那个 JVM 的：某些环境限制虚拟内存（ulimit -v），
# 默认堆预留会直接失败，压小一点更稳。
keytool -J-Xmx256m -J-XX:MaxMetaspaceSize=96m \
  -genkeypair -keystore "$KS" -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=OWR, OU=OWR, O=OWR, L=GZ, ST=GD, C=CN" \
  -storepass "$OWR_KS_PASS" -keypass "$OWR_KS_PASS"

keytool -J-Xmx256m -list -v -keystore "$KS" -storepass "$OWR_KS_PASS" | sed -n '1,16p'
echo
echo "已生成：$KS"
echo "构建前记得：export OWR_KS_PASS='你的口令'"
