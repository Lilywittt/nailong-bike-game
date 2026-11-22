// ============================================================================
// 《鹈鹕测试大乱斗》 — Atomic Local + Cloud Account Save Synchronization Engine (v6.2)
// Uses HMAC-SHA256 Signed Server Base Snapshots (baseRev, baseIssuedAt, baseSig, baseSave)
// + Conservation-of-Value 3-Way Conflict Resolution across ALL devices & tabs!
// ============================================================================

import { VALID_HERO_IDS, BEAN_TALENTS } from './config.js?v=6.9';

export const SAVE_KEY = 'pelican_brawl_save_v1';
export const AUTH_KEY = 'pelican_brawl_auth_v1';
export const SESSION_AUTH_KEY = 'pelican_brawl_tab_auth_v1';
export const SYNC_BASE_KEY = 'pelican_brawl_sync_base_v1';
export const LOCAL_REG_CNT_KEY = 'pelican_brawl_reg_cnt_v1';

const HERO_CUM_COSTS = { 1: 0, 2: 1000, 3: 2800, 4: 5600, 5: 9800, 6: 15800 };
const HERO_STEP_COSTS = { 1: 1000, 2: 1800, 3: 2800, 4: 4200, 5: 6000 };
const MOD_CUM_COSTS = { 0: 0, 1: 500, 2: 1600, 3: 3600 };
const MOD_STEP_COSTS = { 0: 500, 1: 1100, 2: 2000 };

export const defaultSave = {
  beans: 2000,
  dashEnergy: 10,
  bestDist: 0,
  bestSingleRun: 0,
  maxCheckpoint: 0,
  selectedCheckpoint: 0,
  selectedHero: 'nailong',
  unlocked: [...VALID_HERO_IDS],
  mods: { claw: 0, nitro: 0, sawBumper: 0, mortarCat: 0 },
  heroLv: { nailong: 1, ikun: 1, pelican: 1, naiwa: 1, hakimi: 1 },
  talents: { superCharge: 0, maxHpPct: 0, autoRegen: 0 }
};

export function normalizeSaveObj(parsed, fallback = defaultSave) {
  if (!parsed || typeof parsed !== 'object') {
    return {
      ...fallback,
      unlocked: [...fallback.unlocked],
      mods: { ...fallback.mods },
      heroLv: { ...fallback.heroLv },
      talents: { ...(fallback.talents || { superCharge: 0, maxHpPct: 0, autoRegen: 0 }) }
    };
  }
  const mergedUnlocked = Array.from(
    new Set([...defaultSave.unlocked, ...(Array.isArray(parsed.unlocked) ? parsed.unlocked : [])])
  ).filter((x) => VALID_HERO_IDS.includes(x));

  const bestD = Math.max(0, Math.floor(Number(parsed.bestDist) || 0));
  const bestSingle = Math.max(0, Math.floor(Number(parsed.bestSingleRun) || 0));
  const maxCp = Math.max(0, Math.floor(Number(parsed.maxCheckpoint) || 0), Math.floor(bestD / 500) * 500);

  const rawMods = (parsed.mods && typeof parsed.mods === 'object') ? parsed.mods : {};
  const mods = {};
  for (const k of ['claw', 'nitro', 'sawBumper', 'mortarCat']) {
    mods[k] = Math.min(3, Math.max(0, Math.floor(Number(rawMods[k]) || 0)));
  }

  const rawHl = (parsed.heroLv && typeof parsed.heroLv === 'object') ? parsed.heroLv : {};
  const heroLv = {};
  for (const hid of VALID_HERO_IDS) {
    heroLv[hid] = Math.min(6, Math.max(1, Math.floor(Number(rawHl[hid]) || 1)));
  }

  const rawTalents = (parsed.talents && typeof parsed.talents === 'object') ? parsed.talents : {};
  const talents = {};
  for (const t of BEAN_TALENTS) {
    talents[t.key] = Math.min(t.maxLv, Math.max(0, Math.floor(Number(rawTalents[t.key]) || 0)));
  }

  const candHero = typeof parsed.selectedHero === 'string' && VALID_HERO_IDS.includes(parsed.selectedHero)
    ? parsed.selectedHero
    : 'nailong';

  return {
    beans: parsed.beans !== undefined ? Math.max(0, Math.floor(Number(parsed.beans) || 0)) : defaultSave.beans,
    dashEnergy: parsed.dashEnergy !== undefined ? Math.min(30, Math.max(0, Math.round((Number(parsed.dashEnergy) || 0) * 10) / 10)) : defaultSave.dashEnergy,
    bestDist: bestD,
    bestSingleRun: bestSingle,
    maxCheckpoint: maxCp,
    selectedCheckpoint: Math.min(maxCp, Math.max(0, Math.floor(Number(parsed.selectedCheckpoint) || 0))),
    selectedHero: candHero,
    unlocked: mergedUnlocked,
    mods,
    heroLv,
    talents
  };
}

