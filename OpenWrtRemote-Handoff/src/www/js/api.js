'use strict';

/* ================= OpenWrt ubus JSON-RPC 客户端 ================= */

function FriendlyError(message) {
  this.message = message;
  this.name = 'FriendlyError';
}
FriendlyError.prototype = Object.create(Error.prototype);

const Ubus = {
  /* baseUrl 每次实时从「当前激活连接」解析，不缓存副本。
     历史实现把它复制到一个 baseUrl 字段，但设置页的
     添加 / 编辑 / 切换 / 删除连接都没有同步这个副本，
     导致地址配好了运行时仍拿着空串去请求，拼出 file:///ubus，
     报错就成了「无法连接到 （空）」。改成单数据源后这类脱节不可能再发生。 */
  get baseUrl() {
    try {
      const c = (typeof Store !== 'undefined' && Store) ? Store.active : null;
      return c && c.url ? String(c.url).replace(/\/+$/, '') : '';
    } catch (e) {
      return '';
    }
  },
  // 兼容历史写法 Ubus.baseUrl = xxx：故意留空 setter，
  // 既不会在严格模式下抛错，也保证 Store.active 是唯一数据源。
  set baseUrl(_v) {},

  session: '',
  acls: {},          // 登录时返回的 ubus 权限表（白名单）
  rtt: 0,            // 最近一次请求的往返耗时（ms），顶部状态条拿它当「延迟」

  async _rpc(session, object, method, params) {
    const base = this.baseUrl;
    if (!base) throw new FriendlyError('尚未配置管理地址，请到「设置 → 连接」里添加或选择一个连接');
    const url = base + '/ubus';
    const t0 = Date.now();
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Math.floor(Math.random() * 1e9),
          method: 'call',
          params: [session, object, method, params || {}]
        })
      });
    } catch (e) {
      throw new FriendlyError('无法连接到 ' + base + '，请检查管理地址、Tailscale/内网穿透是否在线');
    }
    this.rtt = Date.now() - t0;
    if (!resp.ok) throw new FriendlyError('路由器返回 HTTP ' + resp.status + '，请检查地址协议（http/https）与端口');
    const data = await resp.json();
    if (data.error) throw new FriendlyError('JSON-RPC 错误: ' + (data.error.message || data.error.code));
    const r = data.result;
    /* ubus 的 result 是 [状态码, 数据]，但**写操作没有数据段**：
       uci set/add/delete/apply、rc init 都只返回 [0]。
       早期实现要求 r.length >= 2，结果所有写操作都被误判成
       「无效的 ubus 响应」，看起来像权限问题，其实是响应解析太严。 */
    if (!Array.isArray(r) || r.length < 1) throw new FriendlyError('无效的 ubus 响应');
    if (r[0] !== 0) {
      const code = r[0];
      if (code === -32002 || code === -32001 || code === -32003) {
        const err = new Error('ubus_permission');
        err.code = code;
        throw err;
      }
      throw new FriendlyError('ubus 调用失败（' + object + '.' + method + '）错误码 ' + code);
    }
    return r.length > 1 ? r[1] : null;
  },

  async login(username, password) {
    const ZERO = '00000000000000000000000000000000';
    const payload = await this._rpc(ZERO, 'session', 'login', {
      username: String(username || ''),
      password: String(password || '')
    });
    this.session = (payload && payload.ubus_rpc_session) || '';
    // 记下本次会话的 ubus 权限表，供 UI 判断某功能是否真的可用
    this.acls = (payload && payload.acls && payload.acls.ubus) || {};
    if (!this.session) throw new FriendlyError('登录失败：未获取到会话');
    return payload;
  },

  /* 依据登录返回的 ubus ACL 判断对象/方法是否被授权。
     标准 OpenWrt 的 ACL 是白名单（例如 system 只有 info/board/reboot，
     没有 poweroff），靠它把不可用的按钮直接隐藏，而不是点了才报错。 */
  can(object, method) {
    const a = this.acls || {};
    const hit = list => !!list && (list.indexOf('*') >= 0 || list.indexOf(method) >= 0);
    if (hit(a[object])) return true;
    return Object.keys(a).some(k => {
      if (k.indexOf('*') < 0) return false;
      const re = new RegExp('^' + k.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
      return re.test(object) && hit(a[k]);
    });
  },

  // 带自动重登（凭据保存在本地时）
  async call(object, method, params, _retried) {
    try {
      return await this._rpc(this.session, object, method, params);
    } catch (e) {
      if (e && e.code !== undefined && !_retried &&
          Store.data.rememberPassword && Store.data.username && Store.data.password) {
        await this.login(Store.data.username, Store.data.password);
        return await this._rpc(this.session, object, method, params);
      }
      throw e;
    }
  },

  // 探测命名空间是否可用（自适应菜单）
  async probe(object, method, params) {
    try {
      await this._rpc(this.session, object, method, params || {});
      return true;
    } catch (e) {
      return false;
    }
  }
};

/* ================= uci 配置读写 =================
   这台路由器登录后返回的 uci 权限是：
     changes | get | add | apply | confirm | delete | order | rename | set
   注意：**没有 commit**！一开始按直觉写 uci.commit 会直接吃
   `Access denied (-32002)`，而且报错发生在「设置成功之后」，很容易误判成 set 没权限。
   实测 uci.apply 才是落盘手段：set 之后调 apply，uci changes 会清空、
   重新登录后仍然读到新值、reload 后运行态跟着变 —— 等价于 commit。
   （apply 的另一个用途是「带回滚的提交」，只有显式传 rollback:true 才会启用定时回滚。）

   其它坑：
   - 值一律是**字符串**，数字/布尔要自己转；数组会写成 uci 的 list
   - **ACL 里没有 revert**，撤销只能靠自己保存原值再写回去
   - 匿名 section 的 `.name` 是 `cfgXXXXXX` 这种随机串，必须按 `.type` 找，
     不能硬编码（例如 system 段就不叫 `@system[0]`） */
