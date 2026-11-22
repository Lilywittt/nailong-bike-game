// Hardened Full-Stack Cloudflare Worker for 《鹈鹕测试大乱斗》 (Pelican Test Brawl)
// Security: PBKDF2-SHA256 (100k iter), CF-Connecting-IP Sliding Quotas (max 3 regs/day, 45s cooldown),
// Login Brute-Force Lockout (6 fails/10m), Signed Timing Ticket + Honeypot, 4KB Body Cap & Schema Whitelist.

const DEFAULT_SAVE = {
  beans: 150,
  dashEnergy: 0,
  bestDist: 0,
  bestSingleRun: 0,
  maxCheckpoint: 0,
  selectedCheckpoint: 0,
  selectedHero: 'nailong',
  unlocked: ['ikun', 'pelican', 'naiwa', 'nailong', 'hakimi'],
  mods: { claw: 0, nitro: 0, sawBumper: 0, mortarCat: 0 },
  heroLv: { nailong: 1, ikun: 1, pelican: 1, naiwa: 1, hakimi: 1 }
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
  const bestSingleRun = Math.min(999999, Math.max(0, Math.floor(Number(s.bestSingleRun) || 0), Math.floor(Number(p.bestSingleRun) || 0)));
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
    ? Math.min(999999999, Math.max(0, Math.floor(Number(s.beans) || 0)))
    : Math.min(999999999, Math.max(260, Math.floor(Number(p.beans) || 260)));

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
  const shl = (s.heroLv && typeof s.heroLv === 'object') ? s.heroLv : {};
  const phl = (p.heroLv && typeof p.heroLv === 'object') ? p.heroLv : {};
  const heroLv = {};
  for (const h of ['nailong', 'ikun', 'pelican', 'naiwa', 'hakimi']) {
    heroLv[h] = Math.min(6, Math.max(1, Math.floor(Number(shl[h]) || 1), Math.floor(Number(phl[h]) || 1)));
  }
  const selCp = Math.min(maxCheckpoint, Math.max(0, Math.floor(Number(s.selectedCheckpoint ?? p.selectedCheckpoint) || 0)));
  const candHero = typeof s.selectedHero === 'string' ? s.selectedHero : p.selectedHero;
  const hero = VALID_HEROES.has(candHero) ? candHero : 'nailong';
  const dashEnergy = s.dashEnergy !== undefined
    ? Math.min(30, Math.max(0, Math.round((Number(s.dashEnergy) || 0) * 10) / 10))
    : Math.min(30, Math.max(0, Math.round((Number(p.dashEnergy) || 0) * 10) / 10));

  return {
    beans: beansVal,
    dashEnergy,
    bestDist,
    bestSingleRun,
    maxCheckpoint,
    selectedCheckpoint: selCp,
    selectedHero: hero,
    unlocked: Array.from(unlockedSet),
    mods,
    heroLv
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

async function ensureLeaderboardTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS leaderboard (player_key TEXT PRIMARY KEY, nickname TEXT NOT NULL, hero TEXT NOT NULL, best_single INTEGER NOT NULL, updated_at INTEGER NOT NULL)'
  ).run();
}

