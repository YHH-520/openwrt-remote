'use strict';

/* ================= 本地存储 ================= */
const STORE_KEY = 'owr_settings_v1';

const Store = {
  data: null,
  defaults() {
    return {
      connections: [],            // [{id, name, url}]
      activeConnectionId: null,
      mode: 'tailscale',          // tailscale | lan | custom
      username: 'root',
      password: '',
      rememberPassword: true,
      theme: 'system',            // light | dark | system
      lang: 'router'              // zh | en | router（router = 跟随软路由）
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
      if (!Array.isArray(this.data.connections)) this.data.connections = [];
    } catch (e) {
      this.data = this.defaults();
    }
    return this.data;
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) {}
  },
  get active() {
    const list = this.data.connections;
    if (!list || !list.length) return null;
    return list.find(c => c.id === this.data.activeConnectionId) || list[0];
  },
  clear() {
    localStorage.removeItem(STORE_KEY);
    this.load();
  }
};

/* ================= 连接方式 ================= */
const MODES = {
  tailscale: {
    label: 'Tailscale',
    hint: 'OpenWrt 安装 Tailscale 后，使用其分配的 100.x 地址或 MagicDNS 域名',
    placeholder: 'http://100.64.0.1'
  },
  lan: {
    label: '局域网直连',
    hint: '同一 WiFi / 局域网内直接访问路由器地址',
    placeholder: 'http://192.168.1.1'
  },
  custom: {
    label: '其他内网穿透',
    hint: 'frp / ZeroTier / ngrok 等自定义地址，可带端口',
    placeholder: 'http://your-host:8080'
  }
};

/* ================= 工具函数 ================= */
const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBytes(n) {
  n = Number(n) || 0;
  // 速率是两次采样的差值算出来的，可能是 52.5525… 这种小数，B 级要取整
  if (n < 1024) return Math.round(n) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(1) + ' ' + units[i];
}

function fmtRate(n) { return fmtBytes(n) + '/s'; }

function fmtUptime(s) {
  s = Math.floor(Number(s) || 0);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + ' 天 ' + h + ' 小时';
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  return m + ' 分钟';
}

