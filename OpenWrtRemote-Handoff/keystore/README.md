# 这个目录里不放私钥

App 需要签名才能装到 Android 上，但**签名私钥不应该进仓库** ——
它一旦公开，任何人都能签出一个系统认可的"官方升级包"；
而 App 的 localStorage 里存着路由器登录密码，同签名的新版本会完整继承这些数据。

## 自己生成一把

```bash
export OWR_KS_PASS='设置一个口令'
bash docs/scripts/gen-keystore.sh          # 默认生成到 keystore/release.keystore
```

生成后构建脚本会读 `OWR_KS_PASS` 环境变量，仓库里不会出现明文口令。

## 已经装过旧版本？

Android 只允许**同一个签名者**覆盖安装。如果你现在换了一把新钥匙，
已经装了旧版的设备必须先卸载再装 —— localStorage 里的连接配置和密码都会丢。
所以：**要么一直用同一把钥匙，要么一开始就把它备好、别外传。**
