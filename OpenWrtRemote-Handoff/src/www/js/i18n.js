'use strict';

/* ================= 语言（中文 / English / 跟随软路由） =================

   这里不逐个渲染函数去包 T()，那有 600 多处中文，改完既慢又容易漏。
   做法是反过来：**代码里的中文原文就是 key**，等 DOM 渲染完之后扫一遍文本节点
   做精确匹配替换（见 apply）。于是：
     - 绝大多数文案落在各自独立的 <span>/<div> 里，整节点匹配即可命中
     - 匹配不到的原样保留 —— UCI 的值、用户输入、路由器返回的标题都不会被误伤
     - 带数字的整句（"4 个射频 · 3 个接口 · …"）用 RULES 里的正则兜
   优点是不用动 app.js 的渲染代码；代价是覆盖率取决于词典，没收录的仍是中文。

   「跟随软路由」不是猜的：OpenWrt 把界面语言放在 /etc/config/luci 里
   （main.lang 为具体语言码，或 'auto' 表示按客户端语言协商），
   languages 段还能看出装了哪些语言包。见 resolveFromRouter()。 */

const EN = {
  /* ---------- 外壳 / 底栏 / 导航 ---------- */
  '概览': 'Overview',
  '功能': 'Features',
  '设置': 'Settings',
  '详情': 'Details',
  '路由器远程管理': 'Router remote console',
  'OpenWrt 路由器': 'OpenWrt router',

  /* ---------- 通用词汇 ---------- */
  '保存': 'Save',
  '取消': 'Cancel',
  '确定': 'OK',
  '删除': 'Delete',
  '编辑': 'Edit',
  '修改': 'Edit',
  '添加': 'Add',
  '创建': 'Create',
  '清除': 'Clear',
  '停止': 'Stop',
  '启动': 'Start',
  '重启': 'Restart',
  '重载': 'Reload',
  '重载配置': 'Reload config',
  '刷新': 'Refresh',
  '刷新状态': 'Refresh status',
  '刷新日志': 'Refresh log',
  '重试': 'Retry',
  '下一步': 'Next',
  '名称': 'Name',
  '状态': 'Status',
  '运行状态': 'State',
  '类型': 'Type',
  '模式': 'Mode',
  '动作': 'Action',
  '接口': 'Interfaces',
  '协议': 'Protocol',
  '密码': 'Password',
  '用户名': 'Username',
  '新密码': 'New password',
  '再输一次': 'Repeat password',
  '开': 'On',
  '关': 'Off',
  '启用': 'Enable',
  '停用': 'Disable',
  '启用规则': 'Enable rule',
  '停用规则': 'Disable rule',
  '未知': 'Unknown',
  '未知设备': 'Unknown device',
  '未知错误': 'Unknown error',
  '成功': 'Done',
  '失败': 'Failed',
  '失败：': 'Failed: ',
  '读取失败': 'Read failed',
  '加载失败': 'Load failed',
  '操作失败': 'Operation failed',
  '已保存': 'Saved',
  '已保存并应用': 'Saved and applied',
  '已删除': 'Deleted',
  '已开启': 'Enabled',
  '已关闭': 'Disabled',
  '已停止': 'Stopped',
  '已停用': 'Disabled',
  '已连接': 'Connected',
  '已断开': 'Disconnected',
  '未连接': 'Down',
  '未运行': 'Stopped',
  '未配置': 'Not configured',
  '未配置连接': 'No connection configured',
  '运行中': 'Running',
  '服务中': 'Running',
  '生效中': 'Active',
  '等待更新': 'Waiting for update',
  '断开': 'Disconnect',
  '任意': 'Any',
  '任意 (*)': 'Any (*)',
  '自动': 'Auto',
  '自动 (auto)': 'Auto (auto)',
  '自动获取': 'Automatic',
  '自动 / 驱动默认': 'Auto / driver default',
  '浅色': 'Light',
  '深色': 'Dark',
  '跟随系统': 'System',
  '中': 'Med',
  '强': 'Strong',
  '弱': 'Weak',
  '只读': 'read-only',
  '当前账号只读': 'This account is read-only',
  '点击任意一行可修改': 'Tap any row to edit',
  '点击任意一行可修改配置': 'Tap any row to edit',
  '点「断开」可强制踢下线': 'Tap Disconnect to kick it off',
  '点击固定 IP': 'Tap to pin an IP',

  /* ---------- 登录页 ---------- */
  '登录': 'Sign in',
  '登录中…': 'Signing in…',
  '登录失败': 'Sign-in failed',
  '登录失败：': 'Sign-in failed: ',
  '管理地址与连接设置': 'Address & connection settings',
  '请输入用户名': 'Enter a username',
  'OpenWrt 登录密码': 'OpenWrt password',

  /* ---------- 概览 ---------- */
  '状态': 'Status',
  '负载': 'Load',
  '内存': 'Memory',
  '本地时间': 'Local time',
  '运行时间': 'Uptime',
  '温度': 'Temperature',
  '型号': 'Model',
  '固件': 'Firmware',
  '内核': 'Kernel',
  '硬件': 'Hardware',
  '主机名': 'Hostname',
  '全部接口与更多功能': 'All interfaces & more',

  /* ---------- 设置页 ---------- */
  '连接': 'Connections',
  '连接方式': 'Connection mode',
  '账号': 'Account',
  '外观': 'Appearance',
  '语言': 'Language',
  '数据': 'Data',
  '运行环境': 'Environment',
  '提示': 'Notes',
  '局域网直连': 'Direct LAN',
  '同一 WiFi / 局域网内直接访问路由器地址': 'Reach the router directly on the same Wi-Fi / LAN',
  'Tailscale': 'Tailscale',
  '其他内网穿透': 'Other tunnels',
  '添加连接': 'Add connection',
  '编辑连接': 'Edit connection',
  '删除连接': 'Delete connection',
  '本地记住密码': 'Remember password',
  '密码保存在本机 App 内（明文），请勿在共享设备使用': 'The password is stored on this device in plain text — avoid shared devices',
  '当前': 'Active',
  '删除后需要重新填写地址与账号。': 'You will need to re-enter the address and account afterwards.',
  '将删除全部连接、账号和本地保存的密码。': 'This deletes every connection, the account and the saved password.',
  '清除所有设置与密码': 'Clear all settings & password',
  '清除所有数据': 'Clear all data',
  '修改路由器登录密码': 'Change router password',
  '修改路由器密码': 'Change router password',
  '密码已修改': 'Password changed',
  '密码会以 crypt 哈希写入路由器，不会明文保存在路由器上。': 'The password is written to the router as a crypt hash, never in plain text.',
  '将把路由器上': 'This changes the router password to',
  '的密码改成新密码。改完请立刻确认能重新登录，否则会连不上。': '. Make sure you can sign in again right after — otherwise you will be locked out.',
  '两次输入不一致': 'The two entries do not match',
  '密码不能为空': 'Password cannot be empty',
  '至少 8 位': 'At least 8 characters',
  '例如 my-laptop': 'e.g. my-laptop',
  '名称，如：家里软路由': 'Name, e.g. Home router',
  '管理地址': 'Address',
  '请填写管理地址': 'Enter the address',
  '未指定端点': 'No endpoint given',
  'frp / ZeroTier / ngrok 等自定义地址，可带端口': 'Custom address for frp / ZeroTier / ngrok, port optional',
  'OpenWrt 安装 Tailscale 后，使用其分配的 100.x 地址或 MagicDNS 域名': 'After installing Tailscale on OpenWrt, use its 100.x address or MagicDNS name',
  '手机 Tailscale': 'Phone Tailscale',
  '本机 Tailscale IP': 'Local Tailscale IP',
  '本端地址': 'Local address',
  '发现 Tailscale 地址': 'Tailscale address found',

  /* ---------- 功能页 / 分组 ---------- */
  '网络': 'Network',
  '系统': 'System',
  '插件': 'Plugins',
  '路由器原生页面': 'Router native pages',
  '路由器页面': 'Router pages',
  '正在读取路由器菜单…': 'Reading the router menu…',
  '正在探测路由器可用功能…': 'Detecting available features…',
  '正在扫描，约需 5–15 秒…': 'Scanning, 5–15 seconds…',
  '直接向路由器要 LuCI 菜单，首次约 1~2 秒': 'Asking the router for its LuCI menu; ~1–2 s the first time',
  '无法探测到可用功能，请检查登录状态或路由器 ubus 权限': 'No features detected — check the session or the router ubus permissions',
  '输入或从下拉里选（共 ': 'Type or pick from the list (',
  '个）': ')',
  '网络接口': 'Network interfaces',
  '无线网络': 'Wireless',
  '无线客户端': 'Wireless clients',
  '主机 / DHCP': 'Hosts / DHCP',
  '防火墙': 'Firewall',
  '连接跟踪': 'Connections',
  '服务管理': 'Services',
  '进程': 'Processes',
  '存储 / USB': 'Storage / USB',
  '指示灯': 'LEDs',
  '系统日志': 'System log',
  '动态 DNS': 'Dynamic DNS',
  'UPnP 映射': 'UPnP mappings',
  '周边 WiFi': 'Nearby Wi-Fi',
  '完整 LuCI 控制台': 'Full LuCI console',
  '路由器原生界面，所有设置的总入口': 'The router’s own UI — the master entry to every setting',
  'iStore 应用商店': 'iStore app store',
  '安装 / 卸载 / 更新插件': 'Install / remove / update plugins',
  '网页终端': 'Web terminal',
  '直接开一个 shell，进来会自动登录': 'A full shell, signed in automatically',
  '按 CPU': 'By CPU',
  '按内存': 'By memory',
  '按接口地址': 'By interface address',
  '未知设备': 'Unknown device',
  '本地记住密码': 'Remember password',

  /* ---------- 网络接口 ---------- */
  '静态地址': 'Static',
  'DHCP 客户端': 'DHCP client',
  'DHCPv6 客户端': 'DHCPv6 client',
  'PPPoE 拨号': 'PPPoE',
  'PPP': 'PPP',
  'QMI 蜂窝': 'QMI cellular',
  'MBIM 蜂窝': 'MBIM cellular',
  'WireGuard': 'WireGuard',
  '无协议': 'No protocol',
  'IPv4 地址': 'IPv4 address',
  '子网掩码': 'Netmask',
  '网关': 'Gateway',
  'DNS 服务器': 'DNS servers',
  '单独指定 DNS': 'Override DNS',
  '启用该接口': 'Enable this interface',
  'MAC 地址': 'MAC address',
  'MAC 格式应为 AA:BB:CC:DD:EE:FF': 'MAC must look like AA:BB:CC:DD:EE:FF',
  '静态地址不能为空': 'Static address is required',
  '子网掩码不能为空': 'Netmask is required',
  'IP 格式不正确': 'Invalid IP format',
  '多个用空格分隔': 'Separate with spaces',
  '多个用空格分隔；留空表示由上游下发': 'Separate with spaces; leave empty to use the upstream value',
  '留空表示不指定': 'Leave empty to leave unset',

  /* ---------- 无线 ---------- */
  'SSID（网络名称）': 'SSID (network name)',
  'SSID 不能为空': 'SSID is required',
  'Wi-Fi 密码': 'Wi-Fi password',
  '加密方式': 'Encryption',
  '开放（不加密）': 'Open (no encryption)',
  'WPA / WPA2 混合': 'WPA / WPA2 mixed',
  'WPA2 / WPA3 混合': 'WPA2 / WPA3 mixed',
  'OWE（增强开放）': 'OWE (enhanced open)',
  '隐藏 SSID': 'Hide SSID',
  '信道': 'Channel',
  '发射功率': 'Tx power',
  '国家 / 地区代码': 'Country code',
  '频宽模式': 'Channel width',
  '接入点 (AP)': 'Access point (AP)',
  '客户端 (STA) / 中继': 'Client (STA) / repeater',
  '接入点': 'Access point',
  '客户端': 'Client',
  '绑定网络': 'Network',
  '启用该射频': 'Enable this radio',
  '射频开启': 'Radio on',
  '射频关闭': 'Radio off',
  '没有可用的射频': 'No radio available',
  '功率越高覆盖越好，但干扰和发热也更大': 'Higher power means better coverage but more interference and heat',
  '保存后该无线网络会重启，正在连接它的设备会短暂掉线。': 'Saving restarts this network; connected devices will drop briefly.',
  '修改信道或频宽会立刻重启该射频，所有连在这个射频上的设备会短暂掉线（约 5–15 秒）。': 'Changing channel or width restarts the radio; every device on it drops for about 5–15 s.',
  '该路由器不支持扫描（iwinfo.scan 不可用）': 'This router cannot scan (iwinfo.scan unavailable)',
  '扫描完成，周边没有其它 WiFi': 'Scan finished — no other Wi-Fi around',
  '重新扫描': 'Scan again',
  '扫描周边 WiFi': 'Scan nearby Wi-Fi',
  '添加无线网络': 'Add wireless network',
  '（隐藏 SSID）': '(hidden SSID)',
  '信号': 'Signal',
  '噪声': 'Noise',
  '加入': 'Join',
  '加密': 'Security',
  '开放': 'Open',
  '个 · 按信号强度排序': ' · sorted by signal',

  /* ---------- 主机 / DHCP ---------- */
  'DHCP 服务器': 'DHCP server',
  '当前租约': 'Active leases',
  '静态地址分配': 'Static leases',
  'DHCP 主机名': 'DHCP hostname',
  'IP 来源': 'IP source',
  '租期': 'Lease',
  '固定 IP': 'Pinned IP',
  '未固定 IP': 'Not pinned',
  '未填 MAC': 'No MAC',
  '地址池起始编号': 'Address pool start',
  '可分配数量': 'Pool size',
  '在此接口关闭 DHCP': 'Disable DHCP on this interface',
  '不提供 DHCP': 'No DHCP',
  '强制下发（忽略客户端请求）': 'Force (ignore client requests)',
  '客户端拿到的地址 = 接口网段的第 N 个，例如 192.168.6.1 配 100 就是 192.168.6.100 起': 'Clients get the Nth address of the interface subnet — e.g. 192.168.6.1 with 100 starts at 192.168.6.100',
  '起始编号必须是数字': 'The start index must be a number',
  '数量必须是数字': 'The count must be a number',
  '保存后会重启 dnsmasq / odhcpd，已联网的设备会短暂续租失败但会很快恢复。': 'Saving restarts dnsmasq / odhcpd; clients briefly fail to renew, then recover.',
  '没有检测到 USB 设备（共 ': 'No USB device detected (',
  '将把该 MAC 固定到一个 IP，重启后仍然生效。': 'This pins the MAC to an IP; it survives a reboot.',
  '已保存静态地址': 'Static lease saved',
  '已添加静态地址': 'Static lease added',
  '手动添加静态地址': 'Add static lease by hand',
  '还没有静态分配，可在下方租约里点一条来添加': 'No static lease yet — tap a lease below to create one',
  '执行': 'Run',
  '（无主机名）': '(no hostname)',
  '（未命名）': '(unnamed)',

  /* ---------- 防火墙 ---------- */
  '默认策略': 'Default policies',
  '区域 (zone)': 'Zones',
  '区域转发': 'Zone forwarding',
  '流量规则': 'Traffic rules',
  '端口转发': 'Port forwards',
  '入站 (input)': 'Input',
  '出站 (output)': 'Output',
  '转发 (forward)': 'Forward',
  '区域名称': 'Zone name',
  '区域名称不能为空': 'Zone name is required',
  '来源区域': 'Source zone',
  '目标区域': 'Destination zone',
  '来源 IP / 网段': 'Source IP / subnet',
  '目标 IP / 网段': 'Destination IP / subnet',
  '协议': 'Protocol',
  '来源端口': 'Source port',
  '目标端口': 'Destination port',
  '外部端口': 'External port',
  '内网目标 IP': 'Internal target IP',
  '内网目标端口': 'Internal target port',
  '规则名称': 'Rule name',
  '新建区域': 'New zone',
  '新建流量规则': 'New traffic rule',
  '新建端口转发': 'New port forward',
  'MSS 钳制 (mtu_fix)': 'MSS clamping (mtu_fix)',
  'NAT 伪装 (masq)': 'Masquerading (masq)',
  '全锥 NAT (fullcone)': 'Full-cone NAT (fullcone)',
  'SYN 洪水保护': 'SYN flood protection',
  'WAN 侧通常开启': 'Usually enabled on the WAN side',
  '多条用空格分隔': 'Separate multiple with spaces',
  '例如 80 443': 'e.g. 80 443',
  '例如 1024-65535': 'e.g. 1024-65535',
  '例如 8080': 'e.g. 8080',
  '例如 内网 NAS': 'e.g. internal NAS',
  '留空表示不限': 'Leave empty for any',
  '留空表示与外部端口相同': 'Leave empty to match the external port',
  '向所有区域开放': 'Open to all zones',
  '默认策略': 'Default policies',
  '将把外部端口映射到内网主机，保存后立即生效。': 'Maps the external port to an internal host; effective immediately after saving.',
  '外部端口会直接暴露到公网，请确认目标服务是安全的。': 'The external port is exposed to the internet — make sure the target service is safe.',
  '改动会立即重载防火墙。': 'Saving reloads the firewall immediately.',
  '改动会重载防火墙，已建立的连接不受影响。': 'Saving reloads the firewall; established connections are unaffected.',
  '新区域默认拒绝入站与转发，需要自行放行。': 'A new zone rejects input and forwarding by default — you must allow traffic yourself.',
  '入站方向改成 ACCEPT 会让路由器所有端口对外可见，请谨慎。': 'Setting input to ACCEPT exposes every router port — be careful.',
  '入站设为 ACCEPT 等于对该区域完全开放，请确认这是你要的。': 'Input = ACCEPT fully opens this zone — make sure that is what you want.',
  '这将删除该规则本身，与其相关的转发也会一并失效。': 'This deletes the rule; related forwarding stops working.',
  '还没有端口转发规则': 'No port forward yet',

  /* ---------- 服务 / 进程 / 存储 / LED ---------- */
  '运行控制': 'Runtime control',
  '开机自启': 'Autostart',
  '设为开机自启': 'Enable autostart',
  '取消开机自启': 'Disable autostart',
  '启用该服务': 'Enable this service',
  '个运行中': ' running',
  '个已关自启': ' with autostart off',
  '重启路由器后该服务会自动启动。': 'The service will start automatically after a reboot.',
  '重启路由器后该服务不再自动启动（当前运行状态不变）。': 'The service will no longer start automatically after a reboot (its current state is unchanged).',
  '停止关键服务（network / dnsmasq / firewall）可能让本机立刻失联，请谨慎操作。': 'Stopping a critical service (network / dnsmasq / firewall) can cut this device off immediately — be careful.',
  '关键服务可能导致本机短暂失去连接。': 'A critical service may briefly disconnect this device.',
  '挂载点': 'Mount points',
  '块设备': 'Block devices',
  '可用': 'Free',
  '已用': 'Used',
  '条自动映射': ' auto mappings',
  '没有对端': 'No peer',
  '个进程': ' processes',

  /* ---------- 动态 DNS / UPnP / WireGuard ---------- */
  '服务商': 'Provider',
  '域名': 'Domain',
  '账号 / 密钥 ID': 'Account / key ID',
  '密码 / 密钥': 'Password / key',
  '监控接口': 'Monitored interface',
  '当前 IP': 'Current IP',
  '域名不能为空': 'Domain is required',
  '例如 dyndns.org / no-ip.com': 'e.g. dyndns.org / no-ip.com',
  '保存后会重新加载 ddns 服务并立即尝试一次更新。': 'Saving reloads ddns and tries one update immediately.',
  '将新增一条 DDNS 配置并启动服务。': 'Adds a DDNS entry and starts the service.',
  '还没有配置动态 DNS': 'Dynamic DNS is not configured',
  '添加动态 DNS': 'Add dynamic DNS',
  '动态 DNS 需要先在域名商处配置好 DDNS 服务，再填入域名、账号和密钥。': 'Set up DDNS at your domain registrar first, then fill in the domain, account and key here.',
  '将删除自动映射「': 'This removes the automatic mapping “',
  '」，对应内网程序的外部端口会立即失效。': '” — the app’s external port stops working immediately.',
  '当前没有 UPnP 自动端口映射': 'No automatic UPnP mapping right now',
  '还没有 WireGuard 接口': 'No WireGuard interface yet',
  '还没有配置': 'Not configured yet',
  '条服务配置': ' service entries',
  '运行': 'Run',
  '外部': 'External',
  '内部': 'Internal',
  '入站': 'Inbound',
  '出站': 'Outbound',
  '转发': 'Forward',
  '来源': 'Source',
  '目标': 'Destination',
  '未运行': 'Stopped',
  '个块设备': ' block devices',
  '个挂载点 · ': ' mounts · ',
  '无块设备信息': 'No block device info',
  '无挂载信息': 'No mount info',
  '暂无设备连接': 'No device connected',
  '当前没有 DHCP 租约': 'No DHCP lease right now',
  '当前没有活动的连接': 'No active connection right now',
  '拿不到进程列表': 'Cannot read the process list',
  '没有可管理的服务': 'No manageable service',
  '没有可控制的指示灯': 'No controllable LED',
  '没有可查询的接入点': 'No access point to query',
  '未发现无线设备': 'No wireless device found',
  '没有可编辑的接口': 'No editable interface',
  '日志为空': 'Log is empty',
  '路由器没有这个菜单': 'The router has no such menu',
  '断开无线设备': 'Disconnect wireless client',
  '断开失败：': 'Disconnect failed: ',
  '已断开 ': 'Disconnected ',
  '上踢下线。设备会自动重连，除非勾选了拉黑。': '. It reconnects automatically unless you banned it.',
  '保存失败：': 'Save failed: ',
  '修改失败：': 'Change failed: ',
  '删除失败：': 'Delete failed: ',
  '当前账号没有配置写入权限': 'This account has no write permission',
  '当前账号没有 ': 'This account lacks ',
  '权限': ' permission',
  '当前环境不支持内置窗口，请用浏览器打开 ': 'In-app window unavailable here — open in a browser: ',
  '尚未配置管理地址': 'No management address configured',
  '打开失败': 'Failed to open',
  '已忽略该接口的请求': 'The interface request was ignored',
  '指令已发送': 'Command sent',
  '已添加 Tailscale 连接 ': 'Tailscale connection added ',
  '的 Tailscale 地址是 ': ' has the Tailscale address ',
  '，是否添加为远程连接？之后在任何网络都能远程管理。': '. Add it as a remote connection? Then you can manage the router from any network.',
  '远程 OpenWrt': 'Remote OpenWrt',
  '请先添加连接': 'Add a connection first',
  '请先登录后再使用': 'Sign in first',
  '请填写内网目标 IP': 'Enter the internal target IP',
  '请填写外部端口': 'Enter the external port',
  '扫描完成': 'Scan finished',
  '保存后该无线网络会重启': 'Saving restarts this network',
  '保存基本信息': 'Save general settings',
  '保存 DHCP 设置': 'Save DHCP settings',
  '保存时间同步': 'Save time sync',
  '保存动态 DNS': 'Save dynamic DNS',
  '保存端口转发': 'Save port forward',
  '保存流量规则': 'Save traffic rule',
  '保存静态地址': 'Save static lease',
  '保存默认策略': 'Save default policies',
  '保存无线接口': 'Save wireless interface',
  '基本信息': 'General',
  '时间同步': 'Time sync',
  '启用 NTP 客户端': 'Enable NTP client',
  '启用 NTP 时至少要填一个服务器': 'Enable at least one NTP server to use NTP',
  'NTP 服务器': 'NTP servers',
  '时区': 'Time zone',
  '时区列表不可用，可手填': 'Time zone list unavailable — type it manually',
  '保存后会重启时间同步服务。': 'Saving restarts the time sync service.',
  '主机名会影响局域网内识别这台路由器的方式。': 'The hostname is how this router is identified on the LAN.',
  '在路由器上执行': 'Run on the router',
  '操作（需谨慎）': 'Actions (be careful)',
  '记录': 'Record',
  '规则': 'Rules',
  '区域': 'Zones',
  '个区域 · ': ' zones · ',
  '条规则 · ': ' rules · ',
  '条活动连接 · ': ' active connections · ',
  '台在线设备 · ': ' clients online · ',
  '台设备连接': ' devices connected',
  '条）': ')',
  '个射频 · ': ' radios · ',
  '个接口 · ': ' interfaces · ',
  '个服务 · ': ' services · ',
  '/ 可用 ': ' / free ',
  ' · 上次更新 ': ' · updated ',
  ' · 停止序号 ': ' · stop seq ',
  ' · 全锥 NAT ': ' · fullcone ',
  ' · 内存 ': ' · memory ',
  ' · 出站 ': ' · outbound ',
  ' · 功率 ': ' · power ',
  ' · 噪声 ': ' · noise ',
  ' · 已用 ': ' · used ',
  ' · 已连 ': ' · up ',
  ' · 当前 CPU 占用 ': ' · CPU now ',
  ' · 接口 ': ' · interface ',
  ' · 转发 ': ' · forward ',
  ' · 运行 ': ' · running ',
  ' 个 · 租期 ': ' · lease ',
  ' 分': ' min',
  ' 分钟': ' minutes',
  ' 台': '',
  ' 天 ': ' d ',
  ' 小时': ' h',
  ' 小时 ': ' h ',
  ' 起 · ': ' up · ',
  '）从 ': ') from ',
  '并立即生效。': ' and takes effect immediately.',
  '这条配置。': ' this entry.',
  '的固定分配。': ' as a static lease.',
  '个 · 只读': ' · read-only',
  '个 · 只读（修改需要 LuCI）': ' · read-only (edit in LuCI)',
  '插件应用商店': 'Plugin store',
  '下一步': 'Next',
  '运行': 'Run',

  /* ---------- 自动获取地址 ---------- */
  '自动获取地址': 'Auto-detect address',
  '跳过手填，自动找到路由器的管理地址': 'Skip typing — find the router automatically',
  '正在扫描本机网关与常见网段…': 'Scanning the local gateway and common subnets…',
  '扫描': 'Scan',
  '扫描中': 'Scanning',
  '没扫到路由器，请确认手机已连上路由器的 WiFi': 'No router found — make sure the phone is on the router’s Wi-Fi',
  '已找到路由器 ': 'Router found ',

  /* ---------- 带「＋」前缀的按钮 ----------
     这些在源码里是 '＋ 添加连接' 这种整体字符串，trim 之后仍然带着 ＋，
     所以词典必须按带前缀的原文收录，否则整节点匹配不到。 */
  '＋ 添加连接': '+ Add connection',
  '＋ 添加无线网络': '+ Add wireless network',
  '＋ 添加动态 DNS': '+ Add dynamic DNS',
  '＋ 手动添加静态地址': '+ Add static lease',
  '＋ 新建端口转发': '+ New port forward',
  '＋ 新建流量规则': '+ New traffic rule',
  '＋ 新建区域': '+ New zone'
};

