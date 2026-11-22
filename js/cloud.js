// ============================================================================
// 《鹈鹕测试大乱斗》 — Atomic Local + Cloud Account Save Synchronization Engine
// Guarantees 100% consistency across `beans`, `heroLv`, `mods`, `bestDist`,
// `bestSingleRun`, and `maxCheckpoint` using monotonic revision tracking
// (`localSaveRev`) + serialized single-flight `/api/save` queue.
// ============================================================================

import { VALID_HERO_IDS } from './config.js?v=5.6';

export const SAVE_KEY = 'pelican_brawl_save_v1';
export const AUTH_KEY = 'pelican_brawl_auth_v1';
export const LOCAL_REG_CNT_KEY = 'pelican_brawl_reg_cnt_v1';

export const defaultSave = {
  beans: 150,
  dashEnergy: 0,
  bestDist: 0,
  bestSingleRun: 0,
  maxCheckpoint: 0,
  selectedCheckpoint: 0,
  selectedHero: 'nailong',
  unlocked: [...VALID_HERO_IDS],
  mods: { claw: 0, nitro: 0, sawBumper: 0, mortarCat: 0 },
  heroLv: { nailong: 1, ikun: 1, pelican: 1, naiwa: 1, hakimi: 1 }
};

export function normalizeSaveObj(parsed, fallback = defaultSave) {
  if (!parsed || typeof parsed !== 'object') {
    return {
      ...fallback,
      unlocked: [...fallback.unlocked],
      mods: { ...fallback.mods },
      heroLv: { ...fallback.heroLv }
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

  const candHero = typeof parsed.selectedHero === 'string' && VALID_HERO_IDS.includes(parsed.selectedHero)
    ? parsed.selectedHero
    : 'nailong';

  return {
    beans: parsed.beans !== undefined ? Math.max(0, Math.floor(Number(parsed.beans) || 0)) : defaultSave.beans,
    dashEnergy: parsed.dashEnergy !== undefined ? Math.min(30, Math.max(0, Math.round((Number(parsed.dashEnergy) || 0) * 10) / 10)) : 0,
    bestDist: bestD,
    bestSingleRun: bestSingle,
    maxCheckpoint: maxCp,
    selectedCheckpoint: Math.min(maxCp, Math.max(0, Math.floor(Number(parsed.selectedCheckpoint) || 0))),
    selectedHero: candHero,
    unlocked: mergedUnlocked,
    mods,
    heroLv
  };
}

// Merge monotonic progression fields from cloud without clobbering newer local wallet edits
function mergeMonotonicFromCloud(localSave, cloudSave) {
  const c = normalizeSaveObj(cloudSave);
  localSave.bestDist = Math.max(localSave.bestDist, c.bestDist);
  localSave.bestSingleRun = Math.max(localSave.bestSingleRun, c.bestSingleRun);
  localSave.maxCheckpoint = Math.max(localSave.maxCheckpoint, c.maxCheckpoint);
  for (const k of ['claw', 'nitro', 'sawBumper', 'mortarCat']) {
    localSave.mods[k] = Math.max(localSave.mods[k] || 0, c.mods[k] || 0);
  }
  for (const h of VALID_HERO_IDS) {
    localSave.heroLv[h] = Math.max(localSave.heroLv[h] || 1, c.heroLv[h] || 1);
  }
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
    const rawAuth = localStorage.getItem(AUTH_KEY);
    if (rawAuth) {
      const pa = JSON.parse(rawAuth);
      if (pa && pa.token && pa.username) {
        authState = { username: String(pa.username), token: String(pa.token) };
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

  async function syncNow(showFeedback = false, feedbackCb = null) {
    if (!authState.token) return false;
    if (syncInFlight) {
      syncQueued = true;
      queuedShowFeedback = queuedShowFeedback || showFeedback;
      return true;
    }
    syncInFlight = true;
    const sentRev = localSaveRev;
    const payloadSave = normalizeSaveObj(save);

    let ok = false;
    try {
      const resp = await fetch('/api/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authState.token}`
        },
        body: JSON.stringify({ save: payloadSave }),
        keepalive: true
      });
      const data = await resp.json();
      if (resp.ok && data && data.ok) {
        ok = true;
        if (data.save) {
          if (localSaveRev === sentRev) {
            // No local edits occurred while request was in flight -> adopt authoritative cloud save!
            save = normalizeSaveObj(data.save);
          } else {
            // Player mutated save locally while in flight -> preserve newer local wallet & queue follow-up!
            mergeMonotonicFromCloud(save, data.save);
            syncQueued = true;
          }
          writeLocal();
        }
        if ((showFeedback || queuedShowFeedback) && feedbackCb) {
          feedbackCb(true, '✅ 存档资源与全部等级已精准同步上云！');
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
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(authState)); } catch (_) {}

      if (data.save) {
        localSaveRev += 1;
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
    try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
    localSaveRev += 1;
    save = normalizeSaveObj(defaultSave);
    writeLocal();
    if (onUiRefresh) onUiRefresh();
  }

  function pullSessionOnBoot() {
    if (!authState.token) return;
    const bootRev = localSaveRev;
    fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${authState.token}` } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok && d && d.ok) {
          authState.username = d.username || authState.username;
          if (d.save) {
            if (localSaveRev === bootRev) {
              save = normalizeSaveObj(d.save);
            } else {
              mergeMonotonicFromCloud(save, d.save);
            }
            writeLocal();
          }
          if (onUiRefresh) onUiRefresh();
        } else if (d && d.error === '登录已失效') {
          authState = { username: '', token: '' };
          try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
          if (onUiRefresh) onUiRefresh();
        }
      })
      .catch(() => {});
  }

  function flushBeacon() {
    writeLocal();
    if (authState.token && navigator.sendBeacon) {
      try {
        const blob = new Blob([JSON.stringify({ token: authState.token, save: normalizeSaveObj(save) })], {
          type: 'application/json'
        });
        navigator.sendBeacon('/api/save', blob);
      } catch (_) {}
    }
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
    flushBeacon
  };
}
