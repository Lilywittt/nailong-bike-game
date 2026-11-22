// ============================================================================
// 《鹈鹕测试大乱斗》 — Core Gameplay, Telegraphed Bosses, Single-Life Record
// Challenge, 1-Per-Run Share-to-Revive & Garage Hub Controller
// ============================================================================

import {
  HEROES,
  GARAGE_MODS,
  WORLD_PROP_POOL,
  HEAL_BOBA_PROP,
  TIMED_SHIELD_PROP,
  STAGE_SPAN_M,
  SUPER_BONUS_DURATION,
  MIN_NORMAL_SEC_FOR_BONUS,
  STAGES,
  BOSS_ROSTER,
  MEME_CRIES,
  getHeroLvFromSave,
  getHeroMaxHpFromSave,
  getHeroHpUpgradeCost,
  getModPropDuration
} from './config.js?v=5.6';

import {
  buildAllSculptedAssets,
  drawModelOn,
  drawSpaldingWheelOn,
  drawSculptedBikeAndHero,
  getEnemySpriteKey
} from './models.js?v=5.6';

import {
  ensureAudio,
  isSoundOn,
  toggleSound,
  playHeroSelectVoice,
  playGentleSkillAccent,
  playCriticalMomentVoice,
  startBossBgm,
  pauseBossBgm,
  resumeBossBgmIfNeeded,
  stopBossBgm,
  playSfx,
  tickProceduralBgm
} from './audio.js?v=5.6';

import { createCloudStore } from './cloud.js?v=5.6';
import {
  initBossCustomState,
  clearBossTransientHazards,
  hasBossImmediateJumpCue,
  hasBossImmediateParryCue,
  handlePlayerBossInteraction,
  updateBossEngine,
  renderBossArenaAndModel
} from './bosses.js?v=5.6';

// Zero-allocation in-place array compaction (eliminates 1,400+ GC array allocations/sec!)
function compactInPlace(arr, keepFn) {
  let writeIdx = 0;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (keepFn(item)) arr[writeIdx++] = item;
  }
  arr.length = writeIdx;
}

function pushCapped(arr, item, maxLen) {
  if (arr.length >= maxLen) arr.shift();
  arr.push(item);
}

// Unbounded Concave Monotonic Distance Curve:
// f(d) = 1 + (sqrt(2)+1)*(sqrt(1 + d/1000) - 1) -> f(0)=1.0x, f(1km)=2.0x, f'(d)>0, f''(d)<0, NO upper bound (+infinity)!
const MIN_NORMAL_DIST_FOR_BONUS = 520;
function getSurvivalGradient(singleDist) {
  const d = Math.max(0, singleDist);
  const km = d / 1000;
  const fullKm = Math.floor(km);
  const rawMult = 1 + (Math.SQRT2 + 1) * (Math.sqrt(1 + km) - 1);
  const dmgMult = Math.round(rawMult * 100) / 100;
  const multStr = dmgMult.toFixed(2).replace(/0$/, '');

  const tier = Math.min(6, fullKm + 1);
  let icon = '🟢', border = '#22c55e', color = '#4ade80';
  if (dmgMult >= 5.0) { icon = '💀'; border = '#e11d48'; color = '#fda4af'; }
  else if (dmgMult >= 3.8) { icon = '🟣'; border = '#a855f7'; color = '#e9d5ff'; }
  else if (dmgMult >= 2.8) { icon = '🔴'; border = '#ef4444'; color = '#f87171'; }
  else if (dmgMult >= 2.0) { icon = '🟡'; border = '#eab308'; color = '#fde047'; }

  return {
    tier,
    kmMilestone: fullKm + 1,
    label: `${icon} ${multStr}x`,
    border,
    color,
    dmgMult,
    // Comfortable human speed & generous >=385px spacing so ZERO checkmates ever occur!
    speedAdd: Math.min(290, (dmgMult - 1) * 65),
    chunkGap: Math.round(Math.max(385, 465 - (dmgMult - 1) * 20)),
    ambushProb: Math.min(0.58, 0.18 + (dmgMult - 1) * 0.10),
    doubleProb: 0,
    bossGap: Math.round(Math.max(185, 230 - (dmgMult - 1) * 10))
  };
}

// Build High-DPI 2.5D sprites once on module boot
buildAllSculptedAssets();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hubPreviewCanvas = document.getElementById('hubPreviewCanvas');
const pCtx = hubPreviewCanvas.getContext('2d');

function drawModel(key, x, y, rot = 0, sx = 1, sy = sx) {
  drawModelOn(ctx, key, x, y, rot, sx, sy);
}

// ==================== DOM REFERENCES ====================
const hurtOverlay = document.getElementById('hurtOverlay');
const toastPill = document.getElementById('toastPill');
const singleDistText = document.getElementById('singleDistText');
const singleChallengePill = document.getElementById('singleChallengePill');
const singleTargetHud = document.getElementById('singleTargetHud');
const threatHudBadge = document.getElementById('threatHudBadge');
const distText = document.getElementById('distText');
const runBeansText = document.getElementById('runBeansText');
const speedText = document.getElementById('speedText');
const hpBarBox = document.getElementById('hpBarBox');
const hpTrailFill = document.getElementById('hpTrailFill');
const hpMainFill = document.getElementById('hpMainFill');
const hpText = document.getElementById('hpText');
const shieldText = document.getElementById('shieldText');
const superBarFill = document.getElementById('superBarFill');
const superBarLbl = document.getElementById('superBarLbl');
const comboTag = document.getElementById('comboTag');
const buffStrip = document.getElementById('buffStrip');
const bossHud = document.getElementById('bossHud');
const bossTierTag = document.getElementById('bossTierTag');
const bossNameText = document.getElementById('bossNameText');
const bossHpFill = document.getElementById('bossHpFill');
const bossHpNum = document.getElementById('bossHpNum');
const quickDashWrap = document.getElementById('quickDashWrap');

const jumpBtn = document.getElementById('jumpBtn');
const jumpIcon = document.getElementById('jumpIcon');
const jumpLbl = document.getElementById('jumpLbl');
const skillBtn = document.getElementById('skillBtn');
const skillIcon = document.getElementById('skillIcon');
const skillLbl = document.getElementById('skillLbl');
const skillCdShade = document.getElementById('skillCdShade');
const skillFuelBar = document.getElementById('skillFuelBar');
const actionBtn = document.getElementById('actionBtn');
const actionIcon = document.getElementById('actionIcon');
const actionLbl = document.getElementById('actionLbl');
const ammoBar = document.getElementById('ammoBar');
const hyperDashBtn = document.getElementById('hyperDashBtn');
const hyperFillBar = document.getElementById('hyperFillBar');
const hyperDashLbl = document.getElementById('hyperDashLbl');

const hubOverlay = document.getElementById('hubOverlay');
const hubTitleText = document.getElementById('hubTitleText');
const hubShareBtn = document.getElementById('hubShareBtn');
const hubAccountBtn = document.getElementById('hubAccountBtn');
const singleRecHubBar = document.getElementById('singleRecHubBar');
const hubRankOpenBtn = document.getElementById('hubRankOpenBtn');
const walletText = document.getElementById('walletText');
const bestDistLabel = document.getElementById('bestDistLabel');
const heroPerkTag = document.getElementById('heroPerkTag');
const heroStrip = document.getElementById('heroStrip');
const heroHpInfo = document.getElementById('heroHpInfo');
const heroHpUpBtn = document.getElementById('heroHpUpBtn');
const hubSingleBestVal = document.getElementById('hubSingleBestVal');
const hubSingleGoalTag = document.getElementById('hubSingleGoalTag');
const cpStrip = document.getElementById('cpStrip');
const shopGrid = document.getElementById('shopGrid');
const hyperStockTxt = document.getElementById('hyperStockTxt');
const hyperBuyBtn = document.getElementById('hyperBuyBtn');
const preBoost400 = document.getElementById('preBoost400');
const preBoost800 = document.getElementById('preBoost800');
const launchBtn = document.getElementById('launchBtn');

const pauseBtn = document.getElementById('pauseBtn');
const soundBtn = document.getElementById('soundBtn');
const pauseOverlay = document.getElementById('pauseOverlay');
const pauseModalTitle = document.getElementById('pauseModalTitle');
const pauseHyperShopBox = document.getElementById('pauseHyperShopBox');
const pauseHyperStock = document.getElementById('pauseHyperStock');
const pauseBuyHyperBtn = document.getElementById('pauseBuyHyperBtn');
const pauseCloseX = document.getElementById('pauseCloseX');
const pauseDistStat = document.getElementById('pauseDistStat');
const pauseBeanStat = document.getElementById('pauseBeanStat');
const pauseResumeBtn = document.getElementById('pauseResumeBtn');
const pauseRestartBtn = document.getElementById('pauseRestartBtn');
const pauseExitBtn = document.getElementById('pauseExitBtn');

const gameOverOverlay = document.getElementById('gameOverOverlay');
const goSingleDistTxt = document.getElementById('goSingleDistTxt');
const goRecordBadge = document.getElementById('goRecordBadge');
const goRecordBar = document.getElementById('goRecordBar');
const goBeansEarned = document.getElementById('goBeansEarned');
const goBossKills = document.getElementById('goBossKills');
const reviveShareCard = document.getElementById('reviveShareCard');
const reviveStatusHint = document.getElementById('reviveStatusHint');
const reviveUsedNote = document.getElementById('reviveUsedNote');
const goRankOpenBtn = document.getElementById('goRankOpenBtn');
const goRetryBtn = document.getElementById('goRetryBtn');
const goHubBtn = document.getElementById('goHubBtn');

const authOverlay = document.getElementById('authOverlay');
const authModalTitle = document.getElementById('authModalTitle');
const authCloseBtn = document.getElementById('authCloseBtn');
const authGuestBox = document.getElementById('authGuestBox');
const authUserBox = document.getElementById('authUserBox');
const authHpTrap = document.getElementById('authHpTrap');
const donateOpenBtn = document.getElementById('donateOpenBtn');
const donateBox = document.getElementById('donateBox');
const donateAlipayTab = document.getElementById('donateAlipayTab');
const donateWechatTab = document.getElementById('donateWechatTab');
const donateQrImg = document.getElementById('donateQrImg');
const donateBackBtn = document.getElementById('donateBackBtn');
const authUserInp = document.getElementById('authUserInp');
const authPassInp = document.getElementById('authPassInp');
const authMsg = document.getElementById('authMsg');
const authRegisterBtn = document.getElementById('authRegisterBtn');
const authLoginBtn = document.getElementById('authLoginBtn');
const authCurrentUserLbl = document.getElementById('authCurrentUserLbl');
const authCloudSummary = document.getElementById('authCloudSummary');
const authLoggedMsg = document.getElementById('authLoggedMsg');
const authSyncNowBtn = document.getElementById('authSyncNowBtn');
const authLogoutBtn = document.getElementById('authLogoutBtn');

const contactOverlay = document.getElementById('contactOverlay');
const contactOpenBtn = document.getElementById('contactOpenBtn');
const contactCloseBtn = document.getElementById('contactCloseBtn');
const copyMailBtn = document.getElementById('copyMailBtn');

const rankOverlay = document.getElementById('rankOverlay');
const rankRefreshBtn = document.getElementById('rankRefreshBtn');
const rankCloseBtn = document.getElementById('rankCloseBtn');
const rankMeSummary = document.getElementById('rankMeSummary');
const rankNickRow = document.getElementById('rankNickRow');
const rankNickInp = document.getElementById('rankNickInp');
const rankSubmitBtn = document.getElementById('rankSubmitBtn');
const rankListBox = document.getElementById('rankListBox');

// ==================== ATOMIC CLOUD & LOCAL SAVE STORE ====================
let state = 'HUB'; // 'HUB' | 'PLAYING' | 'PAUSED' | 'DYING' | 'GAMEOVER'
let preSelectedBoost = 0;
let bankedRunBeans = 0;

function checkIkunTestAccountGift(storeRef) {
  try {
    if (storeRef && storeRef.auth && storeRef.auth.username && storeRef.auth.username.toLowerCase() === 'ikun') {
      if (!localStorage.getItem('pelican_ikun_100m_gift_v1') || storeRef.save.beans < 50000000) {
        localStorage.setItem('pelican_ikun_100m_gift_v1', '1');
        storeRef.save.beans = Math.max(storeRef.save.beans, 100000000);
        storeRef.markMutatedAndSave(true);
      }
    }
  } catch (_) {}
}

const store = createCloudStore(() => {
  checkIkunTestAccountGift(store);
  refreshAccountButtonsUI();
  if (state === 'HUB') refreshHubUI();
});
checkIkunTestAccountGift(store);
setTimeout(() => { checkIkunTestAccountGift(store); if (state === 'HUB') refreshHubUI(); }, 900);

function getHeroById(id) {
  return HEROES.find((h) => h.id === id) || HEROES[0];
}

let activeRunHeroId = store.save.selectedHero;
function getHero() {
  return getHeroById(activeRunHeroId);
}

// ==================== TOAST & ACCOUNT / DONATE / CONTACT MODALS ====================
let toastTimer = null;
function showToast(msg) {
  toastPill.textContent = msg;
  toastPill.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastPill.classList.remove('show'), 1950);
}

function refreshAccountButtonsUI() {
  const s = store.save;
  const auth = store.auth;
  if (auth.token && auth.username) {
    hubAccountBtn.textContent = `☁️ ${auth.username}`;
    hubAccountBtn.classList.add('logged');
    authCurrentUserLbl.textContent = `👤 账号：${auth.username}`;
    const totalHeroLv = Object.values(s.heroLv || {}).reduce((a, b) => a + Number(b || 1), 0);
    const totalModLv = Object.values(s.mods || {}).reduce((a, b) => a + Number(b || 0), 0);
    authCloudSummary.textContent = `🌿${s.beans} · 单命最高${s.bestSingleRun}m · 角色总等级Lv${totalHeroLv} · 改装Lv${totalModLv}`;
  } else {
    hubAccountBtn.textContent = '☁️ 存档';
    hubAccountBtn.classList.remove('logged');
  }
}

function showAuthMainView() {
  authModalTitle.textContent = '☁️ 账密云存档';
  donateBox.classList.add('hidden-block');
  donateOpenBtn.classList.remove('hidden-block');
  if (store.auth.token && store.auth.username) {
    authGuestBox.classList.add('hidden-block');
    authUserBox.classList.remove('hidden-block');
    refreshAccountButtonsUI();
  } else {
    authUserBox.classList.add('hidden-block');
    authGuestBox.classList.remove('hidden-block');
    store.fetchTicket();
  }
}

function openAuthModal() {
  ensureAudio();
  authMsg.textContent = '';
  authMsg.classList.remove('ok');
  authLoggedMsg.textContent = '';
  showAuthMainView();
  authOverlay.classList.remove('hidden');
}

function closeAuthModal() {
  authOverlay.classList.add('hidden');
  authUserInp.blur();
  authPassInp.blur();
}

function openDirectDonateModal() {
  ensureAudio();
  playSfx('crate');
  authModalTitle.textContent = '☕ 打赏支持作者';
  authGuestBox.classList.add('hidden-block');
  authUserBox.classList.add('hidden-block');
  donateOpenBtn.classList.add('hidden-block');
  donateBox.classList.remove('hidden-block');
  authOverlay.classList.remove('hidden');
}

donateOpenBtn.addEventListener('click', openDirectDonateModal);
const hubDonateMiniBtn = document.getElementById('hubDonateMiniBtn');
if (hubDonateMiniBtn) {
  hubDonateMiniBtn.addEventListener('click', openDirectDonateModal);
}
donateBackBtn.addEventListener('click', () => {
  playSfx('bean');
  showAuthMainView();
});
donateAlipayTab.addEventListener('click', () => {
  playSfx('bean');
  donateQrImg.src = '/assets/pay_alipay.jpg';
  donateAlipayTab.classList.add('active-ali');
  donateWechatTab.classList.remove('active-wx');
});
donateWechatTab.addEventListener('click', () => {
  playSfx('bean');
  donateQrImg.src = '/assets/pay_wechat.jpg';
  donateWechatTab.classList.add('active-wx');
  donateAlipayTab.classList.remove('active-ali');
});

hubAccountBtn.addEventListener('click', openAuthModal);
authCloseBtn.addEventListener('click', closeAuthModal);
authOverlay.addEventListener('click', (e) => {
  if (e.target === authOverlay) closeAuthModal();
});

let authBusy = false;
async function handleAuthSubmit(mode) {
  if (authBusy) return;
  authBusy = true;
  authMsg.classList.remove('ok');
  authMsg.textContent = mode === 'register' ? '⏳ 正在校验并上传全部资源与等级...' : '⏳ 正在登录读取云存档...';
  const res = await store.submitAuth(mode, authUserInp.value, authPassInp.value, authHpTrap.value || '');
  authBusy = false;
  if (!res.ok) {
    authMsg.textContent = `❌ ${res.error}`;
    return;
  }
  authPassInp.value = '';
  playSfx('crate');
  refreshAccountButtonsUI();
  if (state === 'HUB') refreshHubUI();
  showToast(mode === 'register' ? `☁️ 注册成功！已绑定 ${res.username}` : `☁️ 欢迎回来，${res.username}！`);
  openAuthModal();
  authLoggedMsg.textContent = mode === 'register'
    ? '✅ 注册成功，绿豆资源与全部等级已上云！'
    : '✅ 云端存档（含绿豆与角色/改装等级）已精准载入！';
}

authRegisterBtn.addEventListener('click', () => handleAuthSubmit('register'));
authLoginBtn.addEventListener('click', () => handleAuthSubmit('login'));
authSyncNowBtn.addEventListener('click', () => {
  store.syncNow(true, (ok, msg) => {
    authLoggedMsg.textContent = msg;
    if (ok) showToast('☁️ 存档已同步上云！');
  });
});
authLogoutBtn.addEventListener('click', () => {
  store.logoutToGuest();
  showToast('👤 已切回默认游客模式');
  closeAuthModal();
});

contactOpenBtn.addEventListener('click', () => {
  ensureAudio();
  playSfx('bean');
  contactOverlay.classList.remove('hidden');
});
contactCloseBtn.addEventListener('click', () => contactOverlay.classList.add('hidden'));
contactOverlay.addEventListener('click', (e) => {
  if (e.target === contactOverlay) contactOverlay.classList.add('hidden');
});
copyMailBtn.addEventListener('click', () => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText('skybluellw@qq.com').catch(() => {});
  }
  playSfx('crate');
  showToast('📋 已复制邮箱：skybluellw@qq.com');
});

soundBtn.addEventListener('click', () => {
  const on = toggleSound(state === 'PLAYING' && Boolean(activeBoss) && superBonusTimer <= 0);
  soundBtn.textContent = on ? '🔊' : '🔇';
});

// ==================== GARAGE HUB UI & UPGRADES ====================
function refreshHubUI() {
  const s = store.save;
  hubTitleText.textContent = '🦩 鹈鹕测试大乱斗';
  walletText.textContent = s.beans;
  const singleBest = s.bestSingleRun || 0;
  bestDistLabel.textContent = `🏆 单命纪录 ${singleBest}m`;
  if (hubSingleBestVal) hubSingleBestVal.textContent = `${singleBest} m`;
  if (hubSingleGoalTag) {
    const nextGoal = Math.max(250, (Math.floor(singleBest / 250) + 1) * 250);
    hubSingleGoalTag.textContent = `🎯 挑战目标：${nextGoal}m`;
  }
  const curH = getHeroById(s.selectedHero);
  heroPerkTag.textContent = curH.perk;
  refreshAccountButtonsUI();

  // 1. 5-Hero Strip
  heroStrip.innerHTML = '';
  for (const h of HEROES) {
    const isSel = s.selectedHero === h.id;
    const hLv = getHeroLvFromSave(s, h.id);
    const div = document.createElement('div');
    div.className = `hero-slot ${isSel ? 'selected' : ''}`;
    div.innerHTML = `
      <div style="font-size:19px;">${h.icon}</div>
      <div class="hero-nm">${h.name}</div>
      <div class="hero-tag">${h.tag}·Lv${hLv}</div>
    `;
    div.addEventListener('click', () => {
      ensureAudio();
      s.selectedHero = h.id;
      store.markMutatedAndSave(true);
      playHeroSelectVoice(h.id);
      refreshHubUI();
    });
    heroStrip.appendChild(div);
  }

  // 2. Selected Hero Differentiated Max-HP Upgrade Bar
  const curLv = getHeroLvFromSave(s, curH.id);
  const curMaxHp = getHeroMaxHpFromSave(s, curH.id);
  const hpCost = getHeroHpUpgradeCost(curLv);
  const isHpMax = curLv >= 6;
  heroHpInfo.textContent = `❤️ ${curH.name} Lv${curLv} · 血量上限 ${curMaxHp} HP`;
  if (isHpMax) {
    heroHpUpBtn.textContent = `✨ 满级 ${curMaxHp}HP`;
    heroHpUpBtn.classList.add('maxed');
    heroHpUpBtn.style.opacity = '1';
  } else {
    const nextMaxHp = curMaxHp + (curH.hpStep || 22);
    heroHpUpBtn.textContent = `⬆️ 升至${nextMaxHp}HP (${hpCost}🌿)`;
    heroHpUpBtn.classList.remove('maxed');
    heroHpUpBtn.style.opacity = s.beans >= hpCost ? '1' : '0.5';
  }

  // 3. Checkpoint Selector
  cpStrip.innerHTML = '';
  const cpList = [0, 500, 1000, 1500];
  if (s.maxCheckpoint >= 2000 && !cpList.includes(s.maxCheckpoint)) cpList.push(s.maxCheckpoint);
  for (const cp of cpList) {
    const unlocked = cp <= s.maxCheckpoint;
    const isSel = s.selectedCheckpoint === cp;
    const chip = document.createElement('div');
    chip.className = `cp-chip ${isSel ? 'selected' : ''} ${!unlocked ? 'locked' : ''}`;
    chip.textContent = cp === 0 ? '🚩 起点0m' : (unlocked ? `🚩 存档${cp}m` : `🔒 ${cp}m`);
    chip.addEventListener('click', () => {
      if (!unlocked) return;
      ensureAudio();
      s.selectedCheckpoint = cp;
      store.markMutatedAndSave(true);
      playSfx('bean');
      refreshHubUI();
    });
    cpStrip.appendChild(chip);
  }

  // 4. 4 Rare Prop Duration Upgrades (500 -> 1100 -> 2000🌿)
  shopGrid.innerHTML = '';
  for (const mod of GARAGE_MODS) {
    const lv = (s.mods && s.mods[mod.key]) || 0;
    const cost = (mod.costs && mod.costs[lv]) || (500 + lv * 600);
    const isMax = lv >= mod.maxLv;
    const curDur = getModPropDuration(s, mod.key);
    const nextDur = +(curDur + mod.stepDur).toFixed(1);
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = `
      <div class="shop-ico">${mod.ico}</div>
      <div class="shop-nm">${mod.name}${lv > 0 ? ` Lv${lv}` : ''}</div>
      <div class="shop-dur">${isMax ? `满级 ${curDur}s` : `${curDur}s→${nextDur}s`}</div>
      <div class="shop-cost" style="${!isMax && s.beans < cost ? 'opacity:0.45;' : ''}">${isMax ? '满级' : `${cost}🌿`}</div>
    `;
    div.addEventListener('click', () => {
      ensureAudio();
      if (!isMax && s.beans >= cost) {
        s.beans -= cost;
        s.mods[mod.key] = lv + 1;
        store.markMutatedAndSave(true); // Immediate atomic local + cloud save!
        playSfx('crate');
        showToast(`${mod.ico} ${mod.name}持续时间升至 ${nextDur}s!`);
        refreshHubUI();
      } else if (!isMax) {
        showToast('🌿 绿豆不足，快去跑酷收集吧!');
      }
    });
    shopGrid.appendChild(div);
  }

  preBoost400.classList.toggle('active', preSelectedBoost === 400);
  preBoost800.classList.toggle('active', preSelectedBoost === 800);

  // 5. Chargeable Hold-to-Ram Hyper Dash Shop Card (10000🌿 per 10s charge, max 3 charges = 30.0s!)
  const curDashE = Math.min(30, Math.max(0, Number(s.dashEnergy) || 0));
  const stockCnt = (curDashE / 10).toFixed(1);
  if (hyperStockTxt) hyperStockTxt.textContent = `当前储备：${stockCnt} / 3 个（共 ${curDashE.toFixed(1)}s · 仅限购买）`;
  if (hyperBuyBtn) {
    if (curDashE >= 29.95) {
      hyperBuyBtn.textContent = '✨ 已满 3/3';
      hyperBuyBtn.classList.add('maxed');
      hyperBuyBtn.style.opacity = '1';
    } else {
      hyperBuyBtn.textContent = '➕ 购入1个 (10000🌿)';
      hyperBuyBtn.classList.remove('maxed');
      hyperBuyBtn.style.opacity = s.beans >= 10000 ? '1' : '0.5';
    }
  }

  launchBtn.textContent = s.selectedCheckpoint > 0
    ? `🐔 从 ${s.selectedCheckpoint}m 出发！`
    : '🐔 开始游戏！';
}

if (hyperBuyBtn) {
  hyperBuyBtn.addEventListener('click', () => {
    ensureAudio();
    const s = store.save;
    const curE = Math.min(30, Math.max(0, Number(s.dashEnergy) || 0));
    if (curE >= 29.95) {
      showToast('✨ 究极霸王超级冲刺已达持有上限 (3/3)!');
      return;
    }
    if (s.beans < 10000) {
      showToast('🌿 绿豆不足 (需 10000🌿)!');
      return;
    }
    s.beans -= 10000;
    s.dashEnergy = Math.min(30, Math.round((curE + 10) * 10) / 10);
    store.markMutatedAndSave(true);
    playSfx('crate');
    showToast(`☄️ 购入究极霸王超级冲刺! 当前储备 ${(s.dashEnergy / 10).toFixed(1)}/3`);
    refreshHubUI();
  });
}

preBoost400.addEventListener('click', () => {
  ensureAudio(); playSfx('bean');
  preSelectedBoost = preSelectedBoost === 400 ? 0 : 400;
  refreshHubUI();
});
preBoost800.addEventListener('click', () => {
  ensureAudio(); playSfx('bean');
  preSelectedBoost = preSelectedBoost === 800 ? 0 : 800;
  refreshHubUI();
});