/* 带数字/拼接的整句只能靠正则兜。放在词典之后跑，命中不到再原样保留。 */
const RULES = [
  [/^共 (\d+) 项$/, (m) => m[1] + ' items'],
  [/^共 (\d+) 组$/, (m) => m[1] + ' groups'],
  [/^当前共 (\d+)/, (m) => 'Currently ' + m[1]],
  [/^最近 (\d+)/, (m) => 'Last ' + m[1]],
  [/^由路由器 LuCI 提供 · 共 (\d+) 组$/, (m) => 'Provided by the router’s LuCI · ' + m[1] + ' groups'],
  [/^菜单已根据路由器实际功能自适应（共 (\d+) 项）$/, (m) => 'Auto-detected from this router (' + m[1] + ' items)'],
  [/^(\d+) 个射频 · (\d+) 个接口 · (.*)$/, (m) => m[1] + ' radios · ' + m[2] + ' interfaces · ' + (EN[m[3]] || m[3])],
  [/^(\d+) 个接口 · 只读$/, (m) => m[1] + ' interfaces · read-only'],
  [/^(\d+) 个服务 · (\d+) 个运行中(.*)$/, (m) => m[1] + ' services · ' + m[2] + ' running' + m[3]],
  [/^(\d+) 个区域 · (\d+) 条规则 · (\d+) 条转发$/, (m) => m[1] + ' zones · ' + m[2] + ' rules · ' + m[3] + ' forwards'],
  [/^(\d+) 台设备连接$/, (m) => m[1] + ' devices connected'],
  [/^(\d+) 台在线设备 · (\d+) 条活动连接$/, (m) => m[1] + ' clients online · ' + m[2] + ' active connections'],
  [/^(\d+) 条活动连接 · (.*)$/, (m) => m[1] + ' active connections · ' + m[2]],
  [/^(\d+) 条规则 · (\d+) 条转发$/, (m) => m[1] + ' rules · ' + m[2] + ' forwards'],
  [/^运行 (.+)$/, (m) => 'Up ' + m[1]],
  [/^(\d+) 个块设备$/, (m) => m[1] + ' block devices'],
  [/^(\d+) 个进程$/, (m) => m[1] + ' processes'],
  [/^(\d+) 个挂载点 · (\d+) 个块设备$/, (m) => m[1] + ' mounts · ' + m[2] + ' block devices'],
  [/^(\d+) 个已关自启$/, (m) => m[1] + ' with autostart off'],
  [/^已断开 (.+)$/, (m) => 'Disconnected ' + m[1]],
  [/^接口 (.+)$/, (m) => 'Interface ' + m[1]],
  [/^射频 (.+)$/, (m) => 'Radio ' + m[1]],
  [/^区域 (.+)$/, (m) => 'Zone ' + m[1]],
  [/^保存 (.+)$/, (m) => 'Save ' + m[1]],
  [/^加入网络「(.+)」$/, (m) => 'Join network “' + m[1] + '”']
];

