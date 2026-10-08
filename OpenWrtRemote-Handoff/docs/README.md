---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 904628816c407f903d7447fc173521d4_1b27a2cac29611f1884b525400cd780f
    ReservedCode1: Bf9A2LSUjYfeVyhKlqVkVtg+tz5nocZxPF/dP7l9KFwbEjmiLquPe7FERrrLbuFOvaho60NFU5/RuDrcLr+cZHJWis04921xaYHCVsvAmyTS3VaKyoSbDDtidiunKCC66JDos1XQdsPWzqCsrEfFryL1tg8pMw740kr0mH1Oob2qlGqrfaOUk9Ig74Y=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 904628816c407f903d7447fc173521d4_1b27a2cac29611f1884b525400cd780f
    ReservedCode2: Bf9A2LSUjYfeVyhKlqVkVtg+tz5nocZxPF/dP7l9KFwbEjmiLquPe7FERrrLbuFOvaho60NFU5/RuDrcLr+cZHJWis04921xaYHCVsvAmyTS3VaKyoSbDDtidiunKCC66JDos1XQdsPWzqCsrEfFryL1tg8pMw740kr0mH1Oob2qlGqrfaOUk9Ig74Y=
---

# OpenWrt Remote 项目交接文档

> 生成时间：2026-10-08（周四）
> 用途：将项目现状、未解决问题、构建链与后续步骤完整交接给下一位 AI / 开发者，可直接续跑。

---

## 一、项目概述

一个安卓 App：用 **WebView 壳 + 前端 PWA** 远程管理 OpenWrt 软路由。
- 前端：iOS 风格单页应用（浅色/深色/跟随系统），菜单自适应 OpenWrt 实际菜单（ubus 探测）
- 原生壳：`com.owr.remote.MainActivity`（全屏沉浸式 WebView + Tailscale 状态桥）
- 远程连接：局域网直连 / Tailscale（100.64.0.0/10 自动识别）/ 其他内网穿透，可配置多连接、记住密码
- 目标设备：三星 S24U（SM-S9280，安卓15/16，adb 序列号 `R5CY544P8HR`）；三星 S20U（SM-G988N，安卓15，adb 序列号 `R3CN30BMCZZ`，当前测试机）
- 版本：versionName `1.0.02`，versionCode `4`，minSdk 26，targetSdk 35

## 二、当前状态（截止交接时）

### 已完成
1. 完整前端（index.html / css/style.css / js/api.js / js/app.js / sw.js / manifest.json / icon.svg）
2. 原生壳 MainActivity（沉浸式全屏 + TailscaleBridge），Java 源码 + 已编译 classes.dex
3. 本地构建链可用：JDK17 + Android SDK（platforms;android-35 + build-tools;35.0.0）已装好
4. APK 已能构建、签名（v1/v2/v3）并 adb 安装到 S24U 成功
5. 已完成修复并打包：**去掉系统标题栏（ActionBar）**、**升 targetSdk 34→35**、**沉浸式增强**（`setDecorFitsSystemWindows(false)` + `requestWindowFeature(FEATURE_NO_TITLE)` + `Theme.Material.NoActionBar`）

### 核心未解决问题（本轮要接手的重点）
**三星 S20U（安卓15）上页面显示异常：**
- 现象：顶部出现系统标题栏灰条（"OpenWrt Remote"，y≈170~254px）；页面中部以下大面积纯黑（0,0,0）；底部标签栏 `#tabbar` 不渲染（DOM 存在、`position:fixed; bottom:0` 计算位置正确，但像素输出缺失）
- 诊断结论（已通过 uiautomator + 截图像素采样 + 页面内 getComputedStyle 三重确认）：
  - DOM 侧 `#tabbar` rect y=515（vh=571dp 视口底部），disp=flex、pos=fixed 均正确 → **不是 CSS 层问题**
  - fixed 定位本身生效（diag-fixed 绿色测试条能显示）
  - 截图侧 WebView 视口只有 1928px 物理高（顶部标题栏 254px + 底部系统栏占位挤压），页面内容只渲染顶部一段，y≈1000~2182 全黑
  - **根因判断**：Activity 窗口不是真正沉浸全屏（默认 Material 主题带 ActionBar）+ WebView 在压缩视口下的合成异常
- 已采取的修复（f12 已打包安装）：NoActionBar 主题、FEATURE_NO_TITLE、setDecorFitsSystemWindows(false)、targetSdk35

### 交接点（下一步从这里开始）
f12（`signed-final12.apk`）已安装到 S20U 并启动，但**首次启动权限弹窗挡在前面**（"请选择要向 OpenWrt Remote 授予哪些权限"：通知 / 文件和媒体，按钮"继续""取消"），尚未验证 NoActionBar/全屏修复是否生效。
→ 下一位 AI 第一步：用 uiautomator 找到弹窗按钮并 tap"继续"（可顺带"确定"），然后 dump + 截图验证：顶部是否还有灰条 ActionBar、底部 tabbar 是否渲染、页面是否铺满。