async function upsertLeaderboardEntry(env, playerKey, nickname, hero, bestSingle, nowMs) {
  const sc = Math.min(25000, Math.max(0, Math.floor(Number(bestSingle) || 0)));
  if (!playerKey || sc < 5) return;
  const safeHero = VALID_HEROES.has(hero) ? hero : 'nailong';
  await ensureLeaderboardTable(env);
  await env.DB.prepare(
    `INSERT INTO leaderboard (player_key, nickname, hero, best_single, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(player_key) DO UPDATE SET
       nickname = excluded.nickname,
       hero = excluded.hero,
       best_single = MAX(leaderboard.best_single, excluded.best_single),
       updated_at = CASE WHEN excluded.best_single >= leaderboard.best_single THEN excluded.updated_at ELSE leaderboard.updated_at END`
  ).bind(playerKey, nickname, safeHero, sc, nowMs).run();
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

      await upsertLeaderboardEntry(env, `u:${normUser}`, rawName, cleanSave.selectedHero, cleanSave.bestSingleRun, now);
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
      if (guard.save_min_count >= 120) {
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
      await upsertLeaderboardEntry(env, `u:${row.username}`, row.display_name, mergedSave.selectedHero, mergedSave.bestSingleRun, now);
      return jsonResp({ ok: true, username: row.display_name, save: mergedSave, updatedAt: now });
    }

    if (path === '/api/leaderboard' && request.method === 'GET') {
      await ensureLeaderboardTable(env);
      const myKey = String(url.searchParams.get('key') || '').trim().slice(0, 64);
      // Backfill existing D1 players once if leaderboard is sparse
      const pRes = await env.DB.prepare('SELECT username, display_name, save_json, updated_at FROM players ORDER BY updated_at DESC LIMIT 60').all();
      for (const pr of (pRes.results || [])) {
        try {
          const sv = JSON.parse(pr.save_json);
          const bs = Math.min(25000, Math.max(0, Math.floor(Number(sv.bestSingleRun) || 0)));
          if (bs >= 5) {
            await upsertLeaderboardEntry(env, `u:${pr.username}`, pr.display_name, sv.selectedHero || 'nailong', bs, pr.updated_at || Date.now());
          }
        } catch (_) {}
      }
      const topRes = await env.DB.prepare(
        'SELECT player_key, nickname, hero, best_single, updated_at FROM leaderboard WHERE best_single > 0 ORDER BY best_single DESC, updated_at ASC LIMIT 30'
      ).all();
      const cntRow = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM leaderboard WHERE best_single > 0').first();
      let myRank = null;
      if (myKey) {
        const me = await env.DB.prepare('SELECT best_single FROM leaderboard WHERE player_key = ?').bind(myKey).first();
        if (me && me.best_single > 0) {
          const hRow = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM leaderboard WHERE best_single > ?').bind(me.best_single).first();
          myRank = Number(hRow?.cnt || 0) + 1;
        }
      }
      const top = (topRes.results || []).map((r, i) => ({
        rank: i + 1,
        isMe: Boolean(myKey && r.player_key === myKey),
        nickname: r.nickname,
        hero: r.hero,
        bestSingle: r.best_single,
        updatedAt: r.updated_at
      }));
      return jsonResp({ ok: true, top, myRank, total: Number(cntRow?.cnt || 0) });
    }

    if (path === '/api/leaderboard' && request.method === 'POST') {
      const parsed = await readSafeJson(request, 2048);
      if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
      const body = parsed.body;
      const now = Date.now();
      const score = Math.min(25000, Math.max(0, Math.floor(Number(body.bestSingle) || 0)));
      if (score < 5) return jsonResp({ ok: false, error: '先跑出至少 5m 单命成绩再上榜吧！' }, 400);
      const hero = VALID_HEROES.has(body.hero) ? body.hero : 'nailong';
      const rawNick = String(body.nickname || '').replace(/[\s<>'"\\/;]/g, '').slice(0, 16);
      const guestId = String(body.guestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
      const token = extractToken(request, body);

      let pkey = '';
      let nick = rawNick || '神秘骑手';
      if (token) {
        const prow = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
        if (prow) {
          pkey = `u:${prow.username}`;
          nick = prow.display_name;
        }
      }
      if (!pkey) {
        if (guestId.length < 6) return jsonResp({ ok: false, error: '缺少榜单标识' }, 400);
        if (nick.length < 2) return jsonResp({ ok: false, error: '昵称需至少2个字符' }, 400);
        pkey = `g:${guestId}`;
      }
      await upsertLeaderboardEntry(env, pkey, nick, hero, score, now);
      const me = await env.DB.prepare('SELECT best_single FROM leaderboard WHERE player_key = ?').bind(pkey).first();
      const bestNow = Number(me?.best_single || score);
      const hRow = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM leaderboard WHERE best_single > ?').bind(bestNow).first();
      return jsonResp({ ok: true, playerKey: pkey, nickname: nick, bestSingle: bestNow, myRank: Number(hRow?.cnt || 0) + 1 });
    }

    const STATIC_BINARY_WHITELIST = {
      '/audio/boss_bgm.m4a': 'audio/mp4',
      '/audio/ngm.mp3': 'audio/mpeg',
      '/audio/ji.mp3': 'audio/mpeg',
      '/audio/jntm.mp3': 'audio/mpeg',
      '/audio/ddj.m4a': 'audio/mp4',
      '/audio/hakimi.m4a': 'audio/mp4',
      '/audio/nailong.m4a': 'audio/mp4',
      '/audio/manbo.m4a': 'audio/mp4',
      '/assets/pay_alipay.jpg': 'image/jpeg',
      '/assets/pay_wechat.jpg': 'image/jpeg',
      '/assets/contact_wechat_qr.png': 'image/png',
      '/assets/game_qr.png': 'image/png',
      '/assets/promo_qr_square.png': 'image/png',
      '/assets/boss_manbo.png': 'image/png',
      '/assets/boss_manbo_meme.png': 'image/png'
    };
    if (request.method === 'GET' && STATIC_BINARY_WHITELIST[path]) {
      const kvKey = 'bin_v2_' + path.replace(/[^a-zA-Z0-9_.-]/g, '_');
      let buf = await env.GAME_KV.get(kvKey, { type: 'arrayBuffer' });
      if (!buf) {
        const ghAsset = 'https://raw.githubusercontent.com/Lilywittt/nailong-bike-game/main' + path;
        const aResp = await fetch(ghAsset, { headers: { 'User-Agent': 'PelicanBrawlWorker/2.0' } });
        if (aResp.ok) {
          buf = await aResp.arrayBuffer();
          await env.GAME_KV.put(kvKey, buf);
        }
      }
      if (!buf) return new Response('Asset syncing', { status: 404 });
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': STATIC_BINARY_WHITELIST[path],
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const STATIC_TEXT_WHITELIST = {
      '/': { file: '/index.html', mime: 'text/html; charset=utf-8', cache: 'no-cache' },
      '/index.html': { file: '/index.html', mime: 'text/html; charset=utf-8', cache: 'no-cache' },
      '/share.html': { file: '/share.html', mime: 'text/html; charset=utf-8', cache: 'no-cache' },
      '/assets/promo_card.svg': { file: '/assets/promo_card.svg', mime: 'image/svg+xml; charset=utf-8', cache: 'public, max-age=3600' },
      '/css/style.css': { file: '/css/style.css', mime: 'text/css; charset=utf-8', cache: 'public, max-age=300' },
      '/js/config.js': { file: '/js/config.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/models.js': { file: '/js/models.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/audio.js': { file: '/js/audio.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/bosses.js': { file: '/js/bosses.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/cloud.js': { file: '/js/cloud.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/main.js': { file: '/js/main.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' }
    };

    if (request.method === 'GET' && STATIC_TEXT_WHITELIST[path]) {
      const entry = STATIC_TEXT_WHITELIST[path];
      const kvKey = 'txt_v3_' + entry.file.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const wantSync = url.searchParams.get('sync') === '1';
      let txt = wantSync ? null : await env.GAME_KV.get(kvKey);
      if (!txt) {
        const ref = url.searchParams.get('sha') || 'main';
        const ghUrl = 'https://raw.githubusercontent.com/Lilywittt/nailong-bike-game/' + encodeURIComponent(ref) + entry.file + '?t=' + Date.now();
        const resp = await fetch(ghUrl, { headers: { 'User-Agent': 'PelicanBrawlWorker/3.1' } });
        if (resp.ok) {
          txt = await resp.text();
          await env.GAME_KV.put(kvKey, txt);
        } else {
          txt = await env.GAME_KV.get(kvKey);
        }
      }
      if (!txt) return new Response('Game module syncing, please refresh.', { status: 503 });
      return new Response(txt, {
        status: 200,
        headers: {
          'Content-Type': entry.mime,
          'Cache-Control': entry.cache,
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