heroHpUpBtn.addEventListener('click', () => {
  ensureAudio();
  const s = store.save;
  const hid = s.selectedHero || 'nailong';
  const lv = getHeroLvFromSave(s, hid);
  if (lv >= 6) {
    showToast('✨ 当前角色血量已达满级(210 HP)!');
    return;
  }
  const cost = getHeroHpUpgradeCost(lv);
  if (s.beans < cost) {
    showToast('🌿 绿豆不足，快去跑酷收集吧!');
    return;
  }
  s.beans -= cost;
  if (!s.heroLv) s.heroLv = { nailong: 1, ikun: 1, pelican: 1, naiwa: 1, hakimi: 1 };
  s.heroLv[hid] = lv + 1;
  store.markMutatedAndSave(true); // Immediate atomic local + cloud save!
  playSfx('crate');
  showToast(`❤️ ${getHeroById(hid).name}升至Lv${lv + 1} (${getHeroMaxHpFromSave(s, hid)} HP)!`);
  refreshHubUI();
});

// ==================== VIEWPORT & WORLD STATE ====================
let W = window.innerWidth;
let H = window.innerHeight;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
}
window.addEventListener('resize', resize);
resize();

let pits = [];
let mudZones = [];
let iceZones = [];
let snowballs = [];
let lilyPads = [];
let catapults = [];
let backboards = [];
let barrels = [];
let hangers = [];
let bells = [];
let geysers = [];
let laserGates = [];
let rails = [];
let checkpointFlags = [];
let recordFlag = null; // Physical Golden Single-Life Personal-Best Flagpole!
let worldProps = [];
let cashTrucks = [];
let beans = [];
let enemies = [];
let projectiles = [];
let enemyShots = [];
let bossHazards = [];
let flamePuffs = [];
let speedLines = [];
let roadScars = [];
let shockwaves = [];
let flyingDebris = [];
let popups = [];
let hyperGhosts = [];

let runStartDist = 0;
let prevBestSingleRun = 0;
let runStats = { dist: 0, singleRunDist: 0, beans: 0, bossKills: 0, reviveUsed: false };
let combo = 0, comboTimer = 0;
let superCharge = 0, superBonusTimer = 0;
let normalPlayDistSinceBonus = 0;
let normalPlaySecSinceBonus = 0;
let nextBonusShapeX = 0;
let bonusShapeIdx = 0;
let bonusSkyAlpha = 0;
let prevStageIndex = 0, stageFadeTimer = 0;
let smoothCamRefY = 0, smoothCamZoom = 1.0, smoothPlayerScreenRatio = 0.18;
let lastThreatTier = 1;
let headStartTargetDist = 0;
let quickDashWindowTimer = 0;
let autoSaveTimer = 6.0;
let shakeTime = 0, shakeMag = 8, hitStopTimer = 0, deathSlowTimer = 0;
let stageIndex = 0;
let activeBoss = null, nextBossDist = 175, bossCycleCount = 0;
let bossBag = [], lastBossKind = '';
let nextSpawnX = 420, nextTruckDist = 195, nextFlagDist = 500, nextPropDist = 280, nextHealDist = 520, nextShieldDist = 260;

// Dirty-checked UI cache so 60fps loop NEVER thrashes DOM layout!
const uiCache = {};

const player = {
  x: 120, y: 0, vy: 0, vx: 350, baseSpeed: 350, boostTimer: 0,
  giantTimer: 0, magnetTimer: 0, rocketDashTimer: 0, mortarTimer: 0, mortarShotTick: 0,
  hyperDashHolding: false, hyperDashActive: false, hyperReleaseGrace: 0, hyperSessionSec: 0, hyperGhostTick: 0, hyperWallSparkTick: 0,
  sawShieldCharges: 0, tempShieldHp: 0, tempShieldTimer: 0,
  angle: 0, onGround: true, onRail: null,
  coyoteTimer: 0, jumpBufferTimer: 0,
  jumpsLeft: 2, maxHp: 100, hp: 100,
  regenPool: 0, displayHp: 100, trailHp: 100,
  invulnTimer: 0, hurtPoseTimer: 0,
  strikeTimer: 0, actionCd: 0, parryWindowTimer: 0, actionBufferTimer: 0,
  skillCd: 0, skillMaxCd: 3.0, skillHeld: false,
  flameHolding: false, flameBurstTimer: 0, flameFuel: 100,
  swallowVortexTimer: 0, swallowedCount: 0,
  thunderTongueTimer: 0, thunderTongueAngle: 0, thunderBossTick: 0,
  wheelAngle: 0, crankAngle: 0, jiggle: 0, jiggleVel: 0,
  weaponId: null, weaponTimer: 0, weaponMaxTimer: 4.5, autoFireTick: 0,
  mountId: null, mountTimer: 0,
  orbitSawTimer: 0,
  slashLines: []
};

let jumpHeld = false;
let actionHeld = false;

function getBaseSurfaceY(wx) {
  if (wx < 380) return 0;
  const t = (wx - 380) * 0.0016;
  return Math.sin(t) * 20 + Math.sin(t * 2.1 + 1.1) * 9;
}

function getEnemyWorldY(en) {
  const base = getBaseSurfaceY(en.x);
  if (en.flyH) {
    return base - en.flyH + Math.sin(performance.now() * 0.006 + (en.phase || 0)) * 18;
  }
  return base;
}

function getTerrainStateAt(wx) {
  if (superBonusTimer > 0) return { y: -220, isPit: false, baseY: -220 };
  const baseY = getBaseSurfaceY(wx);
  for (const pit of pits) {
    if (wx > pit.x && wx < pit.x + pit.len && !pit.bridged) {
      return { y: baseY + 260, isPit: true, baseY };
    }
  }
  return { y: baseY, isPit: false, baseY };
}

function getTerrainSlope(wx) {
  if (superBonusTimer > 0) return 0;
  const dx = 6;
  return Math.atan2(getBaseSurfaceY(wx + dx) - getBaseSurfaceY(wx - dx), dx * 2);
}

function getCamera() {
  const isPortrait = H > W;
  const worldScale = (isPortrait ? Math.max(0.58, Math.min(0.72, W / 535)) : Math.max(0.76, Math.min(0.95, H / 500))) * smoothCamZoom;
  // When 🐕 大狗嚼 chases from BEHIND, shift rider toward 0.37*W so player clearly sees rear pursuit!
  const playerScreenX = W * smoothPlayerScreenRatio;
  const groundScreenY = isPortrait ? H * 0.66 : H * 0.70;
  const camX = player.x - playerScreenX / worldScale;
  const camY = smoothCamRefY * 0.38 - groundScreenY / worldScale;
  return { worldScale, camX, camY };
}

function addDashEnergy() {
  // Hyper Dash strictly CANNOT auto-recharge — purchasable ONLY for 10000🌿 in Shop!
}

function addPopup(text, x, y, color = '#fde047', size = 18) {
  if (popups.length >= 4) popups.shift();
  popups.push({ text, x, y, vy: -68, life: 0.82, maxLife: 0.82, color, size });
}

function spawnBeanFountain(wx, wy, count = 6, valEach = 1) {
  for (let i = 0; i < count; i++) {
    if (beans.length >= 95) beans.shift();
    const a = -Math.PI * (0.18 + (i / Math.max(1, count - 1)) * 0.64);
    const sp = 180 + Math.random() * 220;
    beans.push({
      x: wx + (Math.random() - 0.5) * 20,
      y: wy - 16,
      vx: player.vx * 0.45 + Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 90,
      dynamic: true,
      giant: false,
      val: valEach,
      taken: false
    });
  }
}

// Incrementally bank beans, total distance, single-life record & checkpoints
function bankRunProgress(pushToCloud = false) {
  if (state === 'HUB') return;
  const s = store.save;
  let changed = false;
  const deltaBeans = Math.max(0, runStats.beans - bankedRunBeans);
  if (deltaBeans > 0) {
    s.beans += deltaBeans;
    bankedRunBeans = runStats.beans;
    changed = true;
  }
  if (runStats.dist > s.bestDist) {
    s.bestDist = runStats.dist;
    changed = true;
  }
  if (runStats.singleRunDist > (s.bestSingleRun || 0)) {
    s.bestSingleRun = runStats.singleRunDist;
    changed = true;
  }
  const cpReached = Math.floor(runStats.dist / 500) * 500;
  if (cpReached > s.maxCheckpoint) {
    s.maxCheckpoint = cpReached;
    s.selectedCheckpoint = cpReached;
    changed = true;
  }
  if (changed || pushToCloud) {
    store.markMutatedAndSave(pushToCloud);
  }
}

// ==================== SUPER BONUS, HEALING & RARE PROPS ====================
const BONUS_LETTER_WORDS = [
  ['I', 'K', 'U', 'N'],
  ['M', 'A', 'N', 'B', 'O'],
  ['6', '6', '6'],
  ['N', 'B', '!']
];
const GLYPH_5X5 = {
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
  U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  '6': ['.###.', '#....', '####.', '#...#', '.###.'],
  '!': ['..#..', '..#..', '..#..', '.....', '..#..']
};

function spawnNextBonusFormation() {
  const sx = nextBonusShapeX;
  const kind = bonusShapeIdx++ % 5;
  const baseY = -255;
  if (kind === 0 || kind === 2) {
    const word = BONUS_LETTER_WORDS[(bonusShapeIdx >> 1) % BONUS_LETTER_WORDS.length];
    let curX = sx;
    for (let w = 0; w < word.length; w++) {
      const rows = GLYPH_5X5[word[w]] || GLYPH_5X5.O;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (rows[r][c] === '#') {
            beans.push({ x: curX + c * 24, y: baseY - (4 - r) * 24 - 18, val: 2, giant: (r === 0 || r === 4) && c === 2, taken: false });
          }
        }
      }
      curX += 152;
    }
    nextBonusShapeX = curX + 90;
  } else if (kind === 1) {
    for (let i = 0; i < 18; i++) {
      const x = sx + i * 30;
      const s = Math.sin(i * 0.55) * 62;
      beans.push({ x, y: baseY - 72 + s, val: 2, giant: i % 4 === 0, taken: false });
      beans.push({ x, y: baseY - 72 - s, val: 2, giant: i % 4 === 2, taken: false });
    }
    nextBonusShapeX = sx + 600;
  } else if (kind === 3) {
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      beans.push({ x: sx + 130 + hx * 6.2, y: baseY - 82 + hy * 5.2, val: 3, giant: i % 4 === 0, taken: false });
    }
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        if (Math.abs(i) + Math.abs(j) === 3 || (i === 0 && j === 0)) {
          beans.push({ x: sx + 370 + i * 26, y: baseY - 80 + j * 24, val: 2, giant: i === 0 && j === 0, taken: false });
        }
      }
    }
    nextBonusShapeX = sx + 540;
  } else {
    for (let a = 0; a < 3; a++) {
      const ax = sx + a * 145;
      for (let k = -3; k <= 3; k++) {
        beans.push({ x: ax + (3 - Math.abs(k)) * 26, y: baseY - 78 + k * 22, val: 2, giant: k === 0, taken: false });
      }
    }
    nextBonusShapeX = sx + 510;
  }
}

// Strict <= 5% Playtime Cap: 10s Super Bonus requires >= 210s (3m30s) of active normal play!
function addSuperCharge(rawGain) {
  if (superBonusTimer > 0 || headStartTargetDist > 0) return;
  const secCeiling = (normalPlaySecSinceBonus / MIN_NORMAL_SEC_FOR_BONUS) * 100;
  superCharge = Math.min(100, secCeiling, superCharge + rawGain * 0.20);
  if (superCharge >= 100 && normalPlaySecSinceBonus >= MIN_NORMAL_SEC_FOR_BONUS) {
    triggerSuperBonusStage();
  }
}

function triggerSuperBonusStage() {
  superCharge = 0;
  normalPlayDistSinceBonus = 0;
  normalPlaySecSinceBonus = 0;
  normalPlaySecSinceBonus = 0;
  superBonusTimer = SUPER_BONUS_DURATION;
  enemyShots.length = 0;
  bossHazards.length = 0;
  if (activeBoss) {
    // Seamlessly suspend Boss progress during 10s Super Bonus — exact same Boss & HP resumes after!
    clearBossTransientHazards(activeBoss);
    activeBoss.pinnedByHyper = false;
    bossHud.classList.add('hidden');
    pauseBossBgm();
  }
  player.onRail = null;
  player.mountId = null;
  player.mountTimer = 0;
  if (player.y > -215) {
    player.vy = -560;
    player.onGround = false;
  }
  player.invulnTimer = Math.max(player.invulnTimer, SUPER_BONUS_DURATION + 1.5);
  playSfx('crate');
  shakeTime = 0.22; shakeMag = 9;
  showToast(activeBoss ? '🌈 超级奖励乱入 · 10秒后无缝继续决战首领!' : '🌈 稀有超级奖励 · 10秒云端金豆狂欢!!');

  nextBonusShapeX = player.x + 180;
  bonusShapeIdx = 0;
  while (nextBonusShapeX < player.x + 1500) {
    spawnNextBonusFormation();
  }
}

// Smooth Continuous Healing: adds `instantPart` immediately + streams `regenPart` gradually over ~2.2s!
function healPlayer(amount, instantRatio = 0.25, showPop = true) {
  const totalGain = Math.max(0.5, Number(amount) || 0);
  const missing = Math.max(0, player.maxHp - (player.hp + player.regenPool));
  if (missing <= 0.2) {
    if (showPop && totalGain >= 8) {
      runStats.beans += 12;
      addPopup('🌿 满血转化 +12豆!', player.x + 18, player.y - 98, '#4ade80', 16);
    }
    updateTopHUD();
    return;
  }
  const effective = Math.min(totalGain, missing + 2);
  const inst = effective * Math.max(0, Math.min(1, instantRatio));
  const overTime = Math.max(0, effective - inst);
  player.hp = Math.min(player.maxHp, player.hp + inst);
  player.regenPool = Math.min(player.maxHp - player.hp, player.regenPool + overTime);

  if (showPop && effective >= 4) {
    hpBarBox.classList.remove('heal-pop');
    void hpBarBox.offsetWidth;
    hpBarBox.classList.add('heal-pop');
    setTimeout(() => hpBarBox.classList.remove('heal-pop'), 420);
    addPopup(`💚 +${Math.round(effective)} HP`, player.x + 18, player.y - 98, '#4ade80', 18);
  }
  updateTopHUD();
}

function pushPropCooldownAhead() {
  nextPropDist = Math.max(nextPropDist, runStats.dist + 310 + Math.floor(Math.random() * 120));
}

function grantTempShield(amount, durSec, showPop = true) {
  player.tempShieldHp = Math.min(60, Math.round(Math.max(player.tempShieldHp, amount)));
  player.tempShieldTimer = Math.max(player.tempShieldTimer, durSec);
  if (showPop) {
    addPopup(`🛡️ +${Math.round(amount)}限时盾(${durSec.toFixed(0)}s)`, player.x + 20, player.y - 98, '#38bdf8', 18);
  }
  updateTopHUD();
}

function activateWorldProp(def) {
  playSfx('crate');
  shakeTime = 0.18; shakeMag = 9;
  addSuperCharge(0.8);

  if (def.id === 'heal_boba') {
    // Scarce Continuous Heal (~12% MaxHP streamed smoothly — real survival pressure!)
    const healAmt = Math.round(3 + player.maxHp * 0.11);
    healPlayer(healAmt, 0.22, true);
    showToast(`🍵 绿豆汤缓慢回血 +${healAmt} HP`);
    updateTopHUD();
    return;
  }

  if (def.id === 'timed_shield') {
    const shAmt = Math.round(18 + player.maxHp * 0.07);
    grantTempShield(shAmt, 6.5, true);
    showToast(`🛡️ 限时护盾 +${shAmt} (6.5秒后自动过期)!`);
    refreshBuffChips();
    updateTopHUD();
    return;
  }

  const s = store.save;
  pushPropCooldownAhead();
  if (def.id === 'super_magnet') {
    const dur = getModPropDuration(s, 'claw');
    player.magnetTimer = dur;
    showToast(`🧲 磁铁爪 (${dur.toFixed(1)}s) · 全屏吸豆!`);
  } else if (def.id === 'dash_rocket') {
    const dur = getModPropDuration(s, 'nitro');
    player.rocketDashTimer = dur;
    player.invulnTimer = Math.max(player.invulnTimer, dur + 0.35);
    showToast(`🚀 氮气罐冲刺 (${dur.toFixed(1)}s)!`);
  } else if (def.id === 'orbit_saws') {
    const dur = getModPropDuration(s, 'sawBumper');
    player.orbitSawTimer = dur;
    player.sawShieldCharges = 1;
    showToast(`⚙️ 破障电锯 (${dur.toFixed(1)}s + 1次挡伤)!`);
  } else if (def.id === 'mortar_cat') {
    const dur = getModPropDuration(s, 'mortarCat');
    player.mortarTimer = dur;
    player.mortarShotTick = 0.08;
    showToast(`🐱 迫击猫助战 (${dur.toFixed(1)}s)!`);
  } else if (def.id === 'gatling' || def.id === 'bazooka') {
    player.weaponId = def.id;
    player.weaponTimer = 4.8;
    player.weaponMaxTimer = 4.8;
    player.autoFireTick = 0;
    showToast(def.toast);
  } else if (def.id === 'giant_spicy') {
    player.giantTimer = 3.6;
    player.invulnTimer = Math.max(player.invulnTimer, 3.9);
    showToast(def.toast);
  }
  refreshBuffChips();
  syncControlsUI();
  updateTopHUD();
}

function refreshBuffChips() {
  const list = [];
  if (player.hyperDashActive) list.push(`☄️ 究极霸王超级冲刺 ${(10 - player.hyperSessionSec).toFixed(1)}s`);
  if (headStartTargetDist > 0) list.push(`🚀 开局狂飙 → ${headStartTargetDist}m`);
  if (superBonusTimer > 0) list.push(`🌈 超级奖励 ${superBonusTimer.toFixed(0)}s`);
  if (player.tempShieldHp > 0 && player.tempShieldTimer > 0) {
    list.push(`🛡️ 限时盾 ${Math.ceil(player.tempShieldHp)} (${player.tempShieldTimer.toFixed(1)}s)`);
  }
  if (player.giantTimer > 0) list.push(`🌶️ 巨人化 ${player.giantTimer.toFixed(1)}s`);
  if (player.rocketDashTimer > 0) list.push(`🚀 氮气罐 ${player.rocketDashTimer.toFixed(1)}s`);
  if (player.magnetTimer > 0) list.push(`🧲 磁铁爪 ${player.magnetTimer.toFixed(1)}s`);
  if (player.orbitSawTimer > 0) list.push(`⚙️ 破障锯 ${player.orbitSawTimer.toFixed(1)}s`);
  if (player.mortarTimer > 0) list.push(`🐱 迫击猫 ${player.mortarTimer.toFixed(1)}s`);
  if (player.weaponId === 'gatling') list.push(`🏀 加特林 ${player.weaponTimer.toFixed(1)}s`);
  if (player.weaponId === 'bazooka') list.push(`🦈 火箭筒 ${player.weaponTimer.toFixed(1)}s`);

  const sig = list.join('|');
  if (uiCache.buffSig === sig) return;
  uiCache.buffSig = sig;
  buffStrip.innerHTML = '';
  for (let i = 0; i < list.length; i++) {
    const span = document.createElement('span');
    span.className = 'buff-chip';
    span.textContent = list[i];
    buffStrip.appendChild(span);
  }
}

function activateHeadStartBoost(boostMeters, cost) {
  const s = store.save;
  if (s.beans < cost) {
    showToast('🌿 绿豆不足！');
    return false;
  }
  s.beans -= cost;
  store.markMutatedAndSave(true);
  headStartTargetDist = runStats.dist + boostMeters;
  player.invulnTimer = 20;
  quickDashWrap.classList.add('hidden');
  playSfx('crate');
  showToast(`🚀 星光极速冲刺 ${boostMeters}m!!`);
  refreshBuffChips();
  return true;
}

document.getElementById('inRunDash400').addEventListener('click', (e) => {
  e.stopPropagation(); ensureAudio(); activateHeadStartBoost(400, 150);
});
document.getElementById('inRunDash800').addEventListener('click', (e) => {
  e.stopPropagation(); ensureAudio(); activateHeadStartBoost(800, 280);
});

// ==================== START NEW RUN, PAUSE, SETTLEMENT & SHARE-TO-REVIVE ====================
function startNewRun(heroId, startDistMeters = 0, boostMeters = 0) {
  ensureAudio();
  const s = store.save;
  activeRunHeroId = heroId || s.selectedHero;
  const h = getHero();

  const initDist = startDistMeters;
  runStartDist = initDist;
  prevBestSingleRun = s.bestSingleRun || 0;
  runStats = { dist: initDist, singleRunDist: 0, beans: 0, bossKills: 0, reviveUsed: false, healBuysUsed: 0 };
  bankedRunBeans = 0;
  combo = 0; comboTimer = 0;
  superCharge = 0;
  normalPlayDistSinceBonus = 0;
  superBonusTimer = 0;
  bonusSkyAlpha = 0;
  headStartTargetDist = 0;
  shakeTime = 0; hitStopTimer = 0; deathSlowTimer = 0;
  stageIndex = Math.floor(initDist / STAGE_SPAN_M) % STAGES.length;
  prevStageIndex = stageIndex;
  stageFadeTimer = 0;
  activeBoss = null;
  stopBossBgm();
  bossBag = [];
  bossCycleCount = 0;
  lastThreatTier = 1;
  pendingShare = null;
  if (reviveStatusHint) reviveStatusHint.classList.add('hidden-block');
  const qaBossParam = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') ? new URLSearchParams(location.search).get('qaBoss') : null;
  nextBossDist = initDist + (qaBossParam ? 42 : 145);
  nextTruckDist = initDist + 145;
  nextPropDist = initDist + 220 + Math.floor(Math.random() * 80);
  nextShieldDist = initDist + 340;
  nextHealDist = initDist + 480;
  nextFlagDist = (Math.floor(initDist / 500) + 1) * 500;
  bossHud.classList.add('hidden');
  bossHud.classList.remove('enraged');
  comboTag.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');

  player.x = 120 + initDist * 18;
  player.y = getBaseSurfaceY(player.x);
  smoothCamRefY = player.y;
  smoothCamZoom = 1.0;
  smoothPlayerScreenRatio = 0.18;
  player.vy = 0;
  player.baseSpeed = h.id === 'hakimi' ? 368 : 352;
  player.vx = player.baseSpeed;
  player.boostTimer = 0; player.giantTimer = 0; player.magnetTimer = 0; player.rocketDashTimer = 0;
  player.hyperDashHolding = false; player.hyperDashActive = false; player.hyperSessionSec = 0;
  player.mortarTimer = 0; player.mortarShotTick = 0;
  player.sawShieldCharges = 0; player.tempShieldHp = 0; player.tempShieldTimer = 0;
  player.angle = 0; player.onGround = true; player.onRail = null;
  player.coyoteTimer = 0; player.jumpBufferTimer = 0;
  player.maxHp = getHeroMaxHpFromSave(s, h.id);
  player.hp = player.maxHp;
  player.regenPool = 0;
  player.displayHp = player.maxHp;
  player.trailHp = player.maxHp;
  hpTrailFill.style.width = '100%';
  hpMainFill.style.width = '100%';
  player.jumpsLeft = h.id === 'hakimi' ? 4 : 2;
  player.invulnTimer = 1.0; player.hurtPoseTimer = 0;
  player.strikeTimer = 0; player.actionCd = 0;
  player.skillCd = 0; player.skillMaxCd = h.skillCd || 3.0; player.skillHeld = false;
  player.flameHolding = false; player.flameBurstTimer = 0; player.flameFuel = 100;
  player.swallowVortexTimer = 0; player.swallowedCount = 0;
  player.thunderTongueTimer = 0; player.thunderTongueAngle = 0; player.thunderBossTick = 0;
  player.weaponId = null; player.weaponTimer = 0;
  player.mountId = null; player.mountTimer = 0;
  player.orbitSawTimer = 0;
  player.slashLines = [];

  pits = []; mudZones = []; iceZones = []; snowballs = []; lilyPads = []; catapults = []; backboards = [];
  barrels = []; hangers = []; bells = []; geysers = []; laserGates = [];
  rails = []; checkpointFlags = []; worldProps = []; cashTrucks = [];
  beans = []; enemies = []; projectiles = []; enemyShots = []; bossHazards = [];
  flamePuffs = []; speedLines = []; roadScars = []; shockwaves = [];
  flyingDebris = []; popups = []; hyperGhosts = [];

  // Plant Golden Personal-Best Record Flagpole on the road!
  if (prevBestSingleRun >= 25) {
    recordFlag = {
      x: 120 + (runStartDist + prevBestSingleRun) * 18,
      singleDist: prevBestSingleRun,
      passed: false
    };
  } else {
    recordFlag = null;
  }

  const openX = player.x + 360;
  for (let i = 0; i < 6; i++) {
    const bx = openX - 30 + i * 40;
    const arc = Math.sin((i / 5) * Math.PI) * 90;
    beans.push({ x: bx, y: getBaseSurfaceY(bx) - 46 - arc, val: 1, giant: i === 3, taken: false });
  }
  enemies.push({ x: openX + 60, kind: 'dribbler', hit: false, phase: 0 });
  enemies.push({ x: openX + 120, kind: 'pelican_guard', hit: false, phase: 1.1 });
  laserGates.push({ x: openX + 295, hacked: false });
  rails.push({ x: openX + 190, len: 240, hOff: 148, kind: 'suspenders', energizedTimer: 0 });
  nextSpawnX = openX + 500;

  hubOverlay.classList.add('hidden');
  state = 'PLAYING';
  playSfx('crate');

  if (boostMeters > 0) {
    const cost = boostMeters >= 800 ? 280 : 150;
    if (!activateHeadStartBoost(boostMeters, cost)) showToast(STAGES[stageIndex].name);
    preSelectedBoost = 0;
  } else {
    showToast(STAGES[stageIndex].name);
    if (s.beans >= 150) {
      quickDashWindowTimer = 3.8;
      quickDashWrap.classList.remove('hidden');
    } else {
      quickDashWrap.classList.add('hidden');
    }
  }

  refreshBuffChips();
  syncControlsUI();
  updateTopHUD();
}

const hudHealBtn = document.getElementById('hudHealBtn');
const pauseHealStock = document.getElementById('pauseHealStock');
const pauseBuyHealBtn = document.getElementById('pauseBuyHealBtn');

