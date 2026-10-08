---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 904628816c407f903d7447fc173521d4_1d034894c29611f1884b525400cd780f
    ReservedCode1: r/clE2kVL9wlSH75lHBRzIt5nAnYysqxDkKlkyEsUF4OQiy3PZtY1rpgK1BaoUTlI7obMK5yCoM0H/OPYnGceNmUByppnlPFqJVwvqWQdMNsyfxJE5L/u+e3FegeUfn6bdF7ILuAWByNSbs+GGGXeSK5wR8ANaTYr3rDd4B8iPXQ+15gOsOHOnGOHMU=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 904628816c407f903d7447fc173521d4_1d034894c29611f1884b525400cd780f
    ReservedCode2: r/clE2kVL9wlSH75lHBRzIt5nAnYysqxDkKlkyEsUF4OQiy3PZtY1rpgK1BaoUTlI7obMK5yCoM0H/OPYnGceNmUByppnlPFqJVwvqWQdMNsyfxJE5L/u+e3FegeUfn6bdF7ILuAWByNSbs+GGGXeSK5wR8ANaTYr3rDd4B8iPXQ+15gOsOHOnGOHMU=
---

# 后续提示词（直接粘贴给下一位 AI）

你是我的安卓开发助手，接手一个「WebView 壳 + 前端 PWA」的 OpenWrt 远程管理 App（包名 `com.owr.remote`）。
先读 `docs/README.md` 了解项目全貌与构建链。

**当前状态：`output/signed-final20.apk`（v1.0.07 / versionCode 9）已在真机（S20U `R3CN30BMCZZ`）对接真路由器 `OpenWrt 软路由`（OpenWrt 24.10-SNAPSHOT）跑通全部页面。**

---

## 一、本轮（final20）最重要的发现：**ubus ACL 是白名单制**

App 之前有 5 个功能页"看起来写对了、真机上全是空/报错"。根因不是代码逻辑，而是**这台路由器的 ubus ACL 只授权了特定对象**。

之前之所以没发现，是因为**上一轮用 mock 路由器联调，mock 不校验 ACL，任何调用都返回成功**——这个盲区掩盖了所有问题。

### 实测拿到的 ACL 白名单

`POST /ubus  {"method":"call","params":["00000000000000000000000000000000","session","login",{...}]}`
返回的 `result[1].acls.ubus` 就是当前账号的权限表。这台机器（root）实际授权如下：

| 对象 | 允许的方法 | 备注 |
|---|---|---|
| `session` | access, login | |
| `system` | info, board, validate_firmware_image, **reboot** | ⚠️ **没有 poweroff** |
| `network` | get_proto_handlers | ⚠️ **没有 reload** |
| `network.interface` | **dump** | 注意对象名是 `network.interface` |
| `network.rrdns` | lookup | |
| `iwinfo` | assoclist, countrylist, freqlist, txpowerlist, scan, **info** | ⚠️ **没有 devices** |
| `luci-rpc` | getHostHints, getBoardJSON, getNetworkDevices, getWirelessDevices, **getDHCPLeases**, getDUIDHints | **最好用的一组** |
| `luci` | getCPUInfo, getTempInfo, getFeatures, getRealtimeStats, getCPUUsage, getOnlineUsers, getProcessList, getLEDs, getVersion, getMountPoints, getUSBDevices, getBlockDevices…（共 23 个） | ⚠️ **没有任何日志接口** |
| `uci` | changes, get, add, apply, confirm, delete, order, rename, **set** | 全局读写 |
| `rc` | list, **init** | 可用于 `rc init {name:"network",action:"reload"}` |
| `service` | list | |
| `hostapd.*` | del_client, wps_start, wps_cancel, wps_status | |
| `dsl` | metrics | |
| `file` | read, write, list, remove, exec, stat | ⚠️ 列了但实测仍 `Access denied`（code -32002） |

**明确不可用（会 -32002 Access denied）**：
`dhcp` / `dhcp.leases` / `firewall.rule` / `log` / `network.wireless` / `network.reload` / `system.swap` / `system.poweroff`

### 换用的替代方案（已全部验证）

| 原调用 | 现在用的 |
|---|---|
| `network` + `interface` + `dump`（**对象名被写错**） | `network.interface` `dump` |
| `network.wireless status` | `luci-rpc` `getWirelessDevices` |
| `dhcp.leases` | `luci-rpc` `getDHCPLeases` |
| `firewall.rule list` | `uci` `get` `{config:"firewall"}` |
| `system.swap` | `system.info` 返回里自带 `swap` 字段 |
| `log read` | **无替代**（luci 无日志接口）→ 靠探测自动隐藏该菜单项 |
| 流量统计 | `network.interface dump` **不含 statistics** → 从 `luci-rpc getNetworkDevices` 的 `stats.rx_bytes/tx_bytes` 按设备名补齐 |