function calcPermCost(sv) {
  let total = 0;
  for (const h of VALID_HERO_IDS) {
    const lv = Math.min(6, Math.max(1, Math.floor((sv.heroLv && sv.heroLv[h]) || 1)));
    total += HERO_CUM_COSTS[lv];
  }
  for (const k of ['claw', 'nitro', 'sawBumper', 'mortarCat']) {
    const lv = Math.min(3, Math.max(0, Math.floor((sv.mods && sv.mods[k]) || 0)));
    total += MOD_CUM_COSTS[lv];
  }
  for (const t of BEAN_TALENTS) {
    const lv = Math.min(t.maxLv, Math.max(0, Math.floor((sv.talents && sv.talents[t.key]) || 0)));
    total += lv * t.costPerLv;
  }
  return total;
}

// Reapply local in-flight mutations onto a newly received server snapshot without losing clicks or double-charging
function rebaseLocalDeltaOntoServer(serverSaveRaw, prevBaseRaw, localCurrentRaw) {
  const srv = normalizeSaveObj(serverSaveRaw);
  if (!prevBaseRaw) return srv;
  const base = normalizeSaveObj(prevBaseRaw);
  const loc = normalizeSaveObj(localCurrentRaw);

  const dDash = Math.round((loc.dashEnergy - base.dashEnergy) * 10) / 10;
  const paidDash = Math.round(Math.max(0, dDash) * 1000);
  const paidPerm = Math.max(0, calcPermCost(loc) - calcPermCost(base));
  const pureBeanDelta = (loc.beans - base.beans) + paidPerm + paidDash;

  let avail = Math.max(0, srv.beans + pureBeanDelta);
  let mergedDash = srv.dashEnergy;
  if (dDash > 0) {
    const roomSec = Math.round(Math.max(0, 30 - srv.dashEnergy) * 10) / 10;
    const wantSec = Math.min(dDash, roomSec);
    const cost = Math.round(wantSec * 1000);
    if (avail >= cost) {
      mergedDash = Math.round((srv.dashEnergy + wantSec) * 10) / 10;
      avail -= cost;
    }
  } else {
    mergedDash = Math.max(0, Math.round((srv.dashEnergy + dDash) * 10) / 10);
  }

  const mergedHl = { ...srv.heroLv };
  for (const h of VALID_HERO_IDS) {
    while (mergedHl[h] < loc.heroLv[h] && avail >= HERO_STEP_COSTS[mergedHl[h]]) {
      avail -= HERO_STEP_COSTS[mergedHl[h]];
      mergedHl[h] += 1;
    }
  }
  const mergedMods = { ...srv.mods };
  for (const k of ['claw', 'nitro', 'sawBumper', 'mortarCat']) {
    while (mergedMods[k] < loc.mods[k] && avail >= MOD_STEP_COSTS[mergedMods[k]]) {
      avail -= MOD_STEP_COSTS[mergedMods[k]];
      mergedMods[k] += 1;
    }
  }
  const mergedTalents = { ...srv.talents };
  for (const t of BEAN_TALENTS) {
    while (mergedTalents[t.key] < loc.talents[t.key] && avail >= t.costPerLv) {
      avail -= t.costPerLv;
      mergedTalents[t.key] += 1;
    }
  }

  const bestDist = Math.max(srv.bestDist, loc.bestDist);
  const bestSingleRun = Math.max(srv.bestSingleRun, loc.bestSingleRun);
  const maxCp = Math.max(srv.maxCheckpoint, loc.maxCheckpoint, Math.floor(bestDist / 500) * 500);

  return normalizeSaveObj({
    beans: avail,
    dashEnergy: mergedDash,
    bestDist,
    bestSingleRun,
    maxCheckpoint: maxCp,
    selectedCheckpoint: Math.min(maxCp, loc.selectedCheckpoint),
    selectedHero: loc.selectedHero,
    unlocked: [...VALID_HERO_IDS],
    mods: mergedMods,
    heroLv: mergedHl,
    talents: mergedTalents
  });
}