function refreshHealSupplyUI() {
  const used = runStats.healBuysUsed || 0;
  const left = Math.max(0, 3 - used);
  if (hudHealBtn) {
    setTextCached('hHealTxt', hudHealBtn, `💊+100 (${left}/3)`);
    hudHealBtn.classList.toggle('used-up', left <= 0);
  }
  if (pauseHealStock) pauseHealStock.textContent = `本局剩 ${left}/3`;
  if (pauseBuyHealBtn) {
    if (left <= 0) {
      pauseBuyHealBtn.textContent = '🔒 本局回血次数已用完 (3/3)';
      pauseBuyHealBtn.style.opacity = '0.6';
    } else {
      const totalBeans = (store.save.beans || 0) + Math.max(0, (runStats.beans || 0) - bankedRunBeans);
      pauseBuyHealBtn.textContent = totalBeans >= 5000
        ? `💚 立即回100血 (5000🌿 · 剩${left}/3)`
        : `🌿 绿豆不足 (${totalBeans}/5000)`;
      pauseBuyHealBtn.style.opacity = totalBeans >= 5000 ? '1' : '0.65';
    }
  }
}

function tryBuyInRunHealSupply() {
  if (state !== 'PLAYING' && state !== 'PAUSED') return;
  ensureAudio();
  const used = runStats.healBuysUsed || 0;
  if (used >= 3) {
    showToast('🔒 本局回血补给已达上限 (3/3)！');
    return;
  }
  if (player.hp >= player.maxHp - 0.5) {
    showToast('💚 当前生命已满，无需补血！');
    return;
  }
  bankRunProgress(false);
  const s = store.save;
  if (s.beans < 5000) {
    showToast(`🌿 绿豆不足 (${s.beans}/5000)！`);
    return;
  }
  s.beans -= 5000;
  runStats.healBuysUsed = used + 1;
  player.invulnTimer = Math.max(player.invulnTimer, 0.65);
  healPlayer(100, 0.75, true);
  store.markMutatedAndSave(true);
  playSfx('crate');
  showToast(`💊 急救补血 +100HP！（本局剩余 ${3 - runStats.healBuysUsed}/3 次）`);
  refreshHealSupplyUI();
  refreshPauseHyperShopUI(false);
  updateTopHUD();
}

if (hudHealBtn) {
  hudHealBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    tryBuyInRunHealSupply();
  });
}
if (pauseBuyHealBtn) {
  pauseBuyHealBtn.addEventListener('click', () => {
    tryBuyInRunHealSupply();
  });
}

function refreshPauseHyperShopUI(highlight = false) {
  refreshHealSupplyUI();
  const s = store.save;
  const curE = Math.min(30, Math.max(0, Number(s.dashEnergy) || 0));
  if (pauseDistStat) pauseDistStat.textContent = `🏃 本命 ${runStats.singleRunDist}m`;
  if (pauseBeanStat) pauseBeanStat.textContent = `🌿 钱包 ${s.beans}`;
  if (pauseHyperStock) pauseHyperStock.textContent = `储备 ${(curE / 10).toFixed(1)} / 3 个`;
  if (pauseHyperShopBox) pauseHyperShopBox.classList.toggle('highlight', highlight);
  if (pauseBuyHyperBtn) {
    if (curE >= 29.95) {
      pauseBuyHyperBtn.textContent = '✨ 已满 3/3 个';
      pauseBuyHyperBtn.style.opacity = '0.6';
    } else {
      pauseBuyHyperBtn.textContent = s.beans >= 10000
        ? '➕ 立即购入1个 (10000🌿)'
        : `🌿 绿豆不足 (${s.beans}/10000)`;
      pauseBuyHyperBtn.style.opacity = s.beans >= 10000 ? '1' : '0.65';
    }
  }
}

function pauseGame(wantHyperShop = false) {
  if (state !== 'PLAYING') return;
  state = 'PAUSED';
  jumpHeld = false;
  onActionRelease();
  forceStopHyperDash();
  pauseBossBgm();
  bankRunProgress(true);
  if (pauseModalTitle) {
    pauseModalTitle.textContent = wantHyperShop ? '☄️ 冲刺耗尽 · 局内紧急补给' : '⏸️ 游戏暂停';
  }
  if (pauseResumeBtn) pauseResumeBtn.textContent = '▶️ 继续游戏';
  refreshPauseHyperShopUI(wantHyperShop);
  pauseOverlay.classList.remove('hidden');
}

if (pauseBuyHyperBtn) {
  pauseBuyHyperBtn.addEventListener('click', () => {
    ensureAudio();
    const s = store.save;
    const curE = Math.min(30, Math.max(0, Number(s.dashEnergy) || 0));
    if (curE >= 29.95) {
      showToast('✨ 究极霸王超级冲刺已满 (3/3)!');
      return;
    }
    if (s.beans < 10000) {
      showToast(`🌿 钱包绿豆不足 (${s.beans}/10000)!`);
      return;
    }
    s.beans -= 10000;
    s.dashEnergy = Math.min(30, Math.round((curE + 10) * 10) / 10);
    store.markMutatedAndSave(true);
    playSfx('crate');
    showToast('☄️ 局内补给成功！点击继续即可按住无敌冲刺!');
    refreshPauseHyperShopUI(false);
    syncControlsUI();
  });
}

function resumeFromPause() {
  if (state !== 'PAUSED') return;
  pauseOverlay.classList.add('hidden');
  if (pauseResumeBtn) pauseResumeBtn.textContent = '▶️ 继续游戏';
  state = 'PLAYING';
  player.invulnTimer = Math.max(player.invulnTimer, 1.2);
  resumeBossBgmIfNeeded(Boolean(activeBoss) && superBonusTimer <= 0);
}

function openGameOverModal() {
  stopBossBgm();
  const curSingle = runStats.singleRunDist;
  const isNewRecord = curSingle > prevBestSingleRun && curSingle >= 15;
  bankRunProgress(true);

  state = 'GAMEOVER';
  const bestEver = Math.max(store.save.bestSingleRun || 0, curSingle);
  goSingleDistTxt.textContent = `${curSingle} m`;
  if (isNewRecord) {
    const gain = curSingle - prevBestSingleRun;
    goRecordBadge.textContent = prevBestSingleRun > 0
      ? `🔥 新纪录！超越上次 +${gain}m`
      : `🔥 创造单命最高新纪录：${curSingle}m！`;
    goRecordBadge.classList.add('new-rec');
    goRecordBar.style.width = '100%';
  } else {
    const gap = Math.max(1, bestEver - curSingle);
    goRecordBadge.textContent = `🏆 历史单命最高：${bestEver}m（仅差 ${gap}m 破纪录！）`;
    goRecordBadge.classList.remove('new-rec');
    const pct = bestEver > 0 ? Math.min(100, Math.max(8, (curSingle / bestEver) * 100)) : 100;
    goRecordBar.style.width = `${pct}%`;
  }
  goBeansEarned.textContent = `🌿 本局 +${runStats.beans}`;
  goBossKills.textContent = `⚔️ 击败首领 ${runStats.bossKills}`;

  if (!runStats.reviveUsed) {
    reviveShareCard.classList.remove('hidden-block');
    reviveUsedNote.classList.add('hidden-block');
  } else {
    reviveShareCard.classList.add('hidden-block');
    reviveUsedNote.classList.remove('hidden-block');
  }

  gameOverOverlay.classList.remove('hidden');
}

// ==================== SIMPLE IN-PAGE SHARE IMAGE MODAL & READY-TO-START REVIVE ====================
let pendingShare = null;
let currentShareMode = 'hub'; // 'hub' | 'revive'

const shareOverlay = document.getElementById('shareOverlay');
const shareCloseBtn = document.getElementById('shareCloseBtn');
const shareSaveImgBtn = document.getElementById('shareSaveImgBtn');
const shareReviveReadyBtn = document.getElementById('shareReviveReadyBtn');
const shareSavedHint = document.getElementById('shareSavedHint');
const inPageSharePosterImg = document.getElementById('inPageSharePosterImg');
const goOpenShareBtn = document.getElementById('goOpenShareBtn');

function openCleanShareModal(mode = 'hub') {
  ensureAudio();
  playSfx('crate');
  currentShareMode = mode;
  if (shareSavedHint) {
    shareSavedHint.textContent = mode === 'revive'
      ? '点击「保存分享图」即可解锁本局满血复活！'
      : '长按图片或点击下方按钮保存分享图';
  }
  if (shareReviveReadyBtn) {
    // In revive mode, unlock the Ready-to-Start button as soon as they save (or show it right after saving!)
    shareReviveReadyBtn.classList.add('hidden-block');
  }
  if (shareOverlay) shareOverlay.classList.remove('hidden');
}

function closeCleanShareModal() {
  if (shareOverlay) shareOverlay.classList.add('hidden');
}

function saveSharePosterPng() {
  ensureAudio();
  playSfx('crate');
  try {
    if (inPageSharePosterImg && inPageSharePosterImg.complete && inPageSharePosterImg.naturalWidth > 0) {
      const cv = document.createElement('canvas');
      cv.width = 880;
      cv.height = 960;
      const c = cv.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 880, 960);
      c.drawImage(inPageSharePosterImg, 0, 0, 880, 960);
      const a = document.createElement('a');
      a.download = '鹈鹕测试大乱斗_分享图.png';
      a.href = cv.toDataURL('image/png');
      a.click();
    }
  } catch (_) {}

  if (currentShareMode === 'revive' && state === 'GAMEOVER' && !runStats.reviveUsed) {
    if (shareSavedHint) shareSavedHint.textContent = '✅ 分享图已生成保存！准备好后点击下方按钮开始冲锋！';
    if (shareReviveReadyBtn) shareReviveReadyBtn.classList.remove('hidden-block');
  } else {
    if (shareSavedHint) shareSavedHint.textContent = '✅ 分享图已保存到本地！';
    showToast('🖼️ 分享图已保存！');
  }
}

function executeReadyShareRevive() {
  if (state !== 'GAMEOVER' || runStats.reviveUsed) {
    closeCleanShareModal();
    return;
  }
  closeCleanShareModal();
  runStats.reviveUsed = true;
  gameOverOverlay.classList.add('hidden');
  player.hp = player.maxHp;
  player.regenPool = 0;
  player.displayHp = player.maxHp;
  player.trailHp = player.maxHp;
  hpTrailFill.style.width = '100%';
  hpMainFill.style.width = '100%';
  player.invulnTimer = 3.2;
  player.vy = -240;
  player.onGround = false;
  player.angle = 0;
  enemyShots.length = 0;
  bossHazards.length = 0;
  if (activeBoss) clearBossTransientHazards(activeBoss);
  for (let i = 0; i < enemies.length; i++) {
    if (!enemies[i].hit && Math.abs(enemies[i].x - player.x) < 320) enemies[i].hit = true;
  }
  for (let i = 0; i < pits.length; i++) {
    if (!pits[i].bridged && Math.abs(pits[i].x - player.x) < 340) pits[i].bridged = true;
  }
  shockwaves.push({ x: player.x, y: player.y - 30, r: 20, maxR: 340, life: 0.42, color: '#4ade80', harmless: false });
  state = 'PLAYING';
  resumeBossBgmIfNeeded(Boolean(activeBoss) && superBonusTimer <= 0);
  playSfx('crate');
  showToast('💚 满血复活出发！');
  updateTopHUD();
}

function checkPendingShareOnReturn() {}

if (goOpenShareBtn) {
  goOpenShareBtn.addEventListener('click', () => openCleanShareModal('revive'));
}
if (shareSaveImgBtn) {
  shareSaveImgBtn.addEventListener('click', saveSharePosterPng);
}
if (shareReviveReadyBtn) {
  shareReviveReadyBtn.addEventListener('click', executeReadyShareRevive);
}
if (shareCloseBtn) {
  shareCloseBtn.addEventListener('click', closeCleanShareModal);
}
if (shareOverlay) {
  shareOverlay.addEventListener('click', (e) => {
    if (e.target === shareOverlay) closeCleanShareModal();
  });
}

window.addEventListener('blur', () => {
  if (state === 'PLAYING') forceStopHyperDash();
});

function finishRunAndOpenHub() {
  stopBossBgm();
  bankRunProgress(true);
  state = 'HUB';
  pauseOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  bossHud.classList.add('hidden');
  bossHud.classList.remove('enraged');
  quickDashWrap.classList.add('hidden');
  actionBtn.classList.remove('glow');
  showToast(`🏁 本命狂飙 ${runStats.singleRunDist}m · 收获 +${runStats.beans}🌿`);
  refreshHubUI();
  hubOverlay.classList.remove('hidden');
}

launchBtn.addEventListener('click', () => {
  startNewRun(store.save.selectedHero, store.save.selectedCheckpoint, preSelectedBoost);
});
pauseBtn.addEventListener('click', () => {
  if (state === 'PLAYING') pauseGame();
  else if (state === 'PAUSED') resumeFromPause();
});
pauseResumeBtn.addEventListener('click', resumeFromPause);
pauseCloseX.addEventListener('click', resumeFromPause);
pauseRestartBtn.addEventListener('click', () => {
  pauseOverlay.classList.add('hidden');
  bankRunProgress(true);
  startNewRun(activeRunHeroId, store.save.selectedCheckpoint, 0);
});
pauseExitBtn.addEventListener('click', () => {
  pauseOverlay.classList.add('hidden');
  finishRunAndOpenHub();
});
goRetryBtn.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  startNewRun(activeRunHeroId, store.save.selectedCheckpoint, 0);
});
goHubBtn.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  finishRunAndOpenHub();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (pendingShare && !pendingShare.leftPage) {
      pendingShare.leftPage = true;
      pendingShare.departedAt = Date.now();
    }
    if (state === 'PLAYING') pauseGame();
  } else {
    checkPendingShareOnReturn();
  }
});

// ==================== WORLD & PROP SPAWNER (GENEROUS HEAL & CLEAR TELEGRAPHS) ====================
function getStageForWorldX(wx) {
  const d = Math.max(0, (wx - 120) / 18);
  return STAGES[Math.floor(d / STAGE_SPAN_M) % STAGES.length];
}

function spawnAerialDronePair(baseX, count = 2) {
  for (let d = 0; d < count; d++) {
    enemies.push({
      x: baseX + d * 88,
      kind: 'drone',
      flyH: 108 + (d % 2) * 28,
      hit: false,
      phase: d * 1.4
    });
  }
}

function trySpawnTrackPropsAt(chunkDist, spawnX) {
  const hasActivePropBuff = player.giantTimer > 0 || player.rocketDashTimer > 0 || player.magnetTimer > 0 || player.orbitSawTimer > 0 || player.mortarTimer > 0 || Boolean(player.weaponId);

  // 1A. Timed Expiring Anti-Burst Energy Shield (~520..700m spacing, expires after 6.5s!)
  if (player.tempShieldHp <= 0 && chunkDist >= nextShieldDist) {
    nextShieldDist = chunkDist + 520 + Math.floor(Math.random() * 180) + Math.floor(runStats.singleRunDist * 0.18);
    const shx = spawnX + 60;
    const shy = getBaseSurfaceY(shx) - 96;
    worldProps.push({ x: shx, y: shy, baseY: shy, def: TIMED_SHIELD_PROP, taken: false, phase: Math.random() * 6 });
  }

  // 1B. Scarce Gradual-Regen Boba (720~940m + steep distance stretch, ONLY when HP < 65%!)
  if (chunkDist >= nextHealDist) {
    const hpRatio = (player.hp + player.regenPool) / Math.max(1, player.maxHp);
    if (hpRatio < 0.54 && runStats.singleRunDist < 540) {
      const distStretch = Math.floor(runStats.singleRunDist * 0.55);
      const gap = (hpRatio < 0.32 ? 580 : 740) + Math.floor(Math.random() * 180) + distStretch;
      nextHealDist = chunkDist + gap;
      const hx = spawnX + 125;
      const hy = getBaseSurfaceY(hx) - 108;
      worldProps.push({ x: hx, y: hy, baseY: hy, def: HEAL_BOBA_PROP, taken: false, phase: Math.random() * 6 });
    } else {
      nextHealDist = chunkDist + 240;
    }
  }

  // 2. Special Offensive Props (62% float slowly down from the sky on Parachutes, 38% road height!)
  if (!hasActivePropBuff && chunkDist >= nextPropDist) {
    nextPropDist = chunkDist + 295 + Math.floor(Math.random() * 95);
    const isParachute = Math.random() < 0.62;
    const px = isParachute ? (player.x + 310 + Math.random() * 90) : (spawnX + 185);
    const roadY = getBaseSurfaceY(px);
    const py = isParachute ? (roadY - 245) : (roadY - 94);
    const pick = WORLD_PROP_POOL[Math.floor(Math.random() * WORLD_PROP_POOL.length)];
    worldProps.push({
      x: px,
      y: py,
      baseY: py,
      parachute: isParachute,
      def: pick,
      taken: false,
      phase: Math.random() * 6
    });
  }
}

function spawnWorldAhead() {
  if (superBonusTimer > 0) return;

  while (120 + nextFlagDist * 18 < player.x + 1500) {
    const fx = 120 + nextFlagDist * 18;
    checkpointFlags.push({ x: fx, dist: nextFlagDist, passed: false });
    nextFlagDist += 500;
  }

  const grad = getSurvivalGradient(runStats.singleRunDist);
  const gapStep = grad.chunkGap;

  if (activeBoss) {
    while (nextSpawnX < player.x + 1450) {
      const chunkDist = Math.max(0, (nextSpawnX - 120) / 18);
      trySpawnTrackPropsAt(chunkDist, nextSpawnX); // Spawns special props at exact normal frequency during Boss fights!
      const gx = nextSpawnX + 185;
      const gy = getBaseSurfaceY(gx);
      if (Math.random() < 0.5) {
      } else {
      }
      if (grad.tier >= 2 && Math.random() < 0.55) {
        laserGates.push({ x: gx + 175, hacked: false });
      }
      if (grad.tier >= 3 && Math.random() < 0.58) {
        enemyShots.push({ kind: 'spike_roller', x: gx + 255, y: getBaseSurfaceY(gx + 255), vx: -(170 + grad.tier * 32), parried: false, rot: 0 });
      }
      nextSpawnX += Math.max(300, 395 - grad.tier * 16);
    }
    return;
  }

  while (nextSpawnX < player.x + 1550) {
    const st = getStageForWorldX(nextSpawnX);
    const chunkDist = Math.max(0, (nextSpawnX - 120) / 18);
    const r = Math.random();

    trySpawnTrackPropsAt(chunkDist, nextSpawnX);

    // Pure Distance-Scaled Ambush Saws & Staggered High+Low Crossfire!
    const willBePit = (st.id === 'site' && r < 0.34) || (st.id === 'volcano' && r < 0.36);
    if (!willBePit && Math.random() < grad.ambushProb) {
      const hx = nextSpawnX + 135;
      const sawSpd = -(165 + grad.tier * 38);
      if (Math.random() < grad.doubleProb) {
        // Staggered High+Low Crossfire: Jump ground buzzsaw -> duck/land under aerial hover-saw!
        enemyShots.push({ kind: 'spike_roller', x: hx, y: getBaseSurfaceY(hx), vx: sawSpd, parried: false, rot: 0 });
        enemyShots.push({ kind: 'hover_saw', x: hx + 158, y: getBaseSurfaceY(hx + 158) - 102, hOff: 102, vx: sawSpd * 0.94, parried: false, rot: 0 });
      } else if (Math.random() < 0.56) {
        enemyShots.push({ kind: 'spike_roller', x: hx + 30, y: getBaseSurfaceY(hx + 30), vx: sawSpd, parried: false, rot: 0 });
      } else {
        enemyShots.push({ kind: 'hover_saw', x: hx + 30, y: getBaseSurfaceY(hx + 30) - 98, hOff: 98, vx: sawSpd, parried: false, rot: 0 });
      }
    }
    const extraPitW = grad.tier >= 5 ? 48 : (grad.tier >= 3 ? 30 : (grad.tier >= 2 ? 16 : 0));
    const prepTime = Math.max(0.28, 0.60 - grad.tier * 0.06);

    if (st.id === 'court') {
      if (r < 0.52) {
        const sx = nextSpawnX + 45;
        rails.push({ x: sx + 40, len: 235, hOff: 138, kind: 'suspenders', energizedTimer: 0 });
        for (let k = 0; k < 3; k++) {
          const mk = k === 2 ? 'shield_lawyer' : (k === 0 ? 'dribbler' : 'boar_frog');
          enemies.push({ x: sx + 70 + k * 52, kind: mk, shielded: k === 2, windupTimer: 0.78, chargePrep: prepTime, shotDone: false, hit: false, phase: k * 0.6 });
        }
        for (let i = 0; i < 4; i++) {
          const bx = sx + 60 + i * 46;
          if (beans.length < 90) beans.push({ x: bx, y: getBaseSurfaceY(bx) - 172, val: 1, giant: i === 2, taken: false });
        }
      } else {
        const fx = nextSpawnX + 50;
        laserGates.push({ x: fx + 36, hacked: false });
        for (let k = 0; k < 3; k++) {
          enemies.push({ x: fx + 95 + k * 50, kind: k === 1 ? 'spiky_cat' : 'pelican_guard', hit: false, phase: k });
        }
        spawnAerialDronePair(fx + 135, grad.tier >= 3 ? 2 : 1);
      }
      nextSpawnX += gapStep;
    } else if (st.id === 'site') {
      if (r < 0.34) {
        const px = nextSpawnX + 95;
        pits.push({ x: px, len: 122 + extraPitW, bridged: false });
        rails.push({ x: px - 35, len: 215, hOff: 136, kind: 'suspenders', energizedTimer: 0 });
        spawnAerialDronePair(px + 45, grad.tier >= 3 ? 2 : 1);
      } else {
        const bx = nextSpawnX + 80, by = getBaseSurfaceY(bx);
        for (let k = 0; k < 3; k++) {
          const mk = k === 0 ? 'shield_lawyer' : (k === 2 ? 'boar_frog' : 'spiky_cat');
          enemies.push({ x: bx + 15 + k * 52, kind: mk, shielded: k === 0, windupTimer: 0.78, chargePrep: prepTime, shotDone: false, hit: false, phase: k });
        }
      }
      nextSpawnX += gapStep;
    } else if (st.id === 'swamp') {
      if (r < 0.55) {
        const mx = nextSpawnX + 40;
        mudZones.push({ x: mx, len: 240, dried: false });
        lilyPads.push({ x: mx + 58, yOff: 32, anim: 0 });
        lilyPads.push({ x: mx + 165, yOff: 62, anim: 0 });
        enemies.push({ x: mx + 108, kind: 'spiky_cat', hit: false, phase: 0 });
        enemies.push({ x: mx + 210, kind: 'boar_frog', chargePrep: prepTime, hit: false, phase: 1 });
        spawnAerialDronePair(mx + 115, 1);
      } else {
        const gx = nextSpawnX + 45;
        rails.push({ x: gx + 36, len: 235, hOff: 148, kind: 'suspenders', energizedTimer: 0 });
        for (let k = 0; k < 3; k++) {
          const mk = k === 1 ? 'spiky_cat' : (k === 2 ? 'boar_frog' : 'shield_lawyer');
          enemies.push({ x: gx + 85 + k * 52, kind: mk, shielded: k === 0, windupTimer: 0.78, chargePrep: prepTime, hit: false, phase: k });
        }
      }
      nextSpawnX += gapStep;
    } else if (st.id === 'snow') {
      const ix = nextSpawnX + 36;
      iceZones.push({ x: ix, len: 280 });
      snowballs.push({ x: ix + 340, y: getBaseSurfaceY(ix + 340) - 28, vx: -(125 + grad.tier * 18), rot: 0, smashed: false });
      if (r < 0.55) {
        rails.push({ x: ix + 75, len: 220, hOff: 140, kind: 'maglev', energizedTimer: 0 });
        for (let k = 0; k < 3; k++) {
          enemies.push({ x: ix + 95 + k * 52, kind: k % 2 === 0 ? 'snowman' : 'spiky_cat', hit: false, phase: k });
        }
        for (let i = 0; i < 4; i++) {
          const bx = ix + 95 + i * 44;
          if (beans.length < 90) beans.push({ x: bx, y: getBaseSurfaceY(bx) - 174, val: 1, giant: i === 3, taken: false });
        }
      } else {
        spawnAerialDronePair(ix + 140, 2);
        for (let k = 0; k < 3; k++) {
          enemies.push({ x: ix + 100 + k * 52, kind: k === 1 ? 'boar_frog' : 'snowman', chargePrep: prepTime, hit: false, phase: k });
        }
      }
      nextSpawnX += gapStep;
    } else if (st.id === 'volcano') {
      if (r < 0.36) {
        const vx = nextSpawnX + 95;
        pits.push({ x: vx, len: 126 + extraPitW, bridged: false, lava: true });
        lilyPads.push({ x: vx + 62, yOff: 32, anim: 0 });
        rails.push({ x: vx - 28, len: 210, hOff: 142, kind: 'suspenders', energizedTimer: 0 });
      } else {
        const vx = nextSpawnX + 48;
        laserGates.push({ x: vx + 150, hacked: false });
        for (let k = 0; k < 3; k++) {
          const mk = k % 2 === 0 ? 'boar_frog' : 'spiky_cat';
          enemies.push({ x: vx + 45 + k * 52, kind: mk, chargePrep: prepTime, hit: false, phase: k });
        }
        spawnAerialDronePair(vx + 105, grad.tier >= 2 ? 2 : 1);
      }
      nextSpawnX += gapStep;
    } else if (st.id === 'bamboo') {
      const bx = nextSpawnX + 40;
      rails.push({ x: bx + 36, len: 240, hOff: 122, kind: 'suspenders', energizedTimer: 0 });
      spawnAerialDronePair(bx + 125, 2);
      for (let k = 0; k < 3; k++) {
        const mk = k === 0 ? 'shield_lawyer' : (k === 1 ? 'spiky_cat' : 'boar_frog');
        enemies.push({ x: bx + 78 + k * 52, kind: mk, shielded: k === 0, windupTimer: 0.78, chargePrep: prepTime, shotDone: false, hit: false, phase: k });
      }
      for (let i = 0; i < 4; i++) {
        const jx = bx + 115 + i * 44;
        if (beans.length < 90) beans.push({ x: jx, y: getBaseSurfaceY(jx) - 165, val: 1, giant: i === 3, taken: false });
      }
      nextSpawnX += gapStep;
    } else {
      const lx = nextSpawnX + 110;
      laserGates.push({ x: lx, hacked: false });
      rails.push({ x: lx - 36, len: 240, hOff: 145, kind: 'maglev', energizedTimer: 0 });
      for (let k = 0; k < 3; k++) {
        const mk = k === 0 ? 'shield_lawyer' : (k === 2 ? 'spiky_cat' : 'boar_frog');
        enemies.push({ x: lx + 86 + k * 50, kind: mk, shielded: k === 0, windupTimer: 0.76, chargePrep: prepTime, shotDone: false, hit: false, phase: k });
      }
      spawnAerialDronePair(lx + 85, 2);
      nextSpawnX += gapStep;
    }
  }
}