### ⚠️ ubus 对象名不能拆开传

```js
// ❌ 错：ubus 会解析成 method="interface"、params="dump"（字符串而非对象）
//      轻则 ACL 判未授权(Access denied)，重则参数解析失败(Parse error)
Ubus.call('network', 'interface', 'dump', {})

// ✅ 对：对象名整体传
Ubus.call('network.interface', 'dump', {})
```

本轮在概览页看到的 `JSON-RPC 错误: Parse error` 就是这条引起的。

---

## 二、本轮修复清单

### 1. 「无法连接到 （空）」—— 连接配置与运行时脱节（**用户最开始报的故障**）

`Ubus.baseUrl` 原本是个**手动同步的副本**，但设置页的四个操作都没有同步它：

- `addConn()`（添加连接）
- `editConn()`（改地址）
- `select-conn`（切换连接）— 还漏了清 session，会拿旧路由器的会话去请求新路由器
- `delConn()`（删激活连接）

结果：用户「加好连接 → 切到概览」时 `baseUrl` 还是初始空串 `''`，请求拼成 `file:///ubus`（页面 origin 就是 `file://`）→ 报错文案 `'无法连接到 ' + ''` 就成了「无法连接到 （空）」。**重载页面能好**，因为 `boot()→route()` 里有赋值——这也是它难以复现的原因。

**修法（单数据源）**：把 `baseUrl` 改成 **getter**，每次实时从 `Store.active.url` 解析；`setter` 留空仅为兼容旧写法，不会在严格模式下抛错。这样任何路径都不可能再脱节。

同时抽出统一入口 `App.connectActive({force, tab, silent})`，让 route / addConn / editConn / select-conn / delConn / 从设置页切 Tab **全部**走它。`force:true` 用于「目标变了必须重登」的场景。

### 2. ACL 感知的 UI

`Ubus.login()` 现在会把返回的 `acls.ubus` 存下来，新增 `Ubus.can(object, method)`。
系统页据此**只渲染真正授权的操作按钮**——在这台机器上「关机」被自动隐藏（ACL 里没有 `system.poweroff`），而不是让用户点了才报权限不足。

### 3. 数据结构适配

- `network.interface dump` 真机返回 **`{interface: [数组]}`**（老代码按对象用 `Object.entries`，接口名会显示成 `0`/`1`/`2`）
- `getDHCPLeases` 字段是 `ipaddr/macaddr/expires`，且 **`expires` 是「剩余秒数」**（如 41917），而 dnsmasq 原始租约里是「绝对时间戳」→ 用 `1e9`（2001 年）作阈值区分
- 无线数据在 `radios[].interfaces[].config`（真实 ssid/encryption）+ `.iwinfo`（信道/信号/速率）
- 防火墙字段：`name / src / proto / dest_port / target / family`，`enabled` 是字符串 `"0"`

### 4. UI 打磨

- `fmtBytes` 对 B 级不取整 → 速率显示出 `52.552552552552555 B/s`。已改为 `Math.round`
- 概览接口行原本三个元素挤一行，长 IP（`10.29.21.139/18`）被速率文本挤成省略号 → 改为两行（上行「名称 + IP」、下行流量）
- 无线页 `band` 字段是 `2g` → 显示成 `2.4G`

---

## 三、Linux 构建环境（本机已就绪，别再装 Windows 工具链）

一键脚本：`docs/scripts/build.sh [输出名]`，环境变量在 `../../build/env.sh`。

| 组件 | 路径 | 来源 |
|---|---|---|
| JDK 21.0.12.1 | `build/temp/jdk/root/usr/lib/jvm/java-21-openjdk-amd64` | `apt-get download openjdk-21-jdk-headless openjdk-21-jre-headless` + `dpkg -x` |
| build-tools | `build/temp/sdk/build-tools/android-15`（aapt2/d8/zipalign/apksigner） | Google `build-tools_r35_linux.zip` |
| android.jar | `build/temp/sdk/platforms/android-35/android.jar` | Google `platform-35_r02.zip` |
| adb | `build/temp/platform-tools/adb` | Google platform-tools-latest-linux.zip |
| 调试脚本 | `build/tools/cdp.cjs`（CDP 直连 WebView）/ `measure.cjs`（截图像素测量）/ `mock_ubus.py`（模拟路由器） | 本仓库 |
| 探测样本 | `build/probe/*.json`（真机各接口的真实返回） | 本轮抓取 |

