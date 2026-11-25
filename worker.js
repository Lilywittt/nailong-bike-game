// Hardened Full-Stack Cloudflare Worker for 《鹈鹕测试大乱斗》 (Pelican Test Brawl v6.2)
// Security: PBKDF2-SHA256 (100k iter), CF-Connecting-IP Sliding Quotas, Brute-Force Lockout,
// Signed Timing Ticket + Honeypot, 4KB Body Cap, Schema Whitelist & HMAC-Signed 3-Way Conservation Merge.

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
  const maxEarn = Math.min(60000, Math.floor(1500 + elapsedSec * 180));
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

async function ensureLeaderboardTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS leaderboard (player_key TEXT PRIMARY KEY, nickname TEXT NOT NULL, hero TEXT NOT NULL, best_single INTEGER NOT NULL, updated_at INTEGER NOT NULL)'
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_lb_score ON leaderboard(best_single DESC)').run();
}

// ==================== CLOUDFLARE D1 ATOMIC ONLINE PARTY RACE ENGINE (v6.9) ====================
let partyTableInitialized = false;
const PARTY_COUNTDOWN_MS = 3200;
const PARTY_ROOM_IDLE_TTL_MS = 15 * 60 * 1000;
const PARTY_CORE_MODULES = [
  'ikun_trampoline',
  'canyon_skyrail',
  'truck_gauntlet',
  'wave_coaster',
  'split_decker',
  'maodie_ambush',
  'mega_vault',
  'narrow_brawl',
  'turbo_chicane'
];
const PARTY_VALID_ITEMS = new Set([
  'melee_bump',
  'timed_shield',
  'ddj_rush',
  'bean_nitro',
  'naiwa_swarm',
  'truck_isekai',
  'dagou_bite',
  'bball_rain',
  'lawyer_seal',
  'maodie_trap',
  'pelican_carry',
  'manbo_steal',
  'lightning_whip',
  'kun_rocket',
  'pan_shield',
  'hero_skill_hit'
]);
const PARTY_ITEM_DAMAGE = {
  truck_isekai: 50,
  lightning_whip: 45,
  naiwa_swarm: 42,
  dagou_bite: 38,
  bball_rain: 36,
  maodie_trap: 34,
  pelican_carry: 32,
  manbo_steal: 30,
  lawyer_seal: 30,
  melee_bump: 30
};
const PARTY_ITEM_BANNERS = {
  melee_bump: '🐔 遭到对手贴脸铁山靠猛撞！',
  naiwa_swarm: '🐸 遭到狂笑奶蛙大军砸脸压车！',
  truck_isekai: '🚛 警报！对手召唤大运泥头车创飞了你！',
  dagou_bite: '🐕 对手放出巨型大狗嚼死死拽住你后轮！',
  bball_rain: '🏀 遭到对手燃烧篮球陨石雨轰炸！',
  lawyer_seal: '📜 遭到对手律师函糊脸警告！',
  maodie_trap: '😾 遭到圆头耄耋猫群扑脸抓挠！',
  pelican_carry: '🦢 被对手召唤巨型鹈鹕顺丰强行倒叼半空！',
  manbo_steal: '🐴 遭到曼波偷速音波袭击！',
  lightning_whip: '🔔 遭到雷霆少林巨钟当头镇压成铁饼！'
};
const PARTY_BOT_PERSONAS = [
  ['🤖 抽象大帝', 'ikun'],
  ['🤖 圆头耄耋王', 'hakimi'],
  ['🤖 背带顺丰王', 'pelican'],
  ['🤖 狂笑冒牌龙', 'naiwa'],
  ['🤖 喷火大头王', 'nailong']
];

async function ensurePartyRoomsTable(env) {
  if (partyTableInitialized) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS party_rooms (room_code TEXT PRIMARY KEY, status TEXT NOT NULL, is_quickmatch INTEGER NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL, state_json TEXT NOT NULL)'
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_party_qm ON party_rooms(is_quickmatch, status, updated_at)').run();
  partyTableInitialized = true;
}

function partyCleanId(rawId) {
  const s = String(rawId || '').trim().replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 48);
  return s.length >= 3 ? s : `p_${randomHex(5)}`;
}