## 三、构建链（重要，别绕路）

```
aapt2 compile --dir res -o compiled_res.zip
aapt2 link  -o base.apk --manifest AndroidManifest.xml -I <android.jar> compiled_res.zip
javac -encoding UTF-8 -classpath <android.jar> -d classes src\com\owr\remote\MainActivity.java
d8   --lib <android.jar> --min-api 26 --output dex <classes...>
python 组装：base.apk 内容 + assets/www/**（正斜杠路径）+ classes.dex → base-with-assets.apk
zipalign -f 4 base-with-assets.apk aligned.apk
apksigner sign --ks release.keystore --ks-pass env:OWR_KS_PASS --key-pass env:OWR_KS_PASS --ks-key-alias OWR --out signed-finalX.apk aligned.apk
```

注意点（踩过的坑）：
1. **assets 路径必须用正斜杠**写进 zip（`assets/www/...`），aapt2 link 的 -A 在 Windows 会写反斜杠导致 `ERR_FILE_NOT_FOUND`
2. d8 输出参数用相对路径（绝对长路径会报 `Invalid output`），`--output` 目录要预先存在且为空
3. javac 不要加 `-source/-target 17 -bootclasspath`（JDK17 会报错），直接 `-classpath android.jar` 即可
4. 安全规则会拦截 `Remove-Item -Recurse` / `os.remove` 等删除操作，构建用唯一新目录名（classes13/dex13...）绕开
5. 安装安卓15+ 时若报 `INSTALL_FAILED_DEPRECATED_SDK_VERSION`，用 `adb install --bypass-low-target-sdk-block -r`
6. 截图：`adb exec-out screencap -p > file.png` 在 PowerShell 会污染 PNG，改用 `adb shell screencap -p /sdcard/x.png` + `adb pull`

## 四、关键文件路径（Windows 绝对路径）

工作区根：`C:\Users\<用户名>\AppData\Roaming\Tencent\Marvis\User\<工作区ID>\workspace\<会话ID>`