// ==================== HOMEPAGE SHARE & GLOBAL SERVER LEADERBOARD ====================
const GUEST_ID_KEY = 'pelican_guest_lb_id_v1';
const GUEST_NICK_KEY = 'pelican_guest_lb_nick_v1';

function getOrCreateGuestId() {
  let gid = '';
  try { gid = localStorage.getItem(GUEST_ID_KEY) || ''; } catch (_) {}
  if (gid.length < 8) {
    gid = 'rider_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem(GUEST_ID_KEY, gid); } catch (_) {}
  }
  return gid;
}

function getCurrentPlayerLbKey() {
  if (store.auth.token && store.auth.username) {
    return 'u:' + store.auth.username.toLowerCase();
  }
  return 'g:' + getOrCreateGuestId();
}

async function autoUploadLeaderboardIfBest() {
  const best = Math.floor(store.save.bestSingleRun || 0);
  if (best < 5) return;
  let savedNick = '';
  try { savedNick = localStorage.getItem(GUEST_NICK_KEY) || ''; } catch (_) {}
  const nick = (store.auth.token && store.auth.username) ? store.auth.username : (savedNick || '');
  if (!nick || nick.length < 2) return;
  try {
    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(store.auth.token ? { Authorization: `Bearer ${store.auth.token}` } : {})
      },
      body: JSON.stringify({
        bestSingle: best,
        hero: store.save.selectedHero || 'nailong',
        nickname: nick,
        guestId: getOrCreateGuestId(),
        token: store.auth.token || ''
      })
    });
  } catch (_) {}
}

async function fetchAndRenderLeaderboard() {
  if (!rankListBox) return;
  rankListBox.innerHTML = '<div class="rank-empty">⏳ 正在同步全服排行榜...</div>';
  const myBest = Math.max(store.save.bestSingleRun || 0, runStats.singleRunDist || 0);
  try {
    const resp = await fetch(`/api/leaderboard?key=${encodeURIComponent(getCurrentPlayerLbKey())}&t=${Date.now()}`);
    const data = await resp.json();
    if (!data || !data.ok) throw new Error('load failed');

    const rankStr = data.myRank ? `全服第 #${data.myRank} 名` : (myBest >= 5 ? '点击下方上传即刻上榜!' : '快去跑出单命纪录上榜吧!');
    rankMeSummary.textContent = `🏆 我的单命最高：${myBest}m · ${rankStr}`;

    const top = data.top || [];
    if (top.length === 0) {
      rankListBox.innerHTML = '<div class="rank-empty">🌟 虚位以待！快上传你的成绩拿下全服第一！</div>';
      return;
    }
    const heroIcoMap = { nailong: '🐉', naiwa: '🐸', ikun: '🏀', pelican: '🦩', hakimi: '🐱' };
    rankListBox.innerHTML = '';
    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      const row = document.createElement('div');
      row.className = `rank-row ${r.isMe ? 'is-me' : ''}`;
      const medal = r.rank === 1 ? '🥇' : (r.rank === 2 ? '🥈' : (r.rank === 3 ? '🥉' : `#${r.rank}`));
      const ico = heroIcoMap[r.hero] || '🐉';
      row.innerHTML = `
        <div class="rank-left">
          <span class="rank-num">${medal}</span>
          <span>${ico}</span>
          <span class="rank-name"></span>
        </div>
        <span class="rank-score">${r.bestSingle} m</span>
      `;
      row.querySelector('.rank-name').textContent = r.nickname + (r.isMe ? ' (我)' : '');
      rankListBox.appendChild(row);
    }
  } catch (_) {
    rankListBox.innerHTML = '<div class="rank-empty">⚠️ 榜单加载失败，请点击右上角刷新重试</div>';
  }
}

function openRankModal() {
  ensureAudio();
  playSfx('bean');
  if (store.auth.token && store.auth.username) {
    rankNickInp.value = store.auth.username;
    rankNickInp.disabled = true;
    rankSubmitBtn.textContent = '⬆️ 刷新我的成绩';
  } else {
    rankNickInp.disabled = false;
    let savedNick = '';
    try { savedNick = localStorage.getItem(GUEST_NICK_KEY) || ''; } catch (_) {}
    rankNickInp.value = savedNick;
    rankSubmitBtn.textContent = '⬆️ 上传上榜';
  }
  rankOverlay.classList.remove('hidden');
  autoUploadLeaderboardIfBest().then(fetchAndRenderLeaderboard);
}

if (hubRankOpenBtn) hubRankOpenBtn.addEventListener('click', (e) => { e.stopPropagation(); openRankModal(); });
if (singleRecHubBar) singleRecHubBar.addEventListener('click', openRankModal);
if (goRankOpenBtn) goRankOpenBtn.addEventListener('click', openRankModal);
if (rankCloseBtn) rankCloseBtn.addEventListener('click', () => rankOverlay.classList.add('hidden'));
if (rankRefreshBtn) rankRefreshBtn.addEventListener('click', fetchAndRenderLeaderboard);
if (rankOverlay) {
  rankOverlay.addEventListener('click', (e) => {
    if (e.target === rankOverlay) rankOverlay.classList.add('hidden');
  });
}

if (rankSubmitBtn) {
  rankSubmitBtn.addEventListener('click', async () => {
    ensureAudio();
    const best = Math.max(store.save.bestSingleRun || 0, runStats.singleRunDist || 0);
    if (best < 5) {
      showToast('🏃 先跑出至少 5m 单命距离再来上榜吧！');
      return;
    }
    const nick = (store.auth.token && store.auth.username)
      ? store.auth.username
      : String(rankNickInp.value || '').trim();
    if (nick.length < 2) {
      showToast('✏️ 请输入至少 2 个字符的上榜昵称！');
      rankNickInp.focus();
      return;
    }
    if (!store.auth.token) {
      try { localStorage.setItem(GUEST_NICK_KEY, nick); } catch (_) {}
    }
    rankSubmitBtn.disabled = true;
    try {
      const resp = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(store.auth.token ? { Authorization: `Bearer ${store.auth.token}` } : {})
        },
        body: JSON.stringify({
          bestSingle: best,
          hero: store.save.selectedHero || 'nailong',
          nickname: nick,
          guestId: getOrCreateGuestId(),
          token: store.auth.token || ''
        })
      });
      const res = await resp.json();
      if (res && res.ok) {
        playSfx('crate');
        showToast(`🌏 上榜成功！当前全服第 #${res.myRank} 名！`);
        fetchAndRenderLeaderboard();
      } else {
        showToast(`⚠️ ${(res && res.error) || '上传失败'}`);
      }
    } catch (_) {
      showToast('⚠️ 网络繁忙，请稍后再试');
    }
    rankSubmitBtn.disabled = false;
  });
}

if (hubShareBtn) {
  hubShareBtn.addEventListener('click', () => {
    openCleanShareModal('hub');
  });
}

// ==================== CONTROLS, HOLD-TO-RAM HYPER DASH & 5 TALENTS ====================
function getMaxJumps() {
  return getHero().id === 'hakimi' ? 4 : 2;
}

function setTextCached(key, el, val) {
  if (!el || uiCache[key] === val) return;
  uiCache[key] = val;
  el.textContent = val;
}

function setStyleCached(key, el, prop, val) {
  if (!el || uiCache[key] === val) return;
  uiCache[key] = val;
  el.style[prop] = val;
}

function syncControlsUI() {
  const h = getHero();
  setTextCached('jIco', jumpIcon, '⬆️');
  setTextCached('jLbl', jumpLbl, h.id === 'hakimi' && !player.onGround ? `起跳(${player.jumpsLeft})` : '起跳');

  setTextCached('sIco', skillIcon, h.skillIcon || '✨');
  const isSkillActive = (h.id === 'nailong' && (player.flameHolding || player.flameBurstTimer > 0))
    || (h.id === 'pelican' && player.swallowVortexTimer > 0)
    || (h.id === 'naiwa' && player.thunderTongueTimer > 0);
  if (uiCache.sGlow !== isSkillActive) {
    uiCache.sGlow = isSkillActive;
    skillBtn.classList.toggle('active-glow', isSkillActive);
  }

  if (h.id === 'nailong') {
    if (uiCache.sOnCd !== false) { uiCache.sOnCd = false; skillBtn.classList.remove('on-cd'); }
    setStyleCached('sCdH', skillCdShade, 'height', '0%');
    setStyleCached('sFuelW', skillFuelBar, 'width', `${Math.round(Math.max(0, player.flameFuel))}%`);
    setTextCached('sLbl', skillLbl, h.skillLbl);
  } else {
    setStyleCached('sFuelW', skillFuelBar, 'width', '0%');
    const onCd = player.skillCd > 0.05;
    if (uiCache.sOnCd !== onCd) { uiCache.sOnCd = onCd; skillBtn.classList.toggle('on-cd', onCd); }
    if (onCd) {
      const cdPct = Math.round(Math.min(100, (player.skillCd / Math.max(0.5, player.skillMaxCd)) * 100));
      setStyleCached('sCdH', skillCdShade, 'height', `${cdPct}%`);
      setTextCached('sLbl', skillLbl, `${player.skillCd.toFixed(1)}s`);
    } else {
      setStyleCached('sCdH', skillCdShade, 'height', '0%');
      setTextCached('sLbl', skillLbl, h.skillLbl || '技能');
    }
  }

  // Left-side Hold-to-Ram Hyper Dash UI
  if (hyperDashBtn) {
    const curE = Math.min(30, Math.max(0, Number(store.save.dashEnergy) || 0));
    const isEmpty = curE <= 0.05;
    if (uiCache.hEmpty !== isEmpty) { uiCache.hEmpty = isEmpty; hyperDashBtn.classList.toggle('empty', isEmpty); }
    if (uiCache.hThrust !== player.hyperDashActive) {
      uiCache.hThrust = player.hyperDashActive;
      hyperDashBtn.classList.toggle('thrusting', player.hyperDashActive);
    }
    const fillPct = Math.round((curE / 30) * 100);
    setStyleCached('hFillW', hyperFillBar, 'width', `${fillPct}%`);
    const hTxt = player.hyperDashActive
      ? `☄️ 冲刺中 ${(10 - player.hyperSessionSec).toFixed(1)}s (松手停)`
      : (isEmpty ? '☄️ 冲刺 0/3 (点此购买)' : `☄️ 按住冲刺 (${(curE / 10).toFixed(1)}/3)`);
    setTextCached('hLbl', hyperDashLbl, hTxt);
  }

  if (player.weaponId) {
    if (uiCache.wArmed !== true) { uiCache.wArmed = true; actionBtn.classList.add('weapon-armed'); }
    setTextCached('aIco', actionIcon, player.weaponId === 'gatling' ? '🏀' : '🦈');
    setTextCached('aLbl', actionLbl, player.weaponId === 'gatling' ? '加特林' : '火箭筒');
    setStyleCached('ammoW', ammoBar, 'width', `${Math.round(Math.max(0, (player.weaponTimer / player.weaponMaxTimer) * 100))}%`);
    return;
  }
  if (uiCache.wArmed !== false) { uiCache.wArmed = false; actionBtn.classList.remove('weapon-armed'); }
  setStyleCached('ammoW', ammoBar, 'width', '0%');
  setTextCached('aIco', actionIcon, '🐔');
  setTextCached('aLbl', actionLbl, '铁山靠');
}

function getBossCallbacks() {
  return {
    player,
    getGroundY: getBaseSurfaceY,
    hitBoss,
    takeDamage: (d) => takePlayerDamage(d, false),
    addPopup,
    spawnShockwave: (x, y, maxR, color) => {
      pushCapped(shockwaves, { x, y, r: 16, maxR, life: 0.34, color, harmless: false }, 12);
    },
    spawnBeans: spawnBeanFountain,
    grantShield: grantTempShield,
    spawnRail: (x, len, hOff, kind) => {
      rails.push({ x, len, hOff, kind: kind || 'suspenders', energizedTimer: 0 });
    },
    spawnPit: (x, len) => {
      pits.push({ x, len, bridged: false, lava: true });
    }
  };
}

// Hold-to-Ram Invincible Hyper Dash (with anti-slip pointer capture, 0.24s grace & empty->pause shop!)
function onHyperDashPress() {
  if (state !== 'PLAYING' || headStartTargetDist > 0) return;
  ensureAudio();
  const curE = Math.min(30, Math.max(0, Number(store.save.dashEnergy) || 0));
  if (curE <= 0.05) {
    // Tapped with 0 stock -> Pause & open emergency supply shop!
    playSfx('bean');
    pauseGame(true);
    return;
  }
  player.hyperDashHolding = true;
  player.hyperReleaseGrace = 0.24;
  if (!player.hyperDashActive) {
    player.hyperDashActive = true;
    player.hyperSessionSec = 0;
    player.hyperStartDist = runStats.dist;
    playSfx('hyper');
    shakeTime = 0.20; shakeMag = 10;
    pushCapped(shockwaves, { x: player.x + 25, y: player.y - 45, r: 16, maxR: 280, life: 0.32, color: '#fde047', harmless: false }, 12);
    addPopup('☄️ 究极霸王超级冲刺!! (松手即停)', player.x + 40, player.y - 105, '#fde047', 20);
  }
  syncControlsUI();
}

function onHyperDashRelease() {
  player.hyperDashHolding = false;
  // 0.24s anti-accidental-slip grace timer handles smooth stop in update()!
}

function forceStopHyperDash() {
  player.hyperDashHolding = false;
  player.hyperReleaseGrace = 0;
  if (player.hyperDashActive) {
    player.hyperDashActive = false;
    player.hyperSessionSec = 0;
    player.invulnTimer = Math.max(player.invulnTimer, 0.75);
    if (activeBoss && activeBoss.pinnedByHyper) {
      activeBoss.pinnedByHyper = false;
      activeBoss.worldX = activeBoss.kind === 'dagou_jiao' ? (player.x - 165) : (player.x + 295);
    }
    store.markMutatedAndSave(false);
    refreshBuffChips();
    syncControlsUI();
  }
}

function doJump() {
  if (state !== 'PLAYING' || headStartTargetDist > 0) return;
  ensureAudio();
  if (activeBoss && superBonusTimer <= 0 && handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'jump')) {
    syncControlsUI();
    return;
  }
  const h = getHero();
  const jPow = 585 * (player.giantTimer > 0 ? 1.08 : 1.0);
  if (player.onGround || player.onRail || player.coyoteTimer > 0) {
    player.vy = player.onRail ? -jPow * 1.08 : -jPow;
    player.onGround = false; player.onRail = null;
    player.coyoteTimer = 0; player.jumpBufferTimer = 0;
    player.jumpsLeft = getMaxJumps() - 1;
    player.jiggleVel = -220;
    playSfx('jump');
    syncControlsUI();
  } else if (player.jumpsLeft > 0) {
    player.vy = -jPow * 0.95;
    player.jumpsLeft -= 1;
    player.jumpBufferTimer = 0;
    player.jiggleVel = -255;
    playSfx('jump');
    pushCapped(shockwaves, {
      x: player.x, y: player.y, r: 8,
      maxR: h.id === 'hakimi' ? 58 : 46,
      life: 0.19,
      color: h.id === 'hakimi' ? '#fda4af' : '#bae6fd',
      harmless: true
    }, 12);
    syncControlsUI();
  }
}

function checkEnvironmentImpactArea(wx, wy, rad) {
  for (let i = 0; i < backboards.length; i++) {
    const bb = backboards[i];
    if (!bb.triggered && Math.hypot(wx - bb.x, wy - bb.y) < rad + 46) {
      bb.triggered = true;
      for (let j = 0; j < pits.length; j++) if (!pits[j].bridged && Math.abs(pits[j].x - bb.x) < 350) pits[j].bridged = true;
      player.boostTimer = 1.5;
      playSfx('crate');
      spawnBeanFountain(bb.x, bb.y, 4, 1);
      addPopup('空心入网!', bb.x, bb.y - 34, '#38bdf8');
    }
  }
  for (let i = 0; i < barrels.length; i++) {
    const br = barrels[i];
    if (!br.exploded && Math.hypot(wx - br.x, wy - br.y) < rad + 38) explodeBarrel(br);
  }
  for (let i = 0; i < hangers.length; i++) {
    const hg = hangers[i];
    if (!hg.fallen && Math.abs(wx - hg.x) < rad + 46 && wy < hg.boardY + 68) {
      hg.fallen = true; hg.fallVy = 120; playSfx('crater');
    }
  }
  for (let i = 0; i < bells.length; i++) {
    const bl = bells[i];
    if (bl.rungTimer <= 0 && Math.hypot(wx - bl.x, wy - bl.y) < rad + 44) {
      bl.rungTimer = 2.0; playSfx('crate');
      pushCapped(shockwaves, { x: bl.x, y: bl.y, r: 16, maxR: 400, life: 0.45, color: '#fde047', harmless: false }, 12);
      for (let j = 0; j < enemyShots.length; j++) { enemyShots[j].dead = true; }
      for (let j = 0; j < mudZones.length; j++) if (Math.abs(mudZones[j].x - bl.x) < 360) mudZones[j].dried = true;
      if (activeBoss) hitBoss(16, true, false);
    }
  }
  for (let i = 0; i < laserGates.length; i++) {
    const lg = laserGates[i];
    const swX = lg.x - 108, swY = getBaseSurfaceY(swX) - 32;
    if (!lg.hacked && (Math.hypot(wx - swX, wy - swY) < rad + 58 || Math.hypot(wx - lg.x, wy - (getBaseSurfaceY(lg.x) - 36)) < rad + 42)) {
      lg.hacked = true; player.boostTimer = 1.6; playSfx('crate');
      addPopup('⚡ 电网破除!', lg.x, getBaseSurfaceY(lg.x) - 82, '#4ade80');
    }
  }
}

function explodeBarrel(br) {
  if (br.exploded) return;
  br.exploded = true;
  playSfx('crater'); shakeTime = 0.24; shakeMag = 12;
  pushCapped(roadScars, { x: br.x, y: getBaseSurfaceY(br.x), r: 55 }, 10);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pushCapped(flamePuffs, { x: br.x, y: br.y - 8, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160 - 40, r: 16, life: 0.38, maxLife: 0.38 }, 30);
  }
  pushCapped(shockwaves, { x: br.x, y: br.y, r: 16, maxR: 235, life: 0.34, color: '#ef4444', harmless: false }, 12);
  spawnBeanFountain(br.x, br.y, 4, 1);
  for (let i = 0; i < enemies.length; i++) {
    if (!enemies[i].hit && Math.abs(enemies[i].x - br.x) < 230) { enemies[i].shielded = false; defeatEnemy(enemies[i]); }
  }
  for (let i = 0; i < cashTrucks.length; i++) {
    if (!cashTrucks[i].dead && Math.abs(cashTrucks[i].x - br.x) < 220) hitCashTruck(cashTrucks[i], 3);
  }
  if (activeBoss && Math.abs(activeBoss.worldX - br.x) < 265) hitBoss(22, true, false);
}

function hasNearbyParryThreat() {
  if (activeBoss && superBonusTimer <= 0 && hasBossImmediateParryCue(activeBoss, player)) return true;
  for (let i = 0; i < enemyShots.length; i++) {
    const sh = enemyShots[i];
    if (sh.dead || sh.parried || sh.kind === 'spike_roller' || sh.kind === 'hover_saw') continue;
    if (Math.hypot(sh.x - (player.x + 34), sh.y - (player.y - 46)) < 245) return true;
  }
  return false;
}

function tryExecuteParrySweep() {
  let didParry = false;
  if (activeBoss && superBonusTimer <= 0 && handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'parry')) {
    didParry = true;
  }

  for (let i = 0; i < enemyShots.length; i++) {
    const sh = enemyShots[i];
    if (sh.dead || sh.parried || sh.kind === 'spike_roller' || sh.kind === 'hover_saw') continue;
    if (Math.hypot(sh.x - (player.x + 34), sh.y - (player.y - 46)) < 220) {
      sh.parried = true; sh.vx = player.vx + 960; sh.vy = -55;
      player.invulnTimer = Math.max(player.invulnTimer, 0.70);
      player.actionCd = 0;
      didParry = true;
      hitStopTimer = 0.05; shakeTime = 0.20; shakeMag = 10;
      playSfx('parry');
      addPopup('🐔 铁山靠弹反!!', sh.x, sh.y - 44, '#fde047', 20);
    }
  }
  return didParry;
}

function onActionPress() {
  if (state !== 'PLAYING' || headStartTargetDist > 0) return;
  ensureAudio();
  actionHeld = true;

  if (player.weaponId) {
    tryExecuteParrySweep();
    player.parryWindowTimer = 0.48;
    if (player.actionCd <= 0) {
      player.actionCd = player.weaponId === 'gatling' ? 0.12 : 0.30;
      playSfx(player.weaponId === 'gatling' ? 'slash' : 'crater');
      const aimBack = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
      projectiles.push({
        kind: player.weaponId === 'gatling' ? 'ikun_pinball' : 'shark_bomb',
        x: player.x + (aimBack ? -36 : 52), y: player.y - 68,
        vx: player.vx + (aimBack ? -640 : 780), vy: player.weaponId === 'gatling' ? -40 : -150,
        bouncesLeft: player.weaponId === 'gatling' ? 6 : 2,
        r: 20, rot: 0, life: 3.2, homing: player.weaponId === 'gatling', trail: []
      });
    }
    return;
  }

  if (player.actionCd > 0 && !hasNearbyParryThreat()) {
    player.actionBufferTimer = 0.12;
    return;
  }
  player.actionBufferTimer = 0;
  player.actionCd = 0.04;
  player.strikeTimer = 0.34;
  player.parryWindowTimer = 0.52;
  playSfx('slash');

  checkEnvironmentImpactArea(player.x + 72, player.y - 46, 110);

  if (player.onRail && player.onRail.kind === 'maglev') {
    player.onRail.energizedTimer = 0.6;
    playSfx('crate');
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (!en.hit && en.x >= player.onRail.x - 40 && en.x <= player.onRail.x + player.onRail.len + 100) {
        en.shielded = false; defeatEnemy(en);
      }
    }
  }

  tryExecuteParrySweep();

  for (let i = 0; i < snowballs.length; i++) {
    const sb = snowballs[i];
    if (!sb.smashed && Math.hypot(sb.x - (player.x + 58), sb.y - (player.y - 36)) < 145) {
      sb.smashed = true;
      playSfx('crater'); shakeTime = 0.18; shakeMag = 9;
      spawnBeanFountain(sb.x, sb.y, 4, 1);
      addPopup('🐔 铁山碎冰!', sb.x, sb.y - 45, '#7dd3fc');
    }
  }

  pushCapped(shockwaves, { x: player.x + 48, y: player.y - 44, r: 12, maxR: 116, life: 0.18, color: '#fb923c', harmless: true }, 12);
  let hitAnyMob = false;
  for (let i = 0; i < enemies.length; i++) {
    const en = enemies[i];
    if (en.hit || en.swallowing) continue;
    const ey = getEnemyWorldY(en);
    const dx = en.x - player.x;
    if (dx > -30 && dx < 175 && Math.abs((ey - 24) - (player.y - 38)) < 92) {
      en.hit = true;
      hitAnyMob = true;
      projectiles.push({
        kind: 'bowling_mob', mobKind: en.kind,
        x: en.x, y: ey - 22, vx: player.vx + 760, vy: -175,
        bouncesLeft: 2, r: 24, rot: 0, life: 2.2
      });
      playSfx('parry');
      addPopup('🐔 铁山靠!', en.x, ey - 65, '#fde047');
    }
  }
  if (hitAnyMob) player.invulnTimer = Math.max(player.invulnTimer, 0.28);

  for (let i = 0; i < cashTrucks.length; i++) {
    if (!cashTrucks[i].dead && Math.abs(cashTrucks[i].x - (player.x + 68)) < 130) hitCashTruck(cashTrucks[i], 2);
  }
  if (activeBoss && Math.abs(activeBoss.worldX - player.x) < 215) {
    hitBoss(14, false, false);
  }
}

function onActionRelease() {
  actionHeld = false;
  player.skillHeld = false;
  player.flameHolding = false;
}

function fireNailoongFlamePulse(dtSlice) {
  player.flameFuel = Math.max(0, player.flameFuel - dtSlice * 25);
  if (player.flameFuel <= 1) {
    player.flameHolding = false;
    player.flameBurstTimer = 0;
  }
  if (!player.onGround && player.vy > -85) {
    player.vy = Math.max(-145, player.vy - 1750 * dtSlice);
  }
  const rearBoss = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
  if (Math.random() < 0.65) {
    pushCapped(flamePuffs, {
      x: player.x + (rearBoss ? -38 : 54),
      y: player.y - 92 + (Math.random() - 0.5) * 14,
      vx: player.vx + (rearBoss ? (-780 - Math.random() * 180) : (960 + Math.random() * 200)),
      vy: (Math.random() - 0.42) * 110,
      r: 16 + Math.random() * 9,
      life: 0.36,
      maxLife: 0.36
    }, 30);
  }
  const flameEnd = player.x + 495;
  checkEnvironmentImpactArea(player.x + 245, player.y - 54, 210);
  for (let i = 0; i < mudZones.length; i++) if (!mudZones[i].dried && flameEnd > mudZones[i].x && player.x < mudZones[i].x + mudZones[i].len) mudZones[i].dried = true;
  for (let i = 0; i < snowballs.length; i++) {
    if (!snowballs[i].smashed && snowballs[i].x > player.x && snowballs[i].x < flameEnd) {
      snowballs[i].smashed = true;
      spawnBeanFountain(snowballs[i].x, snowballs[i].y, 4, 1);
    }
  }
  for (let i = 0; i < enemies.length; i++) {
    const en = enemies[i];
    if (!en.hit && !en.swallowing && en.x > player.x - 10 && en.x < flameEnd && Math.abs(getEnemyWorldY(en) - player.y) < 135) {
      en.shielded = false;
      defeatEnemy(en);
    }
  }
  for (let i = 0; i < cashTrucks.length; i++) {
    const ct = cashTrucks[i];
    if (!ct.dead && ct.x > player.x && ct.x < flameEnd) {
      ct.burnTick = (ct.burnTick || 0) + dtSlice;
      if (ct.burnTick > 0.18) { ct.burnTick = 0; hitCashTruck(ct, 1); }
    }
  }
  if (activeBoss && activeBoss.worldX > player.x - 380 && activeBoss.worldX < flameEnd + 90) {
    activeBoss.flameTick = (activeBoss.flameTick || 0) + dtSlice;
    if (activeBoss.flameTick >= 0.18) {
      activeBoss.flameTick = 0;
      handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
      hitBoss(6.5, false, false);
    }
  }
}