const Lang = {
  mode: 'router',      // 'router' | 'zh' | 'en'
  cur: 'zh',           // 实际生效的语言
  routerLang: null,    // 从路由器问到的（'zh'/'en'），null = 还没问过
  timer: null,
  orig: new Map(),     // 文本节点 -> 中文原文（切回中文时用来还原）
  attrOrig: new Map(), // 元素 -> { placeholder/title: 原文 }

  /* 同步定一个初始值：启动动画只露 1 秒多，等 ubus 回来就晚了。
     这里先用设备语言顶上，登录后再用路由器的语言覆盖（见 resolveFromRouter）。 */
  init() {
    this.mode = Store.data.lang || 'router';
    if (this.mode === 'router') this.cur = this.guessFromDevice();
    else this.cur = this.mode;
    this.watch();
    this.apply(document.body);
    return this.cur;
  },

  guessFromDevice() {
    return String(navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  },

  /* 「跟随软路由」到底跟什么：
     /etc/config/luci 的 main.lang 就是 LuCI 自己用的语言 ——
     具体语言码（zh_cn / en）直接用；写的是 'auto' 时说明 LuCI 按客户端语言协商，
     那我们的 WebView 报 navigator.language 就是它当时会选的那个；
     两者都不明确时，看路由器装了哪些语言包（languages 段）。 */
  async resolveFromRouter() {
    try {
      const r = await Uci.get('luci');
      const v = (r && r.values) || {};
      const raw = String((v.main && v.main.lang) || 'auto').toLowerCase();
      if (raw && raw !== 'auto') return raw.indexOf('zh') === 0 ? 'zh' : 'en';
      const nav = String(navigator.language || '').toLowerCase();
      if (nav.indexOf('zh') === 0) return 'zh';
      if (nav.indexOf('en') === 0) return 'en';
      const langs = v.languages || {};
      return Object.keys(langs).some(k => /^zh/i.test(k)) ? 'zh' : 'en';
    } catch (e) {
      return this.guessFromDevice();
    }
  },

  /* 登录完成后调一次：跟随模式下按路由器重新定语言 */
  async syncFromRouter() {
    if (this.mode !== 'router') return;
    const got = await this.resolveFromRouter();
    const first = this.routerLang === null;
    this.routerLang = got;
    if (got === this.cur && !first) return;
    if (got !== this.cur) { this.cur = got; this.restoreAll(); }
    this.apply(document.body);
    // 路由器菜单的标题也要跟着换语言：中文要翻译表，英文用源字符串
    if (window.App && App.state) { App.state.luci = null; App.state.luciAt = 0; }
    if (window.App && App.onLuciData) App.requestLuciData();
    if (window.App && App.state && App.state.phase === 'main' && !App.state.detail) {
      if (App.state.tab === 'settings') App.renderSettings();
      else if (App.state.tab === 'menu') App.renderMenu(true);
    }
  },

  set(mode) {
    this.mode = mode;
    Store.data.lang = mode;
    Store.save();
    this.restoreAll();                      // 先全部还原成中文，再按新语言重翻
    if (mode !== 'router') { this.cur = mode; this.apply(document.body); return this.cur; }
    // 跟随：先按设备语言顶一下，再向路由器确认
    this.cur = this.routerLang || this.guessFromDevice();
    this.apply(document.body);
    if (Ubus.session) this.syncFromRouter();
    return this.cur;
  },

  T(s) {
    if (this.cur !== 'en' || !s) return s;
    if (EN[s] !== undefined) return EN[s];
    for (const [re, fn] of RULES) { const m = s.match(re); if (m) return fn(m); }
    return s;
  },

  /* 扫一遍子树里的文本节点和 placeholder/title，做精确匹配替换。
     命中不了的原样留着 —— 所以 UCI 的值、用户输入、路由器标题都不会被误伤。
     反复调用是幂等的（英文文本匹配不到中文词典，直接跳过）。 */
  apply(root) {
    if (this.cur !== 'en' || !root) return;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      for (let i = 0; i < nodes.length; i++) {
        const raw = nodes[i].nodeValue;
        if (!raw) continue;
        const key = raw.trim();
        if (!key) continue;
        const out = this.T(key);
        if (out === key) continue;
        // 记下原文：切回中文时要把这些节点还原，否则底栏这种静态 HTML
        // 会一直停在英文（它们不会因为渲染而重建）
        this.orig.set(nodes[i], raw);
        const head = raw.slice(0, raw.indexOf(key));
        const tail = raw.slice(head.length + key.length);
        nodes[i].nodeValue = head + out + tail;
      }
      const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title]') : [];
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        const ph = el.getAttribute('placeholder');
        if (ph) { this.rememberAttr(el, 'placeholder', ph); el.setAttribute('placeholder', this.T(ph)); }
        const ti = el.getAttribute('title');
        if (ti) { this.rememberAttr(el, 'title', ti); el.setAttribute('title', this.T(ti)); }
      }
    } catch (e) {}
  },

  rememberAttr(el, name, val) {
    let m = this.attrOrig.get(el);
    if (!m) { m = {}; this.attrOrig.set(el, m); }
    if (m[name] === undefined) m[name] = val;
  },

  /* 把翻译过的节点全部还原成中文原文。切语言前必须先做这一步。 */
  restoreAll() {
    try {
      this.orig.forEach((raw, node) => {
        try { if (node.nodeValue !== raw) node.nodeValue = raw; } catch (e) {}
      });
      this.orig.clear();
      this.attrOrig.forEach((m, el) => {
        Object.keys(m).forEach(k => { try { el.setAttribute(k, m[k]); } catch (e) {} });
      });
      this.attrOrig.clear();
    } catch (e) {}
  },

  /* 每次 innerHTML 渲染完都自动翻一遍，所以不用在几十个 render 函数里手动调用。
     只监听 childList：apply 改的是文本节点（characterData），不会把自己再触发一次。 */
  watch() {
    if (this.observer || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(() => {
      if (this.cur !== 'en') return;
      if (this.timer) return;
      this.timer = requestAnimationFrame(() => {
        this.timer = null;
        this.apply(document.body);
      });
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }
};
