// Hardened Full-Stack Cloudflare Worker for 《鹈鹕测试大乱斗》 (Pelican Test Brawl)
// Security: PBKDF2-SHA256 (100k iter), CF-Connecting-IP Sliding Quotas (max 3 regs/day, 45s cooldown),
// Login Brute-Force Lockout (6 fails/10m), Signed Timing Ticket + Honeypot, 4KB Body Cap & Schema Whitelist.

const DEFAULT_SAVE = {
  beans: 260,
  bestDist: 0,
  maxCheckpoint: 0,
  selectedCheckpoint: 0,
  selectedHero: 'nailong',
  unlocked: ['ikun', 'pelican', 'naiwa', 'nailong'],
  mods: { claw: 0, nitro: 0, sawBumper: 0, mortarCat: 0 }
};

const VALID_HEROES = new Set(['nailong', 'ikun', 'pelican', 'naiwa', 'hakimi']);
const PEPPER = 'pelican_brawl_edge_shield_v2_9f8a7c6e';

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    }
  });
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPasswordPBKDF2(password, saltHex) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(saltHex), iterations: 100000, hash: 'SHA-256' },
    keyMat,
    256
  );
  const hex = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$100000$${hex}`;
}

function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, saltHex, storedHash) {
  if (storedHash.startsWith('pbkdf2$100000$')) {
    const calc = await hashPasswordPBKDF2(password, saltHex);
    return timingSafeEq(calc, storedHash);
  }
  const legacy = await sha256Hex(`${saltHex}:${password}`);
  return timingSafeEq(legacy, storedHash);
}

async function getClientIpHash(request) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  return sha256Hex(`${PEPPER}:ip:${ip}`);
}

async function makeTicket(ipHash, nowMs) {
  const sig = await sha256Hex(`${PEPPER}:ticket:${ipHash}:${nowMs}`);
  return `${nowMs}.${sig.slice(0, 32)}`;
}

async function verifyTicket(ticket, ipHash, nowMs) {
  if (typeof ticket !== 'string' || !ticket.includes('.')) return false;
  const [tsStr, sig] = ticket.split('.', 2);
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  const age = nowMs - ts;
  if (age < 800 || age > 900000) return false; // Must be 0.8s..15m old (blocks instant bot scripts!)
  const expected = (await sha256Hex(`${PEPPER}:ticket:${ipHash}:${ts}`)).slice(0, 32);
  return timingSafeEq(sig, expected);
}

async function readSafeJson(request, maxBytes = 4096) {
  const lenHdr = Number(request.headers.get('Content-Length') || 0);
  if (lenHdr > maxBytes) return { err: '请求数据过大', status: 413 };
  let text = '';
  try { text = await request.text(); } catch (_) { return { err: '读取失败', status: 400 }; }
  if (text.length > maxBytes) return { err: '请求数据过大', status: 413 };
  try { return { body: JSON.parse(text) }; } catch (_) { return { err: '请求格式错误', status: 400 }; }
}

function sanitizeSave(raw, prev = null) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const p = (prev && typeof prev === 'object') ? prev : {};
  const bestDist = Math.min(999999, Math.max(0, Math.floor(Number(s.bestDist) || 0), Math.floor(Number(p.bestDist) || 0)));
  const maxCheckpoint = Math.min(
    999500,
    Math.max(
      0,
      Math.floor(Number(s.maxCheckpoint) || 0),
      Math.floor(Number(p.maxCheckpoint) || 0),
      Math.floor(bestDist / 500) * 500
    )
  );
  const beansVal = s.beans !== undefined
    ? Math.min(9999999, Math.max(0, Math.floor(Number(s.beans) || 0)))
    : Math.min(9999999, Math.max(260, Math.floor(Number(p.beans) || 260)));

  const unlockedSet = new Set(DEFAULT_SAVE.unlocked);
  for (const arr of [p.unlocked, s.unlocked]) {
    if (Array.isArray(arr)) {
      for (const x of arr) if (typeof x === 'string' && VALID_HEROES.has(x)) unlockedSet.add(x);
    }
  }
  const sm = (s.mods && typeof s.mods === 'object') ? s.mods : {};
  const pm = (p.mods && typeof p.mods === 'object') ? p.mods : {};
  const mods = {};
  for (const k of ['claw', 'nitro', 'sawBumper', 'mortarCat']) {
    mods[k] = Math.min(3, Math.max(0, Math.floor(Number(sm[k]) || 0), Math.floor(Number(pm[k]) || 0)));
  }
  const selCp = Math.min(maxCheckpoint, Math.max(0, Math.floor(Number(s.selectedCheckpoint ?? p.selectedCheckpoint) || 0)));
  const candHero = typeof s.selectedHero === 'string' ? s.selectedHero : p.selectedHero;
  const hero = VALID_HEROES.has(candHero) ? candHero : 'nailong';
  return {
    beans: beansVal,
    bestDist,
    maxCheckpoint,
    selectedCheckpoint: selCp,
    selectedHero: hero,
    unlocked: Array.from(unlockedSet),
    mods
  };
}

function extractToken(request, body) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (body && typeof body.token === 'string') return body.token.trim();
  return '';
}

async function getIpGuard(env, ipHash, nowMs) {
  const day = Math.floor(nowMs / 86400000);
  const minBucket = Math.floor(nowMs / 60000);
  let row = await env.DB.prepare('SELECT * FROM ip_limits WHERE ip_hash = ?').bind(ipHash).first();
  if (!row) {
    row = {
      ip_hash: ipHash,
      reg_day: day,
      reg_day_count: 0,
      reg_total_count: 0,
      last_reg_ms: 0,
      fail_window_ms: nowMs,
      fail_count: 0,
      save_min_bucket: minBucket,
      save_min_count: 0
    };
    await env.DB.prepare(
      'INSERT OR IGNORE INTO ip_limits (ip_hash, reg_day, reg_day_count, reg_total_count, last_reg_ms, fail_window_ms, fail_count, save_min_bucket, save_min_count) VALUES (?, ?, 0, 0, 0, ?, 0, ?, 0)'
    ).bind(ipHash, day, nowMs, minBucket).run();
  } else {
    if (row.reg_day !== day) { row.reg_day = day; row.reg_day_count = 0; }
    if (nowMs - row.fail_window_ms > 600000) { row.fail_window_ms = nowMs; row.fail_count = 0; }
    if (row.save_min_bucket !== minBucket) { row.save_min_bucket = minBucket; row.save_min_count = 0; }
  }
  return row;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return jsonResp({ ok: true });
    if (path === '/api/health') return jsonResp({ ok: true, game: '鹈鹕测试大乱斗', d1: Boolean(env.DB), shield: true });

    if (path === '/api/auth/ticket' && request.method === 'GET') {
      const ipHash = await getClientIpHash(request);
      const ticket = await makeTicket(ipHash, Date.now());
      return jsonResp({ ok: true, ticket });
    }

    if (path === '/api/auth/register' && request.method === 'POST') {
      const origin = request.headers.get('Origin') || '';
      if (origin && !origin.includes(url.host) && !origin.includes('127.0.0.1') && !origin.includes('localhost')) {
        return jsonResp({ ok: false, error: '非法来源请求' }, 403);
      }
      const parsed = await readSafeJson(request, 4096);
      if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
      const body = parsed.body;

      // Honeypot trap
      if (body.hp_trap) return jsonResp({ ok: false, error: '请求被拒绝' }, 403);

      const now = Date.now();
      const ipHash = await getClientIpHash(request);
      if (!(await verifyTicket(body.ticket, ipHash, now))) {
        return jsonResp({ ok: false, error: '安全校验超时或过快，请重新打开存档窗口再试' }, 403);
      }

      const guard = await getIpGuard(env, ipHash, now);
      if (now - guard.last_reg_ms < 45000) {
        return jsonResp({ ok: false, error: '注册操作过于频繁，请45秒后再试' }, 429);
      }
      if (guard.reg_day_count >= 3) {
        return jsonResp({ ok: false, error: '当前网络今日注册已达上限(3个)，请直接登录已有账号' }, 429);
      }
      if (guard.reg_total_count >= 5) {
        return jsonResp({ ok: false, error: '当前网络注册账号数已达上限，请直接登录已有账号' }, 429);
      }

      const rawName = String(body.username || '').trim();
      const pwd = String(body.password || '');
      if (rawName.length < 2 || rawName.length > 20 || /[\s<>'"\\/;]/.test(rawName)) {
        return jsonResp({ ok: false, error: '账号需为2~20位常规字符（不含空格或特殊符号）' }, 400);
      }
      if (pwd.length < 4 || pwd.length > 64) {
        return jsonResp({ ok: false, error: '密码长度需为4~64位' }, 400);
      }

      const normUser = rawName.toLowerCase();
      const existing = await env.DB.prepare('SELECT username FROM players WHERE username = ?').bind(normUser).first();
      if (existing) return jsonResp({ ok: false, error: '该账号已被注册，请换个账号或直接登录！' }, 409);

      const salt = randomHex(16);
      const passHash = await hashPasswordPBKDF2(pwd, salt);
      const token = randomHex(24);
      const cleanSave = sanitizeSave(body.save, null);

      try {
        await env.DB.prepare(
          'INSERT INTO players (username, display_name, salt, pass_hash, token, save_json, live_run_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)'
        ).bind(normUser, rawName, salt, passHash, token, JSON.stringify(cleanSave), now, now).run();
      } catch (_) {
        return jsonResp({ ok: false, error: '该账号已被注册，请换个账号或直接登录！' }, 409);
      }

      await env.DB.prepare(
        'UPDATE ip_limits SET reg_day = ?, reg_day_count = ?, reg_total_count = ?, last_reg_ms = ? WHERE ip_hash = ?'
      ).bind(guard.reg_day, guard.reg_day_count + 1, guard.reg_total_count + 1, now, ipHash).run();

      return jsonResp({ ok: true, username: rawName, token, save: cleanSave, updatedAt: now });
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      const parsed = await readSafeJson(request, 4096);
      if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
      const body = parsed.body;

      const now = Date.now();
      const ipHash = await getClientIpHash(request);
      const guard = await getIpGuard(env, ipHash, now);
      if (guard.fail_count >= 6) {
        return jsonResp({ ok: false, error: '密码尝试次数过多，请10分钟后再试' }, 429);
      }

      const rawName = String(body.username || '').trim();
      const pwd = String(body.password || '');
      if (!rawName || !pwd) return jsonResp({ ok: false, error: '请输入账号和密码' }, 400);

      const normUser = rawName.toLowerCase();
      const row = await env.DB.prepare('SELECT * FROM players WHERE username = ?').bind(normUser).first();
      const valid = row ? await verifyPassword(pwd, row.salt, row.pass_hash) : false;

      if (!row || !valid) {
        await env.DB.prepare('UPDATE ip_limits SET fail_window_ms = ?, fail_count = ? WHERE ip_hash = ?')
          .bind(guard.fail_window_ms, guard.fail_count + 1, ipHash).run();
        return jsonResp({ ok: false, error: !row ? '账号不存在，请核对账号或点击注册' : '密码错误，请重试' }, !row ? 404 : 401);
      }

      // Reset fail counter & upgrade legacy hash if needed
      let nextPassHash = row.pass_hash;
      if (!nextPassHash.startsWith('pbkdf2$')) {
        nextPassHash = await hashPasswordPBKDF2(pwd, row.salt);
        await env.DB.prepare('UPDATE players SET pass_hash = ? WHERE username = ?').bind(nextPassHash, normUser).run();
      }
      if (guard.fail_count > 0) {
        await env.DB.prepare('UPDATE ip_limits SET fail_count = 0 WHERE ip_hash = ?').bind(ipHash).run();
      }

      let cloudSave = DEFAULT_SAVE;
      try { cloudSave = sanitizeSave(JSON.parse(row.save_json), null); } catch (_) {}

      if (body.guestSave && typeof body.guestSave === 'object') {
        const merged = sanitizeSave(cloudSave, body.guestSave);
        merged.beans = Math.max(cloudSave.beans, Number(body.guestSave.beans) > 260 ? Math.floor(Number(body.guestSave.beans)) : cloudSave.beans);
        if (JSON.stringify(merged) !== JSON.stringify(cloudSave)) {
          cloudSave = merged;
          await env.DB.prepare('UPDATE players SET save_json = ?, updated_at = ? WHERE username = ?')
            .bind(JSON.stringify(cloudSave), now, normUser).run();
        }
      }

      const token = row.token || randomHex(24);
      if (!row.token) {
        await env.DB.prepare('UPDATE players SET token = ? WHERE username = ?').bind(token, normUser).run();
      }
      return jsonResp({ ok: true, username: row.display_name, token, save: cloudSave, updatedAt: row.updated_at });
    }

    if (path === '/api/auth/me' && request.method === 'GET') {
      const token = extractToken(request, null);
      if (!token) return jsonResp({ ok: false, error: '未登录' }, 401);
      const row = await env.DB.prepare('SELECT display_name, save_json, updated_at FROM players WHERE token = ?').bind(token).first();
      if (!row) return jsonResp({ ok: false, error: '登录已失效' }, 401);
      let cloudSave = DEFAULT_SAVE;
      try { cloudSave = sanitizeSave(JSON.parse(row.save_json), null); } catch (_) {}
      return jsonResp({ ok: true, username: row.display_name, save: cloudSave, updatedAt: row.updated_at });
    }

    if (path === '/api/save' && request.method === 'POST') {
      const parsed = await readSafeJson(request, 4096);
      if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
      const body = parsed.body;
      const token = extractToken(request, body);
      if (!token) return jsonResp({ ok: false, error: '未登录' }, 401);

      const now = Date.now();
      const ipHash = await getClientIpHash(request);
      const guard = await getIpGuard(env, ipHash, now);
      if (guard.save_min_count >= 15) {
        return jsonResp({ ok: false, error: '同步过于频繁' }, 429);
      }
      await env.DB.prepare('UPDATE ip_limits SET save_min_bucket = ?, save_min_count = ? WHERE ip_hash = ?')
        .bind(guard.save_min_bucket, guard.save_min_count + 1, ipHash).run();

      const row = await env.DB.prepare('SELECT username, display_name, save_json FROM players WHERE token = ?').bind(token).first();
      if (!row) return jsonResp({ ok: false, error: '登录已失效' }, 401);
      let prevSave = null;
      try { prevSave = JSON.parse(row.save_json); } catch (_) {}
      const mergedSave = sanitizeSave(body.save, prevSave);
      await env.DB.prepare('UPDATE players SET save_json = ?, live_run_json = NULL, updated_at = ? WHERE username = ?')
        .bind(JSON.stringify(mergedSave), now, row.username).run();
      return jsonResp({ ok: true, username: row.display_name, save: mergedSave, updatedAt: now });
    }

    const KV_HTML_KEY = 'pelican_brawl_html_v2';
    const wantSync = url.searchParams.get('sync') === '1';
    let html = wantSync ? null : await env.GAME_KV.get(KV_HTML_KEY);
    if (!html) {
      const ref = url.searchParams.get('sha') || 'main';
      const ghUrl = 'https://raw.githubusercontent.com/Lilywittt/nailong-bike-game/' + encodeURIComponent(ref) + '/index.html?t=' + Date.now();
      const resp = await fetch(ghUrl, { headers: { 'User-Agent': 'PelicanBrawlWorker/2.0' } });
      if (resp.ok) {
        html = await resp.text();
        await env.GAME_KV.put(KV_HTML_KEY, html);
      } else {
        html = await env.GAME_KV.get(KV_HTML_KEY) || await env.GAME_KV.get('pelican_brawl_html_v1');
      }
    }
    if (!html) return new Response('Game syncing, please refresh in a moment.', { status: 503 });
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  }
};