function onSkillPress() {
  if (state !== 'PLAYING' || headStartTargetDist > 0) return;
  ensureAudio();
  const h = getHero();
  player.skillHeld = true;

  if (activeBoss && superBonusTimer <= 0) {
    handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
  }

  if (h.id === 'nailong') {
    if (player.flameFuel > 8) {
      player.flameHolding = true;
      player.flameBurstTimer = 0.95;
      playSfx('slash');
      playGentleSkillAccent('nailong', Boolean(activeBoss));
      fireNailoongFlamePulse(0.08);
      syncControlsUI();
    }
    return;
  }

  if (player.skillCd > 0.05) return;
  player.skillMaxCd = h.skillCd || 3.0;
  player.skillCd = player.skillMaxCd;

  if (h.id === 'ikun') {
    playSfx('crater');
    playGentleSkillAccent('ikun', Boolean(activeBoss));
    shakeTime = 0.18; shakeMag = 9;
    projectiles.push({
      kind: 'giant_bball',
      x: player.x + 54, y: player.y - 84,
      vx: player.vx + 165, vy: -650,
      bouncesLeft: 14, r: 46, rot: 0, life: 9.0, bossHitCd: 0, trail: []
    });
    addPopup('🏀 巨型高弹篮球!!', player.x + 48, player.y - 102, '#fb923c', 20);
  } else if (h.id === 'pelican') {
    player.swallowVortexTimer = 1.25;
    player.swallowedCount = 0;
    player.invulnTimer = Math.max(player.invulnTimer, 0.75);
    playSfx('parry');
    addPopup('🦩 大嘴鲸吞小怪!!', player.x + 48, player.y - 102, '#38bdf8', 20);
  } else if (h.id === 'naiwa') {
    player.thunderTongueTimer = 1.45;
    player.thunderTongueAngle = -0.6;
    player.thunderBossTick = 0;
    player.invulnTimer = Math.max(player.invulnTimer, 1.05);
    playSfx('parry');
    playGentleSkillAccent('naiwa', Boolean(activeBoss));
    shakeTime = 0.22; shakeMag = 10;
    addPopup('⚡ 雷霆长舌满屏扫!!', player.x + 45, player.y - 102, '#fde047', 20);
  } else {
    player.jumpsLeft = getMaxJumps();
    player.vy = -585;
    player.onGround = false;
    player.onRail = null;
    player.invulnTimer = Math.max(player.invulnTimer, 0.65);
    player.boostTimer = Math.max(player.boostTimer, 0.9);
    playSfx('jump');
    playGentleSkillAccent('hakimi', Boolean(activeBoss));
    pushCapped(shockwaves, { x: player.x, y: player.y, r: 14, maxR: 165, life: 0.30, color: '#f472b6', harmless: false }, 12);
    if (activeBoss && superBonusTimer <= 0 && Math.abs(activeBoss.worldX - player.x) < 280) hitBoss(18, false, false);
    addPopup('🐾 曼波踏空四连跳!', player.x + 28, player.y - 94, '#fda4af', 19);
  }
  syncControlsUI();
}

function onSkillRelease() {
  player.skillHeld = false;
  player.flameHolding = false;
}

function bindBtn(el, onDown, onUp, captureHold = false) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (captureHold && el.setPointerCapture) {
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    }
    el.classList.add('pressed'); onDown();
  });
  const finish = (e) => {
    if (e) e.preventDefault();
    if (!el.classList.contains('pressed')) return;
    el.classList.remove('pressed');
    if (onUp) onUp();
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  if (!captureHold) el.addEventListener('pointerleave', finish);
}

bindBtn(jumpBtn, () => { jumpHeld = true; player.jumpBufferTimer = 0.14; doJump(); }, () => { jumpHeld = false; }, false);
bindBtn(hyperDashBtn, onHyperDashPress, onHyperDashRelease, true); // Anti-accidental-slip pointer capture!
bindBtn(skillBtn, onSkillPress, onSkillRelease, false);
bindBtn(actionBtn, onActionPress, onActionRelease, false);

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'PLAYING') return;
  e.preventDefault();
  if (e.clientX < W * 0.5) { jumpHeld = true; player.jumpBufferTimer = 0.14; doJump(); }
  else onActionPress();
});
canvas.addEventListener('pointerup', () => { jumpHeld = false; onActionRelease(); });

window.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || !authOverlay.classList.contains('hidden') || !contactOverlay.classList.contains('hidden') || (rankOverlay && !rankOverlay.classList.contains('hidden'))) {
    if (e.code === 'Escape') {
      closeAuthModal();
      contactOverlay.classList.add('hidden');
      if (rankOverlay) rankOverlay.classList.add('hidden');
    }
    return;
  }
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (state === 'PLAYING') pauseGame(false);
    else if (state === 'PAUSED') resumeFromPause();
    return;
  }
  if (state === 'PAUSED' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    resumeFromPause();
    return;
  }
  if (state === 'HUB' && (e.code === 'Space' || e.code === 'Enter')) {
    startNewRun(store.save.selectedHero, store.save.selectedCheckpoint, preSelectedBoost);
    return;
  }
  if (state !== 'PLAYING') return;
  if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
    e.preventDefault(); jumpHeld = true; player.jumpBufferTimer = 0.14; doJump();
  } else if (e.code === 'KeyK' || e.code === 'KeyE' || e.code === 'ShiftLeft') {
    e.preventDefault(); onSkillPress();
  } else if (e.code === 'KeyJ' || e.code === 'KeyF' || e.code === 'Enter') {
    e.preventDefault(); onActionPress();
  } else if (e.code === 'KeyR' || e.code === 'KeyQ') {
    e.preventDefault(); onHyperDashPress();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') jumpHeld = false;
  if (e.code === 'KeyK' || e.code === 'KeyE' || e.code === 'ShiftLeft') onSkillRelease();
  if (e.code === 'KeyJ' || e.code === 'KeyF' || e.code === 'Enter') onActionRelease();
  if (e.code === 'KeyR' || e.code === 'KeyQ') onHyperDashRelease();
});

// ==================== COMBAT, STEEP SURVIVAL DAMAGE & 7-BOSS LIFECYCLE ====================
function defeatEnemy(en) {
  if (en.hit) return;
  en.hit = true;
  en.swallowing = false;
  const ey = getEnemyWorldY(en);
  combo += 1; comboTimer = 4.0;
  comboTag.classList.remove('hidden');
  comboTag.textContent = `x${combo}`;

  runStats.beans += en.kind === 'drone' ? 3 : 2;
  addSuperCharge(0.32);

  hitStopTimer = 0.016;
  playSfx('combo_kill', combo - 1);

  pushCapped(flyingDebris, {
    kind: 'ko_mob', mobKind: en.kind,
    x: en.x, y: ey - 24,
    vx: player.vx + 320 + Math.random() * 150,
    vy: -490 - Math.random() * 130,
    rot: 0, vRot: 15, life: 1.05
  }, 20);
  if (combo % 5 === 1) addPopup(MEME_CRIES[combo % MEME_CRIES.length], en.x, ey - 65, '#fde047');
}

function hitCashTruck(ct, dmg) {
  if (ct.dead) return;
  ct.hp -= dmg; ct.flash = 0.15;
  playSfx('parry'); shakeTime = 0.14; shakeMag = 8;
  spawnBeanFountain(ct.x - 25, ct.y - 20, 3, 1);
  if (ct.hp <= 0) {
    ct.dead = true;
    playSfx('crate'); shakeTime = 0.30; shakeMag = 13;
    runStats.beans += 18;
    spawnBeanFountain(ct.x, ct.y - 24, 10, 1);
    addPopup('💰 爆金币 +28🌿!!', ct.x, ct.y - 80, '#fde047', 20);
  }
}

function takePlayerDamage(rawDmg = 14, isPitFall = false) {
  if (state !== 'PLAYING' || headStartTargetDist > 0 || superBonusTimer > 0 || player.hyperDashActive) return;
  if (!isPitFall && (player.invulnTimer > 0 || player.giantTimer > 0 || player.rocketDashTimer > 0)) return;

  if (player.orbitSawTimer > 0 && player.sawShieldCharges > 0) {
    player.sawShieldCharges = 0;
    player.invulnTimer = 0.95;
    if (isPitFall) { player.vy = -590; player.onGround = false; }
    playSfx('parry');
    projectiles.push({ kind: 'riot_saw', x: player.x + 36, y: player.y - 24, vx: player.vx + 680, vy: 0, r: 23, rot: 0, life: 1.8 });
    addPopup('⚙️ 电锯护盾挡伤!', player.x + 25, player.y - 92, '#c084fc');
    updateTopHUD();
    return;
  }

  const grad = getSurvivalGradient(runStats.singleRunDist);
  const baseHit = isPitFall ? 16 : rawDmg;
  let dmg = Math.max(10, Math.round(baseHit * grad.dmgMult));

  if (player.tempShieldHp > 0 && player.tempShieldTimer > 0) {
    const absorbed = Math.min(player.tempShieldHp, dmg);
    player.tempShieldHp = Math.max(0, player.tempShieldHp - absorbed);
    dmg -= absorbed;
    if (player.tempShieldHp <= 0) player.tempShieldTimer = 0;
    if (dmg <= 0) {
      player.invulnTimer = 0.72;
      if (isPitFall) { player.vy = -565; player.onGround = false; }
      playSfx('parry');
      addPopup(`🛡️ 护盾抵消 -${absorbed}!`, player.x + 18, player.y - 96, '#38bdf8', 18);
      refreshBuffChips();
      updateTopHUD();
      return;
    }
  }

  player.hp = Math.max(0, player.hp - dmg);
  player.regenPool = Math.max(0, player.regenPool * 0.25);
  player.vx = Math.min(player.vx, 235);
  player.vy = isPitFall ? -565 : -210;
  player.onGround = false;
  player.onRail = null;
  player.invulnTimer = 0.78; // Snappy 0.78s i-frames so consecutive mistakes truly punish!
  combo = 0; comboTag.classList.add('hidden');
  player.flameHolding = false;
  player.flameBurstTimer = 0;

  hurtOverlay.style.opacity = '1';
  setTimeout(() => { hurtOverlay.style.opacity = '0'; }, 210);
  hpBarBox.classList.remove('hurt-shake');
  void hpBarBox.offsetWidth;
  hpBarBox.classList.add('hurt-shake');

  hitStopTimer = 0.04; shakeTime = 0.22; shakeMag = 11;
  player.hurtPoseTimer = 0.45;
  playSfx('hurt');
  addPopup(isPitFall ? `⚡坠坑弹起 -${dmg}HP` : `💥 -${dmg} HP`, player.x + 10, player.y - 98, '#fb7185', 19);
  updateTopHUD();

  if (player.hp <= 0) {
    forceStopHyperDash();
    state = 'DYING';
    stopBossBgm();
    playCriticalMomentVoice('player_death');
    deathSlowTimer = 1.0;
    bankRunProgress(true);
    autoUploadLeaderboardIfBest();
    pushCapped(flyingDebris, { kind: 'loose_wheel', x: player.x - 20, y: player.y - 24, vx: player.vx * 0.5 - 90, vy: -380, rot: 0, vRot: -12, r: 22, life: 1.8 }, 20);
    pushCapped(flyingDebris, { kind: 'loose_wheel', x: player.x + 25, y: player.y - 24, vx: player.vx * 0.8 + 140, vy: -440, rot: 0, vRot: 16, r: 22, life: 1.8 }, 20);
  }
}

function summonBossMinions(boss, count = 2) {
  let liveMobs = 0;
  for (let i = 0; i < enemies.length; i++) if (!enemies[i].hit && enemies[i].x > player.x - 40) liveMobs++;
  if (liveMobs >= 4) return;
  const spawnCnt = Math.min(count, 4 - liveMobs);
  const bx = boss.kind === 'dagou_jiao' ? (player.x + 340) : boss.worldX;
  for (let i = 0; i < spawnCnt; i++) {
    let mk = 'dribbler';
    if (boss.kind === 'dingdong_ji') mk = i % 2 === 0 ? 'pelican_guard' : 'dribbler';
    else if (boss.kind === 'dagou_jiao') mk = i % 2 === 0 ? 'boar_frog' : 'spiky_cat';
    else if (boss.kind === 'titan_naiwa') mk = i % 2 === 0 ? 'normal_frog' : 'boar_frog';
    else if (boss.kind === 'kun_mecha') mk = i % 2 === 0 ? 'dribbler' : 'shield_lawyer';
    else if (boss.kind === 'manbo_queen') mk = i === 0 ? 'drone' : 'normal_frog';
    else if (boss.kind === 'demon_hakimi') mk = i === 0 ? 'drone' : 'spiky_cat';
    else mk = i % 2 === 0 ? 'boar_frog' : 'drone';

    enemies.push({
      x: bx - 35 - i * 68,
      kind: mk,
      flyH: mk === 'drone' ? 112 : 0,
      shielded: mk === 'shield_lawyer',
      windupTimer: 0.85,
      chargePrep: 0.58,
      shotDone: false,
      hit: false,
      summonedByBoss: true,
      phase: i * 1.1
    });
  }
}

function refreshBossHudUI() {
  if (!activeBoss) return;
  const curHp = Math.max(0, Math.ceil(activeBoss.hp));
  bossTierTag.textContent = activeBoss.phase > 1 ? `${activeBoss.tierLbl}·${activeBoss.phase}阶` : activeBoss.tierLbl;
  bossTierTag.style.background = activeBoss.phase >= 3 ? '#dc2626' : (activeBoss.phase === 2 ? '#d97706' : activeBoss.tierBg);
  bossNameText.textContent = activeBoss.name;
  bossHpFill.style.width = `${Math.max(0, (activeBoss.hp / activeBoss.maxHp) * 100)}%`;
  bossHpNum.textContent = `${curHp}/${activeBoss.maxHp}`;
  bossHud.classList.toggle('enraged', activeBoss.phase > 1);
}

function drawRandomBossTemplate() {
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    const qaKind = new URLSearchParams(location.search).get('qaBoss');
    if (qaKind) {
      const found = BOSS_ROSTER.find((b) => b.kind === qaKind);
      if (found) return found;
    }
  }
  if (!bossBag || bossBag.length === 0) {
    bossBag = BOSS_ROSTER.map((_, i) => i);
    for (let i = bossBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bossBag[i], bossBag[j]] = [bossBag[j], bossBag[i]];
    }
    if (bossBag.length > 1 && BOSS_ROSTER[bossBag[bossBag.length - 1]].kind === lastBossKind) {
      [bossBag[0], bossBag[bossBag.length - 1]] = [bossBag[bossBag.length - 1], bossBag[0]];
    }
  }
  const idx = bossBag.pop();
  const picked = BOSS_ROSTER[idx] || BOSS_ROSTER[0];
  lastBossKind = picked.kind;
  return picked;
}

function spawnStageBoss() {
  if (superBonusTimer > 0 || headStartTargetDist > 0) return;
  const tpl = drawRandomBossTemplate();
  const encIdx = bossCycleCount;
  bossCycleCount += 1;
  const scaledHp = Math.round(205 + encIdx * 68 + runStats.singleRunDist * 0.16);
  const tierLabels = ['初阶', '次阶', '中阶', '强敌', '狂暴', '霸主'];
  const dynTierLbl = tierLabels[Math.min(tierLabels.length - 1, encIdx)];
  activeBoss = {
    tier: Math.min(6, encIdx + 1), tierLbl: dynTierLbl, tierBg: tpl.tierBg,
    kind: tpl.kind, sprite: tpl.sprite, name: tpl.name,
    maxHp: scaledHp, hp: scaledHp,
    dmgRate: 21 + Math.min(10, encIdx * 1.8), dmgBudget: 42, maxBudget: 58,
    phase: 1, maxPhases: encIdx >= 2 ? 3 : 2,
    reward: 58 + encIdx * 22,
    worldX: player.x + 335, yOff: 0,
    skillIdx: 0, minionTimer: 5.5,
    stunTimer: 0, flashTimer: 0
  };
  initBossCustomState(activeBoss, player.x);
  bossHazards.length = 0;
  refreshBossHudUI();
  bossHud.classList.remove('hidden');
  showToast(`⚠️ 首领降临：${tpl.name}!`);
  playSfx('crater');
  startBossBgm();
  playCriticalMomentVoice('boss_spawn', tpl.kind);
}

function hitBoss(dmg, causesStun = false, isCounter = false) {
  if (!activeBoss) return;
  let dealt = 0;
  if (isCounter) {
    dealt = dmg;
  } else {
    const mult = activeBoss.stunTimer > 0 ? 1.35 : 1.0;
    const raw = dmg * mult;
    if (activeBoss.dmgBudget >= raw) {
      dealt = raw;
      activeBoss.dmgBudget -= raw;
    } else {
      // Never silently swallow player attacks to 0 — always deal visible guaranteed damage!
      dealt = Math.max(raw * 0.55, activeBoss.dmgBudget);
      activeBoss.dmgBudget = 0;
    }
  }
  if (dealt <= 0.2) return;

  activeBoss.flashTimer = isCounter ? 0.24 : 0.14;
  activeBoss.hitSquash = isCounter ? 1.0 : 0.72;
  activeBoss.recoilX = Math.min(52, (activeBoss.recoilX || 0) + (isCounter ? 36 : 14));
  activeBoss.hp = Math.max(0, activeBoss.hp - dealt);

  const bgy = getBaseSurfaceY(activeBoss.worldX) - 75 + (activeBoss.yOff || 0);
  if (isCounter) {
    activeBoss.counterBannerTimer = 1.65;
    activeBoss.counterBannerTxt = `✅ 反制成功！破防重创 -${Math.round(dealt)} HP！`;
    hitStopTimer = Math.max(hitStopTimer, 0.07);
    shakeTime = Math.max(shakeTime, 0.22);
    shakeMag = Math.max(shakeMag, 11);
  } else {
    const nowP = performance.now();
    if (nowP - (activeBoss.lastDmgPopMs || 0) > 130) {
      activeBoss.lastDmgPopMs = nowP;
      addPopup(`-${Math.max(1, Math.round(dealt))}`, activeBoss.worldX, bgy - 22, '#fef08a', 18);
    }
  }

  if (causesStun && activeBoss.stunTimer <= 0) {
    activeBoss.stunTimer = isCounter ? 1.65 : 0.65;
  }

  const hpRatio = activeBoss.hp / activeBoss.maxHp;
  let wantPhase = activeBoss.phase;
  if (activeBoss.maxPhases === 2 && hpRatio <= 0.50) wantPhase = Math.max(wantPhase, 2);
  if (activeBoss.maxPhases === 3) {
    if (hpRatio <= 0.66) wantPhase = Math.max(wantPhase, 2);
    if (hpRatio <= 0.33) wantPhase = Math.max(wantPhase, 3);
  }
  if (wantPhase > activeBoss.phase && activeBoss.hp > 0) {
    activeBoss.phase = wantPhase;
    activeBoss.stunTimer = 0;
    shakeTime = 0.28; shakeMag = 12;
    playSfx('crater');
    playCriticalMomentVoice('boss_enrage', activeBoss.kind);
    summonBossMinions(activeBoss, 2);
    const bx = activeBoss.worldX, by = getBaseSurfaceY(bx);
    pushCapped(shockwaves, { x: bx, y: by - 45, r: 22, maxR: 320, life: 0.38, color: '#f43f5e', harmless: true }, 12);
    spawnBeanFountain(bx - 30, by - 45, 5, 1);
    addPopup(wantPhase === 3 ? '☄️ 三阶狂暴形态!!' : '🔥 二阶狂暴形态!!', bx - 35, by - 115, '#fde047', 20);
  }

  refreshBossHudUI();

  if (activeBoss.hp <= 0) {
    const bx = activeBoss.worldX, by = getBaseSurfaceY(bx);
    const rewardBeans = activeBoss.reward || 65;
    const defeatedKind = activeBoss.kind;
    const bossName = activeBoss.name;
    stopBossBgm();
    playCriticalMomentVoice('boss_defeat', defeatedKind); // Meme-matched defeat sound per Boss!
    spawnBeanFountain(bx, by - 30, 12, 2);
    hitStopTimer = 0.08; shakeTime = 0.36; shakeMag = 14;
    playSfx('crate');
    bossHud.classList.add('hidden');
    bossHud.classList.remove('enraged');
    enemyShots.length = 0;
    bossHazards.length = 0;
    activeBoss = null;
    runStats.bossKills += 1;
    nextBossDist = runStats.dist + getSurvivalGradient(runStats.singleRunDist).bossGap;
    runStats.beans += rewardBeans;
    const bossHeal = Math.max(22, Math.round(player.maxHp * 0.22));
    healPlayer(bossHeal, 0.55, true);
    addSuperCharge(6.0);
    bankRunProgress(true);
    showToast(`🏆 击败${bossName} · 赏金 +${rewardBeans}🌿!`);
  }
}

function updateTopHUD() {
  const maxHp = Math.max(1, Math.round(player.maxHp));
  const dispHp = player.displayHp !== undefined ? player.displayHp : player.hp;
  const trHp = player.trailHp !== undefined ? player.trailHp : dispHp;
  const curHp = Math.max(0, Math.round(dispHp));
  const hpPct = Math.round(Math.min(100, Math.max(0, (dispHp / maxHp) * 100)) * 2) / 2;
  const trailPct = Math.round(Math.min(100, Math.max(hpPct, (trHp / maxHp) * 100)) * 2) / 2;
  setStyleCached('hpMainW', hpMainFill, 'width', `${hpPct}%`);
  setStyleCached('hpTrailW', hpTrailFill, 'width', `${trailPct}%`);

  const hpBg = hpPct > 58
    ? 'linear-gradient(90deg, #16a34a, #4ade80)'
    : (hpPct > 28 ? 'linear-gradient(90deg, #d97706, #facc15)' : 'linear-gradient(90deg, #b91c1c, #fb7185)');
  setStyleCached('hpMainBg', hpMainFill, 'background', hpBg);

  const regenHint = player.regenPool > 0.8 ? ` (+${Math.ceil(player.regenPool)})` : '';
  setTextCached('hpTxt', hpText, `❤️ 生命 ${curHp} / ${maxHp} HP${regenHint}`);

  let shStr = '';
  if (player.tempShieldHp > 0 && player.tempShieldTimer > 0) {
    shStr = `🛡️${Math.ceil(player.tempShieldHp)} (${player.tempShieldTimer.toFixed(1)}s)`;
  } else if (player.orbitSawTimer > 0 && player.sawShieldCharges > 0) {
    shStr = '⚙️锯盾x1';
  }
  setTextCached('shTxt', shieldText, shStr);

  setTextCached('sDist', singleDistText, String(runStats.singleRunDist));
  if (singleTargetHud && singleChallengePill) {
    const rec = Math.max(prevBestSingleRun, store.save.bestSingleRun || 0);
    const isBrk = runStats.singleRunDist > prevBestSingleRun && prevBestSingleRun > 0;
    if (uiCache.recBrk !== isBrk) {
      uiCache.recBrk = isBrk;
      singleChallengePill.classList.toggle('breaking', isBrk);
    }
    const recTxt = isBrk
      ? `🔥 新纪录 +${runStats.singleRunDist - prevBestSingleRun}m`
      : (rec > 0 ? `🏆 最高 ${rec}m` : '🎯 冲击首纪!');
    setTextCached('recHud', singleTargetHud, recTxt);
  }

  if (threatHudBadge) {
    const grad = getSurvivalGradient(runStats.singleRunDist);
    setTextCached('thrLbl', threatHudBadge, grad.label);
    setStyleCached('thrCol', threatHudBadge, 'color', grad.color);
    setStyleCached('thrBdr', threatHudBadge, 'borderColor', grad.border);
  }

  setTextCached('tDist', distText, String(runStats.dist));
  setTextCached('rBeans', runBeansText, String(runStats.beans));
  setTextCached('spdTxt', speedText, `${(player.vx / 350).toFixed(1)}x⚡`);
  refreshHealSupplyUI();

  const pct = Math.round(superBonusTimer > 0 ? (superBonusTimer / SUPER_BONUS_DURATION) * 100 : superCharge);
  setStyleCached('supW', superBarFill, 'width', `${Math.min(100, Math.max(0, pct))}%`);
  const supTxt = superBonusTimer > 0
    ? `🌈 超级奖励 ${superBonusTimer.toFixed(1)}s`
    : `🌈 超级奖励 ${pct}%`;
  setTextCached('supLbl', superBarLbl, supTxt);
}

// ==================== 60FPS ZERO-LEAK MAIN UPDATE LOOP ====================
let chipUiTick = 0;

function findHomingTarget(px, py) {
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < enemyShots.length; i++) {
    const sh = enemyShots[i];
    if (sh.dead || sh.parried || sh.kind === 'spike_roller' || sh.kind === 'hover_saw') continue;
    const d = Math.hypot(sh.x - px, sh.y - py);
    if (sh.x > px - 35 && d < 320 && d * 0.65 < bestScore) { bestScore = d * 0.65; best = { x: sh.x, y: sh.y }; }
  }
  for (let i = 0; i < enemies.length; i++) {
    const en = enemies[i];
    if (en.hit) continue;
    const ey = getEnemyWorldY(en) - 24;
    const dx = en.x - px;
    if (dx < -40 || dx > 640) continue;
    const d = Math.hypot(dx, ey - py);
    if (d < bestScore) { bestScore = d; best = { x: en.x, y: ey }; }
  }
  if (activeBoss && superBonusTimer <= 0) {
    const by = getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff;
    const dx = activeBoss.worldX - px;
    if (dx > -460 && dx < 720) {
      const d = Math.hypot(dx, by - py) * 0.9;
      if (d < bestScore) { bestScore = d; best = { x: activeBoss.worldX, y: by }; }
    }
  }
  return best;
}

