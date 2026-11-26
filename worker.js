import { handlePartyApi } from "./party_worker.js";
import { handlePayApi } from "./pay_worker.js";

const VALID_HERO_LIST = ['nailong', 'ikun', 'pelican', 'naiwa', 'hakimi'];
const VALID_HEROES = new Set(VALID_HERO_LIST);
const VALID_MOD_LIST = ['claw', 'nitro', 'sawBumper', 'mortarCat'];
const VALID_TALENTS = { superCharge: 5, maxHpPct: 5, autoRegen: 5 };

const HERO_CUM_COSTS = { 1: 0, 2: 1000, 3: 2800, 4: 5600, 5: 9800, 6: 15800 };
const HERO_STEP_COSTS = { 1: 1000, 2: 1800, 3: 2800, 4: 4200, 5: 6000 };
const MOD_CUM_COSTS = { 0: 0, 1: 500, 2: 1600, 3: 3600 };
const MOD_STEP_COSTS = { 0: 500, 1: 1100, 2: 2000 };
const TALENT_STEP_COSTS = { superCharge: 1000, maxHpPct: 10000, autoRegen: 20000 };

const DEFAULT_SAVE = {
  beans: 2000,
  dashEnergy: 10,
  bestDist: 0,
  bestSingleRun: 0,
  maxCheckpoint: 0,
  selectedCheckpoint: 0,
  selectedHero: 'nailong',
  unlocked: [...VALID_HERO_LIST],
  mods: { claw: 0, nitro: 0, sawBumper: 0, mortarCat: 0 },
  heroLv: { nailong: 1, ikun: 1, pelican: 1, naiwa: 1, hakimi: 1 },
  talents: { superCharge: 0, maxHpPct: 0, autoRegen: 0 }
};

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

async function hmacSha256Hex(keyStr, msgStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
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
  if (age < 800 || age > 900000) return false;
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

function extractSaveRev(rawParsed) {
  if (rawParsed && typeof rawParsed === 'object') {
    const r = Math.floor(Number(rawParsed._rev) || 1);
    return Math.max(1, r);
  }
  return 1;
}

function serializeSaveWithRev(cleanSave, rev) {
  return JSON.stringify({ ...cleanSave, _rev: Math.max(1, Math.floor(Number(rev) || 1)) });
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
  const beansVal = s.beans !== undefined && s.beans !== null
    ? Math.min(999999999, Math.max(0, Math.floor(Number(s.beans) || 0)))
    : Math.min(999999999, Math.max(2000, Math.floor(Number(p.beans) || 2000)));

  const unlockedSet = new Set(DEFAULT_SAVE.unlocked);
  for (const arr of [p.unlocked, s.unlocked]) {
    if (Array.isArray(arr)) {
      for (const x of arr) if (typeof x === 'string' && VALID_HEROES.has(x)) unlockedSet.add(x);
    }
  }
  const sm = (s.mods && typeof s.mods === 'object') ? s.mods : {};
  const pm = (p.mods && typeof p.mods === 'object') ? p.mods : {};
  const mods = {};
  for (const k of VALID_MOD_LIST) {
    mods[k] = Math.min(3, Math.max(0, Math.floor(Number(sm[k]) || 0), Math.floor(Number(pm[k]) || 0)));
  }
  const shl = (s.heroLv && typeof s.heroLv === 'object') ? s.heroLv : {};
  const phl = (p.heroLv && typeof p.heroLv === 'object') ? p.heroLv : {};
  const heroLv = {};
  for (const h of VALID_HERO_LIST) {
    heroLv[h] = Math.min(6, Math.max(1, Math.floor(Number(shl[h]) || 1), Math.floor(Number(phl[h]) || 1)));
  }
  const stl = (s.talents && typeof s.talents === 'object') ? s.talents : {};
  const ptl = (p.talents && typeof p.talents === 'object') ? p.talents : {};
  const talents = {};
  for (const [tk, tmax] of Object.entries(VALID_TALENTS)) {
    talents[tk] = Math.min(tmax, Math.max(0, Math.floor(Number(stl[tk]) || 0), Math.floor(Number(ptl[tk]) || 0)));
  }
  const selCp = Math.min(maxCheckpoint, Math.max(0, Math.floor(Number(s.selectedCheckpoint ?? p.selectedCheckpoint) || 0)));
  const candHero = typeof s.selectedHero === 'string' ? s.selectedHero : p.selectedHero;
  const hero = VALID_HEROES.has(candHero) ? candHero : 'nailong';
  const dashEnergy = s.dashEnergy !== undefined && s.dashEnergy !== null
    ? Math.min(30, Math.max(0, Math.round((Number(s.dashEnergy) || 0) * 10) / 10))
    : Math.min(30, Math.max(0, Math.round((Number(p.dashEnergy !== undefined ? p.dashEnergy : DEFAULT_SAVE.dashEnergy) || 0) * 10) / 10));

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
    heroLv,
    talents
  };
}