export function createCloudStore(onUiRefresh) {
  let save = normalizeSaveObj(defaultSave);
  try {
    const rawCur = localStorage.getItem(SAVE_KEY)
      || localStorage.getItem('abstract_kupao_save_v7')
      || localStorage.getItem('abstract_bike_save_v6');
    if (rawCur) save = normalizeSaveObj(JSON.parse(rawCur));
  } catch (_) {}

  let authState = { username: '', token: '' };
  try {
    const rawTabAuth = sessionStorage.getItem(SESSION_AUTH_KEY);
    const rawAuth = rawTabAuth !== null ? rawTabAuth : localStorage.getItem(AUTH_KEY);
    if (rawAuth) {
      const pa = JSON.parse(rawAuth);
      if (pa && pa.token && pa.username) {
        authState = { username: String(pa.username), token: String(pa.token) };
        try { sessionStorage.setItem(SESSION_AUTH_KEY, JSON.stringify(authState)); } catch (_) {}
      }
    }
  } catch (_) {}

  let syncBase = null; // { rev, issuedAtMs, syncSig, save }
  try {
    const rawBase = localStorage.getItem(SYNC_BASE_KEY);
    if (rawBase) {
      const pb = JSON.parse(rawBase);
      if (pb && pb.syncSig && pb.rev && pb.issuedAtMs && pb.save) {
        syncBase = {
          rev: Number(pb.rev),
          issuedAtMs: Number(pb.issuedAtMs),
          syncSig: String(pb.syncSig),
          save: normalizeSaveObj(pb.save)
        };
      }
    }
  } catch (_) {}

  let localSaveRev = 0;
  let syncInFlight = false;
  let syncQueued = false;
  let queuedShowFeedback = false;
  let debounceTimer = null;
  let currentTicket = '';

  function writeLocal() {
    save = normalizeSaveObj(save);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {}
  }

  function recordServerSnapshot(respData) {
    if (respData && respData.syncSig && respData.rev && respData.issuedAtMs && respData.save) {
      syncBase = {
        rev: Number(respData.rev),
        issuedAtMs: Number(respData.issuedAtMs),
        syncSig: String(respData.syncSig),
        save: normalizeSaveObj(respData.save)
      };
      try { localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(syncBase)); } catch (_) {}
    }
  }

  function clearServerSnapshot() {
    syncBase = null;
    try { localStorage.removeItem(SYNC_BASE_KEY); } catch (_) {}
  }

  function markMutatedAndSave(immediateCloud = false) {
    localSaveRev += 1;
    writeLocal();
    if (authState.token) {
      if (immediateCloud) {
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        syncNow(false);
      } else {
        scheduleSync(1200);
      }
    }
  }

  function scheduleSync(delayMs = 1200) {
    if (!authState.token) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      syncNow(false);
    }, delayMs);
  }

  async function ensureSignedBaseBeforeSync() {
    if (syncBase && syncBase.syncSig) return true;
    try {
      const r = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${authState.token}` } });
      const d = await r.json();
      if (r.ok && d && d.ok && d.save) {
        const prevSnap = syncBase ? syncBase.save : null;
        recordServerSnapshot(d);
        save = prevSnap ? rebaseLocalDeltaOntoServer(d.save, prevSnap, save) : normalizeSaveObj(d.save);
        writeLocal();
        return Boolean(syncBase && syncBase.syncSig);
      }
    } catch (_) {}
    return false;
  }

  async function syncNow(showFeedback = false, feedbackCb = null) {
    if (!authState.token) return false;
    if (syncInFlight) {
      syncQueued = true;
      queuedShowFeedback = queuedShowFeedback || showFeedback;
      return true;
    }
    syncInFlight = true;

    let ok = false;
    try {
      await ensureSignedBaseBeforeSync();
      const sentRev = localSaveRev;
      const payloadSave = normalizeSaveObj(save);
      const reqBody = { save: payloadSave };
      if (syncBase && syncBase.syncSig) {
        reqBody.baseRev = syncBase.rev;
        reqBody.baseIssuedAt = syncBase.issuedAtMs;
        reqBody.baseSig = syncBase.syncSig;
        reqBody.baseSave = syncBase.save;
      }

      const resp = await fetch('/api/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authState.token}`
        },
        body: JSON.stringify(reqBody),
        keepalive: true
      });
      const data = await resp.json();
      if (resp.ok && data && data.ok) {
        ok = true;
        if (data.save) {
          // Guard against out-of-order stale response arriving after a newer server recharge snapshot!
          if (!syncBase || Number(data.rev || 0) >= syncBase.rev) {
            recordServerSnapshot(data);
            if (data.needsRebase) {
              // Adopt authoritative server baseline first
              save = normalizeSaveObj(data.save);
            } else if (localSaveRev === sentRev) {
              save = normalizeSaveObj(data.save);
            } else {
              // Additional clicks happened while request was in flight -> rebase remaining delta cleanly!
              save = rebaseLocalDeltaOntoServer(data.save, payloadSave, save);
              syncQueued = true;
            }
            writeLocal();
          }
        }
        if ((showFeedback || queuedShowFeedback) && feedbackCb) {
          feedbackCb(true, data.conflictResolved
            ? '✅ 多端存档已安全合并同步（零丢豆/零冲突）！'
            : '✅ 存档资源与全部等级已精准同步上云！');
        }
        queuedShowFeedback = false;
        if (onUiRefresh) onUiRefresh();
      } else if (showFeedback && feedbackCb) {
        feedbackCb(false, `⚠️ ${data && data.error ? data.error : '同步稍后重试'}`);
      }
    } catch (_) {
      if (showFeedback && feedbackCb) {
        feedbackCb(false, '⚠️ 网络波动，已自动保存在本地');
      }
    } finally {
      syncInFlight = false;
      if (syncQueued && authState.token) {
        syncQueued = false;
        const fb = queuedShowFeedback;
        queuedShowFeedback = false;
        syncNow(fb, feedbackCb);
      }
    }
    return ok;
  }

  function fetchTicket() {
    currentTicket = '';
    return fetch('/api/auth/ticket')
      .then((r) => r.json())
      .then((d) => { if (d && d.ticket) currentTicket = d.ticket; return currentTicket; })
      .catch(() => '');
  }

  async function submitAuth(mode, usernameRaw, password, hpTrapVal = '') {
    const username = String(usernameRaw || '').trim();
    if (username.length < 2 || username.length > 20 || /[\s<>'"\\/;]/.test(username)) {
      return { ok: false, error: '账号需为2~20位常规字符（不含空格）' };
    }
    if (!password || password.length < 4) {
      return { ok: false, error: '密码至少需要4位' };
    }

    if (mode === 'register') {
      const localRegs = Number(localStorage.getItem(LOCAL_REG_CNT_KEY) || 0);
      if (localRegs >= 3) {
        return { ok: false, error: '本设备注册账号已达上限(3个)，请直接登录已有账号' };
      }
      if (!currentTicket) {
        await fetchTicket();
        await new Promise((res) => setTimeout(res, 850));
      }
    }

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload = mode === 'register'
        ? { username, password, save: normalizeSaveObj(save), ticket: currentTicket, hp_trap: hpTrapVal }
        : { username, password };

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        if (mode === 'register') fetchTicket();
        return { ok: false, error: data.error || '操作失败，请重试' };
      }

      if (mode === 'register') {
        try {
          const prevCnt = Number(localStorage.getItem(LOCAL_REG_CNT_KEY) || 0);
          localStorage.setItem(LOCAL_REG_CNT_KEY, String(prevCnt + 1));
        } catch (_) {}
      }

      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      syncQueued = false;
      authState = { username: data.username, token: data.token };
      try { sessionStorage.setItem(SESSION_AUTH_KEY, JSON.stringify(authState)); } catch (_) {}
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(authState)); } catch (_) {}

      if (data.save) {
        localSaveRev += 1;
        recordServerSnapshot(data);
        save = normalizeSaveObj(data.save);
        writeLocal();
      }
      if (onUiRefresh) onUiRefresh();
      return { ok: true, username: data.username, mode };
    } catch (_) {
      return { ok: false, error: '网络波动，当前已为您自动使用本地存档' };
    }
  }

  function logoutToGuest() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    syncQueued = false;
    authState = { username: '', token: '' };
    clearServerSnapshot();
    try { sessionStorage.setItem(SESSION_AUTH_KEY, ''); } catch (_) {}
    try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
    localSaveRev += 1;
    save = normalizeSaveObj(defaultSave);
    writeLocal();
    if (onUiRefresh) onUiRefresh();
  }

  function pullSessionOnBoot() {
    if (!authState.token) return;
    const bootRev = localSaveRev;
    const prevBaseSave = syncBase ? syncBase.save : null;
    fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${authState.token}` } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok && d && d.ok) {
          authState.username = d.username || authState.username;
          if (d.save) {
            recordServerSnapshot(d);
            if (localSaveRev === bootRev && (!prevBaseSave || Number(d.rev || 1) >= (syncBase ? syncBase.rev : 1))) {
              save = prevBaseSave ? rebaseLocalDeltaOntoServer(d.save, prevBaseSave, save) : normalizeSaveObj(d.save);
              if (JSON.stringify(save) !== JSON.stringify(normalizeSaveObj(d.save))) {
                scheduleSync(350);
              }
            } else if (prevBaseSave) {
              save = rebaseLocalDeltaOntoServer(d.save, prevBaseSave, save);
              scheduleSync(350);
            }
            writeLocal();
          }
          if (onUiRefresh) onUiRefresh();
        } else if (d && d.error === '登录已失效') {
          authState = { username: '', token: '' };
          clearServerSnapshot();
          try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
          if (onUiRefresh) onUiRefresh();
        }
      })
      .catch(() => {});
  }

  function flushBeacon() {
    writeLocal();
    if (authState.token && syncBase && syncBase.syncSig && navigator.sendBeacon) {
      try {
        const bodyObj = {
          token: authState.token,
          save: normalizeSaveObj(save),
          baseRev: syncBase.rev,
          baseIssuedAt: syncBase.issuedAtMs,
          baseSig: syncBase.syncSig,
          baseSave: syncBase.save
        };
        const blob = new Blob([JSON.stringify(bodyObj)], { type: 'application/json' });
        navigator.sendBeacon('/api/save', blob);
      } catch (_) {}
    }
  }

  let lastFocusPullMs = 0;
  function pullOnWindowReturn() {
    if (!authState.token || syncInFlight || debounceTimer) return;
    const now = Date.now();
    if (now - lastFocusPullMs < 4000) return;
    lastFocusPullMs = now;
    pullSessionOnBoot();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', pullOnWindowReturn);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pullOnWindowReturn();
    });
  }

  function applyAuthoritativePaySnapshot(respData) {
    if (!respData || !respData.save || !respData.syncSig) return false;
    if (syncBase && Number(respData.rev || 0) < syncBase.rev) return false;
    const prevBase = syncBase ? syncBase.save : null;
    recordServerSnapshot(respData);
    save = prevBase ? rebaseLocalDeltaOntoServer(respData.save, prevBase, save) : normalizeSaveObj(respData.save);
    writeLocal();
    if (onUiRefresh) onUiRefresh();
    return true;
  }

  return {
    get save() { return save; },
    setSave(next) { save = normalizeSaveObj(next); writeLocal(); },
    get auth() { return authState; },
    markMutatedAndSave,
    syncNow,
    fetchTicket,
    submitAuth,
    logoutToGuest,
    pullSessionOnBoot,
    flushBeacon,
    applyAuthoritativePaySnapshot
  };
}