function update(realDt) {
  if (state === 'HUB' || state === 'PAUSED' || state === 'GAMEOVER') return;

  if (state === 'DYING') {
    deathSlowTimer -= realDt;
    const slowDt = realDt * 0.28;
    player.x += player.vx * 0.35 * slowDt;
    player.vy += 1200 * slowDt;
    player.y = Math.min(getBaseSurfaceY(player.x), player.y + player.vy * slowDt);
    player.angle += 7.5 * slowDt;
    for (let i = 0; i < flyingDebris.length; i++) {
      const d = flyingDebris[i];
      d.x += d.vx * slowDt; d.y += d.vy * slowDt; d.vy += 900 * slowDt; d.rot += d.vRot * slowDt;
      const gy = getBaseSurfaceY(d.x) - (d.r || 10);
      if (d.y > gy) { d.y = gy; d.vy = -Math.abs(d.vy) * 0.68; }
    }
    if (deathSlowTimer <= 0) openGameOverModal();
    return;
  }

  if (hitStopTimer > 0) { hitStopTimer -= realDt; return; }

  const dt = realDt;
  const h = getHero();

  if (player.regenPool > 0.01 && player.hp < player.maxHp) {
    const tickHeal = Math.min(player.regenPool, Math.max(9, player.maxHp * 0.11) * realDt);
    player.hp = Math.min(player.maxHp, player.hp + tickHeal);
    player.regenPool = Math.max(0, player.regenPool - tickHeal);
  } else if (player.hp >= player.maxHp) {
    player.regenPool = 0;
  }
  player.displayHp += (player.hp - player.displayHp) * Math.min(1, realDt * 13);
  if (player.trailHp > player.displayHp) {
    player.trailHp = Math.max(player.displayHp, player.trailHp - Math.max(14, player.maxHp * 0.18) * realDt);
  } else {
    player.trailHp = player.displayHp;
  }

  autoSaveTimer -= realDt;
  if (autoSaveTimer <= 0) {
    autoSaveTimer = 8.0; // Throttled save prevents synchronous localStorage main-thread stalls!
    bankRunProgress(false);
  }

  if (quickDashWindowTimer > 0) {
    quickDashWindowTimer -= realDt;
    if (quickDashWindowTimer <= 0) quickDashWrap.classList.add('hidden');
  }

  tickProceduralBgm(realDt, player.vx, superBonusTimer > 0, Boolean(activeBoss) && superBonusTimer <= 0);

  // Super Bonus Skyway + Seamless Boss Progress Restoration!
  if (superBonusTimer > 0) {
    bonusSkyAlpha = Math.min(1, bonusSkyAlpha + realDt * 2.0);
    superBonusTimer -= realDt;
    if (superBonusTimer > 0.35) {
      while (nextBonusShapeX < player.x + 1350) {
        spawnNextBonusFormation();
      }
    }
    if (superBonusTimer <= 0) {
      superBonusTimer = 0;
      player.vy = -80;
      player.onGround = false;
      player.invulnTimer = 2.2;
      nextSpawnX = Math.max(nextSpawnX, player.x + 420);
      playSfx('jump');
      if (activeBoss) {
        // Restore exact same Boss with exact remaining HP & Phase!
        activeBoss.worldX = activeBoss.kind === 'dagou_jiao' ? (player.x - 150) : (player.x + 330);
        clearBossTransientHazards(activeBoss);
        bossHud.classList.remove('hidden');
        refreshBossHudUI();
        resumeBossBgmIfNeeded(true);
        showToast(`⚔️ 超级奖励结束 · 继续决战 ${activeBoss.name} (剩${Math.ceil(activeBoss.hp)}HP)!`);
      } else {
        showToast('🏁 超级奖励结束 · 继续狂飙!');
      }
    }
  } else {
    bonusSkyAlpha = Math.max(0, bonusSkyAlpha - realDt * 1.8);
    if (headStartTargetDist <= 0) normalPlaySecSinceBonus += realDt;
  }
  if (stageFadeTimer > 0) stageFadeTimer = Math.max(0, stageFadeTimer - realDt * 1.1);

  // Camera dynamically shifts right when 🐕 大狗嚼 chases from BEHIND!
  const wantScreenRatio = (activeBoss && activeBoss.pinnedByHyper && superBonusTimer <= 0)
    ? 0.78
    : ((activeBoss && activeBoss.kind === 'dagou_jiao' && superBonusTimer <= 0) ? 0.39 : 0.18);
  smoothPlayerScreenRatio += (wantScreenRatio - smoothPlayerScreenRatio) * Math.min(1, realDt * 4.2);

  const targetZoom = (player.giantTimer > 0 || player.hyperDashActive || headStartTargetDist > 0 || superBonusTimer > 0 || player.thunderTongueTimer > 0) ? 0.90 : 1.0;
  smoothCamZoom += (targetZoom - smoothCamZoom) * Math.min(1, realDt * 3.5);
  const targetRefY = superBonusTimer > 0 ? -220 : Math.min(player.y, getBaseSurfaceY(player.x) + 45);
  smoothCamRefY += (targetRefY - smoothCamRefY) * Math.min(1, realDt * 5.2);

  if (combo > 0) { comboTimer -= realDt; if (comboTimer <= 0) { combo = 0; comboTag.classList.add('hidden'); } }
  if (shakeTime > 0) shakeTime -= realDt;
  if (player.invulnTimer > 0) player.invulnTimer -= realDt;
  if (player.hurtPoseTimer > 0) player.hurtPoseTimer -= realDt;
  if (player.strikeTimer > 0) {
    player.strikeTimer -= realDt;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing) continue;
      const ey = getEnemyWorldY(en);
      const dx = en.x - player.x;
      if (dx > -35 && dx < 205 && Math.abs((ey - 24) - (player.y - 38)) < 98) {
        en.shielded = false;
        defeatEnemy(en);
        player.invulnTimer = Math.max(player.invulnTimer, 0.32);
      }
    }
    for (let i = 0; i < enemyShots.length; i++) {
      const sh = enemyShots[i];
      if (!sh.dead && (sh.kind === 'spike_roller' || sh.kind === 'hover_saw')) {
        if (sh.x - player.x > -30 && sh.x - player.x < 195 && Math.abs(sh.y - (player.y - 24)) < 95) {
          sh.dead = true;
          playSfx('parry');
          player.invulnTimer = Math.max(player.invulnTimer, 0.32);
        }
      }
    }
    for (let i = 0; i < laserGates.length; i++) {
      const lg = laserGates[i];
      if (!lg.hacked && lg.x - player.x > -25 && lg.x - player.x < 185) {
        lg.hacked = true;
        lg.passed = true;
        playSfx('parry');
        player.invulnTimer = Math.max(player.invulnTimer, 0.32);
      }
    }
    for (let i = 0; i < snowballs.length; i++) {
      const sb = snowballs[i];
      if (!sb.smashed && sb.x - player.x > -30 && sb.x - player.x < 190) {
        sb.smashed = true;
        playSfx('crater');
        player.invulnTimer = Math.max(player.invulnTimer, 0.32);
      }
    }
  }
  if (player.parryWindowTimer > 0) {
    player.parryWindowTimer = Math.max(0, player.parryWindowTimer - realDt);
    tryExecuteParrySweep();
  }
  if (player.actionCd > 0) player.actionCd = Math.max(0, player.actionCd - realDt);
  if (player.actionBufferTimer > 0) {
    player.actionBufferTimer = Math.max(0, player.actionBufferTimer - realDt);
    if (player.actionCd <= 0) onActionPress();
  }
  if (player.skillCd > 0) player.skillCd = Math.max(0, player.skillCd - realDt);
  if (player.boostTimer > 0) player.boostTimer -= realDt;
  if (player.tempShieldTimer > 0) {
    player.tempShieldTimer -= realDt;
    if (player.tempShieldTimer <= 0) {
      player.tempShieldTimer = 0;
      if (player.tempShieldHp > 0) {
        player.tempShieldHp = 0;
        addPopup('🛡️ 限时护盾已过期', player.x + 15, player.y - 92, '#94a3b8', 15);
      }
      refreshBuffChips();
    }
  }
  if (player.giantTimer > 0) { player.giantTimer -= realDt; if (player.giantTimer <= 0) pushPropCooldownAhead(); }
  if (player.magnetTimer > 0) { player.magnetTimer -= realDt; if (player.magnetTimer <= 0) pushPropCooldownAhead(); }
  if (player.rocketDashTimer > 0) { player.rocketDashTimer -= realDt; if (player.rocketDashTimer <= 0) pushPropCooldownAhead(); }
  if (player.coyoteTimer > 0) player.coyoteTimer -= realDt;
  if (player.jumpBufferTimer > 0) {
    player.jumpBufferTimer -= realDt;
    if (player.onGround || player.onRail) doJump();
  }

  // ==================== HOLD-TO-RAM HYPER DASH ENGINE (MAX 10s, ANTI-SLIP GRACE & BOSS WALL PIN!) ====================
  if (player.hyperDashActive) {
    if (player.hyperDashHolding) {
      player.hyperReleaseGrace = 0.24; // Reset grace while held!
    } else {
      player.hyperReleaseGrace -= realDt;
    }
    const curE = Math.min(30, Math.max(0, Number(store.save.dashEnergy) || 0));
    const hyperCoveredM = Math.max(0, runStats.dist - (player.hyperStartDist ?? runStats.dist));
    if (player.hyperReleaseGrace <= 0 || curE <= 0.02 || player.hyperSessionSec >= 10.0 || hyperCoveredM >= 1200) {
      forceStopHyperDash();
    } else {
      store.save.dashEnergy = Math.max(0, curE - realDt);
      player.hyperSessionSec += realDt;
      player.invulnTimer = Math.max(player.invulnTimer, 0.45);
      shakeTime = Math.max(shakeTime, 0.06);
      shakeMag = Math.max(shakeMag, 6);

      player.hyperGhostTick = (player.hyperGhostTick || 0) - realDt;
      if (player.hyperGhostTick <= 0) {
        player.hyperGhostTick = 0.045;
        const hues = ['#38bdf8', '#fde047', '#f472b6', '#4ade80'];
        pushCapped(hyperGhosts, {
          x: player.x, y: player.y, angle: player.angle,
          col: hues[hyperGhosts.length % hues.length],
          life: 0.22, maxLife: 0.22
        }, 10);
      }

      // Bridge nearby pits & smash everything in path!
      for (let i = 0; i < pits.length; i++) {
        if (!pits[i].bridged && Math.abs(pits[i].x - player.x) < 280) pits[i].bridged = true;
      }
      checkEnvironmentImpactArea(player.x + 85, player.y - 48, 130);
      for (let i = 0; i < enemies.length; i++) {
        if (!enemies[i].hit && Math.abs(enemies[i].x - player.x) < 160) {
          enemies[i].shielded = false; defeatEnemy(enemies[i]);
        }
      }
      for (let i = 0; i < snowballs.length; i++) {
        if (!snowballs[i].smashed && Math.abs(snowballs[i].x - player.x) < 150) snowballs[i].smashed = true;
      }
      for (let i = 0; i < cashTrucks.length; i++) {
        if (!cashTrucks[i].dead && Math.abs(cashTrucks[i].x - player.x) < 150) hitCashTruck(cashTrucks[i], 10);
      }
      enemyShots.length = 0;

      // Against Boss: Drive Boss directly into Steel Containment Wall in front of bike (ZERO player.x teleport!)
      if (activeBoss && superBonusTimer <= 0) {
        clearBossTransientHazards(activeBoss);
        activeBoss.pinnedByHyper = true;
        const ramOsc = Math.sin(performance.now() * 0.085) * 10;
        activeBoss.worldX = player.x + 68 - ramOsc;
        const wallX = activeBoss.worldX + 28;
        activeBoss.yOff = Math.sin(performance.now() * 0.08) * 6;
        activeBoss.flashTimer = 0.08;

        const floorHp = Math.max(20, Math.ceil(activeBoss.maxHp * 0.12));
        if (activeBoss.hp > floorHp) {
          const pinDmg = activeBoss.maxHp * 0.044 * realDt; // ~44% MaxHP over full 10s, floored at >=12%!
          activeBoss.hp = Math.max(floorHp, activeBoss.hp - pinDmg);
          refreshBossHudUI();
        }
        player.hyperWallSparkTick = (player.hyperWallSparkTick || 0) - realDt;
        if (player.hyperWallSparkTick <= 0) {
          player.hyperWallSparkTick = 0.16;
          playSfx('parry');
          pushCapped(flamePuffs, {
            x: wallX - 18, y: getBaseSurfaceY(wallX) - 55 + (Math.random() - 0.5) * 40,
            vx: -180 - Math.random() * 140, vy: -120 - Math.random() * 90,
            r: 18, life: 0.28, maxLife: 0.28
          }, 30);
          if (activeBoss.hp <= floorHp + 1) {
            addPopup('💥 已抵墙削至残血 · 收手终结它!', activeBoss.worldX - 55, getBaseSurfaceY(wallX) - 115, '#fde047', 17);
          } else {
            addPopup('💥 抵墙狂创!!', activeBoss.worldX - 35, getBaseSurfaceY(wallX) - 108, '#fde047', 18);
          }
        }
      }
    }
  }
  for (let i = 0; i < hyperGhosts.length; i++) hyperGhosts[i].life -= realDt;
  compactInPlace(hyperGhosts, (g) => g.life > 0);

  if (player.vx > 430 && speedLines.length < 16 && Math.random() < 0.55) {
    speedLines.push({ x: W + 20, y: Math.random() * H, len: 60 + Math.random() * 90, life: 0.20 });
  }
  for (let i = 0; i < speedLines.length; i++) { speedLines[i].x -= 1750 * realDt; speedLines[i].life -= realDt; }
  compactInPlace(speedLines, (s) => s.life > 0);

  if (player.weaponTimer > 0) {
    player.weaponTimer -= realDt;
    player.autoFireTick -= realDt;
    if (player.weaponId === 'gatling' && player.autoFireTick <= 0) {
      player.autoFireTick = 0.22;
      const gBack = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
      projectiles.push({ kind: 'ikun_pinball', x: player.x + (gBack ? -32 : 54), y: player.y - 64, vx: player.vx + (gBack ? -620 : 800), vy: (Math.random() - 0.5) * 60, bouncesLeft: 5, r: 14, rot: 0, life: 2.1, homing: true, trail: [] });
      playSfx('slash');
    } else if (actionHeld && player.actionCd <= 0) {
      onActionPress();
    }
    if (player.weaponTimer <= 0) {
      player.weaponId = null;
      pushPropCooldownAhead();
      syncControlsUI();
    }
  }

  if (player.orbitSawTimer > 0) {
    player.orbitSawTimer -= realDt;
    const baseA = performance.now() * 0.011;
    for (let k = 0; k < 2; k++) {
      const a = baseA + k * Math.PI;
      const sx = player.x + Math.cos(a) * 80, sy = (player.y - 46) + Math.sin(a) * 58;
      checkEnvironmentImpactArea(sx, sy, 32);
      for (let i = 0; i < enemies.length; i++) {
        if (!enemies[i].hit && !enemies[i].swallowing && Math.hypot(enemies[i].x - sx, (getEnemyWorldY(enemies[i]) - 24) - sy) < 48) {
          enemies[i].shielded = false; defeatEnemy(enemies[i]);
        }
      }
    }
    if (player.orbitSawTimer <= 0) {
      player.orbitSawTimer = 0;
      player.sawShieldCharges = 0;
      pushPropCooldownAhead();
    }
  }

  if (player.mortarTimer > 0) {
    player.mortarTimer -= realDt;
    player.mortarShotTick -= realDt;
    if (player.mortarShotTick <= 0) {
      player.mortarShotTick = 0.62;
      playSfx('slash');
      const mBack = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
      projectiles.push({
        kind: 'shark_bomb',
        x: player.x - 28, y: player.y - 78,
        vx: player.vx + (mBack ? (-460 - Math.random() * 80) : (560 + Math.random() * 110)),
        vy: -310 - Math.random() * 45,
        r: 20, rot: 0, life: 2.0
      });
    }
    if (player.mortarTimer <= 0) {
      player.mortarTimer = 0;
      pushPropCooldownAhead();
    }
  }

  chipUiTick -= realDt;
  if (chipUiTick <= 0) { chipUiTick = 0.25; refreshBuffChips(); }

  for (let i = 0; i < player.slashLines.length; i++) player.slashLines[i].timer -= realDt;
  compactInPlace(player.slashLines, (s) => s.timer > 0);
  for (let i = 0; i < bells.length; i++) if (bells[i].rungTimer > 0) bells[i].rungTimer -= realDt;
  for (let i = 0; i < rails.length; i++) if (rails[i].energizedTimer > 0) rails[i].energizedTimer -= realDt;
  for (let i = 0; i < flamePuffs.length; i++) {
    const fp = flamePuffs[i];
    fp.x += fp.vx * dt; fp.y += fp.vy * dt - 30 * dt; fp.r += 24 * dt; fp.life -= realDt;
  }
  compactInPlace(flamePuffs, (f) => f.life > 0);

  if (h.id === 'nailong') {
    if (player.flameBurstTimer > 0) player.flameBurstTimer = Math.max(0, player.flameBurstTimer - realDt);
    if ((player.flameHolding || player.flameBurstTimer > 0) && player.flameFuel > 0) {
      fireNailoongFlamePulse(realDt);
    } else {
      player.flameHolding = false;
      player.flameFuel = Math.min(100, player.flameFuel + realDt * 45);
    }
  }

  if (player.swallowVortexTimer > 0) {
    player.swallowVortexTimer -= realDt;
    const mouthX = player.x + 42, mouthY = player.y - 82;
    for (let i = 0; i < enemyShots.length; i++) {
      const sh = enemyShots[i];
      if (!sh.dead && sh.x > player.x - 20 && sh.x < player.x + 420) {
        if (beans.length < 95) beans.push({ x: sh.x, y: sh.y, val: 2, giant: true, taken: false });
        sh.dead = true;
      }
    }
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing) continue;
      const ey = getEnemyWorldY(en);
      if (en.x > player.x - 15 && en.x < player.x + 440 && Math.abs((ey - 24) - (player.y - 52)) < 180) {
        en.swallowing = true;
        en.shielded = false;
        en.swallowX = en.x;
        en.swallowY = ey - 24;
        en.swallowProg = 0;
        playSfx('jump');
      }
    }
    if (player.swallowVortexTimer <= 0 && player.swallowedCount === 0) {
      const pBack = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
      projectiles.push({ kind: 'fish_shot', x: player.x + (pBack ? -30 : 50), y: mouthY + 12, vx: player.vx + (pBack ? -620 : 760), vy: -50, r: 18, rot: 0, life: 1.8 });
      pushCapped(shockwaves, { x: mouthX + 10, y: mouthY + 20, r: 12, maxR: 150, life: 0.25, color: '#38bdf8', harmless: false }, 12);
    }
  }

  for (let i = 0; i < enemies.length; i++) {
    const en = enemies[i];
    if (!en.swallowing || en.hit) continue;
    const mouthX = player.x + 42, mouthY = player.y - 82;
    en.swallowProg = Math.min(1, (en.swallowProg || 0) + realDt * 4.6);
    en.swallowX += (mouthX - en.swallowX) * Math.min(1, realDt * 16);
    en.swallowY += (mouthY - en.swallowY) * Math.min(1, realDt * 16);
    en.x = en.swallowX;
    if (en.swallowProg >= 0.95 || Math.hypot(en.swallowX - mouthX, en.swallowY - mouthY) < 26) {
      en.hit = true;
      en.swallowing = false;
      player.swallowedCount += 1;
      combo += 1; comboTimer = 4.0;
      comboTag.classList.remove('hidden');
      comboTag.textContent = `x${combo}`;
      runStats.beans += 4;
      playSfx('crater');
      const sbBack = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
      projectiles.push({
        kind: 'shark_bomb',
        x: player.x + (sbBack ? -30 : 54), y: mouthY + 8,
        vx: player.vx + (sbBack ? -620 : 820), vy: -145 - (player.swallowedCount % 2) * 65,
        r: 22, rot: 0, life: 2.1
      });
      addPopup('🦩 吞怪吐重炮!', mouthX + 15, mouthY - 22, '#38bdf8', 18);
    }
  }

  if (player.thunderTongueTimer > 0) {
    player.thunderTongueTimer -= realDt;
    player.thunderTongueAngle += 24.0 * realDt;
    const cx = player.x + 4, cy = player.y - 68;
    const tongueR = 375;
    checkEnvironmentImpactArea(cx + 110, cy, 240);
    for (let i = 0; i < enemyShots.length; i++) {
      if (!enemyShots[i].dead && Math.hypot(enemyShots[i].x - cx, enemyShots[i].y - cy) < tongueR) enemyShots[i].dead = true;
    }
    for (let i = 0; i < snowballs.length; i++) {
      if (!snowballs[i].smashed && Math.hypot(snowballs[i].x - cx, snowballs[i].y - cy) < tongueR) snowballs[i].smashed = true;
    }
    for (let i = 0; i < enemies.length; i++) {
      if (!enemies[i].hit && !enemies[i].swallowing && Math.hypot(enemies[i].x - cx, (getEnemyWorldY(enemies[i]) - 24) - cy) < tongueR) {
        enemies[i].shielded = false; defeatEnemy(enemies[i]);
      }
    }
    player.thunderBossTick -= realDt;
    if (player.thunderBossTick <= 0) {
      player.thunderBossTick = 0.16;
      playSfx('slash');
      for (let i = 0; i < cashTrucks.length; i++) {
        if (!cashTrucks[i].dead && Math.abs(cashTrucks[i].x - cx) < tongueR) hitCashTruck(cashTrucks[i], 1);
      }
      if (activeBoss && Math.abs(activeBoss.worldX - cx) < tongueR + 60) {
        handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
        hitBoss(5.8, false, false);
      }
    }
  }

  // Steep Escalating Speed & Survival Gradient!
  let inMud = false, onIce = false;
  if (player.onGround && !player.mountId && player.giantTimer <= 0 && superBonusTimer <= 0) {
    for (let i = 0; i < mudZones.length; i++) {
      if (!mudZones[i].dried && player.x > mudZones[i].x && player.x < mudZones[i].x + mudZones[i].len) { inMud = true; break; }
    }
    for (let i = 0; i < iceZones.length; i++) {
      if (player.x > iceZones[i].x && player.x < iceZones[i].x + iceZones[i].len) { onIce = true; break; }
    }
  }

  const grad = getSurvivalGradient(runStats.singleRunDist);
  const curKmStage = grad.kmMilestone || grad.tier;
  if (curKmStage > lastThreatTier && superBonusTimer <= 0) {
    lastThreatTier = curKmStage;
    shakeTime = 0.25; shakeMag = 11;
    playSfx('crater');
    showToast(`⚠️ 突破 ${curKmStage - 1}km · ${grad.label}！`);
  }

  let desiredVx = player.baseSpeed + grad.speedAdd;
  if (headStartTargetDist > 0) desiredVx = 1380;
  else if (player.hyperDashActive) desiredVx = activeBoss && activeBoss.pinnedByHyper ? 340 : 960;
  else if (player.rocketDashTimer > 0) desiredVx = Math.max(desiredVx * 1.42, 920);
  else if (superBonusTimer > 0) desiredVx = Math.max(desiredVx * 1.15, 520);
  else if (player.boostTimer > 0 || player.giantTimer > 0 || onIce) desiredVx *= onIce ? 1.24 : 1.20;
  else if (inMud) desiredVx *= 0.72;
  player.vx += (desiredVx - player.vx) * Math.min(1, dt * 8);

  if (headStartTargetDist > 0) {
    player.x += player.vx * dt;
    const flyY = getBaseSurfaceY(player.x) - 115;
    player.y += (flyY - player.y) * Math.min(1, dt * 10);
    player.vy = 0; player.onGround = false; player.angle = -0.06;
    for (let i = 0; i < enemies.length; i++) if (!enemies[i].hit && Math.abs(enemies[i].x - player.x) < 150) defeatEnemy(enemies[i]);
    if (runStats.dist >= headStartTargetDist) {
      headStartTargetDist = 0;
      player.invulnTimer = 1.4;
      pushCapped(shockwaves, { x: player.x, y: player.y, r: 20, maxR: 360, life: 0.36, color: '#fde047', harmless: false }, 12);
      playSfx('crater');
      showToast('🏁 冲刺结束 · 全速迎战!');
      refreshBuffChips();
    }
  } else if (player.hyperDashActive) {
    player.x += player.vx * dt;
    if (activeBoss && activeBoss.pinnedByHyper && superBonusTimer <= 0) {
      const targetY = getBaseSurfaceY(player.x) - 14;
      player.y += (targetY - player.y) * Math.min(1, dt * 15);
    } else {
      const flyY = superBonusTimer > 0 ? -265 : getBaseSurfaceY(player.x) - 28;
      player.y += (flyY - player.y) * Math.min(1, dt * 14);
    }
    player.vy = 0; player.onGround = false; player.angle = -0.04;
  } else if (player.rocketDashTimer > 0) {
    player.x += player.vx * dt;
    const flyY = superBonusTimer > 0 ? -290 : getBaseSurfaceY(player.x) - 95;
    player.y += (flyY - player.y) * Math.min(1, dt * 10);
    player.vy = 0; player.onGround = false; player.angle = -0.05;
  } else {
    player.x += player.vx * dt;
  }

  const prevSingleMeters = runStats.singleRunDist;
  runStats.dist = Math.floor((player.x - 120) / 18);
  runStats.singleRunDist = Math.max(0, runStats.dist - runStartDist);
  const deltaSingleMeters = Math.max(0, runStats.singleRunDist - prevSingleMeters);
  if (deltaSingleMeters > 0 && superBonusTimer <= 0 && headStartTargetDist <= 0) {
    normalPlayDistSinceBonus += deltaSingleMeters;
    addSuperCharge(deltaSingleMeters * 0.14);
  }

  const curStageIdx = Math.floor(runStats.dist / STAGE_SPAN_M) % STAGES.length;
  if (curStageIdx !== stageIndex && superBonusTimer <= 0) {
    prevStageIndex = stageIndex;
    stageFadeTimer = 1.0;
    stageIndex = curStageIdx;
    showToast(STAGES[stageIndex].name);
  }

  if (recordFlag && !recordFlag.passed && player.x >= recordFlag.x) {
    recordFlag.passed = true;
    playSfx('crate');
    playCriticalMomentVoice('new_record');
    pushCapped(shockwaves, { x: recordFlag.x, y: getBaseSurfaceY(recordFlag.x) - 50, r: 20, maxR: 380, life: 0.45, color: '#fde047', harmless: true }, 12);
    spawnBeanFountain(recordFlag.x, getBaseSurfaceY(recordFlag.x) - 55, 8, 2);
    showToast(`🏆 突破单命最高纪录 ${recordFlag.singleDist}m！继续冲！`);
  }

  for (let i = 0; i < checkpointFlags.length; i++) {
    const fl = checkpointFlags[i];
    if (!fl.passed && player.x >= fl.x) {
      fl.passed = true;
      if (fl.dist > store.save.maxCheckpoint) {
        store.save.maxCheckpoint = fl.dist;
        store.save.selectedCheckpoint = fl.dist;
      }
      bankRunProgress(true);
      playSfx('crate');
      showToast(`🚩 存档点 ${fl.dist}m 已激活!`);
    }
  }

  if (!activeBoss && superBonusTimer <= 0 && headStartTargetDist <= 0 && runStats.dist >= nextTruckDist) {
    nextTruckDist = runStats.dist + 420;
    const tx = player.x + 430;
    cashTrucks.push({ x: tx, y: getBaseSurfaceY(tx), hp: 6, dead: false, flash: 0 });
    showToast('🚨 装甲运钞车！用技能或踩顶打爆它!');
  }
  if (!activeBoss && superBonusTimer <= 0 && headStartTargetDist <= 0 && runStats.dist >= nextBossDist) {
    spawnStageBoss();
  }

  player.jiggleVel += (-180 * player.jiggle - 10 * player.jiggleVel) * dt;
  player.jiggle += player.jiggleVel * dt;
  player.wheelAngle += (player.vx * dt) / 23;
  player.crankAngle += ((player.vx * dt) / 32) * (h.id === 'naiwa' ? 1.7 : 1.0);

  const tState = getTerrainStateAt(player.x);
  const gY = tState.y;
  const gSlope = getTerrainSlope(player.x);

  let matchedRail = null, matchedRailY = 0;
  if (superBonusTimer <= 0 && headStartTargetDist <= 0 && !player.hyperDashActive && player.rocketDashTimer <= 0 && player.vy >= -65) {
    for (let i = 0; i < rails.length; i++) {
      const rl = rails[i];
      if (player.x >= rl.x && player.x <= rl.x + rl.len) {
        const ry = getBaseSurfaceY(player.x) - rl.hOff;
        if (Math.abs(player.y - ry) < 26) { matchedRail = rl; matchedRailY = ry; break; }
      }
    }
  }
  if (matchedRail) {
    player.y = matchedRailY; player.vy = 0;
    player.onRail = matchedRail; player.onGround = false;
    player.jumpsLeft = getMaxJumps();
    player.angle = gSlope * 0.4;
    if (matchedRail.kind === 'maglev') player.boostTimer = Math.max(player.boostTimer, 0.25);
  } else {
    player.onRail = null;
  }

  if (headStartTargetDist <= 0 && !player.hyperDashActive && player.rocketDashTimer <= 0 && !player.onRail) {
    if (player.onGround && tState.isPit) player.onGround = false;
    if (!player.onGround) {
      let grav = 1380;
      if (h.id === 'pelican' && jumpHeld && player.vy > 40) {
        grav = 400; player.vy = Math.min(player.vy, 145);
      } else if (!jumpHeld && player.vy < -170) {
        grav = 2020;
      }
      player.vy += grav * dt;
      player.y += player.vy * dt;

      if (tState.isPit && player.y > tState.baseY + 84) {
        if (player.giantTimer > 0) {
          player.y = tState.baseY; player.vy = -560;
        } else {
          player.x += 55;
          player.y = tState.baseY - 75;
          player.jumpsLeft = getMaxJumps();
          takePlayerDamage(16, true);
        }
      } else if (!tState.isPit && player.y >= gY) {
        player.y = gY; player.vy = 0;
        player.onGround = true;
        player.jumpsLeft = getMaxJumps();
        player.angle = gSlope;
        player.jiggleVel = 210;
      } else {
        player.angle += (Math.max(-0.42, Math.min(0.42, player.vy * 0.0007)) - player.angle) * dt * 8;
      }
    } else {
      player.y = gY;
      player.coyoteTimer = 0.14;
      player.angle += (gSlope - player.angle) * Math.min(1, dt * 14);
    }
  }

  spawnWorldAhead();

  // Pickup Props (Includes Slowly Floating Sky-Parachute Airdrops!)
  const propTouchR = (player.giantTimer > 0 || player.hyperDashActive) ? 95 : 68;
  for (let i = 0; i < worldProps.length; i++) {
    const wp = worldProps[i];
    if (wp.taken) continue;
    wp.phase += dt * 3.4;
    if (wp.parachute) {
      wp.x += player.vx * 0.56 * dt + Math.sin(wp.phase) * 26 * dt;
      wp.y += 40 * dt; // Floats gently down from the sky!
      const landingY = getBaseSurfaceY(wp.x) - 52;
      if (wp.y >= landingY) {
        wp.y = landingY;
        wp.baseY = landingY;
        wp.parachute = false;
      }
    } else if (wp.def.id === 'heal_boba') {
      const dx = wp.x - player.x, dy = wp.y - (player.y - 48);
      const distP = Math.hypot(dx, dy);
      if (distP < 135 && !player.onGround && player.hp < player.maxHp) {
        wp.x -= (dx / Math.max(1, distP)) * 440 * dt;
        wp.y -= (dy / Math.max(1, distP)) * 440 * dt;
      } else {
        wp.y = wp.baseY + Math.sin(wp.phase) * 8;
      }
    } else {
      wp.y = wp.baseY + Math.sin(wp.phase) * 9;
    }
    if (Math.hypot(wp.x - player.x, wp.y - (player.y - 48)) < propTouchR) {
      wp.taken = true;
      activateWorldProp(wp.def);
    }
  }

  if (superBonusTimer <= 0) {
    for (let i = 0; i < cashTrucks.length; i++) {
      const ct = cashTrucks[i];
      if (ct.dead) continue;
      if (ct.flash > 0) ct.flash -= realDt;
      ct.x += (player.vx * 0.72) * dt;
      ct.y = getBaseSurfaceY(ct.x);
      if (Math.abs(ct.x - player.x) < 64 && Math.abs((ct.y - 26) - (player.y - 32)) < 50) {
        if (player.giantTimer > 0 || player.rocketDashTimer > 0 || headStartTargetDist > 0) {
          hitCashTruck(ct, 10);
        } else if (player.vy > 35 && player.y < ct.y - 22) {
          player.vy = -570;
          player.onGround = false;
          player.jumpsLeft = getMaxJumps();
          hitCashTruck(ct, 3);
          addPopup('👟 踩顶破甲!', ct.x, ct.y - 68, '#4ade80');
        } else {
          ct.x = player.x + 88;
          player.vx = Math.min(player.vx, 250);
          if (!ct.nudgeCd || ct.nudgeCd <= 0) {
            ct.nudgeCd = 1.2;
            playSfx('bean');
            addPopup('💥 按技能或踩顶爆金币!', ct.x, ct.y - 68, '#fde047');
          }
        }
      }
      if (ct.nudgeCd > 0) ct.nudgeCd -= realDt;
    }

    for (let i = 0; i < lilyPads.length; i++) {
      const lp = lilyPads[i];
      if (lp.anim > 0) lp.anim = Math.max(0, lp.anim - dt * 3.5);
      const ly = getBaseSurfaceY(lp.x) - lp.yOff;
      if (Math.abs(player.x - lp.x) < 44 && Math.abs(player.y - ly) < 34 && player.vy >= -40) {
        lp.anim = 1.0; player.vy = -720; player.onGround = false; player.jumpsLeft = getMaxJumps();
        playSfx('jump');
      }
    }

    for (let i = 0; i < backboards.length; i++) {
      if (!backboards[i].triggered && Math.hypot(player.x - backboards[i].x, (player.y - 45) - backboards[i].y) < 65) {
        checkEnvironmentImpactArea(backboards[i].x, backboards[i].y, 30);
      }
    }

    for (let i = 0; i < hangers.length; i++) {
      const hg = hangers[i];
      if (hg.fallen) {
        const groundY = getBaseSurfaceY(hg.x) - 22;
        if (hg.boardY < groundY) {
          hg.fallVy += 1500 * dt; hg.boardY += hg.fallVy * dt;
          if (hg.boardY >= groundY) {
            hg.boardY = groundY; playSfx('crater'); shakeTime = 0.22; shakeMag = 11;
            for (let j = 0; j < enemies.length; j++) if (!enemies[j].hit && Math.abs(enemies[j].x - hg.x) < 170) { enemies[j].shielded = false; defeatEnemy(enemies[j]); }
            if (activeBoss && Math.abs(activeBoss.worldX - hg.x) < 215) hitBoss(20, true, false);
          }
        }
      }
    }

    for (let i = 0; i < laserGates.length; i++) {
      const lg = laserGates[i];
      if (Math.abs(player.x - lg.x) < 26 && player.y > getBaseSurfaceY(lg.x) - 72) {
        if (lg.hacked || player.giantTimer > 0 || player.rocketDashTimer > 0 || headStartTargetDist > 0) {
          if (!lg.passed) { lg.passed = true; lg.hacked = true; player.boostTimer = 1.6; runStats.beans += 2; playSfx('crate'); }
        } else {
          lg.hacked = true;
          takePlayerDamage(15, false);
        }
      }
    }

    for (let i = 0; i < snowballs.length; i++) {
      const sb = snowballs[i];
      if (sb.smashed) continue;
      if (sb.x - player.x < 940) sb.x += sb.vx * dt;
      sb.y = getBaseSurfaceY(sb.x) - 28;
      sb.rot -= 5.5 * dt;
      if (Math.abs(sb.x - player.x) < 40 && Math.abs(sb.y - (player.y - 26)) < 42) {
        if (player.giantTimer > 0 || player.rocketDashTimer > 0 || headStartTargetDist > 0) {
          sb.smashed = true;
          playSfx('crater');
        } else if (player.vy > 35 && player.y < sb.y - 4) {
          sb.smashed = true;
          player.vy = -580;
          playSfx('crater');
        } else {
          sb.smashed = true;
          takePlayerDamage(15, false);
        }
      }
    }
  }

  // Projectiles Update
  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i];
    if (pr.kind === 'ikun_pinball') {
      if (!pr.trail) pr.trail = [];
      pr.trail.push({ x: pr.x, y: pr.y });
      if (pr.trail.length > 8) pr.trail.shift();

      const lockT = findHomingTarget(pr.x, pr.y);
      if (lockT) {
        const wantA = Math.atan2(lockT.y - pr.y, lockT.x - pr.x);
        const curA = Math.atan2(pr.vy, pr.vx);
        let diff = wantA - curA;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = 16.5 * dt;
        const nextA = curA + Math.max(-maxTurn, Math.min(maxTurn, diff));
        const spd = Math.max(820, player.vx + 620);
        pr.vx = Math.cos(nextA) * spd;
        pr.vy = Math.sin(nextA) * spd;
      } else {
        const floorY = (superBonusTimer > 0 ? -220 : getBaseSurfaceY(pr.x)) - pr.r;
        if (pr.y > floorY) { pr.y = floorY; pr.vy = -Math.abs(pr.vy) - 220; }
      }

      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.rot += 15 * dt; pr.life -= dt;
      checkEnvironmentImpactArea(pr.x, pr.y, pr.r + 24);

      for (let j = 0; j < enemies.length; j++) {
        const en = enemies[j];
        if (en.hit || pr.life <= 0) continue;
        if (Math.hypot(pr.x - en.x, pr.y - (getEnemyWorldY(en) - 24)) < pr.r + 34) {
          en.shielded = false; defeatEnemy(en);
          pr.bouncesLeft -= 1;
          if (pr.bouncesLeft <= 0) pr.life = 0;
          else pr.vy = -240;
          break;
        }
      }
    } else if (pr.kind === 'giant_bball') {
      if (!pr.trail) pr.trail = [];
      pr.trail.push({ x: pr.x, y: pr.y });
      if (pr.trail.length > 8) pr.trail.shift();
      if (pr.bossHitCd > 0) pr.bossHitCd -= dt;

      const bDir = (activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x) ? -1 : 1;
      pr.vx = player.vx + bDir * 170;
      pr.vy += 940 * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.rot += 5.0 * dt;
      pr.life -= dt;
      checkEnvironmentImpactArea(pr.x, pr.y, pr.r + 36);

      for (let j = 0; j < enemies.length; j++) {
        if (!enemies[j].hit && !enemies[j].swallowing && Math.hypot(pr.x - enemies[j].x, pr.y - (getEnemyWorldY(enemies[j]) - 24)) < pr.r + 38) {
          enemies[j].shielded = false; defeatEnemy(enemies[j]);
        }
      }
      const gy = (superBonusTimer > 0 ? -220 : getBaseSurfaceY(pr.x)) - pr.r;
      if (pr.y >= gy && pr.life > 0) {
        pr.y = gy;
        playSfx('jump');
        pushCapped(shockwaves, { x: pr.x, y: gy + pr.r, r: 18, maxR: 185, life: 0.24, color: '#fb923c', harmless: false }, 12);
        if (pr.bouncesLeft > 0) { pr.bouncesLeft -= 1; pr.vy = -685; }
        else pr.life = 0;
      }
      if (activeBoss && pr.life > 0 && (pr.bossHitCd || 0) <= 0 && Math.hypot(pr.x - activeBoss.worldX, pr.y - (getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff)) < pr.r + 65) {
        pr.bossHitCd = 0.45;
        pr.vy = -620;
        playSfx('parry');
        handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'projectile');
        hitBoss(22, true, false);
      }
      continue;
    } else if (pr.kind === 'riot_saw') {
      pr.x += pr.vx * dt; pr.y = getBaseSurfaceY(pr.x) - pr.r; pr.rot += 20 * dt; pr.life -= dt;
      checkEnvironmentImpactArea(pr.x, pr.y, pr.r + 26);
      for (let j = 0; j < enemies.length; j++) if (!enemies[j].hit && !enemies[j].swallowing && Math.abs(pr.x - enemies[j].x) < pr.r + 32) { enemies[j].shielded = false; defeatEnemy(enemies[j]); }
    } else {
      pr.vy += 1050 * dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.rot += 12 * dt; pr.life -= dt;
      checkEnvironmentImpactArea(pr.x, pr.y, pr.r + 28);
      for (let j = 0; j < cashTrucks.length; j++) {
        if (!cashTrucks[j].dead && Math.hypot(pr.x - cashTrucks[j].x, pr.y - (cashTrucks[j].y - 20)) < 58) { hitCashTruck(cashTrucks[j], 3); pr.life = 0; }
      }
      const gy = (superBonusTimer > 0 ? -220 : getBaseSurfaceY(pr.x)) - pr.r;
      if (pr.y >= gy && pr.life > 0) {
        pr.y = gy; playSfx('crater');
        pushCapped(shockwaves, { x: pr.x, y: gy + pr.r, r: 14, maxR: 180, life: 0.24, color: '#f97316', harmless: false }, 12);
        if (pr.bouncesLeft && pr.bouncesLeft > 0) { pr.bouncesLeft -= 1; pr.vy = -420; }
        else pr.life = 0;
      }
      for (let j = 0; j < enemies.length; j++) {
        if (!enemies[j].hit && !enemies[j].swallowing && Math.hypot(pr.x - enemies[j].x, pr.y - (getEnemyWorldY(enemies[j]) - 24)) < pr.r + 34) {
          enemies[j].shielded = false; defeatEnemy(enemies[j]);
          if (pr.kind === 'fish_shot') pr.life = 0;
        }
      }
    }
    if (activeBoss && pr.life > 0 && Math.hypot(pr.x - activeBoss.worldX, pr.y - (getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff)) < pr.r + 60) {
      pr.bouncesLeft = 0;
      pr.life = 0;
      handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'projectile');
      if (pr.kind === 'ikun_pinball') hitBoss(9.5, false, false);
      else if (pr.kind === 'bowling_mob') hitBoss(24.0, true, false);
      else if (pr.kind === 'shark_bomb') hitBoss(18.0, true, false);
      else if (pr.kind === 'riot_saw') hitBoss(16.0, false, false);
      else hitBoss(10.0, false, false);
    }
  }
  compactInPlace(projectiles, (p) => p.life > 0);

  for (let i = 0; i < shockwaves.length; i++) {
    const sw = shockwaves[i];
    sw.r += (sw.maxR - sw.r) * dt * 11; sw.life -= realDt;
    if (!sw.harmless) {
      for (let j = 0; j < enemies.length; j++) if (!enemies[j].hit && Math.abs(enemies[j].x - sw.x) < sw.r) { enemies[j].shielded = false; defeatEnemy(enemies[j]); }
    }
  }
  compactInPlace(shockwaves, (s) => s.life > 0);

  // ==================== 7 SUBSTANTIALLY DIFFERENTIATED BOSS ENGINES ====================
  const cam = getCamera();
  let parryGlow = false;
  let jumpGlow = false;

  if (activeBoss && superBonusTimer <= 0 && !activeBoss.pinnedByHyper) {
    activeBoss.dmgBudget = Math.min(activeBoss.maxBudget, activeBoss.dmgBudget + activeBoss.dmgRate * dt);
    if (activeBoss.flashTimer > 0) activeBoss.flashTimer -= realDt;

    activeBoss.minionTimer = (activeBoss.minionTimer ?? 6.0) - dt;
    if (activeBoss.minionTimer <= 0) {
      activeBoss.minionTimer = activeBoss.phase >= 2 ? 6.4 : 7.6;
      summonBossMinions(activeBoss, 2);
    }

    updateBossEngine(activeBoss, {
      ...getBossCallbacks(),
      cam,
      W,
      threatMult: grad.dmgMult
    }, dt);

    if (hasBossImmediateParryCue(activeBoss, player)) parryGlow = true;
    if (hasBossImmediateJumpCue(activeBoss, player)) jumpGlow = true;
  }

  // Road Enemy & Shot Updates (Aggression & Shot Speed Scale Purely by Distance Tier!)
  if (superBonusTimer <= 0) {
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing) continue;
      const distAhead = en.x - player.x;
      if (en.kind === 'drone' && grad.tier >= 2 && distAhead < 680 && distAhead > -80) {
        if (en.baseFlyH === undefined) en.baseFlyH = en.flyH || 112;
        en.flyH = en.baseFlyH + Math.sin(performance.now() * 0.0055 + (en.phase || 0)) * (12 + grad.tier * 5);
      }
      if ((en.kind === 'boar_frog' || en.summonedByBoss) && distAhead < 510 && distAhead > -40) {
        if ((en.chargePrep ?? 0.48) > 0) en.chargePrep -= dt;
        else en.x -= ((en.kind === 'boar_frog' ? 140 : 105) + grad.tier * 32) * dt;
      }
      if (en.kind === 'shield_lawyer' && !en.shotDone && distAhead < 540 && distAhead > 175) {
        en.windupTimer = (en.windupTimer ?? 0.62) - dt * (1 + grad.tier * 0.14);
        if (en.windupTimer <= 0) {
          en.shotDone = true;
          const orbVx = -(145 + grad.tier * 34);
          enemyShots.push({ kind: 'lawyer_orb', x: en.x - 22, y: getBaseSurfaceY(en.x) - 42, targetH: 44, vx: orbVx, parried: false, rot: 0 });
          if (grad.tier >= 4) {
            enemyShots.push({ kind: 'lawyer_orb', x: en.x + 28, y: getBaseSurfaceY(en.x) - 96, targetH: 96, vx: orbVx * 0.92, parried: false, rot: 0 });
          }
        }
      }
    }

    for (let i = 0; i < enemyShots.length; i++) {
      const sh = enemyShots[i];
      if (sh.kind === 'spike_roller') {
        if (sh.x - player.x < 940) sh.x += sh.vx * dt;
        sh.y = getBaseSurfaceY(sh.x);
        sh.rot -= 13 * dt;
        if (Math.abs(sh.x - player.x) < 30 && player.y > sh.y - 34) {
          sh.dead = true;
          if (player.giantTimer <= 0) takePlayerDamage(16, false);
        }
      } else if (sh.kind === 'hover_saw') {
        if (sh.x - player.x < 940) sh.x += sh.vx * dt;
        sh.y = getBaseSurfaceY(sh.x) - (sh.hOff || 98);
        sh.rot -= 15 * dt;
        if (Math.hypot(sh.x - player.x, sh.y - (player.y - 40)) < 33) {
          sh.dead = true;
          if (player.giantTimer <= 0) takePlayerDamage(16, false);
        }
      } else if (!sh.parried) {
        const wantY = getBaseSurfaceY(sh.x) - (sh.targetH || 44);
        sh.y += (wantY - sh.y) * dt * 5.2;
        sh.x += sh.vx * dt;
        sh.rot = Math.sin(performance.now() * 0.012) * 0.16;
        const d = Math.hypot(sh.x - (player.x + 28), sh.y - (player.y - 46));
        if (d < 215) parryGlow = true;
        if (d < 33) {
          sh.dead = true;
          if (player.giantTimer > 0) { sh.parried = true; sh.dead = false; }
          else takePlayerDamage(14, false);
        }
      } else {
        sh.x += (player.vx + 960) * dt; sh.rot += 20 * dt;
        if (activeBoss && Math.hypot(sh.x - activeBoss.worldX, sh.y - (getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff)) < 78) {
          sh.dead = true;
          const parryDmg = Math.round(38 + activeBoss.maxHp * 0.12);
          addPopup(`💥 弹反暴击 -${parryDmg}!!`, activeBoss.worldX - 20, getBaseSurfaceY(activeBoss.worldX) - 96, '#fde047', 20);
          hitBoss(parryDmg, true, true);
        }
        for (let j = 0; j < enemies.length; j++) {
          if (!enemies[j].hit && !enemies[j].swallowing && Math.abs(sh.x - enemies[j].x) < 55) {
            enemies[j].shielded = false; defeatEnemy(enemies[j]); sh.dead = true;
          }
        }
      }
    }
    // Wide upper bound (cam.camX + 2650) ensures ahead-of-camera ambush saws are NEVER prematurely culled!
    compactInPlace(enemyShots, (s) => !s.dead && s.x > cam.camX - 180 && s.x < cam.camX + 2650);
  }

  if (uiCache.pGlow !== parryGlow) {
    uiCache.pGlow = parryGlow;
    actionBtn.classList.toggle('glow', parryGlow);
  }
  if (uiCache.jGlow !== jumpGlow) {
    uiCache.jGlow = jumpGlow;
    jumpBtn.classList.toggle('glow', jumpGlow);
  }

  // Grounded Bean Collection
  const magR = (player.magnetTimer > 0 || player.hyperDashActive || superBonusTimer > 0 || headStartTargetDist > 0)
    ? 540
    : (player.giantTimer > 0 ? 120 : 62);

  for (let i = 0; i < beans.length; i++) {
    const b = beans[i];
    if (b.taken) continue;
    if (b.dynamic) {
      b.vy += 920 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      const gy = getBaseSurfaceY(b.x) - 18;
      if (b.y >= gy) { b.y = gy; b.vy = -Math.abs(b.vy) * 0.45; b.vx *= 0.7; }
    }
    const dx = b.x - player.x, dy = b.y - (player.y - 48);
    const d = Math.hypot(dx, dy);
    if (d < magR) {
      b.x -= (dx / Math.max(1, d)) * 860 * dt;
      b.y -= (dy / Math.max(1, d)) * 860 * dt;
    }
    if (d < (player.giantTimer > 0 ? 75 : 50)) {
      b.taken = true;
      runStats.beans += b.giant ? 3 : Math.min(2, b.val || 1);
      addSuperCharge(b.giant ? 0.20 : 0.06);
      playSfx('bean', combo);
    }
  }

  if (superBonusTimer <= 0 && !player.hyperDashActive) {
    const hitW = player.giantTimer > 0 ? 68 : 36;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing) continue;
      const ey = getEnemyWorldY(en);
      if (Math.abs(en.x - player.x) < hitW && Math.abs((ey - 22) - (player.y - 34)) < hitW) {
        if (player.giantTimer > 0 || player.rocketDashTimer > 0 || headStartTargetDist > 0) {
          en.shielded = false;
          defeatEnemy(en);
        } else if (en.kind === 'spiky_cat') {
          en.hit = true;
          takePlayerDamage(13, false);
        } else if ((player.vy > 30 && player.y < ey - 6) || (en.kind === 'drone' && player.vy > -45 && player.y < ey + 10)) {
          en.shielded = false;
          player.vy = en.kind === 'drone' ? -600 : -555;
          player.jumpsLeft = Math.max(1, player.jumpsLeft);
          defeatEnemy(en);
        } else {
          en.hit = true;
          takePlayerDamage(en.kind === 'boar_frog' ? 15 : 12, false);
        }
      }
    }
  }

  for (let i = 0; i < flyingDebris.length; i++) {
    const d = flyingDebris[i];
    d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 980 * dt; d.rot += d.vRot * dt; d.life -= realDt;
  }
  compactInPlace(flyingDebris, (d) => d.life > 0);

  for (let i = 0; i < popups.length; i++) { popups[i].x += player.vx * 0.88 * realDt; popups[i].y += popups[i].vy * realDt; popups[i].life -= realDt; }
  compactInPlace(popups, (p) => p.life > 0);

  // Zero-allocation in-place world cleanup!
  const cut = cam.camX - 280;
  compactInPlace(pits, (p) => p.x + p.len > cut);
  compactInPlace(mudZones, (m) => m.x + m.len > cut);
  compactInPlace(iceZones, (iz) => iz.x + iz.len > cut);
  compactInPlace(snowballs, (sb) => !sb.smashed && sb.x > cut);
  compactInPlace(lilyPads, (l) => l.x > cut);
  compactInPlace(catapults, (c) => c.x > cut);
  compactInPlace(backboards, (b) => b.x > cut);
  compactInPlace(barrels, (b) => !b.exploded && b.x > cut);
  compactInPlace(hangers, (hg) => hg.x > cut);
  compactInPlace(bells, (bl) => bl.x > cut);
  compactInPlace(geysers, (g) => g.x > cut);
  compactInPlace(laserGates, (l) => l.x > cut);
  compactInPlace(rails, (r) => r.x + r.len > cut);
  compactInPlace(checkpointFlags, (f) => f.x > cut);
  compactInPlace(worldProps, (w) => !w.taken && w.x > cut);
  compactInPlace(cashTrucks, (c) => !c.dead && c.x > cut);
  compactInPlace(roadScars, (s) => s.x > cut);
  compactInPlace(beans, (b) => !b.taken && b.x > cut);
  compactInPlace(enemies, (e) => !e.hit && e.x > cut);

  syncControlsUI();
  updateTopHUD();
}

