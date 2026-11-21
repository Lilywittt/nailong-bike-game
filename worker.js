// Cloudflare Full-Stack Worker for 《鹈鹕测试大乱斗》 (Pelican Test Brawl)
// Bindings: DB (Cloudflare D1: pelican-brawl-db), GAME_KV (Cloudflare KV: nailong-bike-game-kv)

const DEFAULT_SAVE = {
  beans: 260,
  bestDist: 0,
  maxCheckpoint: 0,
  selectedCheckpoint: 0,
  selectedHero: 'nailong',
  unlocked: ['ikun', 'pelican', 'naiwa', 'nailong'],
  mods: { claw: 0, nitro: 0, sawBumper: 0, mortarCat: 0 }
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
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

function sanitizeSave(raw, prev = null) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const p = (prev && typeof prev === 'object') ? prev : {};
  const bestDist = Math.max(0, Math.floor(Number(s.bestDist) || 0), Math.floor(Number(p.bestDist) || 0));
  const maxCheckpoint = Math.max(
    0,
    Math.floor(Number(s.maxCheckpoint) || 0),
    Math.floor(Number(p.maxCheckpoint) || 0),
    Math.floor(bestDist / 500) * 500
  );
  const beansVal = s.beans !== undefined ? Math.max(0, Math.floor(Number(s.beans) || 0)) : Math.max(260, Math.floor(Number(p.beans) || 260));
  const unlockedSet = new Set([
    ...DEFAULT_SAVE.unlocked,
    ...(Array.isArray(p.unlocked) ? p.unlocked.filter(x => typeof x === 'string') : []),
    ...(Array.isArray(s.unlocked) ? s.unlocked.filter(x => typeof x === 'string') : [])
  ]);
  const sm = (s.mods && typeof s.mods === 'object') ? s.mods : {};
  const pm = (p.mods && typeof p.mods === 'object') ? p.mods : {};
  const mods = {};
  for (const k of ['claw', 'nitro', 'sawBumper', 'mortarCat']) {
    mods[k] = Math.min(3, Math.max(0, Math.floor(Number(sm[k]) || 0), Math.floor(Number(pm[k]) || 0)));
  }
  const selCp = Math.min(maxCheckpoint, Math.max(0, Math.floor(Number(s.selectedCheckpoint ?? p.selectedCheckpoint) || 0)));
  const hero = typeof s.selectedHero === 'string' ? s.selectedHero : (typeof p.selectedHero === 'string' ? p.selectedHero : 'nailong');
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

function sanitizeLiveRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dist = Math.floor(Number(raw.dist) || 0);
  const hp = Math.floor(Number(raw.hp) || 0);
  if (dist < 20 || hp <= 0) return null;
  return {
    dist,
    beans: Math.max(0, Math.floor(Number(raw.beans) || 0)),
    hp: Math.min(5, hp),
    heroId: typeof raw.heroId === 'string' ? raw.heroId : 'nailong',
    superCharge: Math.min(100, Math.max(0, Math.floor(Number(raw.superCharge) || 0)))
  };
}