| 用途 | 路径 |
|---|---|
| 前端源码（干净版，用于打包） | `temp\apkbuild\assets\www\` |
| 前端源码（诊断版，含 diag 测试条） | `output\OpenWrtRemote\` |
| 原生壳源码 | `temp\apkbuild\src\com\owr\remote\MainActivity.java` |
| Tailscale 桥（同文件内） | 同上 `TailscaleBridge` |
| AndroidManifest | `temp\apkbuild\AndroidManifest.xml` |
| 图标资源 | `temp\apkbuild\res\mipmap-xxxhdpi\ic_launcher.png` |
| 签名 keystore | 自行生成（`docs/scripts/gen-keystore.sh`），别名 `OWR`。**私钥不要提交进仓库** |
| 最新签名 APK | `temp\apkbuild\signed-final12.apk` |
| 历史 APK | `temp\apkbuild\signed-final6~11.apk`（诊断包），`output\OpenWrtRemote.apk`（早期正式包） |
| 诊断截图 | `temp\s20u_f7.png / f8 / f9 / f10 / f11 / diag_zoom.png / perm_btns.png` 等 |
| JDK | `temp\jdk17\jdk-17.0.2` |
| Android SDK | `temp\android-sdk2`（platforms;android-35、build-tools;35.0.0、platform-tools） |
| adb | `temp\android-sdk2\platform-tools\adb.exe` |

## 五、设备与测试方法

```powershell
$adb = "<工作区>\temp\android-sdk2\platform-tools\adb.exe"
& $adb devices                      # 确认 R3CN30BMCZZ 在线
& $adb -s R3CN30BMCZZ install -r signed-final12.apk
& $adb -s R3CN30BMCZZ shell pm clear com.owr.remote
& $adb -s R3CN30BMCZZ shell am start -n com.owr.remote/.MainActivity
& $adb -s R3CN30BMCZZ shell uiautomator dump /sdcard/ui.xml   # 看 DOM/按钮坐标
& $adb -s R3CN30BMCZZ shell screencap -p /sdcard/s.png
& $adb -s R3CN30BMCZZ pull /sdcard/s.png <本地路径>
```
- 首次启动有系统权限弹窗，需 uiautomator 找"继续"按钮 tap 后进入主界面
- 页面登录测试：OpenWrt 局域网地址 `192.168.1.1`，账户 `root`，密码 `password`（S20U 测试用）

## 六、遗留待办（按优先级）

1. 【第一优先级】S20U 验证 f12：过权限弹窗 → 确认顶部无 ActionBar、底部 tabbar 渲染、页面铺满
2. 若底栏仍不渲染：查 WebView 硬件加速/合成层问题（试 `web.setLayerType`、去掉沉浸式对比、升级 WebView 系统组件），或改用 `position:sticky` 容器方案兜底
3. 登录 192.168.1.1 验证页面功能；验证 Tailscale 状态卡
4. 清理诊断代码（diag-static/diag-fixed/DIAG 块）后出正式包
5. 可延展：LuCI 代理跳转、证书忽略开关、多连接切换 UI 优化
6. S24U 回归验证（底栏常驻、全屏、版本号显示）

## 七、打包内容清单

本交接文件夹应包含：
- `docs/`：本文档 + NEXT_AI_PROMPT.md（给下一个 AI 的提示词）+ build.bat + build.py（一键构建）
- `src/`：前端 www 源码（干净版）+ 原生壳源码 + AndroidManifest + res 图标
- `apk/`：signed-final12.apk（最新）+ 可选历史
- `keystore/`：release.keystore
- `diagnose/`：关键诊断截图（f11 异常截图、权限弹窗截图）
## 八、【重要更正 · 2026-10-08 第二轮】真实根因与已完成修复

> ⚠️ 下面这一节的结论**推翻**了本文档第二节的旧判断。请以本节为准。

### 8.1 更正旧结论

| 旧文档说的 | 实际是 |
|---|---|
| 根因 = 默认主题带 ActionBar + 非沉浸窗口 | ❌ 无关。改主题/`FEATURE_NO_TITLE`/沉浸式对现象**零影响** |
| 测试机 S20U 是安卓 15 | ❌ `R3CN30BMCZZ` 实际 **Android 13 / SDK 33** |
| 底部 tabbar「未渲染」 | ❌ 渲染了，只是被画到了屏幕外（缓冲区太小） |

### 8.2 真实根因

`AndroidManifest.xml` 把 `android:minSdkVersion` / `android:targetSdkVersion` 写成了 **`<manifest>` 的属性**。`<manifest>` 不认这两个属性，**aapt2 静默丢弃** → APK 实际 `targetSdk=0` / `minSdk=1`。

Android 因此把 App 判定为「Honeycomb 之前的远古应用」，启用 **320dp 屏幕兼容缩放**：

```
dumpsys window windows  →  mCompatFrame=[0,132][840,1695]   mGlobalScale=1.2857143
dumpsys SurfaceFlinger  →  geomBufferSize=[0 0 320 596]  +  SCALE 1.2857 变换
```

`1.2857 = 411.43/320`，`320` 正是 `CompatibilityInfo` 给远古应用的兼容屏宽上限。
结果：应用逻辑坐标只有 320×596 → WebView 帧缓冲只分配 320×596 → 图层放大 1.2857 倍贴图 → **只有左上角约 411×766 有像素，其余全黑**。

**快速判据**：`dumpsys window windows | grep -iE "mGlobalScale|mCompatFrame"`，只要 `mGlobalScale != 1.0` 就是这个病。

### 8.3 修复内容（`signed-final16.apk`，已真机验证）

原生壳：
1. `minSdkVersion/targetSdkVersion` 移入 `<uses-sdk>` 元素（**根因修复**）＋ 显式 `android:hardwareAccelerated="true"`
2. `setUseWideViewPort(true)` + `setLoadWithOverviewMode(true)`（否则 `<meta viewport>` 被忽略，视口锁死 320px）
3. 沉浸式/刘海适配加固

前端 JS（4 个真实功能 bug）：
4. **底部 Tab 完全切不动** —— `onClick` 里 `closest('[data-action]')` 的提前 `return` 拦掉了 `.tab-item`（它只有 `data-tab`）
5. `renderHosts` 兼容 `{leases:[...]}` / `{leases:{mac:{}}}` / 裸数组，并兼容 `valid` 与 `expires`
6. `renderFirewall` 兼容 `{rules:[...]}` / `{rules:{}}`
7. `renderWireless` 加密参数改从 `interfaces[].config` 读（原来读 radio 级 config → WPA2 被显示成「开放」）

前端 CSS：
8. 补 `.chevron` 尺寸（原来**完全没有这条规则**，箭头 SVG 被 flex 撑成占满整行的巨型图形）
9. `.cell-value` 的 `max-width` 55% → 72%（长数值被截断）；新增 `.cell-action{flex:none}`（`.modal-btn` 的 `flex:1` 被复用到列表行内会挤扁连接名）

### 8.4 修复后的实测结果

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `mCompatFrame` / `mGlobalScale` | `[0,132][840,1695]` / `1.2857143` | 均消失 |
| Activity 窗口帧 | `[0,170][1080,2179]` | **`[0,0][1080,2400]`** |
| WebView 缓冲区 | `320×596` | **`1080×2400`** |
| 页面 `innerWidth×dpr` | 320×3.375 | **412×2.625 = 1082 ≈ 1080** ✅ |

回归结果：自动登录 → 概览 / 功能 / 设置 三 Tab 互相切换正常；6 个详情页（网络接口、无线网络、主机/DHCP、防火墙、系统日志、系统）全部正常渲染；确认弹窗正常。

### 8.5 Linux 构建环境（取代第四节的三、四节 Windows 路径）

见 `NEXT_AI_PROMPT.md` 第三节。速记：
- 一键构建 `docs/scripts/build.sh`（默认输出 `signed-final13.apk`，可传参）
- 环境变量 `build/env.sh`；JDK21 由 `apt-get download` + `dpkg -x` 得到（`jdk-headless` 需补 `jre-headless`，且要修复悬空软链）
- 调试工具 `build/tools/`：`cdp.cjs`（CDP 直连 WebView 取真实视口）、`measure.cjs`（截图像素测量）、`mock_ubus.py`（模拟 OpenWrt，配合 `adb reverse` 做端到端联调）

---

## 九、【重要更正 · 2026-10-08 第三轮】对接真路由器（`signed-final20.apk`）

> 本轮首次接上**真实 OpenWrt**（`OpenWrt 软路由` / OpenWrt 24.10-SNAPSHOT / `192.168.1.1`）联调。
> 上一轮用 mock 路由器测试，**mock 不校验 ubus ACL，任何调用都成功** —— 这个盲区掩盖了下面全部问题。

### 9.1 用户报的「无法连接到」= 连接配置与运行时脱节

`Ubus.baseUrl` 原本是**手动同步的副本**，而 `addConn` / `editConn` / `select-conn` / `delConn`
四处都没有同步它 → 用户「加好连接 → 切概览」时 `baseUrl` 仍是空串，请求拼成 `file:///ubus`，
错误文案 `'无法连接到 ' + ''` 就显示成「无法连接到 （空）」。**重载页面能好**（`route()` 里有赋值），所以难以复现。

