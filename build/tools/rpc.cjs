#!/usr/bin/env node
'use strict';
/* 命令行 ubus 调用小工具（CommonJS，本机 node ESM 有 undici WASM 问题）
   用法：
     node rpc.cjs login
     node rpc.cjs call <object> <method> '<json-params>'
     node rpc.cjs uci-get <config> [section] [option]
     node rpc.cjs uci-set <config> <section> '<json-values>' [commit]
     node rpc.cjs reload <init-name> [action]
     node rpc.cjs ACL
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.OWR_HOST || '192.168.1.1';
const USER = process.env.OWR_USER || 'root';
const PASS = process.env.OWR_PASS || '';
if (!PASS) { console.error('请先设置路由器口令：export OWR_PASS=...'); process.exit(1); }
const ZERO = '00000000000000000000000000000000';
const SESS_FILE = path.join(__dirname, '..', 'temp', '.ubus_session');

function rpc(session, object, method, params, timeout) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'call',
      params: [session || ZERO, object, method, params || {}]
    });
    const req = http.request({
      host: HOST, port: 80, path: '/ubus', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeout || 20000
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json: ' + b.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function saveSession(s) { try { fs.mkdirSync(path.dirname(SESS_FILE), { recursive: true }); fs.writeFileSync(SESS_FILE, s); } catch (e) {} }
function loadSession() { try { return fs.readFileSync(SESS_FILE, 'utf8').trim(); } catch (e) { return ''; } }

async function login() {
  const r = await rpc(ZERO, 'session', 'login', { username: USER, password: PASS });
  if (r.error) throw new Error('login error ' + JSON.stringify(r.error));
  const s = r.result[1].ubus_rpc_session;
  saveSession(s);
  return { session: s, acls: r.result[1].acls && r.result[1].acls.ubus, payload: r.result[1] };
}

async function call(object, method, params) {
  let s = loadSession();
  if (!s) s = (await login()).session;
  let r = await rpc(s, object, method, params);
  if (r.error && r.error.code === -32002) {
    s = (await login()).session;
    r = await rpc(s, object, method, params);
  }
  return r;
}

function unwrap(r) {
  if (r.error) throw new Error('rpc ' + r.error.code + ' ' + r.error.message);
  if (!Array.isArray(r.result)) throw new Error('bad result');
  if (r.result[0] !== 0) throw new Error('ubus status ' + r.result[0]);
  return r.result[1];
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === 'login') {
      const r = await login();
      console.log('session=' + r.session);
      return;
    }
    if (cmd === 'ACL' || cmd === 'acl') {
      const r = await login();
      console.log(JSON.stringify(r.acls, null, 1));
      return;
    }
    if (cmd === 'call') {
      console.log(JSON.stringify(unwrap(await call(args[0], args[1], args[2] ? JSON.parse(args[2]) : {})), null, 1));
      return;
    }
    if (cmd === 'uci-get') {
      const p = { config: args[0] };
      if (args[1]) p.section = args[1];
      if (args[2]) p.option = args[2];
      console.log(JSON.stringify(unwrap(await call('uci', 'get', p)), null, 1));
      return;
    }
    if (cmd === 'uci-set') {
      unwrap(await call('uci', 'set', { config: args[0], section: args[1], values: JSON.parse(args[2]) }));
      if (args[3] === 'commit') unwrap(await call('uci', 'commit', { config: args[0] }));
      console.log('OK');
      return;
    }
    if (cmd === 'reload') {
      console.log(JSON.stringify(unwrap(await call('rc', 'init', { name: args[0], action: args[1] || 'reload' })), null, 1));
      return;
    }
    if (cmd === 'raw') {
      console.log(JSON.stringify(await call(args[0], args[1], args[2] ? JSON.parse(args[2]) : {}), null, 1));
      return;
    }
    console.log('未知命令');
  } catch (e) {
    console.error('ERR ' + e.message);
    process.exit(1);
  }
})();