**踩过的坑**
- `apt-get download` 免 root 直接拉 deb，20MB/s，比下 180MB 的 JDK tar.gz 快得多；但 `jdk-headless` **不含运行时**，必须补 `jre-headless`
- `dpkg -x` 解出来的 `conf/`、`lib/jvm.cfg` 等是**指向 `/etc/...` 的绝对软链**，会全部悬空 → `javac` 报 `Error loading java.security file`。需要把悬空软链替换成 `root/etc/...` 下的真实文件（25 个）
- `nohup` 在本沙箱不可用（缺 `libsystemd.so.0`），长任务用后台任务机制
- Node ESM 在本机会触发 undici 的 WASM 加载失败 → CDP 脚本一律写成 **CommonJS `.cjs`**，并引用 `/home/<用户名>/.workbuddy/binaries/node/workspace/node_modules/ws`
- `javac --release 8`（JDK21 仍支持）；`d8 --min-api 26`。构建脚本里 `ROOT` 要 `$HERE/../..`（脚本在 `docs/scripts/` 下）
- `pkill -f "xxx.py"` 会命中执行它的那个 shell 自己（命令行含同样字符串），后半段命令不会执行

---

## 四、真机调试手法（很有效，建议沿用）

1. **抓页面真实状态**：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`，再跑
   `build/tools/cdp.cjs eval '<expr>'` / `eval-shot out.png '<expr>'`
   —— 能直接读 `App.state` / `Ubus.baseUrl` / `Ubus.session` / 任意元素几何，**比截图分析快得多**
2. **抓服务端原始响应**：在 WebView 里直接 `fetch(...).then(r=>r.text())` 把结果写到 `window.__x`，
   再读回来。本轮就是靠这个看到 `{"error":{"code":-32002,"message":"Access denied"}}` 才定位到 ACL
3. **监听页面报错**：CDP 开 `Log.enable` + `Runtime.enable` 后 `Page.reload`，
   能看到 `Fetch API cannot load file:///ubus` 这类关键日志
4. **判定屏幕兼容缩放**：`dumpsys window windows | grep -iE "mGlobalScale|mCompatFrame"`
   —— 出现 `mGlobalScale != 1.0` 就中了 320dp 兼容模式（上一轮的根因）
5. **看图层**：`dumpsys SurfaceFlinger | grep -A10 "MainActivity\$_"` 看 `geomBufferSize` / `SCALE`
6. **免 mock 直连真机**：手机与路由器同网段时，App 里连接地址直接填 `http://192.168.1.1` 即可。
   若要用 mock，注意手机与电脑可能不同网段或 WiFi 开了客户端隔离 → `adb reverse tcp:8080 tcp:8080`，
   地址填 `http://127.0.0.1:8080`。反向隧道回空时先 `adb kill-server && adb start-server`

---

## 五、下一位 AI 从这里开始

**已彻底解决**（真机验证）：连接脱节、5 个功能页全空、Parse error、无线加密误报、UI 截断。
当前 5 个功能页均正常：网络接口 / 无线网络 / 主机-DHCP（7 台设备）/ 防火墙（9 条规则）/ 系统（含温度）。

**待办**：

1. **「系统日志」页目前无法使用** —— 这台机器的 ACL 里 `luci` 没有任何日志接口，`log` 对象也未授权，
   `file exec` 虽在 ACL 里但实测 `Access denied`。所以菜单探测会**自动隐藏**该项。
   若想恢复：可尝试 `luci getRealtimeStats` / `service list` 等弱相关数据，或改由路由器侧安装带 ACL 的插件
2. **「重启网络」按钮**用的是 `rc init {name:"network",action:"reload"}`（走 `Ubus.can('network','reload')` 的 fallback），
   **尚未在真机上实际触发过**（会短暂断网，我没敢在生产路由器上试）。下次可谨慎验证
3. `discoverTailscaleIp()` 只在**手动登录**后调用，`route()` 自动登录不会调用
   —— 如果希望自动登录也弹「发现 Tailscale 地址」，需要在 `connectActive()` 里补一行
4. 顶部导航条 `#nav` 位于 `y=0..44`，画在状态栏/刘海区域内（沉浸式隐藏了状态栏，实测无遮挡）
5. `MainActivity` 里的 `MetricsBridge`（JS 名字 `AndroidBridge`）目前前端没有调用，是上一轮留下的诊断桥；
   `setWebContentsDebuggingEnabled(true)` 同理。留着对排查有用，去留自定
6. **S24U（`R5CY544P8HR`）回归验证** —— 本机只接了 S20U（`R3CN30BMCZZ`）
7. **多固件兼容**：本轮的适配都是围绕这台 `OpenWrt 软路由` 的真实返回做的。
   换别的固件（ACL 更宽松/更严格、接口返回略有差异）可能需要再调；`fetchInterfaces()` 与各
   `render*()` 里都保留了对旧结构的兼容分支

## 六、约束

- 禁止在系统目录写入/删除；中间文件放 `build/`，最终产物放 `output/`
- 每次验证都截图存档到 `build/shots/`，文件名带版本号
- 装包用 `adb install -r -d`；`pm clear` 后再启动可拿到"首次启动"状态
- 完成一项再汇报一项
*（内容由AI生成，仅供参考）*
