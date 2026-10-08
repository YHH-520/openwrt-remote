# OpenWrt Remote

**中文** · [English](#english)

![minSdk](https://img.shields.io/badge/minSdk-26-3ddc84) ![targetSdk](https://img.shields.io/badge/targetSdk-35-3ddc84) ![license](https://img.shields.io/badge/license-MIT-blue) ![build](https://img.shields.io/badge/build-aapt2%20%2B%20javac%20%2B%20d8-orange)

把软路由的管理装进手机的 Android 应用。它不重写一遍后台，而是**让 App 跟着路由器自己变**。

---

## 它是什么

一个 WebView 壳 + 原生桥的 Android 应用，用来远程管理 OpenWrt / ImmortalWrt 软路由。

- 所有功能走 **ubus JSON-RPC** 读写，不依赖 LuCI 的页面结构
- LuCI 独有的能力（iStore 装插件、各插件自己的复杂表单、网页终端）用**原生窗口**打开路由器页面
- **自适应菜单**：每个页面带一个探测函数，路由器没这个能力（缺插件、ACL 没授权）就自动从菜单里消失，不会留下点进去就报错的死页面

## 功能

**网络** —— 网络接口（协议 / 地址 / DNS 全可改）、无线（射频功率、信道、接口、扫描、踢客户端）、主机与 DHCP（服务端、静态租约、当前租约）、防火墙（默认策略、区域、转发、流量规则、重定向）、连接跟踪

**系统** —— 服务管理（启停 / 重启 / 开机自启）、进程、存储与 USB、指示灯、系统信息与 NTP、修改密码

**插件** —— 动态 DNS（读写）、UPnP 映射（含删除）、WireGuard

**路由器菜单镜像** —— 直接读 LuCI 的 `/admin/menu`，把路由器**真实装了的**页面（服务 / NAS / VPN / 统计 / iStore …）映射成入口，连标题都用 LuCI 自己的翻译表做了中文化

**配置写入** —— 完整的 uci set / add / delete + 落盘 + 自动重载对应服务；写操作全程受登录账号的 ACL 白名单约束

**界面** —— iOS 风格液态玻璃底栏（选中块可拖动）、大标题跟随滚动、表单走底部卡片、启动按 App 图标逐块拼装的动画、中文 / English / 跟随软路由、下拉刷新、局域网地址自动发现

## 构建

手工工具链，不需要 Gradle 或 Android Studio：

```
aapt2 compile → aapt2 link → javac → d8 → 注入 assets/www → zipalign → apksigner
```

```bash
source build/env.sh
export OWR_KS_PASS='你的签名口令'          # 首次先跑一次 docs/scripts/gen-keystore.sh
bash OpenWrtRemote-Handoff/docs/scripts/build.sh
```

产物在 `OpenWrtRemote-Handoff/output/owr-<版本>-c<版本号>.apk`，同时归档到 `apk/` 便于回滚。
`docs/build.bat` 是等价的 Windows 版。

工具链（JDK 21 + build-tools r35 + platform-35）体积太大，不在仓库里 ——
放进 `build/temp/` 下即可，或者设 `JAVA_HOME` / `ANDROID_SDK` / `ADB` 指过去。

## 运行要求

| 项 | 要求 |
|---|---|
| Android 版本 | **8.0（API 26）** 以上，`targetSdk 35` |
| 权限 | 只要 INTERNET、ACCESS_NETWORK_STATE，装完不弹权限框 |
| 系统 WebView | 界面效果取决于它。磨砂玻璃要 Chrome 76+，建议 Android 10 以上并保持 WebView 更新 |
| 路由器 | 需要开着 ubus（rpcd），且登录账号的 ACL 授权了要用的对象 |

## 目录

```
OpenWrtRemote-Handoff/
  src/            Android 源码（MainActivity.java、res/）+ 前端（www/）
  docs/           构建说明、Windows 版脚本、一键构建、生成签名密钥
  apk/            历史版本归档
build/
  env.sh          本机构建环境（路径按文件位置自动推导）
  tools/          调试工具：ubus 命令行、CDP 驱动、截图对比、探测脚本
```

## 许可

[MIT](LICENSE) —— 随意使用、修改、再分发，保留版权声明即可。

---

<a id="english"></a>

# English

An Android client that puts your router's admin panel in your pocket. It doesn't reimplement the backend — it **adapts itself to whatever the router can actually do**.

## What it is

A WebView shell with a native bridge, for remotely managing OpenWrt / ImmortalWrt routers.

- Everything goes through **ubus JSON-RPC** — it does not depend on LuCI's page structure
- LuCI-only capabilities (iStore package installs, complex plugin forms, the web terminal) open the router's own pages in a **native window**
- **Self-adapting menu**: every page carries a probe function. If the router lacks that capability (plugin missing, ACL not granted), the entry simply disappears instead of leaving a dead page that errors on tap

## Features

**Network** — interfaces (protocol / address / DNS all editable), wireless (tx power, channel, interfaces, scan, kick a client), hosts & DHCP (server, static leases, current leases), firewall (defaults, zones, forwarding, traffic rules, redirects), conntrack

**System** — services (start / stop / restart / enable-on-boot), processes, storage & USB, LEDs, system info & NTP, change password

**Plugins** — dynamic DNS (read/write), UPnP mappings (including delete), WireGuard

**Router menu mirroring** — reads LuCI's own `/admin/menu` and surfaces whatever the router **actually has installed** (Services / NAS / VPN / Statistics / iStore …), localising titles with LuCI's own translation tables

**Configuration writes** — full uci set / add / delete, persisted and followed by a reload of the affected service; every write is constrained by the logged-in account's ubus ACL

**UI** — iOS-style liquid-glass tab bar with a draggable selection pill, large title that fades into the nav bar on scroll, bottom-sheet forms, a launch animation that assembles the app icon piece by piece, Chinese / English / follow-the-router language, pull to refresh, LAN address auto-discovery

## Building

A hand-rolled toolchain — no Gradle, no Android Studio:

```
aapt2 compile → aapt2 link → javac → d8 → inject assets/www → zipalign → apksigner
```

```bash
source build/env.sh
export OWR_KS_PASS='your signing password'   # run docs/scripts/gen-keystore.sh once first
bash OpenWrtRemote-Handoff/docs/scripts/build.sh
```

Output lands in `OpenWrtRemote-Handoff/output/owr-<version>-c<versionCode>.apk` and is archived to `apk/` for easy rollback. `docs/build.bat` is the equivalent Windows script.

The toolchain itself (JDK 21 + build-tools r35 + platform-35) is too large to ship here — drop it in `build/temp/`, or point `JAVA_HOME` / `ANDROID_SDK` / `ADB` at your own copy.

## Requirements

| | |
|---|---|
| Android | **8.0 (API 26)** or newer, `targetSdk 35` |
| Permissions | only INTERNET and ACCESS_NETWORK_STATE — no permission prompts on install |
| System WebView | visual fidelity depends on it. Frosted glass needs Chrome 76+; Android 10+ with an up-to-date WebView is recommended |
| Router | ubus (rpcd) must be enabled, and the account's ACL must grant the objects being used |

## Layout

```
OpenWrtRemote-Handoff/
  src/            Android sources (MainActivity.java, res/) + frontend (www/)
  docs/           build notes, Windows script, one-shot build, keystore generator
  apk/            archived release builds
build/
  env.sh          local build environment (paths derived from the file's own location)
  tools/          debug helpers: ubus CLI, CDP driver, screenshot diffing, probes
```

## License

[MIT](LICENSE) — use it, modify it, redistribute it; just keep the copyright notice.

> Note: source comments and `docs/` are written in Chinese. This README covers everything needed to build and understand the architecture.