function partyCleanNick(rawNick, fallback = '派对骑手') {
  const s = String(rawNick || '').trim().replace(/[\r\n\t<>'"\\/;]/g, '').slice(0, 16);
  return s.length >= 1 ? s : fallback;
}

function partyCleanHero(rawHero) {
  const h = String(rawHero || '').trim();
  return VALID_HEROES.has(h) ? h : 'nailong';
}

function partyCleanRoomCode(rawCode) {
  return String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function hashRoomCodeNum(code) {
  let acc = 0;
  for (let i = 0; i < code.length; i++) acc = (acc * 31 + code.charCodeAt(i)) >>> 0;
  return acc;
}

async function resolvePartyAccountKey(env, token, fallbackUser) {
  if (token) {
    const row = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
    if (row && row.username) {
      return {
        accountKey: `user:${String(row.username).trim().toLowerCase()}`,
        accountName: String(row.display_name || row.username).trim()
      };
    }
  }
  const cleanFb = String(fallbackUser || '').trim().replace(/[\s<>'"\\/;]/g, '').slice(0, 20);
  if (cleanFb.length >= 2) {
    return { accountKey: `user:${cleanFb.toLowerCase()}`, accountName: cleanFb };
  }
  return { accountKey: '', accountName: '' };
}

function generatePartyModulePlan(trackSeed, raceDist) {
  let state = ((Number(trackSeed) ^ 0x9e3779b9) >>> 0) || 0x6d2b79f5;
  const nextRand = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
  const midCount = Math.max(3, Math.round(Math.max(510, Number(raceDist) - 300) / 170));
  const pool = [...PARTY_CORE_MODULES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = nextRand() % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const middle = [];
  while (middle.length < midCount) {
    for (const modId of pool) {
      if (middle.length >= midCount) break;
      if (middle.length && middle[middle.length - 1] === modId) {
        const alt = pool[(pool.indexOf(modId) + 1) % pool.length];
        middle.push(alt);
      } else {
        middle.push(modId);
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = nextRand() % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  return ['start_launchpad', ...middle, 'final_sprint'];
}

function makePartyPlayerState(playerId, slot, nickname, heroId, nowMs, isBot = false, accountKey = '', accountName = '') {
  const p = {
    playerId,
    slot,
    nickname,
    heroId,
    accountKey,
    accountName,
    isBot: Boolean(isBot),
    ready: Boolean(isBot),
    x: 120.0,
    y: 0.0,
    vx: 0.0,
    vy: 0.0,
    dist: 0.0,
    hp: 100,
    maxHp: 100,
    animState: { onGround: true, striking: false, shieldActive: false, rocketActive: false, dizzy: false, clamped: false },
    shieldUntilMs: 0,
    shieldConsumedAtMs: 0,
    oneHitShieldUntilMs: 0,
    oneHitConsumedAtMs: 0,
    rocketUntilMs: 0,
    speech: '',
    speechUntilMs: 0,
    itemsUsed: 0,
    itemsLanded: 0,
    finishedServerMs: null,
    finishedClientMs: null,
    elapsedMs: null,
    inbox: [],
    lastSyncMs: nowMs
  };
  if (isBot) {
    p._bot = {
      lastTickMs: nowMs,
      nextCrateDist: 70.0,
      heldItem: '',
      useItemAtMs: 0,
      aliveSec: 0.0,
      koUntilMs: 0,
      nextHazardCheckM: 95.0,
      slowUntilMs: 0,
      slowMult: 1.0,
      stunUntilMs: 0,
      clampedUntilMs: 0,
      boostUntilMs: 0,
      boostMult: 1.0,
      hopPhase: 0.0
    };
  }
  return p;
}

function publicPartyPlayerView(p, nowMs) {
  if (!p) return null;
  const anim = (p.animState && typeof p.animState === 'object') ? p.animState : {};
  const shieldOn = (Number(p.shieldUntilMs || 0) > nowMs)
    || (Boolean(anim.shieldActive) && (nowMs - Number(p.shieldConsumedAtMs || 0) > 1500));
  const oneHitOn = (Number(p.oneHitShieldUntilMs || 0) > nowMs)
    || (Boolean(anim.oneHitShield) && (nowMs - Number(p.oneHitConsumedAtMs || 0) > 1500));
  const rocketOn = (Number(p.rocketUntilMs || 0) > nowMs) || Boolean(anim.rocketActive);
  const speech = Number(p.speechUntilMs || 0) > nowMs ? p.speech : '';
  return {
    playerId: p.playerId,
    slot: p.slot,
    nickname: p.nickname,
    heroId: p.heroId,
    isBot: Boolean(p.isBot),
    ready: Boolean(p.ready || p.isBot),
    x: Math.round(Number(p.x || 120) * 10) / 10,
    y: Math.round(Number(p.y || 0) * 10) / 10,
    vx: Math.round(Number(p.vx || 0) * 10) / 10,
    vy: Math.round(Number(p.vy || 0) * 10) / 10,
    dist: Math.round(Number(p.dist || 0) * 10) / 10,
    hp: Number(p.hp ?? 100),
    animState: anim,
    shieldActive: shieldOn,
    oneHitShield: oneHitOn,
    rocketActive: rocketOn,
    speech: speech || String(anim.speech || '').slice(0, 32),
    itemsUsed: Number(p.itemsUsed || 0),
    itemsLanded: Number(p.itemsLanded || 0),
    finished: p.finishedServerMs !== null && p.finishedServerMs !== undefined,
    elapsedMs: p.elapsedMs,
    staleMs: p.isBot ? 0 : Math.max(0, nowMs - Number(p.lastSyncMs || nowMs))
  };
}

function buildPartyRoomResponse(room, callerId, nowMs, drainInbox = false) {
  const caller = room.players[callerId] || null;
  let rival = null;
  for (const [pid, pobj] of Object.entries(room.players)) {
    if (pid !== callerId) { rival = pobj; break; }
  }
  let incoming = [];
  if (caller && drainInbox && Array.isArray(caller.inbox) && caller.inbox.length) {
    incoming = [...caller.inbox];
    caller.inbox = [];
  }
  const activeTraps = (room.trackTraps || []).filter((t) => t && t.active);
  return {
    ok: true,
    roomCode: room.roomCode,
    status: room.status,
    isQuickmatch: Boolean(room.isQuickmatch),
    raceDist: room.raceDist,
    trackSeed: room.trackSeed,
    modulePlan: room.modulePlan,
    startAtMs: room.startAtMs,
    serverNowMs: nowMs,
    you: publicPartyPlayerView(caller, nowMs),
    rival: publicPartyPlayerView(rival, nowMs),
    incomingEvents: incoming,
    trackTraps: activeTraps,
    results: room.results || [],
    rematchVotes: Array.isArray(room.rematchVotes) ? [...room.rematchVotes].sort() : [],
    playerCount: Object.keys(room.players).length
  };
}

function forfeitPartyPlayer(room, quitterId, reason, nowMs) {
  room.isQuickmatch = false;
  const quitter = room.players[quitterId];
  const otherHumans = Object.values(room.players).filter((p) => p.playerId !== quitterId && !p.isBot);
  if ((room.status === 'countdown' || room.status === 'racing') && otherHumans.length && quitter) {
    const survivor = otherHumans[0];
    const oldNick = quitter.nickname || '对手';
    const startRef = Number(room.startAtMs || room.createdAtMs || nowMs);
    const elapsed = Math.max(1000, nowMs - startRef);
    survivor.finishedServerMs = nowMs;
    survivor.finishedClientMs = nowMs;
    survivor.elapsedMs = elapsed;
    room.status = 'finished';
    room.results = [
      {
        place: 1,
        title: '🥇 对手退赛判胜',
        rewardBeans: 500,
        playerId: survivor.playerId,
        nickname: survivor.nickname,
        heroId: survivor.heroId,
        isBot: false,
        dist: Math.round(Number(survivor.dist || 0) * 10) / 10,
        elapsedMs: elapsed,
        finishedServerMs: nowMs,
        itemsLanded: Number(survivor.itemsLanded || 0),
        itemsUsed: Number(survivor.itemsUsed || 0),
        forfeited: false
      },
      {
        place: 2,
        title: reason === 'disconnect' ? '📡 掉线判负' : '🏳️ 中途退赛',
        rewardBeans: 0,
        playerId: quitter.playerId,
        nickname: oldNick,
        heroId: quitter.heroId,
        isBot: Boolean(quitter.isBot),
        dist: Math.round(Number(quitter.dist || 0) * 10) / 10,
        elapsedMs: null,
        finishedServerMs: nowMs,
        itemsLanded: Number(quitter.itemsLanded || 0),
        itemsUsed: Number(quitter.itemsUsed || 0),
        forfeited: true,
        forfeitReason: reason
      }
    ];
    delete room.players[quitterId];
    room.rematchVotes = (room.rematchVotes || []).filter((v) => v !== quitterId);
    survivor.inbox = survivor.inbox || [];
    survivor.inbox.push({
      eventId: `forfeit_${quitterId}_${nowMs}`,
      type: 'rival_forfeit_win',
      fromNick: oldNick,
      reason
    });
    room.updatedAtMs = nowMs;
    return false;
  }
  delete room.players[quitterId];
  room.rematchVotes = (room.rematchVotes || []).filter((v) => v !== quitterId);
  const humansLeft = Object.values(room.players).filter((p) => !p.isBot);
  return humansLeft.length === 0;
}

function recomputePartyResults(room, nowMs) {
  const finishedPlayers = Object.values(room.players).filter((p) => p.finishedServerMs !== null && p.finishedServerMs !== undefined);
  finishedPlayers.sort(
    (a, b) => Number(a.finishedServerMs) - Number(b.finishedServerMs)
      || Number(a.finishedClientMs || a.finishedServerMs) - Number(b.finishedClientMs || b.finishedServerMs)
  );
  room.results = finishedPlayers.map((fp, idx) => {
    const place = idx + 1;
    return {
      place,
      title: place === 1 ? '🥇 冠军梗王' : '🥈 惜败乐子人',
      rewardBeans: place === 1 ? 500 : 200,
      playerId: fp.playerId,
      nickname: fp.nickname,
      heroId: fp.heroId,
      isBot: Boolean(fp.isBot),
      dist: Math.round(Number(fp.dist || room.raceDist) * 10) / 10,
      elapsedMs: Number(fp.elapsedMs || Math.max(1000, Number(fp.finishedServerMs) - Number(room.startAtMs || room.createdAtMs))),
      finishedServerMs: Number(fp.finishedServerMs),
      itemsLanded: Number(fp.itemsLanded || 0),
      itemsUsed: Number(fp.itemsUsed || 0)
    };
  });
  const totalPlayers = Object.keys(room.players).length;
  if (totalPlayers >= 2 && finishedPlayers.length >= totalPlayers) {
    room.status = 'finished';
  } else if (finishedPlayers.length >= 1) {
    const firstMs = Number(finishedPlayers[0].finishedServerMs);
    if (nowMs - firstMs >= 16000) {
      for (const up of Object.values(room.players)) {
        if (up.finishedServerMs === null || up.finishedServerMs === undefined) {
          up.finishedServerMs = nowMs;
          up.elapsedMs = Math.max(1000, nowMs - Number(room.startAtMs || room.createdAtMs));
        }
      }
      recomputePartyResults(room, nowMs);
    }
  }
}

function applyOffensiveHitToBot(botP, itemId, nowMs, reflected = false) {
  const bs = botP._bot;
  if (!bs) return;
  if (itemId === 'bball_rain') {
    bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 2600);
    bs.slowMult = 0.62;
    botP.speech = !reflected ? '🏀 哎哟我的中分头！' : '🥘 被自己篮球砸中了！';
  } else if (itemId === 'lawyer_seal') {
    bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 3000);
    bs.slowMult = Math.min(bs.slowUntilMs > nowMs ? bs.slowMult : 1.0, 0.80);
    botP.speech = '📜 律师函糊脸看不见路！';
  } else if (itemId === 'pelican_carry') {
    bs.clampedUntilMs = Math.max(bs.clampedUntilMs, nowMs + 1300);
    botP.speech = '🦢 救命！被鹈鹕叼走了！';
  } else if (itemId === 'manbo_steal') {
    bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 3200);
    bs.slowMult = 0.72;
    botP.speech = '🐴 曼波把我的车速偷了！';
  } else if (itemId === 'maodie_trap') {
    bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 2400);
    bs.slowMult = 0.55;
    botP.speech = '😾 哎哟被耄耋扑脸！';
  } else if (itemId === 'naiwa_swarm') {
    bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 2600);
    bs.slowMult = 0.44;
    botP.speech = '🐸 救命满脸都是冒牌奶蛙！';
  } else if (itemId === 'truck_isekai') {
    bs.stunUntilMs = Math.max(bs.stunUntilMs, nowMs + 1250);
    botP.speech = '🚛 哇啊被泥头车创飞了！';
  } else if (itemId === 'dagou_bite') {
    bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 2300);
    bs.slowMult = 0.40;
    botP.speech = '🐕 别咬我车屁股啊大狗嚼！';
  } else if (itemId === 'melee_bump') {
    bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 1200);
    bs.slowMult = 0.52;
    botP.speech = '🐔 哎哟贴脸铁山靠！';
  } else if (itemId === 'lightning_whip') {
    bs.stunUntilMs = Math.max(bs.stunUntilMs, nowMs + 1150);
    botP.speech = '🔔 哎哟大铜钟扣头上了！';
  }
  botP.speechUntilMs = nowMs + 1800;
}

function processPartyItemEvent(room, caller, rival, evt, nowMs) {
  if (!evt || typeof evt !== 'object') return;
  const rawEid = String(evt.eventId || '').trim().slice(0, 80);
  const eventId = rawEid.replace(/[^A-Za-z0-9_:-]/g, '') || `evt_${caller.playerId}_${nowMs}_${(room.processedEventIds || []).length}`;
  room.processedEventIds = room.processedEventIds || [];
  if (room.processedEventIds.includes(eventId)) return;
  room.processedEventIds.push(eventId);
  if (room.processedEventIds.length > 400) room.processedEventIds = room.processedEventIds.slice(-250);

  const itemId = String(evt.itemId || '').trim();
  if (!PARTY_VALID_ITEMS.has(itemId)) return;

  caller.itemsUsed = Number(caller.itemsUsed || 0) + 1;
  caller.speech = '';
  caller.speechUntilMs = 0;

  if (itemId === 'timed_shield') {
    caller.oneHitShieldUntilMs = nowMs + 7000;
    caller.oneHitConsumedAtMs = 0;
    return;
  }
  if (itemId === 'pan_shield') {
    caller.shieldUntilMs = nowMs + 4500;
    caller.shieldConsumedAtMs = 0;
    return;
  }
  if (itemId === 'kun_rocket') {
    caller.rocketUntilMs = nowMs + 3000;
    if (caller.isBot && caller._bot) {
      caller._bot.boostUntilMs = nowMs + 3000;
      caller._bot.boostMult = 2.05;
    }
    if (rival && !rival.isBot) {
      rival.inbox.push({ eventId: `${eventId}_cast_notice`, type: 'rival_boost_notice', itemId, fromNick: caller.nickname });
    }
    return;
  }
  if (itemId === 'ddj_rush') {
    caller.rocketUntilMs = Math.max(Number(caller.rocketUntilMs || 0), nowMs + 1450);
    if (caller.isBot && caller._bot) {
      caller._bot.boostUntilMs = Math.max(caller._bot.boostUntilMs, nowMs + 1450);
      caller._bot.boostMult = 1.82;
    }
    return;
  }
  if (itemId === 'bean_nitro') {
    caller.rocketUntilMs = Math.max(Number(caller.rocketUntilMs || 0), nowMs + 2650);
    if (caller.isBot && caller._bot) {
      caller._bot.boostUntilMs = Math.max(caller._bot.boostUntilMs, nowMs + 2650);
      caller._bot.boostMult = 1.54;
    }
    return;
  }

  if (itemId === 'hero_skill_hit') {
    if (!rival) return;
    const rAnim = (rival.animState && typeof rival.animState === 'object') ? rival.animState : {};
    const rOneHit = (Number(rival.oneHitShieldUntilMs || 0) > nowMs)
      || (Boolean(rAnim.oneHitShield) && (nowMs - Number(rival.oneHitConsumedAtMs || 0) > 1500));
    if (rOneHit) {
      rival.oneHitShieldUntilMs = 0;
      rival.oneHitConsumedAtMs = nowMs;
      if (rival.animState) rival.animState.oneHitShield = false;
      if (!rival.isBot) rival.inbox.push({ eventId: `${eventId}_skblk`, type: 'one_hit_shield_block', itemId: 'melee_bump' });
      if (!caller.isBot) caller.inbox.push({ eventId: `${eventId}_skblk_ack`, type: 'attack_blocked_ack', itemId: 'melee_bump' });
      return;
    }
    const dmg = Math.min(45, Math.max(16, Math.floor(Number(evt.dmg) || 30)));
    const curHp = Number(rival.hp ?? 100) - dmg;
    if (curHp <= 0) {
      rival.hp = 100;
      caller.itemsLanded = Number(caller.itemsLanded || 0) + 1;
      if (rival.isBot && rival._bot) {
        rival._bot.koUntilMs = nowMs + 2400;
        rival._bot.aliveSec = 0;
        rival.speech = '💀 被技能击毙！速度归零重跑！';
        rival.speechUntilMs = nowMs + 2200;
      } else if (!rival.isBot) {
        rival.inbox.push({ eventId: `${eventId}_ko_v`, type: 'hero_ko_victim', fromNick: caller.nickname });
      }
      if (!caller.isBot) caller.inbox.push({ eventId: `${eventId}_ko_k`, type: 'hero_ko_killer', targetNick: rival.nickname });
    } else {
      rival.hp = curHp;
      if (!rival.isBot) rival.inbox.push({ eventId: `${eventId}_skhurt`, type: 'hero_skill_hurt', dmg, fromNick: caller.nickname });
      if (!caller.isBot) caller.inbox.push({ eventId: `${eventId}_skack`, type: 'hero_skill_ack', dmg, rivalHp: curHp });
    }
    return;
  }

  if (caller.isBot && caller._bot) {
    const bs = caller._bot;
    if (itemId === 'pelican_carry') { bs.boostUntilMs = Math.max(bs.boostUntilMs, nowMs + 2500); bs.boostMult = 1.45; }
    else if (itemId === 'manbo_steal') { bs.boostUntilMs = Math.max(bs.boostUntilMs, nowMs + 3200); bs.boostMult = 1.34; }
    else if (itemId === 'lightning_whip') { bs.boostUntilMs = Math.max(bs.boostUntilMs, nowMs + 1450); bs.boostMult = 1.68; }
  }
  if (!rival) return;

  const rAnim = (rival.animState && typeof rival.animState === 'object') ? rival.animState : {};
  const rivalShielded = (Number(rival.shieldUntilMs || 0) > nowMs)
    || (Boolean(rAnim.shieldActive) && (nowMs - Number(rival.shieldConsumedAtMs || 0) > 1500));
  if (rivalShielded) {
    rival.shieldUntilMs = 0;
    rival.shieldConsumedAtMs = nowMs;
    if (rival.animState) rival.animState.shieldActive = false;
    rival.itemsLanded = Number(rival.itemsLanded || 0) + 1;
    rival.speech = '🥘 铁锅反弹！露出鸡脚了吧！';
    rival.speechUntilMs = nowMs + 2600;
    if (!rival.isBot) {
      rival.inbox.push({
        eventId: `${eventId}_shield_win`,
        type: 'shield_reflect_win',
        itemId,
        fromId: caller.playerId,
        fromNick: caller.nickname,
        reflected: true
      });
    }
    if (caller.isBot) applyOffensiveHitToBot(caller, itemId, nowMs, true);
    else {
      caller.inbox.push({
        eventId: `${eventId}_reflected`,
        type: 'attack',
        itemId,
        fromId: rival.playerId,
        fromNick: rival.nickname,
        targetId: caller.playerId,
        reflected: true
      });
    }
    return;
  }

  const rivalOneHit = (Number(rival.oneHitShieldUntilMs || 0) > nowMs)
    || (Boolean(rAnim.oneHitShield) && (nowMs - Number(rival.oneHitConsumedAtMs || 0) > 1500));
  if (rivalOneHit) {
    rival.oneHitShieldUntilMs = 0;
    rival.oneHitConsumedAtMs = nowMs;
    if (rival.animState) rival.animState.oneHitShield = false;
    if (!rival.isBot) rival.inbox.push({ eventId: `${eventId}_onehit_block`, type: 'one_hit_shield_block', itemId, fromId: caller.playerId, fromNick: caller.nickname });
    if (!caller.isBot) caller.inbox.push({ eventId: `${eventId}_blk_ack`, type: 'attack_blocked_ack', itemId, targetNick: rival.nickname });
    return;
  }

  caller.itemsLanded = Number(caller.itemsLanded || 0) + 1;
  const itemDmg = Number(PARTY_ITEM_DAMAGE[itemId] || 35);
  const nextHp = Number(rival.hp ?? 100) - itemDmg;
  const lethalKo = nextHp <= 0;
  rival.hp = lethalKo ? 100 : nextHp;
  if (!caller.isBot) {
    caller.inbox.push({
      eventId: `${eventId}_hit_ack`,
      type: 'attack_hit_confirm',
      itemId,
      dmg: itemDmg,
      lethalKo,
      targetNick: rival.nickname,
      comboHits: caller.itemsLanded
    });
  }
  if (rival.isBot) {
    applyOffensiveHitToBot(rival, itemId, nowMs, false);
    if (lethalKo && rival._bot) {
      rival._bot.koUntilMs = nowMs + 2400;
      rival._bot.aliveSec = 0;
      rival.speech = '💀 血条被打空！速度归零！';
      rival.speechUntilMs = nowMs + 2200;
    }
  } else {
    rival.inbox.push({
      eventId,
      type: 'attack',
      itemId,
      dmg: itemDmg,
      lethalKo,
      fromId: caller.playerId,
      fromNick: caller.nickname,
      targetId: rival.playerId,
      reflected: false,
      banner: PARTY_ITEM_BANNERS[itemId] || '💥 遭到对手梗道具袭击！'
    });
  }
}

function tickPartyBot(room, botP, humanP, nowMs) {
  const bs = botP._bot;
  if (!bs) return;
  const prevMs = Number(bs.lastTickMs || nowMs);
  bs.lastTickMs = nowMs;
  if (room.status !== 'countdown' && room.status !== 'racing') return;
  const startAt = Number(room.startAtMs || nowMs);
  if (nowMs < startAt) {
    botP.x = 120; botP.dist = 0; botP.vx = 0;
    return;
  }
  if (room.status === 'countdown') room.status = 'racing';
  if (botP.finishedServerMs !== null && botP.finishedServerMs !== undefined) {
    botP.vx = 0;
    return;
  }
  const dt = Math.min(0.25, Math.max(0, (nowMs - prevMs) / 1000));
  if (dt <= 0.0001) return;

  const humanDist = humanP ? Number(humanP.dist || 0) : 0;
  const botDist = Number(botP.dist || 0);
  const gapM = humanDist - botDist;
  const rocketOn = nowMs < Number(botP.rocketUntilMs || 0);
  const shieldOn = nowMs < Number(botP.shieldUntilMs || 0);
  let koCrawling = nowMs < Number(bs.koUntilMs || 0);

  if (koCrawling) bs.aliveSec = 0;
  else bs.aliveSec = Math.min(40.0, Number(bs.aliveSec || 0) + dt);
  const botAliveMult = 1.0 + Math.min(1.0, Number(bs.aliveSec) / 40.0);

  if (botP.dist >= Number(bs.nextHazardCheckM || 95)) {
    bs.nextHazardCheckM = botP.dist + 115;
    if (gapM < -24 && (nowMs % 5 === 0) && !rocketOn) {
      botP.hp = Math.max(0, Number(botP.hp ?? 100) - 38);
      if (botP.hp <= 0) {
        botP.hp = 100;
        bs.koUntilMs = nowMs + 2200;
        bs.aliveSec = 0;
        koCrawling = true;
        botP.speech = '💥 撞障翻车！加速归零！';
        botP.speechUntilMs = nowMs + 1800;
      }
    }
  }

  let baseSpd = 365 * botAliveMult;
  if (gapM > 16) baseSpd *= Math.min(1.36, 1 + (gapM - 16) * 0.011);
  else if (gapM < -20) baseSpd *= Math.max(0.76, 1 + (gapM + 20) * 0.009);

  const clamped = nowMs < Number(bs.clampedUntilMs || 0);
  const stunned = nowMs < Number(bs.stunUntilMs || 0);
  let spd = baseSpd;
  if (koCrawling) spd = 58;
  else if (stunned) spd = 65;
  else if (clamped) spd = 95;
  else {
    if (nowMs < Number(bs.boostUntilMs || 0)) spd *= Number(bs.boostMult || 1.35);
    if (!rocketOn && nowMs < Number(bs.slowUntilMs || 0)) spd *= Number(bs.slowMult || 0.65);
  }

  if (humanP) {
    const hx = Number(humanP.x || 120);
    const dxPx = hx - Number(botP.x || 120);
    const absDx = Math.abs(dxPx);
    if (absDx > 150) {
      const pullV = Math.min(72, (absDx - 150) * 0.065);
      if (dxPx > 0) spd += pullV;
      else spd = Math.max(145, spd - pullV * (rocketOn ? 0.16 : 0.48));
    }
  }

  botP.vx = spd;
  botP.x += spd * dt;
  botP.dist = Math.max(0, (botP.x - 120) / 18);

  bs.hopPhase = (Number(bs.hopPhase || 0) + dt * 1.9) % (Math.PI * 2);
  const hopSin = Math.sin(bs.hopPhase);
  const inAir = hopSin > 0.58 || clamped;
  const hopLift = clamped ? -95 : (inAir ? -Math.max(0, (hopSin - 0.58) / 0.42) * 86 : 0);
  const tWave = Math.max(0, botP.x - 380) * 0.0016;
  const roadY = Math.sin(tWave) * 20 + Math.sin(tWave * 2.1 + 1.1) * 9;
  botP.y = roadY + hopLift;
  botP.vy = inAir ? -220 : 0;
  botP.animState = {
    onGround: !inAir,
    striking: (Math.floor(nowMs / 220) % 13 === 0) && !stunned,
    shieldActive: shieldOn,
    rocketActive: rocketOn,
    koCrawl: koCrawling,
    dizzy: stunned || (nowMs < Number(bs.slowUntilMs || 0) && Number(bs.slowMult || 1) <= 0.58),
    clamped
  };

  if (botP.dist >= Number(bs.nextCrateDist || 75) && botP.dist < Number(room.raceDist) - 45) {
    bs.nextCrateDist = botP.dist + 160 + ((nowMs % 5) * 14);
    if (!bs.heldItem) {
      const choices = gapM > 18
        ? ['truck_isekai', 'naiwa_swarm', 'dagou_bite', 'pelican_carry', 'kun_rocket', 'ddj_rush', 'lightning_whip']
        : ['naiwa_swarm', 'truck_isekai', 'dagou_bite', 'bball_rain', 'maodie_trap', 'timed_shield', 'ddj_rush', 'bean_nitro', 'pan_shield', 'manbo_steal'];
      bs.heldItem = choices[Math.floor(nowMs / 97) % choices.length];
      bs.useItemAtMs = nowMs + 1500 + (nowMs % 1300);
    }
  }
  if (bs.heldItem && nowMs >= Number(bs.useItemAtMs || 0) && !stunned && !clamped) {
    const chosen = bs.heldItem;
    bs.heldItem = '';
    processPartyItemEvent(room, botP, humanP, { eventId: `bot_evt_${room.roomCode}_${nowMs}`, itemId: chosen }, nowMs);
  }
  if (botP.dist >= Number(room.raceDist) && (botP.finishedServerMs === null || botP.finishedServerMs === undefined)) {
    botP.dist = Number(room.raceDist);
    botP.x = 120 + Number(room.raceDist) * 18;
    botP.finishedServerMs = nowMs;
    botP.finishedClientMs = nowMs;
    botP.elapsedMs = Math.max(1000, nowMs - startAt);
    recomputePartyResults(room, nowMs);
  }
}

async function prunePartyRoomsD1(env, nowMs) {
  await ensurePartyRoomsTable(env);
  await env.DB.prepare(
    'DELETE FROM party_rooms WHERE updated_at < ? OR (status = ? AND is_quickmatch = 1 AND updated_at < ?) OR (status = ? AND is_quickmatch = 0 AND updated_at < ?)'
  ).bind(nowMs - PARTY_ROOM_IDLE_TTL_MS, 'waiting', nowMs - 120000, 'waiting', nowMs - 300000).run();
}

async function createPartyRoomD1(env, playerId, nickname, heroId, raceDist, nowMs, isQuickmatch, accountKey, accountName, customCode = '') {
  await prunePartyRoomsD1(env, nowMs);
  if (customCode) {
    const existing = await env.DB.prepare('SELECT status, updated_at FROM party_rooms WHERE room_code = ?').bind(customCode).first();
    if (existing) {
      if (existing.status === 'finished' && (nowMs - Number(existing.updated_at || 0)) > 15000) {
        await env.DB.prepare('DELETE FROM party_rooms WHERE room_code = ?').bind(customCode).run();
      } else {
        return { errorResp: jsonResp({ ok: false, error: `房号【${customCode}】已被使用，请换一个房号或直接点击“加入”进房！` }, 409) };
      }
    }
    const randArr = new Uint32Array(1);
    crypto.getRandomValues(randArr);
    const trackSeed = (randArr[0] % 1900000000) + 100000;
    const modulePlan = generatePartyModulePlan(trackSeed, raceDist);
    const p1 = makePartyPlayerState(playerId, 1, nickname, heroId, nowMs, false, accountKey, accountName);
    const room = {
      roomCode: customCode,
      hostId: playerId,
      status: 'waiting',
      isQuickmatch: false,
      raceDist,
      trackSeed,
      modulePlan,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      startAtMs: null,
      players: { [playerId]: p1 },
      processedEventIds: [],
      trackTraps: [],
      results: [],
      rematchVotes: []
    };
    const ins = await env.DB.prepare(
      'INSERT OR IGNORE INTO party_rooms (room_code, status, is_quickmatch, rev, updated_at, state_json) VALUES (?, ?, 0, 1, ?, ?)'
    ).bind(customCode, 'waiting', nowMs, JSON.stringify(room)).run();
    if (ins.meta && ins.meta.changes > 0) return { room };
    return { errorResp: jsonResp({ ok: false, error: `房号【${customCode}】刚刚被抢注，请换一个房号或直接加入！` }, 409) };
  }

  for (let attempt = 0; attempt < 16; attempt++) {
    const randArr = new Uint32Array(2);
    crypto.getRandomValues(randArr);
    const roomCode = String((randArr[0] % 9000) + 1000);
    const trackSeed = (randArr[1] % 1900000000) + 100000;
    const modulePlan = generatePartyModulePlan(trackSeed, raceDist);
    const p1 = makePartyPlayerState(playerId, 1, nickname, heroId, nowMs, false, accountKey, accountName);
    const room = {
      roomCode,
      hostId: playerId,
      status: 'waiting',
      isQuickmatch: Boolean(isQuickmatch),
      raceDist,
      trackSeed,
      modulePlan,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      startAtMs: null,
      players: { [playerId]: p1 },
      processedEventIds: [],
      trackTraps: [],
      results: [],
      rematchVotes: []
    };
    const res = await env.DB.prepare(
      'INSERT OR IGNORE INTO party_rooms (room_code, status, is_quickmatch, rev, updated_at, state_json) VALUES (?, ?, ?, 1, ?, ?)'
    ).bind(roomCode, 'waiting', isQuickmatch ? 1 : 0, nowMs, JSON.stringify(room)).run();
    if (res.meta && res.meta.changes > 0) return { room };
  }
  throw new Error('Room allocation busy');
}

async function mutatePartyRoomCAS(env, roomCode, nowMs, mutatorFn) {
  await ensurePartyRoomsTable(env);
  let lastRoom = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 6 * attempt + (nowMs % 5)));
    }
    const row = await env.DB.prepare('SELECT rev, state_json FROM party_rooms WHERE room_code = ?').bind(roomCode).first();
    if (!row) return { notFound: true };
    const rev = Number(row.rev || 1);
    const room = JSON.parse(row.state_json);
    lastRoom = room;
    const outcome = mutatorFn(room, nowMs);
    if (outcome && outcome.abortResp) return outcome;
    if (outcome && outcome.deleteRoom) {
      await env.DB.prepare('DELETE FROM party_rooms WHERE room_code = ?').bind(roomCode).run();
      return outcome;
    }
    const upd = await env.DB.prepare(
      'UPDATE party_rooms SET status = ?, is_quickmatch = ?, rev = ?, updated_at = ?, state_json = ? WHERE room_code = ? AND rev = ?'
    ).bind(
      room.status,
      room.isQuickmatch && room.status === 'waiting' && Object.keys(room.players).length < 2 ? 1 : 0,
      rev + 1,
      nowMs,
      JSON.stringify(room),
      roomCode,
      rev
    ).run();
    if (upd.meta && upd.meta.changes > 0) return { room, ...outcome };
  }
  const latestRow = await env.DB.prepare('SELECT state_json FROM party_rooms WHERE room_code = ?').bind(roomCode).first();
  if (latestRow && latestRow.state_json) {
    try { lastRoom = JSON.parse(latestRow.state_json); } catch (_) {}
  }
  return { conflict: true, latestRoom: lastRoom };
}