// ==================== 60FPS GPU-CLEAN RENDERING ENGINE ====================
function renderHubPreview(now) {
  if (state !== 'HUB') return;
  const cw = hubPreviewCanvas.clientWidth || 360;
  const ch = hubPreviewCanvas.clientHeight || 114;
  if (hubPreviewCanvas.width !== Math.floor(cw * dpr)) {
    hubPreviewCanvas.width = Math.floor(cw * dpr);
    hubPreviewCanvas.height = Math.floor(ch * dpr);
  }
  pCtx.save();
  pCtx.scale(dpr, dpr);
  pCtx.fillStyle = '#38bdf8'; pCtx.fillRect(0, 0, cw, ch);
  pCtx.fillStyle = '#bae6fd'; pCtx.fillRect(0, ch * 0.45, cw, ch * 0.55);
  pCtx.fillStyle = '#15803d'; pCtx.fillRect(0, ch - 22, cw, 22);
  pCtx.fillStyle = '#334155'; pCtx.fillRect(0, ch - 24, cw, 9);

  const t = now * 0.008;
  drawSculptedBikeAndHero(pCtx, store.save.selectedHero, cw * 0.48, ch - 14, 0, t, t * 0.8, Math.sin(t * 2) * 3, store.save.mods, { scale: 0.63 });
  pCtx.restore();
}