const Uci = {
  async get(config, section, option) {
    const p = { config };
    if (section) p.section = section;
    if (option) p.option = option;
    const r = await Ubus.call('uci', 'get', p);
    return (r && r.values) || {};
  },

  /* values 里值为 null / undefined 的键会走 delete，其余按字符串写入。
     布尔也统一转成 '1' / '0'，和 OpenWrt 的惯例一致。 */
  async set(config, section, values) {
    const vals = {};
    const dels = [];
    Object.keys(values || {}).forEach(k => {
      const v = values[k];
      if (v === null || v === undefined) dels.push(k);
      else if (typeof v === 'boolean') vals[k] = v ? '1' : '0';
      else if (Array.isArray(v)) vals[k] = v.map(x => String(x));
      else vals[k] = String(v);
    });
    if (Object.keys(vals).length) {
      await Ubus.call('uci', 'set', { config: config, section: section, values: vals });
    }
    for (const opt of dels) {
      // 选项本来就不存在时 delete 会报 status 2/4，属于正常情况，忽略
      try { await Ubus.call('uci', 'delete', { config: config, section: section, option: opt }); } catch (e) {}
    }
  },

  async add(config, type, values) {
    const vals = {};
    Object.keys(values || {}).forEach(k => {
      const v = values[k];
      if (v === null || v === undefined) return;
      if (typeof v === 'boolean') vals[k] = v ? '1' : '0';
      else if (Array.isArray(v)) vals[k] = v.map(x => String(x));
      else vals[k] = String(v);
    });
    const r = await Ubus.call('uci', 'add', { config: config, type: type, values: vals });
    return (r && r.section) || '';
  },

  async del(config, section, option) {
    const p = { config: config, section: section };
    if (option) p.option = option;
    await Ubus.call('uci', 'delete', p);
  },

  /* 落盘（= commit）。见本段开头的说明：这台路由器的 ACL 里只有 apply。 */
  async commit() {
    await Ubus.call('uci', 'apply', { rollback: false });
  },

  /* 还没落盘的改动，例如 [["set","radio1","txpower","20"]] */
  async changes(config) {
    try {
      const r = await Ubus.call('uci', 'changes', { config: config });
      return (r && r.changes) || [];
    } catch (e) { return []; }
  },

  /* 让改动生效：等价于 /etc/init.d/<name> <action>
     ubus 成功时返回 result:[0]（不带数据），所以这里不解析返回值。 */
  async apply(name, action) {
    return await Ubus.call('rc', 'init', { name: name, action: action || 'reload' });
  },

  /* 取某个 config 里所有指定 .type 的 section，返回 { sectionName: {…字段} } */
  sectionsOfType(values, type) {
    const out = {};
    Object.keys(values || {}).forEach(k => {
      const v = values[k];
      if (v && v['.type'] === type) out[k] = v;
    });
    return out;
  },

  /* 取某个 config 里第一个指定 .type 的 section 名 */
  firstOfType(values, type) {
    return Object.keys(this.sectionsOfType(values, type))[0] || '';
  },

  /* 改完某个 config 后需要重载哪些服务。
     实测（真机 OpenWrt 24.10）：`rc init network reload` 会把
     /etc/config/network **和** /etc/config/wireless 的改动一起生效
     （改 radio 的发射功率后 iwinfo 立刻反映，且路由器 uptime 不中断），
     所以 wireless 也用 network reload，不需要另找 wifi 重载入口
     —— ubus 里 network.wireless 不在 ACL 中，file.exec 也被拒（返回 status 6）。 */
  APPLY: {
    wireless: [{ name: 'network', action: 'reload' }],
    network:  [{ name: 'network', action: 'reload' }],
    dhcp:     [{ name: 'dnsmasq', action: 'restart' }, { name: 'odhcpd', action: 'restart' }],
    firewall: [{ name: 'firewall', action: 'reload' }],
    system:   [{ name: 'system', action: 'reload' }]
  }
};

/* ================= 无线硬件能力查询 =================
   用来把「信道 / 频宽 / 发射功率」做成下拉选项，而不是让用户手填错的字符串。
   这些方法都在本机的 iwinfo ACL 白名单里（assoclist/countrylist/freqlist/
   txpowerlist/scan/info）。注意 iwinfo **没有** devices 方法。 */
const Wifi = {
  devices() { return Ubus.call('luci-rpc', 'getWirelessDevices', {}); },

  /* 返回该射频可用的信道号数组；device 传 radioX 或 phyX 都行 */
  async channels(dev) {
    try {
      const r = await Ubus.call('iwinfo', 'freqlist', { device: dev });
      const list = ((r && r.results) || []).map(x => x.channel);
      return list.filter((v, i, a) => a.indexOf(v) === i);
    } catch (e) { return []; }
  },

  /* 返回 [{dbm, mw, active}] */
  async txpowers(dev) {
    try {
      const r = await Ubus.call('iwinfo', 'txpowerlist', { device: dev });
      return (r && r.results) || [];
    } catch (e) { return []; }
  },

  async info(ifname) {
    try { return await Ubus.call('iwinfo', 'info', { device: ifname }); } catch (e) { return null; }
  },

  async assoclist(ifname) {
    try {
      const r = await Ubus.call('iwinfo', 'assoclist', { device: ifname });
      return (r && r.results) || [];
    } catch (e) { return []; }
  },

  async scan(dev) {
    const r = await Ubus.call('iwinfo', 'scan', { device: dev });
    return (r && r.results) || [];
  }
};