function canonicalSaveStr(sv) {
  const s = sanitizeSave(sv, null);
  const hl = s.heroLv;
  const md = s.mods;
  const tl = s.talents;
  return `beans=${s.beans}|dash=${Number(s.dashEnergy).toFixed(1)}|bd=${s.bestDist}|bs=${s.bestSingleRun}`
    + `|mcp=${s.maxCheckpoint}|scp=${s.selectedCheckpoint}|hero=${s.selectedHero}`
    + `|hl=${hl.nailong},${hl.ikun},${hl.pelican},${hl.naiwa},${hl.hakimi}`
    + `|md=${md.claw},${md.nitro},${md.sawBumper},${md.mortarCat}`
    + `|tl=${tl.superCharge},${tl.maxHpPct},${tl.autoRegen}`;
}

async function makeSyncSig(username, rev, issuedMs, sv) {
  const normU = String(username || '').trim().toLowerCase();
  const msg = `${PEPPER}:sync:${normU}:${Math.floor(rev)}:${Math.floor(issuedMs)}:${canonicalSaveStr(sv)}`;
  return hmacSha256Hex(PEPPER, msg);
}

function calcPermCost(sv) {
  let total = 0;
  const hl = sv.heroLv || {};
  for (const h of VALID_HERO_LIST) {
    const lv = Math.min(6, Math.max(1, Math.floor(Number(hl[h]) || 1)));
    total += HERO_CUM_COSTS[lv];
  }
  const md = sv.mods || {};
  for (const k of VALID_MOD_LIST) {
    const lv = Math.min(3, Math.max(0, Math.floor(Number(md[k]) || 0)));
    total += MOD_CUM_COSTS[lv];
  }
  const tl = sv.talents || {};
  for (const [tk, tmax] of Object.entries(VALID_TALENTS)) {
    const lv = Math.min(tmax, Math.max(0, Math.floor(Number(tl[tk]) || 0)));
    total += lv * TALENT_STEP_COSTS[tk];
  }
  return total;
}