function drawAtmosphereAndScenery(camX) {
  const st = STAGES[stageIndex];
  const sg = ctx.createLinearGradient(0, 0, 0, H);
  sg.addColorStop(0, st.skyTop); sg.addColorStop(0.58, st.skyMid); sg.addColorStop(1, st.skyBot);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);

  if (stageFadeTimer > 0 && prevStageIndex !== stageIndex) {
    const pst = STAGES[prevStageIndex];
    ctx.save();
    ctx.globalAlpha = stageFadeTimer;
    const psg = ctx.createLinearGradient(0, 0, 0, H);
    psg.addColorStop(0, pst.skyTop); psg.addColorStop(0.58, pst.skyMid); psg.addColorStop(1, pst.skyBot);
    ctx.fillStyle = psg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (bonusSkyAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = bonusSkyAlpha;
    const rg = ctx.createLinearGradient(0, 0, 0, H);
    rg.addColorStop(0, '#4f46e5'); rg.addColorStop(0.45, '#ec4899'); rg.addColorStop(1, '#fef08a');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    if (bonusSkyAlpha >= 0.98) return;
  }

  ctx.save();
  drawSpaldingWheelOn(ctx, W * 0.82, H * 0.16, 24, performance.now() * 0.0008);
  if (st.id === 'court') {
    for (let sx = -80; sx < W + 140; sx += 170) {
      const ox = sx - ((camX * 0.18) % 170);
      ctx.fillStyle = 'rgba(30, 41, 59, 0.28)';
      ctx.beginPath(); ctx.moveTo(ox, H * 0.68); ctx.lineTo(ox + 12, H * 0.48); ctx.lineTo(ox + 108, H * 0.48); ctx.lineTo(ox + 120, H * 0.68); ctx.closePath(); ctx.fill();
    }
  } else if (st.id === 'snow') {
    for (let sx = -100; sx < W + 180; sx += 190) {
      const ox = sx - ((camX * 0.16) % 190);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.48)';
      ctx.beginPath(); ctx.moveTo(ox - 20, H * 0.70); ctx.lineTo(ox + 75, H * 0.26); ctx.lineTo(ox + 175, H * 0.70); ctx.closePath(); ctx.fill();
    }
  } else if (st.id === 'volcano') {
    for (let sx = -90; sx < W + 200; sx += 220) {
      const ox = sx - ((camX * 0.19) % 220);
      ctx.fillStyle = 'rgba(28, 25, 23, 0.72)';
      ctx.beginPath(); ctx.moveTo(ox - 10, H * 0.70); ctx.lineTo(ox + 65, H * 0.30); ctx.lineTo(ox + 115, H * 0.30); ctx.lineTo(ox + 190, H * 0.70); ctx.closePath(); ctx.fill();
    }
  } else if (st.id === 'bamboo') {
    for (let sx = -40; sx < W + 90; sx += 68) {
      const ox = sx - ((camX * 0.23) % 68);
      ctx.fillStyle = 'rgba(6, 78, 59, 0.45)';
      ctx.fillRect(ox, H * 0.14, 11, H * 0.56);
    }
  } else {
    for (let sx = -50; sx < W + 130; sx += 125) {
      const ox = sx - ((camX * 0.22) % 125);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.48)';
      ctx.fillRect(ox, H * 0.34, 68, H * 0.36);
    }
  }
  ctx.restore();
}

function drawParryRing(cx, cy, dist) {
  const ratio = Math.max(0, Math.min(1.5, (dist - 115) / 225));
  const inZone = dist <= 205;
  ctx.save(); ctx.translate(cx, cy);
  ctx.strokeStyle = inZone ? '#fde047' : 'rgba(253,224,71,0.65)';
  ctx.lineWidth = inZone ? 5 : 2.8;
  ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = inZone ? '#4ade80' : '#ffffff';
  ctx.lineWidth = 3.8; ctx.setLineDash([8, 5]);
  ctx.beginPath(); ctx.arc(0, 0, 28 + ratio * 42, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  if (inZone) {
    ctx.font = '900 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fde047';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.strokeText('🐔弹反!', 0, -34);
    ctx.fillText('🐔弹反!', 0, -34);
  }
  ctx.restore();
}

function render() {
  ctx.save();
  ctx.scale(dpr, dpr);

  const cam = getCamera();
  const { worldScale, camX, camY } = cam;
  drawAtmosphereAndScenery(camX);

  if (speedLines.length > 0) {
    ctx.strokeStyle = player.hyperDashActive ? 'rgba(253, 224, 71, 0.78)' : 'rgba(255, 255, 255, 0.50)';
    ctx.lineWidth = player.hyperDashActive ? 4.5 : 3;
    ctx.beginPath();
    for (let i = 0; i < speedLines.length; i++) {
      const sl = speedLines[i];
      ctx.moveTo(sl.x, sl.y); ctx.lineTo(sl.x + sl.len, sl.y);
    }
    ctx.stroke();
  }

  ctx.save();
  if (shakeTime > 0) {
    ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
  }
  ctx.scale(worldScale, worldScale);
  ctx.translate(-camX, -camY);

  const startWX = camX - 90;
  const endWX = camX + W / worldScale + 160;
  const st = STAGES[stageIndex];

  if (superBonusTimer > 0) {
    ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 22;
    ctx.beginPath(); ctx.moveTo(startWX, -214); ctx.lineTo(endWX, -214); ctx.stroke();
    ctx.strokeStyle = '#fde047'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(startWX, -220); ctx.lineTo(endWX, -220); ctx.stroke();
  } else {
    ctx.fillStyle = st.grass;
    ctx.beginPath();
    ctx.moveTo(startWX, camY + H / worldScale + 280);
    for (let wx = startWX; wx <= endWX; wx += 18) ctx.lineTo(wx, getTerrainStateAt(wx).y);
    ctx.lineTo(endWX, camY + H / worldScale + 280);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = st.road; ctx.lineWidth = 18;
    ctx.beginPath();
    let penDown = false;
    for (let wx = startWX; wx <= endWX; wx += 18) {
      const ts = getTerrainStateAt(wx);
      if (ts.isPit) penDown = false;
      else {
        if (!penDown) { ctx.moveTo(wx, ts.y + 5); penDown = true; }
        else ctx.lineTo(wx, ts.y + 5);
      }
    }
    ctx.stroke();

    for (let i = 0; i < pits.length; i++) {
      const pit = pits[i];
      if (pit.x > endWX + 120) continue;
      const y1 = getBaseSurfaceY(pit.x), y2 = getBaseSurfaceY(pit.x + pit.len);
      if (!pit.bridged) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.85)';
        ctx.fillRect(pit.x, y1 + 14, pit.len, 220);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(pit.x, y1); ctx.lineTo(pit.x, y1 + 120);
        ctx.moveTo(pit.x + pit.len, y2); ctx.lineTo(pit.x + pit.len, y2 + 120);
        ctx.stroke();
        const warnX = pit.x - 42, warnY = getBaseSurfaceY(warnX) - 48 + Math.sin(performance.now() * 0.015) * 6;
        ctx.save(); ctx.translate(warnX, warnY);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = '900 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⬆️', 0, 1);
        ctx.restore();
      }
      if (pit.bridged) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(pit.x - 8, y1 - 2, pit.len + 16, 12);
      }
    }

    for (let i = 0; i < checkpointFlags.length; i++) {
      const fl = checkpointFlags[i];
      if (fl.x > endWX) continue;
      const fy = getBaseSurfaceY(fl.x);
      ctx.save(); ctx.translate(fl.x, fy);
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -102); ctx.stroke();
      ctx.fillStyle = fl.passed ? '#4ade80' : '#f97316';
      ctx.beginPath(); ctx.moveTo(0, -100); ctx.lineTo(54, -85); ctx.lineTo(0, -70); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0f172a'; ctx.font = '900 10px sans-serif';
      ctx.fillText(`${fl.dist}m`, 5, -82);
      ctx.restore();
    }

    if (recordFlag && recordFlag.x > startWX - 160 && recordFlag.x < endWX + 160) {
      const rfy = getBaseSurfaceY(recordFlag.x);
      ctx.save(); ctx.translate(recordFlag.x, rfy);
      ctx.fillStyle = '#eab308'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(-36, -158, 12, 160, 4); ctx.roundRect(24, -158, 12, 160, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = recordFlag.passed ? '#22c55e' : '#facc15';
      ctx.beginPath(); ctx.roundRect(-68, -184, 136, 34, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#0f172a'; ctx.font = '900 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(recordFlag.passed ? `🎉已破纪录 ${recordFlag.singleDist}m!` : `🏆单命最高纪录 ${recordFlag.singleDist}m`, 0, -163);
      ctx.restore();
    }

    for (let i = 0; i < mudZones.length; i++) {
      const mz = mudZones[i];
      if (mz.x > endWX) continue;
      ctx.strokeStyle = mz.dried ? '#ca8a04' : '#7e22ce'; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(mz.x, getBaseSurfaceY(mz.x) + 4); ctx.lineTo(mz.x + mz.len, getBaseSurfaceY(mz.x + mz.len) + 4); ctx.stroke();
    }

    for (let i = 0; i < lilyPads.length; i++) {
      const lp = lilyPads[i];
      if (lp.x <= endWX) {
        const lpy = getBaseSurfaceY(lp.x) - lp.yOff + lp.anim * 8;
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.85)'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.ellipse(lp.x, lpy + 2, 30, 9, 0, 0, Math.PI * 2); ctx.stroke();
        drawModel('lotusPad', lp.x, lpy);
      }
    }

    for (let i = 0; i < rails.length; i++) {
      const rl = rails[i];
      if (rl.x > endWX) continue;
      const x1 = rl.x, x2 = rl.x + rl.len;
      ctx.strokeStyle = rl.energizedTimer > 0 ? '#fde047' : (rl.kind === 'maglev' ? '#38bdf8' : '#f8fafc');
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let wx = x1; wx <= x2; wx += 24) {
        const ry = getBaseSurfaceY(wx) - rl.hOff;
        if (wx === x1) ctx.moveTo(wx, ry); else ctx.lineTo(wx, ry);
      }
      ctx.stroke();
    }

    for (let i = 0; i < backboards.length; i++) {
      const bb = backboards[i];
      if (bb.x > endWX + 50) continue;
      ctx.save(); ctx.translate(bb.x, bb.y);
      ctx.fillStyle = bb.triggered ? '#dcfce7' : '#f8fafc'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(8, -42, 16, 56, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = bb.triggered ? '#22c55e' : '#f97316'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.ellipse(-8, 5, 19, 5.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < barrels.length; i++) {
      if (!barrels[i].exploded && barrels[i].x <= endWX) drawModel('tntBarrel', barrels[i].x, barrels[i].y);
    }

    for (let i = 0; i < cashTrucks.length; i++) {
      const ct = cashTrucks[i];
      if (ct.dead || ct.x > endWX + 80) continue;
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(ct.x, ct.y - 4, 48, 12, 0, 0, Math.PI * 2); ctx.stroke();
      drawModel('cashTruck', ct.x, ct.y - 34, getTerrainSlope(ct.x));
      if (ct.flash > 0) {
        ctx.fillStyle = 'rgba(254, 240, 138, 0.45)';
        ctx.beginPath(); ctx.arc(ct.x, ct.y - 30, 46, 0, Math.PI * 2); ctx.fill();
      }
    }

    for (let i = 0; i < hangers.length; i++) {
      const hg = hangers[i];
      if (hg.x > endWX + 60) continue;
      ctx.save();
      if (!hg.fallen) {
        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(hg.x, hg.ropeTopY); ctx.lineTo(hg.x, hg.boardY - 18); ctx.stroke();
      }
      ctx.translate(hg.x, hg.boardY);
      if (hg.kind === 'chandelier') drawSpaldingWheelOn(ctx, 0, 0, 26, 0.3);
      else {
        ctx.fillStyle = '#1e293b'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(-48, -20, 96, 36, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fde047'; ctx.font = '900 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('鸡你太美', 0, 3);
      }
      ctx.restore();
    }

    for (let i = 0; i < bells.length; i++) {
      if (bells[i].x <= endWX) drawModel('bronzeBell', bells[i].x, bells[i].y, bells[i].rungTimer > 0 ? Math.sin(performance.now() * 0.04) * 0.32 : 0);
    }

    for (let i = 0; i < laserGates.length; i++) {
      const lg = laserGates[i];
      if (lg.x > endWX + 80) continue;
      const gy = getBaseSurfaceY(lg.x);
      ctx.save(); ctx.translate(lg.x, gy);
      ctx.strokeStyle = lg.hacked ? 'rgba(74, 222, 128, 0.35)' : 'rgba(244, 63, 94, 0.78)';
      ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, -72); ctx.stroke();
      ctx.fillStyle = '#334155'; ctx.fillRect(-12, -84, 24, 14);
      ctx.restore();
    }

    for (let i = 0; i < snowballs.length; i++) {
      const sb = snowballs[i];
      if (!sb.smashed && sb.x <= endWX + 90) {
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(sb.x, sb.y, 33, 0, Math.PI * 2); ctx.stroke();
        drawModel('snowballGiant', sb.x, sb.y, sb.rot);
      }
    }

    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.x > endWX) continue;
      if (en.swallowing) {
        const sc = Math.max(0.24, 1 - (en.swallowProg || 0) * 0.78);
        drawModel(getEnemySpriteKey(en.kind), en.swallowX, en.swallowY, (en.swallowProg || 0) * 8, sc);
      } else {
        const ey = getEnemyWorldY(en);
        const hop = en.flyH ? 0 : Math.abs(Math.sin(performance.now() * 0.008 + (en.phase || 0))) * 6;
        ctx.save();
        if (!en.flyH) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(en.x, ey - 3, 28, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (en.kind === 'spiky_cat') {
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.arc(en.x, ey - 28 - hop, 31, Math.PI, 0); ctx.stroke();
        }
        ctx.restore();
        drawModel(getEnemySpriteKey(en.kind), en.x, ey - 28 - hop);
      }
    }

    // Boss is pinned directly against the right edge of the screen (no artificial wall prop)!

    // 7 Differentiated Boss Arena + Model Renderer!
    if (activeBoss) {
      renderBossArenaAndModel(ctx, activeBoss, {
        player, startWX, endWX, cam, W, H,
        getGroundY: getBaseSurfaceY,
        drawParryRing
      });
    }

    for (let i = 0; i < enemyShots.length; i++) {
      const sh = enemyShots[i];
      if (sh.kind === 'spike_roller') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.30)'; ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(sh.x, sh.y - 22, 27, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        drawModel('riotSaw', sh.x, sh.y - 22, sh.rot, 0.92);
      } else if (sh.kind === 'hover_saw') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.30)'; ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(sh.x, sh.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        drawModel('riotSaw', sh.x, sh.y, sh.rot, 0.88);
      }
      else {
        drawModel('lawyerScroll', sh.x, sh.y, sh.rot);
        if (!sh.parried) drawParryRing(sh.x, sh.y, Math.hypot(sh.x - (player.x + 28), sh.y - (player.y - 46)));
      }
    }
  }

  // Track Props + Parachute Sky Airdrops (Zero per-frame Gradient allocation!)
  for (let i = 0; i < worldProps.length; i++) {
    const wp = worldProps[i];
    if (wp.taken || wp.x > endWX + 50) continue;
    const haloCol = wp.def.halo || '#fde047';
    ctx.save();
    ctx.translate(wp.x, wp.y);
    if (wp.parachute) {
      const sway = Math.sin(wp.phase) * 0.14;
      ctx.rotate(sway);
      // Parachute cords & red-white striped canopy!
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-28, -36); ctx.lineTo(-10, -8); ctx.moveTo(28, -36); ctx.lineTo(10, -8); ctx.moveTo(0, -40); ctx.lineTo(0, -10); ctx.stroke();
      ctx.fillStyle = '#ef4444'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, -36, 30, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(0, -50, 11, 15, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = haloCol;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    drawModel(wp.def.sprite, wp.x, wp.y, Math.sin(wp.phase) * 0.1, 1.1);

    if (wp.def.badge) {
      ctx.save();
      ctx.font = '900 11px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.strokeStyle = haloCol;
      ctx.lineWidth = 2;
      const byOff = wp.parachute ? 26 : -48;
      ctx.beginPath(); ctx.roundRect(wp.x - 34, wp.y + byOff, 68, 16, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(wp.def.badge, wp.x, wp.y + byOff + 12);
      ctx.restore();
    }
  }

  const nowT = performance.now() * 0.005;
  for (let i = 0; i < beans.length; i++) {
    const b = beans[i];
    if (b.taken || b.x > endWX) continue;
    const bob = b.dynamic ? 0 : Math.sin(nowT + b.x * 0.02) * 4;
    drawModel(b.giant ? 'goldJar' : 'beanJar', b.x, b.y + bob);
  }

  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i];
    if (pr.kind === 'giant_bball') {
      drawSpaldingWheelOn(ctx, pr.x, pr.y, pr.r, pr.rot);
    } else if (pr.kind === 'ikun_pinball') {
      drawSpaldingWheelOn(ctx, pr.x, pr.y, pr.r, pr.rot);
    } else if (pr.kind === 'riot_saw') drawModel('riotSaw', pr.x, pr.y, pr.rot);
    else if (pr.kind === 'shark_bomb') drawModel('sharkBomb', pr.x, pr.y, Math.atan2(pr.vy, 420) * 0.45);
    else if (pr.kind === 'bowling_mob') drawModel(getEnemySpriteKey(pr.mobKind), pr.x, pr.y, pr.rot);
    else if (pr.kind === 'fish_shot') drawModel('fishTorpedo', pr.x, pr.y, Math.atan2(pr.vy, 500) * 0.5);
    else drawSpaldingWheelOn(ctx, pr.x, pr.y, pr.r, pr.rot);
  }

  if (activeRunHeroId === 'nailong' && (player.flameHolding || player.flameBurstTimer > 0) && player.flameFuel > 0) {
    const sx = player.x + 34, sy = player.y - 92;
    const beamLen = 475;
    ctx.save();
    ctx.fillStyle = 'rgba(249, 115, 22, 0.75)';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 10); ctx.lineTo(sx + beamLen, sy - 42); ctx.lineTo(sx + beamLen, sy + 42); ctx.lineTo(sx, sy + 12);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fde047'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + beamLen * 0.85, sy); ctx.stroke();
    ctx.restore();
  }

  if (player.swallowVortexTimer > 0) {
    const mx = player.x + 42, my = player.y - 82;
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.34)';
    ctx.beginPath(); ctx.moveTo(mx, my - 18); ctx.lineTo(mx + 410, my - 120); ctx.lineTo(mx + 410, my + 90); ctx.lineTo(mx, my + 22); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  if (player.thunderTongueTimer > 0) {
    const cx = player.x + 6, cy = player.y - 72;
    const a = player.thunderTongueAngle;
    const len = 375;
    const tx = cx + Math.cos(a) * len, ty = cy + Math.sin(a) * len;
    ctx.save();
    ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 18; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = '#fde047'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.restore();
  }

  // Fast Solid-Circle Flame Puffs (ZERO createRadialGradient GC churn!)
  for (let i = 0; i < flamePuffs.length; i++) {
    const fp = flamePuffs[i];
    const u = Math.max(0, fp.life / fp.maxLife);
    ctx.globalAlpha = u * 0.85;
    ctx.fillStyle = u > 0.55 ? '#fde047' : '#ef4444';
    ctx.beginPath(); ctx.arc(fp.x, fp.y, fp.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < shockwaves.length; i++) {
    const sw = shockwaves[i];
    ctx.strokeStyle = sw.color || '#f97316'; ctx.lineWidth = 5;
    ctx.globalAlpha = Math.max(0, sw.life / 0.38);
    ctx.beginPath(); ctx.arc(sw.x, sw.y - 14, sw.r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Hyper Dash Rainbow Afterimage Ghosts!
  for (let i = 0; i < hyperGhosts.length; i++) {
    const g = hyperGhosts[i];
    ctx.save();
    ctx.globalAlpha = (g.life / g.maxLife) * 0.45;
    ctx.fillStyle = g.col;
    ctx.beginPath(); ctx.ellipse(g.x - 10, g.y - 52, 54, 42, g.angle, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.save();
  if (player.invulnTimer > 0 && state === 'PLAYING' && !player.hyperDashActive && player.giantTimer <= 0 && headStartTargetDist <= 0 && Math.floor(player.invulnTimer * 14) % 2 === 0) {
    ctx.globalAlpha = 0.55;
  }
  drawSculptedBikeAndHero(
    ctx,
    activeRunHeroId,
    player.x,
    player.y,
    player.angle,
    player.wheelAngle,
    player.crankAngle,
    player.jiggle,
    store.save.mods,
    {
      scale: player.giantTimer > 0 ? 1.92 : (player.hyperDashActive ? 1.14 : 1.0),
      mountId: player.mountId,
      weaponId: player.weaponId,
      striking: player.strikeTimer > 0,
      hasSaw: player.orbitSawTimer > 0 && player.sawShieldCharges > 0,
      magnetActive: player.magnetTimer > 0,
      mortarActive: player.mortarTimer > 0,
      hideWheels: state === 'DYING',
      rocketDash: headStartTargetDist > 0 || player.rocketDashTimer > 0 || player.hyperDashActive
    }
  );
  ctx.restore();

  // Spectacular Blazing Comet Shroud & Mach Rings ONLY while Hyper Dash is Active!
  if (player.hyperDashActive) {
    const now = performance.now();
    ctx.save();
    ctx.translate(player.x + 12, player.y - 52);
    // Twin Rear Plasma Thruster Plume
    ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.beginPath();
    ctx.moveTo(-42, 6);
    ctx.lineTo(-185 - Math.sin(now * 0.06) * 35, -22);
    ctx.lineTo(-140, 8);
    ctx.lineTo(-195 - Math.cos(now * 0.06) * 35, 34);
    ctx.closePath();
    ctx.fill();
    // Blazing Golden Comet Nose Cone!
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-20, -68);
    ctx.quadraticCurveTo(96, 0, -20, 62);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-8, -54);
    ctx.quadraticCurveTo(82, 0, -8, 48);
    ctx.stroke();
    // Mach Sonic Boom Ring
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(-28, 0, 14, 58 + Math.sin(now * 0.05) * 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (player.tempShieldHp > 0 && player.tempShieldTimer > 0) {
    ctx.save();
    const blink = player.tempShieldTimer < 2.0 ? (0.35 + 0.55 * Math.abs(Math.sin(performance.now() * 0.025))) : 0.85;
    ctx.globalAlpha = blink;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.beginPath();
    ctx.arc(player.x + 2, player.y - 54, 66, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (player.orbitSawTimer > 0) {
    const baseA = performance.now() * 0.01;
    for (let k = 0; k < 2; k++) {
      const a = baseA + k * Math.PI;
      drawModel('riotSaw', player.x + Math.cos(a) * 82, (player.y - 48) + Math.sin(a) * 60, baseA * 3, 0.72);
    }
  }

  for (let i = 0; i < flyingDebris.length; i++) {
    const d = flyingDebris[i];
    if (d.kind === 'loose_wheel') drawSpaldingWheelOn(ctx, d.x, d.y, d.r, d.rot);
    else if (d.kind === 'ko_mob') drawModel(getEnemySpriteKey(d.mobKind), d.x, d.y, d.rot, 0.85);
    else drawModel(d.kind === 'woodSplinter' ? 'woodSplinter' : 'rockChunk', d.x, d.y, d.rot);
  }

  for (let i = 0; i < popups.length; i++) {
    const pop = popups[i];
    ctx.globalAlpha = Math.max(0, pop.life / pop.maxLife);
    ctx.font = `900 ${pop.size}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#0f172a';
    ctx.strokeText(pop.text, pop.x, pop.y);
    ctx.fillStyle = pop.color;
    ctx.fillText(pop.text, pop.x, pop.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  if (state === 'DYING' || state === 'GAMEOVER') {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.38)';
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}

function flushBeforeUnload() {
  bankRunProgress(false);
  store.flushBeacon();
}
window.addEventListener('beforeunload', flushBeforeUnload);
window.addEventListener('pagehide', flushBeforeUnload);

// Boot
store.pullSessionOnBoot();
try {
  if (!localStorage.getItem('pelican_fix_teleport_v45')) {
    localStorage.setItem('pelican_fix_teleport_v45', '1');
    if ((store.save.selectedCheckpoint || 0) > 10000 || (store.save.maxCheckpoint || 0) > 15000) {
      store.save.selectedCheckpoint = 0;
      if ((store.save.maxCheckpoint || 0) > 15000) store.save.maxCheckpoint = 1500;
      if ((store.save.bestDist || 0) > 15000) store.save.bestDist = Math.min(store.save.bestDist, 2000);
      if ((store.save.bestSingleRun || 0) > 15000) store.save.bestSingleRun = 0;
      store.markMutatedAndSave(false);
    }
  }
} catch (_) {}
refreshHubUI();

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.04, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  render();
  renderHubPreview(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