**已改为单数据源**：`baseUrl` 是 getter，实时从 `Store.active.url` 解析；并抽出 `App.connectActive()` 作为
统一入口，四个操作点与「从设置页切 Tab」全部走它。

### 9.2 ubus ACL 是白名单 —— 5 个功能页全空的真因

这台路由器的 ACL **不包含** `dhcp` / `dhcp.leases` / `firewall.rule` / `log` / `network.wireless` /
`network.reload` / `system.swap` / `system.poweroff`。而 `network.interface dump` 是**有**权限的，
只是老代码把对象名拆错了：

```js
Ubus.call('network', 'interface', 'dump', {})   // ❌ ubus 解析成 method="interface", params="dump"
Ubus.call('network.interface', 'dump', {})      // ✅
```

拆错后 ubus 要么判未授权（`Access denied` -32002），要么参数解析失败（`Parse error`）——
本轮概览页上的 `JSON-RPC 错误: Parse error` 正是后者。

**全部改用实测可用的接口**：

| 原调用 | 现用 |
|---|---|
| `network.interface` dump（对象名写错） | `network.interface` `dump`（顺带补流量：`luci-rpc getNetworkDevices` 的 `stats`） |
| `network.wireless status` | `luci-rpc` `getWirelessDevices` |
| `dhcp.leases` | `luci-rpc` `getDHCPLeases` |
| `firewall.rule list` | `uci` `get` `{config:"firewall"}` |
| `system.swap` | `system.info` 自带的 `swap` 字段 |
| `log read` | 无替代 → 菜单探测自动隐藏该项 |

并新增 `Ubus.login()` 保存 ACL + `Ubus.can(object, method)`，系统页据此**只渲染真正授权的按钮**
（本机「关机」被自动隐藏）。

### 9.3 其他

- `network.interface dump` 真机返回 **`{interface:[数组]}`**，`getDHCPLeases` 的 `expires` 是**剩余秒数**
  （dnsmasq 原始租约则是绝对时间戳，用 `1e9` 作阈值区分）
- `fmtBytes` B 级不取整导致速率显示 `52.552552552552555 B/s`；概览接口行的长 IP 被速率文本挤成省略号
- 真机全页面验证结果：概览（OpenWrt 软路由 / 24.10-SNAPSHOT / 负载 / 内存 289 MB / 实时速率）、
  网络接口（5 个接口含累计流量）、无线（3 个 SSID，`psk2` 正确显示）、主机-DHCP（7 台）、
  防火墙（9 条规则）、系统（型号/内核/温度 65.3°C）

*（内容由AI生成，仅供参考）*