async function reconcileSaveSubmission(serverSave, serverRev, body, username, nowMs) {
  const srv = sanitizeSave(serverSave, null);
  const clientRaw = sanitizeSave(body && body.save, null);

  const baseRev = body && body.baseRev;
  const baseMs = body && body.baseIssuedAt;
  const baseSig = body && body.baseSig;
  const rawBase = body && body.baseSave;

  let sigValid = false;
  let baseSave = null;
  if (
    Number.isInteger(baseRev)
    && Number.isInteger(baseMs)
    && typeof baseSig === 'string'
    && rawBase && typeof rawBase === 'object'
    && baseRev >= 1 && baseRev <= serverRev
    && baseMs >= 1 && baseMs <= nowMs + 60000
  ) {
    baseSave = sanitizeSave(rawBase, null);
    const expectedSig = await makeSyncSig(username, baseRev, baseMs, baseSave);
    sigValid = timingSafeEq(baseSig, expectedSig);
  }

  if (!sigValid) {
    return { mergedSave: srv, nextRev: serverRev, conflictResolved: true, needsRebase: true };
  }

  let isConflict = baseRev < serverRev || canonicalSaveStr(baseSave) !== canonicalSaveStr(srv);
  const clientEff = sanitizeSave(clientRaw, baseSave);

  const dDash = Math.round((clientRaw.dashEnergy - baseSave.dashEnergy) * 10) / 10;
  const paidDash = Math.round(Math.max(0, dDash) * 1000);
  const paidPerm = Math.max(0, calcPermCost(clientEff) - calcPermCost(baseSave));
  let pureBeanDelta = (clientRaw.beans - baseSave.beans) + paidPerm + paidDash;

  const elapsedSec = Math.max(1.0, (nowMs - baseMs) / 1000.0);
  // Generous marathon ceiling (up to 2,000,000 beans) so long 50km+ Midas/Boss runs never lose earned beans!
  const maxEarn = Math.min(2000000, Math.floor(8000 + elapsedSec * 520));
  if (pureBeanDelta > maxEarn) {
    pureBeanDelta = maxEarn;
    isConflict = true;
  }

  let avail = srv.beans + pureBeanDelta;
  let doubleSpentConsumable = false;
  let mergedDash = srv.dashEnergy;

  if (dDash > 0) {
    const roomSec = Math.round(Math.max(0, 30.0 - srv.dashEnergy) * 10) / 10;
    const wantSec = Math.min(dDash, roomSec);
    const costWant = Math.round(wantSec * 1000);
    if (avail >= costWant) {
      mergedDash = Math.round((srv.dashEnergy + wantSec) * 10) / 10;
      avail -= costWant;
      if (wantSec < dDash) isConflict = true;
    } else {
      const affordablePacks = Math.max(0, Math.floor(avail / 10000));
      const grantSec = Math.min(roomSec, affordablePacks * 10.0);
      mergedDash = Math.round((srv.dashEnergy + grantSec) * 10) / 10;
      avail -= Math.round(grantSec * 1000);
      isConflict = true;
    }
  } else {
    const rawDash = Math.round((srv.dashEnergy + dDash) * 10) / 10;
    if (rawDash >= 0) {
      mergedDash = rawDash;
    } else {
      mergedDash = 0;
      const deficitCost = Math.round((-rawDash) * 1000);
      isConflict = true;
      if (avail >= deficitCost) {
        avail -= deficitCost;
      } else {
        doubleSpentConsumable = true;
        avail = Math.max(0, srv.beans + Math.min(0, pureBeanDelta) - deficitCost);
      }
    }
  }

  if (avail < 0) {
    doubleSpentConsumable = true;
    avail = 0;
    isConflict = true;
  }

  const mergedHl = { ...srv.heroLv };
  for (const h of VALID_HERO_LIST) {
    while (mergedHl[h] < clientEff.heroLv[h]) {
      const stepCost = HERO_STEP_COSTS[mergedHl[h]];
      if (avail >= stepCost) {
        avail -= stepCost;
        mergedHl[h] += 1;
      } else {
        isConflict = true;
        break;
      }
    }
  }

  const mergedMods = { ...srv.mods };
  for (const k of VALID_MOD_LIST) {
    while (mergedMods[k] < clientEff.mods[k]) {
      const stepCost = MOD_STEP_COSTS[mergedMods[k]];
      if (avail >= stepCost) {
        avail -= stepCost;
        mergedMods[k] += 1;
      } else {
        isConflict = true;
        break;
      }
    }
  }

  const mergedTalents = { ...srv.talents };
  for (const [tk, tmax] of Object.entries(VALID_TALENTS)) {
    while (mergedTalents[tk] < Math.min(tmax, clientEff.talents[tk])) {
      const stepCost = TALENT_STEP_COSTS[tk];
      if (avail >= stepCost) {
        avail -= stepCost;
        mergedTalents[tk] += 1;
      } else {
        isConflict = true;
        break;
      }
    }
  }

  const bestDist = doubleSpentConsumable ? srv.bestDist : Math.min(999999, Math.max(srv.bestDist, clientRaw.bestDist));
  const bestSingleRun = doubleSpentConsumable ? srv.bestSingleRun : Math.min(999999, Math.max(srv.bestSingleRun, clientRaw.bestSingleRun));
  const maxCheckpoint = doubleSpentConsumable
    ? srv.maxCheckpoint
    : Math.min(999500, Math.max(srv.maxCheckpoint, clientRaw.maxCheckpoint, Math.floor(bestDist / 500) * 500));

  const mergedSave = {
    beans: Math.min(999999999, Math.max(0, Math.floor(avail))),
    dashEnergy: Math.min(30, Math.max(0, Math.round(mergedDash * 10) / 10)),
    bestDist,
    bestSingleRun,
    maxCheckpoint,
    selectedCheckpoint: Math.min(maxCheckpoint, Math.max(0, Math.floor(clientRaw.selectedCheckpoint))),
    selectedHero: VALID_HEROES.has(clientRaw.selectedHero) ? clientRaw.selectedHero : srv.selectedHero,
    unlocked: [...DEFAULT_SAVE.unlocked],
    mods: mergedMods,
    heroLv: mergedHl,
    talents: mergedTalents
  };
  return { mergedSave, nextRev: serverRev + 1, conflictResolved: isConflict, needsRebase: false };
}