function fmtTime(unix) {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* ================= uci 值处理 ================= */
/* uci 里所有值到了 ubus 层面都是字符串（"1" / "0" / "12h"），
   而且 `disabled` 这种「缺省即启用」的字段必须按语义判断，不能只看真假。 */
function isOn(v) { return v === '1' || v === 1 || v === true || v === 'true' || v === 'on' || v === 'yes'; }
function isOff(v) { return v === '0' || v === 0 || v === false || v === 'false' || v === 'off' || v === 'no'; }
/* 「启用」语义：字段不存在 = 启用（OpenWrt 的 disabled / enabled 都是这样） */
function isEnabled(v) { return !isOn(v && typeof v === 'object' ? v.disabled : v); }
/* uci 的 list 字段（dns / server）在 JSON 里可能是数组也可能是一串空格分隔的字符串 */
function listToText(v) { return Array.isArray(v) ? v.join(' ') : (v == null ? '' : String(v)); }
/* 文本框 → uci list；空则返回 null，表示删除该选项 */
function textToList(s) {
  const parts = String(s || '').split(/[\s,;]+/).filter(Boolean);
  return parts.length ? parts : null;
}
/* 截断长字符串，用于列表右侧的 value */
function short(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const PROTO_LABELS = {
  static: '静态地址', dhcp: 'DHCP 客户端', dhcpv6: 'DHCPv6 客户端',
  pppoe: 'PPPoE 拨号', ppp: 'PPP', wwan: 'WWAN', qmi: 'QMI 蜂窝',
  mbim: 'MBIM 蜂窝', wireguard: 'WireGuard', none: '无协议'
};
const ENC_OPTIONS = [
  { value: 'none', label: '开放（不加密）' },
  { value: 'psk', label: 'WPA-PSK' },
  { value: 'psk2', label: 'WPA2-PSK' },
  { value: 'psk-mixed', label: 'WPA / WPA2 混合' },
  { value: 'sae', label: 'WPA3-SAE' },
  { value: 'sae-mixed', label: 'WPA2 / WPA3 混合' },
  { value: 'owe', label: 'OWE（增强开放）' }
];
// 列表里显示加密方式时用友好名（psk2 → WPA2-PSK），
// 遇到表里没有的（psk2+ccmp / sae-mixed 等）就原样显示
const ENC_LABELS = ENC_OPTIONS.reduce((m, o) => { m[o.value] = o.label; return m; }, {});
const ZONE_POLICY = ['ACCEPT', 'REJECT', 'DROP'];
const LEASETIME_OPTIONS = ['30m', '1h', '2h', '4h', '6h', '12h', '24h', '48h', '72h', '168h', 'infinite'];

function labelOf(map, key, fallback) {
  return map[key] || (key ? key : (fallback || '—'));
}
function toOptions(values, map) {
  return values.map(v => ({ value: v, label: map ? (map[v] || v) : v }));
}

/* ================= 路由器数据归一化 ================= */
/* network.interface.dump 在真机上返回 {"interface":[ ... ]}（**数组**，且不 contain statistics），
   部分旧固件返回对象。ubus 的对象名必须整体传（network.interface + dump），
   拆成 ('network','interface','dump') 会被判成未授权或 Parse error。
   流量则取自 luci-rpc.getNetworkDevices 的 stats，按设备名补齐。 */
async function fetchInterfaces() {
  const net = await Ubus.call('network.interface', 'dump', {});
  const raw = net && net.interface;
  const list = Array.isArray(raw) ? raw
    : (raw && typeof raw === 'object')
      ? Object.keys(raw).map(k => Object.assign({ interface: k }, raw[k]))
      : [];
  const devStats = {};
  try {
    const devs = await Ubus.call('luci-rpc', 'getNetworkDevices', {});
    Object.keys(devs || {}).forEach(dn => {
      const d = devs[dn];
      if (d && d.stats) devStats[dn] = d.stats;
    });
  } catch (e) {}
  return list.map(v => {
    const st = v.statistics || devStats[v.device] || devStats[v.l3_device] || {};
    return {
      name: v.interface || v.name || '—',
      up: !!v.up,
      proto: v.proto || '—',
      device: v.device || '',
      errCode: ((v.errors || [])[0] || {}).code || '',
      v4: (v['ipv4-address'] || []).map(a => a.address + '/' + a.mask),
      v6: (v['ipv6-address'] || []).map(a => a.address),
      rx: Number(st.rx_bytes) || 0,
      tx: Number(st.tx_bytes) || 0
    };
  }).sort((a, b) => (a.name === 'loopback' ? 1 : 0) - (b.name === 'loopback' ? 1 : 0));
}

/* 原生 Tailscale 状态（仅 APK 内可用，PWA 返回 null） */
function tailscaleNative() {
  try {
    if (window.TailscaleBridge) {
      const raw = window.TailscaleBridge.getState();
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

/* 原生能力桥（仅 APK 内可用）。路由器自带的页面（LuCI / iStore / 插件表单 / 网页终端）
   由它在 App 内部的一层覆盖 WebView 里打开。
   为什么必须是原生 WebView 而不是 iframe：LuCI 的 sysauth_http cookie 是 SameSite=strict，
   在 file:// 页面里属于第三方上下文，cookie 根本带不上去；
   而整页跳转又会把 App 自己的标题栏和底栏弄丢。 */
function nativeBridge() {
  try {
    if (window.OwrNative && window.OwrNative.available()) return window.OwrNative;
  } catch (e) {}
  return null;
}

/* 简化图标集 */
const ICONS = {
  net: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M7.5 16.5a6 6 0 0 1 0-9M16.5 7.5a6 6 0 0 1 0 9M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 8.5a15 15 0 0 1 19 0M5.5 12a10.5 10.5 0 0 1 13 0M8.8 15.5a6 6 0 0 1 6.4 0"/><circle cx="12" cy="18.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  hosts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16M4 10h16M4 15h10M4 20h16"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.28 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01c.28.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.28.4-1.56 1.03z"/></svg>',
  chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0V9zM12 18v3"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.6 3 14.4 0 18M12 3c-3 3.6-3 14.4 0 18"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="6" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="6" cy="17" r="1.3" fill="currentColor" stroke="none"/><path d="M11 7h9M11 12h9M11 17h9"/></svg>',
  chevron: '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
};

/* LuCI 顶层菜单用哪套图标。认不出的（第三方插件）统一给地球。 */
const LUCI_ICON = {
  status: 'net', system: 'gear', services: 'plug', store: 'plug',
  nas: 'hosts', vpn: 'shield', network: 'net', statistics: 'list'
};

/* 「统计」这种只有一两个子页的组，卡片副标题就直接把子页名列出来，
   比干巴巴一句「N 个页面」有用得多。 */
const LUCI_DESC = { store: '插件应用商店' };
function luciSummary(g) {
  const names = (g.children || []).map(c => c.title);
  if (!names.length) return LUCI_DESC[g.name] || '路由器原生页面';
  return short(names.join(' · '), 30);
}

/* LuCI 子页统一渲染成一格，点了就在内嵌覆盖层里打开 */
function luciCell(n) {
  return '<div class="cell cell-clickable" data-action="open-luci" ' +
    'data-path="' + esc(n.path) + '" data-title="' + esc(n.title) + '">' +
    '<div style="flex:1;min-width:0"><span class="cell-label">' + esc(n.title) + '</span></div>' +
    ICONS.chevron + '</div>';
}

function cellIcon(kind, bg) {
  return '<span class="cell-icon" style="background:' + (bg || 'var(--card-secondary)') + ';color:var(--accent)">' + (ICONS[kind] || '') + '</span>';
}

/* ================= Toast / Modal ================= */
function toast(msg, isError) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function confirmModal(title, text, okText, onOk, okClass) {
  $('#modal-root').innerHTML =
    '<div class="modal-mask">' +
      '<div class="modal">' +
        '<div class="modal-body">' +
          '<div class="modal-title">' + esc(title) + '</div>' +
          (text ? '<div class="modal-text">' + esc(text) + '</div>' : '') +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="modal-btn cancel" data-action="modal-cancel">取消</button>' +
          '<button class="modal-btn ' + (okClass || 'accent') + '" data-action="modal-ok">' + esc(okText || '确定') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  const onCancel = () => $('#modal-root').innerHTML = '';
  $('#modal-root').querySelector('[data-action="modal-cancel"]').onclick = onCancel;
  $('#modal-root').querySelector('[data-action="modal-ok"]').onclick = () => { onCancel(); onOk(); };
}

function formModal(title, fields, onSave, opts) {
  const o = opts || {};
  // 表单一律用底部卡片（sheet）呈现：字段多的时候贴着屏幕底部往上长，
  // 大拇指够得着，也更像 iOS 的表单；确认框那种一句话的还是居中弹窗。
  // 表单状态集中放在 state 里：切换「协议 / 加密方式」这类字段后需要重绘，
  // 重绘时如果直接读 DOM 会丢掉用户已经输入的内容，所以必须先落进 state。
  const state = {};
  fields.forEach(f => {
    state[f.key] = (f.value === undefined || f.value === null) ? '' : String(f.value);
  });

  const isOn = key => {
    const v = state[key];
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  };

  function fieldHtml(f) {
    if (f.visible && !f.visible(state)) return '';
    if (f.type === 'switch') {
      return '<div class="modal-row"><span class="modal-row-label">' + esc(f.label || f.key) + '</span>' +
        '<label class="switch"><input type="checkbox" data-f="' + esc(f.key) + '"' + (isOn(f.key) ? ' checked' : '') + '>' +
        '<span class="track"></span><span class="thumb"></span></label></div>' +
        (f.hint ? '<div class="modal-note">' + f.hint + '</div>' : '');
    }
    const label = f.label ? '<div class="modal-label">' + esc(f.label) + '</div>' : '';
    if (f.type === 'select') {
      return label + '<select class="modal-field" data-f="' + esc(f.key) + '">' +
        (f.options || []).map(op =>
          '<option value="' + esc(op.value) + '"' +
          (String(op.value) === String(state[f.key]) ? ' selected' : '') + '>' +
          esc(op.label) + '</option>'
        ).join('') + '</select>';
    }
    // 原实现把 type 拼成了裸属性（<input password>），密码框其实没生效
    const listId = f.datalist ? 'dl_' + f.key : '';
    return label +
      (f.datalist
        ? '<datalist id="' + listId + '">' + f.datalist.map(v => '<option value="' + esc(v) + '"></option>').join('') + '</datalist>'
        : '') +
      '<input class="modal-field" data-f="' + esc(f.key) + '"' +
      ' placeholder="' + esc(f.placeholder || '') + '"' +
      ' value="' + esc(state[f.key]) + '"' +
      (f.type ? ' type="' + esc(f.type) + '"' : '') +
      (listId ? ' list="' + listId + '"' : '') +
      (f.inputmode ? ' inputmode="' + esc(f.inputmode) + '"' : '') + '>' +
      (f.hint ? '<div class="modal-note">' + f.hint + '</div>' : '');
  }

  function paint() {
    // opts.danger = { text, onClick }：编辑表单里就地放一个红色删除按钮，
    // 比在列表行里再塞一个按钮更清爽（列表行已经整行可点了）
    const danger = o.danger
      ? '<button class="modal-btn destructive" data-action="modal-danger">' + esc(o.danger.text || '删除') + '</button>'
      : '';
    $('#modal-root').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal">' +
          '<div class="modal-body">' +
            '<div class="modal-title">' + esc(title) + '</div>' +
            (o.hint ? '<div class="modal-hint">' + o.hint + '</div>' : '') +
            fields.map(fieldHtml).join('') +
          '</div>' +
          '<div class="modal-actions">' +
            danger +
            '<button class="modal-btn cancel" data-action="modal-cancel">取消</button>' +
            '<button class="modal-btn accent" data-action="modal-save">' + esc(o.okText || '保存') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    const root = $('#modal-root');
    root.querySelector('[data-action="modal-cancel"]').onclick = () => { $('#modal-root').innerHTML = ''; };
    root.querySelector('[data-action="modal-save"]').onclick = () => {
      onSave(Object.assign({}, state));
    };
    const delBtn = root.querySelector('[data-action="modal-danger"]');
    if (delBtn && o.danger) {
      delBtn.onclick = () => { $('#modal-root').innerHTML = ''; o.danger.onClick(); };
    }
    // 文本输入只改 state，不重绘（否则每敲一个字就丢焦点）
    root.querySelectorAll('input[data-f]').forEach(el => {
      if (el.type === 'checkbox') return;
      el.addEventListener('input', () => { state[el.dataset.f] = el.value; });
    });
    // select / switch 会决定其它字段的显隐，必须重绘
    root.querySelectorAll('select[data-f], input[type="checkbox"][data-f]').forEach(el => {
      el.addEventListener('change', () => {
        state[el.dataset.f] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
        paint();
      });
    });
    const first = root.querySelector('input[data-f]:not([type="checkbox"]), select[data-f]');
    if (first && o.autofocus) { try { first.focus(); } catch (e) {} }
  }

  paint();
  const mask = $('#modal-root').firstElementChild;
  if (mask) mask.classList.add('sheet');
}

/* ================= 应用主体 ================= */
const App = {
  state: {
    phase: 'boot', tab: 'overview', detail: null, menus: [], loginMsg: '', busy: false,
    hostname: '',      // 顶部状态条左侧显示的设备名
    protoHandlers: null, // network.get_proto_handlers 缓存
    luci: null,        // 路由器真实 LuCI 菜单树（原生侧抓取，见 onLuciData）
    luciAt: 0,         // 上面这份菜单的抓取时间
    luciP: null,       // 抓取中的 Promise（renderMenu 可以等它，避免先画占位再重排）
    webPage: null,     // 当前正在内嵌覆盖层里显示的路由器页面 { id, url, title }
    seq: 0,            // 页面渲染代际，见 nextSeq()
    ttydP: null,       // ttyd 探测的 Promise（并发去重 + 结果复用）
    ov: null,          // 预取的概览数据 { info, board, ifaces, at }
    ovP: null,         // 概览这一轮请求的 Promise（预取与渲染共用）
    menuP: null        // 功能菜单这一轮探测的 Promise（同上）
  },
  snap: {},            // 接口速率快照
  rateTimer: null,
  statusTimer: null,
  menuCache: null,     // 功能菜单探测结果缓存 { key, at, found, native, groups }
  PTR_HOLD: 56,        // 下拉刷新：刷新中内容停在的位置（px）
  ptr: null,           // 下拉刷新手势状态
  refreshing: false,   // 正在刷新（防重入）
  drag: null,          // 底栏拖动状态，见 tabDragStart
  dragSwallow: 0,      // 拖动结束的时间戳：紧随其后的 click 要忽略，别再切一次
  splashDone: false,   // 启动动画是否已经安排退场（幂等标记）
  bootAt: 0,           // 页面开始初始化的时刻
  prefetched: false,   // 是否已经为这次登录做过预加载

  boot() {
    this.bootAt = Date.now();     // 启动动画的起算点，见 hideSplash
    Store.load();
    this.applyTheme();
    Lang.init();                  // 定下界面语言（跟随模式先用设备语言顶上，登录后再按路由器校正）
    this.bindEvents();
    this.route();
    // 兜底：登录请求挂住时也不能让启动画面一直挡着（正常路径由 route 收尾）
    setTimeout(() => this.hideSplash(), 3400);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener && mq.addEventListener('change', () => { if (Store.data.theme === 'system') this.applyTheme(); });
    // 旋转 / 分屏后底栏几何变了，滑块要重新定位；
    // 内嵌的路由器页面也要跟着重新对齐上下留白
    const remeasure = () => {
      this.moveGlider(this.state.tab);
      if (this.state.webPage) this.pushWebInsets();
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', () => setTimeout(remeasure, 260));

    // 滚动时同步小标题。passive + rAF 节流：一帧最多算一次，滚动不被拖慢。
    let raf = 0;
    window.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; this.syncNavTitle(); });
    }, { passive: true });

    // 安全网：覆盖层开着时内容区必须是空的（让位给原生 WebView）。
    // 但 renderMenu / renderDetail 这些都是异步的，用户点得快一点，
    // 上一页的结果回来时就会落笔，把底下透出不该出现的列表。
    // 与其在每个渲染函数里加判断，不如在这里统一看住。
    // 自己清空也会触发一次回调，但那时 firstElementChild 已是 null，不会再动，不会打转。
    try {
      const view = $('#view');
      if (view && typeof MutationObserver !== 'undefined') {
        this.viewGuard = new MutationObserver(() => {
          if (this.state.webPage && view.firstElementChild) view.innerHTML = '';
        });
        this.viewGuard.observe(view, { childList: true });
      }
    } catch (e) {}
  },

  /* 页面渲染的「代际」标记：异步渲染落笔前先确认这一代还是最新的 */
  nextSeq() { return ++this.state.seq; },
  stale(seq) { return seq !== this.state.seq; },

  applyTheme() {
    let mode = Store.data.theme;
    if (mode === 'system') mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = mode;
  },

  /* ---------- 顶部状态条 / 底栏滑块 ---------- */

  /* 顶部只放「一两个基础信息」，而且刻意让中间留空
     —— 三星 S20U 这类机型的前摄挖孔在屏幕正中，标题居中会被挡住。
     所以左边放设备名，右边放管理地址 + 往返延迟，中间不放东西。 */
  updateStatus() {
    const bar = $('#nav-status');
    if (!bar) return;
    const conn = Store.active;
    if (!conn || !Ubus.session || this.state.phase === 'login') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const host = String(conn.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const name = this.state.hostname || conn.name || 'OpenWrt';
    $('#ns-left').innerHTML = '<i class="ns-dot"></i>' + esc(short(name, 16));
    const rtt = Ubus.rtt ? ' · ' + Ubus.rtt + ' ms' : '';
    $('#ns-right').textContent = short(host, 18) + rtt;
    this.syncNavTitle();
  },

  /* 登录后取一次主机名，给顶部状态条用 */
  async fetchHostname() {
    try {
      const b = await Ubus.call('system', 'board', {});
      if (b && b.hostname) { this.state.hostname = b.hostname; this.updateStatus(); }
    } catch (e) {}
  },

  /* iOS 的招牌动作：页面上的「大标题」还在屏幕上时，导航栏不显示标题；
     大标题滚上去之后，导航栏里的小标题才淡进来 —— 这样标题栏永远是「正好一个」
     标题，不会上下各一个重着。
     没有大标题的页面（内嵌路由器页面、登录页）就一直显示。 */
  syncNavTitle() {
    const t = $('#nav-title');
    if (!t) return;
    const big = document.querySelector('#view .page-title');
    const nav = $('#nav');
    if (!big || (nav && nav.classList.contains('hidden'))) { t.classList.remove('dim'); return; }
    const bottom = nav ? nav.getBoundingClientRect().bottom : 0;
    t.classList.toggle('dim', big.getBoundingClientRect().bottom > bottom + 6);
  },

  startStatusLoop() {
    this.stopStatusLoop();
    this.statusTimer = setInterval(() => this.updateStatus(), 15000);
  },
  stopStatusLoop() {
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
  },

  /* iOS 26 液态玻璃底栏：滑块是绝对定位的一层玻璃，切 Tab 时平移过去 */
  moveGlider(tab) {
    const bar = $('#tabbar');
    if (!bar) return;
    const glider = bar.querySelector('.tab-glider');
    if (!glider) return;
    if (bar.classList.contains('hidden')) { glider.style.opacity = '0'; return; }
    const btn = bar.querySelector('.tab-item[data-tab="' + (tab || this.state.tab) + '"]');
    if (!btn) { glider.style.opacity = '0'; return; }
    const b = btn.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    if (!b.width) { glider.style.opacity = '0'; return; }
    glider.style.opacity = '1';
    glider.style.width = b.width + 'px';
    glider.style.height = b.height + 'px';
    glider.style.transform = 'translate(' + (b.left - r.left) + 'px,' + (b.top - r.top) + 'px)';
  },

  /* ---------- 路由 ---------- */

  /* 统一入口：应用当前激活连接并登录。
     设置页里任何会改变「激活连接或其地址」的操作（添加 / 编辑 / 切换 / 删除）
     都必须走这里 —— 否则 Ubus.session 会属于上一台路由器、
     或运行时的地址与刚保存的配置脱节。 */
  async connectActive(opts) {
    const o = opts || {};
    const conn = Store.active;
    // 没有连接就老老实实去设置页。
    // 这里**刻意不自动扫描** —— 扫描要往整个网段发请求，属于用户看得见的动作，
    // 只在设置页里点了「自动获取地址」才做（用户明确要求：不点不要自动获取）。
    if (!conn) { this.showSettings(true); return false; }

    // 已有有效会话且目标未变（session 是内存态，切换连接时会被清空）：
    // 直接进入主界面，避免每次从设置页切 Tab 都重新登录。
    if (Ubus.session && !o.force) { this.showMain(o.tab); return true; }

    Ubus.session = '';                       // 目标变了，旧会话一律作废
    // 换了路由器/账号，上一轮的预取结果和菜单缓存全部作废
    this.state.ov = null;
    this.state.ovP = null;
    this.state.menuP = null;
    this.state.luci = null;
    this.state.luciAt = 0;
    this.state.ttydP = null;
    this.menuCache = null;
    this.prefetched = false;
    if (Store.data.rememberPassword && Store.data.username && Store.data.password) {
      try {
        await Ubus.login(Store.data.username, Store.data.password);
        this.prefetchAll();                // 趁启动画面还在播，先把概览与功能页的数据取回来
        Lang.syncFromRouter();             // 「跟随软路由」：按路由器实际语言再校正一次
        this.showMain(o.tab);
        if (!o.silent) toast('已连接到 ' + conn.name);
        this.discoverTailscaleIp();
        return true;
      } catch (e) {
        this.showLogin('登录失败：' + (e.message || '未知错误'));
        return false;
      }
    }
    this.showLogin();
    return false;
  },

  async route() {
    try {
      await this.connectActive({ silent: true });
    } finally {
      this.hideSplash();          // 登录成功与否都要让启动画面退场
    }
  },

  /* ---------- 启动动画 ---------- */

  /* 至少露 1300ms 再退场。
     这个值由图标拼装动画决定：最后一颗指示灯在 0.80s + 0.30s = 1.10s 落位，
     再留一拍让用户看清拼好的图标和下面的名称，然后接 0.46s 淡出，一共约 1.75 秒。
     再短会把动画拦腰截断，再长就变成让用户干等了。
     由两处触发：route() 收尾，以及 boot() 里 3.4 秒的硬上限。重复调用无副作用。 */
  splashMin: 1300,
  hideSplash() {
    if (this.splashDone) return;
    this.splashDone = true;
    const wait = Math.max(0, this.splashMin - (Date.now() - (this.bootAt || 0)));
    setTimeout(() => this.playSplashOut(), wait);
  },

  playSplashOut() {
    const sp = $('#splash');
    const view = $('#view');
    // 主界面同时轻轻上浮进场（#view 上没有 fixed 子元素，加 transform 是安全的）
    if (view) view.classList.add('reveal');
    // 进场动画跑完就把 .reveal 摘掉：animation-fill-mode:both 会一直把 transform
    // 钉在 translateY(0)，而动画的填充优先级高于内联样式 —— 不摘掉的话
    // 下拉刷新写进 #view 的 transform 会被它整个吃掉，页面纹丝不动。
    setTimeout(() => { if (view) view.classList.remove('reveal'); }, 620);
    if (!sp) return;
    sp.classList.add('out');
    setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 760);
  },

  /* ---------- 底栏：可拖动的选中块 ---------- */

  /* 按下时先不切 Tab —— 这时还不知道用户是要点还是要拖。
     统一在松手时决定：位移不足 6px 算点击（交给 click），
     否则按手指位置吸附到最近的一项。 */
  tabDragStart(e) {
    const bar = $('#tabbar');
    if (!bar || bar.classList.contains('hidden')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const items = [].slice.call(bar.querySelectorAll('.tab-item')).map(el => {
      const r = el.getBoundingClientRect();
      return { tab: el.dataset.tab, cx: r.left + r.width / 2, w: r.width, top: r.top };
    });
    if (!items.length || !items[0].w || !items[0].top) return;   // 底栏还没布局出来（隐藏中）
    const r = bar.getBoundingClientRect();
    const activeEl = bar.querySelector('.tab-item.active');
    this.drag = {
      id: e.pointerId,
      barLeft: r.left, barWidth: r.width,
      pad: Math.max(0, items[0].cx - items[0].w / 2 - r.left),   // 滑块在胶囊里的左边距
      gW: items[0].w,
      gH: Math.max(1, bar.clientHeight - 10),     // 胶囊的内高（上下各 5px 内边距）
      top: items[0].top - r.top,
      startX: e.clientX, moved: false,
      from: activeEl ? activeEl.dataset.tab : this.state.tab,
      target: activeEl ? activeEl.dataset.tab : this.state.tab,
      items: items
    };
  },

  tabDragMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 6) return;   // 还没过阈值，先当点击
    d.moved = true;

    const bar = $('#tabbar');
    const glider = bar && bar.querySelector('.tab-glider');
    if (!glider) return;
    if (!glider.classList.contains('dragging')) glider.classList.add('dragging');
    glider.style.opacity = '1';
    glider.style.width = d.gW + 'px';
    glider.style.height = d.gH + 'px';

    // 以手指为滑块中心左右移，并夹在胶囊内；scale 让它比静止时略胖一点，
    // 松手回弹到 1 的时候就会有一个「按下—弹回」的手感
    const min = d.pad, max = Math.max(min, d.barWidth - d.pad - d.gW);
    const x = Math.min(max, Math.max(min, e.clientX - d.barLeft - d.gW / 2));
    glider.style.transform = 'translate(' + x + 'px,' + d.top + 'px) scale(1.05)';

    // 手指最靠近的那一项先亮起来当预览；真正的切页放在松手时
    //（切页要发请求、重渲染，一路拖过去会卡）
    let best = d.target, bestDist = Infinity;
    d.items.forEach(it => {
      const dist = Math.abs(e.clientX - it.cx);
      if (dist < bestDist) { bestDist = dist; best = it.tab; }
    });
    if (best !== d.target) { d.target = best; this.markTab(best); }
  },

  tabDragEnd(e) {
    const d = this.drag;
    if (!d) return;
    if (e && e.pointerId !== d.id) return;
    this.drag = null;

    const bar = $('#tabbar');
    const glider = bar && bar.querySelector('.tab-glider');
    if (glider) {
      glider.classList.remove('dragging');
      if (d.moved) glider.classList.add('settle');     // 松手那一下带点过冲
      setTimeout(() => { if (glider) glider.classList.remove('settle'); }, 480);
    }
    if (!d.moved) return;                              // 没动过 = 点击，交给 click 流程
    this.dragSwallow = Date.now();                     // 让紧随其后的 click 失效，别切两次

    // 停在原来那一项：只要把滑块弹回去，不用惊动页面
    if (d.target === d.from) {
      requestAnimationFrame(() => this.moveGlider(d.target));
      return;
    }
    this.tabActivate(d.target);                        // 各阶段（登录/设置/主界面）的规则都在里面
  },

  /* 只切高亮，不动页面。拖动途中当预览用，也可用来把高亮「退回去」 */
  markTab(tab) {
    document.querySelectorAll('.tab-item').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
  },

  /* ---------- 下拉刷新 ---------- */

  /* 只在「内容已经滚到顶部、页面不是内嵌覆盖层、没有弹窗」时接管手势。
     为什么用 touch 事件而不是 pointer：pointer 事件拦不住原生滚动，
     拖到一半页面会跟着滚，指示器就变成两张皮了。touchmove 上
     passive:false + preventDefault 才能真正把这一下拿过来。 */
  ptrStart(e) {
    if (this.state.webPage || this.state.phase === 'boot' || this.refreshing) { this.ptr = null; return; }
    if ($('#modal-root').firstElementChild) { this.ptr = null; return; }
    if (!e.touches || e.touches.length !== 1) { this.ptr = null; return; }
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    this.ptr = y <= 0 ? { y0: e.touches[0].clientY, pulled: 0, armed: true } : null;
  },

  ptrMove(e) {
    const p = this.ptr;
    if (!p || !p.armed) return;
    if (!e.touches || !e.touches.length) return;
    const dy = e.touches[0].clientY - p.y0;
    if (dy <= 0) { this.ptrReset(); return; }   // 往上推 = 普通滚动，别拦
    e.preventDefault();
    p.pulled = dy;
    const d = Math.min(dy * 0.45, 92);          // 阻尼，拉到底也不会太长
    const view = $('#view');
    view.style.transition = 'none';
    view.style.transform = 'translateY(' + d + 'px)';
    const el = $('#ptr');
    el.style.opacity = Math.min(1, d / 38);
    el.style.transform = 'translateY(' + d + 'px)';
    el.querySelector('svg').style.transform = 'rotate(' + (d * 3.4) + 'deg)';
  },

  ptrEnd() {
    const p = this.ptr;
    this.ptr = null;
    if (!p || !p.armed) return;
    // 阈值：位移（未打折的原始值）超过 62px 才算「要刷新」
    if (p.pulled >= 62) this.refreshCurrent();
    else this.ptrReset();
  },

  /* 弹回原位 */
  ptrReset() {
    const view = $('#view'), el = $('#ptr');
    if (view) { view.style.transition = 'transform 0.32s cubic-bezier(0.32,0.72,0.24,1)'; view.style.transform = 'translateY(0)'; }
    if (el) {
      el.style.transition = 'opacity 0.22s ease, transform 0.32s cubic-bezier(0.32,0.72,0.24,1)';
      el.style.transform = 'translateY(0)';
      el.style.opacity = '0';
      el.classList.remove('spin');
    }
    this.ptr = null;
  },

  /* 刷新当前这一屏。按当前所在的位置选动作，不去猜。 */
  async refreshCurrent() {
    if (this.refreshing) return;
    this.refreshing = true;
    const el = $('#ptr'), view = $('#view');
    el.classList.add('spin');
    el.style.transition = 'opacity 0.2s ease';
    el.style.transform = 'translateY(' + this.PTR_HOLD + 'px)';
    el.style.opacity = '1';
    view.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0.24,1)';
    view.style.transform = 'translateY(' + this.PTR_HOLD + 'px)';

    const seq = this.nextSeq();
    const tab = this.state.tab, detail = this.state.detail;
    try {
      if (detail) {
        this.state.detail = null;           // 让 renderDetail 走完整流程
        await this.renderDetail(detail);
        if (!this.stale(seq)) this.state.detail = detail;
      } else if (tab === 'overview') {
        await this.loadOverview(true);      // force：绕过 15 秒缓存，真去问一次
        await this.renderOverview();
      } else if (tab === 'menu') {
        this.state.luciAt = 0;              // 路由器菜单也重新拉一遍
        await this.renderMenu(true);
      } else {
        this.renderSettings();
      }
      toast('已刷新');
    } catch (e) {
      toast('刷新失败：' + (e.message || '未知错误'), true);
    }
    this.refreshing = false;
    this.ptrReset();
  },

  /* 点 / 拖选中某个 Tab 的统一入口。
     登录页和设置页各有自己的跳转规则，两边共用这一份，
     否则「点」和「拖」早晚会走出不一样的行为。 */
  tabActivate(t) {
    if (this.state.detail) {
      this.state.detail = null;
      $('#nav-back').classList.add('hidden');
    }
    if (this.state.phase === 'login') {
      if (t === 'settings') { this.showSettings(); return; }
      toast('请先登录后再使用');
    } else if (this.state.phase === 'settings') {
      if (t === 'settings') { this.showSettings(); return; }
      if (Store.active) { this.connectActive({ tab: t }); return; }
      toast('请先添加连接');
      this.showSettings();
      return;
    } else {
      this.setTab(t);
      return;
    }
    // 没切成功（未登录 / 未配置连接）：高亮退回它实际所在的那一项
    this.markTab('settings');
    requestAnimationFrame(() => this.moveGlider('settings'));
  },

  /* ---------- 自动获取路由器地址 ---------- */

  /* 候选地址按「命中概率」排：
     ① 手机自己的默认网关 —— 几乎一定就是路由器（原生侧问 ConnectivityManager 拿的）
     ② 本机 IP 所在网段的 1 / 254 / 2 —— 网关被改过时的兜底
     ③ 各家固件的常见默认段
     探测用 no-cors：只要能连上就说明那儿有个 web 服务在听，不需要对方给 CORS 头
     （file:// 页面 + allowUniversalAccessFromFileURLs 才能这么干）。
     真正的确认交给后续的 ubus 登录 —— 免得把同网段的打印机、NAS 当成路由器。 */
  lanCandidates() {
    const out = [];
    const push = ip => { if (ip && out.indexOf(ip) < 0) out.push(ip); };
    const ips = [];
    const nb = nativeBridge();
    if (nb && nb.getWifiInfo) {
      try {
        const wi = JSON.parse(nb.getWifiInfo() || '{}');
        push(wi.gateway);
        if (wi.ip) ips.push(wi.ip);
      } catch (e) {}
    }
    ips.forEach(ip => {
      const p = ip.split('.');
      if (p.length === 4) {
        const head = p[0] + '.' + p[1] + '.' + p[2] + '.';
        push(head + '1'); push(head + '254'); push(head + '2');
      }
    });
    ['192.168.1.1', '192.168.0.1', '192.168.2.1', '192.168.6.1', '192.168.8.1',
     '192.168.31.1', '192.168.123.1', '10.0.0.1', '172.16.0.1'].forEach(push);
    return out;
  },

  probeRouter(ip) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 1300);
    const opt = { mode: 'no-cors', cache: 'no-store' };
    if (ctl) opt.signal = ctl.signal;
    const done = ok => { clearTimeout(timer); return ok; };
    try {
      return fetch('http://' + ip + '/cgi-bin/luci/', opt).then(() => done(true)).catch(() => done(false));
    } catch (e) { return Promise.resolve(done(false)); }
  },

  /* 扫描并落地成一条连接。**只在设置页点了「自动获取地址」时调用**，
     启动路径不会碰它（见 connectActive 里的注释）。
     opts.silent    = 不弹提示、不重画设置页
     opts.noConnect = 只落地址，不在这里发起登录 */
  async lanScan(opts) {
    const o = opts || {};
    if (this.scanning) return null;
    this.scanning = true;
    if (!o.silent) { this.renderSettings(); }
    try {
      const list = this.lanCandidates();
      // 分小批并行：候选按概率排序，所以谁先答应用谁，不必等全扫完
      const found = await Promise.race([
        (async () => {
          for (let i = 0; i < list.length; i += 4) {
            const batch = list.slice(i, i + 4);
            const hit = await Promise.all(batch.map(ip => this.probeRouter(ip).then(ok => ok ? ip : null)));
            const first = hit.filter(Boolean)[0];
            if (first) return first;
          }
          return null;
        })(),
        new Promise(r => setTimeout(() => r(null), 9000))   // 整体上限
      ]);
      if (!found) {
        if (!o.silent) toast('没扫到路由器，请确认手机已连上路由器的 WiFi', true);
        return null;
      }
      return this.adoptRouter(found, o);
    } finally {
      this.scanning = false;
      if (!o.silent) this.renderSettings();
    }
  },

  /* 把扫到的地址变成（或更新成）一条连接并设为当前 */
  adoptRouter(ip, o) {
    const url = 'http://' + ip;
    const list = Store.data.connections || (Store.data.connections = []);
    let c = list.find(x => String(x.url || '').replace(/\/+$/, '') === url);
    if (!c) {
      c = { id: 'c' + Date.now(), name: '路由器 ' + ip, url: url };
      list.push(c);
    }
    Store.data.activeConnectionId = c.id;
    Store.save();
    if (!(o && o.silent)) toast('已找到路由器 ' + ip);
    if (!(o && o.noConnect)) this.connectActive({ force: true });
    return ip;
  },

  /* ---------- 配置写入 ---------- */

  /* 统一的写入执行器。
     ops = {
       config : 'wireless',                          // 目标 /etc/config/<name>
       sets   : { radio1: { txpower: '20' } },        // 值为 null 表示删除该选项
       adds   : [{ type: 'wifi-iface', values:{} }],  // 新建 section
       dels   : [{ section: 'cfg0xxxx' }],            // 删除 section（带 option 则只删选项）
       apply  : [{ name:'network', action:'reload' }] // 缺省取 Uci.APPLY[config]
       ok     : '已保存并应用',
       after  : () => this.renderWireless()
     }
     顺序固定：set → add → del → 落盘 → 重载服务。
     先做完所有 uci 操作再落盘，避免中途失败留下半套配置。 */
  async runOps(ops) {
    if (!Ubus.can('uci', 'set')) { toast('当前账号没有配置写入权限', true); return false; }
    try {
      const sets = ops.sets || {};
      for (const section of Object.keys(sets)) {
        await Uci.set(ops.config, section, sets[section]);
      }
      for (const a of (ops.adds || [])) await Uci.add(ops.config, a.type, a.values);
      for (const d of (ops.dels || [])) await Uci.del(ops.config, d.section, d.option);
      await Uci.commit();                     // 这台路由器只有 uci.apply 能落盘
    } catch (e) {
      toast('保存失败：' + (e.message || '未知错误'), true);
      return false;
    }
    const svcs = ops.apply || Uci.APPLY[ops.config] || [];
    // 配置变了，功能菜单里那批「这台路由器支不支持」的探测结果可能已经不准，作废重探
    this.menuCache = null;
    this.state.ttydP = null;
    let applied = 0;
    for (const s of svcs) {
      try { await Uci.apply(s.name, s.action); applied++; } catch (e) {}
    }
    toast(applied ? (ops.ok || '已保存并应用')
                  : '已保存；自动应用失败，请到路由器手动重启对应服务', !applied);
    if (ops.after) setTimeout(() => { try { ops.after(); } catch (e) {} }, 500);
    return true;
  },

  /* 二次确认后再写入（改 Wi-Fi / 网络这类会影响连接的操作必须先确认） */
  confirmOps(title, text, okText, ops) {
    confirmModal(title, text, okText, () => this.runOps(ops), 'accent');
  },

  /* 编辑一个已有的 uci section。
     fieldsFn(values) 返回字段数组；buildFn(vals, values) 返回要写入的键值对，
     缺省为整体覆盖 vals —— 需要做布尔/反向映射时用 buildFn。 */
  editSection(opts) {
    const vals = opts.values || {};
    formModal(
      opts.title,
      opts.fields(vals),
      input => {
        const changes = opts.build ? opts.build(input, vals) : input;
        if (changes === null) return;
        this.confirmOps(opts.confirmTitle || ('保存 ' + opts.title),
          opts.confirmText || ('改动会写入路由器 /etc/config/' + opts.config + ' 并立即生效。'),
          opts.okText || '保存',
          {
            config: opts.config,
            sets: { [opts.section]: changes },
            apply: opts.apply, ok: opts.ok, after: opts.after
          });
      },
      { hint: opts.hint, okText: opts.okText || '保存' });
  },

  /* 一行开关：把 <config>.<section>.<option> 写成 on/off */
  toggleOption(o) {
    this.confirmOps(o.title, o.text, '确定', {
      config: o.config,
      sets: { [o.section]: { [o.option]: o.on } },
      apply: o.apply, after: o.after
    });
  },

  /* 删除一个 section（或某个选项） */
  deleteSection(o) {
    this.confirmOps(o.title, o.text, '删除', {
      config: o.config,
      dels: [{ section: o.section, option: o.option }],
      apply: o.apply, after: o.after
    });
  },

  showLogin(msg) {
    this.nextSeq();
    this.state.phase = 'login';
    this.state.detail = null;
    this.closeWebPage();
    $('#nav').classList.add('hidden');
    $('#tabbar').classList.remove('hidden');
    document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'settings'));
    this.stopStatusLoop();
    this.updateStatus();
    requestAnimationFrame(() => this.moveGlider('settings'));
    this.renderLogin(msg);
  },

  showMain(tab) {
    this.state.phase = 'main';
    this.state.detail = null;
    $('#nav').classList.remove('hidden');
    $('#tabbar').classList.remove('hidden');
    this.updateStatus();
    this.startStatusLoop();
    this.setTab(tab || 'overview');
    this.fetchHostname();
    this.requestLuciData();   // 提前把路由器菜单抓回来，等用户点「功能」时就是现成的
  },

  /* 登录后自动识别路由器的 Tailscale 地址（100.64.0.0/10）并询问是否保存 */
  async discoverTailscaleIp() {
    try {
      const ifaces = await fetchInterfaces();
      const found = [];
      ifaces.forEach(v => {
        v.v4.forEach(cidr => {
          const addr = cidr.split('/')[0];
          const p = addr.split('.').map(Number);
          if (p.length === 4 && p[0] === 100 && (p[1] & 0xC0) === 0x40) {
            found.push({ iface: v.name, ip: addr });
          }
        });
      });
      if (!found.length) return;
      const best = found[0];
      const cur = Store.active;
      if (cur && cur.url.replace(/\/+$/, '') === 'http://' + best.ip) return;
      confirmModal('发现 Tailscale 地址',
        '路由器接口 ' + best.iface + ' 的 Tailscale 地址是 <b>' + best.ip + '</b>，是否添加为远程连接？之后在任何网络都能远程管理。',
        '添加', () => {
          const conn = { id: 'c' + Date.now(), name: (cur ? cur.name : '远程 OpenWrt') + ' (Tailscale)', url: 'http://' + best.ip };
          Store.data.connections.push(conn);
          Store.data.activeConnectionId = conn.id;
          Store.save();
          toast('已添加 Tailscale 连接 ' + best.ip);
        });
    } catch (e) {}
  },

  setTab(tab) {
    this.nextSeq();               // 作废还在路上的渲染，别让它回来顶掉新页面
    this.state.tab = tab;
    this.state.detail = null;
    this.closeWebPage();          // 切 Tab 一定收起内嵌的路由器页面
    this.stopRate();
    document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#nav-back').classList.add('hidden');
    requestAnimationFrame(() => this.moveGlider(tab));
    this.updateStatus();
    if (tab === 'overview') {
      $('#nav-title').textContent = 'OpenWrt';
      $('#nav-action').classList.remove('placeholder');
      this.renderOverview();
    } else if (tab === 'menu') {
      $('#nav-title').textContent = '功能';
      $('#nav-action').classList.add('placeholder');
      this.renderMenu();
    } else {
      $('#nav-title').textContent = '设置';
      $('#nav-action').classList.add('placeholder');
      this.renderSettings();
    }
  },

  openDetail(id) {
    this.nextSeq();
    this.state.detail = id;
    this.closeWebPage();          // 从路由器页面点进别的详情时，覆盖层要让位
    this.stopRate();
    const item = this.state.menus.find(m => m.id === id);
    $('#nav-title').textContent = item ? item.title : '详情';
    $('#nav-back').classList.remove('hidden');
    $('#nav-action').classList.remove('placeholder');
    this.updateStatus();
    this.renderDetail(id);
  },

  closeDetail() {
    this.state.detail = null;
    $('#nav-back').classList.add('hidden');
    this.setTab(this.state.tab);
  },

  stopRate() {
    if (this.rateTimer) { clearInterval(this.rateTimer); this.rateTimer = null; }
  },

  /* ================= 登录页 ================= */
  renderLogin(msg) {
    const conn = Store.active || {};
    $('#view').innerHTML =
      '<div class="login-wrap">' +
        '<img class="login-logo" src="icon.svg" alt="logo">' +
        '<div class="login-title">OpenWrt Remote</div>' +
        '<div class="login-sub">' + esc(conn.name || '未配置连接') + '<br>' + esc(conn.url || '') + '</div>' +
        '<div class="login-conn group-card">' +
          '<div class="cell"><span class="cell-label">用户名</span><input class="cell-input" id="lg-user" placeholder="root" value="' + esc(Store.data.username) + '"></div>' +
          '<div class="cell"><span class="cell-label">密码</span><input class="cell-input" id="lg-pass" type="password" placeholder="密码" value="' + esc(Store.data.password) + '"></div>' +
        '</div>' +
        '<button class="btn btn-primary" id="lg-btn" style="margin-top:16px">登录</button>' +
        '<div class="login-error" id="lg-err">' + esc(msg || '') + '</div>' +
        '<button class="login-link" data-action="goto-settings">管理地址与连接设置</button>' +
      '</div>';
    const err = $('#lg-err');
    if (msg) err.classList.add('show');
    $('#lg-btn').onclick = () => this.doLogin();
    const submit = e => { if (e.key === 'Enter') this.doLogin(); };
    $('#lg-user').onkeydown = submit;
    $('#lg-pass').onkeydown = submit;
  },

  async doLogin() {
    const u = $('#lg-user').value.trim();
    const p = $('#lg-pass').value;
    if (!u) { toast('请输入用户名', true); return; }
    const btn = $('#lg-btn');
    btn.disabled = true; btn.textContent = '登录中…';
    Store.data.username = u;
    if (Store.data.rememberPassword) Store.data.password = p;
    Store.save();
    try {
      Ubus.session = '';              // 地址由 Ubus.baseUrl 实时从 Store.active 解析
      await Ubus.login(u, p);
      // 换了账号，之前缓存的菜单探测结果和内嵌页面（里面还存着旧密码）都不再可信
      this.menuCache = null;
      this.state.luci = null;
      this.state.luciAt = 0;
      this.state.ttydP = null;
      this.state.ov = null;           // 概览缓存同理：上一台路由器的数据不能带过来
      this.state.menuP = null;
      this.prefetched = false;
      this.prefetchAll();             // 手动登录也顺手把概览/功能页预取掉
      Lang.syncFromRouter();          // 「跟随软路由」：按路由器实际语言再校正一次
      const nb = nativeBridge();
      if (nb && nb.clearWebCacheJs) { try { nb.clearWebCacheJs(); } catch (e) {} }
      this.showMain();
      toast('已连接 ' + Store.active.name);
      this.discoverTailscaleIp();
    } catch (e) {
      const err = $('#lg-err');
      err.textContent = e.message || '登录失败';
      err.classList.add('show');
      btn.disabled = false; btn.textContent = '登录';
    }
  },

  /* ================= 概览 ================= */

  /* 概览要的三份数据单独抽出来，因为启动动画期间要先把它跑掉（见 prefetchAll）。
     - state.ov 带时间戳：刚取过就直接复用，首屏不用等
     - state.ovP 是「在跑的那一轮」：预取和 renderOverview 同时调用时
       跟着同一个 Promise 走，不会把同一批请求打两遍 */
  async loadOverview(force) {
    const c = this.state.ov;
    if (!force && c && Date.now() - c.at < 15000) return c;
    if (this.state.ovP) return this.state.ovP;

    const p = (async () => {
      const info = await Ubus.call('system', 'info', {});
      let board = null;
      try { board = await Ubus.call('system', 'board', {}); } catch (e) {}
      const ifaces = await fetchInterfaces();
      this.state.ov = { info: info, board: board, ifaces: ifaces, at: Date.now() };
      // 顺手把主机名喂给顶部状态条，省得再单独问一次 system.board
      if (board && board.hostname && board.hostname !== this.state.hostname) {
        this.state.hostname = board.hostname;
        this.updateStatus();
      }
      return this.state.ov;
    })();
    this.state.ovP = p;
    try { return await p; } finally { if (this.state.ovP === p) this.state.ovP = null; }
  },

  async renderOverview() {
    const seq = this.nextSeq();
    if (!this.state.ov) {                  // 有预取结果就跳过骨架屏，直接上内容
      $('#view').innerHTML =
        '<div class="page pt"><div class="page-title">概览</div>' +
        '<div class="skeleton" style="height:120px;border-radius:16px"></div>' +
        '<div class="skeleton" style="height:120px;border-radius:12px;margin-top:16px"></div></div>';
    }
    try {
      const ov = await this.loadOverview();
      if (this.stale(seq)) return;         // 等待期间已经切走了
      this.renderOverviewData(ov.info, ov.board, ov.ifaces);
    } catch (e) {
      if (this.stale(seq)) return;
      this.state.ov = null;
      $('#view').innerHTML = '<div class="page pt"><div class="page-title">概览</div><div class="empty">' + esc(e.message || '加载失败') + '</div>' +
        '<button class="btn btn-primary" data-action="retry-overview" style="margin-top:12px">重试</button></div>';
    }
  },

  renderOverviewData(info, board, ifaces) {
    const upIf = ifaces.find(v => v.up) || ifaces[0] || null;
    const ipText = (upIf && upIf.v4[0]) || '—';

    const mem = info.memory || {};
    const total = mem.total || 0;
    const used = total - (mem.free || 0) - (mem.cached || 0) - (mem.buffered || 0);
    const pct = total ? Math.round(used / total * 100) : 0;
    const load = info.load || [0, 0, 0];

    // 接口行拆成两行：上行「名称 + IP」，下行流量 —— 否则长 IP（如 10.29.21.139/18）
    // 会被速率文本挤成省略号
    const ifaceCells = ifaces.slice(0, 4).map(v =>
      '<div class="cell">' +
        '<span class="dot ' + (v.up ? 'up' : '') + '"></span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:baseline;gap:10px">' +
            '<span class="cell-label" style="flex:0 0 auto;max-width:none">' + esc(v.name) + '</span>' +
            '<span class="cell-value" style="flex:1;min-width:0;max-width:none;text-align:right">' + esc(v.v4[0] || (v.up ? '已连接' : '未连接')) + '</span>' +
          '</div>' +
          '<div class="rate" data-rate="' + esc(v.name) + '" style="text-align:right">↓ ' + fmtRate(v.rx) + ' ↑ ' + fmtRate(v.tx) + '</div>' +
        '</div>' +
      '</div>'
    ).join('');

    const heroModel = (board && board.model) ? board.model : (board && board.board_name ? board.board_name : 'OpenWrt 路由器');
    const heroVer = (board && board.release && board.release.version) ? 'OpenWrt ' + board.release.version : '';
    $('#view').innerHTML =
      '<div class="page pt"><div class="page-title">概览</div>' +
      '<div class="hero">' +
        '<div class="hero-model">' + esc(heroModel) + '</div>' +
        '<div class="hero-sub">' + esc(heroVer) + ' · 运行 ' + fmtUptime(info.uptime) + '</div>' +
        '<div class="hero-ip">' + esc(upIf ? (upIf.name + ': ' + ipText) : '—') + '</div>' +
      '</div>' +
      '<div class="group"><div class="group-title">状态</div><div class="group-card">' +
        '<div class="stat-row" style="padding:10px 16px"><span class="stat-label">负载（1/5/15 分钟）</span><span class="stat-value">' + esc(load.map(x => (Number(x) || 0).toFixed(2)).join(' / ')) + '</span></div>' +
        '<div class="cell"><span class="cell-label">内存</span><span class="cell-value">' + fmtBytes(used) + ' / ' + fmtBytes(total) + '（' + pct + '%）</span></div>' +
        '<div style="padding:4px 16px 14px"><div class="progress"><i class="' + (pct > 90 ? 'high' : pct > 70 ? 'mid' : 'low') + '" style="width:' + Math.min(pct, 100) + '%"></i></div></div>' +
        '<div class="stat-row" style="padding:0 16px 10px"><span class="stat-label">本地时间</span><span class="stat-value">' + esc(fmtTime(info.localtime)) + '</span></div>' +
      '</div></div>' +
      '<div class="group"><div class="group-title">接口</div><div class="group-card">' + ifaceCells + '</div>' +
        '<button class="btn btn-secondary" data-action="open-menu-net" style="margin-top:10px">全部接口与更多功能</button>' +
      '</div>' +
      '</div>';
    this.startRateLoop();
    this.updateStatus();   // 延迟取的是刚这批请求的往返时间
  },

  startRateLoop() {
    this.stopRate();
    const tick = async () => {
      try { this.updateRates(await fetchInterfaces()); } catch (e) {}
    };
    tick();
    this.rateTimer = setInterval(tick, 2000);
  },

  updateRates(ifaces) {
    const now = Date.now();
    (ifaces || []).forEach(v => {
      const el = document.querySelector('[data-rate="' + v.name + '"]');
      const prev = this.snap[v.name];
      if (el && prev && now > prev.t) {
        const rx = (v.rx - prev.rx) * 1000 / (now - prev.t);
        const tx = (v.tx - prev.tx) * 1000 / (now - prev.t);
        // 计数器回绕或接口重连时会出负值，钳到 0
        el.textContent = '↓ ' + fmtRate(Math.max(0, rx)) + ' ↑ ' + fmtRate(Math.max(0, tx));
      }
      this.snap[v.name] = { t: now, rx: v.rx, tx: v.tx };
    });
  },

  /* ================= 功能菜单（自适应） =================
     每个页面带一个「探测函数」：探测抛错就自动从菜单里消失。
     这样同一份 APK 换到权限更少 / 没装对应插件的路由器上，
     不会出现点进去就报错的死页面，也不会假装有功能。

     探测**只查 ACL，不真的调接口**。登录时路由器会把「这个账号能调哪些对象和方法」
     的白名单一起下发（session.login -> acls.ubus），查它是 O(1)。
     早先是拿真实接口调用当探测，结果 rc.list 这台机器上要 2~24 秒
     （rpcd 得挨个问 49 个 init 脚本），整个功能页被它一个人拖住 ——
     换了 ACL 之后整页渲染只要几十毫秒。 */
  pages() {
    const need = (object, method) => () => {
      if (!Ubus.can(object, method)) throw new Error('当前账号没有 ' + object + '.' + method + ' 权限');
    };
    return [
      /* ---- 网络 ---- */
      { id: 'network',   title: '网络接口',   icon: 'net',    group: '网络',
        probe: need('network.interface', 'dump') },
      { id: 'wireless',  title: '无线网络',   icon: 'wifi',   group: '网络',
        probe: need('luci-rpc', 'getWirelessDevices') },
      { id: 'clients',   title: '无线客户端', icon: 'wifi',   group: '网络',
        probe: need('iwinfo', 'assoclist') },
      { id: 'hosts',     title: '主机 / DHCP', icon: 'hosts',  group: '网络',
        probe: need('luci-rpc', 'getDHCPLeases') },
      { id: 'firewall',  title: '防火墙',     icon: 'shield', group: '网络',
        probe: need('uci', 'get') },
      { id: 'conntrack', title: '连接跟踪',   icon: 'list',   group: '网络',
        probe: need('luci', 'getConntrackList') },

      /* ---- 系统 ---- */
      { id: 'services',  title: '服务管理',   icon: 'gear',   group: '系统',
        probe: need('rc', 'list') },
      { id: 'processes', title: '进程',       icon: 'chip',   group: '系统',
        probe: need('luci', 'getProcessList') },
      { id: 'storage',   title: '存储 / USB', icon: 'plug',   group: '系统',
        probe: need('luci', 'getBlockDevices') },
      { id: 'leds',      title: '指示灯',     icon: 'gear',   group: '系统',
        probe: need('luci', 'getLEDs') },
      { id: 'system',    title: '系统',       icon: 'gear',   group: '系统',
        probe: need('system', 'info') },
      { id: 'logs',      title: '系统日志',   icon: 'log',    group: '系统',
        probe: need('log', 'read') },

      /* ---- 插件（装了才显示） ---- */
      { id: 'ddns',      title: '动态 DNS',   icon: 'globe',  group: '插件',
        probe: need('luci.ddns', 'get_services_status') },
      { id: 'upnp',      title: 'UPnP 映射',  icon: 'globe',  group: '插件',
        probe: need('luci.upnp', 'get_status') },
      { id: 'wireguard', title: 'WireGuard',  icon: 'shield', group: '插件',
        probe: need('luci.wireguard', 'getWgInstances') }
    ];
  },

  /* 探测 + 渲染「功能」页。两个性能上的取舍：
     1) 13 个探测以前是**串行** await 的，每次都是一轮 HTTP 往返，最慢的那个
        （ttyd 探测带 2.5s 超时）会把整页拖住；现在 Promise.all 一起发。
     2) 结果按「连接地址 + 账号」缓存 5 分钟，来回切 Tab 直接复用 HTML，
        不再每次重新探测。写入配置、重新登录时都会主动作废。 */
  /* 功能页要的两块内容（ubus 自适应菜单 + 路由器原生页面）只在这里收集，不碰 DOM。
     单独拆出来是为了能在启动动画期间先跑掉（见 prefetchAll）：
     预取时启动画面还盖在上面，动 DOM 纯属白费。
     state.menuP 是「在跑的那一轮」，预取与 renderMenu 并发时共用同一次探测。 */
  async collectMenu(force) {
    const key = (Store.active ? Store.active.url : '') + '|' + Store.data.username;
    const c = this.menuCache;
    if (!force && c && c.key === key && Date.now() - c.at < 5 * 60 * 1000) return c;
    if (!force && this.state.menuP) return this.state.menuP;

    const p = (async () => {
      // ttyd 探测带超时，先把它发出去跟下面的 ACL 探测并行，别串在后面拖整页
      this.ttydUrl();

      const all = this.pages();
      const results = await Promise.all(all.map(x =>
        Promise.resolve()
          .then(() => x.probe())
          .then(r => (x.nonEmpty && !x.nonEmpty(r)) ? null : x)
          .catch(() => null)      // 探测失败 = 这台路由器没这个能力，直接不显示
      ));
      const found = results.filter(Boolean);
      this.state.menus = found;

      const nativeGroup = nativeBridge() ? await this.nativePagesGroup() : '';
      const out = { key: key, at: Date.now(), found: found, native: nativeGroup };
      // 路由器菜单还没抓回来时先别缓存，等 onLuciData 到了会带着完整菜单重建
      if (this.state.luci !== null || !nativeBridge()) this.menuCache = out;
      return out;
    })();
    this.state.menuP = p;
    try { return await p; } finally { if (this.state.menuP === p) this.state.menuP = null; }
  },

  async renderMenu(force) {
    const seq = this.nextSeq();
    // 已经有内容时（比如 LuCI 菜单刚回来触发的重建、或预取已经跑完）不要再闪一次骨架屏
    if (!this.state.menus.length && !(this.menuCache && this.menuCache.found)) {
      $('#view').innerHTML =
        '<div class="page pt"><div class="page-title">功能</div><div class="page-sub">正在探测路由器可用功能…</div>' +
        '<div class="skeleton" style="height:56px;border-radius:12px"></div>' +
        '<div class="skeleton" style="height:56px;border-radius:12px;margin-top:10px"></div>' +
        '<div class="skeleton" style="height:56px;border-radius:12px;margin-top:10px"></div></div>';
    }

    const c = await this.collectMenu(force);
    if (this.stale(seq)) return;            // 等待期间用户已经跳到别处了
    this.state.menus = c.found;
    this.renderMenuHtml(c.found, c.native);
  },

  /* ================= 启动期间的预加载 =================
     概览和功能是用户进来最可能先看的两页，趁启动动画还在播的时候把数据取掉。
     三条链互不依赖，并行跑；只取数据、不写 DOM。
     动画一退场就是现成内容，不会「先骨架屏再跳一下」。 */
  prefetchAll() {
    this.prefetched = true;
    this.prefetchTasks = [
      this.loadOverview(true).catch(() => {}),
      this.collectMenu(true).catch(() => {})
    ];
    this.requestLuciData();     // 路由器 LuCI 菜单（功能页里「服务 / NAS / VPN / 统计」那批）
  },

  renderMenuHtml(found, nativeGroup) {
    if (!found.length && !nativeGroup) {
      $('#view').innerHTML = '<div class="page pt"><div class="page-title">功能</div>' +
        '<div class="empty">无法探测到可用功能，请检查登录状态或路由器 ubus 权限</div></div>';
      return;
    }

    const order = [];
    const groups = {};
    found.forEach(p => {
      if (!groups[p.group]) { groups[p.group] = []; order.push(p.group); }
      groups[p.group].push(p);
    });
    const blocks = order.map(g =>
      '<div class="group"><div class="group-title">' + esc(g) + '</div><div class="group-card">' +
        groups[g].map(m =>
          '<div class="cell cell-clickable" data-action="open-detail" data-id="' + m.id + '">' +
            cellIcon(m.icon) + '<span class="cell-label">' + esc(m.title) + '</span>' + ICONS.chevron +
          '</div>').join('') +
      '</div></div>'
    ).join('');

    $('#view').innerHTML =
      '<div class="page pt"><div class="page-title">功能</div>' +
      '<div class="page-sub">菜单已根据路由器实际功能自适应（共 ' + found.length + ' 项）</div>' +
      blocks + nativeGroup + '</div>';
    this.updateStatus();
  },

  /* 路由器自带网页的入口。

     菜单结构**不硬编码**：原生侧登录 LuCI 后拉 /cgi-bin/luci/admin/menu
     （LuCI 自己的菜单接口），再用 cbi.js 里那套 sfh 哈希查翻译表换成中文，
     最后回调 onLuciData 喂回这里。于是「服务 / NAS / VPN / 统计」这些页面
     装没装、叫什么名字、路径是什么，全都由路由器说了算 ——
     换一台固件不同、插件不同的设备，菜单自动跟着变。 */
  async nativePagesGroup() {
    if (!nativeBridge()) return '';

    // 菜单还没抓回来：先把请求发出去，并**等它一下**（最多 3 秒）。
    // 等到了就能一次画完，不用先画个占位再整页重排。
    if (this.state.luci === null) {
      this.requestLuciData();
      const pending = this.state.luciP;
      if (pending) {
        await Promise.race([pending, new Promise(r => setTimeout(r, 3000))]);
      }
    }
    if (this.state.luci === null) {     // 还是没回来（网络慢或没跑 LuCI），给个占位
      return '<div class="group"><div class="group-title">路由器页面</div><div class="group-card">' +
        '<div class="cell"><div style="flex:1;min-width:0">' +
        '<span class="cell-label">正在读取路由器菜单…</span>' +
        '<div class="cell-desc">直接向路由器要 LuCI 菜单，首次约 1~2 秒</div></div></div>' +
        '</div></div>';
    }

    const luci = this.state.luci || [];
    let group = '';
    if (luci.length) {
      group = '<div class="group"><div class="group-title">路由器页面</div><div class="group-card">' +
        luci.map(g => {
          const hasKids = !!(g.children && g.children.length);
          return '<div class="cell cell-clickable" ' +
            (hasKids
              ? 'data-action="open-luci-group" data-name="' + esc(g.name) + '"'
              : 'data-action="open-luci" data-path="' + esc(g.path) + '"') +
            ' data-title="' + esc(g.title) + '">' +
            cellIcon(LUCI_ICON[g.name] || 'globe') +
            '<div style="flex:1;min-width:0">' +
              '<span class="cell-label">' + esc(g.title) + '</span>' +
              '<div class="cell-desc">' + esc(luciSummary(g)) + '</div>' +
            '</div>' + ICONS.chevron +
          '</div>';
        }).join('') +
        '</div>' +
        '<div class="cell-desc" style="padding:8px 4px 0">菜单和中文名称都直接取自路由器，' +
          '换一台设备会自动跟着变。</div></div>';
    }

    return group + (await this.webExtraGroup());
  },

  /* iStore / 完整 LuCI / 网页终端这几个「路由器原生页面」的兜底入口。
     即使菜单没抓到，这几项也一定在。 */
  async webExtraGroup() {
    const rows = [
      { path: '/cgi-bin/luci/', title: '完整 LuCI 控制台', desc: '路由器原生界面，所有设置的总入口', icon: 'globe' },
      { path: '/cgi-bin/luci/admin/store', title: 'iStore 应用商店', desc: '安装 / 卸载 / 更新插件', icon: 'plug' }
    ];
    // ttyd 网页终端跑在独立端口上，先探一下再决定要不要显示
    const ttyd = await this.ttydUrl();
    if (ttyd) rows.push({ url: ttyd, title: '网页终端', desc: '直接开一个 shell，进来会自动登录', icon: 'chip' });

    return '<div class="group"><div class="group-title">路由器原生页面</div><div class="group-card">' +
      rows.map(r =>
        '<div class="cell cell-clickable" data-action="open-luci" ' +
          (r.url ? 'data-url="' + esc(r.url) + '"' : 'data-path="' + esc(r.path) + '"') +
          ' data-id="' + esc(r.url || r.path) + '" data-title="' + esc(r.title) + '">' +
          cellIcon(r.icon) +
          '<div style="flex:1;min-width:0">' +
            '<span class="cell-label">' + esc(r.title) + '</span>' +
            '<div class="cell-desc">' + esc(r.desc) + '</div>' +
          '</div>' + ICONS.chevron +
        '</div>').join('') +
      '</div>' +
      '<div class="cell-desc" style="padding:8px 4px 0">这些页面由路由器提供，包在 App 内嵌窗口里打开；' +
        '顶部保留返回与刷新，底部 Tab 栏照常可用。</div>' +
      '</div>';
  },

  /* 探测 ttyd（网页终端）是否在跑。返回完整 URL 或空串。
     探测带超时，所以把 Promise 缓存起来：并发调用只发一次请求，
     探测过之后也不再重复打。 */
  ttydUrl() {
    if (!this.state.ttydP) this.state.ttydP = this.probeTtyd();
    return this.state.ttydP;
  },

  async probeTtyd() {
    const cfg = this.originOf();
    if (!cfg) return '';
    const url = 'http://' + cfg.host + ':7681/';
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 1600);
      const r = await fetch(url, ctl ? { signal: ctl.signal, cache: 'no-store' } : {});
      clearTimeout(timer);
      if (r.ok || (r.status >= 200 && r.status < 500)) return url;
    } catch (e) {}
    return '';
  },

  /* 把当前连接地址拆成 {scheme, host, port} */
  originOf() {
    const conn = Store.active;
    if (!conn || !conn.url) return null;
    const m = String(conn.url).match(/^(https?):\/\/([^/:]+)(?::(\d+))?/i);
    if (!m) return null;
    return { scheme: m[1], host: m[2], port: m[3] || '' };
  },

  luciBase() {
    const o = this.originOf();
    if (!o) return '';
    return o.scheme + '://' + o.host + (o.port ? ':' + o.port : '');
  },

  /* 请原生侧去抓路由器菜单（原生做 HTTP 更快，也不受跨域限制）。
     抓完由 onLuciData 回调。 */
  requestLuciData() {
    const b = nativeBridge();
    if (!b || !b.luciData) return;
    if (this.state.luciAt && Date.now() - this.state.luciAt < 5 * 60 * 1000) return;
    const base = this.luciBase();
    if (!base) return;
    this.state.luciAt = Date.now();     // 先打时间戳，避免同一轮里重复请求
    // 记一个「抓取中」的 Promise，renderMenu 可以等它，避免先画占位再重排
    if (!this.state.luciP) {
      this.state.luciP = new Promise(res => { this._luciResolve = res; });
    }
    try {
      b.luciData(base, Store.data.username || 'root',
                  Store.data.rememberPassword ? (Store.data.password || '') : '',
                  // 界面语言决定要不要翻译路由器菜单：中文要 /translations/zh-cn 那张表，
                  // 英文直接用 LuCI 的源字符串（英文本来就是它的源语言），省一次请求
                  Lang.cur === 'zh' ? 'zh-cn' : '');
    } catch (e) {}
  },

  /* 语言切换后同步静态 HTML（底栏、标题栏这些不在渲染函数里）。
     Lang.set 已经还原过全部原文并重新翻译，这里只是把静态那部分再走一遍，
     因为它们的节点没有因为重新渲染而变化。 */
  syncStaticText() {
    Lang.apply(document.body);
  },

  /* 原生侧抓完菜单 + 翻译表后的回调。json = [{name,title,path,children:[...]}] */
  onLuciData(json) {
    let list = [];
    try { list = JSON.parse(json || '[]'); } catch (e) { list = []; }
    this.state.luci = list;
    this.state.luciAt = Date.now();
    this.state.luciP = null;
    if (this._luciResolve) { const r = this._luciResolve; this._luciResolve = null; r(); }
    this.menuCache = null;              // 菜单变了，之前的探测缓存作废
    if (this.state.phase === 'main' && this.state.tab === 'menu' && !this.state.detail) {
      this.renderMenu(true);
    }
  },

  /* 某个顶层菜单（比如「服务」）的下一级列表 */
  renderLuciGroup(name) {
    const g = (this.state.luci || []).find(x => x.name === name);
    if (!g) { $('#view').innerHTML = '<div class="page pt"><div class="empty">路由器没有这个菜单</div></div>'; return; }
    const leaves = [];
    const blocks = [];
    (g.children || []).forEach(c => {
      if (c.children && c.children.length) {
        blocks.push('<div class="group"><div class="group-title">' + esc(c.title) + '</div><div class="group-card">' +
          c.children.map(luciCell).join('') + '</div></div>');
      } else {
        leaves.push(c);
      }
    });
    const head = leaves.length
      ? '<div class="group"><div class="group-title">' + esc(g.title) + '</div><div class="group-card">' +
        leaves.map(luciCell).join('') + '</div></div>'
      : '';
    $('#view').innerHTML = '<div class="page pt"><div class="page-title">' + esc(g.title) + '</div>' +
      '<div class="page-sub">由路由器 LuCI 提供 · 共 ' + (leaves.length + blocks.length) + ' 组</div>' +
      head + blocks.join('') + '</div>';
  },

  /* 在 App 内嵌的覆盖层里打开路由器页面。

     spec = { id, title, path } 或 { id, title, url }
     id 用来在原生侧复用同一个 WebView —— 同一个页面第二次进来只是显示出来，
     不会重新加载，所以切来切去不再有那种几秒白屏。 */
  openWebPage(spec) {
    const b = nativeBridge();
    let url = spec.url || '';
    if (!url) {
      const o = this.originOf();
      if (!o) { toast('尚未配置管理地址', true); return; }
      url = o.scheme + '://' + o.host + (o.port ? ':' + o.port : '') + (spec.path || '/');
    }
    if (!b || !b.openWeb) { toast('当前环境不支持内置窗口，请用浏览器打开 ' + url, true); return; }

    const title = spec.title || '路由器页面';
    const id = spec.id || spec.path || url;

    this.nextSeq();                 // 覆盖层要独占内容区，作废在路上的渲染
    this.state.detail = 'web:' + id;
    this.state.webPage = { id: id, url: url, title: title };
    this.stopRate();
    $('#nav-title').textContent = title;
    $('#nav-back').classList.remove('hidden');
    $('#nav-action').classList.remove('placeholder');
    $('#view').innerHTML = '';      // 内容区交给原生覆盖层，这里留空给底栏当背景
    this.updateStatus();            // 会显隐顶部状态条，直接影响标题栏高度

    const ins = this.webInsets();   // 必须放在 updateStatus 之后量
    try {
      b.openWeb(id, url, title,
        Store.data.username || 'root',
        Store.data.rememberPassword ? (Store.data.password || '') : '',
        ins.top, ins.bottom);
    } catch (e) {
      $('#view').innerHTML = '<div class="page pt"><div class="empty">' + esc(e.message || '打开失败') + '</div></div>';
    }
  },

  /* 覆盖层要正好卡在「标题栏下沿」和「底栏上沿」之间。
     两处的像素位置只能从 DOM 量出来，再乘 devicePixelRatio 交给原生 ——
     原生那层 WebView 和这个页面同尺寸，所以直接就能用。 */
  webInsets() {
    const dpr = window.devicePixelRatio || 1;
    let top = 0, bottom = 0;
    const nav = $('#nav'), tab = $('#tabbar');
    if (nav && !nav.classList.contains('hidden')) {
      top = Math.max(0, nav.getBoundingClientRect().bottom);
    }
    if (tab && !tab.classList.contains('hidden')) {
      bottom = Math.max(0, window.innerHeight - tab.getBoundingClientRect().top);
    }
    return { top: Math.round(top * dpr), bottom: Math.round(bottom * dpr) };
  },

  pushWebInsets() {
    const b = nativeBridge();
    if (!b || !b.setWebInsets || !this.state.webPage) return;
    const ins = this.webInsets();
    try { b.setWebInsets(ins.top, ins.bottom); } catch (e) {}
  },

  /* 收起内嵌覆盖层。所有会离开当前页面的路径都要过这里，
     否则原生那层 WebView 会一直盖在上面。 */
  closeWebPage() {
    const b = nativeBridge();
    if (b && b.closeWeb) { try { b.closeWeb(); } catch (e) {} }
    this.state.webPage = null;
  },

  /* 系统返回键被原生侧用来收起覆盖层后回调这里，让 App 自己的导航状态跟上 */
  onNativeBack() {
    this.state.webPage = null;
    this.closeDetail();
  },

  /* DHCP 租约：标准 OpenWrt 的默认 ACL 里没有 dhcp / dhcp.leases 对象，
     可用来源是 luci-rpc.getDHCPLeases —— 返回 {dhcp_leases:[{hostname,ipaddr,macaddr,expires}]}。 */
  async probeHosts() {
    return await Ubus.call('luci-rpc', 'getDHCPLeases', {});
  },

  /* ================= 详情页 ================= */
  async renderDetail(id) {
    // 服务详情是动态 id（svc:名称）、LuCI 菜单组是 luci:名称，都单独拦一下
    if (id && id.indexOf('svc:') === 0) { await this.renderServiceDetail(id.slice(4)); return; }
    if (id && id.indexOf('luci:') === 0) { this.renderLuciGroup(id.slice(5)); return; }
    const handlers = {
      network: () => this.renderNet(),
      wireless: () => this.renderWireless(),
      wifiscan: () => this.renderWifiScan(),
      clients: () => this.renderClients(),
      hosts: () => this.renderHosts(),
      firewall: () => this.renderFirewall(),
      conntrack: () => this.renderConntrack(),
      services: () => this.renderServices(),
      processes: () => this.renderProcesses(),
      storage: () => this.renderStorage(),
      leds: () => this.renderLeds(),
      ddns: () => this.renderDdns(),
      upnp: () => this.renderUpnp(),
      wireguard: () => this.renderWireguard(),
      logs: () => this.renderLogs(),
      system: () => this.renderSystem()
    };
    if (handlers[id]) await handlers[id]();
  },

  /* 打开一个不在「功能」菜单里的子页（例如周边 WiFi 扫描） */
  openSub(id, title) {
    this.nextSeq();
    this.state.detail = id;
    this.closeWebPage();          // 同样是换页，覆盖层要让位
    this.stopRate();
    $('#nav-title').textContent = title || '详情';
    $('#nav-back').classList.remove('hidden');
    $('#nav-action').classList.remove('placeholder');
    this.updateStatus();
    this.renderDetail(id);
  },

  /* ================= 网络接口（可编辑） ================= */
  /* uci 的 network 段决定「配置」，network.interface.dump 给出「实时状态」。
     以 uci 段为主键来渲染，把运行时状态并进来一起显示。 */
  async renderNet() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const [ifaces, res] = await Promise.all([
        fetchInterfaces(),
        Ubus.call('uci', 'get', { config: 'network' })
      ]);
      const values = (res && res.values) || {};
      const sections = Uci.sectionsOfType(values, 'interface');
      const names = Object.keys(sections);
      if (!names.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">网络接口</div><div class="empty">没有可编辑的接口</div></div>';
        return;
      }
      const run = {};
      ifaces.forEach(v => { run[v.name] = v; });
      const canWrite = Ubus.can('uci', 'set');

      const rows = names.map(name => {
        const s = sections[name];
        const rt = run[name] || null;
        const proto = s.proto || '';
        const ip = proto === 'static'
          ? (s.ipaddr ? s.ipaddr + (s.netmask ? '/' + s.netmask : '') : '—')
          : ((rt && rt.v4[0]) || (proto === 'dhcp' ? '自动获取' : '—'));
        const on = rt ? rt.up : isEnabled(s);
        const dev = s.device || (rt && rt.device) || '';
        const rate = rt ? ' · ↓ ' + fmtRate(rt.rx) + ' ↑ ' + fmtRate(rt.tx) : '';
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="net-edit" data-section="' + esc(name) + '"' : '') + '>' +
          '<span class="dot ' + (on ? 'up' : '') + '"></span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="flex:0 0 auto;max-width:none;font-weight:600">' + esc(name) + '</span>' +
              '<span class="badge ' + (on ? 'on' : 'off') + '">' + esc(labelOf(PROTO_LABELS, proto)) + '</span>' +
              '<span class="cell-value" style="flex:1;min-width:0;max-width:none;text-align:right">' + esc(ip) + '</span>' +
            '</div>' +
            '<div class="cell-desc">' + (dev ? esc(dev) + ' · ' : '') + (on ? '已连接' : '未连接') + rate + '</div>' +
          '</div>' +
          (canWrite ? ICONS.chevron : '') +
        '</div>';
      }).join('');

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">网络接口</div>' +
        '<div class="page-sub">共 ' + names.length + ' 个接口 · ' + (canWrite ? '点击任意一行可修改配置' : '当前账号只读') + '</div>' +
        '<div class="group-card">' + rows + '</div>' +
        '<button class="btn btn-secondary" data-action="refresh" style="margin-top:12px">刷新状态</button>' +
        '</div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* uci network 里所有 interface 段的名字，给「绑定网络」这类下拉用 */
  async networkNames() {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'network' });
      const names = Object.keys(Uci.sectionsOfType((res && res.values) || {}, 'interface'));
      return names.length ? names : ['lan'];
    } catch (e) { return ['lan']; }
  },

  /* 协议处理器列表来自 network.get_proto_handlers（这台机器有 9 个），
     比硬编码一份可靠的静态表更好；拿不到再退回常用几种。 */
  async protoNames() {
    if (this.state.protoHandlers) return this.state.protoHandlers;
    let keys = [];
    try {
      const r = await Ubus.call('network', 'get_proto_handlers', {});
      keys = Object.keys(r || {});
    } catch (e) {}
    if (!keys.length) keys = ['static', 'dhcp', 'dhcpv6', 'pppoe'];
    this.state.protoHandlers = keys;
    return keys;
  },

  netFields(v, protos) {
    const protoOptions = protos.map(p => ({ value: p, label: labelOf(PROTO_LABELS, p) }));
    if (v.proto && protos.indexOf(v.proto) < 0) protoOptions.unshift({ value: v.proto, label: v.proto });
    const isDial = s => s.proto === 'pppoe' || s.proto === 'ppp';
    return [
      { key: 'proto', label: '协议', type: 'select', value: v.proto || 'static', options: protoOptions },
      { key: 'ipaddr', label: 'IPv4 地址', value: v.ipaddr || '', inputmode: 'decimal', visible: s => s.proto === 'static' },
      { key: 'netmask', label: '子网掩码', value: v.netmask || '255.255.255.0', inputmode: 'decimal', visible: s => s.proto === 'static' },
      { key: 'gateway', label: '网关', value: v.gateway || '', placeholder: '留空表示不指定', inputmode: 'decimal', visible: s => s.proto === 'static' },
      { key: 'dns', label: 'DNS 服务器', value: listToText(v.dns), placeholder: '223.5.5.5 119.29.29.29',
        hint: '多个用空格分隔；留空表示由上游下发', visible: s => s.proto === 'static' || s.proto === 'dhcp' },
      { key: 'hostname', label: 'DHCP 主机名', value: v.hostname || '', visible: s => s.proto === 'dhcp' },
      { key: 'username', label: 'PPPoE 账号', value: v.username || '', visible: isDial },
      { key: 'password', label: 'PPPoE 密码', type: 'password', value: v.password || '', visible: isDial },
      { key: 'enable', label: '启用该接口', type: 'switch', value: isEnabled(v) ? '1' : '0' }
    ];
  },

  /* 只在切换协议时把不适用的旧字段删掉，避免残留导致协议脚本行为怪异 */
  buildNetChanges(vals, old) {
    const out = { proto: vals.proto };
    const drop = k => { if (old[k] !== undefined) out[k] = null; };
    if (vals.proto === 'static') {
      if (!vals.ipaddr.trim()) { toast('静态地址不能为空', true); return null; }
      if (!vals.netmask.trim()) { toast('子网掩码不能为空', true); return null; }
      out.ipaddr = vals.ipaddr.trim();
      out.netmask = vals.netmask.trim();
      out.gateway = vals.gateway.trim() || null;
      out.dns = textToList(vals.dns);
      drop('hostname'); drop('username'); drop('password');
    } else {
      ['ipaddr', 'netmask', 'gateway'].forEach(drop);
      if (vals.proto === 'dhcp' || vals.proto === 'dhcpv6') {
        out.hostname = vals.hostname.trim() || null;
        out.dns = textToList(vals.dns);
      } else { drop('hostname'); drop('dns'); }
      if (vals.proto === 'pppoe' || vals.proto === 'ppp') {
        out.username = vals.username.trim();
        out.password = vals.password;
      } else { drop('username'); drop('password'); }
    }
    out.enabled = vals.enable === '1' ? '1' : '0';
    return out;
  },

  async editNetIface(section) {
    try {
      const [res, protos] = await Promise.all([
        Ubus.call('uci', 'get', { config: 'network', section: section }),
        this.protoNames()
      ]);
      const v = ((res && res.values) || {})[section] || {};
      const isLan = section === 'lan';
      this.editSection({
        config: 'network',
        section: section,
        title: '接口 ' + section,
        hint: '协议决定下面哪些字段有效',
        values: v,
        fields: vals => this.netFields(vals, protos),
        build: vals => this.buildNetChanges(vals, v),
        confirmTitle: '保存接口 ' + section,
        confirmText: isLan
          ? '⚠️ 这是当前的 LAN 接口：改完保存后本机连接会立即中断，需要用新地址重新连接。'
          : '改动会写入 /etc/config/network 并重载网络，可能导致短暂断网。',
        okText: '保存',
        after: () => this.renderNet()
      });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  /* ================= 无线网络（可编辑） ================= */
  async renderWireless() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const [data, res] = await Promise.all([
        Wifi.devices(),
        Ubus.call('uci', 'get', { config: 'wireless' })
      ]);
      const values = (res && res.values) || {};
      const radios = Object.keys(data || {});
      if (!radios.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">无线网络</div><div class="empty">未发现无线设备</div></div>';
        return;
      }
      const canWrite = Ubus.can('uci', 'set');
      let ifaceCount = 0;

      const blocks = radios.map(radio => {
        const r = data[radio] || {};
        const rc = r.config || {};
        const band = rc.band === '2g' ? '2.4G' : (rc.band === '5g' ? '5G' : (rc.band || ''));
        const radioOn = isEnabled({ disabled: (values[radio] || {}).disabled !== undefined ? (values[radio] || {}).disabled : rc.disabled });
        const ch = rc.channel || (rc.disabled ? '—' : 'auto');
        const tp = (rc.txpower === undefined || rc.txpower === '') ? '自动' : rc.txpower + ' dBm';

        const head =
          '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
            (canWrite ? ' data-action="wifi-radio-edit" data-section="' + esc(radio) + '"' : '') + '>' +
            '<span class="dot ' + (radioOn && r.up ? 'up' : '') + '"></span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="display:flex;align-items:baseline;gap:8px">' +
                '<span class="cell-label" style="flex:0 0 auto;max-width:none;font-weight:600">' + esc(radio) + (band ? ' · ' + esc(band) : '') + '</span>' +
                '<span class="badge ' + (radioOn ? 'on' : 'off') + '">' + (radioOn ? '射频开启' : '射频关闭') + '</span>' +
              '</div>' +
              '<div class="cell-desc">信道 ' + esc(String(ch)) + (rc.htmode ? ' · ' + esc(rc.htmode) : '') +
                (rc.country ? ' · ' + esc(rc.country) : '') + ' · 功率 ' + esc(String(tp)) + '</div>' +
            '</div>' +
            (canWrite ? ICONS.chevron : '') +
          '</div>';

        const cells = (r.interfaces || []).map(ifc => {
          ifaceCount++;
          const ic = ifc.config || {};
          const iw = ifc.iwinfo || {};
          const sec = ifc.section || '';
          const ssid = ic.ssid || iw.ssid || '（隐藏 SSID）';
          const enc = ic.encryption || 'none';
          const mode = ic.mode || iw.mode || 'ap';
          const modeText = mode === 'ap' ? '接入点' : (mode === 'sta' ? '客户端' : mode);
          const off = ic.disabled === '1' || ic.disabled === true;
          const stations = (ifc.stations || []).length;
          const q = (iw.quality && iw.quality_max) ? Math.round(iw.quality / iw.quality_max * 100) + '%' : '';
          const details = [];
          details.push(ENC_LABELS[enc] || (enc === 'none' ? '开放' : esc(enc)));
          if (ifc.ifname) details.push(esc(ifc.ifname));
          if (stations) details.push('已连 ' + stations + ' 台');
          if (q) details.push('信号 ' + q);
          return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
            (canWrite ? ' data-action="wifi-edit" data-section="' + esc(sec) + '"' : '') + '>' +
            '<span class="dot ' + (r.up && !off ? 'up' : '') + '"></span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="display:flex;align-items:baseline;gap:8px">' +
                '<span class="cell-label" style="font-weight:600">' + esc(ssid) + '</span>' +
                '<span class="badge ' + (mode === 'sta' ? 'off' : 'on') + '">' + esc(modeText) + '</span>' +
                (off ? '<span class="badge off">已停用</span>' : '') +
              '</div>' +
              '<div class="cell-desc">' + details.join(' · ') + '</div>' +
              (sec ? '<div class="cell-desc">配置段 ' + esc(sec) + '</div>' : '') +
            '</div>' +
            (canWrite ? ICONS.chevron : '') +
          '</div>';
        }).join('');

        return '<div class="group"><div class="group-title">' +
          esc(radio) + (band ? ' · ' + esc(band) : '') + '</div>' +
          '<div class="group-card">' + head + cells + '</div></div>';
      }).join('');

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">无线网络</div>' +
        '<div class="page-sub">' + radios.length + ' 个射频 · ' + ifaceCount + ' 个接口 · ' +
          (canWrite ? '点击任意一行可修改' : '当前账号只读') + '</div>' +
        blocks +
        (canWrite ? '<button class="btn btn-primary" data-action="wifi-add" style="margin-top:18px">＋ 添加无线网络</button>' : '') +
        (Ubus.can('iwinfo', 'scan') ? '<button class="btn btn-secondary" data-action="wifi-scan" style="margin-top:10px">扫描周边 WiFi</button>' : '') +
        '</div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  async editRadio(radio) {
    try {
      const [data, res] = await Promise.all([
        Wifi.devices(),
        Ubus.call('uci', 'get', { config: 'wireless', section: radio })
      ]);
      const v = ((res && res.values) || {})[radio] || {};
      const r = (data || {})[radio] || {};
      const rc = r.config || {};
      const htmodes = [];
      (r.interfaces || []).forEach(i => (((i.iwinfo || {}).htmodes) || []).forEach(m => {
        if (htmodes.indexOf(m) < 0) htmodes.push(m);
      }));
      if (!htmodes.length) ['HT20', 'HT40', 'VHT80'].forEach(m => htmodes.push(m));
      const [channels, tps] = await Promise.all([Wifi.channels(radio), Wifi.txpowers(radio)]);
      const dbms = tps.map(t => t.dbm).filter((x, i, a) => a.indexOf(x) === i);
      const curCh = String(v.channel !== undefined ? v.channel : (rc.channel || 'auto'));
      const curTp = (v.txpower === undefined || v.txpower === '') ? 'auto' : String(v.txpower);

      formModal('射频 ' + radio, [
        { key: 'enable', label: '启用该射频', type: 'switch', value: isEnabled({ disabled: v.disabled !== undefined ? v.disabled : rc.disabled }) ? '1' : '0' },
        { key: 'channel', label: '信道', type: 'select', value: curCh,
          options: [{ value: 'auto', label: '自动 (auto)' }].concat(channels.map(c => ({ value: String(c), label: String(c) }))) },
        { key: 'htmode', label: '频宽模式', type: 'select', value: v.htmode || rc.htmode || htmodes[0],
          options: htmodes.map(m => ({ value: m, label: m })) },
        { key: 'txpower', label: '发射功率', type: 'select', value: curTp,
          options: [{ value: 'auto', label: '自动 / 驱动默认' }].concat(dbms.map(d => ({ value: String(d), label: d + ' dBm' }))),
          hint: '功率越高覆盖越好，但干扰和发热也更大' },
        { key: 'country', label: '国家 / 地区代码', value: v.country || rc.country || '', placeholder: 'CN' }
      ], vals => {
        this.confirmOps('保存射频 ' + radio,
          '修改信道或频宽会立刻重启该射频，所有连在这个射频上的设备会短暂掉线（约 5–15 秒）。',
          '保存', {
            config: 'wireless',
            sets: {
              [radio]: {
                disabled: vals.enable === '1' ? '0' : '1',
                channel: vals.channel || 'auto',
                htmode: vals.htmode || null,
                txpower: vals.txpower === 'auto' ? null : vals.txpower,
                country: (vals.country || '').trim().toUpperCase() || null
              }
            },
            after: () => this.renderWireless()
          });
      }, { okText: '保存' });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  async editWifiIface(section) {
    try {
      const [res, netNames] = await Promise.all([
        Ubus.call('uci', 'get', { config: 'wireless', section: section }),
        this.networkNames()
      ]);
      const v = ((res && res.values) || {})[section] || {};
      const bound = Array.isArray(v.network) ? v.network[0] : v.network;
      formModal('无线接口 ' + section, [
        { key: 'ssid', label: 'SSID（网络名称）', value: v.ssid || '' },
        { key: 'mode', label: '模式', type: 'select', value: v.mode || 'ap',
          options: [
            { value: 'ap', label: '接入点 (AP)' },
            { value: 'sta', label: '客户端 (STA) / 中继' },
            { value: 'adhoc', label: 'Ad-Hoc' },
            { value: 'mesh', label: 'Mesh 节点' }
          ] },
        { key: 'encryption', label: '加密方式', type: 'select', value: v.encryption || 'none', options: ENC_OPTIONS },
        { key: 'key', label: 'Wi-Fi 密码', type: 'password', value: v.key || '',
          hint: '至少 8 位', visible: s => s.encryption && s.encryption !== 'none' },
        { key: 'hidden', label: '隐藏 SSID', type: 'switch', value: isOn(v.hidden) ? '1' : '0', visible: s => s.mode === 'ap' },
        { key: 'enable', label: '启用该接口', type: 'switch', value: v.disabled === '1' ? '0' : '1' },
        { key: 'network', label: '绑定网络', type: 'select', value: bound || 'lan',
          // 注意用 concat：数组用 + 会被 JS 强制转成字符串，options 拿到字符串后
          // .map 直接报错，表现是「弹窗打不开但也没有任何提示」
          options: netNames.map(n => ({ value: n, label: n }))
            .concat(bound && netNames.indexOf(bound) < 0 ? [{ value: bound, label: bound }] : []) }
      ], vals => {
        const enc = vals.encryption || 'none';
        const ssid = String(vals.ssid || '').trim();
        if (!ssid) { toast('SSID 不能为空', true); return; }
        if (enc !== 'none' && String(vals.key || '').length < 8) { toast('WPA 密码至少 8 位', true); return; }
        this.confirmOps('保存无线接口',
          '保存后该无线网络会重启，正在连接它的设备会短暂掉线。', '保存', {
            config: 'wireless',
            sets: {
              [section]: {
                ssid: ssid,
                mode: vals.mode,
                encryption: enc,
                key: enc === 'none' ? null : vals.key,
                hidden: vals.mode === 'ap' ? (vals.hidden === '1' ? '1' : '0') : null,
                disabled: vals.enable === '1' ? '0' : '1',
                network: vals.network || null
              }
            },
            after: () => this.renderWireless()
          });
      }, {
        okText: '保存',
        danger: {
          text: '删除',
          onClick: () => this.deleteSection({
            title: '删除无线接口',
            text: '将删除配置段 ' + section + '（SSID：' + (v.ssid || '—') + '），该无线网络立即消失。',
            config: 'wireless', section: section,
            after: () => this.renderWireless()
          })
        }
      });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  async addWifi() {
    try {
      const [data, netNames] = await Promise.all([Wifi.devices(), this.networkNames()]);
      const radios = Object.keys(data || {});
      if (!radios.length) { toast('没有可用的射频', true); return; }
      const radioOpts = radios.map(r => {
        const c = (data[r] || {}).config || {};
        const band = c.band === '2g' ? '2.4G' : (c.band === '5g' ? '5G' : c.band);
        return { value: r, label: r + (band ? ' · ' + band : '') };
      });
      formModal('添加无线网络', [
        { key: 'device', label: '射频', type: 'select', value: radios[0], options: radioOpts },
        { key: 'ssid', label: 'SSID（网络名称）', value: '' },
        { key: 'encryption', label: '加密方式', type: 'select', value: 'psk2', options: ENC_OPTIONS },
        { key: 'key', label: 'Wi-Fi 密码', type: 'password', value: '',
          hint: '至少 8 位', visible: s => s.encryption && s.encryption !== 'none' },
        { key: 'network', label: '绑定网络', type: 'select', value: netNames[0] || 'lan',
          options: netNames.map(n => ({ value: n, label: n })) }
      ], vals => {
        const enc = vals.encryption || 'none';
        const ssid = String(vals.ssid || '').trim();
        if (!ssid) { toast('SSID 不能为空', true); return; }
        if (enc !== 'none' && String(vals.key || '').length < 8) { toast('WPA 密码至少 8 位', true); return; }
        this.confirmOps('添加无线网络', '将新建一个无线接口并立刻开始广播。', '添加', {
          config: 'wireless',
          adds: [{
            type: 'wifi-iface',
            values: {
              device: vals.device, mode: 'ap', ssid: ssid, encryption: enc,
              key: enc === 'none' ? null : vals.key,
              network: vals.network, disabled: '0'
            }
          }],
          after: () => this.renderWireless()
        });
      }, { okText: '添加' });
    } catch (e) { toast(e.message || '失败', true); }
  },

  /* 周边 WiFi 扫描：拿来做信道选择参考。
     iwinfo.scan 的 device 参数优先用实际 ifname，失败再退回 radio 名。 */
  async renderWifiScan() {
    $('#view').innerHTML =
      '<div class="page pt no-tab"><div class="page-title">周边 WiFi</div>' +
      '<div class="page-sub">正在扫描，约需 5–15 秒…</div>' + this.spinner() + '</div>';
    try {
      const data = await Wifi.devices();
      const found = [];
      let scanned = 0;
      for (const radio of Object.keys(data || {})) {
        const r = data[radio] || {};
        const ifaces = r.interfaces || [];
        const candidates = [];
        ifaces.forEach(i => { if (i.ifname) candidates.push(i.ifname); });
        candidates.push(radio);
        let list = null;
        for (const dev of candidates) {
          try { list = await Wifi.scan(dev); if (list && list.length) break; } catch (e) { list = null; }
        }
        if (!list) continue;
        scanned++;
        const band = ((r.config || {}).band === '2g') ? '2.4G' : '5G';
        list.forEach(x => {
          if (!x.ssid) return;
          found.push({
            ssid: x.ssid,
            channel: x.channel,
            signal: x.signal,
            radio: radio,
            band: band,
            enc: (x.encryption && x.encryption.enabled) ? '加密' : '开放'
          });
        });
      }
      if (!found.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">周边 WiFi</div>' +
          '<div class="empty">' + (scanned ? '扫描完成，周边没有其它 WiFi' : '该路由器不支持扫描（iwinfo.scan 不可用）') + '</div>' +
          '<button class="btn btn-secondary" data-action="wifi-scan" style="margin-top:12px">重新扫描</button></div>';
        return;
      }
      // 同名 SSID 只留信号最强的一个
      const map = {};
      found.forEach(f => { if (!map[f.ssid] || (f.signal || -999) > (map[f.ssid].signal || -999)) map[f.ssid] = f; });
      const arr = Object.keys(map).map(k => map[k]).sort((a, b) => (b.signal || -999) - (a.signal || -999));
      const rows = arr.map(f => {
        const bars = f.signal > -55 ? '强' : f.signal > -70 ? '中' : '弱';
        return '<div class="cell">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(f.ssid) + '</span>' +
              '<span class="badge ' + (f.signal > -70 ? 'on' : 'off') + '">' + bars + '</span>' +
            '</div>' +
            '<div class="cell-desc">信道 ' + esc(String(f.channel)) + ' · ' + esc(f.band) + ' · ' +
              esc(f.radio) + ' · ' + esc(f.enc) + ' · ' + (f.signal || '—') + ' dBm</div>' +
          '</div>' +
        '</div>';
      }).join('');
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">周边 WiFi</div>' +
        '<div class="page-sub">共 ' + arr.length + ' 个 · 按信号强度排序</div>' +
        '<div class="group-card">' + rows + '</div>' +
        '<div class="group-title" style="margin-top:16px">提示</div>' +
        '<div class="cell-desc" style="padding:0 4px">同一信道上的邻居越多，干扰越大。2.4G 建议选 1 / 6 / 11，5G 建议选邻居最少的信道。</div>' +
        '<button class="btn btn-secondary" data-action="wifi-scan" style="margin-top:14px">重新扫描</button></div>';
    } catch (e) {
      this.detailError(e);
    }
  },

  /* ================= 主机 / DHCP（可编辑） ================= */
  /* luci-rpc.getDHCPLeases -> {dhcp_leases:[{hostname,ipaddr,macaddr,expires}]}
     其它固件可能是裸数组，也可能是 {leases:[...]} / {leases:{mac:{...}}} */
  parseLeases(raw) {
    if (raw && Array.isArray(raw.dhcp_leases)) {
      return raw.dhcp_leases.map(l => ({ hostname: l.hostname, ip: l.ipaddr || l.ip, mac: l.macaddr || l.mac, expires: l.expires }));
    }
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.leases)) return raw.leases;
    if (raw && raw.leases && typeof raw.leases === 'object') {
      return Object.keys(raw.leases).map(k => Object.assign({ mac: k }, raw.leases[k]));
    }
    return [];
  },

  async renderHosts() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const [leaseRaw, res] = await Promise.all([
        this.probeHosts(),
        Ubus.call('uci', 'get', { config: 'dhcp' })
      ]);
      const values = (res && res.values) || {};
      const servers = Uci.sectionsOfType(values, 'dhcp');
      const hosts = Uci.sectionsOfType(values, 'host');
      const arr = this.parseLeases(leaseRaw);
      const canWrite = Ubus.can('uci', 'set');
      const now = Math.floor(Date.now() / 1000);

      const srvRows = Object.keys(servers).map(name => {
        const s = servers[name];
        const iface = s.interface || name;
        const ignore = isOn(s.ignore);
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="dhcp-srv-edit" data-section="' + esc(name) + '"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(iface) + '</span>' +
              '<span class="badge ' + (ignore ? 'off' : 'on') + '">' + (ignore ? '不提供 DHCP' : '服务中') + '</span>' +
            '</div>' +
            '<div class="cell-desc">' + (ignore ? '已忽略该接口的请求'
              : '地址池 ' + esc(String(s.start || '')) + ' 起 · ' + esc(String(s.limit || '')) + ' 个 · 租期 ' + esc(String(s.leasetime || '12h'))) + '</div>' +
          '</div>' +
          (canWrite ? ICONS.chevron : '') +
        '</div>';
      }).join('');

      const hostRows = Object.keys(hosts).map(name => {
        const h = hosts[name];
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="dhcp-host-edit" data-section="' + esc(name) + '"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="cell-label" style="font-weight:600">' + esc(h.name || '（未命名）') + '</div>' +
            '<div class="cell-desc">' + esc(h.ip || '未固定 IP') + ' · ' + esc(h.mac || '未填 MAC') + '</div>' +
          '</div>' +
          (canWrite ? ICONS.chevron : '') +
        '</div>';
      }).join('');

      const leaseRows = arr.map(l => {
        const e = Number(l.expires) || 0;
        const remainSec = e > 1e9 ? (e - now) : (e || 0);
        const mac = l.mac || l.macaddr || '';
        const ip = l.ip || l.ipaddr || '';
        const host = l.hostname || '（无主机名）';
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="dhcp-fix" data-mac="' + esc(mac) + '" data-ip="' + esc(ip) + '" data-name="' + esc(host) + '"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="cell-label" style="font-weight:600">' + esc(host) + '</div>' +
            '<div class="cell-desc">' + esc(ip) + ' · ' + esc(mac) + '</div>' +
            '<div class="cell-desc">剩余 ' + Math.max(0, Math.round(remainSec / 60)) + ' 分钟' + (canWrite ? ' · 点击固定 IP' : '') + '</div>' +
          '</div>' +
          (canWrite ? ICONS.chevron : '') +
        '</div>';
      }).join('');

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">主机 / DHCP</div>' +
        '<div class="page-sub">' + arr.length + ' 台在线设备 · ' + Object.keys(hosts).length + ' 条静态分配</div>' +
        '<div class="group"><div class="group-title">DHCP 服务器</div><div class="group-card">' + srvRows + '</div></div>' +
        '<div class="group"><div class="group-title">静态地址分配</div><div class="group-card">' +
          (hostRows || '<div class="cell"><span class="cell-desc">还没有静态分配，可在下方租约里点一条来添加</span></div>') +
        '</div>' +
        (canWrite ? '<button class="btn btn-secondary" data-action="dhcp-host-add" style="margin-top:10px">＋ 手动添加静态地址</button>' : '') +
        '</div>' +
        '<div class="group"><div class="group-title">当前租约</div><div class="group-card">' +
          (leaseRows || '<div class="cell"><span class="cell-desc">当前没有 DHCP 租约</span></div>') +
        '</div></div></div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  async editDhcpServer(section) {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'dhcp', section: section });
      const v = ((res && res.values) || {})[section] || {};
      const lt = v.leasetime || '12h';
      const ltOptions = LEASETIME_OPTIONS.slice();
      if (ltOptions.indexOf(lt) < 0) ltOptions.unshift(lt);
      formModal('DHCP 服务器 · ' + (v.interface || section), [
        { key: 'ignore', label: '在此接口关闭 DHCP', type: 'switch', value: isOn(v.ignore) ? '1' : '0' },
        { key: 'start', label: '地址池起始编号', value: v.start || '100', inputmode: 'numeric',
          hint: '客户端拿到的地址 = 接口网段的第 N 个，例如 192.168.6.1 配 100 就是 192.168.6.100 起',
          visible: s => s.ignore !== '1' },
        { key: 'limit', label: '可分配数量', value: v.limit || '150', inputmode: 'numeric', visible: s => s.ignore !== '1' },
        { key: 'leasetime', label: '租期', type: 'select', value: lt, options: ltOptions.map(x => ({ value: x, label: x })), visible: s => s.ignore !== '1' },
        { key: 'force', label: '强制下发（忽略客户端请求）', type: 'switch', value: isOn(v.force) ? '1' : '0', visible: s => s.ignore !== '1' }
      ], vals => {
        const ig = vals.ignore === '1';
        const out = { ignore: ig ? '1' : null };
        if (!ig) {
          if (!/^\d+$/.test(String(vals.start || ''))) { toast('起始编号必须是数字', true); return; }
          if (!/^\d+$/.test(String(vals.limit || ''))) { toast('数量必须是数字', true); return; }
          out.start = vals.start;
          out.limit = vals.limit;
          out.leasetime = vals.leasetime || '12h';
          out.force = vals.force === '1' ? '1' : null;
        }
        this.confirmOps('保存 DHCP 设置',
          '保存后会重启 dnsmasq / odhcpd，已联网的设备会短暂续租失败但会很快恢复。', '保存', {
            config: 'dhcp', sets: { [section]: out }, after: () => this.renderHosts()
          });
      }, { okText: '保存' });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  async editDhcpHost(section, preset) {
    let v = preset || null;
    try {
      if (!v) {
        const res = await Ubus.call('uci', 'get', { config: 'dhcp', section: section });
        v = ((res && res.values) || {})[section] || {};
      }
    } catch (e) { toast(e.message || '读取失败', true); return; }
    const isNew = !section;
    formModal(isNew ? '添加静态地址' : ('静态地址 · ' + (v.name || section)), [
      { key: 'name', label: '设备名（可留空）', value: v.name || '', placeholder: '例如 my-laptop' },
      { key: 'mac', label: 'MAC 地址', value: v.mac || '', placeholder: 'AA:BB:CC:DD:EE:FF' },
      { key: 'ip', label: '固定 IP', value: v.ip || '', placeholder: '192.168.6.50', inputmode: 'decimal' },
      { key: 'dns', label: '单独指定 DNS', value: listToText(v.dns), placeholder: '留空表示用默认', hint: '多个用空格分隔' }
    ], vals => {
      const mac = String(vals.mac || '').trim();
      if (!/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(mac)) { toast('MAC 格式应为 AA:BB:CC:DD:EE:FF', true); return; }
      const ip = String(vals.ip || '').trim();
      if (ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast('IP 格式不正确', true); return; }
      const values = { name: String(vals.name || '').trim() || null, mac: mac, ip: ip || null, dns: textToList(vals.dns) };
      const ops = { config: 'dhcp', ok: isNew ? '已添加静态地址' : '已保存静态地址', after: () => this.renderHosts() };
      if (isNew) ops.adds = [{ type: 'host', values: values }];
      else ops.sets = { [section]: values };
      this.confirmOps(isNew ? '添加静态地址' : '保存静态地址',
        isNew ? '将把该 MAC 固定到一个 IP，重启后仍然生效。' : '改动会更新 /etc/config/dhcp 并重启 dnsmasq。', '保存', ops);
    }, {
      okText: isNew ? '添加' : '保存',
      danger: isNew ? null : {
        text: '删除',
        onClick: () => this.deleteSection({
          title: '删除静态地址',
          text: '将删除 ' + (v.name || v.mac || section) + ' 的固定分配。', config: 'dhcp', section: section,
          after: () => this.renderHosts()
        })
      }
    });
  },

  /* ================= 防火墙（可编辑） ================= */
  async renderFirewall() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const res = await Ubus.call('uci', 'get', { config: 'firewall' });
      const values = (res && res.values) || {};
      const defaults = Uci.sectionsOfType(values, 'defaults');
      const zones = Uci.sectionsOfType(values, 'zone');
      const forwards = Uci.sectionsOfType(values, 'forwarding');
      const rules = Uci.sectionsOfType(values, 'rule');
      const redirects = Uci.sectionsOfType(values, 'redirect');
      const canWrite = Ubus.can('uci', 'set');
      const apply = Uci.APPLY.firewall;
      const after = () => this.renderFirewall();

      const defName = Object.keys(defaults)[0] || '';
      const def = defaults[defName] || {};
      const defRow =
        '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="fw-defaults-edit"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="cell-label" style="font-weight:600">默认策略</div>' +
            '<div class="cell-desc">入站 ' + esc(def.input || '—') + ' · 出站 ' + esc(def.output || '—') +
              ' · 转发 ' + esc(def.forward || '—') + '</div>' +
            '<div class="cell-desc">SYN 洪水保护 ' + (isOn(def.syn_flood) ? '开' : '关') +
              ' · 全锥 NAT ' + (isOn(def.fullcone) ? '开' : '关') + '</div>' +
          '</div>' + (canWrite ? ICONS.chevron : '') +
        '</div>';

      const zoneRows = Object.keys(zones).map(name => {
        const z = zones[name];
        const nets = z.network || z.device || '';
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="fw-zone-edit" data-section="' + esc(name) + '"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(z.name || name) + '</span>' +
              (isOn(z.masq) ? '<span class="badge on">NAT</span>' : '') +
            '</div>' +
            '<div class="cell-desc">入站 ' + esc(z.input || '—') + ' · 出站 ' + esc(z.output || '—') + ' · 转发 ' + esc(z.forward || '—') + '</div>' +
            (nets ? '<div class="cell-desc">接口 ' + esc(listToText(nets)) + '</div>' : '') +
          '</div>' + (canWrite ? ICONS.chevron : '') +
        '</div>';
      }).join('');

      const fwRows = Object.keys(forwards).map(name => {
        const f = forwards[name];
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="fw-forward-del" data-section="' + esc(name) + '"' : '') + '>' +
          '<span class="cell-label">' + esc(f.src || 'any') + ' → ' + esc(f.dest || 'any') + '</span>' +
          (canWrite ? '<span class="cell-value cell-danger">删除</span>' : '') +
        '</div>';
      }).join('');

      const ruleRows = Object.keys(rules).map(name => {
        const r = rules[name];
        const off = r.enabled === '0' || r.enabled === false;
        const port = r.dest_port || r.src_port || '';
        const geo = [r.family || 'any', r.proto || 'all'].join(' · ') + (port ? ' : ' + port : '');
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="fw-rule-edit" data-section="' + esc(name) + '"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(r.name || '（未命名）') + '</span>' +
              '<span class="badge ' + (off ? 'off' : 'on') + '">' + (off ? '已停用' : esc(r.target || r.action || '—')) + '</span>' +
            '</div>' +
            '<div class="cell-desc">' + esc(geo) + '</div>' +
            '<div class="cell-desc">' + esc(r.src || 'any') + ' → ' + esc(r.dest || 'any') + '</div>' +
          '</div>' +
          (canWrite ? '<button class="modal-btn cell-action ' + (off ? 'accent' : 'cancel') + '" data-action="fw-rule-toggle" data-section="' + esc(name) + '" data-value="' + (off ? '1' : '0') + '">' + (off ? '启用' : '停用') + '</button>' : '') +
        '</div>';
      }).join('');

      const rdRows = Object.keys(redirects).map(name => {
        const r = redirects[name];
        const off = r.enabled === '0' || r.enabled === false;
        const to = (r.dest_ip || '') + (r.dest_port ? ':' + r.dest_port : '');
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="fw-rd-edit" data-section="' + esc(name) + '"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(r.name || '（未命名）') + '</span>' +
              '<span class="badge ' + (off ? 'off' : 'on') + '">' + (off ? '已停用' : '生效中') + '</span>' +
            '</div>' +
            '<div class="cell-desc">' + esc(r.src || 'any') + ':' + esc(r.src_dport || '*') + ' → ' + esc(to || '—') + ' · ' + esc(r.proto || 'all') + '</div>' +
          '</div>' + (canWrite ? ICONS.chevron : '') +
        '</div>';
      }).join('');

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">防火墙</div>' +
        '<div class="page-sub">' + Object.keys(zones).length + ' 个区域 · ' + Object.keys(rules).length +
          ' 条规则 · ' + Object.keys(redirects).length + ' 条端口转发</div>' +
        '<div class="group"><div class="group-title">默认策略</div><div class="group-card">' + defRow + '</div></div>' +
        '<div class="group"><div class="group-title">区域 (zone)</div><div class="group-card">' + zoneRows + '</div>' +
          (canWrite ? '<button class="btn btn-secondary" data-action="fw-zone-add" style="margin-top:10px">＋ 新建区域</button>' : '') + '</div>' +
        '<div class="group"><div class="group-title">区域转发</div><div class="group-card">' + fwRows + '</div></div>' +
        '<div class="group"><div class="group-title">流量规则</div><div class="group-card">' + ruleRows + '</div>' +
          (canWrite ? '<button class="btn btn-secondary" data-action="fw-rule-add" style="margin-top:10px">＋ 新建流量规则</button>' : '') + '</div>' +
        '<div class="group"><div class="group-title">端口转发</div><div class="group-card">' +
          (rdRows || '<div class="cell"><span class="cell-desc">还没有端口转发规则</span></div>') + '</div>' +
          (canWrite ? '<button class="btn btn-secondary" data-action="fw-rd-add" style="margin-top:10px">＋ 新建端口转发</button>' : '') + '</div>' +
        '</div>';
      this.state.fwZones = Object.keys(zones).map(k => zones[k].name).filter(Boolean);
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  zoneOptions(extra) {
    const list = (this.state.fwZones || []).slice();
    const out = [{ value: '*', label: '任意 (*)' }];
    list.forEach(z => out.push({ value: z, label: z }));
    if (extra && list.indexOf(extra) < 0) out.push({ value: extra, label: extra });
    return out;
  },

  async editFwDefaults() {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'firewall' });
      const values = (res && res.values) || {};
      const name = Uci.firstOfType(values, 'defaults');
      const v = values[name] || {};
      formModal('默认策略', [
        { key: 'input', label: '入站 (input)', type: 'select', value: v.input || 'REJECT', options: toOptions(ZONE_POLICY) },
        { key: 'output', label: '出站 (output)', type: 'select', value: v.output || 'ACCEPT', options: toOptions(ZONE_POLICY) },
        { key: 'forward', label: '转发 (forward)', type: 'select', value: v.forward || 'REJECT', options: toOptions(ZONE_POLICY) },
        { key: 'syn_flood', label: 'SYN 洪水保护', type: 'switch', value: isOn(v.syn_flood) ? '1' : '0' },
        { key: 'fullcone', label: '全锥 NAT (fullcone)', type: 'switch', value: isOn(v.fullcone) ? '1' : '0' }
      ], vals => {
        this.confirmOps('保存默认策略', '入站方向改成 ACCEPT 会让路由器所有端口对外可见，请谨慎。', '保存', {
          config: 'firewall',
          sets: {
            [name]: {
              input: vals.input, output: vals.output, forward: vals.forward,
              syn_flood: vals.syn_flood === '1' ? '1' : '0',
              fullcone: vals.fullcone === '1' ? '1' : '0',
              fullcone6: vals.fullcone === '1' ? '0' : null
            }
          },
          after: () => this.renderFirewall()
        });
      }, { okText: '保存' });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  fwZoneFields(v) {
    return [
      { key: 'name', label: '区域名称', value: v.name || '', placeholder: '例如 guest' },
      { key: 'input', label: '入站 (input)', type: 'select', value: v.input || 'REJECT', options: toOptions(ZONE_POLICY) },
      { key: 'output', label: '出站 (output)', type: 'select', value: v.output || 'ACCEPT', options: toOptions(ZONE_POLICY) },
      { key: 'forward', label: '转发 (forward)', type: 'select', value: v.forward || 'REJECT', options: toOptions(ZONE_POLICY) },
      { key: 'masq', label: 'NAT 伪装 (masq)', type: 'switch', value: isOn(v.masq) ? '1' : '0', hint: 'WAN 侧通常开启' },
      { key: 'mtu_fix', label: 'MSS 钳制 (mtu_fix)', type: 'switch', value: isOn(v.mtu_fix) ? '1' : '0' }
    ];
  },

  async editFwZone(section) {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'firewall', section: section });
      const v = ((res && res.values) || {})[section] || {};
      formModal('区域 ' + (v.name || section), this.fwZoneFields(v), vals => {
        const name = String(vals.name || '').trim();
        if (!name) { toast('区域名称不能为空', true); return; }
        if (name !== v.name) { toast('区域改名后需同步修改引用它的转发 / 规则', false); }
        this.confirmOps('保存区域 ' + name,
          '入站设为 ACCEPT 等于对该区域完全开放，请确认这是你要的。', '保存', {
            config: 'firewall',
            sets: {
              [section]: {
                name: name, input: vals.input, output: vals.output, forward: vals.forward,
                masq: vals.masq === '1' ? '1' : null,
                mtu_fix: vals.mtu_fix === '1' ? '1' : null
              }
            },
            after: () => this.renderFirewall()
          });
      }, {
        okText: '保存',
        danger: {
          text: '删除',
          onClick: () => this.deleteSection({
            title: '删除区域',
            text: '将删除区域 ' + (v.name || section) + '，引用它的转发规则会失效。',
            config: 'firewall', section: section, after: () => this.renderFirewall()
          })
        }
      });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  async addFwZone() {
    formModal('新建区域', this.fwZoneFields({ input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' }), vals => {
      const name = String(vals.name || '').trim();
      if (!name) { toast('区域名称不能为空', true); return; }
      this.confirmOps('新建区域', '新区域默认拒绝入站与转发，需要自行放行。', '创建', {
        config: 'firewall',
        adds: [{
          type: 'zone',
          values: {
            name: name, input: vals.input, output: vals.output, forward: vals.forward,
            masq: vals.masq === '1' ? '1' : null,
            mtu_fix: vals.mtu_fix === '1' ? '1' : null
          }
        }],
        after: () => this.renderFirewall()
      });
    }, { okText: '创建' });
  },

  fwRuleFields(v) {
    const protoRaw = listToText(v.proto) || 'all';
    const protoOptions = toOptions(['all', 'tcp', 'udp', 'tcp udp', 'icmp', 'igmp', 'esp', 'gre', 'ah']);
    if (protoOptions.every(o => o.value !== protoRaw)) protoOptions.unshift({ value: protoRaw, label: protoRaw });
    return [
      { key: 'name', label: '规则名称', value: v.name || '' },
      { key: 'target', label: '动作', type: 'select', value: v.target || v.action || 'ACCEPT',
        options: toOptions(['ACCEPT', 'REJECT', 'DROP', 'DNAT', 'SNAT', 'MASQUERADE']) },
      { key: 'proto', label: '协议', type: 'select', value: protoRaw, options: protoOptions },
      { key: 'family', label: 'IP 版本', type: 'select', value: v.family || 'any',
        options: [{ value: 'any', label: '任意' }, { value: 'ipv4', label: 'IPv4' }, { value: 'ipv6', label: 'IPv6' }] },
      { key: 'src', label: '来源区域', type: 'select', value: v.src || '*', options: this.zoneOptions(v.src) },
      { key: 'src_ip', label: '来源 IP / 网段', value: v.src_ip || '', placeholder: '留空表示不限' },
      { key: 'src_port', label: '来源端口', value: listToText(v.src_port), placeholder: '例如 1024-65535' },
      { key: 'dest', label: '目标区域', type: 'select', value: v.dest || '*', options: this.zoneOptions(v.dest) },
      { key: 'dest_ip', label: '目标 IP / 网段', value: v.dest_ip || '', placeholder: '留空表示不限' },
      { key: 'dest_port', label: '目标端口', value: listToText(v.dest_port), placeholder: '例如 80 443' },
      { key: 'enable', label: '启用该规则', type: 'switch', value: (v.enabled === '0' || v.enabled === false) ? '0' : '1' }
    ];
  },

  buildFwRule(vals, old) {
    const out = {
      name: String(vals.name || '').trim() || null,
      target: vals.target,
      proto: textToList(vals.proto) || null,
      family: vals.family === 'any' ? null : vals.family,
      src: vals.src === '*' ? null : vals.src,
      src_ip: String(vals.src_ip || '').trim() || null,
      src_port: textToList(vals.src_port),
      dest: vals.dest === '*' ? null : vals.dest,
      dest_ip: String(vals.dest_ip || '').trim() || null,
      dest_port: textToList(vals.dest_port),
      enabled: vals.enable === '1' ? '1' : '0'
    };
    return out;
  },

  async editFwRule(section) {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'firewall', section: section });
      const v = ((res && res.values) || {})[section] || {};
      formModal('流量规则 ' + (v.name || section), this.fwRuleFields(v), vals => {
        this.confirmOps('保存流量规则', '改动会重载防火墙，已建立的连接不受影响。', '保存', {
          config: 'firewall',
          sets: { [section]: this.buildFwRule(vals, v) },
          after: () => this.renderFirewall()
        });
      }, {
        okText: '保存',
        danger: {
          text: '删除',
          onClick: () => this.deleteSection({
            title: '删除流量规则',
            text: '将删除规则 ' + (v.name || section) + '。',
            config: 'firewall', section: section, after: () => this.renderFirewall()
          })
        }
      });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  addFwRule() {
    formModal('新建流量规则', this.fwRuleFields({ target: 'ACCEPT', proto: 'tcp', family: 'ipv4' }), vals => {
      const values = this.buildFwRule(vals, {});
      this.confirmOps('新建流量规则', '将新增一条规则并立刻重载防火墙。', '创建', {
        config: 'firewall',
        adds: [{ type: 'rule', values: values }],
        after: () => this.renderFirewall()
      });
    }, { okText: '创建' });
  },

  fwRedirectFields(v) {
    return [
      { key: 'name', label: '名称', value: v.name || '', placeholder: '例如 内网 NAS' },
      { key: 'src', label: '来源区域', type: 'select', value: v.src || 'wan', options: this.zoneOptions(v.src) },
      { key: 'src_dport', label: '外部端口', value: listToText(v.src_dport), placeholder: '例如 8080' },
      { key: 'dest', label: '目标区域', type: 'select', value: v.dest || 'lan', options: this.zoneOptions(v.dest) },
      { key: 'dest_ip', label: '内网目标 IP', value: v.dest_ip || '', placeholder: '192.168.6.100', inputmode: 'decimal' },
      { key: 'dest_port', label: '内网目标端口', value: listToText(v.dest_port), placeholder: '留空表示与外部端口相同' },
      { key: 'proto', label: '协议', type: 'select', value: listToText(v.proto) || 'tcp',
        options: toOptions(['tcp', 'udp', 'tcp udp']) },
      { key: 'enable', label: '启用该转发', type: 'switch', value: (v.enabled === '0' || v.enabled === false) ? '0' : '1' }
    ];
  },

  async editFwRedirect(section) {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'firewall', section: section });
      const v = ((res && res.values) || {})[section] || {};
      formModal('端口转发 ' + (v.name || section), this.fwRedirectFields(v), vals => {
        if (!String(vals.dest_ip || '').trim()) { toast('请填写内网目标 IP', true); return; }
        this.confirmOps('保存端口转发', '外部端口会直接暴露到公网，请确认目标服务是安全的。', '保存', {
          config: 'firewall',
          sets: {
            [section]: {
              name: String(vals.name || '').trim() || null,
              src: vals.src === '*' ? null : vals.src,
              src_dport: textToList(vals.src_dport),
              dest: vals.dest === '*' ? null : vals.dest,
              dest_ip: String(vals.dest_ip).trim(),
              dest_port: textToList(vals.dest_port),
              proto: textToList(vals.proto),
              target: v.target || 'DNAT',
              enabled: vals.enable === '1' ? '1' : '0'
            }
          },
          after: () => this.renderFirewall()
        });
      }, {
        okText: '保存',
        danger: {
          text: '删除',
          onClick: () => this.deleteSection({
            title: '删除端口转发',
            text: '将删除 ' + (v.name || section) + '。',
            config: 'firewall', section: section, after: () => this.renderFirewall()
          })
        }
      });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  addFwRedirect() {
    formModal('新建端口转发', this.fwRedirectFields({ proto: 'tcp' }), vals => {
      if (!String(vals.dest_ip || '').trim()) { toast('请填写内网目标 IP', true); return; }
      if (!String(listToText(vals.src_dport) || '').trim()) { toast('请填写外部端口', true); return; }
      this.confirmOps('新建端口转发', '将把外部端口映射到内网主机，保存后立即生效。', '创建', {
        config: 'firewall',
        adds: [{
          type: 'redirect',
          values: {
            name: String(vals.name || '').trim() || null,
            src: vals.src === '*' ? null : vals.src,
            src_dport: textToList(vals.src_dport),
            dest: vals.dest === '*' ? null : vals.dest,
            dest_ip: String(vals.dest_ip).trim(),
            dest_port: textToList(vals.dest_port),
            proto: textToList(vals.proto),
            target: 'DNAT',
            enabled: '1'
          }
        }],
        after: () => this.renderFirewall()
      });
    }, { okText: '创建' });
  },

  /* ================= 系统（可编辑） ================= */
  async renderSystem() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const [info, res] = await Promise.all([
        Ubus.call('system', 'info', {}),
        Ubus.call('uci', 'get', { config: 'system' })
      ]);
      let board = null;
      try { board = await Ubus.call('system', 'board', {}); } catch (e) {}
      let temp = '';
      try { const t = await Ubus.call('luci', 'getTempInfo', {}); temp = (t && t.tempinfo) || ''; } catch (e) {}

      const values = (res && res.values) || {};
      const sysName = Uci.firstOfType(values, 'system');
      const sysSec = values[sysName] || {};
      const ntpName = Uci.firstOfType(values, 'timeserver') || 'ntp';
      const ntpSec = values[ntpName] || {};
      const canWrite = Ubus.can('uci', 'set');

      const mem = info.memory || {};
      const swap = info.swap || {};
      const rows = [
        ['型号', board && board.model],
        ['硬件', board && board.board_name],
        ['固件', board && board.release && board.release.version],
        ['内核', board && board.kernel],
        ['运行时间', fmtUptime(info.uptime)],
        ['负载', (info.load || []).map(x => (Number(x) || 0).toFixed(2)).join(' / ')],
        ['内存', fmtBytes(mem.total || 0) + '（可用 ' + fmtBytes(mem.available || ((mem.free || 0) + (mem.cached || 0))) + '）'],
        ['Swap', swap.total ? fmtBytes(swap.total) : '—'],
        ['温度', temp]
      ].map(kv => '<div class="cell"><span class="cell-label">' + esc(kv[0]) + '</span><span class="cell-value">' + esc(kv[1] || '—') + '</span></div>').join('');

      const basicRows = [
        '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' + (canWrite ? ' data-action="sys-basic-edit"' : '') + '>' +
          '<span class="cell-label">主机名</span><span class="cell-value">' + esc(sysSec.hostname || '—') + '</span></div>',
        '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' + (canWrite ? ' data-action="sys-basic-edit"' : '') + '>' +
          '<span class="cell-label">时区</span><span class="cell-value">' + esc(sysSec.zonename || sysSec.timezone || '—') + '</span></div>',
        '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' + (canWrite ? ' data-action="sys-ntp-edit"' : '') + '>' +
          '<span class="cell-label">时间同步</span><span class="cell-value">' +
          (isOn(ntpSec.enabled) ? '已开启' : '已关闭') + ' · ' + esc(short(listToText(ntpSec.server) || '未配置', 22)) + '</span></div>',
        (Ubus.can('luci', 'setPassword')
          ? '<div class="cell cell-clickable" data-action="sys-passwd"><span class="cell-label">修改路由器登录密码</span>' +
            '<span class="cell-value">' + esc(Store.data.username || 'root') + '</span></div>'
          : '')
      ].join('');

      const ops = [];
      if (Ubus.can('rc', 'init')) {
        ops.push('<div class="cell cell-clickable" data-action="act-reload"><span class="cell-label">重启网络</span><span class="cell-value">reload</span></div>');
      }
      if (Ubus.can('system', 'reboot')) {
        ops.push('<div class="cell cell-clickable" data-action="act-reboot"><span class="cell-label cell-danger">重启路由器</span><span class="cell-value">reboot</span></div>');
      }
      if (Ubus.can('system', 'poweroff')) {
        ops.push('<div class="cell cell-clickable" data-action="act-poweroff"><span class="cell-label cell-danger">关机</span><span class="cell-value">poweroff</span></div>');
      }

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">系统</div>' +
        '<div class="group"><div class="group-title">设备信息</div><div class="group-card">' + rows + '</div></div>' +
        '<div class="group"><div class="group-title">基本设置</div><div class="group-card">' + basicRows + '</div></div>' +
        (ops.length ? '<div class="group"><div class="group-title">操作（需谨慎）</div><div class="group-card">' + ops.join('') + '</div></div>' : '') +
        '</div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  async editSystemBasic() {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'system' });
      const values = (res && res.values) || {};
      const name = Uci.firstOfType(values, 'system');
      const v = values[name] || {};
      let zones = [];
      try {
        const tz = await Ubus.call('luci', 'getTimezones', {});
        zones = Object.keys(tz || {}).map(z => ({ zone: z, tz: ((tz[z] || {}).tzstring) || '' }));
      } catch (e) {}
      formModal('基本信息', [
        { key: 'hostname', label: '主机名', value: v.hostname || '', placeholder: 'OpenWrt' },
        { key: 'zonename', label: '时区', value: v.zonename || '',
          placeholder: 'Asia/Shanghai',
          datalist: zones.map(z => z.zone),
          hint: zones.length ? '输入或从下拉里选（共 ' + zones.length + ' 个）' : '时区列表不可用，可手填' }
      ], vals => {
        const zn = String(vals.zonename || '').trim();
        const hit = zones.find(z => z.zone === zn);
        const out = { hostname: String(vals.hostname || '').trim() || null, zonename: zn || null };
        if (hit) out.timezone = hit.tz;    // 配套的 POSIX TZ 串，LuCI 也是同时写两个
        this.confirmOps('保存基本信息', '主机名会影响局域网内识别这台路由器的方式。', '保存', {
          config: 'system', sets: { [name]: out }, after: () => this.renderSystem()
        });
      }, { okText: '保存' });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  async editSystemNtp() {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'system' });
      const values = (res && res.values) || {};
      const name = Uci.firstOfType(values, 'timeserver') || 'ntp';
      const v = values[name] || {};
      formModal('时间同步', [
        { key: 'enable', label: '启用 NTP 客户端', type: 'switch', value: isOn(v.enabled) ? '1' : '0' },
        { key: 'server', label: 'NTP 服务器', value: listToText(v.server), placeholder: 'ntp.aliyun.com cn.pool.ntp.org',
          hint: '多个用空格分隔' }
      ], vals => {
        const servers = textToList(vals.server);
        if (vals.enable === '1' && !servers) { toast('启用 NTP 时至少要填一个服务器', true); return; }
        this.confirmOps('保存时间同步', '保存后会重启时间同步服务。', '保存', {
          config: 'system',
          sets: { [name]: { enabled: vals.enable === '1' ? '1' : '0', server: servers } },
          after: () => this.renderSystem()
        });
      }, { okText: '保存' });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  /* 改路由器登录密码走 luci.setPassword（实测可用）。
     改完要把本地保存的密码一起更新，否则下次自动重登会失败。 */
  changePassword() {
    formModal('修改路由器密码', [
      { key: 'p1', label: '新密码', type: 'password', value: '' },
      { key: 'p2', label: '再输一次', type: 'password', value: '' }
    ], vals => {
      if (!vals.p1) { toast('密码不能为空', true); return; }
      if (vals.p1 !== vals.p2) { toast('两次输入不一致', true); return; }
      const user = Store.data.username || 'root';
      confirmModal('修改路由器密码',
        '将把路由器上 ' + user + ' 的密码改成新密码。改完请立刻确认能重新登录，否则会连不上。',
        '修改', async () => {
          try {
            await Ubus.call('luci', 'setPassword', { username: user, password: vals.p1 });
            if (Store.data.rememberPassword) { Store.data.password = vals.p1; Store.save(); }
            toast('密码已修改');
          } catch (e) {
            toast('修改失败：' + (e.message || '未知错误'), true);
          }
        }, 'destructive');
    }, { okText: '下一步', hint: '密码会以 crypt 哈希写入路由器，不会明文保存在路由器上。' });
  },

  /* ================= 服务管理 ================= */
  /* rc.list 给出所有 init 脚本：{ name: {start, stop, enabled, running} }
     - 运行控制：rc.init      {name, action: start|stop|restart|reload}
     - 开机自启：luci.setInitAction {name, action: enable|disable}
       注意 setInitAction 的停用动作是 **disable**，写成 "disabled" 会返回 Invalid action。 */
  async renderServices() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const list = await Ubus.call('rc', 'list', {});
      const names = Object.keys(list || {});
      if (!names.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">服务管理</div><div class="empty">没有可管理的服务</div></div>';
        return;
      }
      // 运行中的排前面，其余按名字
      names.sort((a, b) => {
        const ra = list[a].running ? 0 : 1, rb = list[b].running ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b);
      });
      const running = names.filter(n => list[n].running).length;
      const disabled = names.filter(n => list[n].enabled === false).length;
      const rows = names.map(n => {
        const s = list[n] || {};
        return '<div class="cell cell-clickable" data-action="svc-open" data-section="' + esc(n) + '">' +
          '<span class="dot ' + (s.running ? 'up' : '') + '"></span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(n) + '</span>' +
              (s.enabled === false ? '<span class="badge off">自启已关</span>' : '') +
              '<span class="cell-value" style="flex:1;min-width:0;max-width:none;text-align:right">' +
                (s.running ? '运行中' : '未运行') + '</span>' +
            '</div>' +
            '<div class="cell-desc">启动序号 ' + esc(String(s.start === undefined ? '—' : s.start)) +
              (s.stop !== undefined ? ' · 停止序号 ' + esc(String(s.stop)) : '') + '</div>' +
          '</div>' + ICONS.chevron +
        '</div>';
      }).join('');
      this.state.services = list;
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">服务管理</div>' +
        '<div class="page-sub">共 ' + names.length + ' 个服务 · ' + running + ' 个运行中' +
          (disabled ? ' · ' + disabled + ' 个已关自启' : '') + '</div>' +
        '<div class="group-card">' + rows + '</div></div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* 单个服务的详情页（/etc/init.d/<name> 的图形版） */
  async renderServiceDetail(name) {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const list = this.state.services || await Ubus.call('rc', 'list', {});
      const s = (list || {})[name] || {};
      const busy = v => v === undefined || v === null || v === '' ? '—' : String(v);
      const info = [
        ['运行状态', s.running ? '运行中' : '已停止'],
        ['开机自启', s.enabled === false ? '已关闭' : '已开启'],
        ['启动序号', busy(s.start)],
        ['停止序号', busy(s.stop)]
      ].map(kv => '<div class="cell"><span class="cell-label">' + esc(kv[0]) + '</span>' +
        '<span class="cell-value">' + esc(kv[1]) + '</span></div>').join('');

      const act = (a, label, cls) =>
        '<div class="cell cell-clickable" data-action="svc-act" data-section="' + esc(name) + '" data-value="' + a + '">' +
          '<span class="cell-label' + (cls || '') + '">' + label + '</span>' +
          '<span class="cell-value">' + a + '</span></div>';

      const runOps = [
        act('start', '启动'),
        act('restart', '重启'),
        act('reload', '重载配置'),
        act('stop', '停止', ' cell-danger')
      ].join('');
      const bootOps = [
        act('enable', '设为开机自启'),
        act('disable', '取消开机自启')
      ].join('');

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">' + esc(name) + '</div>' +
        '<div class="page-sub">/etc/init.d/' + esc(name) + '</div>' +
        '<div class="group"><div class="group-title">状态</div><div class="group-card">' + info + '</div></div>' +
        '<div class="group"><div class="group-title">运行控制</div><div class="group-card">' + runOps + '</div></div>' +
        '<div class="group"><div class="group-title">开机自启</div><div class="group-card">' + bootOps + '</div></div>' +
        '<div class="cell-desc" style="padding:8px 4px">停止关键服务（network / dnsmasq / firewall）可能让本机立刻失联，请谨慎操作。</div>' +
        '</div>';
    } catch (e) {
      this.detailError(e);
    }
  },

  /* 服务的一个动作（启动 / 停止 / 自启） */
  svcAction(name, action) {
    const isBoot = action === 'enable' || action === 'disable';
    const label = { start: '启动', stop: '停止', restart: '重启', reload: '重载', enable: '设为开机自启', disable: '取消开机自启' }[action] || action;
    const risky = action === 'stop' || action === 'restart';
    confirmModal(label + ' ' + name,
      isBoot
        ? (action === 'enable' ? '重启路由器后该服务会自动启动。' : '重启路由器后该服务不再自动启动（当前运行状态不变）。')
        : '将立即对 ' + name + ' 执行 ' + action + '。' + (risky ? '关键服务可能导致本机短暂失去连接。' : ''),
      label,
      async () => {
        try {
          if (isBoot) {
            const r = await Ubus.call('luci', 'setInitAction', { name: name, action: action });
            if (r && r.error) throw new Error(r.error);
          } else {
            await Uci.apply(name, action);
          }
          toast(label + '成功');
          setTimeout(() => this.renderServiceDetail(name), 900);
        } catch (e) {
          toast(label + '失败：' + (e.message || '未知错误'), true);
        }
      },
      action === 'stop' ? 'destructive' : 'accent');
  },

  /* ================= 无线客户端 ================= */
  /* 客户端的权威来源是 iwinfo.assoclist（每个 AP 接口一份），
     DHCP 租约只能补齐主机名/IP。hostapd.<ifname> 可以踢掉某个客户端。 */
  async probeClients() {
    const data = await Wifi.devices();
    if (!data) throw new Error('no wireless');
    return data;
  },

  async renderClients() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const [data, leaseRaw] = await Promise.all([
        Wifi.devices(),
        this.probeHosts().catch(() => null)
      ]);
      const leases = this.parseLeases(leaseRaw);
      const hostOf = {};
      leases.forEach(l => {
        const mac = String(l.mac || l.macaddr || '').toLowerCase();
        if (mac) hostOf[mac] = { host: l.hostname || '', ip: l.ip || l.ipaddr || '' };
      });

      const canKick = Ubus.can('hostapd.phy0-ap0', 'del_client') || Ubus.can('iwinfo', 'info');
      let total = 0;
      const blocks = [];
      for (const radio of Object.keys(data || {})) {
        for (const ifc of ((data[radio] || {}).interfaces || [])) {
          const ic = ifc.config || {};
          if ((ic.mode || 'ap') !== 'ap') continue;      // 客户端模式的接口没有关联列表
          const ifname = ifc.ifname;
          if (!ifname) continue;
          let list = [];
          try { list = await Wifi.assoclist(ifname); } catch (e) { continue; }
          total += list.length;
          const rows = list.map(c => {
            const mac = String(c.mac || '').toLowerCase();
            const hit = hostOf[mac] || {};
            const sig = Number(c.signal);
            const bars = sig > -55 ? '强' : sig > -70 ? '中' : '弱';
            const mins = Math.floor((Number(c.connected_time) || 0) / 60);
            const rate = c.rx && c.rx.bitrate ? Math.round(c.rx.bitrate / 1000) + ' Mbps' : '';
            return '<div class="cell">' +
              '<div style="flex:1;min-width:0">' +
                '<div style="display:flex;align-items:baseline;gap:8px">' +
                  '<span class="cell-label" style="font-weight:600">' + esc(hit.host || c.mac || '未知设备') + '</span>' +
                  '<span class="badge ' + (sig > -70 ? 'on' : 'off') + '">' + bars + '</span>' +
                '</div>' +
                '<div class="cell-desc">' + esc(c.mac || '') + (hit.ip ? ' · ' + esc(hit.ip) : '') + '</div>' +
                '<div class="cell-desc">信号 ' + (isNaN(sig) ? '—' : sig + ' dBm') +
                  ' · 已连 ' + mins + ' 分钟' + (rate ? ' · ' + rate : '') +
                  ' · 噪声 ' + esc(String(c.noise === undefined ? '—' : c.noise)) + '</div>' +
              '</div>' +
              (canKick
                ? '<button class="modal-btn cell-action destructive" data-action="wifi-kick" ' +
                  'data-ifname="' + esc(ifname) + '" data-mac="' + esc(c.mac || '') + '" ' +
                  'data-name="' + esc(hit.host || c.mac || '') + '">断开</button>'
                : '') +
            '</div>';
          }).join('');
          blocks.push('<div class="group"><div class="group-title">' +
            esc(ic.ssid || ifname) + ' · ' + esc(ifname) + ' · ' + list.length + ' 台</div>' +
            '<div class="group-card">' + (rows || '<div class="cell"><span class="cell-desc">暂无设备连接</span></div>') + '</div></div>');
        }
      }
      if (!blocks.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">无线客户端</div><div class="empty">没有可查询的接入点</div></div>';
        return;
      }
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">无线客户端</div>' +
        '<div class="page-sub">当前共 ' + total + ' 台设备连接' + (canKick ? ' · 点「断开」可强制踢下线' : '') + '</div>' +
        blocks.join('') +
        '<button class="btn btn-secondary" data-action="refresh" style="margin-top:12px">刷新</button></div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  kickClient(ifname, mac, name) {
    confirmModal('断开无线设备',
      '将把 ' + name + '（' + mac + '）从 ' + ifname + ' 上踢下线。设备会自动重连，除非勾选了拉黑。',
      '断开', async () => {
        try {
          await Ubus.call('hostapd.' + ifname, 'del_client', { addr: mac, deauth: true, ban_time: 0 });
          toast('已断开 ' + name);
          setTimeout(() => this.renderClients(), 1200);
        } catch (e) {
          toast('断开失败：' + (e.message || '未知错误'), true);
        }
      }, 'destructive');
  },

  /* ================= 连接跟踪 ================= */
  async renderConntrack() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const r = await Ubus.call('luci', 'getConntrackList', {});
      const arr = (r && r.result) || [];
      if (!arr.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">连接跟踪</div><div class="empty">当前没有活动的连接</div></div>';
        return;
      }
      // 按流量排序，取前 80 条；总数单独展示，避免一次渲染几百行
      const sorted = arr.slice().sort((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0));
      const top = sorted.slice(0, 80);
      const proto = {};
      arr.forEach(x => { proto[x.layer4 || 'other'] = (proto[x.layer4 || 'other'] || 0) + 1; });
      const protoText = Object.keys(proto).map(k => k.toUpperCase() + ' ' + proto[k]).join(' · ');
      const rows = top.map(c => {
        const from = (c.src || '') + (c.sport ? ':' + c.sport : '');
        const to = (c.dst || '') + (c.dport ? ':' + c.dport : '');
        return '<div class="cell">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(to) + '</span>' +
              '<span class="badge off">' + esc(String(c.layer4 || '').toUpperCase()) + '</span>' +
              '<span class="cell-value" style="flex:0 0 auto;max-width:none">' + fmtBytes(Number(c.bytes) || 0) + '</span>' +
            '</div>' +
            '<div class="cell-desc">来源 ' + esc(from) + ' · ' + esc(String(c.timeout || '—')) + ' 秒后超时</div>' +
          '</div>' +
        '</div>';
      }).join('');
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">连接跟踪</div>' +
        '<div class="page-sub">共 ' + arr.length + ' 条活动连接 · ' + esc(protoText) + '</div>' +
        '<div class="group"><div class="group-title">按流量排序（前 ' + top.length + ' 条）</div>' +
        '<div class="group-card">' + rows + '</div></div>' +
        '<button class="btn btn-secondary" data-action="refresh">刷新</button></div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* ================= 进程 ================= */
  async renderProcesses() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const sort = this.state.procSort || 'cpu';
      const [r, cpu] = await Promise.all([
        Ubus.call('luci', 'getProcessList', {}),
        Ubus.call('luci', 'getCPUUsage', {}).catch(() => null)
      ]);
      const arr = (r && r.result) || [];
      this.state.procData = arr;
      if (!arr.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">进程</div><div class="empty">拿不到进程列表</div></div>';
        return;
      }
      const key = sort === 'mem' ? '%MEM' : '%CPU';
      const sorted = arr.slice().sort((a, b) => (parseFloat(b[key]) || 0) - (parseFloat(a[key]) || 0));
      const top = sorted.slice(0, 60);
      const seg = (v, label) => '<button data-action="proc-sort" data-value="' + v + '" class="' + (sort === v ? 'active' : '') + '">' + label + '</button>';
      const rows = top.map(p => {
        const cpuV = String(p['%CPU'] || '0%');
        const memV = String(p['%MEM'] || '0%');
        return '<div class="cell">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(short(p.COMMAND || '', 34)) + '</span>' +
              '<span class="cell-value" style="flex:0 0 auto;max-width:none">' + esc(sort === 'mem' ? memV : cpuV) + '</span>' +
            '</div>' +
            '<div class="cell-desc">PID ' + esc(String(p.PID || '—')) + ' · ' + esc(String(p.USER || '')) +
              ' · 内存 ' + esc(memV) + ' · CPU ' + esc(cpuV) + ' · VSZ ' + esc(String(p.VSZ || '—')) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">进程</div>' +
        '<div class="page-sub">共 ' + arr.length + ' 个进程' +
          (cpu && cpu.cpuusage ? ' · 当前 CPU 占用 ' + esc(cpu.cpuusage) : '') + '</div>' +
        '<div class="cell"><div style="width:100%"><div class="segmented">' +
          seg('cpu', '按 CPU') + seg('mem', '按内存') + '</div></div></div>' +
        '<div class="group-card" style="margin-top:10px">' + rows + '</div>' +
        '<button class="btn btn-secondary" data-action="refresh" style="margin-top:12px">刷新</button></div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* ================= 存储 / USB ================= */
  async renderStorage() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const [mounts, blocks, usb] = await Promise.all([
        Ubus.call('luci', 'getMountPoints', {}).catch(() => null),
        Ubus.call('luci', 'getBlockDevices', {}).catch(() => null),
        Ubus.call('luci', 'getUSBDevices', {}).catch(() => null)
      ]);
      const mlist = (mounts && mounts.result) || [];
      const mrows = mlist.map(m => {
        const size = Number(m.size) || 0, free = Number(m.free) || Number(m.avail) || 0;
        const pct = size ? Math.round((size - free) / size * 100) : 0;
        return '<div class="cell">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(m.mount || '—') + '</span>' +
              '<span class="cell-value" style="flex:0 0 auto;max-width:none">' + fmtBytes(size) + '</span>' +
            '</div>' +
            '<div class="cell-desc">' + esc(m.device || '') + ' · 已用 ' + fmtBytes(size - free) +
              ' / 可用 ' + fmtBytes(free) + (size ? '（' + pct + '%）' : '') + '</div>' +
            (size ? '<div class="progress" style="margin-top:6px"><i class="' +
              (pct > 90 ? 'high' : pct > 70 ? 'mid' : 'low') + '" style="width:' + Math.min(pct, 100) + '%"></i></div>' : '') +
          '</div>' +
        '</div>';
      }).join('');
      const brows = Object.keys(blocks || {}).map(k => {
        const b = blocks[k];
        return '<div class="cell"><span class="cell-label">' + esc(b.dev || k) + '</span>' +
          '<span class="cell-value">' + esc(b.type || '') + ' · ' + fmtBytes(Number(b.size) || 0) +
          (b.mount ? ' · ' + esc(b.mount) : '') + '</span></div>';
      }).join('');
      const devs = (usb && usb.devices) || [];
      const ports = (usb && usb.ports) || [];
      const urows = devs.length
        ? devs.map(d => '<div class="cell"><span class="cell-label">' + esc(d.name || d.dev || 'USB 设备') + '</span>' +
            '<span class="cell-value">' + esc(d.vendor || '') + ' ' + esc(d.product || '') + '</span></div>').join('')
        : '<div class="cell"><span class="cell-desc">没有检测到 USB 设备（共 ' + ports.length + ' 个端口）</span></div>';

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">存储 / USB</div>' +
        '<div class="page-sub">' + mlist.length + ' 个挂载点 · ' +
          Object.keys(blocks || {}).length + ' 个块设备</div>' +
        '<div class="group"><div class="group-title">挂载点</div><div class="group-card">' +
          (mrows || '<div class="cell"><span class="cell-desc">无挂载信息</span></div>') + '</div></div>' +
        '<div class="group"><div class="group-title">块设备</div><div class="group-card">' +
          (brows || '<div class="cell"><span class="cell-desc">无块设备信息</span></div>') + '</div></div>' +
        '<div class="group"><div class="group-title">USB</div><div class="group-card">' + urows + '</div></div>' +
        '</div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* ================= 指示灯 ================= */
  async renderLeds() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const leds = await Ubus.call('luci', 'getLEDs', {});
      const names = Object.keys(leds || {});
      if (!names.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">指示灯</div><div class="empty">没有可控制的指示灯</div></div>';
        return;
      }
      const rows = names.map(n => {
        const l = leds[n] || {};
        return '<div class="cell">' +
          '<div style="flex:1;min-width:0">' +
            '<div class="cell-label" style="font-weight:600">' + esc(n) + '</div>' +
            '<div class="cell-desc">当前触发方式: ' + esc(l.active_trigger || '—') + '</div>' +
            '<div class="cell-desc">可用: ' + esc((l.triggers || []).join(' ')) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">指示灯</div>' +
        '<div class="page-sub">共 ' + names.length + ' 个 · 只读（修改需要 LuCI）</div>' +
        '<div class="group-card">' + rows + '</div></div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* ================= 动态 DNS ================= */
  /* 状态来自 luci.ddns.get_services_status（只读）；
     配置本体在 /etc/config/ddns 里，可以正常读写。 */
  async renderDdns() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const [status, env, res] = await Promise.all([
        Ubus.call('luci.ddns', 'get_services_status', {}),
        Ubus.call('luci.ddns', 'get_env', {}).catch(() => null),
        Ubus.call('uci', 'get', { config: 'ddns' }).catch(() => null)
      ]);
      const values = (res && res.values) || {};
      const services = Uci.sectionsOfType(values, 'service');
      const canWrite = Ubus.can('uci', 'set');

      const rows = Object.keys(services).map(name => {
        const s = services[name];
        const st = status[name] || {};
        const state = st.next_update === 'Stopped' ? '已停止'
          : (st.pid ? '运行中' : (st.next_update ? '等待更新' : '未知'));
        return '<div class="cell' + (canWrite ? ' cell-clickable' : '') + '"' +
          (canWrite ? ' data-action="ddns-edit" data-section="' + esc(name) + '"' : '') + '>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(s.domain || name) + '</span>' +
              '<span class="badge ' + (st.pid ? 'on' : 'off') + '">' + esc(state) + '</span>' +
            '</div>' +
            '<div class="cell-desc">' + esc(s.service_name || '') + ' · 接口 ' + esc(s.interface || '—') + '</div>' +
            '<div class="cell-desc">当前 IP: ' + esc(st.ip || '—') +
              (st.last_update ? ' · 上次更新 ' + esc(String(st.last_update)) : '') + '</div>' +
          '</div>' + (canWrite ? ICONS.chevron : '') +
        '</div>';
      }).join('');

      const envText = env ? ['wget', 'curl', 'ssl', 'proxy', 'dnsserver', 'ipv6']
        .map(k => (env['has_' + k] ? '✔' : '✘') + ' ' + k).join('  ') : '';

      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">动态 DNS</div>' +
        '<div class="page-sub">' + Object.keys(services).length + ' 条服务配置</div>' +
        '<div class="group-card">' + (rows || '<div class="cell"><span class="cell-desc">还没有配置动态 DNS</span></div>') + '</div>' +
        (canWrite ? '<button class="btn btn-secondary" data-action="ddns-add" style="margin-top:10px">＋ 添加动态 DNS</button>' : '') +
        (envText ? '<div class="group-title" style="margin-top:18px">运行环境</div>' +
          '<div class="cell-desc" style="padding:0 4px">' + esc(envText) + '</div>' : '') +
        '<div class="group-title" style="margin-top:16px">提示</div>' +
        '<div class="cell-desc" style="padding:0 4px">动态 DNS 需要先在域名商处配置好 DDNS 服务，再填入域名、账号和密钥。</div>' +
        '</div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  ddnsFields(v) {
    return [
      { key: 'enabled', label: '启用该服务', type: 'switch', value: (v.enabled === '0' || v.enabled === false) ? '0' : '1' },
      { key: 'service_name', label: '服务商', value: v.service_name || '', placeholder: '例如 dyndns.org / no-ip.com' },
      { key: 'domain', label: '域名', value: v.domain || '', placeholder: 'yourhost.example.com' },
      { key: 'username', label: '账号 / 密钥 ID', value: v.username || '' },
      { key: 'password', label: '密码 / 密钥', type: 'password', value: v.password || '' },
      { key: 'interface', label: '监控接口', value: v.interface || 'wan', placeholder: 'wan' },
      { key: 'ip_source', label: 'IP 来源', type: 'select', value: v.ip_source || 'network',
        options: [{ value: 'network', label: '从接口取' }, { value: 'web', label: '从网页取' }, { value: 'interface', label: '按接口地址' }] }
    ];
  },

  buildDdns(vals) {
    const out = {
      enabled: vals.enabled === '1' ? '1' : '0',
      service_name: String(vals.service_name || '').trim() || null,
      domain: String(vals.domain || '').trim() || null,
      username: String(vals.username || '').trim() || null,
      password: vals.password || null,
      interface: String(vals.interface || '').trim() || null,
      ip_source: vals.ip_source || 'network'
    };
    return out;
  },

  async editDdns(section) {
    try {
      const res = await Ubus.call('uci', 'get', { config: 'ddns', section: section });
      const v = ((res && res.values) || {})[section] || {};
      formModal('动态 DNS · ' + (v.domain || section), this.ddnsFields(v), vals => {
        if (!String(vals.domain || '').trim()) { toast('域名不能为空', true); return; }
        this.confirmOps('保存动态 DNS', '保存后会重新加载 ddns 服务并立即尝试一次更新。', '保存', {
          config: 'ddns', sets: { [section]: this.buildDdns(vals) }, after: () => this.renderDdns()
        });
      }, {
        okText: '保存',
        danger: {
          text: '删除',
          onClick: () => this.deleteSection({
            title: '删除动态 DNS', text: '将删除 ' + (v.domain || section) + ' 这条配置。',
            config: 'ddns', section: section, after: () => this.renderDdns()
          })
        }
      });
    } catch (e) { toast(e.message || '读取失败', true); }
  },

  addDdns() {
    formModal('添加动态 DNS', this.ddnsFields({ interface: 'wan', ip_source: 'network' }), vals => {
      if (!String(vals.domain || '').trim()) { toast('域名不能为空', true); return; }
      this.confirmOps('添加动态 DNS', '将新增一条 DDNS 配置并启动服务。', '添加', {
        config: 'ddns',
        adds: [{ type: 'service', values: this.buildDdns(vals) }],
        after: () => this.renderDdns()
      });
    }, { okText: '添加' });
  },

  /* ================= UPnP 映射 ================= */
  async renderUpnp() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const st = await Ubus.call('luci.upnp', 'get_status', {});
      const rules = (st && st.rules) || [];
      const canDel = Ubus.can('luci.upnp', 'delete_rule');
      const rows = rules.map(r => {
        // 不同版本字段名不完全一致，尽量兼容
        const ext = r.eport || r.external_port || r.ExtPort || '';
        const int = r.iport || r.internal_port || r.IntPort || '';
        const to = r.ipend || r.internal_client || r.IntClient || '';
        const proto = r.proto || r.Proto || '';
        const desc = r.desc || r.Desc || '';
        const id = r.id || r.Id || r.ID || '';
        return '<div class="cell">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:baseline;gap:8px">' +
              '<span class="cell-label" style="font-weight:600">' + esc(desc || ('端口 ' + ext)) + '</span>' +
              '<span class="badge on">' + esc(String(proto).toUpperCase()) + '</span>' +
            '</div>' +
            '<div class="cell-desc">外部 ' + esc(String(ext)) + ' → ' + esc(to) + ':' + esc(String(int)) + '</div>' +
          '</div>' +
          (canDel && id
            ? '<button class="modal-btn cell-action destructive" data-action="upnp-del" data-id="' + esc(String(id)) +
              '" data-desc="' + esc(desc || ('端口 ' + ext)) + '">删除</button>'
            : '') +
        '</div>';
      }).join('');
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">UPnP 映射</div>' +
        '<div class="page-sub">共 ' + rules.length + ' 条自动映射' + (canDel ? ' · 可删除' : ' · 只读') + '</div>' +
        '<div class="group-card">' + (rows || '<div class="cell"><span class="cell-desc">当前没有 UPnP 自动端口映射</span></div>') + '</div>' +
        '<button class="btn btn-secondary" data-action="refresh" style="margin-top:12px">刷新</button>' +
        '<div class="cell-desc" style="padding:12px 4px 0">这些映射由内网程序（游戏、下载工具等）通过 UPnP 自动申请，' +
        '不想要的可以在这里删掉；想手动固定端口请用「防火墙 → 端口转发」。</div>' +
        '</div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* ================= WireGuard ================= */
  async renderWireguard() {
    $('#view').innerHTML = '<div class="page pt no-tab">' + this.spinner() + '</div>';
    try {
      const inst = await Ubus.call('luci.wireguard', 'getWgInstances', {});
      const names = Object.keys(inst || {});
      if (!names.length) {
        $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">WireGuard</div><div class="empty">还没有 WireGuard 接口</div></div>';
        return;
      }
      const blocks = names.map(n => {
        const cfg = inst[n] || {};
        const peers = cfg.peers || cfg.instances || [];
        const rows = (Array.isArray(peers) ? peers : Object.keys(peers).map(k => peers[k])).map(p =>
          '<div class="cell">' +
            '<div style="flex:1;min-width:0">' +
              '<div class="cell-label" style="font-weight:600">' + esc(p.description || p.name || p.public_key || '节点') + '</div>' +
              '<div class="cell-desc">' + esc(p.endpoint_host || p.endpoint || '未指定端点') +
                (p.allowed_ips ? ' · ' + esc(listToText(p.allowed_ips)) : '') + '</div>' +
            '</div>' +
          '</div>').join('');
        return '<div class="group"><div class="group-title">' + esc(n) + '</div><div class="group-card">' +
          '<div class="cell"><span class="cell-label">本端地址</span><span class="cell-value">' +
            esc(listToText(cfg.addresses || cfg.address) || '—') + '</span></div>' +
          (rows || '<div class="cell"><span class="cell-desc">没有对端</span></div>') + '</div></div>';
      }).join('');
      $('#view').innerHTML =
        '<div class="page pt no-tab"><div class="page-title">WireGuard</div>' +
        '<div class="page-sub">' + names.length + ' 个接口 · 只读</div>' + blocks +
        '<button class="btn btn-secondary" data-action="refresh" style="margin-top:12px">刷新</button></div>';
      this.updateStatus();
    } catch (e) {
      this.detailError(e);
    }
  },

  /* ================= 系统日志 =================
     ubus 的 log 对象（log.read）不在标准 OpenWrt 的默认 ACL 里，
     这台 ImmortalWrt 就拿不到 —— 那种情况下 pages() 里的探测会失败，
     「系统日志」入口会自动从菜单里消失，不会点进去报错。
     能拿到日志的固件上按级别标色显示。 */
  async renderLogs() {
    $('#view').innerHTML = this.spinner();
    try {
      const r = await Ubus.call('log', 'read', { lines: 300 });
      const lines = (r && r.log) || [];
      if (!lines.length) {
        $('#view').innerHTML = '<div class="page pt"><div class="page-title">系统日志</div>' +
          '<div class="empty">日志为空</div></div>';
        return;
      }
      const rows = lines.slice(-300).map(l => {
        const t = String(l).trim();
        const cls = /error|fail|denied|panic|critical/i.test(t) ? ' log-err'
                  : /warn/i.test(t) ? ' log-warn' : '';
        return '<div class="log-line' + cls + '">' + esc(t) + '</div>';
      }).join('');
      $('#view').innerHTML = '<div class="page pt"><div class="page-title">系统日志</div>' +
        '<div class="page-sub">最近 ' + lines.length + ' 行 · 支持 log.read 的固件才有这一页</div>' +
        '<div class="group-card log-box">' + rows + '</div>' +
        '<button class="btn btn-secondary" data-action="refresh" style="margin-top:14px">刷新日志</button></div>';
    } catch (e) {
      this.detailError(e);
    }
  },

  spinner() {
    return '<div class="skeleton" style="height:120px;border-radius:16px"></div><div class="skeleton" style="height:120px;border-radius:12px;margin-top:16px"></div>';
  },
  detailError(e) {
    $('#view').innerHTML = '<div class="page pt no-tab"><div class="page-title">详情</div><div class="empty">' + esc(e.message || '加载失败') + '</div>' +
      '<button class="btn btn-primary" data-action="refresh" style="margin-top:12px">重试</button></div>';
  },

  /* ================= 设置页 ================= */
  renderSettings(firstTime) {
    const conns = Store.data.connections;
    const connRows = conns.length ? conns.map(c => {
      const active = Store.active && Store.active.id === c.id;
      return '<div class="cell cell-clickable" data-action="select-conn" data-id="' + c.id + '">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="cell-label" style="font-weight:600">' + esc(c.name) + (active ? ' <span class="badge on">当前</span>' : '') + '</div>' +
          '<div class="cell-desc">' + esc(c.url) + '</div>' +
        '</div>' +
        '<button class="modal-btn cell-action accent" data-action="edit-conn" data-id="' + c.id + '">编辑</button>' +
        '<button class="modal-btn cell-action destructive" data-action="del-conn" data-id="' + c.id + '">删除</button>' +
      '</div>';
    }).join('') : '<div class="cell"><span class="cell-label cell-danger">暂无连接，点击下方添加</span></div>';

    const modeBtns = Object.entries(MODES).map(([k, m]) =>
      '<button data-action="set-mode" data-value="' + k + '" class="' + (Store.data.mode === k ? 'active' : '') + '">' + m.label + '</button>'
    ).join('');

    let tsCard = '';
    if (Store.data.mode === 'tailscale') {
      const ts = tailscaleNative();
      if (ts) {
        tsCard = '<div class="cell"><span class="cell-label">手机 Tailscale</span><span class="badge ' + (ts.connected ? 'on' : 'off') + '">' + (ts.connected ? '已连接' : '未连接') + '</span></div>' +
          (ts.ips && ts.ips.length ? '<div class="cell"><span class="cell-label">本机 Tailscale IP</span><span class="cell-value">' + esc(ts.ips.join('、')) + '</span></div>' : '') +
          '<div class="cell"><span class="cell-desc">请先在手机开启 Tailscale 网络；登录路由器后 App 会自动识别其 100.x 地址并询问保存。</span></div>';
      } else {
        tsCard = '<div class="cell"><span class="cell-desc">Tailscale 状态检测仅在 APK 内可用（网页版显示不可用）；登录路由器后仍会自动识别其 Tailscale 地址。</span></div>';
      }
    }

    // 选了「局域网直连」才出现：手机在哪个网段、网关是谁，扫一下就知道路由器在哪儿。
    const lanScanRow = Store.data.mode === 'lan'
      ? '<div class="cell cell-clickable" data-action="lan-scan">' +
          '<div style="flex:1;min-width:0">' +
            '<span class="cell-label">自动获取地址</span>' +
            '<div class="cell-desc">' + (this.scanning ? '正在扫描本机网关与常见网段…' : '跳过手填，自动找到路由器的管理地址') + '</div>' +
          '</div>' +
          '<span class="cell-value">' + (this.scanning ? '扫描中' : '扫描') + '</span>' +
        '</div>'
      : '';

    const themeBtns = [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']].map(([k, label]) =>
      '<button data-action="set-theme" data-value="' + k + '" class="' + (Store.data.theme === k ? 'active' : '') + '">' + label + '</button>'
    ).join('');

    // 语言三档。『跟随软路由』会去读 /etc/config/luci 的 main.lang（见 i18n.js），
    // 所以换一台中文路由器回来就自动变中文，不用手动切。
    const langBtns = [['router', '跟随软路由'], ['zh', '中文'], ['en', 'English']].map(([k, label]) =>
      '<button data-action="set-lang" data-value="' + k + '" class="' + (Store.data.lang === k ? 'active' : '') + '">' + label + '</button>'
    ).join('');
    const langHint = Store.data.lang === 'router'
      ? '当前按路由器设置的语言显示' + (Lang.routerLang ? '（' + (Lang.routerLang === 'zh' ? '中文' : 'English') + '）' : '，登录后自动识别')
      : '固定使用' + (Store.data.lang === 'zh' ? '中文' : '英文');

    $('#view').innerHTML =
      '<div class="page pt"><div class="page-title">设置</div>' +
      '<div class="group"><div class="group-title">连接</div><div class="group-card">' + connRows + '</div>' +
        '<button class="btn btn-secondary" data-action="add-conn" style="margin-top:10px">＋ 添加连接</button>' +
      '</div>' +
      '<div class="group"><div class="group-title">连接方式</div><div class="group-card"><div class="cell"><div style="width:100%"><div class="segmented">' + modeBtns + '</div><div class="cell-desc" style="margin-top:8px">' + esc(MODES[Store.data.mode].hint) + '</div></div></div>' +
        lanScanRow + tsCard + '</div>' +
      '<div class="group"><div class="group-title">账号</div><div class="group-card">' +
        '<div class="cell"><span class="cell-label">用户名</span><input class="cell-input" data-param="username" value="' + esc(Store.data.username) + '" placeholder="root"></div>' +
        '<div class="cell"><span class="cell-label">密码</span><input class="cell-input" data-param="password" type="password" value="' + esc(Store.data.password) + '" placeholder="OpenWrt 登录密码"></div>' +
        '<div class="cell"><span class="cell-label">本地记住密码</span><label class="switch"><input type="checkbox" data-param="rememberPassword" ' + (Store.data.rememberPassword ? 'checked' : '') + '><span class="track"></span><span class="thumb"></span></label></div>' +
      '</div>' +
      '<div class="group-title" style="margin-top:10px">密码保存在本机 App 内（明文），请勿在共享设备使用</div></div>' +
      '<div class="group"><div class="group-title">外观</div><div class="group-card"><div class="cell"><div style="width:100%"><div class="segmented">' + themeBtns + '</div></div></div></div></div>' +
      '<div class="group"><div class="group-title">语言</div><div class="group-card"><div class="cell"><div style="width:100%"><div class="segmented">' + langBtns + '</div><div class="cell-desc" style="margin-top:8px">' + esc(langHint) + '</div></div></div></div></div>' +
      '<div class="group"><div class="group-title">数据</div><div class="group-card">' +
        '<div class="cell cell-clickable" data-action="clear-data"><span class="cell-label cell-danger">清除所有设置与密码</span></div>' +
      '</div></div>' +
      '</div>';
  },

  /* ================= 事件 ================= */
  bindEvents() {
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('input', e => this.onInput(e));
    document.addEventListener('change', e => this.onChange(e));

    // 下拉刷新。挂在 #view 上而不是 window，这样底栏、弹窗上的手势不会误触发。
    // touchmove 必须 passive:false —— 只有这样才能 preventDefault 拦住原生滚动。
    const view = $('#view');
    if (view && window.TouchEvent) {
      view.addEventListener('touchstart', e => this.ptrStart(e), { passive: true });
      view.addEventListener('touchmove', e => this.ptrMove(e), { passive: false });
      view.addEventListener('touchend', () => this.ptrEnd(), { passive: true });
      view.addEventListener('touchcancel', () => this.ptrEnd(), { passive: true });
    }

    // 底栏的「拖动选中块」。move/up 挂在 window 上：
    // 手指滑出胶囊范围（甚至滑到屏幕边缘）时事件不能丢，否则滑块会卡在半路。
    const bar = $('#tabbar');
    if (bar && window.PointerEvent) {
      bar.addEventListener('pointerdown', e => this.tabDragStart(e));
      window.addEventListener('pointermove', e => this.tabDragMove(e));
      window.addEventListener('pointerup', e => this.tabDragEnd(e));
      window.addEventListener('pointercancel', e => this.tabDragEnd(e));
    }
  },

  onClick(e) {
    // ① 底部 Tab 切换：tab-item 上只有 data-tab、没有 data-action，
    //    必须放在下面 [data-action] 守卫之前，否则会被提前 return 掉、Tab 永远切不动。
    const tabEl = e.target.closest('.tab-item');
    if (tabEl && tabEl.dataset.tab) {
      // 刚刚是用拖的？那 click 是拖动的副产物，忽略掉，否则会切两次
      if (this.dragSwallow && Date.now() - this.dragSwallow < 500) { this.dragSwallow = 0; return; }
      this.tabActivate(tabEl.dataset.tab);
      return;
    }

    // ② 其余按钮走 data-action
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    const id = el.dataset.id;
    switch (act) {
      case 'back': this.closeDetail(); break;
      case 'refresh':
        if (this.state.webPage) {
          // 路由器页面用原生侧的 WebView 刷新，而不是重渲染 App 自己的页面
          const nb = nativeBridge();
          if (nb && nb.webReload) nb.webReload();
        } else if (this.state.detail) this.renderDetail(this.state.detail);
        else if (this.state.tab === 'overview') this.renderOverview();
        break;
      case 'retry-overview': this.renderOverview(); break;
      case 'goto-settings': this.showSettings(); break;
      case 'open-detail': this.openDetail(id); break;
      case 'open-menu-net': this.setTab('menu'); break;
      case 'add-conn': this.addConn(); break;
      case 'edit-conn': this.editConn(id); break;
      case 'del-conn': this.delConn(id); break;
      case 'select-conn':
        if (Store.data.activeConnectionId === id) break;   // 点当前项不做事
        Store.data.activeConnectionId = id; Store.save();
        this.connectActive({ force: true });   // 换了目标必须重登（旧 session 属于旧路由器）
        break;
      case 'lan-scan': this.lanScan(); break;
      case 'set-mode':
        Store.data.mode = el.dataset.value; Store.save();
        this.renderSettings();
        break;
      case 'set-theme':
        Store.data.theme = el.dataset.value; Store.save(); this.applyTheme();
        this.renderSettings();
        break;
      case 'set-lang':
        Lang.set(el.dataset.value);
        // 语言变了整屏都要重画：底栏标签是静态 HTML、其余是渲染出来的，
        // 两边都得跟着换，不能只翻当前这一屏
        this.syncStaticText();
        this.renderSettings();
        break;
      case 'clear-data': this.clearData(); break;
      case 'act-reload':
        this.confirmAct('重启网络', '将重新加载网络配置，可能导致短暂断网。', '重启网络',
          () => Ubus.can('network', 'reload')
            ? Ubus.call('network', 'reload', {})
            : Ubus.call('rc', 'init', { name: 'network', action: 'reload' }));
        break;
      case 'act-reboot': this.confirmAct('重启路由器', '路由器将立即重启，远程连接会中断。', '重启', () => Ubus.call('system', 'reboot', {})); break;
      case 'act-poweroff': this.confirmAct('关机', '路由器将直接关机，需要手动开机才能恢复连接！', '关机', () => Ubus.call('system', 'poweroff', {})); break;

      /* ---- 网络接口 ---- */
      case 'net-edit': this.editNetIface(el.dataset.section); break;

      /* ---- 无线 ---- */
      case 'wifi-radio-edit': this.editRadio(el.dataset.section); break;
      case 'wifi-edit': this.editWifiIface(el.dataset.section); break;
      case 'wifi-add': this.addWifi(); break;
      case 'wifi-scan': this.openSub('wifiscan', '周边 WiFi'); break;

      /* ---- 主机 / DHCP ---- */
      case 'dhcp-srv-edit': this.editDhcpServer(el.dataset.section); break;
      case 'dhcp-host-edit': this.editDhcpHost(el.dataset.section); break;
      case 'dhcp-host-add': this.editDhcpHost(''); break;
      case 'dhcp-fix': {
        // 从一条租约直接生成静态分配：主机名可能是占位文案，要滤掉
        const n = el.dataset.name || '';
        this.editDhcpHost('', {
          name: (n && n !== '（无主机名）') ? n : '',
          mac: el.dataset.mac || '', ip: el.dataset.ip || ''
        });
        break;
      }

      /* ---- 防火墙 ---- */
      case 'fw-defaults-edit': this.editFwDefaults(); break;
      case 'fw-zone-edit': this.editFwZone(el.dataset.section); break;
      case 'fw-zone-add': this.addFwZone(); break;
      case 'fw-rule-edit': this.editFwRule(el.dataset.section); break;
      case 'fw-rule-add': this.addFwRule(); break;
      case 'fw-rule-toggle':
        this.toggleOption({
          title: el.dataset.value === '1' ? '启用规则' : '停用规则',
          text: '改动会立即重载防火墙。',
          config: 'firewall', section: el.dataset.section, option: 'enabled',
          on: el.dataset.value, after: () => this.renderFirewall()
        });
        break;
      case 'fw-forward-del':
        this.deleteSection({
          title: '删除区域转发',
          text: '将删除这条「来源 → 目标」的转发放行。',
          config: 'firewall', section: el.dataset.section, after: () => this.renderFirewall()
        });
        break;
      case 'fw-rd-edit': this.editFwRedirect(el.dataset.section); break;
      case 'fw-rd-add': this.addFwRedirect(); break;

      /* ---- 系统 ---- */
      case 'sys-basic-edit': this.editSystemBasic(); break;
      case 'sys-ntp-edit': this.editSystemNtp(); break;
      case 'sys-passwd': this.changePassword(); break;

      /* ---- 路由器原生页面 ---- */
      case 'open-luci':
        this.openWebPage({
          id: el.dataset.id || el.dataset.path || el.dataset.url,
          path: el.dataset.path, url: el.dataset.url, title: el.dataset.title
        });
        break;
      case 'open-luci-group':
        this.openSub('luci:' + el.dataset.name, el.dataset.title);
        break;

      /* ---- 服务管理 ---- */
      case 'svc-open': this.openSub('svc:' + el.dataset.section, el.dataset.section); break;
      case 'svc-act': this.svcAction(el.dataset.section, el.dataset.value); break;

      /* ---- 无线客户端 ---- */
      case 'wifi-kick': this.kickClient(el.dataset.ifname, el.dataset.mac, el.dataset.name); break;

      /* ---- 进程排序 ---- */
      case 'proc-sort':
        this.state.procSort = el.dataset.value;
        this.renderProcesses();
        break;

      /* ---- 动态 DNS ---- */
      case 'ddns-edit': this.editDdns(el.dataset.section); break;
      case 'ddns-add': this.addDdns(); break;

      /* ---- UPnP ---- */
      case 'upnp-del':
        confirmModal('删除 UPnP 映射',
          '将删除自动映射「' + (el.dataset.desc || el.dataset.id) + '」，对应内网程序的外部端口会立即失效。',
          '删除', async () => {
            try {
              await Ubus.call('luci.upnp', 'delete_rule', { id: el.dataset.id });
              toast('已删除');
              setTimeout(() => this.renderUpnp(), 800);
            } catch (e) {
              toast('删除失败：' + (e.message || '未知错误'), true);
            }
          }, 'destructive');
        break;

      case 'tab-click': break;
    }
  },

  onInput(e) {
    const el = e.target.closest('[data-param]');
    if (!el) return;
    const key = el.dataset.param;
    if (key === 'username' || key === 'password' || key === 'rememberPassword') {
      Store.data[key] = el.type === 'checkbox' ? el.checked : el.value;
      Store.save();
      Ubus.session = '';      // 凭据变了，当前会话不再可信，下次进主界面时重新登录
    }
  },

  onChange(e) {
    const el = e.target.closest('[data-param]');
    if (!el) return;
    if (el.dataset.param === 'rememberPassword') {
      Store.data.rememberPassword = el.checked;
      if (!el.checked) Store.data.password = '';
      Store.save();
      this.renderSettings();
    }
  },

  addConn() {
    formModal('添加连接', [
      { key: 'name', placeholder: '名称，如：家里软路由', value: '' },
      { key: 'url', placeholder: MODES[Store.data.mode].placeholder, value: this.guessUrl() }
    ], vals => {
      if (!vals.url) { toast('请填写管理地址', true); return; }
      if (!/^https?:\/\//i.test(vals.url)) vals.url = 'http://' + vals.url;
      const conn = { id: 'c' + Date.now(), name: vals.name || vals.url, url: vals.url.replace(/\/+$/, '') };
      Store.data.connections.push(conn);
      Store.data.activeConnectionId = conn.id;
      Store.save();
      this.connectActive({ force: true });   // 新建即激活，直接连上去
    });
  },

  editConn(id) {
    const c = Store.data.connections.find(x => x.id === id);
    if (!c) return;
    formModal('编辑连接', [
      { key: 'name', placeholder: '名称', value: c.name },
      { key: 'url', placeholder: '管理地址', value: c.url }
    ], vals => {
      if (!vals.url) { toast('请填写管理地址', true); return; }
      const wasActive = Store.data.activeConnectionId === c.id;
      c.name = vals.name || vals.url;
      c.url = vals.url.replace(/\/+$/, '');
      Store.save();
      if (wasActive) {
        this.connectActive({ force: true });   // 地址可能变了：旧会话与旧地址都作废，重连
      } else {
        this.renderSettings();
        toast('已保存');
      }
    });
  },

  delConn(id) {
    confirmModal('删除连接', '删除后需要重新填写地址与账号。', '删除', () => {
      const list = Store.data.connections;
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return;
      const wasActive = Store.data.activeConnectionId === id;
      list.splice(i, 1);
      if (wasActive) Store.data.activeConnectionId = list.length ? list[0].id : null;
      Store.save();
      toast('已删除');
      if (wasActive) this.connectActive({ force: true });   // 自动切到剩余连接；一个不剩则回到设置页
      else this.renderSettings();
    }, 'destructive');
  },

  clearData() {
    confirmModal('清除所有数据', '将删除全部连接、账号和本地保存的密码。', '清除', () => {
      Store.clear();
      location.reload();
    }, 'destructive');
  },

  confirmAct(title, text, okText, fn) {
    confirmModal(title, text, okText, async () => {
      try {
        await fn();
        toast('指令已发送');
        setTimeout(() => this.renderSystem(), 800);
      } catch (e) {
        toast(e.message || '操作失败', true);
      }
    }, 'destructive');
  },

  guessUrl() {
    const m = Store.data.mode;
    if (m === 'tailscale') return 'http://100.';
    if (m === 'lan') return 'http://192.168.1.1';
    return 'http://';
  },

  showSettings(fromRoute) {
    this.nextSeq();
    this.state.phase = 'settings';
    this.closeWebPage();
    this.state.detail = null;
    this.stopRate();
    $('#nav').classList.remove('hidden');
    $('#tabbar').classList.remove('hidden');
    document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'settings'));
    $('#nav-title').textContent = '设置';
    $('#nav-back').classList.add('hidden');
    $('#nav-action').classList.add('placeholder');
    this.updateStatus();
    requestAnimationFrame(() => this.moveGlider('settings'));
    this.renderSettings(fromRoute);
  }
};

/* ================= 启动 ================= */
document.addEventListener('DOMContentLoaded', () => App.boot());