async function upsertLeaderboardEntry(env, playerKey, nickname, hero, bestSingle, nowMs) {
  const cleanScore = Math.min(25000, Math.max(0, Math.floor(Number(bestSingle) || 0)));
  if (!playerKey || cleanScore < 5) return;
  const cleanNick = String(nickname || '神秘骑手').replace(/[\s<>'"\\/;]/g, '').slice(0, 16) || '神秘骑手';
  const cleanHero = VALID_HEROES.has(hero) ? hero : 'nailong';
  await ensureLeaderboardTable(env);
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

    if (path === '/api/health') {
      return jsonResp({ ok: true, game: '鹈鹕测试大乱斗', cloudD1: true, shield: true, conflictEngine: 'v6.2' });
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
      cleanSave.beans = Math.min(30000, cleanSave.beans);

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
        return jsonResp({ ok: false, error: !row ? '账号不存在，请核对账号或点击注册' : '密码错误，请重试' }, !row ? 404 : 401);
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
        await upsertLeaderboardEntry(env, `u:${row.username}`, row.display_name, mergedSave.selectedHero, mergedSave.bestSingleRun, now);
      }
      return jsonResp(await buildSignedAuthPayload(row.display_name, mergedSave, nextRev, now, '', conflictResolved, needsRebase));
    }

    if (path === '/api/leaderboard' && request.method === 'GET') {
      await ensureLeaderboardTable(env);
      const myKey = String(url.searchParams.get('key') || '').trim().slice(0, 64);
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

    // ==================== ONLINE MULTIPLAYER PARTY RACE ENDPOINTS (D1 CAS v7.0) ====================
    if (path === '/api/party/room' && request.method === 'GET') {
      const rcode = partyCleanRoomCode(url.searchParams.get('roomCode') || '');
      const pid = partyCleanId(url.searchParams.get('playerId') || '');
      const qsHero = String(url.searchParams.get('heroId') || '').trim();
      const now = Date.now();
      await prunePartyRoomsD1(env, now);
      if (rcode.length < 2) return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
      const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
        if (room.players[pid]) {
          room.players[pid].lastSyncMs = nowMs;
          room.updatedAtMs = nowMs;
          if (VALID_HEROES.has(qsHero) && (room.status === 'waiting' || room.status === 'finished')) {
            room.players[pid].heroId = qsHero;
          }
        }
        if (room.status === 'finished') {
          for (const [opId, opObj] of Object.entries(room.players)) {
            if (opId !== pid && !opObj.isBot && (nowMs - Number(opObj.lastSyncMs || nowMs)) > 22000) {
              const del = forfeitPartyPlayer(room, opId, 'disconnect', nowMs);
              if (del) return { deleteRoom: true };
            }
          }
        }
        return {};
      });
      if (res.conflict && res.latestRoom) {
        return jsonResp(buildPartyRoomResponse(res.latestRoom, pid, now, false));
      }
      if (res.notFound || res.deleteRoom || !res.room) {
        return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
      }
      return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
    }

    if (path.startsWith('/api/party/') && request.method === 'POST') {
      const parsed = await readSafeJson(request, 8192);
      if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
      const body = parsed.body || {};
      const now = Date.now();

      if (path === '/api/party/create') {
        const pid = partyCleanId(body.playerId);
        const nick = partyCleanNick(body.nickname, '派对房主');
        const hero = partyCleanHero(body.heroId);
        const rawCustom = String(body.customCode || '').trim();
        const customCode = partyCleanRoomCode(rawCustom);
        if (rawCustom.length > 0 && customCode.length < 2) {
          return jsonResp({ ok: false, error: '自定义房号需为 2~8 位数字或字母！' }, 400);
        }
        const { accountKey, accountName } = await resolvePartyAccountKey(env, extractToken(request, body), body.authUser || '');
        const raceDist = Math.min(5000, Math.max(1200, Math.floor(Number(body.raceDist) || 3500)));
        const created = await createPartyRoomD1(env, pid, nick, hero, raceDist, now, false, accountKey, accountName, customCode);
        if (created.errorResp) return created.errorResp;
        return jsonResp(buildPartyRoomResponse(created.room, pid, now, false));
      }

      if (path === '/api/party/set_hero') {
        const rcode = partyCleanRoomCode(body.roomCode);
        const pid = partyCleanId(body.playerId);
        const hero = partyCleanHero(body.heroId);
        const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
          if (!room.players[pid]) return { abortResp: jsonResp({ ok: false, error: '房间不存在或已过期' }, 404) };
          if (room.status === 'waiting' || room.status === 'finished') {
            room.players[pid].heroId = hero;
            if (body.nickname) room.players[pid].nickname = partyCleanNick(body.nickname, room.players[pid].nickname);
            room.players[pid].lastSyncMs = nowMs;
            room.updatedAtMs = nowMs;
          }
          return {};
        });
        if (res.abortResp) return res.abortResp;
        if (res.conflict && res.latestRoom) return jsonResp(buildPartyRoomResponse(res.latestRoom, pid, now, false));
        if (res.notFound || !res.room) return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
        return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
      }

      if (path === '/api/party/ready') {
        const rcode = partyCleanRoomCode(body.roomCode);
        const pid = partyCleanId(body.playerId);
        const wantReady = body.ready !== undefined ? Boolean(body.ready) : true;
        const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
          const caller = room.players[pid];
          if (!caller) return { abortResp: jsonResp({ ok: false, error: '房间不存在或已过期' }, 404) };
          caller.lastSyncMs = nowMs;
          room.updatedAtMs = nowMs;
          if (VALID_HEROES.has(body.heroId) && room.status === 'waiting') caller.heroId = body.heroId;
          if (body.nickname && room.status === 'waiting') caller.nickname = partyCleanNick(body.nickname, caller.nickname);
          if (room.status === 'waiting') {
            caller.ready = wantReady;
            const plist = Object.values(room.players);
            if (plist.length >= 2 && plist.every((p) => Boolean(p.ready || p.isBot))) {
              room.status = 'countdown';
              room.isQuickmatch = false;
              room.startAtMs = nowMs + PARTY_COUNTDOWN_MS;
              for (const pobj of plist) {
                pobj.lastSyncMs = nowMs;
              }
            }
          }
          return {};
        });
        if (res.abortResp) return res.abortResp;
        if (res.conflict && res.latestRoom) return jsonResp(buildPartyRoomResponse(res.latestRoom, pid, now, false));
        if (res.notFound || !res.room) return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
        return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
      }

      if (path === '/api/party/join') {
        const rcode = partyCleanRoomCode(body.roomCode);
        const pid = partyCleanId(body.playerId);
        const nick = partyCleanNick(body.nickname, '挑战骑手');
        const hero = partyCleanHero(body.heroId);
        if (rcode.length < 2) return jsonResp({ ok: false, error: '请输入正确的 2~8 位房间号！' }, 400);
        const { accountKey, accountName } = await resolvePartyAccountKey(env, extractToken(request, body), body.authUser || '');
        await prunePartyRoomsD1(env, now);

        const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
          if (room.players[pid]) {
            if (room.status === 'waiting') {
              room.players[pid].nickname = nick;
              room.players[pid].heroId = hero;
            }
            room.players[pid].lastSyncMs = nowMs;
            room.updatedAtMs = nowMs;
            return {};
          }
          if (accountKey && Object.values(room.players).some((op) => !op.isBot && op.accountKey === accountKey)) {
            return {
              abortResp: jsonResp({ ok: false, error: `不能用相同账号【${accountName || nick}】同房互匹！请在另一窗口切换其他账号登录` }, 409)
            };
          }
          if (Object.keys(room.players).length >= 2 || room.status !== 'waiting') {
            return { abortResp: jsonResp({ ok: false, error: '该房间已满员或已发车，请创建新房间或使用快速匹配！' }, 409) };
          }
          room.players[pid] = makePartyPlayerState(pid, 2, nick, hero, nowMs, false, accountKey, accountName);
          // Stay in 'waiting' so BOTH players see each other, pick heroes, and click Ready!
          room.isQuickmatch = false;
          for (const pobj of Object.values(room.players)) {
            pobj.lastSyncMs = nowMs;
          }
          room.updatedAtMs = nowMs;
          return {};
        });
        if (res.abortResp) return res.abortResp;
        if (res.notFound || !res.room) return jsonResp({ ok: false, error: '房间号不存在或已过期，请核对房间号！' }, 404);
        return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
      }

      if (path === '/api/party/quickmatch') {
        const pid = partyCleanId(body.playerId);
        const nick = partyCleanNick(body.nickname, '派对骑手');
        const hero = partyCleanHero(body.heroId);
        const raceDist = Math.min(5000, Math.max(1200, Math.floor(Number(body.raceDist) || 3500)));
        const { accountKey, accountName } = await resolvePartyAccountKey(env, extractToken(request, body), body.authUser || '');
        await prunePartyRoomsD1(env, now);

        const openRows = await env.DB.prepare(
          'SELECT room_code, state_json FROM party_rooms WHERE is_quickmatch = 1 AND status = ? ORDER BY updated_at ASC LIMIT 12'
        ).bind('waiting').all();

        for (const qr of (openRows.results || [])) {
          let qrm = null;
          try { qrm = JSON.parse(qr.state_json); } catch (_) {}
          if (!qrm || qrm.status !== 'waiting') continue;
          if (qrm.players[pid] && Object.keys(qrm.players).length === 1) {
            const reuse = await mutatePartyRoomCAS(env, qr.room_code, now, (room, nowMs) => {
              if (!room.players[pid] || Object.keys(room.players).length !== 1) return { abortResp: true };
              room.players[pid].nickname = nick;
              room.players[pid].heroId = hero;
              room.players[pid].lastSyncMs = nowMs;
              room.updatedAtMs = nowMs;
              return {};
            });
            if (reuse.room) {
              const out = buildPartyRoomResponse(reuse.room, pid, now, false);
              out.matched = false;
              return jsonResp(out);
            }
          }
          if (accountKey && !qrm.players[pid] && Object.values(qrm.players).some((op) => !op.isBot && op.accountKey === accountKey)) {
            return jsonResp({ ok: false, error: `账号【${accountName || nick}】已在另一窗口匹配中，不能同号互匹！请切换其他账号登录` }, 409);
          }
        }

        for (const qr of (openRows.results || [])) {
          const claim = await mutatePartyRoomCAS(env, qr.room_code, now, (room, nowMs) => {
            if (room.status !== 'waiting' || Object.keys(room.players).length !== 1 || room.players[pid]) {
              return { abortResp: true };
            }
            if (accountKey && Object.values(room.players).some((op) => !op.isBot && op.accountKey === accountKey)) {
              return { abortResp: true };
            }
            room.players[pid] = makePartyPlayerState(pid, 2, nick, hero, nowMs, false, accountKey, accountName);
            // Enter Ready Room together in 'waiting' so both players click Ready before countdown!
            room.isQuickmatch = false;
            for (const pobj of Object.values(room.players)) {
              pobj.lastSyncMs = nowMs;
            }
            room.updatedAtMs = nowMs;
            return {};
          });
          if (claim.room) {
            const out = buildPartyRoomResponse(claim.room, pid, now, false);
            out.matched = true;
            return jsonResp(out);
          }
        }

        const created = await createPartyRoomD1(env, pid, nick, hero, raceDist, now, true, accountKey, accountName, '');
        const out = buildPartyRoomResponse(created.room, pid, now, false);
        out.matched = false;
        return jsonResp(out);
      }

      if (path === '/api/party/add_bot') {
        const rcode = partyCleanRoomCode(body.roomCode);
        const pid = partyCleanId(body.playerId);
        const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
          if (!room.players[pid]) return { abortResp: jsonResp({ ok: false, error: '无权操作此房间' }, 403) };
          if (Object.keys(room.players).length >= 2) {
            if (Object.values(room.players).some((p) => p.isBot)) return {};
            return { abortResp: jsonResp({ ok: false, error: '真人劲敌已进房，请点击准备发车！' }, 409) };
          }
          const hostHero = room.players[pid].heroId;
          room.players[pid].ready = true;
          room.players[pid].lastSyncMs = nowMs;
          const cands = PARTY_BOT_PERSONAS.filter((bp) => bp[1] !== hostHero);
          const pickPool = cands.length ? cands : PARTY_BOT_PERSONAS;
          const [botNick, botHero] = pickPool[(hashRoomCodeNum(rcode) + nowMs) % pickPool.length];
          const botId = `bot_${rcode}`;
          room.players[botId] = makePartyPlayerState(botId, 2, botNick, botHero, nowMs, true);
          room.status = 'countdown';
          room.isQuickmatch = false;
          room.startAtMs = nowMs + PARTY_COUNTDOWN_MS;
          room.updatedAtMs = nowMs;
          return {};
        });
        if (res.abortResp) return res.abortResp;
        if (res.notFound || !res.room) return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
        return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
      }

      if (path === '/api/party/sync') {
        const rcode = partyCleanRoomCode(body.roomCode);
        const pid = partyCleanId(body.playerId);
        let builtResp = null;
        const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
          const caller = room.players[pid];
          if (!caller) return { abortResp: jsonResp({ ok: false, error: '不在此房间内' }, 403) };
          room.updatedAtMs = nowMs;
          caller.lastSyncMs = nowMs;
          if (room.status === 'countdown' && room.startAtMs && nowMs >= Number(room.startAtMs)) {
            room.status = 'racing';
          }

          let rival = null;
          for (const [opId, opObj] of Object.entries(room.players)) {
            if (opId !== pid) { rival = opObj; break; }
          }
          if (rival && !rival.isBot && (room.status === 'countdown' || room.status === 'racing') && (nowMs - Number(rival.lastSyncMs || nowMs)) > 22000) {
            forfeitPartyPlayer(room, rival.playerId, 'disconnect', nowMs);
            rival = null;
          }

          for (const nk of ['x', 'y', 'vx', 'vy', 'dist']) {
            if (typeof body[nk] === 'number' && Number.isFinite(body[nk])) caller[nk] = body[nk];
          }
          if (typeof body.hp === 'number' && Number.isFinite(body.hp)) {
            caller.hp = Math.max(0, Math.min(999, Math.round(body.hp)));
          }
          if (VALID_HEROES.has(body.heroId)) caller.heroId = body.heroId;
          if (body.animState && typeof body.animState === 'object') {
            const cleanAnim = { ...body.animState };
            if (nowMs - Number(caller.shieldConsumedAtMs || 0) <= 1500) cleanAnim.shieldActive = false;
            if (nowMs - Number(caller.oneHitConsumedAtMs || 0) <= 1500) cleanAnim.oneHitShield = false;
            caller.animState = cleanAnim;
          }

          if (body.useItemEvent && typeof body.useItemEvent === 'object') {
            processPartyItemEvent(room, caller, rival, body.useItemEvent, nowMs);
          }
          if (Array.isArray(body.useItemEvents)) {
            for (const evItem of body.useItemEvents.slice(0, 6)) {
              if (evItem && typeof evItem === 'object') processPartyItemEvent(room, caller, rival, evItem, nowMs);
            }
          }

          const hitTrapId = String(body.trapHitId || '').trim().slice(0, 64);
          if (hitTrapId && Array.isArray(room.trackTraps)) {
            for (const trap of room.trackTraps) {
              if (trap.active && trap.trapId === hitTrapId && trap.ownerId !== pid) {
                trap.active = false;
                const ownerP = room.players[trap.ownerId];
                if (ownerP) {
                  ownerP.itemsLanded = Number(ownerP.itemsLanded || 0) + 1;
                  if (!ownerP.isBot) {
                    ownerP.inbox.push({
                      eventId: `traphit_${hitTrapId}`,
                      type: 'trap_landed_ack',
                      itemId: 'maodie_trap',
                      fromId: pid,
                      fromNick: caller.nickname
                    });
                  }
                }
                break;
              }
            }
          }

          if (rival && rival.isBot) tickPartyBot(room, rival, caller, nowMs);

          if ((room.status === 'racing' || room.status === 'countdown') && Number(caller.dist || 0) >= Number(room.raceDist)) {
            if (room.status === 'countdown') room.status = 'racing';
            if (caller.finishedServerMs === null || caller.finishedServerMs === undefined) {
              caller.dist = Number(room.raceDist);
              caller.x = Math.max(Number(caller.x || 120), 120 + Number(room.raceDist) * 18);
              caller.finishedServerMs = nowMs;
              caller.finishedClientMs = typeof body.finishedClientMs === 'number' ? Math.floor(body.finishedClientMs) : nowMs;
              caller.elapsedMs = Math.max(1000, nowMs - Number(room.startAtMs || room.createdAtMs));
            }
          }
          if (room.status === 'racing' || room.status === 'finished') {
            recomputePartyResults(room, nowMs);
          }
          builtResp = buildPartyRoomResponse(room, pid, nowMs, true);
          return {};
        });
        if (res.abortResp) return res.abortResp;
        // CRITICAL: Never return 404 on D1 CAS write contention — return latest room snapshot cleanly!
        if (res.conflict && res.latestRoom) {
          return jsonResp(buildPartyRoomResponse(res.latestRoom, pid, now, false));
        }
        if (res.notFound || !builtResp) return jsonResp({ ok: false, error: '房间已结束或过期' }, 404);
        return jsonResp(builtResp);
      }

      if (path === '/api/party/rematch') {
        const rcode = partyCleanRoomCode(body.roomCode);
        const pid = partyCleanId(body.playerId);
        const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
          if (!room.players[pid]) return { abortResp: jsonResp({ ok: false, error: '房间已失效，请重新创建房间' }, 404) };
          if (VALID_HEROES.has(body.heroId)) room.players[pid].heroId = body.heroId;
          const voteSet = new Set(Array.isArray(room.rematchVotes) ? room.rematchVotes : []);
          if (room.status === 'finished') {
            voteSet.add(pid);
            for (const [k, pobj] of Object.entries(room.players)) {
              if (pobj.isBot) voteSet.add(k);
            }
            const pKeys = Object.keys(room.players);
            const allReady = pKeys.length >= 2 && pKeys.every((k) => voteSet.has(k));
            if (allReady) {
              const randArr = new Uint32Array(1);
              crypto.getRandomValues(randArr);
              const newSeed = (randArr[0] % 1900000000) + 100000;
              room.trackSeed = newSeed;
              room.modulePlan = generatePartyModulePlan(newSeed, room.raceDist);
              room.trackTraps = [];
              room.processedEventIds = [];
              room.results = [];
              room.rematchVotes = [];
              for (const pobj of Object.values(room.players)) {
                const fresh = makePartyPlayerState(
                  pobj.playerId, pobj.slot, pobj.nickname, pobj.heroId, nowMs, Boolean(pobj.isBot), pobj.accountKey || '', pobj.accountName || ''
                );
                fresh.ready = true;
                Object.assign(pobj, fresh);
              }
              room.status = 'countdown';
              room.startAtMs = nowMs + PARTY_COUNTDOWN_MS;
            } else {
              room.rematchVotes = Array.from(voteSet);
            }
          }
          room.updatedAtMs = nowMs;
          return {};
        });
        if (res.abortResp) return res.abortResp;
        if (res.conflict && res.latestRoom) return jsonResp(buildPartyRoomResponse(res.latestRoom, pid, now, false));
        if (res.notFound || !res.room) return jsonResp({ ok: false, error: '房间已失效，请重新创建房间' }, 404);
        return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
      }

      if (path === '/api/party/leave') {
        const rcode = partyCleanRoomCode(body.roomCode);
        const pid = partyCleanId(body.playerId);
        if (rcode.length >= 2) {
          await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
            if (!room.players[pid]) return {};
            const shouldDelete = forfeitPartyPlayer(room, pid, 'quit', nowMs);
            return shouldDelete ? { deleteRoom: true } : {};
          });
        }
        return jsonResp({ ok: true });
      }
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
      const kvKey = 'txt_v88_' + entry.file.replace(/[^a-zA-Z0-9_.-]/g, '_');
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