function extractToken(request, body) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (body && typeof body.token === 'string') return body.token.trim();
  return '';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return jsonResp({ ok: true });
    }

    if (path === '/api/health') {
      return jsonResp({ ok: true, game: '鹈鹕测试大乱斗', d1: Boolean(env.DB) });
    }

    if (path === '/api/auth/register' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return jsonResp({ ok: false, error: '请求格式错误' }, 400); }
      const rawName = String(body.username || '').trim();
      const pwd = String(body.password || '');
      if (rawName.length < 2 || rawName.length > 24 || /\s/.test(rawName)) {
        return jsonResp({ ok: false, error: '账号需为2~24位字符（不含空格）' }, 400);
      }
      if (pwd.length < 4 || pwd.length > 64) {
        return jsonResp({ ok: false, error: '密码长度需为4~64位' }, 400);
      }
      const normUser = rawName.toLowerCase();
      const existing = await env.DB.prepare('SELECT username FROM players WHERE username = ?').bind(normUser).first();
      if (existing) {
        return jsonResp({ ok: false, error: '该账号已被注册，请换个账号或直接登录！' }, 409);
      }
      const salt = randomHex(16);
      const passHash = await sha256Hex(`${salt}:${pwd}`);
      const token = randomHex(24);
      const cleanSave = sanitizeSave(body.save, null);
      const cleanLive = sanitizeLiveRun(body.liveRun);
      const now = Date.now();
      try {
        await env.DB.prepare(
          'INSERT INTO players (username, display_name, salt, pass_hash, token, save_json, live_run_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(normUser, rawName, salt, passHash, token, JSON.stringify(cleanSave), cleanLive ? JSON.stringify(cleanLive) : null, now, now).run();
      } catch (_) {
        return jsonResp({ ok: false, error: '该账号已被注册，请换个账号或直接登录！' }, 409);
      }
      return jsonResp({ ok: true, username: rawName, token, save: cleanSave, liveRun: cleanLive, updatedAt: now });
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return jsonResp({ ok: false, error: '请求格式错误' }, 400); }
      const rawName = String(body.username || '').trim();
      const pwd = String(body.password || '');
      if (!rawName || !pwd) {
        return jsonResp({ ok: false, error: '请输入账号和密码' }, 400);
      }
      const normUser = rawName.toLowerCase();
      const row = await env.DB.prepare('SELECT * FROM players WHERE username = ?').bind(normUser).first();
      if (!row) {
        return jsonResp({ ok: false, error: '账号不存在，请核对账号或点击注册' }, 404);
      }
      const calcHash = await sha256Hex(`${row.salt}:${pwd}`);
      if (calcHash !== row.pass_hash) {
        return jsonResp({ ok: false, error: '密码错误，请重试' }, 401);
      }
      let cloudSave = DEFAULT_SAVE;
      try { cloudSave = sanitizeSave(JSON.parse(row.save_json), null); } catch (_) {}
      let cloudLive = null;
      try { if (row.live_run_json) cloudLive = sanitizeLiveRun(JSON.parse(row.live_run_json)); } catch (_) {}

      // If guest played locally before logging in and beat their cloud milestone, preserve higher milestones without losing cloud wallet!
      if (body.guestSave && typeof body.guestSave === 'object') {
        const merged = sanitizeSave(cloudSave, body.guestSave);
        merged.beans = Math.max(cloudSave.beans, Number(body.guestSave.beans) > 260 ? Math.floor(Number(body.guestSave.beans)) : cloudSave.beans);
        if (JSON.stringify(merged) !== JSON.stringify(cloudSave)) {
          cloudSave = merged;
          await env.DB.prepare('UPDATE players SET save_json = ?, updated_at = ? WHERE username = ?')
            .bind(JSON.stringify(cloudSave), Date.now(), normUser).run();
        }
      }

      const token = row.token || randomHex(24);
      if (!row.token) {
        await env.DB.prepare('UPDATE players SET token = ? WHERE username = ?').bind(token, normUser).run();
      }
      return jsonResp({
        ok: true,
        username: row.display_name,
        token,
        save: cloudSave,
        liveRun: cloudLive,
        updatedAt: row.updated_at
      });
    }

    if (path === '/api/auth/me' && request.method === 'GET') {
      const token = extractToken(request, null);
      if (!token) return jsonResp({ ok: false, error: '未登录' }, 401);
      const row = await env.DB.prepare('SELECT display_name, save_json, live_run_json, updated_at FROM players WHERE token = ?').bind(token).first();
      if (!row) return jsonResp({ ok: false, error: '登录已失效' }, 401);
      let cloudSave = DEFAULT_SAVE;
      try { cloudSave = sanitizeSave(JSON.parse(row.save_json), null); } catch (_) {}
      let cloudLive = null;
      try { if (row.live_run_json) cloudLive = sanitizeLiveRun(JSON.parse(row.live_run_json)); } catch (_) {}
      return jsonResp({ ok: true, username: row.display_name, save: cloudSave, liveRun: cloudLive, updatedAt: row.updated_at });
    }

    if (path === '/api/save' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) { return jsonResp({ ok: false, error: '请求格式错误' }, 400); }
      const token = extractToken(request, body);
      if (!token) return jsonResp({ ok: false, error: '未登录' }, 401);
      const row = await env.DB.prepare('SELECT username, display_name, save_json FROM players WHERE token = ?').bind(token).first();
      if (!row) return jsonResp({ ok: false, error: '登录已失效' }, 401);
      let prevSave = null;
      try { prevSave = JSON.parse(row.save_json); } catch (_) {}
      const mergedSave = sanitizeSave(body.save, prevSave);
      const cleanLive = sanitizeLiveRun(body.liveRun);
      const now = Date.now();
      await env.DB.prepare('UPDATE players SET save_json = ?, live_run_json = ?, updated_at = ? WHERE username = ?')
        .bind(JSON.stringify(mergedSave), cleanLive ? JSON.stringify(cleanLive) : null, now, row.username).run();
      return jsonResp({ ok: true, username: row.display_name, save: mergedSave, liveRun: cleanLive, updatedAt: now });
    }

    // Serve Game HTML from KV (with ?sync=1&sha=... refresh from GitHub)
    const KV_HTML_KEY = 'pelican_brawl_html_v1';
    const wantSync = url.searchParams.get('sync') === '1';
    let html = wantSync ? null : await env.GAME_KV.get(KV_HTML_KEY);
    if (!html) {
      const ref = url.searchParams.get('sha') || 'main';
      const ghUrl = `https://raw.githubusercontent.com/Lilywittt/nailong-bike-game/${encodeURIComponent(ref)}/index.html?t=${Date.now()}`;
      const resp = await fetch(ghUrl, { headers: { 'User-Agent': 'PelicanBrawlWorker/1.0' } });
      if (resp.ok) {
        html = await resp.text();
        await env.GAME_KV.put(KV_HTML_KEY, html);
      } else {
        html = await env.GAME_KV.get(KV_HTML_KEY) || await env.GAME_KV.get('index_html');
      }
    }
    if (!html) {
      return new Response('Game syncing, please refresh in a moment.', { status: 503 });
    }
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  }
};