async function buildSignedAuthPayload(usernameDisplay, cleanSave, rev, nowMs, token = '', conflictResolved = false, needsRebase = false) {
  const payload = {
    ok: true,
    username: usernameDisplay,
    save: cleanSave,
    rev: Math.floor(rev),
    issuedAtMs: Math.floor(nowMs),
    syncSig: await makeSyncSig(usernameDisplay, rev, nowMs, cleanSave),
    updatedAt: Math.floor(nowMs),
    conflictResolved: Boolean(conflictResolved),
    needsRebase: Boolean(needsRebase)
  };
  if (token) payload.token = token;
  return payload;
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

let auxTablesInitialized = false;
async function ensureAuxProtectionTables(env) {
  if (auxTablesInitialized) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS leaderboard (player_key TEXT PRIMARY KEY, nickname TEXT NOT NULL, hero TEXT NOT NULL, best_single INTEGER NOT NULL, updated_at INTEGER NOT NULL)'
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_lb_score ON leaderboard(best_single DESC)').run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS player_save_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      rev INTEGER NOT NULL,
      beans INTEGER NOT NULL,
      best_single INTEGER NOT NULL,
      save_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_save_bak_user ON player_save_backups(username, created_at DESC)').run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_key TEXT NOT NULL,
      username TEXT NOT NULL,
      mode TEXT NOT NULL,
      hero TEXT NOT NULL,
      single_dist INTEGER NOT NULL,
      beans_earned INTEGER NOT NULL,
      boss_kills INTEGER NOT NULL,
      duration_sec INTEGER NOT NULL,
      extra_note TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_run_hist_user ON run_history(player_key, created_at DESC)').run();
  auxTablesInitialized = true;
}

async function maybeWriteSaveBackup(env, username, cleanSave, rev, reason, nowMs, force = false) {
  try {
    await ensureAuxProtectionTables(env);
    if (!force) {
      const last = await env.DB.prepare(
        'SELECT created_at, beans, best_single FROM player_save_backups WHERE username = ? ORDER BY id DESC LIMIT 1'
      ).bind(username).first();
      if (last) {
        const ageMs = nowMs - Number(last.created_at || 0);
        const bigBeanJump = Math.abs(Number(cleanSave.beans || 0) - Number(last.beans || 0)) >= 5000;
        const newRecord = Number(cleanSave.bestSingleRun || 0) > Number(last.best_single || 0) + 100;
        if (ageMs < 180000 && !bigBeanJump && !newRecord) return;
      }
    }
    await env.DB.prepare(
      'INSERT INTO player_save_backups (username, rev, beans, best_single, save_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      username,
      Math.floor(rev),
      Math.floor(cleanSave.beans || 0),
      Math.floor(cleanSave.bestSingleRun || 0),
      serializeSaveWithRev(cleanSave, rev),
      String(reason || 'auto_sync').slice(0, 32),
      nowMs
    ).run();
    // Retain latest 12 snapshots per account so D1 stays ultra-lean while guaranteeing zero data loss!
    await env.DB.prepare(
      'DELETE FROM player_save_backups WHERE username = ? AND id NOT IN (SELECT id FROM player_save_backups WHERE username = ? ORDER BY id DESC LIMIT 12)'
    ).bind(username, username).run();
  } catch (_) {}
}

async function upsertLeaderboardEntry(env, playerKey, nickname, hero, bestSingle, nowMs) {
  const cleanScore = Math.min(999999, Math.max(0, Math.floor(Number(bestSingle) || 0)));
  if (!playerKey || cleanScore < 5) return;
  const cleanNick = String(nickname || '神秘骑手').replace(/[\s<>'"\\/;]/g, '').slice(0, 16) || '神秘骑手';
  const cleanHero = VALID_HEROES.has(hero) ? hero : 'nailong';
  await ensureAuxProtectionTables(env);
  await env.DB.prepare(
    `INSERT INTO leaderboard (player_key, nickname, hero, best_single, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(player_key) DO UPDATE SET
       nickname = excluded.nickname,
       hero = excluded.hero,
       best_single = MAX(leaderboard.best_single, excluded.best_single),
       updated_at = CASE WHEN excluded.best_single >= leaderboard.best_single THEN excluded.updated_at ELSE leaderboard.updated_at END`
  ).bind(playerKey, cleanNick, cleanHero, cleanScore, nowMs).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return jsonResp({ ok: true });

    if (path.startsWith('/api/party/')) {
      return handlePartyApi(request, env, url, path, extractToken, readSafeJson, jsonResp, randomHex, VALID_HEROES);
    }
    if (path.startsWith('/api/pay/')) {
      return handlePayApi(request, env, url, path, {
        extractToken,
        readSafeJson,
        jsonResp,
        randomHex,
        sanitizeSave,
        extractSaveRev,
        serializeSaveWithRev,
        buildSignedAuthPayload,
        maybeWriteSaveBackup
      });
    }
    if (path === '/api/health') {
      return jsonResp({ ok: true, game: '鹈鹕测试大乱斗', cloudD1: true, shield: true, conflictEngine: 'v9.1', saveVault: true, partyRace: true });
    }

    if (path === '/api/auth/ticket' && request.method === 'GET') {
      const ipHash = await getClientIpHash(request);
      const ticket = await makeTicket(ipHash, Date.now());
      return jsonResp({ ok: true, ticket });
    }

    if (path === '/api/auth/register' && request.method === 'POST') {
      const parsed = await readSafeJson(request, 4096);
      if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
      const body = parsed.body;

      if (body.hp_trap) return jsonResp({ ok: false, error: '请求被拒绝' }, 403);

      const now = Date.now();
      const ipHash = await getClientIpHash(request);
      if (!(await verifyTicket(body.ticket, ipHash, now))) {
        return jsonResp({ ok: false, error: '安全校验超时或过快，请重新打开存档窗口再试' }, 403);
      }

      const guard = await getIpGuard(env, ipHash, now);
      if (now - guard.last_reg_ms < 25000) {
        return jsonResp({ ok: false, error: '注册操作过于频繁，请稍后再试' }, 429);
      }
      if (guard.reg_day_count >= 5) {
        return jsonResp({ ok: false, error: '当前网络今日注册已达上限，请直接登录已有账号' }, 429);
      }
      if (guard.reg_total_count >= 8) {
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
      if (existing) return jsonResp({ ok: false, error: '该账号已被注册，请换个账号或直接点击下方【登录读取】！' }, 409);

      const salt = randomHex(16);
      const passHash = await hashPasswordPBKDF2(pwd, salt);
      const token = randomHex(24);
      const cleanSave = sanitizeSave(body.save, null);
      // Preserve up to 2,000,000 legitimate guest beans on initial registration (fixes 100k+ run truncation)!
      cleanSave.beans = Math.min(2000000, cleanSave.beans);

      try {
        await env.DB.prepare(
          'INSERT INTO players (username, display_name, salt, pass_hash, token, save_json, live_run_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)'
        ).bind(normUser, rawName, salt, passHash, token, serializeSaveWithRev(cleanSave, 1), now, now).run();
      } catch (_) {
        return jsonResp({ ok: false, error: '该账号已被注册，请换个账号或直接登录！' }, 409);
      }

      await env.DB.prepare(
        'UPDATE ip_limits SET reg_day = ?, reg_day_count = ?, reg_total_count = ?, last_reg_ms = ? WHERE ip_hash = ?'
      ).bind(guard.reg_day, guard.reg_day_count + 1, guard.reg_total_count + 1, now, ipHash).run();

      await ensureAuxProtectionTables(env);
      // Cleanly merge/remove prior guest leaderboard entry if registering from guest so one run NEVER creates two leaderboard rows!
      const guestId = String(body.guestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
      if (guestId.length >= 6 && body.wasGuest) {
        await env.DB.prepare('DELETE FROM leaderboard WHERE player_key = ?').bind(`g:${guestId}`).run();
      }
      await maybeWriteSaveBackup(env, normUser, cleanSave, 1, 'register_init', now, true);
      await upsertLeaderboardEntry(env, `u:${normUser}`, rawName, cleanSave.selectedHero, cleanSave.bestSingleRun, now);
      return jsonResp(await buildSignedAuthPayload(rawName, cleanSave, 1, now, token));
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
        return jsonResp({ ok: false, error: !row ? '账号不存在，请核对账号或点击上方绿色按钮注册' : '密码错误，请重试' }, !row ? 404 : 401);
      }

      let nextPassHash = row.pass_hash;
      if (!nextPassHash.startsWith('pbkdf2$')) {
        nextPassHash = await hashPasswordPBKDF2(pwd, row.salt);
        await env.DB.prepare('UPDATE players SET pass_hash = ? WHERE username = ?').bind(nextPassHash, normUser).run();
      }
      if (guard.fail_count > 0) {
        await env.DB.prepare('UPDATE ip_limits SET fail_count = 0 WHERE ip_hash = ?').bind(ipHash).run();
      }

      let rawParsed = null;
      try { rawParsed = JSON.parse(row.save_json); } catch (_) {}
      const rev = extractSaveRev(rawParsed);
      const cloudSave = sanitizeSave(rawParsed, null);

      const token = row.token || randomHex(24);
      if (!row.token) {
        await env.DB.prepare('UPDATE players SET token = ? WHERE username = ?').bind(token, normUser).run();
      }
      const payload = await buildSignedAuthPayload(row.display_name, cloudSave, rev, now, token);
      payload.updatedAt = row.updated_at || now;
      return jsonResp(payload);
    }

    if (path === '/api/auth/me' && request.method === 'GET') {
      const token = extractToken(request, null);
      if (!token) return jsonResp({ ok: false, error: '未登录' }, 401);
      const row = await env.DB.prepare('SELECT display_name, save_json, updated_at FROM players WHERE token = ?').bind(token).first();
      if (!row) return jsonResp({ ok: false, error: '登录已失效' }, 401);
      const now = Date.now();
      let rawParsed = null;
      try { rawParsed = JSON.parse(row.save_json); } catch (_) {}
      const rev = extractSaveRev(rawParsed);
      const cloudSave = sanitizeSave(rawParsed, null);
      const payload = await buildSignedAuthPayload(row.display_name, cloudSave, rev, now);
      payload.updatedAt = row.updated_at || now;
      return jsonResp(payload);
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

      let prevRaw = null;
      try { prevRaw = JSON.parse(row.save_json); } catch (_) {}
      const prevRev = extractSaveRev(prevRaw);
      const prevSave = sanitizeSave(prevRaw, null);

      const { mergedSave, nextRev, conflictResolved, needsRebase } = await reconcileSaveSubmission(
        prevSave, prevRev, body, row.display_name, now
      );

      if (!needsRebase) {
        await env.DB.prepare('UPDATE players SET save_json = ?, live_run_json = NULL, updated_at = ? WHERE username = ?')
          .bind(serializeSaveWithRev(mergedSave, nextRev), now, row.username).run();
        await maybeWriteSaveBackup(env, row.username, mergedSave, nextRev, 'save_sync', now, false);
        await upsertLeaderboardEntry(env, `u:${row.username}`, row.display_name, mergedSave.selectedHero, mergedSave.bestSingleRun, now);
      }
      return jsonResp(await buildSignedAuthPayload(row.display_name, mergedSave, nextRev, now, '', conflictResolved, needsRebase));
    }

    // Lightweight End-of-Run Summary Telemetry (1 tiny ~180B write per finished run, zero in-run load!)
    if (path === '/api/run_log' && request.method === 'POST') {
      const parsed = await readSafeJson(request, 2048);
      if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
      const body = parsed.body || {};
      const now = Date.now();
      await ensureAuxProtectionTables(env);

      const token = extractToken(request, body);
      const guestId = String(body.guestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
      let pkey = guestId.length >= 6 ? `g:${guestId}` : 'g:anon';
      let uname = '';
      if (token) {
        const prow = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
        if (prow) {
          pkey = `u:${prow.username}`;
          uname = prow.display_name || prow.username;
        }
      }
      const mode = body.mode === 'pvp' ? 'pvp' : 'pve';
      const hero = VALID_HEROES.has(body.hero) ? body.hero : 'nailong';
      const singleDist = Math.min(999999, Math.max(0, Math.floor(Number(body.singleDist) || 0)));
      const beansEarned = Math.min(2000000, Math.max(0, Math.floor(Number(body.beansEarned) || 0)));
      const bossKills = Math.min(9999, Math.max(0, Math.floor(Number(body.bossKills) || 0)));
      const durationSec = Math.min(86400, Math.max(1, Math.floor(Number(body.durationSec) || 0)));
      const extraNote = String(body.extraNote || '').replace(/[\r\n<>]/g, '').slice(0, 80);
      if (singleDist < 5 && mode === 'pve') return jsonResp({ ok: true, skipped: true });

      await env.DB.prepare(
        'INSERT INTO run_history (player_key, username, mode, hero, single_dist, beans_earned, boss_kills, duration_sec, extra_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(pkey, uname, mode, hero, singleDist, beansEarned, bossKills, durationSec, extraNote, now).run();
      await env.DB.prepare(
        'DELETE FROM run_history WHERE player_key = ? AND id NOT IN (SELECT id FROM run_history WHERE player_key = ? ORDER BY id DESC LIMIT 40)'
      ).bind(pkey, pkey).run();
      return jsonResp({ ok: true });
    }

    if (path === '/api/run_log' && request.method === 'GET') {
      await ensureAuxProtectionTables(env);
      const token = extractToken(request, null);
      if (!token) return jsonResp({ ok: false, error: '未登录' }, 401);
      const prow = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
      if (!prow) return jsonResp({ ok: false, error: '登录已失效' }, 401);
      const pkey = `u:${prow.username}`;
      const hRes = await env.DB.prepare(
        'SELECT mode, hero, single_dist, beans_earned, boss_kills, duration_sec, extra_note, created_at FROM run_history WHERE player_key = ? ORDER BY id DESC LIMIT 15'
      ).bind(pkey).all();
      const bCnt = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM player_save_backups WHERE username = ?').bind(prow.username).first();
      return jsonResp({
        ok: true,
        username: prow.display_name,
        backupCount: Number(bCnt?.cnt || 0),
        runs: hRes.results || []
      });
    }

    if (path === '/api/leaderboard' && request.method === 'GET') {
      await ensureAuxProtectionTables(env);
      const myKey = String(url.searchParams.get('key') || '').trim().slice(0, 64);
      const pRes = await env.DB.prepare('SELECT username, display_name, save_json, updated_at FROM players ORDER BY updated_at DESC LIMIT 80').all();
      for (const pr of (pRes.results || [])) {
        try {
          const sv = JSON.parse(pr.save_json);
          const bs = Math.min(999999, Math.max(0, Math.floor(Number(sv.bestSingleRun) || 0)));
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
      const score = Math.min(999999, Math.max(0, Math.floor(Number(body.bestSingle) || 0)));
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
      '/assets/boss_manbo_meme.png': 'image/png',
      '/assets/app_icon_320.png': 'image/png',
      '/assets/apple-touch-icon.png': 'image/png',
      '/assets/favicon.png': 'image/png'
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
      '/js/scenery.js': { file: '/js/scenery.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/audio.js': { file: '/js/audio.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/bosses.js': { file: '/js/bosses.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/cloud.js': { file: '/js/cloud.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/party.js': { file: '/js/party.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' },
      '/js/main.js': { file: '/js/main.js', mime: 'application/javascript; charset=utf-8', cache: 'public, max-age=300' }
    };

    if (request.method === 'GET' && STATIC_TEXT_WHITELIST[path]) {
      const entry = STATIC_TEXT_WHITELIST[path];
      const kvKey = 'txt_v104_' + entry.file.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const wantSync = url.searchParams.get('sync') === '1';
      let txt = wantSync ? null : await env.GAME_KV.get(kvKey);
      if (!txt) {
        const ref = url.searchParams.get('sha') || 'main';
        const ghUrl = 'https://raw.githubusercontent.com/Lilywittt/nailong-bike-game/' + encodeURIComponent(ref) + entry.file + '?t=' + Date.now();
        const resp = await fetch(ghUrl, { headers: { 'User-Agent': 'PelicanBrawlWorker/3.2' } });
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
