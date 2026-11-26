// ============================================================================
// 《鹈鹕测试大乱斗》 — Core Gameplay, Telegraphed Bosses, Single-Life Record
// Challenge, 1-Per-Run Share-to-Revive & Garage Hub Controller
// ============================================================================

import {
  HEROES,
  GARAGE_MODS,
  BEAN_TALENTS,
  RECHARGE_PACKS,
  FIRST_RECHARGE_BONUS_BEANS,
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
  getModPropDuration,
  getTalentLvFromSave,
  getSuperChargeSpeedMultFromSave,
  getAutoRegenPer5sFromSave
} from './config.js?v=9.5';

import {
  buildAllSculptedAssets,
  drawModelOn,
  drawSpaldingWheelOn,
  drawSculptedBikeAndHero,
  getEnemySpriteKey,
  getHeroPortraitDataUrl
} from './models.js?v=9.5';

import {
  drawBiomeAtmosphere,
  drawSculptedTerrainAndRoad,
  drawHubDioramaBackdrop
} from './scenery.js?v=9.5';

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
} from './audio.js?v=9.5';

import { createCloudStore } from './cloud.js?v=9.7';
import { createPartyController } from './party.js?v=9.7';
import {
  initBossCustomState,
  clearBossTransientHazards,
  hasBossImmediateJumpCue,
  hasBossImmediateParryCue,
  handlePlayerBossInteraction,
  updateBossEngine,
  renderBossArenaAndModel
} from './bosses.js?v=9.5';

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

// Continuous-Attrition & High-Density Survival Curve + Decoupled Bounded Gentle Speed Curve:
//  - Forward speed: 92 * (1 - exp(-d/2800)) -> gentle concave curve, STRICT UPPER BOUND (+92 px/s max), decoupled from difficulty!
//  - Difficulty pressure: escalates via enemy/saw density + continuous attrition, NEVER discrete one-shot spikes!
const MIN_NORMAL_DIST_FOR_BONUS = 520;
function getSurvivalGradient(singleDist) {
  const d = Math.max(0, singleDist);
  const km = d / 1000;
  const fullKm = Math.floor(km);
  const densityScore = 1 + (Math.SQRT2 + 1) * (Math.sqrt(1 + km) - 1);
  const dispMult = Math.round(densityScore * 100) / 100;
  const multStr = dispMult.toFixed(2).replace(/0$/, '');

  // Gentle per-hit scaling so discrete hits NEVER one-shot; survival pressure comes from density + continuous drain
  const dmgMult = +(1 + 0.36 * Math.log1p(km)).toFixed(2);
  // Decoupled, smooth, raised asymptotic forward speed (+0 at 0m, +65 at 1km, +138 at 2.5km, upper bound = +295 px/s ~ 1.84x!)
  const boundedSpeedAdd = Math.round(295 * (1 - Math.exp(-d / 4000)));
  // ZERO invisible environmental air-drain — players ONLY lose HP from visible collisions!
  const envDrain = 0;

  const tier = Math.min(6, fullKm + 1);
  let icon = '🟢', border = '#22c55e', color = '#4ade80';
  if (dispMult >= 5.0) { icon = '💀'; border = '#e11d48'; color = '#fda4af'; }
  else if (dispMult >= 3.8) { icon = '🟣'; border = '#a855f7'; color = '#e9d5ff'; }
  else if (dispMult >= 2.8) { icon = '🔴'; border = '#ef4444'; color = '#f87171'; }
  else if (dispMult >= 2.0) { icon = '🟡'; border = '#eab308'; color = '#fde047'; }

  return {
    tier,
    kmMilestone: fullKm + 1,
    label: `${icon} ${multStr}x`,
    border,
    color,
    dispMult,
    dmgMult,
    envDrain,
    speedAdd: boundedSpeedAdd,
    chunkGap: Math.round(Math.max(305, 445 - 64 * Math.log1p(km))),
    ambushProb: Math.min(0.76, 0.22 + 0.22 * Math.log1p(km)),
    doubleProb: km >= 0.6 ? Math.min(0.46, (km - 0.6) * 0.16) : 0,
    extraMobs: Math.min(3, Math.floor(km * 0.85)),
    bossGap: Math.round(Math.max(155, 225 - 24 * Math.log1p(km)))
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
const actionCdShade = document.getElementById('actionCdShade');
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
const preDeathBoost400 = document.getElementById('preDeathBoost400');
const preDeathBoost800 = document.getElementById('preDeathBoost800');
const talentHubBar = document.getElementById('talentHubBar');
const talentHubSummary = document.getElementById('talentHubSummary');
const talentOpenBtn = document.getElementById('talentOpenBtn');
const talentOverlay = document.getElementById('talentOverlay');
const talentWalletTxt = document.getElementById('talentWalletTxt');
const talentCloseBtn = document.getElementById('talentCloseBtn');
const talentListBox = document.getElementById('talentListBox');
const propShopHubBar = document.getElementById('propShopHubBar');
const propShopHubSummary = document.getElementById('propShopHubSummary');
const propShopOpenBtn = document.getElementById('propShopOpenBtn');
const propShopOverlay = document.getElementById('propShopOverlay');
const propShopWalletTxt = document.getElementById('propShopWalletTxt');
const propShopRechargeBtn = document.getElementById('propShopRechargeBtn');
const propShopCloseBtn = document.getElementById('propShopCloseBtn');
const propShopDoneBtn = document.getElementById('propShopDoneBtn');
const pvpHubQuickMatchBtn = document.getElementById('pvpHubQuickMatchBtn');
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
const goCloseTopBtn = document.getElementById('goCloseTopBtn');
const goRetryBtn = document.getElementById('goRetryBtn');
const goHubBtn = document.getElementById('goHubBtn');

const guestBindStrongBanner = document.getElementById('guestBindStrongBanner');
const guestBindGuideBtn = document.getElementById('guestBindGuideBtn');
const tutorialMenuOverlay = document.getElementById('tutorialMenuOverlay');
const tutMenuCloseBtn = document.getElementById('tutMenuCloseBtn');
const tutMenuPveBtn = document.getElementById('tutMenuPveBtn');
const tutMenuPvpBtn = document.getElementById('tutMenuPvpBtn');
const tutMenuAcctBtn = document.getElementById('tutMenuAcctBtn');
const tutMenuPveBadge = document.getElementById('tutMenuPveBadge');
const tutMenuPvpBadge = document.getElementById('tutMenuPvpBadge');
const tutMenuAcctBadge = document.getElementById('tutMenuAcctBadge');

const acctStrongNudgeOverlay = document.getElementById('acctStrongNudgeOverlay');
const acctNudgeDesc = document.getElementById('acctNudgeDesc');
const acctNudgeStartBtn = document.getElementById('acctNudgeStartBtn');
const acctNudgeLaterBtn = document.getElementById('acctNudgeLaterBtn');
const acctTutCoachBar = document.getElementById('acctTutCoachBar');
const acctTutStepPill = document.getElementById('acctTutStepPill');
const acctTutCloseBtn = document.getElementById('acctTutCloseBtn');
const acctTutTitle = document.getElementById('acctTutTitle');
const acctTutBody = document.getElementById('acctTutBody');
const acctTutSubBtn = document.getElementById('acctTutSubBtn');
const acctTutPrimaryBtn = document.getElementById('acctTutPrimaryBtn');

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
let preSelectedDeathBoost = 0;
let deathDashActive = false;
let bankedRunBeans = 0;

let reopenRechargeAfterAuth = false;
let lastObservedAuthUser = null;
let activeRunOwner = 'guest';
let activeRunStartMs = 0;
let activeRunLogged = false;

function getActiveAccountOwnerTag() {
  return (store && store.auth && store.auth.token && store.auth.username)
    ? `u:${store.auth.username.toLowerCase()}`
    : 'guest';
}

function resetTransientRunStats() {
  runStartDist = 0;
  prevBestSingleRun = (store && store.save && store.save.bestSingleRun) || 0;
  bankedRunBeans = 0;
  runStats = {
    dist: 0,
    singleRunDist: 0,
    beans: 0,
    bossKills: 0,
    reviveUsed: false,
    healBuysUsed: 0,
    deathDashMeters: 0,
    deathDashUsed: false
  };
}

function logFinishedRun(opts = {}) {
  if (runStats && runStats.isDevTestRun) return;
  try {
    const durSec = activeRunStartMs > 0 ? Math.max(1, Math.round((Date.now() - activeRunStartMs) / 1000)) : 10;
    const tok = (store.auth && store.auth.token) || '';
    fetch('/api/run_log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tok ? { Authorization: `Bearer ${tok}` } : {})
      },
      body: JSON.stringify({
        mode: opts.mode || 'pve',
        hero: activeRunHeroId || store.save.selectedHero || 'nailong',
        singleDist: Math.floor(Number(opts.singleDist ?? runStats.singleRunDist) || 0),
        beansEarned: Math.floor(Number(opts.beansEarned ?? runStats.beans) || 0),
        bossKills: Math.floor(Number(opts.bossKills ?? runStats.bossKills) || 0),
        durationSec: durSec,
        extraNote: String(opts.extraNote || ''),
        guestId: typeof getOrCreateGuestId === 'function' ? getOrCreateGuestId() : '',
        token: tok
      }),
      keepalive: true
    }).catch(() => {});
  } catch (_) {}
}

const store = createCloudStore(() => {
  const curAuthUser = (store.auth && store.auth.username) || '';
  if (lastObservedAuthUser !== null && lastObservedAuthUser !== curAuthUser) {
    preSelectedBoost = 0;
    preSelectedDeathBoost = 0;
    activeRunHeroId = store.save.selectedHero;
    if (state === 'HUB') resetTransientRunStats();
  }
  lastObservedAuthUser = curAuthUser;
  refreshAccountButtonsUI();
  if (state === 'HUB') refreshHubUI();
  if (talentOverlay && !talentOverlay.classList.contains('hidden')) refreshTalentModalUI();
  if (propShopWalletTxt) propShopWalletTxt.textContent = store.save.beans;
  if (typeof refreshRechargeWalletHeader === 'function') refreshRechargeWalletHeader();
});
lastObservedAuthUser = (store.auth && store.auth.username) || '';
store.pullSessionOnBoot();
setTimeout(() => { if (state === 'HUB') refreshHubUI(); }, 900);

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
  if (guestBindStrongBanner) guestBindStrongBanner.classList.add('hidden-block');
  if (auth.token && auth.username) {
    hubAccountBtn.textContent = `☁️ ${auth.username}`;
    hubAccountBtn.classList.add('logged');
    hubAccountBtn.classList.remove('unbound-warn');
    authCurrentUserLbl.textContent = `👤 账号：${auth.username}`;
    const totalHeroLv = Object.values(s.heroLv || {}).reduce((a, b) => a + Number(b || 1), 0);
    const totalModLv = Object.values(s.mods || {}).reduce((a, b) => a + Number(b || 0), 0);
    authCloudSummary.textContent = `🌿${s.beans} · 最高${s.bestSingleRun}m · 角色Lv${totalHeroLv} · 改装Lv${totalModLv}`;
  } else {
    hubAccountBtn.textContent = '☁️ 存档';
    hubAccountBtn.classList.remove('logged', 'unbound-warn');
  }
}

function showAuthMainView() {
  authModalTitle.textContent = '👤 账号与云存档';
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

hubAccountBtn.addEventListener('click', () => {
  openAuthModal();
  if (acctTutState.active && acctTutState.step === 1) {
    renderAccountTutorialStep(2);
  }
});
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
  const gid = typeof getOrCreateGuestId === 'function' ? getOrCreateGuestId() : '';
  const res = await store.submitAuth(mode, authUserInp.value, authPassInp.value, authHpTrap.value || '', gid);
  authBusy = false;
  if (!res.ok) {
    authMsg.textContent = `❌ ${res.error}`;
    return;
  }
  authPassInp.value = '';
  resetTransientRunStats();
  playSfx('crate');
  refreshAccountButtonsUI();
  if (state === 'HUB') refreshHubUI();
  showToast(mode === 'register' ? `☁️ 注册成功！已无损绑定 ${res.username}` : `☁️ 欢迎回来，${res.username}！`);
  if (reopenRechargeAfterAuth) {
    reopenRechargeAfterAuth = false;
    closeAuthModal();
    openRechargeModal();
    return;
  }
  openAuthModal();
  authLoggedMsg.textContent = mode === 'register'
    ? '✅ 注册成功，全部绿豆、最高纪录与角色等级已100%无损上云！'
    : '✅ 云端存档（含绿豆、最高纪录与全部等级）已精准载入！';
  if (acctTutState.active && acctTutState.step === 2) {
    renderAccountTutorialStep(3);
  }
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
  resetTransientRunStats();
  refreshAccountButtonsUI();
  if (state === 'HUB') refreshHubUI();
  showToast('👤 已切回默认游客模式（成绩已与原账号隔离）');
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
    hubSingleGoalTag.textContent = `🎯 目标${nextGoal}m`;
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
    const portraitUrl = getHeroPortraitDataUrl(h.id);
    div.innerHTML = `
      <img class="hero-avatar" src="${portraitUrl}" alt="${h.name}" />
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
    const hpPctMult = 1 + getTalentLvFromSave(s, 'maxHpPct') * 0.05;
    const nextMaxHp = Math.round(((curH.baseHp || 100) + curLv * (curH.hpStep || 22)) * hpPctMult);
    heroHpUpBtn.textContent = `⬆️ 升至${nextMaxHp}HP (${hpCost}🌿)`;
    heroHpUpBtn.classList.remove('maxed');
    heroHpUpBtn.style.opacity = s.beans >= hpCost ? '1' : '0.5';
  }

  // 2b. Permanent Green-Bean Talent Summary Bar
  if (talentHubSummary) {
    const scLv = getTalentLvFromSave(s, 'superCharge');
    const hpLv = getTalentLvFromSave(s, 'maxHpPct');
    const rgLv = getTalentLvFromSave(s, 'autoRegen');
    talentHubSummary.textContent = `🌈充能+${scLv * 5}% · ❤️血限+${hpLv * 5}% · 💚回血${rgLv}点/5s`;
  }

  // 3. Checkpoint Selector (Pure player save progression — local dev launcher lives in isolated _local_dev_panel.js)
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
  if (preDeathBoost400) preDeathBoost400.classList.toggle('active', preSelectedDeathBoost === 400);
  if (preDeathBoost800) preDeathBoost800.classList.toggle('active', preSelectedDeathBoost === 800);

  // 5. Chargeable Hold-to-Ram Hyper Dash Shop Card (10000🌿 per 10s charge, max 3 charges = 30.0s, 1 free starter!)
  const curDashE = Math.min(30, Math.max(0, Number(s.dashEnergy) || 0));
  const stockCnt = (curDashE / 10).toFixed(1);
  if (propShopWalletTxt) propShopWalletTxt.textContent = s.beans;
  if (hyperStockTxt) hyperStockTxt.textContent = `当前储备：${stockCnt} / 3 个（共 ${curDashE.toFixed(1)}s · 开局赠1个）`;
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

  if (propShopHubSummary) {
    const totalModLv = GARAGE_MODS.reduce((acc, m) => acc + ((s.mods && s.mods[m.key]) || 0), 0);
    const activeBoostTags = [];
    if (preSelectedBoost > 0) activeBoostTags.push(`🚀开冲${preSelectedBoost}m`);
    if (preSelectedDeathBoost > 0) activeBoostTags.push(`🔥死冲${preSelectedDeathBoost}m`);
    const boostPart = activeBoostTags.length ? ` · ${activeBoostTags.join('+')}` : ' · 开局冲刺';
    propShopHubSummary.textContent = `☄️霸王冲刺 ${stockCnt}/3 · 🛠️道具强化 ${totalModLv}/12${boostPart}`;
  }

  launchBtn.textContent = s.selectedCheckpoint > 0
    ? `🐔 单人闯关 · 从 ${s.selectedCheckpoint}m 出发！`
    : '🐔 单人无尽闯关';
}

function refreshTalentModalUI() {
  if (!talentListBox) return;
  const s = store.save;
  if (talentWalletTxt) talentWalletTxt.textContent = s.beans;
  talentListBox.innerHTML = '';

  for (const t of BEAN_TALENTS) {
    const lv = getTalentLvFromSave(s, t.key);
    const isMax = lv >= t.maxLv;
    const cost = t.costPerLv;
    const card = document.createElement('div');
    card.className = 'talent-card';

    let pipsHtml = '';
    for (let i = 0; i < t.maxLv; i++) {
      pipsHtml += `<span class="talent-pip ${i < lv ? 'on' : ''}"></span>`;
    }

    const effectTxt = isMax
      ? `✨ 已满级：${t.formatDesc(lv)}`
      : `当前 ${t.formatCur(lv)} → 下一级 ${t.formatNext(lv)}`;

    card.innerHTML = `
      <div class="tc-head">
        <span class="tc-name">${t.ico} ${t.name}</span>
        <span class="tc-lv-badge">Lv ${lv} / ${t.maxLv}</span>
      </div>
      <div class="talent-pips">${pipsHtml}</div>
      <div class="tc-foot">
        <span class="tc-desc">${effectTxt}</span>
        <button class="talent-up-btn ${isMax ? 'maxed' : ''}" style="${!isMax && s.beans < cost ? 'opacity:0.5;' : ''}">
          ${isMax ? '✨ 满级' : `⬆️ 升级 (${cost}🌿)`}
        </button>
      </div>
    `;

    const btn = card.querySelector('.talent-up-btn');
    btn.addEventListener('click', () => {
      ensureAudio();
      if (isMax) return;
      if (s.beans < cost) {
        showToast(`🌿 绿豆不足 (需 ${cost}🌿)！`);
        return;
      }
      s.beans -= cost;
      if (!s.talents) s.talents = {};
      s.talents[t.key] = lv + 1;
      store.markMutatedAndSave(true);
      playSfx('crate');
      showToast(`${t.ico} ${t.name}升至 Lv${lv + 1} (${t.formatCur(lv + 1)})！`);
      refreshTalentModalUI();
      refreshHubUI();
    });
    talentListBox.appendChild(card);
  }
}

function openTalentModal() {
  ensureAudio();
  playSfx('bean');
  refreshTalentModalUI();
  if (talentOverlay) talentOverlay.classList.remove('hidden');
}

function closeTalentModal() {
  if (talentOverlay) talentOverlay.classList.add('hidden');
}

if (talentHubBar) talentHubBar.addEventListener('click', openTalentModal);
if (talentOpenBtn) {
  talentOpenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTalentModal();
  });
}
if (talentCloseBtn) talentCloseBtn.addEventListener('click', closeTalentModal);
if (talentOverlay) {
  talentOverlay.addEventListener('click', (e) => {
    if (e.target === talentOverlay) closeTalentModal();
  });
}

function openPropShopModal() {
  ensureAudio();
  playSfx('bean');
  refreshHubUI();
  if (propShopOverlay) propShopOverlay.classList.remove('hidden');
}

function closePropShopModal() {
  if (propShopOverlay) propShopOverlay.classList.add('hidden');
}

if (propShopHubBar) propShopHubBar.addEventListener('click', openPropShopModal);
if (propShopOpenBtn) {
  propShopOpenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPropShopModal();
  });
}
if (propShopCloseBtn) propShopCloseBtn.addEventListener('click', closePropShopModal);
if (propShopDoneBtn) propShopDoneBtn.addEventListener('click', closePropShopModal);
if (propShopOverlay) {
  propShopOverlay.addEventListener('click', (e) => {
    if (e.target === propShopOverlay) closePropShopModal();
  });
}
if (propShopRechargeBtn) {
  propShopRechargeBtn.addEventListener('click', () => {
    closePropShopModal();
    if (typeof openRechargeModal === 'function') openRechargeModal();
  });
}
if (pvpHubQuickMatchBtn) {
  pvpHubQuickMatchBtn.addEventListener('click', () => {
    if (partyCtrl && partyCtrl.openAndQuickMatch) {
      partyCtrl.openAndQuickMatch();
    }
  });
}

// ==================== GREEN-BEAN RECHARGE MALL & SERVER-VERIFIED CASHIER ====================
const rechargeOverlay = document.getElementById('rechargeOverlay');
const rechargeWalletTxt = document.getElementById('rechargeWalletTxt');
const rechargeHistoryToggleBtn = document.getElementById('rechargeHistoryToggleBtn');
const rechargeCloseBtn = document.getElementById('rechargeCloseBtn');
const rechargeAcctBar = document.getElementById('rechargeAcctBar');
const rechargeAcctTxt = document.getElementById('rechargeAcctTxt');
const rechargeGoLoginBtn = document.getElementById('rechargeGoLoginBtn');
const rechargeFirstBanner = document.getElementById('rechargeFirstBanner');
const rechargeShopView = document.getElementById('rechargeShopView');
const rechargeGrid = document.getElementById('rechargeGrid');
const payChanWechatBtn = document.getElementById('payChanWechatBtn');
const payChanAlipayBtn = document.getElementById('payChanAlipayBtn');
const rechargeSubmitBtn = document.getElementById('rechargeSubmitBtn');
const rechargeCheckoutView = document.getElementById('rechargeCheckoutView');
const cashierChanTag = document.getElementById('cashierChanTag');
const cashierTimerTxt = document.getElementById('cashierTimerTxt');
const cashierPriceTxt = document.getElementById('cashierPriceTxt');
const cashierGrantTxt = document.getElementById('cashierGrantTxt');
const cashierQrCanvas = document.getElementById('cashierQrCanvas');
const cashierOrderIdTxt = document.getElementById('cashierOrderIdTxt');
const cashierStatusMsg = document.getElementById('cashierStatusMsg');
const rechargeSandboxPayBtn = document.getElementById('rechargeSandboxPayBtn');
const rechargeCheckStatusBtn = document.getElementById('rechargeCheckStatusBtn');
const rechargeCancelOrderBtn = document.getElementById('rechargeCancelOrderBtn');
const rechargeHistoryView = document.getElementById('rechargeHistoryView');
const rechargeHistorySummary = document.getElementById('rechargeHistorySummary');
const rechargeHistoryList = document.getElementById('rechargeHistoryList');
const rechargeBackToShopBtn = document.getElementById('rechargeBackToShopBtn');
const hubRechargeBtn = document.getElementById('hubRechargeBtn');
const hubWalletChip = document.getElementById('hubWalletChip');
const pauseRechargeBtn = document.getElementById('pauseRechargeBtn');
const talentRechargeBtn = document.getElementById('talentRechargeBtn');

let selectedPackId = 'pack_6';
let selectedPayChannel = 'alipay';
let rechargeFirstEligible = true;
let rechargeSandboxEnabled = false;
let activeCheckoutOrder = null;
let cashierPollTimer = null;
let cashierCountdownTimer = null;
let rechargeCreateBusy = false;
let rechargeSandboxBusy = false;

function refreshRechargeWalletHeader() {
  const curBeans = store.save.beans || 0;
  if (rechargeWalletTxt) rechargeWalletTxt.textContent = curBeans.toLocaleString();
  if (pauseBeanStat && state === 'PAUSED') {
    pauseBeanStat.textContent = `🌿 钱包 ${curBeans + (runStats ? runStats.beans : 0)}`;
  }
  if (talentWalletTxt) talentWalletTxt.textContent = curBeans;
}

function drawStylizedCashierQr(textCode, channel) {
  if (!cashierQrCanvas) return;
  const qctx = cashierQrCanvas.getContext('2d');
  const size = cashierQrCanvas.width;
  qctx.fillStyle = '#ffffff';
  qctx.fillRect(0, 0, size, size);
  const accent = channel === 'alipay' ? '#1d4ed8' : '#15803d';
  const gridN = 21;
  const pad = 10;
  const cell = (size - pad * 2) / gridN;

  // Deterministic visual matrix hash from order payCodeUrl
  let seed = 2166136261;
  for (let i = 0; i < textCode.length; i++) {
    seed ^= textCode.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }

  const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= gridN - 7) || (r >= gridN - 7 && c < 7);
  qctx.fillStyle = '#0f172a';
  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      if (isFinder(r, c)) continue;
      if (r >= 8 && r <= 12 && c >= 8 && c <= 12) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if ((seed & 3) !== 0) {
        qctx.fillRect(pad + c * cell, pad + r * cell, Math.ceil(cell - 0.5), Math.ceil(cell - 0.5));
      }
    }
  }

  const drawFinderBox = (r0, c0) => {
    const x = pad + c0 * cell;
    const y = pad + r0 * cell;
    qctx.fillStyle = accent;
    qctx.fillRect(x, y, cell * 7, cell * 7);
    qctx.fillStyle = '#ffffff';
    qctx.fillRect(x + cell, y + cell, cell * 5, cell * 5);
    qctx.fillStyle = '#0f172a';
    qctx.fillRect(x + cell * 2, y + cell * 2, cell * 3, cell * 3);
  };
  drawFinderBox(0, 0);
  drawFinderBox(0, gridN - 7);
  drawFinderBox(gridN - 7, 0);

  // Center emblem
  qctx.fillStyle = accent;
  qctx.beginPath();
  qctx.roundRect(size / 2 - 17, size / 2 - 17, 34, 34, 8);
  qctx.fill();
  qctx.fillStyle = '#ffffff';
  qctx.font = '900 15px sans-serif';
  qctx.textAlign = 'center';
  qctx.textBaseline = 'middle';
  qctx.fillText(channel === 'alipay' ? '支' : '微', size / 2, size / 2 + 1);
}

function stopCashierTimers() {
  if (cashierPollTimer) { clearInterval(cashierPollTimer); cashierPollTimer = null; }
  if (cashierCountdownTimer) { clearInterval(cashierCountdownTimer); cashierCountdownTimer = null; }
}

function switchRechargeSubView(viewName) {
  if (rechargeShopView) rechargeShopView.classList.toggle('hidden-block', viewName !== 'shop');
  if (rechargeCheckoutView) rechargeCheckoutView.classList.toggle('hidden-block', viewName !== 'checkout');
  if (rechargeHistoryView) rechargeHistoryView.classList.toggle('hidden-block', viewName !== 'history');
  if (rechargeHistoryToggleBtn) {
    rechargeHistoryToggleBtn.textContent = viewName === 'history' ? '💎 商城' : '📜 账单';
  }
}

function renderRechargeShopUI() {
  refreshRechargeWalletHeader();
  const logged = Boolean(store.auth.token && store.auth.username);
  if (rechargeAcctBar && rechargeAcctTxt && rechargeGoLoginBtn) {
    rechargeAcctBar.classList.remove('warn-guest');
    if (logged) {
      rechargeAcctTxt.textContent = `👤 当前账号：${store.auth.username}`;
      rechargeGoLoginBtn.classList.add('hidden-block');
    } else {
      rechargeAcctTxt.textContent = '👤 充值前请先登录或注册账号';
      rechargeGoLoginBtn.classList.remove('hidden-block');
    }
  }

  if (rechargeFirstBanner) {
    if (rechargeFirstEligible) {
      rechargeFirstBanner.classList.remove('claimed');
      rechargeFirstBanner.innerHTML = `🎁 账号首充特权：首次任意档位充值额外狂送 <b>+${FIRST_RECHARGE_BONUS_BEANS.toLocaleString()} 🌿</b>！`;
    } else {
      rechargeFirstBanner.classList.add('claimed');
      rechargeFirstBanner.textContent = '✅ 首充特权已激活领完 · 各档位阶梯加赠永久不限次享！';
    }
  }

  if (rechargeGrid) {
    rechargeGrid.innerHTML = '';
    for (const p of RECHARGE_PACKS) {
      const isSel = p.id === selectedPackId;
      const card = document.createElement('div');
      card.className = `rc-card ${isSel ? 'selected' : ''}`;
      const bonusTxt = p.bonusBeans > 0
        ? `送 +${p.bonusBeans.toLocaleString()}🌿 (${p.bonusPctLbl.replace('多送 ', '')})`
        : '标准 1元=1000🌿';
      const firstExtraHtml = rechargeFirstEligible
        ? `<div class="rc-first-tag">+首充再送 ${FIRST_RECHARGE_BONUS_BEANS.toLocaleString()}🌿</div>`
        : '';
      card.innerHTML = `
        <span class="rc-badge">${p.badge}</span>
        <div class="rc-beans">🌿 ${p.totalBeans.toLocaleString()}</div>
        <div class="rc-bonus ${p.bonusBeans === 0 ? 'base-only' : ''}">${bonusTxt}</div>
        ${firstExtraHtml}
        <div class="rc-price-pill">¥${p.priceYuan}</div>
      `;
      card.addEventListener('click', () => {
        ensureAudio();
        playSfx('bean');
        selectedPackId = p.id;
        renderRechargeShopUI();
      });
      rechargeGrid.appendChild(card);
    }
  }

  if (payChanWechatBtn && payChanAlipayBtn) {
    payChanWechatBtn.classList.toggle('active-wx', selectedPayChannel === 'wechat');
    payChanAlipayBtn.classList.toggle('active-ali', selectedPayChannel === 'alipay');
  }

  const selPack = RECHARGE_PACKS.find((x) => x.id === selectedPackId) || RECHARGE_PACKS[1];
  const expectedBeans = selPack.totalBeans + (rechargeFirstEligible ? FIRST_RECHARGE_BONUS_BEANS : 0);
  if (rechargeSubmitBtn) {
    rechargeSubmitBtn.textContent = logged
      ? `⚡ 立即充值 ¥${selPack.priceYuan} · 立得 ${expectedBeans.toLocaleString()} 🌿`
      : `🔑 先登录绑定账号 · 充值 ¥${selPack.priceYuan} 得 ${expectedBeans.toLocaleString()} 🌿`;
  }
}

async function fetchRechargeCatalogState() {
  try {
    const headers = store.auth.token ? { 'Authorization': `Bearer ${store.auth.token}` } : {};
    const resp = await fetch('/api/pay/catalog', { headers });
    const data = await resp.json();
    if (resp.ok && data && data.ok) {
      rechargeFirstEligible = Boolean(data.firstBonusEligible);
      rechargeSandboxEnabled = Boolean(data.sandboxEnabled);
      renderRechargeShopUI();
    }
  } catch (_) {}
}

function handleOrderPaidSettlement(data) {
  stopCashierTimers();
  activeCheckoutOrder = null;
  if (data && data.authSync) {
    store.applyAuthoritativePaySnapshot(data.authSync);
  }
  const ord = (data && data.order) || {};
  const gotBeans = Number(ord.creditedBeans || data.creditedBeans || 0);
  const gotFirst = Number(ord.bonusFirstBeans || data.bonusFirstBeans || 0);
  if (gotFirst > 0 || ord.status === 'PAID') {
    rechargeFirstEligible = false;
  }
  playSfx('crate');
  refreshRechargeWalletHeader();
  if (state === 'HUB') refreshHubUI();
  if (state === 'PAUSED') pauseGame();
  if (talentOverlay && !talentOverlay.classList.contains('hidden')) refreshTalentModalUI();
  switchRechargeSubView('shop');
  renderRechargeShopUI();
  showToast(gotFirst > 0
    ? `🎉 充值成功！到账 +${gotBeans.toLocaleString()}🌿（含首充 +${gotFirst.toLocaleString()}🌿）！`
    : `🎉 充值成功！秒到账 +${gotBeans.toLocaleString()}🌿！`);
}

function openCashierForOrder(orderObj, payCodeUrl, expectedTotalBeans) {
  activeCheckoutOrder = orderObj;
  switchRechargeSubView('checkout');
  const isAli = orderObj.payChannel === 'alipay';
  if (cashierChanTag) {
    cashierChanTag.textContent = isAli ? '💙 支付宝安全收银台' : '💚 微信支付安全收银台';
    cashierChanTag.style.color = isAli ? '#1d4ed8' : '#15803d';
  }
  if (cashierPriceTxt) cashierPriceTxt.textContent = `¥${Number(orderObj.priceYuan).toFixed(2)}`;
  const basePlusTier = Number(orderObj.baseBeans || 0) + Number(orderObj.bonusTierBeans || 0);
  const totExpected = expectedTotalBeans || (basePlusTier + (rechargeFirstEligible ? FIRST_RECHARGE_BONUS_BEANS : 0));
  if (cashierGrantTxt) {
    cashierGrantTxt.textContent = totExpected > basePlusTier
      ? `预计到账：${totExpected.toLocaleString()} 🌿（含首充特权 +${(totExpected - basePlusTier).toLocaleString()}🌿）`
      : `预计到账：${basePlusTier.toLocaleString()} 🌿`;
  }
  if (cashierOrderIdTxt) cashierOrderIdTxt.textContent = `单号：${orderObj.orderId}`;
  if (cashierStatusMsg) {
    cashierStatusMsg.classList.remove('ok');
    cashierStatusMsg.textContent = rechargeSandboxEnabled
      ? '🧪 当前为沙盒调试模式'
      : '📱 请拿手机【微信 / 支付宝】扫上方二维码真钱支付（勿改单号备注），付款后 2~3 秒自动核验发豆！';
  }
  if (rechargeSandboxPayBtn) {
    rechargeSandboxPayBtn.classList.toggle('hidden-block', !rechargeSandboxEnabled);
  }
  const realQrImg = document.getElementById('cashierRealQrImg');
  const openWebBtn = document.getElementById('rechargeOpenWebPayBtn');
  if (realQrImg && orderObj._qrDataUrl) {
    realQrImg.src = orderObj._qrDataUrl;
    realQrImg.classList.remove('hidden-block');
    if (cashierQrCanvas) cashierQrCanvas.classList.add('hidden-block');
  } else {
    if (realQrImg) realQrImg.classList.add('hidden-block');
    if (cashierQrCanvas) cashierQrCanvas.classList.remove('hidden-block');
    drawStylizedCashierQr(payCodeUrl || orderObj.orderId, orderObj.payChannel);
  }
  if (openWebBtn) {
    if (payCodeUrl && payCodeUrl.startsWith('https://')) {
      openWebBtn.href = payCodeUrl;
      openWebBtn.classList.remove('hidden-block');
    } else {
      openWebBtn.classList.add('hidden-block');
    }
  }

  stopCashierTimers();
  const tickTimer = () => {
    if (!activeCheckoutOrder) return;
    const remSec = Math.max(0, Math.floor((activeCheckoutOrder.expiresAt - Date.now()) / 1000));
    const mm = String(Math.floor(remSec / 60)).padStart(2, '0');
    const ss = String(remSec % 60).padStart(2, '0');
    if (cashierTimerTxt) cashierTimerTxt.textContent = `⏳ ${mm}:${ss}`;
    if (remSec <= 0) {
      stopCashierTimers();
      if (cashierStatusMsg) cashierStatusMsg.textContent = '⚠️ 该订单已超时关闭，请返回重新选择档位';
    }
  };
  tickTimer();
  cashierCountdownTimer = setInterval(tickTimer, 1000);
  cashierPollTimer = setInterval(() => checkActiveOrderStatus(false), 2600);
}

async function checkActiveOrderStatus(manualClick = false) {
  if (!activeCheckoutOrder || !store.auth.token) return;
  if (manualClick && cashierStatusMsg) {
    cashierStatusMsg.textContent = '⏳ 正在向官方支付网关实时核验订单流水...';
  }
  try {
    const forceQs = manualClick ? '&force=1' : '';
    const resp = await fetch(`/api/pay/status?orderId=${encodeURIComponent(activeCheckoutOrder.orderId)}${forceQs}`, {
      headers: { 'Authorization': `Bearer ${store.auth.token}` }
    });
    const data = await resp.json();
    if (resp.ok && data && data.ok && data.order) {
      if (data.order.status === 'PAID') {
        handleOrderPaidSettlement(data);
        return;
      }
      if (data.order.status !== 'PENDING') {
        stopCashierTimers();
        if (cashierStatusMsg) cashierStatusMsg.textContent = `⚠️ 订单状态：${data.order.status}`;
      } else if (manualClick && cashierStatusMsg) {
        cashierStatusMsg.textContent = '⏳ 暂未查到支付入账流水，若刚付完请稍等 2 秒再点一次';
      }
    }
  } catch (_) {
    if (manualClick && cashierStatusMsg) cashierStatusMsg.textContent = '⚠️ 网络波动，请稍后重试';
  }
}

async function createRechargeOrder() {
  ensureAudio();
  if (!store.auth.token || !store.auth.username) {
    closeRechargeModal();
    reopenRechargeAfterAuth = true;
    openAuthModal();
    authMsg.textContent = '💡 请先登录或注册账号，充值绿豆将永久绑定账号不丢失！';
    return;
  }
  if (rechargeCreateBusy) return;
  rechargeCreateBusy = true;
  if (rechargeSubmitBtn) rechargeSubmitBtn.textContent = '⏳ 正在安全创建加密订单...';
  try {
    const resp = await fetch('/api/pay/create_order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${store.auth.token}`
      },
      body: JSON.stringify({
        packId: selectedPackId,
        payChannel: selectedPayChannel
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data || !data.ok) {
      const errTxt = (data && data.error) || '创建订单失败';
      showToast(`⚠️ ${errTxt}`);
      const safeNote = document.getElementById('rechargeSafeNote');
      if (safeNote) {
        safeNote.textContent = `⚠️ ${errTxt}`;
        safeNote.style.color = '#ef4444';
      }
      renderRechargeShopUI();
      return;
    }
    rechargeFirstEligible = Boolean(data.firstBonusEligible);
    rechargeSandboxEnabled = Boolean(data.sandboxEnabled);
    if (data.order && data.qrDataUrl) {
      data.order._qrDataUrl = data.qrDataUrl;
    }
    playSfx('bean');
    openCashierForOrder(data.order, data.checkoutUrl || data.payCodeUrl, data.expectedTotalBeans);
  } catch (_) {
    showToast('⚠️ 网络连接异常，请稍后重试');
    renderRechargeShopUI();
  } finally {
    rechargeCreateBusy = false;
  }
}

async function triggerSandboxPayConfirm() {
  if (!activeCheckoutOrder || !store.auth.token || rechargeSandboxBusy) return;
  ensureAudio();
  rechargeSandboxBusy = true;
  if (cashierStatusMsg) cashierStatusMsg.textContent = '⏳ 正在执行 HMAC-SHA256 回调验签与原子入账...';
  try {
    const resp = await fetch('/api/pay/sandbox_pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${store.auth.token}`
      },
      body: JSON.stringify({ orderId: activeCheckoutOrder.orderId })
    });
    const data = await resp.json();
    if (!resp.ok || !data || !data.ok) {
      if (cashierStatusMsg) cashierStatusMsg.textContent = `❌ ${(data && data.error) || '沙盒回调失败'}`;
      return;
    }
    handleOrderPaidSettlement(data);
  } catch (_) {
    if (cashierStatusMsg) cashierStatusMsg.textContent = '❌ 网络异常，请点击刷新入账状态确认';
  } finally {
    rechargeSandboxBusy = false;
  }
}

async function cancelActiveOrderAndBack() {
  const oid = activeCheckoutOrder ? activeCheckoutOrder.orderId : '';
  stopCashierTimers();
  activeCheckoutOrder = null;
  switchRechargeSubView('shop');
  renderRechargeShopUI();
  if (oid && store.auth.token) {
    fetch('/api/pay/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${store.auth.token}`
      },
      body: JSON.stringify({ orderId: oid })
    }).catch(() => {});
  }
}

async function loadAndShowOrderHistory() {
  switchRechargeSubView('history');
  if (!store.auth.token) {
    if (rechargeHistorySummary) rechargeHistorySummary.textContent = '🔑 请先登录账号查看名下充值账单';
    if (rechargeHistoryList) rechargeHistoryList.innerHTML = '<div class="rank-empty">未登录状态暂无账单</div>';
    return;
  }
  if (rechargeHistoryList) rechargeHistoryList.innerHTML = '<div class="rank-empty">⏳ 正在读取加密账单...</div>';
  try {
    const resp = await fetch('/api/pay/orders', {
      headers: { 'Authorization': `Bearer ${store.auth.token}` }
    });
    const data = await resp.json();
    if (!resp.ok || !data || !data.ok) {
      if (rechargeHistoryList) rechargeHistoryList.innerHTML = `<div class="rank-empty">⚠️ ${(data && data.error) || '加载失败'}</div>`;
      return;
    }
    rechargeFirstEligible = Boolean(data.firstBonusEligible);
    if (rechargeHistorySummary) {
      rechargeHistorySummary.textContent = `📊 累计成功 ${data.totalPaidCount} 笔 · 实付 ¥${Number(data.totalPaidYuan).toFixed(2)} · 获豆 ${Number(data.totalCreditedBeans).toLocaleString()} 🌿`;
    }
    const orders = data.orders || [];
    if (orders.length === 0) {
      rechargeHistoryList.innerHTML = '<div class="rank-empty">暂无充值订单记录</div>';
      return;
    }
    rechargeHistoryList.innerHTML = '';
    for (const o of orders) {
      const row = document.createElement('div');
      row.className = 'order-hist-row';
      const stMap = {
        PAID: '<span style="color:#16a34a;">✅ 已到账</span>',
        PENDING: '<span style="color:#d97706;">⏳ 待支付</span>',
        CANCELLED: '<span style="color:#64748b;">已取消</span>',
        EXPIRED: '<span style="color:#94a3b8;">已超时</span>'
      };
      const dtStr = new Date(o.paidAt || o.createdAt).toLocaleTimeString('zh-CN', { hour12: false });
      const beanInfo = o.status === 'PAID'
        ? `+${Number(o.creditedBeans).toLocaleString()}🌿`
        : `¥${Number(o.priceYuan).toFixed(2)}`;
      row.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:2px;">
          <span>${o.packName} · ¥${Number(o.priceYuan).toFixed(2)}</span>
          <span style="font-size:10px;color:#64748b;font-family:monospace;">${o.orderId.slice(0, 18)} · ${dtStr}</span>
        </div>
        <div style="text-align:right;display:flex;flex-direction:column;gap:2px;">
          <span style="color:#15803d;">${beanInfo}</span>
          <span style="font-size:10.5px;">${stMap[o.status] || o.status}</span>
        </div>
      `;
      rechargeHistoryList.appendChild(row);
    }
  } catch (_) {
    if (rechargeHistoryList) rechargeHistoryList.innerHTML = '<div class="rank-empty">⚠️ 网络波动，稍后重试</div>';
  }
}

const ENABLE_RECHARGE_UI = false;

function openRechargeModal() {
  if (!ENABLE_RECHARGE_UI) return;
  ensureAudio();
  playSfx('bean');
  stopCashierTimers();
  activeCheckoutOrder = null;
  switchRechargeSubView('shop');
  renderRechargeShopUI();
  if (rechargeOverlay) rechargeOverlay.classList.remove('hidden');
  fetchRechargeCatalogState();
}

function closeRechargeModal() {
  stopCashierTimers();
  reopenRechargeAfterAuth = false;
  if (rechargeOverlay) rechargeOverlay.classList.add('hidden');
}

if (ENABLE_RECHARGE_UI) {
  if (hubRechargeBtn) hubRechargeBtn.addEventListener('click', openRechargeModal);
  if (hubWalletChip) hubWalletChip.addEventListener('click', openRechargeModal);
  if (pauseRechargeBtn) pauseRechargeBtn.addEventListener('click', openRechargeModal);
  if (talentRechargeBtn) talentRechargeBtn.addEventListener('click', openRechargeModal);
} else {
  for (const el of [hubRechargeBtn, pauseRechargeBtn, talentRechargeBtn, propShopRechargeBtn]) {
    if (el) el.classList.add('hidden-block');
  }
  if (hubWalletChip) hubWalletChip.classList.remove('wallet-clickable');
}
if (rechargeCloseBtn) rechargeCloseBtn.addEventListener('click', closeRechargeModal);
if (rechargeOverlay) {
  rechargeOverlay.addEventListener('click', (e) => {
    if (e.target === rechargeOverlay) closeRechargeModal();
  });
}
if (rechargeGoLoginBtn) {
  rechargeGoLoginBtn.addEventListener('click', () => {
    closeRechargeModal();
    reopenRechargeAfterAuth = true;
    openAuthModal();
  });
}
if (payChanWechatBtn) {
  payChanWechatBtn.addEventListener('click', () => {
    playSfx('bean');
    selectedPayChannel = 'wechat';
    renderRechargeShopUI();
  });
}
if (payChanAlipayBtn) {
  payChanAlipayBtn.addEventListener('click', () => {
    playSfx('bean');
    selectedPayChannel = 'alipay';
    renderRechargeShopUI();
  });
}
if (rechargeSubmitBtn) rechargeSubmitBtn.addEventListener('click', createRechargeOrder);
if (rechargeSandboxPayBtn) rechargeSandboxPayBtn.addEventListener('click', triggerSandboxPayConfirm);
if (rechargeCheckStatusBtn) rechargeCheckStatusBtn.addEventListener('click', () => checkActiveOrderStatus(true));
if (rechargeCancelOrderBtn) rechargeCancelOrderBtn.addEventListener('click', cancelActiveOrderAndBack);
if (rechargeHistoryToggleBtn) {
  rechargeHistoryToggleBtn.addEventListener('click', () => {
    playSfx('bean');
    const inHist = rechargeHistoryView && !rechargeHistoryView.classList.contains('hidden-block');
    if (inHist) {
      switchRechargeSubView('shop');
      renderRechargeShopUI();
    } else {
      loadAndShowOrderHistory();
    }
  });
}
if (rechargeBackToShopBtn) {
  rechargeBackToShopBtn.addEventListener('click', () => {
    playSfx('bean');
    switchRechargeSubView('shop');
    renderRechargeShopUI();
  });
}

if (hyperBuyBtn) {
  hyperBuyBtn.addEventListener('click', () => {
    ensureAudio();
    const s = store.save;
    const curE = Math.min(30, Math.max(0, Number(s.dashEnergy) || 0));
    if (curE >= 29.95) {
      showToast('✨ 超级霸王究极冲刺已达持有上限 (3/3)!');
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
    showToast(`☄️ 购入超级霸王究极冲刺! 当前储备 ${(s.dashEnergy / 10).toFixed(1)}/3`);
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
if (preDeathBoost400) {
  preDeathBoost400.addEventListener('click', () => {
    ensureAudio(); playSfx('bean');
    preSelectedDeathBoost = preSelectedDeathBoost === 400 ? 0 : 400;
    refreshHubUI();
  });
}
if (preDeathBoost800) {
  preDeathBoost800.addEventListener('click', () => {
    ensureAudio(); playSfx('bean');
    preSelectedDeathBoost = preSelectedDeathBoost === 800 ? 0 : 800;
    refreshHubUI();
  });
}

heroHpUpBtn.addEventListener('click', () => {
  ensureAudio();
  const s = store.save;
  const hid = s.selectedHero || 'nailong';
  const lv = getHeroLvFromSave(s, hid);
  if (lv >= 6) {
    showToast(`✨ 当前角色等级已满 (${getHeroMaxHpFromSave(s, hid)} HP)!`);
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
// ==================== OPT-IN MOBILE LANDSCAPE & VIEWPORT ENGINE ====================
const ORIENT_PREF_KEY = 'pelican_brawl_orient_v1';
const hubOrientBtn = document.getElementById('hubOrientBtn');
const hudOrientBtn = document.getElementById('hudOrientBtn');

let manualLandscape = false;
try {
  manualLandscape = localStorage.getItem(ORIENT_PREF_KEY) === 'landscape';
} catch (_) {}
let isCssLandscapeRotated = false;

let W = window.innerWidth;
let H = window.innerHeight;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function refreshOrientButtonsUI() {
  const rawW = window.innerWidth || 390;
  const rawH = window.innerHeight || 844;
  const autoLand = !manualLandscape && rawW > rawH && rawH <= 500;
  if (hubOrientBtn) {
    hubOrientBtn.textContent = manualLandscape ? '📱 竖屏' : (autoLand ? '🔒 横屏' : '🔄 横屏');
  }
  if (hudOrientBtn) {
    hudOrientBtn.textContent = manualLandscape ? '📱 竖屏' : (autoLand ? '🔒 锁横屏' : '🔄 横屏');
  }
}

function resize() {
  const vv = window.visualViewport;
  const rawW = Math.round((vv && vv.width) || window.innerWidth || 390);
  const rawH = Math.round((vv && vv.height) || window.innerHeight || 844);
  const isCoarseTouch = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const isMobileDev = isCoarseTouch && Math.min(rawW, rawH) <= 640;
  const root = document.documentElement;
  root.style.setProperty('--raw-w', `${rawW}px`);
  root.style.setProperty('--raw-h', `${rawH}px`);
  root.classList.toggle('is-mobile-device', isMobileDev);

  const needCssRot = manualLandscape && rawW < rawH;
  const useLandscapeUi = manualLandscape || (rawW > rawH && rawH <= 500);
  isCssLandscapeRotated = needCssRot;
  root.classList.toggle('force-landscape-rot', needCssRot);
  root.classList.toggle('landscape-mode', useLandscapeUi);
  root.classList.toggle('manual-landscape-on', manualLandscape);

  W = needCssRot ? rawH : rawW;
  H = needCssRot ? rawW : rawH;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  if (hubPreviewCanvas) hubPreviewCanvas.width = 0;
  refreshOrientButtonsUI();
}

function toggleManualLandscape() {
  ensureAudio();
  manualLandscape = !manualLandscape;
  try {
    localStorage.setItem(ORIENT_PREF_KEY, manualLandscape ? 'landscape' : 'portrait');
  } catch (_) {}

  try {
    if (screen.orientation) {
      if (manualLandscape && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      } else if (!manualLandscape && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    }
  } catch (_) {}

  playSfx('crate');
  resize();
  showToast(manualLandscape ? '🔄 已切至横屏宽视野版（随时可切回竖屏）' : '📱 已切回竖屏单手版');
}

if (hubOrientBtn) hubOrientBtn.addEventListener('click', toggleManualLandscape);
if (hudOrientBtn) hudOrientBtn.addEventListener('click', toggleManualLandscape);
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 80));
resize();

// Smooth Touch-Scroll Adapter when #appStage is CSS-rotated 90deg (`force-landscape-rot`)
let rotScrollBox = null;
let rotLastClientX = 0;
window.addEventListener('touchstart', (e) => {
  if (!isCssLandscapeRotated || !e.touches || e.touches.length !== 1) { rotScrollBox = null; return; }
  const t = e.target;
  const scroller = t && t.closest && t.closest('.rank-list-box, .talent-list-box, .modal-card, .hub-card');
  if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
    rotScrollBox = scroller;
    rotLastClientX = e.touches[0].clientX;
  } else {
    rotScrollBox = null;
  }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (!isCssLandscapeRotated || !rotScrollBox || !e.touches || e.touches.length !== 1) return;
  const curX = e.touches[0].clientX;
  const dx = curX - rotLastClientX;
  rotLastClientX = curX;
  // Under rotate(90deg), physical +X (right) corresponds to rotated UP (-scrollTop)
  rotScrollBox.scrollTop += dx;
}, { passive: true });
window.addEventListener('touchend', () => { rotScrollBox = null; }, { passive: true });

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
let pendulums = [];
let skyLightnings = [];
let skyRings = [];
let skyBumpers = [];
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
let lastDamageMeta = {
  cause: '赛道冲撞',
  tip: '善用铁山靠（电脑左键/J）可正面破盾撞怪并弹反飞行物！'
};

// ==================== PROGRESSIVE FREEZE-FRAME TUTORIAL STATE (PVE 10-STEP, PVP 10-STEP & STRONG AUTH 4-STEP, v9.0) ====================
const TUT_DONE_KEY = 'pelican_tutorial_done_v4';
const TUT_REWARD_KEY = 'pelican_tutorial_reward_v4';
const PVP_TUT_DONE_KEY = 'pelican_pvp_tut_done_v2';
const PVP_TUT_REWARD_KEY = 'pelican_pvp_tut_reward_v2';
const ACCT_TUT_DONE_KEY = 'pelican_acct_tut_done_v1';
const ACCT_TUT_REWARD_KEY = 'pelican_acct_tut_reward_v1';
const ACCT_NUDGE_SESSION_KEY = 'pelican_acct_nudge_shown_v1';
const tutorialCoachHud = document.getElementById('tutorialCoachHud');
const tutStepBadge = document.getElementById('tutStepBadge');
const tutPauseBadge = document.getElementById('tutPauseBadge');
const tutSkipRunBtn = document.getElementById('tutSkipRunBtn');
const tutCoachTitleTxt = document.getElementById('tutCoachTitleTxt');
const tutCoachMainTxt = document.getElementById('tutCoachMainTxt');
const tutCoachActionCta = document.getElementById('tutCoachActionCta');
const tutMasteryRow = document.getElementById('tutMasteryRow');
const tutReplayStepBtn = document.getElementById('tutReplayStepBtn');
const tutNextStepBtn = document.getElementById('tutNextStepBtn');
const tutWelcomeOpenMenuBtn = document.getElementById('tutWelcomeOpenMenuBtn');
const tutGradOpenMenuBtn = document.getElementById('tutGradOpenMenuBtn');
const pvpTutGradOpenMenuBtn = document.getElementById('pvpTutGradOpenMenuBtn');
const tutDots = [
  document.getElementById('tutDot1'),
  document.getElementById('tutDot2'),
  document.getElementById('tutDot3'),
  document.getElementById('tutDot4'),
  document.getElementById('tutDot5'),
  document.getElementById('tutDot6'),
  document.getElementById('tutDot7'),
  document.getElementById('tutDot8'),
  document.getElementById('tutDot9'),
  document.getElementById('tutDot10')
];
const hubTutorialBtn = document.getElementById('hubTutorialBtn');
const pvpHubTutorialBtn = document.getElementById('pvpHubTutorialBtn');
const tutorialWelcomeOverlay = document.getElementById('tutorialWelcomeOverlay');
const tutStartWelcomeBtn = document.getElementById('tutStartWelcomeBtn');
const tutSkipWelcomeBtn = document.getElementById('tutSkipWelcomeBtn');
const tutorialGradOverlay = document.getElementById('tutorialGradOverlay');
const tutGradRewardBanner = document.getElementById('tutGradRewardBanner');
const tutGradStartRunBtn = document.getElementById('tutGradStartRunBtn');
const tutGradHubBtn = document.getElementById('tutGradHubBtn');
const pvpTutorialGradOverlay = document.getElementById('pvpTutorialGradOverlay');
const pvpTutGradRewardBanner = document.getElementById('pvpTutGradRewardBanner');
const pvpTutGradMatchBtn = document.getElementById('pvpTutGradMatchBtn');
const pvpTutGradBotBtn = document.getElementById('pvpTutGradBotBtn');
const pvpTutGradHubBtn = document.getElementById('pvpTutGradHubBtn');
const partyStaminaTutBtn = document.getElementById('partyStaminaBtn');
const partySlot0TutBtn = document.getElementById('partySlot0');
const partySlot1TutBtn = document.getElementById('partySlot1');
const goDeathCauseTxt = document.getElementById('goDeathCauseTxt');
const goDeathTipTxt = document.getElementById('goDeathTipTxt');

const tutorialSession = {
  active: false,
  mode: 'pve', // 'pve' | 'pvp'
  totalSteps: 10,
  step: 1,
  subPhase: 'approach',
  pausedForPrompt: false,
  expectedInput: null,
  phaseTimer: 0,
  targetX: 0,
  pitEndX: 0,
  bossSpawned: false,
  bossParriedOnce: false,
  callout: null, // { x, y, text, col }
  timeScale: 1.0,
  graduatingTimer: 0
};
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
  strikeTimer: 0, actionCd: 0, actionMaxCd: 0.64, parryWindowTimer: 0, actionBufferTimer: 0,
  whiffStreak: 0, whiffResetTimer: 0, actionOverheat: false, strikeHitCount: 0, strikeConnected: false,
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
let partyCtrl = null;

function getBaseSurfaceY(wx) {
  if (partyCtrl && partyCtrl.isActive()) return partyCtrl.getSurfaceY(wx);
  if (tutorialSession.active || wx < 380) return 0;
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

let spectatorCamX = null;
let spectatorCamY = null;

function getCamera() {
  const isPortrait = H > W;
  const isMobileLand = !isPortrait && H < 480;
  const baseScale = isPortrait
    ? Math.max(0.58, Math.min(0.72, W / 535))
    : (isMobileLand ? Math.max(0.66, Math.min(0.84, H / 515)) : Math.max(0.76, Math.min(0.94, H / 505)));
  const worldScale = baseScale * smoothCamZoom;
  // Position ground lower on screen so Tier 1 / Tier 2 / Tier 3 staggered sky layers are clearly visible above!
  const groundScreenY = isPortrait ? H * 0.70 : (isMobileLand ? H * 0.78 : H * 0.75);

  // Early-Finisher Live Rival Spectator Camera (`pvp先到的能看对手在干嘛`)!
  const specFocus = (partyCtrl && partyCtrl.getSpectatorFocus) ? partyCtrl.getSpectatorFocus() : null;
  if (specFocus) {
    const specScreenX = W * 0.34;
    const wantCamX = specFocus.x - specScreenX / worldScale;
    const wantCamY = Math.min(specFocus.y, getBaseSurfaceY(specFocus.x) + 45) * 0.45 - groundScreenY / worldScale;
    if (spectatorCamX === null || Math.abs(wantCamX - spectatorCamX) > 2600) {
      spectatorCamX = wantCamX;
      spectatorCamY = wantCamY;
    } else {
      spectatorCamX += (wantCamX - spectatorCamX) * 0.20;
      spectatorCamY += (wantCamY - spectatorCamY) * 0.20;
    }
    return { worldScale, camX: spectatorCamX, camY: spectatorCamY };
  }
  spectatorCamX = null;
  spectatorCamY = null;

  // When 🐕 大狗嚼 chases from BEHIND, shift rider toward 0.37*W so player clearly sees rear pursuit!
  const playerScreenX = W * smoothPlayerScreenRatio;
  const camX = player.x - playerScreenX / worldScale;
  const skyClimb = Math.max(0, Math.min(1, (-smoothCamRefY - 55) / 270));
  const camVertFollow = 0.45 + skyClimb * 0.27;
  const camY = smoothCamRefY * camVertFollow - groundScreenY / worldScale;
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
    if (beans.length >= 280) beans.shift();
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

// Incrementally bank beans, total distance, single-life record & checkpoints (strictly isolated per account!)
function bankRunProgress(pushToCloud = false) {
  if (state === 'HUB' || tutorialSession.active || (runStats && runStats.isDevTestRun)) return;
  if (getActiveAccountOwnerTag() !== activeRunOwner) return;
  const s = store.save;
  let changed = false;
  const deltaBeans = Math.max(0, runStats.beans - bankedRunBeans);
  if (deltaBeans > 0) {
    s.beans += deltaBeans;
    bankedRunBeans = runStats.beans;
    changed = true;
  }
  if (!partyCtrl || !partyCtrl.isActive()) {
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
  }
  if (changed || pushToCloud) {
    store.markMutatedAndSave(pushToCloud);
  }
}

// ==================== DIVERSE RANDOMIZED SUPER BONUS, HEALING & RICH PROPS ====================
const BONUS_LETTER_WORDS = [
  ['I', 'K', 'U', 'N'],
  ['M', 'A', 'N', 'B', 'O'],
  ['6', '6', '6'],
  ['N', 'B', '!'],
  ['C', 'A', 'T'],
  ['W', 'I', 'N'],
  ['G', 'O', '!']
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
  C: ['.####', '#....', '#....', '#....', '.####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  G: ['.####', '#....', '#..##', '#...#', '.###.'],
  '6': ['.###.', '#....', '####.', '#...#', '.###.'],
  '!': ['..#..', '..#..', '..#..', '.....', '..#..']
};

let bonusPatternBag = [];
function nextBonusPatternId() {
  if (!bonusPatternBag.length) {
    bonusPatternBag = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = bonusPatternBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bonusPatternBag[i], bonusPatternBag[j]] = [bonusPatternBag[j], bonusPatternBag[i]];
    }
  }
  return bonusPatternBag.pop();
}

function spawnNextBonusFormation() {
  const sx = nextBonusShapeX;
  const pat = nextBonusPatternId();
  bonusShapeIdx++;
  const baseY = -245 + Math.round((Math.random() - 0.5) * 34);

  if (pat === 0 || pat === 5) {
    const word = BONUS_LETTER_WORDS[Math.floor(Math.random() * BONUS_LETTER_WORDS.length)];
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
      curX += 148;
    }
    nextBonusShapeX = curX + 85;
  } else if (pat === 1) {
    // Double DNA Helix
    for (let i = 0; i < 18; i++) {
      const x = sx + i * 30;
      const s = Math.sin(i * 0.55) * 62;
      beans.push({ x, y: baseY - 72 + s, val: 2, giant: i % 4 === 0, taken: false });
      beans.push({ x, y: baseY - 72 - s, val: 2, giant: i % 4 === 2, taken: false });
    }
    nextBonusShapeX = sx + 585;
  } else if (pat === 2) {
    // Heart + Diamond
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      beans.push({ x: sx + 130 + hx * 6.0, y: baseY - 82 + hy * 5.0, val: 3, giant: i % 4 === 0, taken: false });
    }
    nextBonusShapeX = sx + 320;
  } else if (pat === 3) {
    // Giant Cat Paw Print (🐾)
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      beans.push({ x: sx + 160 + Math.cos(ang) * 42, y: baseY - 56 + Math.sin(ang) * 32, val: 2, giant: a % 3 === 0, taken: false });
    }
    const toes = [[-52, -108], [-18, -126], [18, -126], [52, -108]];
    for (const [tx, ty] of toes) {
      beans.push({ x: sx + 160 + tx, y: baseY + ty, val: 3, giant: true, taken: false });
      beans.push({ x: sx + 160 + tx, y: baseY + ty + 20, val: 2, giant: false, taken: false });
    }
    nextBonusShapeX = sx + 340;
  } else if (pat === 4) {
    // Golden Crown (👑)
    const crownPts = [
      [0, 0], [0, -25], [0, -50], [0, -75],
      [30, -45], [60, -25], [90, -55], [120, -90],
      [150, -55], [180, -25], [210, -45],
      [240, -75], [240, -50], [240, -25], [240, 0],
      [48, 0], [96, 0], [144, 0], [192, 0]
    ];
    for (let i = 0; i < crownPts.length; i++) {
      const [cx, cy] = crownPts[i];
      beans.push({ x: sx + 40 + cx, y: baseY - 30 + cy, val: 2, giant: cy <= -70, taken: false });
    }
    nextBonusShapeX = sx + 360;
  } else if (pat === 6) {
    // Triple Soaring Rainbow Arcs
    for (let arcIdx = 0; arcIdx < 2; arcIdx++) {
      const ox = sx + arcIdx * 240;
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const ay = Math.sin(u * Math.PI) * 95;
        beans.push({ x: ox + i * 20, y: baseY - 24 - ay, val: 2, giant: i === 5, taken: false });
      }
    }
    nextBonusShapeX = sx + 500;
  } else if (pat === 7) {
    // Zig-Zag Lightning Bolt
    for (let i = 0; i < 16; i++) {
      const zig = (i % 8 < 4) ? (i % 4) * 24 : (4 - (i % 4)) * 24;
      beans.push({ x: sx + i * 26, y: baseY - 35 - zig, val: 2, giant: i % 4 === 0, taken: false });
      beans.push({ x: sx + i * 26, y: baseY - 65 - zig, val: 2, giant: false, taken: false });
    }
    nextBonusShapeX = sx + 470;
  } else {
    // Triple Speed Chevrons (>>>)
    for (let a = 0; a < 3; a++) {
      const ax = sx + a * 140;
      for (let k = -3; k <= 3; k++) {
        beans.push({ x: ax + (3 - Math.abs(k)) * 26, y: baseY - 78 + k * 22, val: 2, giant: k === 0, taken: false });
      }
    }
    nextBonusShapeX = sx + 490;
  }
}

// Strict <= 5% Base Playtime Cap + Talent #1 (+5%/Lv) + Pelican Hero Passive (+10%):
function addSuperCharge(rawGain) {
  if ((partyCtrl && partyCtrl.isActive()) || superBonusTimer > 0 || headStartTargetDist > 0) return;
  const heroBonusMult = activeRunHeroId === 'pelican' ? 1.10 : 1.0;
  const chargeMult = getSuperChargeSpeedMultFromSave(store.save) * heroBonusMult;
  const effMinSec = MIN_NORMAL_SEC_FOR_BONUS / chargeMult;
  const secCeiling = (normalPlaySecSinceBonus / effMinSec) * 100;
  superCharge = Math.min(100, secCeiling, superCharge + rawGain * 0.20 * chargeMult);
  if (superCharge >= 100 && normalPlaySecSinceBonus >= effMinSec) {
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
  // Any active heal immediately purges pending continuous bleed/dotPool first!
  if (player.dotPool && player.dotPool > 0) {
    player.dotPool = Math.max(0, player.dotPool - amount * 0.6);
  }
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
  nextPropDist = Math.max(nextPropDist, runStats.dist + 135 + Math.floor(Math.random() * 55));
}

function spawnAlliedMaodieSwarm(count = 6) {
  const rear = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
  const dir = rear ? -1 : 1;
  for (let i = 0; i < count; i++) {
    projectiles.push({
      kind: 'mini_maodie',
      x: player.x + dir * (26 + i * 18),
      y: player.y - 50 - (i % 3) * 14,
      vx: player.vx + dir * (330 + i * 54),
      vy: -115 - i * 62,
      bouncesLeft: 5,
      r: 24,
      rot: 0,
      life: 4.6
    });
  }
}

function grantTempShield(amount, durSec, showPop = true) {
  player.tempShieldHp = Math.min(60, Math.round(Math.max(player.tempShieldHp, amount)));
  player.tempShieldTimer = Math.max(player.tempShieldTimer, durSec);
  if (showPop) {
    addPopup(`🛡️ 背带金钟罩 +${Math.round(amount)}`, player.x + 20, player.y - 98, '#38bdf8', 18);
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
    showToast(`🛡️ 背带金钟罩 +${shAmt} · 黑子不破防!`);
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
    const curNorm = player.baseSpeed + getSurvivalGradient(runStats.singleRunDist).speedAdd;
    player.vx = Math.max(player.vx, Math.round(curNorm * 2.0));
    player.invulnTimer = Math.max(player.invulnTimer, dur + 0.35);
    showToast(`🚀 氮气罐极速 2.0x 冲刺 (${dur.toFixed(1)}s)!`);
  } else if (def.id === 'orbit_saws') {
    const dur = getModPropDuration(s, 'sawBumper');
    player.orbitSawTimer = dur;
    player.sawShieldCharges = 1;
    showToast(`⚙️ 破障电锯 (${dur.toFixed(1)}s + 1次挡伤)!`);
  } else if (def.id === 'mortar_cat') {
    const dur = getModPropDuration(s, 'mortarCat');
    player.mortarTimer = dur;
    player.mortarShotTick = 0.04;
    showToast(`🐱 重装迫击猫双联轰炸 (${dur.toFixed(1)}s)!`);
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
  } else if (def.id === 'midas_gold') {
    player.midasTimer = 6.0;
    showToast(def.toast);
  } else if (def.id === 'maodie_pack') {
    spawnAlliedMaodieSwarm(8);
    showToast(def.toast);
  } else if (def.id === 'thunder_drum') {
    player.thunderAuraTimer = 5.4;
    player.thunderAuraTick = 0.05;
    showToast(def.toast);
  } else if (def.id === 'sky_wings') {
    player.skyWingsTimer = 6.5;
    player.jumpsLeft = 5;
    player.vy = Math.min(player.vy, -420);
    player.onGround = false;
    showToast(def.toast);
  }
  refreshBuffChips();
  syncControlsUI();
  updateTopHUD();
}

function refreshBuffChips() {
  const list = [];
  if (player.hyperDashActive) list.push(`☄️ 超级霸王究极冲刺 ${(10 - player.hyperSessionSec).toFixed(1)}s`);
  if (headStartTargetDist > 0) {
    list.push(deathDashActive ? `🔥 死亡终极冲刺 → ${headStartTargetDist}m` : `🚀 开局狂飙 → ${headStartTargetDist}m`);
  } else if (runStats && runStats.deathDashMeters > 0 && !runStats.deathDashUsed) {
    list.push(`🔥 死亡冲${runStats.deathDashMeters}m待命`);
  }
  if (superBonusTimer > 0) list.push(`🌈 超级奖励 ${superBonusTimer.toFixed(0)}s`);
  if (player.tempShieldHp > 0 && player.tempShieldTimer > 0) {
    list.push(`🛡️ 背带金钟罩 ${Math.ceil(player.tempShieldHp)} (${player.tempShieldTimer.toFixed(1)}s)`);
  }
  if (player.giantTimer > 0) list.push(`🌶️ 巨人化 ${player.giantTimer.toFixed(1)}s`);
  if (player.rocketDashTimer > 0) list.push(`🚀 氮气罐 ${player.rocketDashTimer.toFixed(1)}s`);
  if (player.magnetTimer > 0) list.push(`🧲 磁铁爪 ${player.magnetTimer.toFixed(1)}s`);
  if (player.orbitSawTimer > 0) list.push(`⚙️ 破障锯 ${player.orbitSawTimer.toFixed(1)}s`);
  if (player.mortarTimer > 0) list.push(`🐱 迫击猫 ${player.mortarTimer.toFixed(1)}s`);
  if (player.weaponId === 'gatling') list.push(`🏀 加特林 ${player.weaponTimer.toFixed(1)}s`);
  if (player.weaponId === 'bazooka') list.push(`🦈 火箭筒 ${player.weaponTimer.toFixed(1)}s`);
  if (player.midasTimer > 0) list.push(`💰 点豆成金 ${player.midasTimer.toFixed(1)}s`);
  if (player.thunderAuraTimer > 0) list.push(`⚡ 雷电护体 ${player.thunderAuraTimer.toFixed(1)}s`);
  if (player.skyWingsTimer > 0) list.push(`🕊️ 滑翔飞翼 ${player.skyWingsTimer.toFixed(1)}s`);
  if (player.ringBoostTimer > 0) {
    list.push(`${player.ringBoostGold ? '🌟 金环超喷' : '⚡ 穿环加速'} ${player.ringBoostTimer.toFixed(1)}s`);
  }
  if (partyCtrl && partyCtrl.isActive()) {
    const pLabels = partyCtrl.getExtraBuffLabels();
    for (let i = 0; i < pLabels.length; i++) list.push(pLabels[i]);
  }

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
  e.stopPropagation(); ensureAudio(); activateHeadStartBoost(400, 1000);
});
document.getElementById('inRunDash800').addEventListener('click', (e) => {
  e.stopPropagation(); ensureAudio(); activateHeadStartBoost(800, 2000);
});

// ==================== START NEW RUN, PAUSE, SETTLEMENT & SHARE-TO-REVIVE ====================
function isPcControlHintMode() {
  return !document.documentElement.classList.contains('is-mobile-device');
}

function clearAccountTutorialSpotlights() {
  for (const el of [
    hubAccountBtn,
    authUserInp,
    authPassInp,
    authRegisterBtn,
    authLoginBtn,
    authSyncNowBtn,
    hubRankOpenBtn,
    hubWalletChip
  ]) {
    if (el) el.classList.remove('tut-spotlight');
  }
}

const acctTutState = {
  active: false,
  step: 0
};

function stopAccountSaveTutorial() {
  acctTutState.active = false;
  acctTutState.step = 0;
  clearAccountTutorialSpotlights();
  document.documentElement.classList.remove('acct-tut-modal-step');
  if (acctTutCoachBar) acctTutCoachBar.classList.add('hidden');
}

function renderAccountTutorialStep(stepNum) {
  acctTutState.active = true;
  acctTutState.step = stepNum;
  clearAccountTutorialSpotlights();
  if (!acctTutCoachBar) return;
  acctTutCoachBar.classList.remove('hidden');

  const isLogged = Boolean(store.auth && store.auth.token && store.auth.username);
  const s = store.save;

  if (stepNum === 1) {
    document.documentElement.classList.remove('acct-tut-modal-step');
    closeAuthModal();
    if (hubOverlay) hubOverlay.classList.remove('hidden');
    if (hubAccountBtn) hubAccountBtn.classList.add('tut-spotlight');
    if (acctTutStepPill) acctTutStepPill.textContent = '云存档 1/4';
    if (acctTutTitle) {
      acctTutTitle.textContent = isLogged
        ? `右上角【👤 ${store.auth.username}】为云存档入口`
        : '点击右上角【👤 账号】';
    }
    if (acctTutBody) {
      acctTutBody.innerHTML = '登录或注册账号即可跨设备同步进度。';
    }
    if (acctTutSubBtn) acctTutSubBtn.classList.add('hidden');
    if (acctTutPrimaryBtn) {
      acctTutPrimaryBtn.textContent = '打开面板 ▶';
      acctTutPrimaryBtn.classList.remove('hidden');
    }
    return;
  }

  if (stepNum === 2) {
    document.documentElement.classList.add('acct-tut-modal-step');
    openAuthModal();
    if (acctTutStepPill) acctTutStepPill.textContent = '云存档 2/4';
    if (!isLogged) {
      if (authUserInp) authUserInp.classList.add('tut-spotlight');
      if (authPassInp) authPassInp.classList.add('tut-spotlight');
      if (authRegisterBtn) authRegisterBtn.classList.add('tut-spotlight');
      if (acctTutTitle) acctTutTitle.textContent = '填写账号密码，点【✨ 注册并保存】';
      if (acctTutBody) {
        acctTutBody.innerHTML = `当前绿豆（🌿 ${s.beans}）与等级将直接保存到新账号。`;
      }
      if (acctTutSubBtn) {
        acctTutSubBtn.textContent = '先看下一步 ▶';
        acctTutSubBtn.classList.remove('hidden');
      }
      if (acctTutPrimaryBtn) {
        acctTutPrimaryBtn.textContent = '立即注册 ▶';
        acctTutPrimaryBtn.classList.remove('hidden');
      }
    } else {
      if (authSyncNowBtn) authSyncNowBtn.classList.add('tut-spotlight');
      if (acctTutTitle) acctTutTitle.textContent = `已登录【${store.auth.username}】`;
      if (acctTutBody) {
        acctTutBody.innerHTML = '每局结算会自动保存，也可点【☁️ 立即同步】手动备份。';
      }
      if (acctTutSubBtn) acctTutSubBtn.classList.add('hidden');
      if (acctTutPrimaryBtn) {
        acctTutPrimaryBtn.textContent = '下一步 ▶';
        acctTutPrimaryBtn.classList.remove('hidden');
      }
    }
    return;
  }

  if (stepNum === 3) {
    document.documentElement.classList.add('acct-tut-modal-step');
    openAuthModal();
    if (acctTutStepPill) acctTutStepPill.textContent = '云存档 3/4';
    if (!isLogged) {
      if (authLoginBtn) authLoginBtn.classList.add('tut-spotlight');
      if (acctTutTitle) acctTutTitle.textContent = '换设备时点【🔑 登录读取存档】';
      if (acctTutBody) {
        acctTutBody.innerHTML = '在新手机或电脑输入同一账号密码即可找回进度。';
      }
    } else {
      if (authSyncNowBtn) authSyncNowBtn.classList.add('tut-spotlight');
      if (acctTutTitle) acctTutTitle.textContent = '换设备登录即可找回进度';
      if (acctTutBody) {
        acctTutBody.innerHTML = `在其他设备登录 <b>${store.auth.username}</b> 即可同步存档。`;
      }
    }
    if (acctTutSubBtn) acctTutSubBtn.classList.add('hidden');
    if (acctTutPrimaryBtn) {
      acctTutPrimaryBtn.textContent = '领奖完成 ▶';
      acctTutPrimaryBtn.classList.remove('hidden');
    }
    return;
  }

  document.documentElement.classList.remove('acct-tut-modal-step');
  closeAuthModal();
  if (hubRankOpenBtn) hubRankOpenBtn.classList.add('tut-spotlight');
  if (hubWalletChip) hubWalletChip.classList.add('tut-spotlight');

  let firstReward = false;
  try {
    if (!localStorage.getItem(ACCT_TUT_REWARD_KEY)) {
      localStorage.setItem(ACCT_TUT_REWARD_KEY, '1');
      firstReward = true;
    }
    localStorage.setItem(ACCT_TUT_DONE_KEY, '1');
  } catch (_) {}

  if (firstReward) {
    store.save.beans = (store.save.beans || 0) + 200;
    store.markMutatedAndSave(true);
    playSfx('crate');
    refreshHubUI();
    showToast('🎁 奖励 +200 🌿 已入账');
  } else {
    playSfx('bean');
  }

  if (acctTutStepPill) acctTutStepPill.textContent = '云存档 4/4';
  if (acctTutTitle) {
    acctTutTitle.textContent = firstReward ? '🎉 完成！+200 🌿 已入账' : '✅ 云存档说明已完成';
  }
  if (acctTutBody) {
    acctTutBody.innerHTML = '绑定账号后，全服排行榜纪录也会自动关联保存。';
  }
  if (acctTutSubBtn) {
    acctTutSubBtn.textContent = '📚 教程菜单';
    acctTutSubBtn.classList.remove('hidden');
  }
  if (acctTutPrimaryBtn) {
    acctTutPrimaryBtn.textContent = '完成';
    acctTutPrimaryBtn.classList.remove('hidden');
  }
}

function startAccountSaveTutorial() {
  ensureAudio();
  playSfx('bean');
  if (tutorialMenuOverlay) tutorialMenuOverlay.classList.add('hidden');
  if (tutorialWelcomeOverlay) tutorialWelcomeOverlay.classList.add('hidden');
  if (acctStrongNudgeOverlay) acctStrongNudgeOverlay.classList.add('hidden');
  if (state !== 'HUB') {
    if (partyCtrl && partyCtrl.isActive()) partyCtrl.exitPartyToHub();
    else finishRunAndOpenHub();
  }
  renderAccountTutorialStep(1);
}

function refreshTutorialMenuBadges() {
  try {
    const pveDone = Boolean(localStorage.getItem(TUT_REWARD_KEY));
    const pvpDone = Boolean(localStorage.getItem(PVP_TUT_REWARD_KEY));
    const acctDone = Boolean(localStorage.getItem(ACCT_TUT_REWARD_KEY));
    if (tutMenuPveBadge) {
      tutMenuPveBadge.textContent = pveDone ? '✅ 已通关' : '+300🌿';
      tutMenuPveBadge.classList.toggle('done', pveDone);
    }
    if (tutMenuPvpBadge) {
      tutMenuPvpBadge.textContent = pvpDone ? '✅ 已通关' : '+500🌿';
      tutMenuPvpBadge.classList.toggle('done', pvpDone);
    }
    if (tutMenuAcctBadge) {
      tutMenuAcctBadge.textContent = acctDone ? '✅ 已领' : '+200🌿';
      tutMenuAcctBadge.classList.toggle('done', acctDone);
    }
  } catch (_) {}
}

function openTutorialMenuModal() {
  ensureAudio();
  playSfx('bean');
  stopAccountSaveTutorial();
  if (tutorialWelcomeOverlay) tutorialWelcomeOverlay.classList.add('hidden');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
  if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.add('hidden');
  refreshTutorialMenuBadges();
  if (tutorialMenuOverlay) tutorialMenuOverlay.classList.remove('hidden');
}

function closeTutorialMenuModal() {
  if (tutorialMenuOverlay) tutorialMenuOverlay.classList.add('hidden');
}

function maybeShowStrongAccountNudge() {
  // Disabled: no anxiety-inducing popups or guest warnings
}

function clearTutorialSpotlights() {
  if (tutorialSession.active && tutorialSession.savedDashEnergy !== undefined) {
    store.save.dashEnergy = tutorialSession.savedDashEnergy;
    tutorialSession.savedDashEnergy = undefined;
  }
  tutorialSession.active = false;
  tutorialSession.mode = 'pve';
  tutorialSession.totalSteps = 10;
  tutorialSession.pausedForPrompt = false;
  tutorialSession.masteryReady = false;
  tutorialSession.expectedInput = null;
  tutorialSession.callout = null;
  tutorialSession.timeScale = 1.0;
  tutorialSession.graduatingTimer = 0;
  document.documentElement.classList.remove(
    'tutorial-clean-mode',
    'tutorial-hp-unlocked',
    'tutorial-heal-unlocked',
    'tutorial-hyper-unlocked',
    'tutorial-boss-stage',
    'pvp-tutorial-mode',
    'pvp-tut-stamina-unlocked',
    'pvp-tut-items-unlocked'
  );
  if (tutorialCoachHud) {
    tutorialCoachHud.classList.add('hidden');
    tutorialCoachHud.classList.remove('parry-alert');
  }
  if (tutMasteryRow) tutMasteryRow.classList.add('hidden');
  if (tutPauseBadge) tutPauseBadge.classList.add('hidden');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
  if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.add('hidden');
  for (const btn of [jumpBtn, actionBtn, skillBtn, hudHealBtn, hyperDashBtn, partyStaminaTutBtn, partySlot0TutBtn, partySlot1TutBtn]) {
    if (!btn) continue;
    btn.classList.remove('tut-spotlight', 'tut-hidden-ctrl', 'tut-unlock-pop');
  }
}

function syncTutorialDots(stepNum, totalSteps = tutorialSession.totalSteps || 10) {
  for (let i = 0; i < tutDots.length; i++) {
    const dot = tutDots[i];
    if (!dot) continue;
    dot.style.display = i < totalSteps ? '' : 'none';
    dot.classList.toggle('done', i + 1 < stepNum);
    dot.classList.toggle('active', i + 1 === stepNum);
  }
}

function applyProgressiveButtonVisibility(stepNum) {
  if (jumpBtn) jumpBtn.classList.remove('tut-hidden-ctrl');
  if (actionBtn) {
    const wasHidden = actionBtn.classList.contains('tut-hidden-ctrl');
    const shouldHide = stepNum < 4;
    actionBtn.classList.toggle('tut-hidden-ctrl', shouldHide);
    if (wasHidden && !shouldHide) {
      actionBtn.classList.remove('tut-unlock-pop');
      void actionBtn.offsetWidth;
      actionBtn.classList.add('tut-unlock-pop');
    }
  }
  if (skillBtn) {
    const wasHidden = skillBtn.classList.contains('tut-hidden-ctrl');
    const shouldHide = stepNum < 6;
    skillBtn.classList.toggle('tut-hidden-ctrl', shouldHide);
    if (wasHidden && !shouldHide) {
      skillBtn.classList.remove('tut-unlock-pop');
      void skillBtn.offsetWidth;
      skillBtn.classList.add('tut-unlock-pop');
    }
  }
  document.documentElement.classList.toggle('tutorial-hp-unlocked', stepNum >= 7);
  document.documentElement.classList.toggle('tutorial-heal-unlocked', stepNum >= 7);
  document.documentElement.classList.toggle('tutorial-hyper-unlocked', stepNum >= 8);
  document.documentElement.classList.toggle('tutorial-boss-stage', stepNum >= 9);
}

function setTutorialCoachDisplay({ badge, title, main, cta, spotlightBtn = null, paused = false, alertGlow = false, masteryReady = false, replayLbl = '🔄 再练一次本节' }) {
  if (tutStepBadge && badge) tutStepBadge.textContent = badge;
  if (tutCoachTitleTxt && title !== undefined) tutCoachTitleTxt.innerHTML = title;
  if (tutCoachMainTxt && main !== undefined) tutCoachMainTxt.innerHTML = main;
  if (tutCoachActionCta && cta !== undefined) {
    tutCoachActionCta.innerHTML = cta;
    tutCoachActionCta.classList.toggle('waiting-ride', !paused && spotlightBtn === null && !masteryReady);
  }
  if (tutMasteryRow) {
    tutMasteryRow.classList.toggle('hidden', !masteryReady);
    if (masteryReady && tutReplayStepBtn) tutReplayStepBtn.textContent = replayLbl;
  }
  if (tutPauseBadge) tutPauseBadge.classList.toggle('hidden', !paused);
  if (tutorialCoachHud) tutorialCoachHud.classList.toggle('parry-alert', Boolean(alertGlow || masteryReady));
  if (jumpBtn) jumpBtn.classList.toggle('tut-spotlight', spotlightBtn === 'jump');
  if (actionBtn) actionBtn.classList.toggle('tut-spotlight', spotlightBtn === 'action' || spotlightBtn === 'both_atk');
  if (skillBtn) skillBtn.classList.toggle('tut-spotlight', spotlightBtn === 'skill' || spotlightBtn === 'both_atk');
  if (hudHealBtn) hudHealBtn.classList.toggle('tut-spotlight', spotlightBtn === 'heal');
  if (hyperDashBtn) hyperDashBtn.classList.toggle('tut-spotlight', spotlightBtn === 'hyper');
  if (partyStaminaTutBtn) partyStaminaTutBtn.classList.toggle('tut-spotlight', spotlightBtn === 'pvp_stamina');
  if (partySlot0TutBtn) partySlot0TutBtn.classList.toggle('tut-spotlight', spotlightBtn === 'pvp_slot0' || spotlightBtn === 'pvp_any_slot');
  if (partySlot1TutBtn) partySlot1TutBtn.classList.toggle('tut-spotlight', spotlightBtn === 'pvp_slot1' || spotlightBtn === 'pvp_any_slot');
}

function pauseForTutorialPrompt(expectedInput, cfg) {
  tutorialSession.pausedForPrompt = true;
  tutorialSession.expectedInput = expectedInput;
  tutorialSession.timeScale = 0;
  tutorialSession.callout = cfg.callout || null;
  popups.length = 0;
  playSfx('bean');
  setTutorialCoachDisplay({
    badge: cfg.badge,
    title: cfg.title,
    main: cfg.main,
    cta: cfg.cta,
    spotlightBtn: expectedInput,
    paused: true,
    alertGlow: cfg.alertGlow !== false
  });
}

const PVP_TUT_ITEM_GROUPS = {
  4: [
    ['bean_nitro', '🍵 南北绿豆：氮气提速并自动吸豆'],
    ['ddj_rush', '🐔 叮咚鸡血：爆发提速并免除减速'],
    ['kun_rocket', '🚀 背带窜天猴：腾空无敌冲刺']
  ],
  5: [
    ['truck_isekai', '🚛 大运泥头车：创飞对手 (-50HP)'],
    ['lightning_whip', '⚡ 闪电五连鞭：落雷麻痹并提速'],
    ['naiwa_swarm', '🐸 狂撒奶蛙群：压顶减速 (-30HP)']
  ],
  6: [
    ['dagou_bite', '🐕 大狗狂咬：咬住后轮拖拽减速'],
    ['bball_rain', '🏀 篮球陨石雨：天降篮球连环砸头'],
    ['maodie_trap', '🐱 圆头耄耋群：猫群扑脸眩晕']
  ],
  7: [
    ['pelican_carry', '🦩 鹈鹕顺丰叼：倒叼对手悬空减速'],
    ['manbo_steal', '🎵 曼波偷速波：偷取对手速度与能量'],
    ['lawyer_seal', '📜 律师函警告：巨章遮挡对手视野']
  ]
};

function beginTutorialLesson(stepNum) {
  if (!tutorialSession.active) return;
  const h = getHero();
  tutorialSession.step = stepNum;
  tutorialSession.subPhase = 'approach';
  tutorialSession.pausedForPrompt = false;
  tutorialSession.expectedInput = null;
  tutorialSession.phaseTimer = 0;
  tutorialSession.callout = null;
  tutorialSession.timeScale = 1.0;

  syncTutorialDots(stepNum);
  applyProgressiveButtonVisibility(stepNum);

  if (stepNum !== 10) {
    enemies.length = 0;
    laserGates.length = 0;
    pits.length = 0;
    rails.length = 0;
    pendulums.length = 0;
    skyLightnings.length = 0;
    skyRings.length = 0;
    skyBumpers.length = 0;
    enemyShots.length = 0;
    worldProps.length = 0;
    cashTrucks.length = 0;
  }

  if (stepNum === 1) {
    const tx = player.x + 260;
    tutorialSession.targetX = tx;
    enemies.push({ x: tx, kind: 'pelican_guard', isTutStep1: true, hit: false, phase: 0 });
    for (let k = 0; k < 5; k++) {
      const bx = tx - 50 + k * 26;
      const ay = 75 + Math.sin((k / 4) * Math.PI) * 58;
      beans.push({ x: bx, y: -ay, val: 1, giant: k === 2, taken: false });
    }
    setTutorialCoachDisplay({ badge: '基础 1/10', title: '自动骑行 · 起跳越障', main: '', cta: '', paused: false });
  } else if (stepNum === 2) {
    const px = player.x + 250;
    tutorialSession.targetX = px;
    tutorialSession.pitEndX = px + 235;
    pits.push({ x: px, len: 235, bridged: false, isTutPit: true });
    rails.push({ x: px + 65, len: 275, hOff: 132, kind: 'suspenders', energizedTimer: 0 });
    for (let k = 0; k < 5; k++) {
      beans.push({ x: px + 95 + k * 42, y: -158, val: 1, giant: k === 2, taken: false });
    }
    setTutorialCoachDisplay({ badge: '基础 2/10', title: '二段跳与高空滑轨', main: '', cta: '', paused: false });
  } else if (stepNum === 3) {
    const ex = player.x + 295;
    tutorialSession.targetX = ex;
    tutorialSession.step3StompDone = false;
    for (let k = 0; k < 4; k++) {
      enemies.push({
        x: ex + k * 44,
        kind: k % 2 === 0 ? 'dribbler' : 'normal_frog',
        tutStep3: true,
        hit: false,
        phase: k * 0.5
      });
    }
    setTutorialCoachDisplay({ badge: '基础 3/10', title: '无盾小怪：跳起踩头', main: '', cta: '', paused: false });
  } else if (stepNum === 4) {
    playSfx('crate');
    const ex = player.x + 280;
    tutorialSession.targetX = ex;
    enemies.push({ x: ex, kind: 'shield_lawyer', shielded: true, shotDone: true, tutStep4: true, hit: false, phase: 0 });
    laserGates.push({ x: ex + 96, hacked: false, tutStep4: true });
    setTutorialCoachDisplay({ badge: '战斗 4/10', title: '解锁【🐔 铁山靠】破盾清障', main: '', cta: '', paused: false });
  } else if (stepNum === 5) {
    const casterX = player.x + 500;
    const orbX = player.x + 360;
    tutorialSession.targetX = orbX;
    enemies.push({ x: casterX, kind: 'shield_lawyer', shielded: true, shotDone: true, tutStep5Caster: true, hit: false, phase: 0 });
    enemyShots.push({
      kind: 'lawyer_orb',
      tutorialOrb: true,
      x: orbX,
      y: -44,
      targetH: 44,
      vx: -155,
      parried: false,
      rot: 0
    });
    setTutorialCoachDisplay({ badge: '战斗 5/10', title: '铁山靠弹反飞弹', main: '', cta: '', paused: false });
  } else if (stepNum === 6) {
    playSfx('crate');
    player.skillCd = 0;
    player.flameFuel = 100;
    syncControlsUI();
    const packX = player.x + 295;
    tutorialSession.targetX = packX;
    tutorialSession.step6Kills = 0;
    const kinds = ['normal_frog', 'spiky_cat', 'boar_frog', 'dribbler'];
    for (let k = 0; k < 4; k++) {
      enemies.push({ x: packX + k * 46, kind: kinds[k], chargePrep: 99, tutStep6: true, hit: false, phase: k * 0.6 });
    }
    setTutorialCoachDisplay({ badge: '战斗 6/10', title: `解锁大招【${h.skillLbl}】`, main: '', cta: '', paused: false });
  } else if (stepNum === 7) {
    playSfx('crate');
    player.hp = player.maxHp;
    player.displayHp = player.maxHp;
    player.trailHp = player.maxHp;
    const propX = player.x + 190;
    tutorialSession.targetX = propX + 105;
    worldProps.push({
      x: propX,
      y: -52,
      baseY: -52,
      parachute: false,
      chuteCol: '#38bdf8',
      def: TIMED_SHIELD_PROP,
      taken: false,
      phase: 0
    });
    updateTopHUD();
    setTutorialCoachDisplay({ badge: '生存 7/10', title: '赛道护盾与急救回血', main: '', cta: '', paused: false });
  } else if (stepNum === 8) {
    playSfx('crate');
    store.save.dashEnergy = 20;
    superCharge = 85;
    syncControlsUI();
    updateTopHUD();
    const gx = player.x + 280;
    tutorialSession.targetX = gx;
    pits.push({ x: gx + 30, len: 150, bridged: false, isTutPit: true });
    laserGates.push({ x: gx + 210, hacked: false });
    enemies.push({ x: gx + 260, kind: 'shield_lawyer', shielded: true, shotDone: true, hit: false, phase: 0 });
    enemies.push({ x: gx + 315, kind: 'spiky_cat', hit: false, phase: 1 });
    cashTrucks.push({ x: gx + 370, y: 0, hp: 6, dead: false, flash: 0 });
    setTutorialCoachDisplay({ badge: '进阶 8/10', title: '解锁【☄️ 霸王冲刺】', main: '', cta: '', paused: false });
  } else if (stepNum === 9) {
    playSfx('crater');
    player.skillCd = 0;
    player.flameFuel = 100;
    tutorialSession.bossSpawned = true;
    const ddjTpl = BOSS_ROSTER.find((b) => b.kind === 'dingdong_ji') || BOSS_ROSTER[0];
    activeBoss = {
      tier: 1, tierLbl: '陪练', tierBg: '#f59e0b',
      kind: ddjTpl.kind, sprite: ddjTpl.sprite, name: '🐔 陪练叮咚鸡',
      maxHp: 140, hp: 140,
      dmgRate: 70, dmgBudget: 95, maxBudget: 95,
      phase: 1, maxPhases: 2,
      reward: 45,
      isTutorialBoss: true,
      worldX: player.x + 360, yOff: 0,
      skillIdx: 0, minionTimer: 999,
      stunTimer: 0, flashTimer: 0
    };
    initBossCustomState(activeBoss, player.x);
    refreshBossHudUI();
    bossHud.classList.remove('hidden');
    const wx = player.x + 315;
    tutorialSession.targetX = wx;
    enemyShots.push({ kind: 'spike_roller', isTutBossWave: true, x: wx, y: 0, vx: -130, parried: false, rot: 0 });
    syncControlsUI();
    updateTopHUD();
    setTutorialCoachDisplay({ badge: '首领 9/10', title: '首领战：躲招 · 破防 · 大招暴击', main: '', cta: '', paused: false });
  } else if (stepNum === 10) {
    store.save.dashEnergy = 20;
    player.skillCd = 0;
    player.flameFuel = 100;
    syncControlsUI();
    updateTopHUD();
    setTutorialCoachDisplay({ badge: '决战 10/10', title: '首领狂暴：霸王冲刺压制斩杀', main: '', cta: '', paused: false });
  }
}

function tryConsumePvpTutorialInput(kind) {
  if (tutorialSession.pausedForPrompt) {
    const exp = tutorialSession.expectedInput;
    const matched = (kind === exp)
      || (exp === 'both_atk' && (kind === 'action' || kind === 'skill'))
      || (exp === 'pvp_any_slot' && (kind === 'pvp_slot0' || kind === 'pvp_slot1'));
    if (!matched) return false;
    tutorialSession.pausedForPrompt = false;
    tutorialSession.expectedInput = null;
    tutorialSession.callout = null;
    tutorialSession.timeScale = 1.0;
    if (tutPauseBadge) tutPauseBadge.classList.add('hidden');
    if (tutorialCoachHud) tutorialCoachHud.classList.remove('parry-alert');

    const st = tutorialSession.step;
    if (st === 1) {
      tutorialSession.subPhase = '1_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 1/10', title: '穿环提速中…', main: '', cta: '', paused: false });
    } else if (st === 2) {
      tutorialSession.subPhase = '2_boosting';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 2/10', title: '超级冲刺反超中…', main: '', cta: '', paused: false });
    } else if (st === 3 && tutorialSession.subPhase === 'approach') {
      tutorialSession.subPhase = '3_jump1';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 3/10', title: '升空中，准备二段跳…', main: '', cta: '', paused: false });
    } else if (st === 3 && tutorialSession.subPhase === '3_jump1') {
      tutorialSession.subPhase = '3_jump2';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 3/10', title: '二段跳穿金环！', main: '', cta: '', paused: false });
    } else if (st >= 4 && st <= 7) {
      tutorialSession.subPhase = 'item_watch';
      tutorialSession.phaseTimer = 0;
      tutorialSession.afterClearTimer = 0;
      const grp = PVP_TUT_ITEM_GROUPS[st] || [];
      const cur = grp[tutorialSession.itemSubIdx || 0];
      setTutorialCoachDisplay({
        badge: `竞速 ${st}/10 (${(tutorialSession.itemSubIdx || 0) + 1}/3)`,
        title: cur ? cur[1] : '道具生效中…',
        main: '',
        cta: '',
        paused: false
      });
    } else if (st === 8 && tutorialSession.subPhase === 'approach_8a') {
      tutorialSession.subPhase = '8a_blocked';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 8/10 (1/2)', title: '🛡️ 金钟罩挡下攻击！', main: '', cta: '', paused: false });
    } else if (st === 8 && tutorialSession.subPhase === 'approach_8b') {
      tutorialSession.subPhase = '8b_reflected';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 8/10 (2/2)', title: '🍳 铁锅原路反弹泥头车！', main: '', cta: '', paused: false });
    } else if (st === 9 && tutorialSession.subPhase === 'approach_9a') {
      tutorialSession.subPhase = '9a_done';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 9/10 (1/2)', title: '🐔 铁山靠命中削血！', main: '', cta: '', paused: false });
    } else if (st === 9 && tutorialSession.subPhase === 'approach_9b') {
      tutorialSession.subPhase = '9b_done';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 9/10 (2/2)', title: '💥 大招清空对手血条！', main: '', cta: '', paused: false });
    } else if (st === 10 && tutorialSession.subPhase === '10_pit_paused') {
      tutorialSession.subPhase = '10_pit_go';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '竞速 10/10', title: '🦩 鹈鹕自动捞回赛道，冲向终点！', main: '', cta: '', paused: false });
    }
    return true;
  }

  if (tutorialSession.masteryReady) return false;

  const st = tutorialSession.step;
  if (st === 2 && tutorialSession.subPhase === '2_boosting' && kind === 'pvp_stamina') return true;
  if (st === 9 && tutorialSession.subPhase === '9b_done' && kind === 'skill') return true;
  if (st === 10 && tutorialSession.subPhase === '10_sprint' && kind === 'jump') return true;
  return false;
}

function tryConsumeTutorialInput(kind) {
  if (!tutorialSession.active) return true;
  if (tutorialSession.mode === 'pvp') {
    return tryConsumePvpTutorialInput(kind);
  }

  if (tutorialSession.pausedForPrompt) {
    const exp = tutorialSession.expectedInput;
    const matched = (kind === exp) || (exp === 'both_atk' && (kind === 'action' || kind === 'skill'));
    if (!matched) return false;
    tutorialSession.pausedForPrompt = false;
    tutorialSession.expectedInput = null;
    tutorialSession.callout = null;
    tutorialSession.timeScale = 1.0;
    if (tutPauseBadge) tutPauseBadge.classList.add('hidden');
    if (tutorialCoachHud) tutorialCoachHud.classList.remove('parry-alert');

    const st = tutorialSession.step;
    if (st === 1) {
      tutorialSession.subPhase = '1_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '基础 1/10', title: '✅ 跃过障碍', main: '', cta: '', paused: false });
    } else if (st === 2 && tutorialSession.subPhase === 'approach') {
      tutorialSession.subPhase = '2A_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '基础 2/10', title: '准备空中二段跳…', main: '', cta: '', paused: false });
    } else if (st === 2 && tutorialSession.subPhase === '2A_jumped') {
      tutorialSession.subPhase = '2B_done';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '基础 2/10', title: '✅ 跳上滑轨越过断桥', main: '', cta: '', paused: false });
    } else if (st === 3) {
      tutorialSession.subPhase = '3_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '基础 3/10', title: '下落踩头中…', main: '', cta: '', paused: false });
    } else if (st === 4) {
      tutorialSession.subPhase = '4_struck';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '战斗 4/10', title: '✅ 铁山靠破盾清电网', main: '', cta: '', paused: false });
    } else if (st === 5) {
      tutorialSession.subPhase = '5_parried';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '战斗 5/10', title: '✅ 完美弹反飞弹', main: '', cta: '', paused: false });
    } else if (st === 6) {
      tutorialSession.subPhase = '6_cast';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '战斗 6/10', title: '✅ 大招清场', main: '', cta: '', paused: false });
    } else if (st === 7) {
      tutorialSession.subPhase = '7_healed';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '生存 7/10', title: '✅ 急救包瞬间回血', main: '', cta: '', paused: false });
    } else if (st === 8) {
      tutorialSession.subPhase = '8_dashing';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '进阶 8/10', title: '☄️ 霸王冲刺无敌破障', main: '', cta: '', paused: false });
    } else if (st === 9 && tutorialSession.subPhase === 'approach') {
      tutorialSession.subPhase = '9A_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '首领 9/10 (1/3)', title: '✅ 跃过地面刺轮', main: '', cta: '', paused: false });
    } else if (st === 9 && tutorialSession.subPhase === '9B_swoop') {
      tutorialSession.subPhase = '9B_parried';
      tutorialSession.phaseTimer = 0;
      player.skillCd = 0;
      player.flameFuel = 100;
      if (activeBoss && activeBoss.isTutorialBoss) {
        activeBoss.mech = 'idle';
        activeBoss.mechSub = 0;
        activeBoss.stunTimer = 8.0;
        activeBoss.recoilX = 42;
        playSfx('parry');
        hitBoss(32, true, true);
      }
      setTutorialCoachDisplay({ badge: '首领 9/10 (2/3)', title: '💫 铁山靠打晕首领', main: '', cta: '', paused: false });
    } else if (st === 9 && tutorialSession.subPhase === '9C_wait_skill') {
      tutorialSession.subPhase = '9C_cast';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '首领 9/10 (3/3)', title: '💥 眩晕大招 140% 暴击', main: '', cta: '', paused: false });
    } else if (st === 10 && tutorialSession.subPhase === 'approach') {
      tutorialSession.subPhase = '10_pinning';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '决战 10/10', title: '☄️ 霸王冲刺壁垒强压首领', main: '', cta: '', paused: false });
    } else if (st === 10 && tutorialSession.subPhase === '10_finish_paused') {
      tutorialSession.subPhase = '10_finish_cast';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({ badge: '决战 10/10', title: '🏆 斩杀首领！', main: '', cta: '', paused: false });
    }
    return true;
  }

  if ((tutorialSession.step === 6 && tutorialSession.subPhase === '6_cast')
      || (tutorialSession.step === 9 && tutorialSession.subPhase === '9C_cast')) {
    return kind === 'skill';
  }
  if (tutorialSession.step === 10 && tutorialSession.subPhase === '10_finish_cast') {
    return kind === 'jump' || kind === 'action' || kind === 'skill';
  }
  return false;
}

function openTutorialGraduationModal() {
  let firstReward = false;
  try {
    if (!localStorage.getItem(TUT_REWARD_KEY)) {
      localStorage.setItem(TUT_REWARD_KEY, '1');
      firstReward = true;
    }
    localStorage.setItem(TUT_DONE_KEY, '1');
  } catch (_) {}

  if (firstReward) {
    runStats.beans += 300;
    bankRunProgress(true);
    if (tutGradRewardBanner) {
      tutGradRewardBanner.textContent = '🎁 首通奖励 +300 🌿 已入账';
    }
  } else if (tutGradRewardBanner) {
    tutGradRewardBanner.textContent = '✅ 基础教学已完成';
  }

  clearTutorialSpotlights();
  state = 'PAUSED';
  playSfx('crate');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.remove('hidden');
}

function completeTutorialHandoffToLiveRun(skipped = false) {
  const wasPvp = tutorialSession.mode === 'pvp';
  try {
    localStorage.setItem(wasPvp ? PVP_TUT_DONE_KEY : TUT_DONE_KEY, '1');
  } catch (_) {}
  clearTutorialSpotlights();
  if (wasPvp) {
    if (partyCtrl && partyCtrl.isActive()) {
      partyCtrl.exitPartyToHub();
    } else {
      finishRunAndOpenHub();
    }
    showToast('🏠 已退出竞速教程');
    return;
  }
  if (skipped) {
    finishRunAndOpenHub();
    showToast('🏠 已退出教程');
    return;
  }
  startNewRun(store.save.selectedHero, 0, 0);
  showToast('🚀 正式发车！');
}

function applyPvpProgressiveVisibility(stepNum) {
  if (jumpBtn) jumpBtn.classList.remove('tut-hidden-ctrl');
  const unlockBattle = stepNum >= 9;
  for (const btn of [actionBtn, skillBtn]) {
    if (!btn) continue;
    const wasHidden = btn.classList.contains('tut-hidden-ctrl');
    btn.classList.toggle('tut-hidden-ctrl', !unlockBattle);
    if (wasHidden && unlockBattle) {
      btn.classList.remove('tut-unlock-pop');
      void btn.offsetWidth;
      btn.classList.add('tut-unlock-pop');
    }
  }
  const prevStam = document.documentElement.classList.contains('pvp-tut-stamina-unlocked');
  const wantStam = stepNum >= 2;
  document.documentElement.classList.toggle('pvp-tut-stamina-unlocked', wantStam);
  if (!prevStam && wantStam && partyStaminaTutBtn) {
    partyStaminaTutBtn.classList.remove('tut-unlock-pop');
    void partyStaminaTutBtn.offsetWidth;
    partyStaminaTutBtn.classList.add('tut-unlock-pop');
  }
  const prevItems = document.documentElement.classList.contains('pvp-tut-items-unlocked');
  const wantItems = stepNum >= 4;
  document.documentElement.classList.toggle('pvp-tut-items-unlocked', wantItems);
  if (!prevItems && wantItems) {
    for (const b of [partySlot0TutBtn, partySlot1TutBtn]) {
      if (!b) continue;
      b.classList.remove('tut-unlock-pop');
      void b.offsetWidth;
      b.classList.add('tut-unlock-pop');
    }
  }
  document.documentElement.classList.toggle('tutorial-hp-unlocked', stepNum >= 8);
}

function showPvpLessonMasteryBar({ badge, title, replayLbl = '🔄 再练' }) {
  if (tutorialSession.masteryReady) return;
  tutorialSession.masteryReady = true;
  tutorialSession.pausedForPrompt = false;
  tutorialSession.expectedInput = null;
  tutorialSession.callout = null;
  tutorialSession.timeScale = 0;
  playSfx('crate');
  setTutorialCoachDisplay({
    badge,
    title,
    main: '',
    cta: '',
    spotlightBtn: null,
    paused: true,
    alertGlow: true,
    masteryReady: true,
    replayLbl
  });
}

function replayCurrentPvpTutorialLesson() {
  if (!tutorialSession.active || tutorialSession.mode !== 'pvp') return;
  ensureAudio();
  playSfx('bean');
  beginPvpTutorialLesson(tutorialSession.step);
}

function advanceCurrentPvpTutorialLesson() {
  if (!tutorialSession.active || tutorialSession.mode !== 'pvp') return;
  ensureAudio();
  playSfx('crate');
  if (tutorialSession.step < 10) {
    beginPvpTutorialLesson(tutorialSession.step + 1);
  } else {
    openPvpTutorialGraduationModal();
  }
}

function beginPvpTutorialLesson(stepNum) {
  if (!tutorialSession.active || tutorialSession.mode !== 'pvp' || !partyCtrl) return;
  tutorialSession.step = stepNum;
  tutorialSession.itemSubIdx = 0;
  if (stepNum >= 4 && stepNum <= 7) {
    tutorialSession.subPhase = 'item_prep';
  } else if (stepNum === 8) {
    tutorialSession.subPhase = 'approach_8a';
  } else if (stepNum === 9) {
    tutorialSession.subPhase = 'approach_9a';
  } else {
    tutorialSession.subPhase = 'approach';
  }
  tutorialSession.pausedForPrompt = false;
  tutorialSession.masteryReady = false;
  tutorialSession.expectedInput = null;
  tutorialSession.phaseTimer = 0;
  tutorialSession.callout = null;
  tutorialSession.timeScale = 1.0;

  syncTutorialDots(stepNum, 10);
  applyPvpProgressiveVisibility(stepNum);
  const cfg = partyCtrl.configurePvpTutorialStep(stepNum);
  if (cfg && cfg.targetX !== undefined) {
    tutorialSession.targetX = cfg.targetX;
  }
  if (cfg && cfg.pitX !== undefined) {
    tutorialSession.pitX = cfg.pitX;
  }

  if (stepNum === 1) {
    setTutorialCoachDisplay({ badge: '竞速 1/10', title: '⚡ 涡轮加速环', main: '', cta: '', paused: false });
  } else if (stepNum === 2) {
    playSfx('crate');
    setTutorialCoachDisplay({ badge: '竞速 2/10', title: '☄️ 超级冲刺条', main: '', cta: '', paused: false });
  } else if (stepNum === 3) {
    playSfx('crate');
    setTutorialCoachDisplay({ badge: '竞速 3/10', title: '🔗 弹力绳与高空金环', main: '', cta: '', paused: false });
  } else if (stepNum >= 4 && stepNum <= 7) {
    playSfx('crate');
    const grp = PVP_TUT_ITEM_GROUPS[stepNum];
    setTutorialCoachDisplay({ badge: `竞速 ${stepNum}/10 (1/3)`, title: grp[0][1], main: '', cta: '', paused: false });
  } else if (stepNum === 8) {
    playSfx('crate');
    setTutorialCoachDisplay({ badge: '竞速 8/10 (1/2)', title: '🛡️ 金钟罩与铁锅反弹', main: '', cta: '', paused: false });
  } else if (stepNum === 9) {
    playSfx('crate');
    player.skillCd = 0;
    player.flameFuel = 100;
    syncControlsUI();
    updateTopHUD();
    setTutorialCoachDisplay({ badge: '竞速 9/10', title: '⚔️ 并排肉搏击倒对手', main: '', cta: '', paused: false });
  } else if (stepNum === 10) {
    playSfx('crate');
    setTutorialCoachDisplay({ badge: '竞速 10/10', title: '🦩 坠坑救援与冲线观战', main: '', cta: '', paused: false });
  }
}

function openPvpTutorialGraduationModal() {
  let firstReward = false;
  try {
    if (!localStorage.getItem(PVP_TUT_REWARD_KEY)) {
      localStorage.setItem(PVP_TUT_REWARD_KEY, '1');
      firstReward = true;
    }
    localStorage.setItem(PVP_TUT_DONE_KEY, '1');
  } catch (_) {}

  if (firstReward) {
    store.save.beans = (store.save.beans || 0) + 500;
    store.markMutatedAndSave(true);
    if (pvpTutGradRewardBanner) {
      pvpTutGradRewardBanner.textContent = '🎁 首通奖励 +500 🌿 已入账';
    }
  } else if (pvpTutGradRewardBanner) {
    pvpTutGradRewardBanner.textContent = '✅ 竞速教学已完成';
  }

  clearTutorialSpotlights();
  state = 'PAUSED';
  playSfx('crate');
  if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.remove('hidden');
}

function startPvpTutorialRun() {
  ensureAudio();
  clearLivePveRunSnapshot();
  stopAccountSaveTutorial();
  if (tutorialMenuOverlay) tutorialMenuOverlay.classList.add('hidden');
  if (tutorialWelcomeOverlay) tutorialWelcomeOverlay.classList.add('hidden');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
  if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.add('hidden');
  if (!partyCtrl || !partyCtrl.startPvpTutorialSession) return;

  partyCtrl.startPvpTutorialSession();

  tutorialSession.active = true;
  tutorialSession.mode = 'pvp';
  tutorialSession.totalSteps = 10;
  tutorialSession.masteryReady = false;
  tutorialSession.graduatingTimer = 0;

  document.documentElement.classList.add('tutorial-clean-mode', 'pvp-tutorial-mode');
  document.documentElement.classList.remove(
    'tutorial-hp-unlocked',
    'tutorial-heal-unlocked',
    'tutorial-hyper-unlocked',
    'tutorial-boss-stage',
    'pvp-tut-stamina-unlocked',
    'pvp-tut-items-unlocked'
  );

  if (tutorialCoachHud) {
    tutorialCoachHud.classList.remove('hidden');
    tutorialCoachHud.classList.remove('parry-alert');
  }
  if (tutMasteryRow) tutMasteryRow.classList.add('hidden');
  if (toastPill) toastPill.classList.remove('show');
  beginPvpTutorialLesson(1);
}

function tickPvpTutorialDirector(realDt) {
  if (!partyCtrl || !partyCtrl.getPvpTutorialState) return;
  player.hp = player.maxHp;
  player.displayHp = player.maxHp;
  player.trailHp = player.maxHp;

  if (tutorialSession.pausedForPrompt) return;

  if (tutorialSession.graduatingTimer > 0) {
    tutorialSession.graduatingTimer -= realDt;
    if (tutorialSession.graduatingTimer <= 0) {
      openPvpTutorialGraduationModal();
    }
    return;
  }

  if (tutorialSession.masteryReady) return;

  const pc = isPcControlHintMode();
  const h = getHero();
  const st = tutorialSession.step;
  const pvpSt = partyCtrl.getPvpTutorialState();

  // Lesson 1: Boost Ring — MUST physically pass through ring (`pvpSt.ringCleared === true`)!
  if (st === 1) {
    if (tutorialSession.subPhase === 'approach') {
      if (tutorialSession.targetX - player.x <= 96 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '竞速 1/10',
          title: '⚡ 跳过加速环可瞬间提速',
          main: '',
          cta: pc ? '👉 按【空格】起跳穿环' : '👉 点【⬆️ 起跳】穿环',
          callout: { x: tutorialSession.targetX, y: getBaseSurfaceY(tutorialSession.targetX) - 135, text: '⚡ 起跳穿环', col: '#fde047' }
        });
      } else if (player.x > tutorialSession.targetX + 80) {
        beginPvpTutorialLesson(1);
      }
    } else if (tutorialSession.subPhase === '1_jumped') {
      if (pvpSt.ringCleared) {
        if (!tutorialSession.ringToastShown) {
          tutorialSession.ringToastShown = true;
          addPopup('⚡ 穿环提速!', player.x + 24, player.y - 96, '#4ade80', 19);
        }
        tutorialSession.phaseTimer += realDt;
        if (player.onGround && tutorialSession.phaseTimer >= 1.45) {
          tutorialSession.ringToastShown = false;
          showPvpLessonMasteryBar({
            badge: '竞速 1/10 完成',
            title: '✅ 涡轮加速环已掌握',
            replayLbl: '🔄 再练'
          });
        }
      } else if (player.x > tutorialSession.targetX + 75 && player.onGround) {
        addPopup('未穿中加速环，再来一次', player.x + 18, player.y - 96, '#fbbf24', 18);
        beginPvpTutorialLesson(1);
      }
    }
    return;
  }

  // Lesson 2: Super Sprint — MUST actually overtake rival (`pvpSt.isAheadOfRival === true`) and let full sprint play out!
  if (st === 2) {
    if (tutorialSession.subPhase === 'approach') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.22 && player.onGround) {
        pauseForTutorialPrompt('pvp_stamina', {
          badge: '竞速 2/10',
          title: '☄️ 冲刺条自动充能，按住反超对手',
          main: '',
          cta: pc ? '👉 按住【Shift】超级冲刺' : '👉 按住【☄️ 超级冲刺】',
          callout: { x: pvpSt.rivalX, y: pvpSt.rivalY - 135, text: '☄️ 按住冲刺反超', col: '#38bdf8' }
        });
      }
    } else if (tutorialSession.subPhase === '2_boosting') {
      tutorialSession.phaseTimer += realDt;
      if (pvpSt.isAheadOfRival && !pvpSt.staminaBoosting && tutorialSession.phaseTimer >= 1.85) {
        addPopup('✅ 反超成功!', player.x + 24, player.y - 96, '#4ade80', 19);
        showPvpLessonMasteryBar({
          badge: '竞速 2/10 完成',
          title: '✅ 超级冲刺已掌握',
          replayLbl: '🔄 再练'
        });
      } else if (pvpSt.isAheadOfRival && tutorialSession.phaseTimer >= 2.35) {
        addPopup('✅ 反超成功!', player.x + 24, player.y - 96, '#4ade80', 19);
        showPvpLessonMasteryBar({
          badge: '竞速 2/10 完成',
          title: '✅ 超级冲刺已掌握',
          replayLbl: '🔄 再练'
        });
      } else if (!pvpSt.isAheadOfRival && tutorialSession.phaseTimer >= 2.8) {
        addPopup('继续冲刺超过对手，重试一次', player.x + 18, player.y - 96, '#fbbf24', 18);
        beginPvpTutorialLesson(2);
      }
    }
    return;
  }

  // Lesson 3: Elastic Rope + Double-Jump Gold Ring — MUST pass through Gold Ring & enjoy full double boost!
  if (st === 3) {
    if (tutorialSession.subPhase === 'approach') {
      if (tutorialSession.targetX - player.x <= 172 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '竞速 3/10 (1/2)',
          title: '🔗 落后有弹力绳助追 · 右上角看对手',
          main: '',
          cta: pc ? '👉 按【空格】第一跳' : '👉 点【⬆️ 起跳】第一跳',
          callout: { x: tutorialSession.targetX, y: getBaseSurfaceY(tutorialSession.targetX) - 190, text: '🌟 高空双倍金环', col: '#fde047' }
        });
      } else if (player.x > tutorialSession.targetX + 80) {
        beginPvpTutorialLesson(3);
      }
    } else if (tutorialSession.subPhase === '3_jump1') {
      jumpHeld = true;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.18 || player.y <= -78) {
        jumpHeld = false;
        pauseForTutorialPrompt('jump', {
          badge: '竞速 3/10 (2/2)',
          title: '🌟 二段跳穿过金色双倍加速环',
          main: '',
          cta: pc ? '👉 空中再按【空格】二段跳' : '👉 空中再点【⬆️ 起跳】',
          callout: { x: tutorialSession.targetX, y: getBaseSurfaceY(tutorialSession.targetX) - 190, text: '🌟 二段跳穿金环', col: '#4ade80' }
        });
      }
    } else if (tutorialSession.subPhase === '3_jump2') {
      if (pvpSt.ringCleared) {
        if (!tutorialSession.ringToastShown) {
          tutorialSession.ringToastShown = true;
          addPopup('🌟 双倍加速!', player.x + 24, player.y - 96, '#fde047', 19);
        }
        tutorialSession.phaseTimer += realDt;
        if (player.onGround && tutorialSession.phaseTimer >= 1.65) {
          tutorialSession.ringToastShown = false;
          showPvpLessonMasteryBar({
            badge: '竞速 3/10 完成',
            title: '✅ 弹力绳与高空金环已掌握',
            replayLbl: '🔄 再练'
          });
        }
      } else if (player.x > tutorialSession.targetX + 95 && player.onGround) {
        addPopup('未穿中金环，再来一次', player.x + 18, player.y - 96, '#fbbf24', 18);
        beginPvpTutorialLesson(3);
      }
    }
    return;
  }

  // Lessons 4~7: Paused 1-by-1 Hands-On Practice — Wait for ENTIRE VFX & Rival Reaction to Finish!
  if (st >= 4 && st <= 7) {
    const grp = PVP_TUT_ITEM_GROUPS[st];
    const idx = tutorialSession.itemSubIdx || 0;
    const cur = grp[idx];
    if (tutorialSession.subPhase === 'item_prep') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.20) {
        pauseForTutorialPrompt('pvp_slot0', {
          badge: `竞速 ${st}/10 (${idx + 1}/3)`,
          title: cur[1],
          main: '',
          cta: pc ? '👉 按【1 / Q】释放道具' : '👉 点右侧发光道具槽释放',
          callout: (st >= 5)
            ? { x: pvpSt.rivalX, y: pvpSt.rivalY - 135, text: '🎯 锁定对手释放', col: '#fde047' }
            : null
        });
      }
    } else if (tutorialSession.subPhase === 'item_watch') {
      tutorialSession.phaseTimer += realDt;
      if (!pvpSt.showcaseBusy && tutorialSession.phaseTimer >= 1.2) {
        tutorialSession.afterClearTimer = (tutorialSession.afterClearTimer || 0) + realDt;
      } else {
        tutorialSession.afterClearTimer = 0;
      }
      if ((tutorialSession.afterClearTimer || 0) >= 0.55 || tutorialSession.phaseTimer >= 4.8) {
        tutorialSession.afterClearTimer = 0;
        if (idx < 2) {
          tutorialSession.itemSubIdx = idx + 1;
          const nextItem = grp[idx + 1];
          partyCtrl.refillPvpTutorialStepItems(st, nextItem[0]);
          tutorialSession.subPhase = 'item_prep';
          tutorialSession.phaseTimer = 0;
        } else {
          const doneTitles = {
            4: '✅ 3 款冲刺道具已练完',
            5: '✅ 3 款重击道具已练完',
            6: '✅ 3 款控场道具已练完',
            7: '✅ 3 款奇袭道具已练完'
          };
          showPvpLessonMasteryBar({
            badge: `竞速 ${st}/10 完成`,
            title: doneTitles[st],
            replayLbl: '🔄 再练本组'
          });
        }
      }
    }
    return;
  }

  // Lesson 8: Paused 8A (`timed_shield`) -> 8B (`pan_shield` reflect!) — Full Impact & Pancake Watch!
  if (st === 8) {
    if (tutorialSession.subPhase === 'approach_8a') {
      if (pvpSt.incomingMissile && pvpSt.incomingMissile.prog >= 0.44) {
        pauseForTutorialPrompt('pvp_slot0', {
          badge: '竞速 8/10 (1/2)',
          title: '🛡️ 背带金钟罩：抵挡一次敌方攻击',
          main: '',
          cta: pc ? '👉 按【1 / Q】开启金钟罩' : '👉 点右侧【1号槽】开启金钟罩',
          callout: { x: pvpSt.incomingMissile.x, y: pvpSt.incomingMissile.y - 28, text: '🐸 来袭 · 开盾免伤', col: '#38bdf8' }
        });
      }
    } else if (tutorialSession.subPhase === '8a_blocked') {
      if (pvpSt.shieldBlockedDone) {
        tutorialSession.phaseTimer += realDt;
        if (tutorialSession.phaseTimer >= 1.85) {
          tutorialSession.subPhase = 'approach_8b';
          tutorialSession.phaseTimer = 0;
          partyCtrl.triggerPvpTutorialSubPhase8B();
        }
      }
    } else if (tutorialSession.subPhase === 'approach_8b') {
      if (pvpSt.incomingMissile && pvpSt.incomingMissile.prog >= 0.46) {
        pauseForTutorialPrompt('pvp_slot1', {
          badge: '竞速 8/10 (2/2)',
          title: '🍳 纯路人铁锅：将敌方攻击原路反弹',
          main: '',
          cta: pc ? '👉 按【2 / E】铁锅反弹' : '👉 点右侧【2号槽】铁锅反弹',
          callout: { x: pvpSt.incomingMissile.x, y: pvpSt.incomingMissile.y - 30, text: '🚛 泥头车 · 铁锅反弹', col: '#fde047' }
        });
      }
    } else if (tutorialSession.subPhase === '8b_reflected') {
      if (pvpSt.panReflectedDone && !pvpSt.showcaseBusy) {
        tutorialSession.phaseTimer += realDt;
        if (tutorialSession.phaseTimer >= 0.55) {
          addPopup('🎉 14种道具全部掌握!', player.x + 24, player.y - 102, '#fde047', 20);
          showPvpLessonMasteryBar({
            badge: '竞速 8/10 完成',
            title: '✅ 金钟罩与铁锅反弹已掌握',
            replayLbl: '🔄 再练反弹'
          });
        }
      }
    }
    return;
  }

  // Lesson 9: 9A (`action` 铁山靠) -> 9B (`skill` 角色大招 KO!) — Let KO Crawl Play Out!
  if (st === 9) {
    if (tutorialSession.subPhase === 'approach_9a') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.24 && Math.abs(pvpSt.rivalX - player.x) <= 138 && player.onGround) {
        pauseForTutorialPrompt('action', {
          badge: '竞速 9/10 (1/2)',
          title: '🐔 并排时可用铁山靠撞击对手削血',
          main: '',
          cta: pc ? '👉 按【左键 / J】铁山靠撞击' : '👉 点【🐔 铁山靠】撞击对手',
          callout: { x: pvpSt.rivalX, y: pvpSt.rivalY - 135, text: '🐔 铁山靠削血', col: '#fb923c' }
        });
      }
    } else if (tutorialSession.subPhase === '9a_done') {
      tutorialSession.phaseTimer += realDt;
      if (pvpSt.meleeHitDone && tutorialSession.phaseTimer >= 1.15) {
        player.skillCd = 0;
        player.flameFuel = 100;
        syncControlsUI();
        tutorialSession.subPhase = 'approach_9b';
        tutorialSession.phaseTimer = 0;
      } else if (!pvpSt.meleeHitDone && tutorialSession.phaseTimer >= 1.5) {
        beginPvpTutorialLesson(9);
      }
    } else if (tutorialSession.subPhase === 'approach_9b') {
      if (Math.abs(pvpSt.rivalX - player.x) <= 175) {
        player.skillCd = 0;
        player.flameFuel = 100;
        syncControlsUI();
        pauseForTutorialPrompt('skill', {
          badge: '竞速 9/10 (2/2)',
          title: `💥 开大招打空对手血条使其龟速`,
          main: '',
          cta: pc ? '👉 按【右键 / K】释放大招' : `👉 点【${h.skillIcon || '✨'} ${h.skillLbl}】打空对手`,
          callout: { x: pvpSt.rivalX, y: pvpSt.rivalY - 135, text: '💥 大招击倒', col: '#f43f5e' }
        });
      }
    } else if (tutorialSession.subPhase === '9b_done') {
      player.skillCd = 0;
      if (h.id === 'nailong') player.flameFuel = Math.max(player.flameFuel, 85);
      tutorialSession.phaseTimer += realDt;
      if (pvpSt.skillKoDone && tutorialSession.phaseTimer >= 2.35) {
        addPopup('✅ 击倒对手成功!', player.x + 24, player.y - 96, '#4ade80', 19);
        showPvpLessonMasteryBar({
          badge: '竞速 9/10 完成',
          title: '✅ 近身击倒已掌握',
          replayLbl: '🔄 再练'
        });
      } else if (!pvpSt.skillKoDone && tutorialSession.phaseTimer >= 2.0) {
        beginPvpTutorialLesson(9);
      }
    }
    return;
  }

  // Lesson 10: Pause at Pit -> Pelican Rescue -> Cross Finish -> Spectator Cam!
  if (st === 10) {
    if (tutorialSession.subPhase === 'approach') {
      const pitEdge = tutorialSession.pitX || (player.x + 120);
      if (pitEdge - player.x <= 70 && player.onGround) {
        tutorialSession.subPhase = '10_pit_paused';
        pauseForTutorialPrompt('jump', {
          badge: '竞速 10/10',
          title: '🦩 竞速坠坑不出局，鹈鹕自动叼回',
          main: '',
          cta: pc ? '👉 按【空格】继续冲向终点' : '👉 点【⬆️ 起跳】继续冲向终点',
          callout: { x: pitEdge + 110, y: getBaseSurfaceY(player.x) - 42, text: '🦩 坠坑自动救援', col: '#38bdf8' }
        });
      }
    } else if (tutorialSession.subPhase === '10_pit_go') {
      if (pvpSt.respawningNow || pvpSt.pitRescuedDone || player.x > (tutorialSession.pitX || 425) + 300) {
        tutorialSession.subPhase = '10_sprint';
        setTutorialCoachDisplay({ badge: '竞速 10/10', title: '🏁 冲过终点开启第一名实时观战', main: '', cta: '', paused: false });
      }
    } else if (tutorialSession.subPhase === '10_sprint') {
      if (pvpSt.crossedFinish) {
        tutorialSession.subPhase = '10_spectating';
        tutorialSession.phaseTimer = 0;
        if (tutorialCoachHud) tutorialCoachHud.classList.add('hidden');
      }
    } else if (tutorialSession.subPhase === '10_spectating') {
      tutorialSession.phaseTimer += realDt;
      if (pvpSt.rivalFinished || tutorialSession.phaseTimer >= 6.0) {
        tutorialSession.graduatingTimer = 0.4;
      }
    }
  }
}

function startTutorialRun() {
  clearLivePveRunSnapshot();
  stopAccountSaveTutorial();
  if (tutorialMenuOverlay) tutorialMenuOverlay.classList.add('hidden');
  if (tutorialWelcomeOverlay) tutorialWelcomeOverlay.classList.add('hidden');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
  if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.add('hidden');
  if (partyCtrl && partyCtrl.isActive()) {
    partyCtrl.exitPartyToHub();
  }
  const realSavedDash = store.save.dashEnergy;
  startNewRun(store.save.selectedHero, 0, 0);
  tutorialSession.savedDashEnergy = realSavedDash;

  enemies.length = 0;
  laserGates.length = 0;
  rails.length = 0;
  pendulums.length = 0;
  skyLightnings.length = 0;
  skyRings.length = 0;
  skyBumpers.length = 0;
  pits.length = 0;
  enemyShots.length = 0;
  beans.length = 0;
  worldProps.length = 0;
  cashTrucks.length = 0;
  recordFlag = null;
  quickDashWindowTimer = 0;
  if (quickDashWrap) quickDashWrap.classList.add('hidden');
  nextBossDist = 999999;
  nextTruckDist = 999999;
  nextPropDist = 999999;
  nextShieldDist = 999999;
  nextHealDist = 999999;

  tutorialSession.active = true;
  tutorialSession.mode = 'pve';
  tutorialSession.totalSteps = 10;
  tutorialSession.graduatingTimer = 0;
  document.documentElement.classList.add('tutorial-clean-mode');
  document.documentElement.classList.remove(
    'tutorial-hp-unlocked',
    'tutorial-heal-unlocked',
    'tutorial-hyper-unlocked',
    'tutorial-boss-stage',
    'pvp-tutorial-mode',
    'pvp-tut-stamina-unlocked',
    'pvp-tut-items-unlocked'
  );

  if (tutorialCoachHud) {
    tutorialCoachHud.classList.remove('hidden');
    tutorialCoachHud.classList.remove('parry-alert');
  }
  if (toastPill) toastPill.classList.remove('show');
  beginTutorialLesson(1);
}

function tickTutorialDirector(realDt) {
  if (!tutorialSession.active || state !== 'PLAYING') return;
  if (tutorialSession.mode === 'pvp') {
    tickPvpTutorialDirector(realDt);
    return;
  }
  nextBossDist = 999999;
  nextTruckDist = 999999;
  nextPropDist = 999999;
  if (tutorialSession.step !== 7 || tutorialSession.subPhase === '7_healed') {
    player.hp = player.maxHp;
    player.displayHp = player.maxHp;
    player.trailHp = player.maxHp;
  }

  if (tutorialSession.pausedForPrompt) return;

  if (tutorialSession.graduatingTimer > 0) {
    tutorialSession.graduatingTimer -= realDt;
    if (tutorialSession.graduatingTimer <= 0) {
      openTutorialGraduationModal();
    }
    return;
  }

  const pc = isPcControlHintMode();
  const h = getHero();
  const st = tutorialSession.step;

  if (st === 1) {
    if (tutorialSession.subPhase === 'approach') {
      if (tutorialSession.targetX - player.x <= 118 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '基础 1/10',
          title: '遇到矮障碍，起跳越过',
          main: '',
          cta: pc ? '👉 按【空格】起跳' : '👉 点【⬆️ 起跳】',
          callout: { x: tutorialSession.targetX, y: -92, text: '⬆️ 起跳越过', col: '#fde047' }
        });
      }
    } else if (tutorialSession.subPhase === '1_jumped') {
      if (player.x > tutorialSession.targetX + 70 && player.onGround) {
        tutorialSession.phaseTimer += realDt;
        if (tutorialSession.phaseTimer >= 0.70) {
          addPopup('✅ 一段跳掌握', player.x + 28, player.y - 96, '#4ade80', 19);
          beginTutorialLesson(2);
        }
      }
    }
    return;
  }

  if (st === 2) {
    if (tutorialSession.subPhase === 'approach') {
      if (tutorialSession.targetX - player.x <= 48 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '基础 2/10 (1/2)',
          title: '遇到宽断桥，先按第一跳',
          main: '',
          cta: pc ? '👉 按【空格】第一跳' : '👉 点【⬆️ 起跳】第一跳',
          callout: { x: tutorialSession.targetX + 105, y: -38, text: '🕳️ 断桥掉入扣血', col: '#fb7185' }
        });
      }
    } else if (tutorialSession.subPhase === '2A_jumped') {
      jumpHeld = true;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.22 || player.y <= -92) {
        jumpHeld = false;
        pauseForTutorialPrompt('jump', {
          badge: '基础 2/10 (2/2)',
          title: '半空再按一次触发二段跳上滑轨',
          main: '',
          cta: pc ? '👉 空中再按【空格】二段跳' : '👉 空中再点【⬆️ 起跳】',
          callout: { x: tutorialSession.targetX + 145, y: -175, text: '✨ 二段跳上滑轨', col: '#4ade80' }
        });
      }
    } else if (tutorialSession.subPhase === '2B_done') {
      if (player.x > tutorialSession.pitEndX + 60 && (player.onGround || player.onRail)) {
        tutorialSession.phaseTimer += realDt;
        if (tutorialSession.phaseTimer >= 0.75 && player.onGround) {
          addPopup('✅ 二段跳掌握', player.x + 32, player.y - 98, '#4ade80', 19);
          beginTutorialLesson(3);
        }
      }
    }
    return;
  }

  if (st === 3) {
    const firstEn = enemies.find((e) => e.tutStep3 && !e.hit);
    if (tutorialSession.subPhase === 'approach') {
      if (firstEn && firstEn.x - player.x <= 185 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '基础 3/10',
          title: '无盾普通小怪：跳起踩头击败',
          main: '',
          cta: pc ? '👉 按【空格】跳起踩头' : '👉 点【⬆️ 起跳】踩头',
          callout: { x: firstEn.x + 44, y: -92, text: '👟 跳起踩头', col: '#38bdf8' }
        });
      }
    } else if (tutorialSession.subPhase === '3_jumped') {
      player.jumpsLeft = 0;
      if (tutorialSession.step3StompDone) {
        tutorialSession.subPhase = '3_stomped';
        tutorialSession.phaseTimer = 0;
        for (const e of enemies) {
          if (e.tutStep3 && !e.hit) defeatEnemy(e);
        }
        setTutorialCoachDisplay({ badge: '基础 3/10', title: '✅ 踩头击败小怪', main: '', cta: '', paused: false });
      } else if (player.x > tutorialSession.targetX + 205 && player.onGround) {
        addPopup('未踩中小怪，再来一次', player.x + 20, player.y - 96, '#fbbf24', 18);
        beginTutorialLesson(3);
      }
    } else if (tutorialSession.subPhase === '3_stomped') {
      tutorialSession.phaseTimer += realDt;
      if (player.onGround && tutorialSession.phaseTimer >= 0.90) {
        addPopup('✅ 踩头掌握', player.x + 28, player.y - 96, '#4ade80', 19);
        beginTutorialLesson(4);
      }
    }
    return;
  }

  if (st === 4) {
    const en = enemies.find((e) => e.tutStep4);
    if (tutorialSession.subPhase === 'approach') {
      if (en && !en.hit && en.x - player.x <= 132 && player.onGround) {
        pauseForTutorialPrompt('action', {
          badge: '战斗 4/10',
          title: '持盾怪与电网：用【🐔 铁山靠】撞碎',
          main: '',
          cta: pc ? '👉 按【左键 / J】铁山靠' : '👉 点【🐔 铁山靠】',
          callout: { x: en.x + 35, y: -102, text: '🐔 铁山靠破盾', col: '#fb923c' }
        });
      }
    } else if (tutorialSession.subPhase === '4_struck') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 1.65) {
        addPopup('✅ 铁山靠掌握', player.x + 32, player.y - 98, '#4ade80', 19);
        beginTutorialLesson(5);
      }
    }
    return;
  }

  if (st === 5) {
    const orb = enemyShots.find((s) => s.tutorialOrb && !s.dead);
    if (tutorialSession.subPhase === 'approach') {
      if (orb && !orb.parried && orb.x - player.x <= 145) {
        pauseForTutorialPrompt('action', {
          badge: '战斗 5/10',
          title: '迎面飞弹：用【🐔 铁山靠】无伤弹反',
          main: '',
          cta: pc ? '👉 按【左键 / J】弹反飞弹' : '👉 点【🐔 铁山靠】弹反',
          callout: { x: orb.x, y: orb.y - 46, text: '📜 铁山靠弹反', col: '#4ade80' }
        });
      } else if (!orb) {
        beginTutorialLesson(5);
      }
    } else if (tutorialSession.subPhase === '5_parried') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 1.75) {
        addPopup('✅ 弹反掌握', player.x + 32, player.y - 98, '#4ade80', 19);
        beginTutorialLesson(6);
      }
    }
    return;
  }

  if (st === 6) {
    const firstMob = enemies.find((e) => e.tutStep6 && !e.hit);
    if (tutorialSession.subPhase === 'approach') {
      if (firstMob && firstMob.x - player.x <= 165 && player.onGround) {
        pauseForTutorialPrompt('skill', {
          badge: '战斗 6/10',
          title: `密集怪群：释放大招【${h.skillLbl}】清场`,
          main: '',
          cta: pc ? '👉 按【右键 / K】释放大招' : `👉 点【${h.skillIcon || '✨'} ${h.skillLbl}】`,
          callout: { x: firstMob.x + 65, y: -98, text: '✨ 大招清场', col: '#c084fc' }
        });
      }
    } else if (tutorialSession.subPhase === '6_cast') {
      player.invulnTimer = Math.max(player.invulnTimer, 0.45);
      tutorialSession.phaseTimer += realDt;
      if ((tutorialSession.step6Kills || 0) >= 4 && tutorialSession.phaseTimer >= 1.60) {
        addPopup('✅ 角色大招掌握', player.x + 32, player.y - 98, '#4ade80', 19);
        beginTutorialLesson(7);
      } else if (tutorialSession.phaseTimer >= 2.8) {
        beginTutorialLesson(6);
      }
    }
    return;
  }

  if (st === 7) {
    if (tutorialSession.subPhase === 'approach') {
      if (player.x >= tutorialSession.targetX && player.onGround) {
        player.tempShieldHp = 0;
        player.tempShieldTimer = 0;
        player.hp = Math.max(18, Math.round(player.maxHp * 0.25));
        player.displayHp = player.hp;
        player.trailHp = player.maxHp;
        refreshBuffChips();
        updateTopHUD();
        pauseForTutorialPrompt('heal', {
          badge: '生存 7/10',
          title: '残血危急时，用【🧰 急救包】回 100 血',
          main: '',
          cta: pc ? '👉 按【H】使用急救包' : '👉 点左侧【🧰 急救包】',
          callout: { x: player.x + 10, y: -110, text: '🧰 急救回血', col: '#fb7185' }
        });
      }
    } else if (tutorialSession.subPhase === '7_healed') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 1.40) {
        addPopup('✅ 急救包掌握', player.x + 28, player.y - 96, '#4ade80', 19);
        beginTutorialLesson(8);
      }
    }
    return;
  }

  if (st === 8) {
    if (tutorialSession.subPhase === 'approach') {
      if (tutorialSession.targetX - player.x <= 125 && player.onGround) {
        pauseForTutorialPrompt('hyper', {
          badge: '进阶 8/10',
          title: '【☄️ 霸王冲刺】无敌铺桥并撞爆运钞车',
          main: '',
          cta: pc ? '👉 按住【Shift】霸王冲刺' : '👉 按住左侧【☄️ 霸王冲刺】',
          callout: { x: tutorialSession.targetX + 210, y: -96, text: '☄️ 无敌撞爆运钞车', col: '#fde047' }
        });
      }
    } else if (tutorialSession.subPhase === '8_dashing') {
      store.save.dashEnergy = 20;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 2.05) {
        forceStopHyperDash();
        tutorialSession.subPhase = '8_after_dash';
        tutorialSession.phaseTimer = 0;
        addPopup('✅ 霸王冲刺掌握', player.x + 32, player.y - 98, '#fde047', 20);
      }
    } else if (tutorialSession.subPhase === '8_after_dash') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.70) {
        beginTutorialLesson(9);
      }
    }
    return;
  }

  if (st === 9) {
    if (tutorialSession.subPhase === 'approach') {
      if (activeBoss) activeBoss.worldX = player.x + 370;
      const wave = enemyShots.find((s) => s.isTutBossWave && !s.dead);
      if (wave && wave.x - player.x <= 125 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '首领 9/10 (1/3)',
          title: '首领地面刺轮：起跳躲开',
          main: '',
          cta: pc ? '👉 按【空格】跃过刺轮' : '👉 点【⬆️ 起跳】跃过刺轮',
          callout: { x: wave.x, y: -76, text: '⬆️ 起跳躲避', col: '#38bdf8' }
        });
      }
    } else if (tutorialSession.subPhase === '9A_jumped') {
      if (activeBoss) activeBoss.worldX = player.x + 340;
      const wave = enemyShots.find((s) => s.isTutBossWave && !s.dead);
      if ((!wave || player.x > wave.x + 55) && player.onGround) {
        tutorialSession.subPhase = '9B_swoop';
        tutorialSession.phaseTimer = 0;
        enemyShots.length = 0;
      }
    } else if (tutorialSession.subPhase === '9B_swoop' && activeBoss) {
      activeBoss.mech = 'swoop_dive';
      activeBoss.mechSub = 1;
      activeBoss.mechTimer = 5.0;
      const targetBossX = player.x + 152;
      activeBoss.worldX = Math.max(targetBossX, activeBoss.worldX + (player.vx - 230) * realDt);
      activeBoss.yOff = -18;
      if (activeBoss.worldX - player.x <= 162 && player.onGround) {
        pauseForTutorialPrompt('action', {
          badge: '首领 9/10 (2/3)',
          title: '首领发光猛扑：【🐔 铁山靠】破防打晕',
          main: '',
          cta: pc ? '👉 按【左键 / J】破防打晕' : '👉 点【🐔 铁山靠】破防打晕',
          callout: { x: activeBoss.worldX, y: -125, text: '🐔 铁山靠打晕', col: '#fde047' }
        });
      }
    } else if (tutorialSession.subPhase === '9B_parried' && activeBoss) {
      activeBoss.stunTimer = 8.0;
      activeBoss.worldX = player.x + 158;
      activeBoss.yOff = 0;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.90 && player.onGround) {
        tutorialSession.subPhase = '9C_wait_skill';
        player.skillCd = 0;
        player.flameFuel = 100;
        syncControlsUI();
        pauseForTutorialPrompt('skill', {
          badge: '首领 9/10 (3/3)',
          title: '趁首领眩晕开大招，享 140% 暴击',
          main: '',
          cta: pc ? '👉 按【右键 / K】暴击首领' : `👉 点【${h.skillIcon || '✨'} ${h.skillLbl}】暴击`,
          callout: { x: activeBoss.worldX, y: -125, text: '💫 眩晕 140% 暴击', col: '#c084fc' }
        });
      }
    } else if (tutorialSession.subPhase === '9C_cast') {
      if (activeBoss) {
        activeBoss.worldX = player.x + 162;
        activeBoss.yOff = 0;
        tutorialSession.phaseTimer += realDt;
        if (tutorialSession.phaseTimer >= 0.55 && activeBoss.phase < 2) {
          hitBoss(65, false, false, true);
        }
        if (activeBoss.phase >= 2 && tutorialSession.phaseTimer >= 1.55) {
          beginTutorialLesson(10);
        }
      }
    }
    return;
  }

  if (st === 10) {
    if (tutorialSession.subPhase === 'approach' && activeBoss) {
      activeBoss.worldX = player.x + 210;
      activeBoss.yOff = 0;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.25 && player.onGround) {
        store.save.dashEnergy = 20;
        syncControlsUI();
        pauseForTutorialPrompt('hyper', {
          badge: '决战 10/10 (1/2)',
          title: '首领狂暴：按住【☄️ 霸王冲刺】强推削血',
          main: '',
          cta: pc ? '👉 按住【Shift】壁垒压制' : '👉 按住左侧【☄️ 霸王冲刺】',
          callout: { x: activeBoss.worldX, y: -125, text: '☄️ 壁垒压制首领', col: '#ef4444' }
        });
      }
    } else if (tutorialSession.subPhase === '10_pinning') {
      store.save.dashEnergy = 20;
      tutorialSession.phaseTimer += realDt;
      if (activeBoss && activeBoss.hp > 16) {
        activeBoss.hp = Math.max(16, activeBoss.hp - 42 * realDt);
        refreshBossHudUI();
      }
      if (tutorialSession.phaseTimer >= 1.40) {
        forceStopHyperDash();
        tutorialSession.subPhase = '10_finish_paused';
        tutorialSession.phaseTimer = 0;
        player.skillCd = 0;
        player.flameFuel = 100;
        if (activeBoss) {
          activeBoss.hp = Math.min(activeBoss.hp, 14);
          activeBoss.stunTimer = 8.0;
          activeBoss.worldX = player.x + 150;
          activeBoss.yOff = 0;
          refreshBossHudUI();
        }
        syncControlsUI();
        pauseForTutorialPrompt('both_atk', {
          badge: '决战 10/10 (2/2)',
          title: '首领残血：铁山靠或大招完成斩杀',
          main: '',
          cta: pc ? '👉 按【左键 / 右键】斩杀首领' : '👉 点【🐔 铁山靠 / 大招】斩杀',
          callout: activeBoss ? { x: activeBoss.worldX, y: -125, text: '⚡ 最后一击', col: '#fde047' } : null
        });
      }
    } else if (tutorialSession.subPhase === '10_finish_cast') {
      player.skillCd = 0;
      if (h.id === 'nailong') player.flameFuel = Math.max(player.flameFuel, 85);
      if (activeBoss) {
        activeBoss.stunTimer = Math.max(activeBoss.stunTimer, 2.0);
        activeBoss.worldX = player.x + 150;
        activeBoss.yOff = 0;
      } else if (tutorialSession.bossSpawned && tutorialSession.graduatingTimer <= 0) {
        tutorialSession.graduatingTimer = 1.65;
        setTutorialCoachDisplay({ badge: '🎉 教学完成', title: '✅ 全部基础与首领机制已掌握', main: '', cta: '', paused: false });
      }
    }
  }
}

function startNewRun(heroId, startDistMeters = 0, boostMeters = 0, devJumpRun = false) {
  clearTutorialSpotlights();
  ensureAudio();
  const s = store.save;
  activeRunHeroId = heroId || s.selectedHero;
  const h = getHero();
  activeRunOwner = getActiveAccountOwnerTag();
  activeRunStartMs = Date.now();
  activeRunLogged = false;

  const initDist = Math.max(0, Math.floor(Number(startDistMeters) || 0));
  runStartDist = devJumpRun ? 0 : initDist;
  prevBestSingleRun = s.bestSingleRun || 0;
  runStats = {
    dist: initDist,
    singleRunDist: devJumpRun ? initDist : 0,
    beans: 0,
    bossKills: 0,
    reviveUsed: false,
    healBuysUsed: 0,
    deathDashMeters: 0,
    deathDashUsed: false,
    isDevTestRun: Boolean(devJumpRun)
  };
  deathDashActive = false;
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
  bossCycleCount = devJumpRun ? Math.min(5, Math.floor(initDist / 1200)) : 0;
  lastThreatTier = getSurvivalGradient(runStats.singleRunDist).kmMilestone || 1;
  pendingShare = null;
  if (reviveStatusHint) reviveStatusHint.classList.add('hidden-block');
  nextBossDist = initDist + (devJumpRun ? 240 : 150);
  nextTruckDist = initDist + 145;
  nextPropDist = initDist + 58;
  runStats.firstSkyPropSpawned = false;
  nextShieldDist = initDist + 290;
  nextHealDist = initDist + 360;
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
  player.vx = player.baseSpeed + getSurvivalGradient(runStats.singleRunDist).speedAdd;
  player.boostTimer = 0; player.giantTimer = 0; player.magnetTimer = 0; player.rocketDashTimer = 0;
  player.hyperDashHolding = false; player.hyperDashActive = false; player.hyperSessionSec = 0;
  player.mortarTimer = 0; player.mortarShotTick = 0;
  player.sawShieldCharges = 0; player.tempShieldHp = 0; player.tempShieldTimer = 0;
  player.angle = 0; player.onGround = true; player.onRail = null;
  player.coyoteTimer = 0; player.jumpBufferTimer = 0;
  player.maxHp = getHeroMaxHpFromSave(s, h.id);
  player.hp = player.maxHp;
  player.regenPool = 0;
  player.dotPool = 0;
  player.autoRegenTimer = 5.0;
  player.displayHp = player.maxHp;
  player.trailHp = player.maxHp;
  hpTrailFill.style.width = '100%';
  hpMainFill.style.width = '100%';
  player.jumpsLeft = h.id === 'hakimi' ? 4 : 2;
  player.invulnTimer = 1.0; player.hurtPoseTimer = 0;
  player.strikeTimer = 0; player.actionCd = 0; player.actionMaxCd = 0.64;
  player.parryWindowTimer = 0; player.actionBufferTimer = 0;
  player.whiffStreak = 0; player.whiffResetTimer = 0; player.actionOverheat = false;
  player.strikeHitCount = 0; player.strikeConnected = false;
  player.skillCd = 0; player.skillMaxCd = h.skillCd || 3.0; player.skillHeld = false;
  player.flameHolding = false; player.flameBurstTimer = 0; player.flameFuel = 100;
  player.swallowVortexTimer = 0; player.swallowedCount = 0;
  player.thunderTongueTimer = 0; player.thunderTongueAngle = 0; player.thunderBossTick = 0;
  player.weaponId = null; player.weaponTimer = 0;
  player.mountId = null; player.mountTimer = 0;
  player.orbitSawTimer = 0;
  player.midasTimer = 0; player.thunderAuraTimer = 0; player.thunderAuraTick = 0; player.skyWingsTimer = 0;
  player.ringBoostTimer = 0; player.ringBoostGold = false;
  player.slashLines = [];

  pits = []; mudZones = []; iceZones = []; snowballs = []; lilyPads = []; catapults = []; backboards = [];
  barrels = []; hangers = []; bells = []; geysers = []; laserGates = [];
  rails = []; pendulums = []; skyLightnings = []; skyRings = []; skyBumpers = []; checkpointFlags = []; worldProps = []; cashTrucks = [];
  beans = []; enemies = []; projectiles = []; enemyShots = []; bossHazards = [];
  flamePuffs = []; speedLines = []; roadScars = []; shockwaves = [];
  flyingDebris = []; popups = []; hyperGhosts = [];

  // Plant Golden Personal-Best Record Flagpole on the road!
  if (!devJumpRun && prevBestSingleRun >= 25) {
    recordFlag = {
      x: 120 + (runStartDist + prevBestSingleRun) * 18,
      singleDist: prevBestSingleRun,
      passed: false
    };
  } else {
    recordFlag = null;
  }

  // Immediate Multi-Tier Staggered Sky Combat & Pendulum Gauntlet right from run start (100% inside camera viewport!)
  const openX = player.x + 320;
  for (let i = 0; i < 6; i++) {
    const bx = openX - 30 + i * 40;
    const arc = Math.sin((i / 5) * Math.PI) * 86;
    beans.push({ x: bx, y: getBaseSurfaceY(bx) - 46 - arc, val: 1, giant: i === 3, taken: false });
  }
  enemies.push({ x: openX + 65, kind: 'dribbler', hit: false, phase: 0 });
  enemies.push({ x: openX + 125, kind: 'pelican_guard', hit: false, phase: 1.1 });
  laserGates.push({ x: openX + 295, hacked: false });
  // Visible Low/Mid/High Pendulums + Storm Lightning + Aerial Enemy Formation right ahead!
  rails.push({ x: openX + 85, len: 88, hOff: 130, kind: 'suspenders', energizedTimer: 0 });
  addSkyPendulum(openX + 235, { pivotH: 238, armLen: 132, maxAng: 0.72, omega: 2.38, phase: 0.4, style: 'wrecking' });
  addSkyBumper(openX + 345, 138, 0);
  addSkyLightning(openX + 430, 335, openX + 430, 108, { kind: 'storm_strike', period: 1.68, phase: 0.35 });
  spawnAerialDronePair(openX + 365, initDist >= 5000 ? 5 : 3, Math.max(2, getSurvivalGradient(runStats.singleRunDist).tier));
  addSkyPendulum(openX + 545, { pivotH: 326, armLen: 138, maxAng: 0.72, omega: 2.45, phase: 2.2, style: 'hammer' });
  rails.push({ x: openX + 635, len: 88, hOff: 238, kind: 'sky_gold', energizedTimer: 0 });
  addSkyLightning(openX + 735, 318, openX + 805, 165, { kind: 'tesla_arc', period: 1.65, phase: 1.05 });
  addSkyPendulum(openX + 855, { pivotH: 252, armLen: 136, maxAng: 0.74, omega: 2.50, phase: 3.9, style: 'wrecking' });
  spawnAerialDronePair(openX + 685, initDist >= 5000 ? 5 : 3, Math.max(2, getSurvivalGradient(runStats.singleRunDist).tier));

  player.skyZoneStage = initDist >= 3000 ? 2 : (initDist >= 1500 ? 1 : 0);
  nextSpawnX = openX + 900;

  hubOverlay.classList.add('hidden');
  state = 'PLAYING';
  player.airCampSec = 0;
  playSfx('crate');

  if (preSelectedDeathBoost > 0) {
    const dCost = preSelectedDeathBoost >= 800 ? 2000 : 1000;
    if (s.beans >= dCost) {
      s.beans -= dCost;
      runStats.deathDashMeters = preSelectedDeathBoost;
      store.markMutatedAndSave(true);
    } else {
      showToast('🌿 绿豆不足以激活死亡冲刺');
    }
    preSelectedDeathBoost = 0;
  }

  if (boostMeters > 0) {
    const cost = boostMeters >= 800 ? 2000 : 1000;
    if (!activateHeadStartBoost(boostMeters, cost)) showToast(STAGES[stageIndex].name);
    preSelectedBoost = 0;
  } else {
    showToast(STAGES[stageIndex].name);
    if (s.beans >= 1000) {
      quickDashWindowTimer = 3.8;
      quickDashWrap.classList.remove('hidden');
    } else {
      quickDashWrap.classList.add('hidden');
    }
  }

  refreshBuffChips();
  syncControlsUI();
  updateTopHUD();
  saveLivePveRunSnapshot();
}

const hudHealBtn = document.getElementById('hudHealBtn');
const hudHealLbl = document.getElementById('hudHealLbl');
const pauseHealStock = document.getElementById('pauseHealStock');
const pauseBuyHealBtn = document.getElementById('pauseBuyHealBtn');
const goDeathDashRow = document.getElementById('goDeathDashRow');
const goDeath400Btn = document.getElementById('goDeath400Btn');
const goDeath800Btn = document.getElementById('goDeath800Btn');

// Unlimited Medkit with Fibonacci Escalating Cost:
// [1, 2, 3, 5, 8, 13, 21, 34, 55...] * 5000 -> 5000, 10000, 15000, 25000, 40000, 65000, 105000...
function getMedkitFibonacciCost(usedCount) {
  const n = Math.max(0, Math.floor(Number(usedCount) || 0));
  if (n === 0) return 5000;
  if (n === 1) return 10000;
  let a = 1, b = 2;
  for (let i = 2; i <= n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b * 5000;
}

function formatBeansShort(val) {
  const n = Math.max(0, Math.floor(Number(val) || 0));
  if (n < 10000) return String(n);
  const w = n / 10000;
  return `${Number.isInteger(w) ? w : +w.toFixed(1)}w`;
}

const QUICK_HEAL_MAX_USES = 3;

function refreshHealSupplyUI() {
  const used = runStats.healBuysUsed || 0;
  const cost = getMedkitFibonacciCost(used);
  const costStr = formatBeansShort(cost);
  const unbanked = (runStats && !runStats.isDevTestRun) ? Math.max(0, (runStats.beans || 0) - bankedRunBeans) : 0;
  const totalBeans = (store.save.beans || 0) + unbanked;
  const isFullHp = player.hp >= Math.max(1, player.maxHp) - 0.5;
  const quickLocked = !tutorialSession.active && used >= QUICK_HEAL_MAX_USES;
  if (hudHealBtn) {
    const lblEl = hudHealLbl || hudHealBtn;
    let btnTxt = `急救包 +100 (${costStr}🌿)`;
    if (tutorialSession.active) {
      btnTxt = '急救包 +100 (教学免费)';
    } else if (quickLocked) {
      btnTxt = `🔒 防误触·点暂停买 (${costStr}🌿)`;
    } else if (totalBeans < cost) {
      btnTxt = `急救包 缺🌿(${formatBeansShort(totalBeans)}/${costStr})`;
    } else if (isFullHp) {
      btnTxt = `急救包 满血 (${costStr}🌿)`;
    }
    setTextCached('hHealTxt', lblEl, btnTxt);
    const lowBeans = !tutorialSession.active && !quickLocked && totalBeans < cost;
    const fullNow = !tutorialSession.active && !quickLocked && totalBeans >= cost && isFullHp;
    if (uiCache.hHealUsed !== quickLocked) { uiCache.hHealUsed = quickLocked; hudHealBtn.classList.toggle('used-up', quickLocked); }
    if (uiCache.hHealLow !== lowBeans) { uiCache.hHealLow = lowBeans; hudHealBtn.classList.toggle('low-beans', lowBeans); }
    if (uiCache.hHealFull !== fullNow) { uiCache.hHealFull = fullNow; hudHealBtn.classList.toggle('full-hp', fullNow); }
  }
  if (pauseHealStock) {
    pauseHealStock.textContent = used >= QUICK_HEAL_MAX_USES
      ? `已用 ${used} 次 · 快捷已锁防误触`
      : `快捷剩 ${QUICK_HEAL_MAX_USES - used}/3 · 暂停不限次`;
  }
  if (pauseBuyHealBtn) {
    pauseBuyHealBtn.textContent = totalBeans >= cost
      ? `💚 立即回100血 (${cost.toLocaleString()}🌿)`
      : `🌿 绿豆不足 (${totalBeans.toLocaleString()}/${cost.toLocaleString()})`;
    pauseBuyHealBtn.style.opacity = totalBeans >= cost ? '1' : '0.65';
  }
}

function triggerMedkitDenyFeedback(toastMsg, popMsg, popCol = '#fde047') {
  playSfx('bean');
  showToast(toastMsg);
  if (state === 'PLAYING') {
    addPopup(popMsg, player.x + 24, player.y - 102, popCol, 17);
  }
  if (hudHealBtn) {
    hudHealBtn.classList.remove('deny-shake');
    void hudHealBtn.offsetWidth;
    hudHealBtn.classList.add('deny-shake');
  }
}

let lastMedkitTriggerMs = 0;
function tryBuyInRunHealSupply(source = 'quick') {
  const nowMs = performance.now();
  if (nowMs - lastMedkitTriggerMs < 200) return;
  lastMedkitTriggerMs = nowMs;

  if (partyCtrl && partyCtrl.isActive()) return;
  if (state !== 'PLAYING' && state !== 'PAUSED') return;
  if (tutorialSession.active) {
    if (!tryConsumeTutorialInput('heal')) return;
    ensureAudio();
    player.invulnTimer = 1.2;
    healPlayer(100, 1.0, true);
    playSfx('crate');
    addPopup('💊 教学免费急救 +100HP!!', player.x + 28, player.y - 108, '#4ade80', 20);
    updateTopHUD();
    return;
  }
  ensureAudio();
  const used = runStats.healBuysUsed || 0;
  const cost = getMedkitFibonacciCost(used);
  if (source === 'quick' && used >= QUICK_HEAL_MAX_USES) {
    triggerMedkitDenyFeedback(
      `🔒 本局快捷急救已满 3 次（防高价误触）！如需购买 (${formatBeansShort(cost)}🌿) 请点右上角【⏸️暂停】`,
      '🔒 满3次禁快捷买·点暂停!',
      '#fbbf24'
    );
    return;
  }
  if (player.hp >= player.maxHp - 0.5) {
    triggerMedkitDenyFeedback('💚 当前生命已满，掉血后再用急救包！', '💚 当前满血无需急救!', '#86efac');
    return;
  }
  bankRunProgress(false);
  const s = store.save;
  if (s.beans < cost) {
    triggerMedkitDenyFeedback(`🌿 绿豆不足 (${s.beans}/${cost})，本次需 ${cost}🌿！`, `🌿 需 ${formatBeansShort(cost)}豆!`, '#fbbf24');
    return;
  }
  s.beans -= cost;
  runStats.healBuysUsed = used + 1;
  const nextCost = getMedkitFibonacciCost(runStats.healBuysUsed);
  player.invulnTimer = Math.max(player.invulnTimer, 0.65);
  healPlayer(100, 0.75, true);
  if (!runStats.isDevTestRun) {
    store.markMutatedAndSave(true);
  }
  playSfx('crate');
  showToast(`💊 急救 +100HP（耗 ${formatBeansShort(cost)}🌿 · 下次 ${formatBeansShort(nextCost)}🌿）`);
  refreshHealSupplyUI();
  refreshPauseHyperShopUI(false);
  updateTopHUD();
}

if (hudHealBtn) {
  hudHealBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  hudHealBtn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    hudHealBtn.classList.add('pressed');
    tryBuyInRunHealSupply('quick');
  });
  const clearHealPress = () => hudHealBtn.classList.remove('pressed');
  hudHealBtn.addEventListener('pointerup', clearHealPress);
  hudHealBtn.addEventListener('pointercancel', clearHealPress);
  hudHealBtn.addEventListener('pointerleave', clearHealPress);
  hudHealBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tryBuyInRunHealSupply('quick');
  });
}
if (pauseBuyHealBtn) {
  pauseBuyHealBtn.addEventListener('click', () => {
    tryBuyInRunHealSupply('pause');
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
  const inParty = Boolean(partyCtrl && partyCtrl.isActive());
  if (inParty && !pauseOverlay.classList.contains('hidden')) {
    resumeFromPause();
    return;
  }
  jumpHeld = false;
  onActionRelease();
  if (inParty && partyCtrl.setStaminaHeld) partyCtrl.setStaminaHeld(false);

  const pauseStatRow = pauseDistStat ? pauseDistStat.parentElement : null;
  const healShopParent = pauseBuyHealBtn ? pauseBuyHealBtn.parentElement : null;
  if (healShopParent) healShopParent.classList.toggle('hidden-block', inParty);
  if (pauseHyperShopBox) pauseHyperShopBox.classList.toggle('hidden-block', inParty);
  if (pauseRestartBtn) pauseRestartBtn.classList.toggle('hidden-block', inParty);
  if (pauseStatRow) pauseStatRow.classList.toggle('hidden-block', inParty);

  if (inParty) {
    // Real-time simultaneous multiplayer NEVER freezes the world (`state` stays 'PLAYING')!
    if (pauseModalTitle) pauseModalTitle.textContent = '🏁 实时竞速中 (不暂停)';
    if (pauseResumeBtn) pauseResumeBtn.textContent = '▶️ 返回比赛';
    if (pauseExitBtn) pauseExitBtn.textContent = '🏳️ 认输退出';
    pauseOverlay.classList.remove('hidden');
    return;
  }

  state = 'PAUSED';
  forceStopHyperDash();
  pauseBossBgm();
  bankRunProgress(true);
  if (pauseModalTitle) {
    pauseModalTitle.textContent = wantHyperShop ? '☄️ 超级霸王究极冲刺 · 局内补给' : '⏸️ 游戏暂停';
  }
  if (pauseResumeBtn) pauseResumeBtn.textContent = '▶️ 继续游戏';
  if (pauseExitBtn) pauseExitBtn.textContent = '🏠 结算退出';
  refreshPauseHyperShopUI(wantHyperShop);
  pauseOverlay.classList.remove('hidden');
}

if (pauseBuyHyperBtn) {
  pauseBuyHyperBtn.addEventListener('click', () => {
    ensureAudio();
    const s = store.save;
    const curE = Math.min(30, Math.max(0, Number(s.dashEnergy) || 0));
    if (curE >= 29.95) {
      showToast('✨ 超级霸王究极冲刺已满 (3/3)!');
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
  if (state !== 'PAUSED' && pauseOverlay.classList.contains('hidden')) return;
  const wasPaused = (state === 'PAUSED');
  pauseOverlay.classList.add('hidden');
  if (pauseResumeBtn) pauseResumeBtn.textContent = '▶️ 继续游戏';
  if (wasPaused) {
    state = 'PLAYING';
    player.invulnTimer = Math.max(player.invulnTimer, 1.2);
    resumeBossBgmIfNeeded(Boolean(activeBoss) && superBonusTimer <= 0);
  }
}

// ==================== PVE LIVE RUN SNAPSHOT (F5 PAGE REFRESH AUTO-RESUME) ====================
const PVE_LIVE_SNAPSHOT_KEY = 'pelican_live_pve_run_v1';

function saveLivePveRunSnapshot() {
  if (tutorialSession.active || (partyCtrl && partyCtrl.isActive())) return;
  if (state !== 'PLAYING' && state !== 'PAUSED') return;
  if (getActiveAccountOwnerTag() !== activeRunOwner) return;
  try {
    sessionStorage.setItem(PVE_LIVE_SNAPSHOT_KEY, JSON.stringify({
      owner: activeRunOwner,
      heroId: activeRunHeroId || store.save.selectedHero || 'nailong',
      x: Math.round(player.x),
      dist: runStats.dist || 0,
      singleRunDist: runStats.singleRunDist || 0,
      runStartDist: runStartDist || 0,
      prevBestSingleRun: prevBestSingleRun || 0,
      beans: runStats.beans || 0,
      bankedRunBeans: bankedRunBeans || 0,
      bossKills: runStats.bossKills || 0,
      hp: Math.max(1, Math.round(player.hp || player.maxHp || 100)),
      maxHp: Math.max(1, Math.round(player.maxHp || 100)),
      stageIndex: stageIndex || 0,
      superCharge: Math.round((superCharge || 0) * 10) / 10,
      reviveUsed: Boolean(runStats.reviveUsed),
      healBuysUsed: runStats.healBuysUsed || 0,
      deathDashUsed: Boolean(runStats.deathDashUsed),
      activeRunStartMs: activeRunStartMs || Date.now(),
      ts: Date.now()
    }));
  } catch (_) {}
}

function clearLivePveRunSnapshot() {
  try { sessionStorage.removeItem(PVE_LIVE_SNAPSHOT_KEY); } catch (_) {}
}

function tryRestoreLivePveRunSnapshot() {
  try {
    const raw = sessionStorage.getItem(PVE_LIVE_SNAPSHOT_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (!snap || !snap.ts || Date.now() - snap.ts > 30 * 60 * 1000) {
      clearLivePveRunSnapshot();
      return false;
    }
    const curOwner = getActiveAccountOwnerTag();
    if (snap.owner !== curOwner) {
      clearLivePveRunSnapshot();
      return false;
    }
    if ((snap.singleRunDist || 0) < 3 && (snap.beans || 0) < 1) {
      clearLivePveRunSnapshot();
      return false;
    }

    startNewRun(snap.heroId || store.save.selectedHero || 'nailong', snap.runStartDist || 0, 0);
    quickDashWindowTimer = 0;
    if (quickDashWrap) quickDashWrap.classList.add('hidden');

    activeRunOwner = curOwner;
    activeRunStartMs = snap.activeRunStartMs || Date.now();
    activeRunLogged = false;
    runStartDist = Math.max(0, Number(snap.runStartDist) || 0);
    prevBestSingleRun = Math.max(0, Number(snap.prevBestSingleRun) || store.save.bestSingleRun || 0);
    bankedRunBeans = Math.max(0, Number(snap.bankedRunBeans) || 0);
    runStats.dist = Math.max(runStartDist, Number(snap.dist) || 0);
    runStats.singleRunDist = Math.max(0, Number(snap.singleRunDist) || 0);
    runStats.beans = Math.max(bankedRunBeans, Number(snap.beans) || 0);
    runStats.bossKills = Math.max(0, Number(snap.bossKills) || 0);
    runStats.reviveUsed = Boolean(snap.reviveUsed);
    runStats.healBuysUsed = Math.max(0, Number(snap.healBuysUsed) || 0);
    runStats.deathDashUsed = Boolean(snap.deathDashUsed);

    player.x = Math.max(120 + runStats.dist * 18, Number(snap.x) || 120);
    player.y = getBaseSurfaceY(player.x);
    smoothCamRefY = player.y;
    player.maxHp = Math.max(50, Number(snap.maxHp) || getHeroMaxHpFromSave(store.save, activeRunHeroId));
    player.hp = Math.min(player.maxHp, Math.max(1, Number(snap.hp) || player.maxHp));
    player.displayHp = player.hp;
    player.trailHp = player.hp;
    player.invulnTimer = 2.4;
    superCharge = Math.min(99, Math.max(0, Number(snap.superCharge) || 0));
    stageIndex = Math.floor(runStats.dist / STAGE_SPAN_M) % STAGES.length;
    prevStageIndex = stageIndex;

    pits.length = 0; mudZones.length = 0; iceZones.length = 0; snowballs.length = 0;
    enemies.length = 0; laserGates.length = 0; rails.length = 0; beans.length = 0;
    pendulums.length = 0; skyRings.length = 0; skyBumpers.length = 0;
    worldProps.length = 0; cashTrucks.length = 0; enemyShots.length = 0;
    nextSpawnX = player.x + 340;
    nextBossDist = runStats.dist + 140;
    nextTruckDist = runStats.dist + 160;
    nextPropDist = runStats.dist + 55;
    nextShieldDist = runStats.dist + 240;
    nextHealDist = runStats.dist + 320;
    nextFlagDist = (Math.floor(runStats.dist / 500) + 1) * 500;
    if (prevBestSingleRun >= 25 && runStats.singleRunDist < prevBestSingleRun) {
      recordFlag = {
        x: 120 + (runStartDist + prevBestSingleRun) * 18,
        singleDist: prevBestSingleRun,
        passed: false
      };
    } else {
      recordFlag = null;
    }
    spawnWorldAhead();
    refreshHealSupplyUI();
    updateTopHUD();
    syncControlsUI();
    pauseGame(false);
    if (pauseModalTitle) pauseModalTitle.textContent = `🔄 已恢复刷新前进度（${runStats.singleRunDist}m）`;
    showToast(`🔄 已无缝恢复刷新前的闯关进度（${runStats.singleRunDist}m）！`);
    return true;
  } catch (_) {
    clearLivePveRunSnapshot();
    return false;
  }
}

function openGameOverModal() {
  stopBossBgm();
  clearLivePveRunSnapshot();
  const curSingle = runStats.singleRunDist;
  const isNewRecord = curSingle > prevBestSingleRun && curSingle >= 15;
  bankRunProgress(true);
  if (!activeRunLogged && !tutorialSession.active && !(partyCtrl && partyCtrl.isActive()) && curSingle >= 5) {
    activeRunLogged = true;
    logFinishedRun({ mode: 'pve', extraNote: lastDamageMeta.cause || 'gameover' });
  }

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
  if (goDeathCauseTxt) goDeathCauseTxt.textContent = `💀 终结原因：${lastDamageMeta.cause || '赛道冲撞'}`;
  if (goDeathTipTxt) goDeathTipTxt.textContent = `💡 反制攻略：${lastDamageMeta.tip || '善用铁山靠（左键/J）可撞飞护盾怪并弹反飞行物！'}`;

  if (!runStats.reviveUsed) {
    reviveShareCard.classList.remove('hidden-block');
    reviveUsedNote.classList.add('hidden-block');
  } else {
    reviveShareCard.classList.add('hidden-block');
    reviveUsedNote.classList.remove('hidden-block');
  }

  if (goDeathDashRow) {
    if (!runStats.deathDashUsed) {
      goDeathDashRow.classList.remove('hidden-block');
      if (goDeath400Btn) goDeath400Btn.style.opacity = store.save.beans >= 1000 ? '1' : '0.5';
      if (goDeath800Btn) goDeath800Btn.style.opacity = store.save.beans >= 2000 ? '1' : '0.5';
    } else {
      goDeathDashRow.classList.add('hidden-block');
    }
  }

  gameOverOverlay.classList.remove('hidden');
}

function triggerPostDeathDashFromModal(meters, cost) {
  if (state !== 'GAMEOVER' || runStats.deathDashUsed) return;
  ensureAudio();
  const s = store.save;
  if (s.beans < cost) {
    showToast(`🌿 绿豆不足 (需 ${cost}🌿)！`);
    return;
  }
  s.beans -= cost;
  store.markMutatedAndSave(true);
  runStats.deathDashUsed = true;
  deathDashActive = true;
  gameOverOverlay.classList.add('hidden');
  headStartTargetDist = runStats.dist + meters;
  player.hp = 1;
  player.regenPool = 0;
  player.dotPool = 0;
  player.invulnTimer = 25;
  player.angle = 0;
  enemyShots.length = 0;
  bossHazards.length = 0;
  state = 'PLAYING';
  playSfx('hyper');
  showToast(`🔥 死亡终极冲刺 ${meters}m 爆发！！`);
  refreshBuffChips();
  updateTopHUD();
}

if (goDeath400Btn) goDeath400Btn.addEventListener('click', () => triggerPostDeathDashFromModal(400, 1000));
if (goDeath800Btn) goDeath800Btn.addEventListener('click', () => triggerPostDeathDashFromModal(800, 2000));

// ==================== SIMPLE IN-PAGE SHARE IMAGE & LINK MODAL + READY-TO-START REVIVE ====================
let pendingShare = null;
let currentShareMode = 'hub'; // 'hub' | 'revive'

const shareOverlay = document.getElementById('shareOverlay');
const shareCloseBtn = document.getElementById('shareCloseBtn');
const shareSaveImgBtn = document.getElementById('shareSaveImgBtn');
const shareCopyLinkBtn = document.getElementById('shareCopyLinkBtn');
const shareReviveReadyBtn = document.getElementById('shareReviveReadyBtn');
const shareSavedHint = document.getElementById('shareSavedHint');
const inPageSharePosterImg = document.getElementById('inPageSharePosterImg');
const goOpenShareBtn = document.getElementById('goOpenShareBtn');
const SHARE_GAME_URL = 'https://nailong.openwaifu-agent.uk';

function openCleanShareModal(mode = 'hub') {
  ensureAudio();
  playSfx('crate');
  currentShareMode = mode;
  if (shareSavedHint) {
    shareSavedHint.textContent = mode === 'revive'
      ? '保存分享图或复制链接，即可解锁本局满血复活！'
      : '支持保存二维码分享图或直接复制游戏链接';
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

function copyShareGameLink() {
  ensureAudio();
  playSfx('crate');
  const shareText = `快来挑战《鹈鹕测试大乱斗》！在线即玩：${SHARE_GAME_URL}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareText).catch(() => {});
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = shareText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) {}
  }
  if (currentShareMode === 'revive' && state === 'GAMEOVER' && !runStats.reviveUsed) {
    if (shareSavedHint) shareSavedHint.textContent = '✅ 游戏链接已复制！准备好后点击下方按钮满血复活！';
    if (shareReviveReadyBtn) shareReviveReadyBtn.classList.remove('hidden-block');
  } else {
    if (shareSavedHint) shareSavedHint.textContent = `✅ 已复制分享链接：${SHARE_GAME_URL}`;
    showToast('🔗 分享链接已复制！');
  }
}

if (goOpenShareBtn) {
  goOpenShareBtn.addEventListener('click', () => openCleanShareModal('revive'));
}
if (shareSaveImgBtn) {
  shareSaveImgBtn.addEventListener('click', saveSharePosterPng);
}
if (shareCopyLinkBtn) {
  shareCopyLinkBtn.addEventListener('click', copyShareGameLink);
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
  if (state === 'PLAYING') {
    forceStopHyperDash();
    if (partyCtrl && partyCtrl.setStaminaHeld) partyCtrl.setStaminaHeld(false);
  }
});

function finishRunAndOpenHub() {
  clearTutorialSpotlights();
  clearLivePveRunSnapshot();
  stopBossBgm();
  bankRunProgress(true);
  if (!activeRunLogged && !tutorialSession.active && !(partyCtrl && partyCtrl.isActive()) && (runStats.singleRunDist || 0) >= 5) {
    activeRunLogged = true;
    logFinishedRun({ mode: 'pve', extraNote: 'hub_exit' });
  }
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
  maybeShowStrongAccountNudge();
}

launchBtn.addEventListener('click', () => {
  startNewRun(store.save.selectedHero, store.save.selectedCheckpoint, preSelectedBoost);
});
pauseBtn.addEventListener('click', () => {
  if (!pauseOverlay.classList.contains('hidden') || state === 'PAUSED') resumeFromPause();
  else if (state === 'PLAYING') pauseGame();
});
pauseResumeBtn.addEventListener('click', resumeFromPause);
pauseCloseX.addEventListener('click', resumeFromPause);
pauseRestartBtn.addEventListener('click', () => {
  pauseOverlay.classList.add('hidden');
  clearLivePveRunSnapshot();
  bankRunProgress(true);
  const wasDev = Boolean(runStats && runStats.isDevTestRun);
  startNewRun(activeRunHeroId, wasDev ? runStats.dist : store.save.selectedCheckpoint, 0, wasDev);
});
pauseExitBtn.addEventListener('click', () => {
  pauseOverlay.classList.add('hidden');
  if (partyCtrl && partyCtrl.isActive()) {
    partyCtrl.exitPartyToHub();
    return;
  }
  finishRunAndOpenHub();
});
goRetryBtn.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  const wasDev = Boolean(runStats && runStats.isDevTestRun);
  startNewRun(activeRunHeroId, wasDev ? runStartDist : store.save.selectedCheckpoint, 0, wasDev);
});
goHubBtn.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  finishRunAndOpenHub();
});
if (goCloseTopBtn) {
  goCloseTopBtn.addEventListener('click', () => {
    gameOverOverlay.classList.add('hidden');
    finishRunAndOpenHub();
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (pendingShare && !pendingShare.leftPage) {
      pendingShare.leftPage = true;
      pendingShare.departedAt = Date.now();
    }
    if (state === 'PLAYING' && !(partyCtrl && partyCtrl.isActive())) pauseGame();
  } else {
    checkPendingShareOnReturn();
  }
});

// ==================== WORLD & PROP SPAWNER (GENEROUS HEAL & CLEAR TELEGRAPHS) ====================
function getStageForWorldX(wx) {
  const d = Math.max(0, (wx - 120) / 18);
  return STAGES[Math.floor(d / STAGE_SPAN_M) % STAGES.length];
}

function addSkyRing(x, hAbove = 154, isGold = false) {
  const ry = getBaseSurfaceY(x);
  skyRings.push({
    x,
    y: ry - hAbove,
    baseY: ry - hAbove,
    hAbove,
    isGold: Boolean(isGold),
    cd: 0,
    spin: (x * 0.013) % 6.28
  });
}

function addSkyBumper(x, hAbove = 116, theme = 0) {
  const ry = getBaseSurfaceY(x);
  skyBumpers.push({
    x,
    y: ry - hAbove,
    baseY: ry - hAbove,
    hAbove,
    cd: 0,
    boing: 0,
    phase: (x * 0.019) % 6.28,
    theme
  });
}

function addSkyPendulum(x, opts = {}) {
  const pivotH = opts.pivotH || 278;
  const armLen = opts.armLen || 138;
  pendulums.push({
    x,
    pivotH,
    armLen,
    maxAng: opts.maxAng || 0.84,
    omega: opts.omega || 2.35,
    phase: opts.phase !== undefined ? opts.phase : Math.random() * 6.28,
    style: opts.style || (Math.random() < 0.55 ? 'hammer' : 'wrecking'),
    bobR: opts.bobR || 29,
    ang: 0,
    bobX: x,
    bobY: getBaseSurfaceY(x) - (pivotH - armLen),
    time: 0,
    deflectedTimer: 0,
    hitCd: 0,
    clangCd: 0,
    syncClock: Boolean(opts.syncClock)
  });
}

function addSkyLightning(x1, h1, x2, h2, opts = {}) {
  skyLightnings.push({
    x1,
    h1,
    x2,
    h2,
    kind: opts.kind || 'storm_strike', // 'storm_strike' | 'tesla_arc'
    period: opts.period || 1.80,
    phase: opts.phase !== undefined ? opts.phase : ((x1 * 0.013) % 1.80),
    time: 0,
    isWarning: false,
    isFiring: false,
    shortCircuitTimer: 0,
    hitCd: 0
  });
}

function spawnAerialDronePair(baseX, count = 3, tier = 1) {
  // Dense Multi-Altitude Aerial Enemy Formations (100% spawn rate — Shooter Drones, Swooping Pelicans & Jetpack Spiky-Cats!)
  const unitCount = tier >= 4 ? Math.max(4, count + 1) : (tier >= 2 ? Math.max(3, count) : Math.max(2, count));
  const altBands = [118, 196, 278, 336];
  for (let d = 0; d < unitCount; d++) {
    const bandIdx = (Math.floor(baseX * 0.013) + d) % (tier >= 2 ? 4 : 3);
    const bandH = altBands[bandIdx];
    const ex = baseX + d * 88 + (d % 2) * 14;
    const roll = ((Math.floor(baseX * 0.03) + d * 7) % 10) / 10;

    if (tier >= 2 && roll < 0.34) {
      // Swooping Sky Interceptor Pelican: rushes horizontally toward player in mid-air!
      enemies.push({
        x: ex + 30,
        kind: 'pelican_guard',
        flyH: bandH,
        skyRushVx: 130 + tier * 28,
        hit: false,
        phase: d * 1.1
      });
    } else if (tier >= 2 && roll >= 0.34 && roll < 0.64) {
      // Jetpack Spiky-Cat Aerial Mine: hovers with rocket flame, cannot be stomped — must parry/skill/dodge!
      enemies.push({
        x: ex,
        kind: 'spiky_cat',
        flyH: Math.max(138, bandH),
        hit: false,
        phase: d * 1.5
      });
    } else if (d % 2 === 1 || tier >= 3) {
      // Armed Sky Shooter Drone: fires aimed projectiles in mid-air!
      enemies.push({
        x: ex + 12,
        kind: 'drone',
        isSkyShooter: true,
        shotDone: false,
        windupTimer: Math.max(0.28, 0.46 - tier * 0.03),
        flyH: bandH + 10,
        hit: false,
        phase: d * 1.4
      });
    } else {
      enemies.push({
        x: ex,
        kind: 'drone',
        flyH: bandH,
        hit: false,
        phase: d * 1.3
      });
    }
  }
}

// Continuous High-Density Multi-Tier Sky Combat & Pendulum/Lightning Scheduler (ZERO empty dead zones, scarce boost rings!):
let skySetpieceSeq = 0;
function getSkyWaveState(chunkDist) {
  if (chunkDist < 120) {
    return { mode: 'none', band: 0, waveIdx: 0, pos: 0 };
  }
  if (chunkDist < 1200) {
    return { mode: 'early_sky', band: 1, waveIdx: Math.floor(chunkDist / 180), pos: chunkDist % 180 };
  }
  return { mode: 'dense', band: chunkDist >= 3000 ? 2 : 1, waveIdx: Math.floor(chunkDist / 200), pos: chunkDist % 200 };
}

function addBeanArcGuide(startX, count, stepX, hStart, hEnd, archLift, goldIdx = -1) {
  for (let i = 0; i < count; i++) {
    if (beans.length >= 290) break;
    const u = count > 1 ? i / (count - 1) : 0.5;
    const bx = startX + i * stepX;
    const h = hStart + (hEnd - hStart) * u + Math.sin(u * Math.PI) * archLift;
    beans.push({
      x: bx,
      y: getBaseSurfaceY(bx) - h,
      val: 1,
      giant: i === goldIdx,
      taken: false
    });
  }
}

function spawnSkySetpieceForChunk(baseX, st, grad, willBePit, chunkDist) {
  const wave = getSkyWaveState(chunkDist);
  if (wave.mode === 'none') {
    return { suppressSkyClutter: false, extraAdvance: 0 };
  }
  const bumperTheme = (st.id === 'cyber' || st.id === 'snow') ? 1 : 0;
  const omega = wave.band >= 2
    ? Math.min(3.25, 2.55 + grad.tier * 0.09)
    : 2.28;
  const ltPeriod = wave.band >= 2 ? 1.48 : 1.72;

  // EARLY SKYWAYS (120m ~ 1200m): Visible Low/Mid Pendulums + Storm Lightning + Aerial Enemies (scarce boost rings!)
  if (wave.mode === 'early_sky') {
    skySetpieceSeq = (skySetpieceSeq + 1) % 120;
    const pat = skySetpieceSeq % 3;
    if (pat === 0) {
      addSkyBumper(baseX + 30, 114, bumperTheme);
      addSkyPendulum(baseX + 155, { pivotH: 238, armLen: 132, maxAng: 0.70, omega, phase: (baseX * 0.009) % 6.28, style: 'hammer' });
      addSkyLightning(baseX + 275, 332, baseX + 275, 108, { kind: 'storm_strike', period: ltPeriod, phase: 0.3 });
      rails.push({ x: baseX + 345, len: 88, hOff: 225, kind: 'sky_gold', energizedTimer: 0 });
      addSkyPendulum(baseX + 478, { pivotH: 325, armLen: 136, maxAng: 0.70, omega, phase: ((baseX * 0.009) + 2.4) % 6.28, style: 'wrecking' });
      return { suppressSkyClutter: false, extraAdvance: 135 };
    }
    if (pat === 1) {
      addSkyPendulum(baseX + 95, { pivotH: 242, armLen: 134, maxAng: 0.70, omega, phase: (baseX * 0.011) % 6.28, style: 'wrecking' });
      addSkyBumper(baseX + 215, 132, bumperTheme);
      addSkyLightning(baseX + 305, 315, baseX + 375, 155, { kind: 'tesla_arc', period: ltPeriod, phase: 0.85 });
      addSkyPendulum(baseX + 455, { pivotH: 332, armLen: 138, maxAng: 0.70, omega, phase: ((baseX * 0.011) + 3.1) % 6.28, style: 'hammer' });
      if (skySetpieceSeq % 6 === 1) addSkyRing(baseX + 545, 245, false);
      return { suppressSkyClutter: false, extraAdvance: 135 };
    }
    rails.push({ x: baseX + 22, len: 84, hOff: 136, kind: 'suspenders', energizedTimer: 0 });
    addSkyLightning(baseX + 148, 325, baseX + 148, 105, { kind: 'storm_strike', period: ltPeriod, phase: 0.5 });
    addSkyPendulum(baseX + 268, { pivotH: 248, armLen: 136, maxAng: 0.72, omega, phase: (baseX * 0.008) % 6.28, style: 'hammer' });
    rails.push({ x: baseX + 365, len: 86, hOff: 242, kind: 'maglev', energizedTimer: 0 });
    addSkyPendulum(baseX + 485, { pivotH: 342, armLen: 136, maxAng: 0.70, omega, phase: ((baseX * 0.008) + 2.7) % 6.28, style: 'wrecking' });
    return { suppressSkyClutter: false, extraAdvance: 140 };
  }

  // CONTINUOUS HIGH-DENSITY GAUNTLETS (>= 1200m, including 5km / 1w / 2w!):
  // All pendulums & lightning placed at h = 95~355px so 100% are clearly visible in main viewport!
  // Zero `suppressSkyClutter` so aerial enemy squads ALWAYS spawn alongside them, and boost rings are scarce!
  skySetpieceSeq = (skySetpieceSeq + 1) % 120;
  const themePick = skySetpieceSeq % 6;

  if (themePick === 0) {
    const p0 = (baseX * 0.009) % 6.28;
    addSkyPendulum(baseX + 75, { pivotH: 236, armLen: 134, maxAng: 0.76, omega, phase: p0, style: 'wrecking' });
    addSkyBumper(baseX + 185, 118, bumperTheme);
    addSkyLightning(baseX + 265, 338, baseX + 265, 104, { kind: 'storm_strike', period: ltPeriod, phase: 0.2 });
    addSkyPendulum(baseX + 365, { pivotH: 322, armLen: 140, maxAng: 0.75, omega, phase: p0 + 2.1, style: 'hammer' });
    rails.push({ x: baseX + 455, len: 88, hOff: 242, kind: 'sky_gold', energizedTimer: 0 });
    addSkyPendulum(baseX + 575, { pivotH: 252, armLen: 136, maxAng: 0.76, omega, phase: p0 + 4.2, style: 'wrecking' });
    addSkyLightning(baseX + 665, 326, baseX + 732, 168, { kind: 'tesla_arc', period: ltPeriod, phase: 0.95 });
    addBeanArcGuide(baseX + 355, 5, 38, 225, 268, 22, 2);
    return { suppressSkyClutter: false, extraAdvance: 185 };
  }

  if (themePick === 1) {
    const p1 = (baseX * 0.011) % 6.28;
    addSkyBumper(baseX + 28, 112, bumperTheme);
    addSkyPendulum(baseX + 138, { pivotH: 244, armLen: 136, maxAng: 0.76, omega, phase: p1, style: 'hammer' });
    addSkyLightning(baseX + 235, 328, baseX + 235, 108, { kind: 'tesla_arc', period: ltPeriod, phase: 0.4 });
    addSkyPendulum(baseX + 338, { pivotH: 338, armLen: 142, maxAng: 0.75, omega, phase: p1 + Math.PI, style: 'wrecking' });
    addSkyBumper(baseX + 432, 188, bumperTheme);
    addSkyLightning(baseX + 508, 348, baseX + 508, 128, { kind: 'storm_strike', period: ltPeriod, phase: 1.05 });
    addSkyPendulum(baseX + 605, { pivotH: 238, armLen: 134, maxAng: 0.76, omega, phase: p1 + 1.9, style: 'hammer' });
    return { suppressSkyClutter: false, extraAdvance: 165 };
  }

  if (themePick === 2) {
    const p2 = (baseX * 0.009) % 6.28;
    rails.push({ x: baseX + 20, len: 84, hOff: 138, kind: 'suspenders', energizedTimer: 0 });
    addSkyPendulum(baseX + 148, { pivotH: 238, armLen: 134, maxAng: 0.75, omega, phase: p2, style: 'hammer' });
    addSkyLightning(baseX + 245, 318, baseX + 312, 148, { kind: 'tesla_arc', period: ltPeriod, phase: 0.3 });
    rails.push({ x: baseX + 345, len: 86, hOff: 228, kind: 'maglev', energizedTimer: 0 });
    addSkyLightning(baseX + 388, 352, baseX + 388, 224, { kind: 'storm_strike', period: ltPeriod, phase: 0.75 });
    addSkyPendulum(baseX + 488, { pivotH: 328, armLen: 140, maxAng: 0.75, omega, phase: p2 + 2.2, style: 'wrecking' });
    addSkyPendulum(baseX + 618, { pivotH: 246, armLen: 136, maxAng: 0.75, omega, phase: p2 + 4.3, style: 'hammer' });
    addSkyRing(baseX + 708, 248, false);
    return { suppressSkyClutter: false, extraAdvance: 195 };
  }

  if (themePick === 3) {
    const p3 = (baseX * 0.01) % 6.28;
    addSkyPendulum(baseX + 68, { pivotH: 232, armLen: 132, maxAng: 0.76, omega, phase: p3, style: 'hammer' });
    addSkyLightning(baseX + 168, 336, baseX + 168, 102, { kind: 'storm_strike', period: ltPeriod, phase: 0.25 });
    rails.push({ x: baseX + 225, len: 88, hOff: 196, kind: 'maglev', energizedTimer: 0 });
    addSkyPendulum(baseX + 348, { pivotH: 318, armLen: 138, maxAng: 0.75, omega, phase: p3 + 2.1, style: 'wrecking' });
    addSkyBumper(baseX + 438, 178, bumperTheme);
    addSkyPendulum(baseX + 538, { pivotH: 386, armLen: 138, maxAng: 0.74, omega, phase: p3 + 4.2, style: 'wrecking' });
    addSkyLightning(baseX + 628, 342, baseX + 628, 118, { kind: 'storm_strike', period: ltPeriod, phase: 0.95 });
    return { suppressSkyClutter: false, extraAdvance: 175 };
  }

  if (themePick === 4) {
    const p4 = (baseX * 0.008) % 6.28;
    addSkyBumper(baseX + 28, 114, bumperTheme);
    addSkyPendulum(baseX + 138, { pivotH: 248, armLen: 136, maxAng: 0.76, omega, phase: p4, style: 'wrecking' });
    addSkyLightning(baseX + 228, 325, baseX + 298, 142, { kind: 'tesla_arc', period: ltPeriod, phase: 0.4 });
    addSkyPendulum(baseX + 382, { pivotH: 336, armLen: 140, maxAng: 0.75, omega, phase: p4 + Math.PI, style: 'hammer' });
    rails.push({ x: baseX + 468, len: 88, hOff: 268, kind: 'sky_gold', energizedTimer: 0 });
    addSkyLightning(baseX + 548, 356, baseX + 548, 132, { kind: 'storm_strike', period: ltPeriod, phase: 1.05 });
    addSkyPendulum(baseX + 642, { pivotH: 240, armLen: 134, maxAng: 0.76, omega, phase: p4 + 1.7, style: 'wrecking' });
    addBeanArcGuide(baseX + 468, 5, 38, 298, 182, 18, 2);
    return { suppressSkyClutter: false, extraAdvance: 185 };
  }

  const p5 = (baseX * 0.01) % 6.28;
  addSkyPendulum(baseX + 65, { pivotH: 236, armLen: 134, maxAng: 0.78, omega, phase: p5, style: 'hammer' });
  addSkyLightning(baseX + 162, 338, baseX + 162, 106, { kind: 'storm_strike', period: ltPeriod, phase: 0.15 });
  addSkyBumper(baseX + 238, 148, bumperTheme);
  addSkyPendulum(baseX + 338, { pivotH: 325, armLen: 140, maxAng: 0.76, omega, phase: p5 + 2.0, style: 'wrecking' });
  addSkyLightning(baseX + 432, 318, baseX + 498, 152, { kind: 'tesla_arc', period: ltPeriod, phase: 0.75 });
  addSkyPendulum(baseX + 585, { pivotH: 248, armLen: 136, maxAng: 0.76, omega, phase: p5 + 4.1, style: 'hammer' });
  addSkyLightning(baseX + 675, 348, baseX + 675, 128, { kind: 'storm_strike', period: ltPeriod, phase: 1.25 });
  if (skySetpieceSeq % 12 === 5) addSkyRing(baseX + 748, 292, true);
  return { suppressSkyClutter: false, extraAdvance: 195 };
}

function trySpawnTrackPropsAt(chunkDist, spawnX) {
  const hasActivePropBuff = player.giantTimer > 0 || player.rocketDashTimer > 0 || player.magnetTimer > 0 || player.orbitSawTimer > 0 || player.mortarTimer > 0 || Boolean(player.weaponId);

  // 1A. Timed Expiring Anti-Burst Energy Shield (~520..700m spacing, capped stretch for 10km/20km!)
  if (player.tempShieldHp <= 0 && chunkDist >= nextShieldDist) {
    nextShieldDist = chunkDist + 520 + Math.floor(Math.random() * 180) + Math.min(720, Math.floor(runStats.singleRunDist * 0.14));
    const shx = spawnX + 60;
    const shRoadY = getBaseSurfaceY(shx);
    const shPara = Math.random() < 0.55;
    const shHoverH = (Math.floor(spawnX / 290) % 2 === 0) ? 156 : 264;
    const shy = shPara ? (shRoadY - 360) : (shRoadY - shHoverH);
    worldProps.push({
      x: shx,
      y: shy,
      baseY: shRoadY - shHoverH,
      hoverH: shHoverH,
      parachute: shPara,
      chuteCol: '#38bdf8',
      def: TIMED_SHIELD_PROP,
      taken: false,
      phase: Math.random() * 6
    });
  }

  // 1B. Scarce Gradual-Regen Boba (720~940m + steep distance stretch, ONLY when HP < 65%!)
  if (chunkDist >= nextHealDist) {
    const hpRatio = (player.hp + player.regenPool) / Math.max(1, player.maxHp);
    if (hpRatio < 0.54 && runStats.singleRunDist < 540) {
      const distStretch = Math.floor(runStats.singleRunDist * 0.55);
      const gap = (hpRatio < 0.32 ? 580 : 740) + Math.floor(Math.random() * 180) + distStretch;
      nextHealDist = chunkDist + gap;
      const hx = spawnX + 125;
      const hy = getBaseSurfaceY(hx) - 148;
      worldProps.push({ x: hx, y: hy, baseY: hy, hoverH: 148, def: HEAL_BOBA_PROP, taken: false, phase: Math.random() * 6 });
    } else {
      nextHealDist = chunkDist + 240;
    }
  }

  // 2. Rich Track Props (Settle onto Sky Tier 1 ~154px or Sky Tier 2 ~268px to reward jumping & sky climbing!)
  if (chunkDist >= nextPropDist) {
    nextPropDist = chunkDist + 135 + Math.floor(Math.random() * 60);
    const isParachute = !runStats.firstSkyPropSpawned || Math.random() < 0.68;
    runStats.firstSkyPropSpawned = true;
    const px = spawnX + 165;
    const roadY = getBaseSurfaceY(px);
    const hoverH = (Math.floor(px / 270) % 2 === 0) ? 154 : 268;
    const py = isParachute ? (roadY - 375) : (roadY - hoverH);
    const pick = WORLD_PROP_POOL[Math.floor(Math.random() * WORLD_PROP_POOL.length)];
    const chutePalette = ['#ef4444', '#f97316', '#3b82f6', '#a855f7'];
    worldProps.push({
      x: px,
      y: py,
      baseY: roadY - hoverH,
      hoverH,
      parachute: isParachute,
      chuteCol: chutePalette[Math.floor(Math.random() * chutePalette.length)],
      def: pick,
      taken: false,
      phase: Math.random() * 6
    });
  }
}

function spawnWorldAhead() {
  if (tutorialSession.active || superBonusTimer > 0 || (partyCtrl && partyCtrl.isActive())) return;

  while (120 + nextFlagDist * 18 < player.x + 1500) {
    const fx = 120 + nextFlagDist * 18;
    checkpointFlags.push({ x: fx, dist: nextFlagDist, passed: false });
    nextFlagDist += 500;
  }

  const grad = getSurvivalGradient(runStats.singleRunDist);
  const gapStep = grad.chunkGap;

  // 100% FULL stage spawning at all times (normal, 5.0x Hyper Dash, HeadStart, AND Boss fights!)
  const spawnHorizon = player.x + (player.hyperDashActive ? 3100 : 1920);
  while (nextSpawnX < spawnHorizon) {
    const st = getStageForWorldX(nextSpawnX);
    const chunkDist = Math.max(0, (nextSpawnX - 120) / 18);
    const r = Math.random();

    trySpawnTrackPropsAt(chunkDist, nextSpawnX);

    // Ground-only Ambush Rollers + Distinct Aerial Setpieces (Giant Pendulums, Boost Rings & Sky Bumpers — ZERO sky saws!)
    const allowPit = !activeBoss || player.hyperDashActive;
    const willBePit = allowPit && ((st.id === 'site' && r < 0.34) || (st.id === 'volcano' && r < 0.36));
    if (!willBePit && Math.random() < Math.min(0.44, grad.ambushProb * 0.62)) {
      const hx = nextSpawnX + 135;
      const sawSpd = -(165 + grad.tier * 36);
      enemyShots.push({ kind: 'spike_roller', x: hx, y: getBaseSurfaceY(hx), vx: sawSpd, parried: false, rot: 0 });
    }
    const skyPlan = spawnSkySetpieceForChunk(nextSpawnX, st, grad, willBePit, chunkDist);
    const suppressSky = skyPlan.suppressSkyClutter;
    const chunkStep = gapStep + (skyPlan.extraAdvance || 0);
    const extraPitW = grad.tier >= 5 ? 48 : (grad.tier >= 3 ? 30 : (grad.tier >= 2 ? 16 : 0));
    const prepTime = Math.max(0.28, 0.60 - grad.tier * 0.06);

    if (!suppressSky && chunkDist < 120 && Math.random() < 0.85) {
      // Opening <120m visible aerial warm-up (zero boost-ring clutter!)
      addSkyBumper(nextSpawnX + 42, 114, 0);
      addSkyPendulum(nextSpawnX + 185, {
        pivotH: 242,
        armLen: 134,
        maxAng: 0.70,
        omega: 2.28,
        phase: (nextSpawnX * 0.01) % 6.28,
        style: 'wrecking'
      });
      addSkyLightning(nextSpawnX + 335, 328, nextSpawnX + 335, 108, {
        kind: 'storm_strike',
        period: 1.72
      });
    }

    if (st.id === 'court') {
      if (r < 0.52) {
        const sx = nextSpawnX + 45;
        for (let k = 0; k < 3; k++) {
          const mk = k === 2 ? 'shield_lawyer' : (k === 0 ? 'dribbler' : 'boar_frog');
          enemies.push({ x: sx + 70 + k * 52, kind: mk, shielded: k === 2, windupTimer: 0.78, chargePrep: prepTime, shotDone: false, hit: false, phase: k * 0.6 });
        }
        if (!suppressSky) {
          spawnAerialDronePair(sx + 125, 2, grad.tier);
          for (let i = 0; i < 4; i++) {
            const bx = sx + 60 + i * 46;
            if (beans.length < 280) beans.push({ x: bx, y: getBaseSurfaceY(bx) - 172, val: 1, giant: i === 2, taken: false });
          }
        }
      } else {
        const fx = nextSpawnX + 50;
        laserGates.push({ x: fx + 36, hacked: false });
        for (let k = 0; k < 3; k++) {
          enemies.push({ x: fx + 95 + k * 50, kind: k === 1 ? 'spiky_cat' : 'pelican_guard', hit: false, phase: k });
        }
        if (!suppressSky) spawnAerialDronePair(fx + 125, grad.tier >= 3 ? 3 : 2, grad.tier);
      }
      nextSpawnX += chunkStep;
    } else if (st.id === 'site') {
      if (r < 0.34) {
        const px = nextSpawnX + 95;
        pits.push({ x: px, len: 122 + extraPitW, bridged: false });
        if (!suppressSky) {
          rails.push({ x: px + 18, len: 88, hOff: 138, kind: 'suspenders', energizedTimer: 0 });
          spawnAerialDronePair(px + 45, grad.tier >= 3 ? 3 : 2, grad.tier);
        }
      } else {
        const bx = nextSpawnX + 80;
        for (let k = 0; k < 3; k++) {
          const mk = k === 0 ? 'shield_lawyer' : (k === 2 ? 'boar_frog' : 'spiky_cat');
          enemies.push({ x: bx + 15 + k * 52, kind: mk, shielded: k === 0, windupTimer: 0.78, chargePrep: prepTime, shotDone: false, hit: false, phase: k });
        }
        if (!suppressSky) spawnAerialDronePair(bx + 70, 2, grad.tier);
      }
      nextSpawnX += chunkStep;
    } else if (st.id === 'swamp') {
      if (r < 0.55) {
        const mx = nextSpawnX + 40;
        mudZones.push({ x: mx, len: 240, dried: false });
        lilyPads.push({ x: mx + 58, yOff: 32, anim: 0 });
        if (!suppressSky) {
          lilyPads.push({ x: mx + 165, yOff: 62, anim: 0 });
          spawnAerialDronePair(mx + 105, 2, grad.tier);
        }
        enemies.push({ x: mx + 108, kind: 'spiky_cat', hit: false, phase: 0 });
        enemies.push({ x: mx + 210, kind: 'boar_frog', chargePrep: prepTime, hit: false, phase: 1 });
      } else {
        const gx = nextSpawnX + 45;
        for (let k = 0; k < 3; k++) {
          const mk = k === 1 ? 'spiky_cat' : (k === 2 ? 'boar_frog' : 'shield_lawyer');
          enemies.push({ x: gx + 85 + k * 52, kind: mk, shielded: k === 0, windupTimer: 0.78, chargePrep: prepTime, hit: false, phase: k });
        }
        if (!suppressSky) spawnAerialDronePair(gx + 110, 2, grad.tier);
      }
      nextSpawnX += chunkStep;
    } else if (st.id === 'snow') {
      const ix = nextSpawnX + 36;
      iceZones.push({ x: ix, len: 280 });
      snowballs.push({ x: ix + 340, y: getBaseSurfaceY(ix + 340) - 28, vx: -(125 + grad.tier * 18), rot: 0, smashed: false });
      if (r < 0.55) {
        for (let k = 0; k < 3; k++) {
          enemies.push({ x: ix + 95 + k * 52, kind: k % 2 === 0 ? 'snowman' : 'spiky_cat', hit: false, phase: k });
        }
        if (!suppressSky) {
          spawnAerialDronePair(ix + 150, 2, grad.tier);
          for (let i = 0; i < 4; i++) {
            const bx = ix + 95 + i * 44;
            if (beans.length < 280) beans.push({ x: bx, y: getBaseSurfaceY(bx) - 174, val: 1, giant: i === 3, taken: false });
          }
        }
      } else {
        if (!suppressSky) spawnAerialDronePair(ix + 125, 3, grad.tier);
        for (let k = 0; k < 3; k++) {
          enemies.push({ x: ix + 100 + k * 52, kind: k === 1 ? 'boar_frog' : 'snowman', chargePrep: prepTime, hit: false, phase: k });
        }
      }
      nextSpawnX += chunkStep;
    } else if (st.id === 'volcano') {
      if (r < 0.36) {
        const vx = nextSpawnX + 95;
        pits.push({ x: vx, len: 126 + extraPitW, bridged: false, lava: true });
        lilyPads.push({ x: vx + 62, yOff: 32, anim: 0 });
        if (!suppressSky) {
          rails.push({ x: vx + 16, len: 86, hOff: 142, kind: 'suspenders', energizedTimer: 0 });
          spawnAerialDronePair(vx + 55, 2, grad.tier);
        }
      } else {
        const vx = nextSpawnX + 48;
        laserGates.push({ x: vx + 150, hacked: false });
        for (let k = 0; k < 3; k++) {
          const mk = k % 2 === 0 ? 'boar_frog' : 'spiky_cat';
          enemies.push({ x: vx + 45 + k * 52, kind: mk, chargePrep: prepTime, hit: false, phase: k });
        }
        if (!suppressSky) spawnAerialDronePair(vx + 95, grad.tier >= 2 ? 3 : 2, grad.tier);
      }
      nextSpawnX += chunkStep;
    } else if (st.id === 'bamboo') {
      const bx = nextSpawnX + 40;
      if (!suppressSky) {
        spawnAerialDronePair(bx + 115, 3, grad.tier);
      }
      for (let k = 0; k < 3; k++) {
        const mk = k === 0 ? 'shield_lawyer' : (k === 1 ? 'spiky_cat' : 'boar_frog');
        enemies.push({ x: bx + 78 + k * 52, kind: mk, shielded: k === 0, windupTimer: 0.78, chargePrep: prepTime, shotDone: false, hit: false, phase: k });
      }
      if (!suppressSky) {
        for (let i = 0; i < 4; i++) {
          const jx = bx + 115 + i * 44;
          if (beans.length < 280) beans.push({ x: jx, y: getBaseSurfaceY(jx) - 165, val: 1, giant: i === 3, taken: false });
        }
      }
      nextSpawnX += chunkStep;
    } else {
      const lx = nextSpawnX + 110;
      laserGates.push({ x: lx, hacked: false });
      for (let k = 0; k < 3; k++) {
        const mk = k === 0 ? 'shield_lawyer' : (k === 2 ? 'spiky_cat' : 'boar_frog');
        enemies.push({ x: lx + 86 + k * 50, kind: mk, shielded: k === 0, windupTimer: 0.76, chargePrep: prepTime, shotDone: false, hit: false, phase: k });
      }
      if (!suppressSky) spawnAerialDronePair(lx + 75, 3, grad.tier);
      nextSpawnX += chunkStep;
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
  if (runStats && runStats.isDevTestRun) return;
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
  const liveRunBest = (state !== 'HUB' && getActiveAccountOwnerTag() === activeRunOwner && !(partyCtrl && partyCtrl.isActive()))
    ? (runStats.singleRunDist || 0)
    : 0;
  const myBest = Math.max(store.save.bestSingleRun || 0, liveRunBest);
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
    const liveRunBest = (state !== 'HUB' && getActiveAccountOwnerTag() === activeRunOwner && !(partyCtrl && partyCtrl.isActive()))
      ? (runStats.singleRunDist || 0)
      : 0;
    const best = Math.max(store.save.bestSingleRun || 0, liveRunBest);
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
  if (player.skyWingsTimer > 0) return 5;
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
      ? `☄️ 超级霸王究极冲刺 ${(10 - player.hyperSessionSec).toFixed(1)}s`
      : (isEmpty ? '☄️ 超级霸王究极冲刺 0/3 (点此补给)' : `☄️ 超级霸王究极冲刺 (${(curE / 10).toFixed(1)}/3)`);
    setTextCached('hLbl', hyperDashLbl, hTxt);
  }

  if (player.weaponId) {
    if (uiCache.wArmed !== true) { uiCache.wArmed = true; actionBtn.classList.add('weapon-armed'); }
    if (uiCache.aOnCd !== false) { uiCache.aOnCd = false; actionBtn.classList.remove('on-cd', 'overheated'); }
    setStyleCached('aCdH', actionCdShade, 'height', '0%');
    setTextCached('aIco', actionIcon, player.weaponId === 'gatling' ? '🏀' : '🦈');
    setTextCached('aLbl', actionLbl, player.weaponId === 'gatling' ? '加特林' : '火箭筒');
    setStyleCached('ammoW', ammoBar, 'width', `${Math.round(Math.max(0, (player.weaponTimer / player.weaponMaxTimer) * 100))}%`);
    return;
  }
  if (uiCache.wArmed !== false) { uiCache.wArmed = false; actionBtn.classList.remove('weapon-armed'); }
  setStyleCached('ammoW', ammoBar, 'width', '0%');
  const actOnCd = player.actionCd > 0.04;
  const actOver = Boolean(player.actionOverheat && actOnCd);
  if (uiCache.aOnCd !== actOnCd) { uiCache.aOnCd = actOnCd; actionBtn.classList.toggle('on-cd', actOnCd); }
  if (uiCache.aOver !== actOver) { uiCache.aOver = actOver; actionBtn.classList.toggle('overheated', actOver); }
  if (actOnCd) {
    const maxCd = Math.max(0.2, player.actionMaxCd || 0.64);
    const cdPct = Math.round(Math.min(100, (player.actionCd / maxCd) * 100));
    setStyleCached('aCdH', actionCdShade, 'height', `${cdPct}%`);
    setTextCached('aIco', actionIcon, actOver ? '😮‍💨' : '🐔');
    setTextCached('aLbl', actionLbl, actOver ? `破绽 ${player.actionCd.toFixed(1)}s` : `${player.actionCd.toFixed(1)}s`);
  } else {
    setStyleCached('aCdH', actionCdShade, 'height', '0%');
    setTextCached('aIco', actionIcon, '🐔');
    setTextCached('aLbl', actionLbl, '铁山靠');
  }
}

function describeBossAttackMeta(boss) {
  if (!boss) {
    return { cause: '⚔️ 首领猛攻', tip: '留意首领攻击前摇光圈，用铁山靠破防并接角色大招爆发！' };
  }
  const map = {
    dingdong_ji: {
      cause: '🐔 叮咚鸡 · 高压冲撞与音浪',
      tip: '叮咚鸡蓄力红圈逼近时按【铁山靠】破防眩晕，地面冲击波提前起跳！'
    },
    dagou_jiao: {
      cause: '🐕 大狗嚼 · 车尾狂追猛扑',
      tip: '大狗从后方张嘴扑来时，抓准时机按【铁山靠】或向后释放技能击退！'
    },
    titan_naiwa: {
      cause: '🐸 泰坦奶蛙 · 巨舌横扫/泰山压顶',
      tip: '地面长舌横扫可起跳越过，头顶泰山压顶落点请二段跳远离！'
    },
    kun_mecha: {
      cause: '🏀 机甲阿坤 · 篮球飞弹与铁山冲锋',
      tip: '飞来的篮球与律师函可用【铁山靠】弹反重创机甲，冲锋时起跳规避！'
    },
    manbo_queen: {
      cause: '🎵 曼波女王 · 深海涨潮与音符弹幕',
      tip: '涨潮时跳上高空背带滑轨，迎面飞来的音符用【铁山靠】完美弹反！'
    },
    demon_hakimi: {
      cause: '🐱 恶魔哈基米 · 俯冲利爪与鱼骨飞刀',
      tip: '鱼骨飞刀进入光圈时按【铁山靠】弹反，空中俯冲红线起跳躲避！'
    },
    pelican_emperor: {
      cause: '🦩 鹈鹕大帝 · 巨喙俯冲与深渊旋涡',
      tip: '巨喙俯冲可起跳踩头或【铁山靠】反制，破防眩晕期间交大招灌满伤害！'
    }
  };
  return map[boss.kind] || {
    cause: `⚔️ ${boss.name || '赛道首领'} 重击`,
    tip: '观察首领前摇提示，铁山靠弹反破防后再开大招可打出 140% 暴击！'
  };
}

function getBossCallbacks() {
  return {
    player,
    getGroundY: getBaseSurfaceY,
    hitBoss,
    takeDamage: (d) => takePlayerDamage(d, false, describeBossAttackMeta(activeBoss)),
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
  if ((partyCtrl && partyCtrl.isActive()) || state !== 'PLAYING' || headStartTargetDist > 0) return;
  if (tutorialSession.active) {
    if (!tryConsumeTutorialInput('hyper')) return;
    ensureAudio();
    store.save.dashEnergy = 20;
    player.hyperDashHolding = true;
    player.hyperReleaseGrace = 1.65;
    player.hyperDashActive = true;
    player.hyperSessionSec = 0;
    player.hyperStartDist = runStats.dist;
    playSfx('hyper');
    shakeTime = 0.20; shakeMag = 10;
    pushCapped(shockwaves, { x: player.x + 25, y: player.y - 45, r: 16, maxR: 280, life: 0.32, color: '#fde047', harmless: false }, 12);
    addPopup('☄️ 超级霸王究极冲刺!!', player.x + 40, player.y - 105, '#fde047', 20);
    syncControlsUI();
    return;
  }
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
    addPopup('☄️ 超级霸王究极冲刺!! (松手即停)', player.x + 40, player.y - 105, '#fde047', 20);
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
  if (!tryConsumeTutorialInput('jump')) return;
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
    if (sh.dead || sh.parried || sh.kind === 'spike_roller') continue;
    if (Math.hypot(sh.x - (player.x + 30), sh.y - (player.y - 46)) < 190) return true;
  }
  return false;
}

function tryExecuteParrySweep() {
  let didParry = false;
  if (activeBoss && superBonusTimer <= 0 && handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'parry')) {
    didParry = true;
    player.whiffStreak = 0;
    player.actionOverheat = false;
    player.actionCd = Math.min(player.actionCd, 0.22);
    player.actionMaxCd = 0.22;
  }

  for (let i = 0; i < enemyShots.length; i++) {
    const sh = enemyShots[i];
    if (sh.dead || sh.parried || sh.kind === 'spike_roller') continue;
    if (Math.hypot(sh.x - (player.x + 30), sh.y - (player.y - 46)) < 180) {
      sh.parried = true; sh.vx = player.vx + 960; sh.vy = -55;
      player.invulnTimer = Math.max(player.invulnTimer, 0.40);
      player.whiffStreak = 0;
      player.actionOverheat = false;
      player.actionCd = 0.20;
      player.actionMaxCd = 0.20;
      player.strikeConnected = true;
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
  if (!tryConsumeTutorialInput('action')) return;
  ensureAudio();
  actionHeld = true;

  if (player.weaponId) {
    if (player.actionCd <= 0) {
      tryExecuteParrySweep();
      player.parryWindowTimer = 0.16;
      player.actionCd = player.weaponId === 'gatling' ? 0.16 : 0.32;
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

  // Anti-Mash Commitment: Frantically mashing during recovery stumbles stance instead of granting a free swing!
  const allowReactiveParry = !player.actionOverheat && (player.whiffStreak || 0) === 0 && hasNearbyParryThreat();
  if (player.actionCd > 0 && !allowReactiveParry && !tutorialSession.active) {
    if (!player.actionOverheat && player.actionCd <= 0.11 && (player.cdMashCount || 0) === 0) {
      player.actionBufferTimer = 0.09;
    } else if (player.actionCd > 0.16) {
      player.cdMashCount = (player.cdMashCount || 0) + 1;
      if (player.cdMashCount >= 2) {
        player.actionOverheat = true;
        player.actionCd = Math.min(1.25, Math.max(player.actionCd, 0.92));
        player.actionMaxCd = Math.max(player.actionMaxCd || 0.95, player.actionCd);
        player.actionBufferTimer = 0;
        syncControlsUI();
      }
    }
    return;
  }
  player.cdMashCount = 0;
  player.actionBufferTimer = 0;
  player.strikeTimer = tutorialSession.active ? 0.28 : 0.16;
  player.parryWindowTimer = tutorialSession.active ? 0.42 : 0.18;
  player.strikeHitCount = 0;
  player.strikeConnected = false;
  playSfx('slash');

  let connectedNow = false;
  const prevHackCount = laserGates.reduce((acc, g) => acc + (g.hacked ? 1 : 0), 0);
  const prevBarrelCount = barrels.reduce((acc, b) => acc + (b.exploded ? 1 : 0), 0);
  checkEnvironmentImpactArea(player.x + 68, player.y - 46, 98);
  const postHackCount = laserGates.reduce((acc, g) => acc + (g.hacked ? 1 : 0), 0);
  const postBarrelCount = barrels.reduce((acc, b) => acc + (b.exploded ? 1 : 0), 0);
  if (postHackCount > prevHackCount || postBarrelCount > prevBarrelCount) connectedNow = true;

  if (player.onRail && player.onRail.kind === 'maglev') {
    player.onRail.energizedTimer = 0.6;
    connectedNow = true;
    playSfx('crate');
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (!en.hit && en.x >= player.onRail.x - 40 && en.x <= player.onRail.x + player.onRail.len + 100) {
        en.shielded = false; defeatEnemy(en);
      }
    }
  }

  const didParry = tryExecuteParrySweep();
  if (didParry) connectedNow = true;

  for (let i = 0; i < snowballs.length; i++) {
    const sb = snowballs[i];
    if (!sb.smashed && Math.hypot(sb.x - (player.x + 56), sb.y - (player.y - 36)) < 132) {
      sb.smashed = true;
      connectedNow = true;
      playSfx('crater'); shakeTime = 0.18; shakeMag = 9;
      spawnBeanFountain(sb.x, sb.y, 4, 1);
      addPopup('🐔 铁山碎冰!', sb.x, sb.y - 45, '#7dd3fc');
    }
  }

  pushCapped(shockwaves, { x: player.x + 48, y: player.y - 44, r: 12, maxR: 112, life: 0.16, color: '#fb923c', harmless: true }, 12);
  if (partyCtrl && partyCtrl.isActive() && partyCtrl.tryMeleeShoulderBump) {
    if (partyCtrl.tryMeleeShoulderBump()) connectedNow = true;
  }
  let hitAnyMob = false;
  for (let i = 0; i < enemies.length; i++) {
    if (player.strikeHitCount >= 2 && !tutorialSession.active) break;
    const en = enemies[i];
    if (en.hit || en.swallowing) continue;
    const ey = getEnemyWorldY(en);
    const dx = en.x - player.x;
    if (dx > -22 && dx < 148 && Math.abs((ey - 24) - (player.y - 38)) < 84) {
      en.hit = true;
      hitAnyMob = true;
      connectedNow = true;
      player.strikeHitCount += 1;
      projectiles.push({
        kind: 'bowling_mob', mobKind: en.kind,
        x: en.x, y: ey - 22, vx: player.vx + 720, vy: -165,
        bouncesLeft: 1, pierceLeft: 1, r: 22, rot: 0, life: 1.4
      });
      playSfx('parry');
      addPopup('🐔 铁山靠!', en.x, ey - 65, '#fde047');
    }
  }
  // Brief 0.14s single-contact frame guard ONLY when actually hitting a mob (NEVER chainable empty-air invincibility!)
  if (hitAnyMob) player.invulnTimer = Math.max(player.invulnTimer, 0.14);

  for (let i = 0; i < cashTrucks.length; i++) {
    const ct = cashTrucks[i];
    if (!ct.dead && Math.abs(ct.x - (player.x + 64)) < 122 && Math.abs((ct.y - 28) - (player.y - 38)) < 76) {
      hitCashTruck(ct, 2);
      connectedNow = true;
    }
  }
  if (activeBoss) {
    const bossMidY = getBaseSurfaceY(activeBoss.worldX) - 56 + (activeBoss.yOff || 0);
    if (Math.abs(activeBoss.worldX - player.x) < 195 && Math.abs(bossMidY - (player.y - 44)) < 96) {
      hitBoss(14, false, false);
      connectedNow = true;
    }
  }

  player.strikeConnected = connectedNow;
  if (tutorialSession.active) {
    player.whiffStreak = 0;
    player.actionOverheat = false;
    player.actionCd = 0.16;
    player.actionMaxCd = 0.16;
  } else if (partyCtrl && partyCtrl.isActive()) {
    player.whiffStreak = 0;
    player.actionOverheat = false;
    player.actionCd = connectedNow ? 0.36 : 0.55;
    player.actionMaxCd = player.actionCd;
  } else if (didParry) {
    player.whiffStreak = 0;
    player.actionOverheat = false;
    player.actionCd = 0.20;
    player.actionMaxCd = 0.20;
  } else if (connectedNow) {
    player.whiffStreak = 0;
    player.actionOverheat = false;
    player.actionCd = 0.38;
    player.actionMaxCd = 0.38;
  } else {
    // Empty-air whiff: 1st whiff has 0.64s recovery; mashing >=2 whiffs in a row triggers 1.15s Stance Break!
    player.whiffStreak = (player.whiffStreak || 0) + 1;
    player.whiffResetTimer = 1.45;
    if (player.whiffStreak >= 2) {
      player.actionOverheat = true;
      player.actionCd = 1.15;
      player.actionMaxCd = 1.15;
      player.parryWindowTimer = 0;
      addPopup('😮‍💨 空挥破绽 1.1s!', player.x + 24, player.y - 90, '#fda4af', 16);
    } else {
      player.actionOverheat = false;
      player.actionCd = 0.64;
      player.actionMaxCd = 0.64;
    }
  }
  syncControlsUI();
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
  const flameCeilingY = (superBonusTimer > 0 ? -360 : getBaseSurfaceY(player.x)) - 215;
  if (!player.onGround && player.vy > -85 && player.y > flameCeilingY) {
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
  const flameY = player.y - 82;
  checkEnvironmentImpactArea(player.x + 225, flameY, 105);
  if (Math.abs(getBaseSurfaceY(player.x) - player.y) < 95) {
    for (let i = 0; i < mudZones.length; i++) {
      if (!mudZones[i].dried && flameEnd > mudZones[i].x && player.x < mudZones[i].x + mudZones[i].len) mudZones[i].dried = true;
    }
  }
  for (let i = 0; i < snowballs.length; i++) {
    const sb = snowballs[i];
    if (!sb.smashed && sb.x > player.x && sb.x < flameEnd && Math.abs(sb.y - flameY) < 78) {
      sb.smashed = true;
      spawnBeanFountain(sb.x, sb.y, 4, 1);
    }
  }
  for (let i = 0; i < enemies.length; i++) {
    const en = enemies[i];
    if (!en.hit && !en.swallowing && en.x > player.x - 10 && en.x < flameEnd && Math.abs((getEnemyWorldY(en) - 28) - flameY) < 82) {
      en.shielded = false;
      defeatEnemy(en);
    }
  }
  for (let i = 0; i < cashTrucks.length; i++) {
    const ct = cashTrucks[i];
    if (!ct.dead && ct.x > player.x && ct.x < flameEnd && Math.abs((ct.y - 30) - flameY) < 78) {
      ct.burnTick = (ct.burnTick || 0) + dtSlice;
      if (ct.burnTick > 0.18) { ct.burnTick = 0; hitCashTruck(ct, 1); }
    }
  }
  if (activeBoss && activeBoss.worldX > player.x - 380 && activeBoss.worldX < flameEnd + 90) {
    const bossHitY = getBaseSurfaceY(activeBoss.worldX) - 56 + (activeBoss.yOff || 0);
    // Strict vertical alignment: high-sky flame CANNOT hit a ground Boss far below!
    if (Math.abs(bossHitY - flameY) < 86) {
      activeBoss.flameTick = (activeBoss.flameTick || 0) + dtSlice;
      if (activeBoss.flameTick >= 0.16) {
        activeBoss.flameTick = 0;
        handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
        hitBoss(14.5, false, false, true);
      }
    }
  }
  if (partyCtrl && partyCtrl.isActive() && partyCtrl.tryHitRivalWithHeroSkill) {
    partyCtrl.tryHitRivalWithHeroSkill(player.x + 210, player.y - 52, 260, 30, '🔥 奶龙烈焰');
  }
}

function onSkillPress() {
  if (state !== 'PLAYING' || headStartTargetDist > 0) return;
  if (!tryConsumeTutorialInput('skill')) return;
  ensureAudio();
  const h = getHero();
  player.skillHeld = true;

  if (activeBoss && superBonusTimer <= 0) {
    const bossHitY = getBaseSurfaceY(activeBoss.worldX) - 56 + (activeBoss.yOff || 0);
    if (Math.abs(bossHitY - (player.y - 54)) < 135) {
      handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
    }
  }

  if (h.id === 'nailong') {
    if (player.flameFuel > 8) {
      player.flameHolding = true;
      player.flameBurstTimer = tutorialSession.active ? 1.35 : 0.95;
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
    player.invulnTimer = Math.max(player.invulnTimer, 0.78);
    playSfx('crater');
    playGentleSkillAccent('ikun', Boolean(activeBoss));
    shakeTime = 0.18; shakeMag = 9;
    // Power Slam-Dribble: slams pavement right in front of the bike first, crushing close mobs immediately before rebounding!
    projectiles.push({
      kind: 'giant_bball',
      x: player.x + 64, y: player.y - 86,
      vx: player.vx + 235, vy: 560,
      bouncesLeft: 14, r: 46, rot: 0, life: 9.0, bossHitCd: 0, trail: []
    });
    addPopup('🏀 巨型暴扣篮球!!', player.x + 48, player.y - 102, '#fb923c', 20);
  } else if (h.id === 'pelican') {
    player.swallowVortexTimer = 1.25;
    player.swallowedCount = 0;
    player.invulnTimer = Math.max(player.invulnTimer, 0.75);
    playSfx('parry');
    const hasMobInFront = enemies.some((e) => !e.hit && !e.isTutStep1 && e.x > player.x - 15 && e.x < player.x + 420);
    if (activeBoss && !hasMobInFront) {
      const pBack = Boolean(superBonusTimer <= 0 && activeBoss.worldX < player.x);
      for (let w = 0; w < 3; w++) {
        projectiles.push({
          kind: 'fish_shot',
          x: player.x + (pBack ? -30 - w * 22 : 50 + w * 22),
          y: player.y - 72 - w * 8,
          vx: player.vx + (pBack ? -640 : 780),
          vy: -45 - w * 35,
          r: 18, rot: 0, life: 1.9, isSkillShot: true
        });
      }
      player.swallowedCount = 3;
    }
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
    spawnAlliedMaodieSwarm(6);
    pushCapped(shockwaves, { x: player.x, y: player.y, r: 14, maxR: 245, life: 0.32, color: '#fb923c', harmless: false }, 12);
    if (partyCtrl && partyCtrl.isActive() && partyCtrl.tryHitRivalWithHeroSkill) {
      partyCtrl.tryHitRivalWithHeroSkill(player.x + 130, player.y - 48, 250, 36, '🐱 耄耋爪击');
    }
    addPopup('🐱 狂丢圆头耄耋!!', player.x + 28, player.y - 96, '#fdba74', 19);
  }
  syncControlsUI();
}

function onSkillRelease() {
  player.skillHeld = false;
  player.flameHolding = false;
}

function bindBtn(el, onDown, onUp, captureHold = false) {
  if (!el) return;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (captureHold && el.setPointerCapture && e.pointerId !== undefined) {
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    }
    el.classList.add('pressed'); onDown();
  });
  const finish = (e) => {
    if (e && e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return;
    if (e && e.cancelable) e.preventDefault();
    if (!el.classList.contains('pressed')) return;
    el.classList.remove('pressed');
    if (onUp) onUp();
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  el.addEventListener('lostpointercapture', finish);
  if (captureHold) {
    window.addEventListener('pointerup', finish);
    window.addEventListener('blur', finish);
  } else {
    el.addEventListener('pointerleave', finish);
  }
}

bindBtn(jumpBtn, () => { jumpHeld = true; player.jumpBufferTimer = 0.14; doJump(); }, () => { jumpHeld = false; }, false);
bindBtn(hyperDashBtn, onHyperDashPress, onHyperDashRelease, true); // Anti-accidental-slip pointer capture!
bindBtn(skillBtn, onSkillPress, onSkillRelease, false);
bindBtn(actionBtn, onActionPress, onActionRelease, false);

// Mobile Touch Split on Canvas (Left Half = Jump, Right Half = 铁山靠)
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'PLAYING' || e.pointerType === 'mouse') return;
  e.preventDefault();
  const tapX = isCssLandscapeRotated ? e.clientY : e.clientX;
  if (tapX < W * 0.5) { jumpHeld = true; player.jumpBufferTimer = 0.14; doJump(); }
  else onActionPress();
});
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  jumpHeld = false;
  onActionRelease();
});

// Ergonomic PC Mouse Controls: Left Click = 🐔 铁山靠 (Action) | Right Click = ✨ 技能 (Skill / Hold Flame)!
let pcMouseLeftHeld = false;
let pcMouseRightHeld = false;

window.addEventListener('contextmenu', (e) => {
  if (state === 'PLAYING') {
    e.preventDefault();
  }
});

window.addEventListener('mousedown', (e) => {
  if (state !== 'PLAYING') return;
  const target = e.target;
  const onUiOverlay = target && target.closest && target.closest('input, textarea, .modal-card, .hub-card');
  if (onUiOverlay) return;

  if (e.button === 2) {
    e.preventDefault();
    pcMouseRightHeld = true;
    if (skillBtn) skillBtn.classList.add('pressed');
    onSkillPress();
  } else if (e.button === 0) {
    const onInteractiveBtn = target && target.closest && target.closest('button, a');
    if (onInteractiveBtn) return;
    e.preventDefault();
    pcMouseLeftHeld = true;
    if (actionBtn) actionBtn.classList.add('pressed');
    onActionPress();
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2 && pcMouseRightHeld) {
    pcMouseRightHeld = false;
    if (skillBtn) skillBtn.classList.remove('pressed');
    onSkillRelease();
  } else if (e.button === 0 && pcMouseLeftHeld) {
    pcMouseLeftHeld = false;
    if (actionBtn) actionBtn.classList.remove('pressed');
    onActionRelease();
  }
});

window.addEventListener('blur', () => {
  if (pcMouseRightHeld) {
    pcMouseRightHeld = false;
    if (skillBtn) skillBtn.classList.remove('pressed');
    onSkillRelease();
  }
  if (pcMouseLeftHeld) {
    pcMouseLeftHeld = false;
    if (actionBtn) actionBtn.classList.remove('pressed');
    onActionRelease();
  }
});

window.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  const anyModalOpen = !authOverlay.classList.contains('hidden')
    || !contactOverlay.classList.contains('hidden')
    || (rankOverlay && !rankOverlay.classList.contains('hidden'))
    || (talentOverlay && !talentOverlay.classList.contains('hidden'))
    || (propShopOverlay && !propShopOverlay.classList.contains('hidden'))
    || (shareOverlay && !shareOverlay.classList.contains('hidden'))
    || (rechargeOverlay && !rechargeOverlay.classList.contains('hidden'))
    || (tutorialMenuOverlay && !tutorialMenuOverlay.classList.contains('hidden'))
    || (acctStrongNudgeOverlay && !acctStrongNudgeOverlay.classList.contains('hidden'))
    || (tutorialWelcomeOverlay && !tutorialWelcomeOverlay.classList.contains('hidden'))
    || (tutorialGradOverlay && !tutorialGradOverlay.classList.contains('hidden'))
    || (pvpTutorialGradOverlay && !pvpTutorialGradOverlay.classList.contains('hidden'))
    || (partyCtrl && partyCtrl.isModalOpen());
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || anyModalOpen) {
    if (e.code === 'Escape') {
      closeAuthModal();
      contactOverlay.classList.add('hidden');
      if (rankOverlay) rankOverlay.classList.add('hidden');
      closeTalentModal();
      closePropShopModal();
      closeCleanShareModal();
      closeRechargeModal();
      closeTutorialMenuModal();
      if (acctStrongNudgeOverlay) acctStrongNudgeOverlay.classList.add('hidden');
      if (acctTutState.active) stopAccountSaveTutorial();
      if (tutorialWelcomeOverlay && !tutorialWelcomeOverlay.classList.contains('hidden')) {
        try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch (_) {}
        tutorialWelcomeOverlay.classList.add('hidden');
      }
      if (tutorialGradOverlay && !tutorialGradOverlay.classList.contains('hidden')) {
        tutorialGradOverlay.classList.add('hidden');
        finishRunAndOpenHub();
      }
      if (pvpTutorialGradOverlay && !pvpTutorialGradOverlay.classList.contains('hidden')) {
        pvpTutorialGradOverlay.classList.add('hidden');
        if (partyCtrl && partyCtrl.isActive()) partyCtrl.exitPartyToHub();
        else finishRunAndOpenHub();
      }
      if (partyCtrl) partyCtrl.closeModalsOnEsc();
    } else if (tutorialWelcomeOverlay && !tutorialWelcomeOverlay.classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      startTutorialRun();
    } else if (tutorialGradOverlay && !tutorialGradOverlay.classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      tutorialGradOverlay.classList.add('hidden');
      completeTutorialHandoffToLiveRun(false);
    } else if (pvpTutorialGradOverlay && !pvpTutorialGradOverlay.classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      if (pvpTutGradMatchBtn) pvpTutGradMatchBtn.click();
    }
    return;
  }
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (!pauseOverlay.classList.contains('hidden') || state === 'PAUSED') resumeFromPause();
    else if (state === 'PLAYING') pauseGame(false);
    return;
  }
  if ((state === 'PAUSED' || !pauseOverlay.classList.contains('hidden')) && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    resumeFromPause();
    return;
  }
  if (state === 'GAMEOVER' && !gameOverOverlay.classList.contains('hidden') && (e.code === 'Space' || e.code === 'KeyR' || e.code === 'Enter')) {
    e.preventDefault();
    goRetryBtn.click();
    return;
  }
  if (state === 'HUB' && (e.code === 'Space' || e.code === 'Enter')) {
    startNewRun(store.save.selectedHero, store.save.selectedCheckpoint, preSelectedBoost);
    return;
  }
  if (state !== 'PLAYING') return;
  if (tutorialSession.active && tutorialSession.mode === 'pvp' && tutorialSession.masteryReady) {
    if (e.code === 'Enter') {
      e.preventDefault();
      advanceCurrentPvpTutorialLesson();
      return;
    }
    if (e.code === 'KeyR') {
      e.preventDefault();
      replayCurrentPvpTutorialLesson();
      return;
    }
  }
  if (partyCtrl && partyCtrl.isActive()) {
    if (e.code === 'Digit1' || e.code === 'KeyQ') {
      e.preventDefault();
      partyCtrl.useItemSlot(0);
      return;
    }
    if (e.code === 'Digit2' || e.code === 'KeyE') {
      e.preventDefault();
      partyCtrl.useItemSlot(1);
      return;
    }
  }
  if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
    e.preventDefault(); jumpHeld = true; player.jumpBufferTimer = 0.14; doJump();
  } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift' || e.code === 'KeyR' || (!(partyCtrl && partyCtrl.isActive()) && e.code === 'KeyQ')) {
    e.preventDefault();
    if (partyCtrl && partyCtrl.isActive()) partyCtrl.setStaminaHeld(true);
    else onHyperDashPress();
  } else if (e.code === 'KeyK' || e.code === 'KeyE') {
    e.preventDefault(); onSkillPress();
  } else if (e.code === 'KeyJ' || e.code === 'KeyF' || e.code === 'Enter') {
    e.preventDefault(); onActionPress();
  } else if (e.code === 'KeyH') {
    e.preventDefault(); tryBuyInRunHealSupply();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') jumpHeld = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift' || e.code === 'KeyR' || (!(partyCtrl && partyCtrl.isActive()) && e.code === 'KeyQ')) {
    if (partyCtrl && partyCtrl.isActive()) partyCtrl.setStaminaHeld(false);
    onHyperDashRelease();
  }
  if (e.code === 'KeyK' || e.code === 'KeyE') onSkillRelease();
  if (e.code === 'KeyJ' || e.code === 'KeyF' || e.code === 'Enter') onActionRelease();
});

// ==================== COMBAT, STEEP SURVIVAL DAMAGE & 7-BOSS LIFECYCLE ====================
function defeatEnemy(en) {
  if (en.hit) return;
  en.hit = true;
  if (en.tutStep3) tutorialSession.step3StompDone = true;
  if (en.tutStep6) tutorialSession.step6Kills = (tutorialSession.step6Kills || 0) + 1;
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

function enterFinalDyingState() {
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

function tryTriggerLethalDeathDashOrDie() {
  if (runStats.deathDashMeters > 0 && !runStats.deathDashUsed) {
    const meters = runStats.deathDashMeters;
    runStats.deathDashMeters = 0;
    runStats.deathDashUsed = true;
    deathDashActive = true;
    forceStopHyperDash();
    headStartTargetDist = runStats.dist + meters;
    player.hp = 1;
    player.regenPool = 0;
    player.dotPool = 0;
    player.invulnTimer = 25;
    enemyShots.length = 0;
    bossHazards.length = 0;
    playSfx('hyper');
    showToast(`🔥 死亡终极冲刺触发 · 狂飙 +${meters}m！！`);
    refreshBuffChips();
    updateTopHUD();
    return;
  }
  enterFinalDyingState();
}

function takePlayerDamage(rawDmg = 11, isPitFall = false, dmgMeta = null) {
  if (state !== 'PLAYING' || headStartTargetDist > 0 || superBonusTimer > 0 || player.hyperDashActive) return;
  if (tutorialSession.active) {
    player.invulnTimer = 0.45;
    return;
  }
  if (!isPitFall && (player.invulnTimer > 0 || player.giantTimer > 0 || player.rocketDashTimer > 0)) return;

  if (dmgMeta && dmgMeta.cause) {
    lastDamageMeta = dmgMeta;
  } else if (isPitFall) {
    lastDamageMeta = {
      cause: '🕳️ 坠入深渊断桥',
      tip: '遇到工地断桥或火山岩浆坑时，提前连按两次【起跳】二段跳或走上方滑轨！'
    };
  }

  if (partyCtrl && partyCtrl.isActive() && partyCtrl.tryConsumeOneHitShield(isPitFall)) {
    updateTopHUD();
    return;
  }

  if (player.orbitSawTimer > 0 && player.sawShieldCharges > 0) {
    player.sawShieldCharges = 0;
    player.invulnTimer = 0.85;
    if (isPitFall) { player.vy = -590; player.onGround = false; }
    playSfx('parry');
    projectiles.push({ kind: 'riot_saw', x: player.x + 36, y: player.y - 24, vx: player.vx + 680, vy: 0, r: 23, rot: 0, life: 1.8 });
    addPopup('⚙️ 电锯护盾挡伤!', player.x + 25, player.y - 92, '#c084fc');
    updateTopHUD();
    return;
  }

  const grad = getSurvivalGradient(runStats.singleRunDist);
  const baseHit = isPitFall ? 12 : rawDmg;
  // Strict Anti-One-Shot Cap (<= 24% MaxHP) + Continuous Non-Discrete Split (55% instant + 45% smooth dotPool bleed!)
  const maxSingleAllowed = Math.max(12, Math.round(player.maxHp * 0.24));
  let dmg = Math.min(maxSingleAllowed, Math.max(7, Math.round(baseHit * grad.dmgMult)));

  if (player.tempShieldHp > 0 && player.tempShieldTimer > 0) {
    const absorbed = Math.min(player.tempShieldHp, dmg);
    player.tempShieldHp = Math.max(0, player.tempShieldHp - absorbed);
    dmg -= absorbed;
    if (player.tempShieldHp <= 0) player.tempShieldTimer = 0;
    if (dmg <= 0) {
      player.invulnTimer = 0.58;
      if (isPitFall) { player.vy = -565; player.onGround = false; }
      playSfx('parry');
      addPopup(`🛡️ 护盾抵消 -${absorbed}!`, player.x + 18, player.y - 96, '#38bdf8', 18);
      refreshBuffChips();
      updateTopHUD();
      return;
    }
  }

  const inPartyHit = Boolean(partyCtrl && partyCtrl.isActive());
  const instantDmg = inPartyHit
    ? Math.max(26, Math.min(36, Math.round(rawDmg * 1.85)))
    : dmg;
  player.hp = Math.max(0, player.hp - instantDmg);
  player.dotPool = 0;
  player.regenPool = Math.max(0, player.regenPool * 0.45);
  player.vx = Math.min(player.vx, 255);
  player.vy = isPitFall ? -565 : -190;
  player.onGround = false;
  player.onRail = null;
  player.invulnTimer = 0.52;
  combo = 0; comboTag.classList.add('hidden');
  player.flameHolding = false;
  player.flameBurstTimer = 0;

  hurtOverlay.style.opacity = '1';
  setTimeout(() => { hurtOverlay.style.opacity = '0'; }, 190);
  hpBarBox.classList.remove('hurt-shake');
  void hpBarBox.offsetWidth;
  hpBarBox.classList.add('hurt-shake');

  hitStopTimer = 0.03; shakeTime = 0.18; shakeMag = 9;
  player.hurtPoseTimer = 0.40;
  playSfx('hurt');
  addPopup(isPitFall ? `⚡坠坑 -${instantDmg}` : `💥 -${instantDmg}`, player.x + 10, player.y - 98, '#fb7185', 18);
  updateTopHUD();

  if (player.hp <= 0) {
    if (partyCtrl && partyCtrl.isActive()) {
      partyCtrl.triggerPartyPlayerKO(isPitFall);
      return;
    }
    tryTriggerLethalDeathDashOrDie();
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
  if (superBonusTimer > 0) return;
  const tpl = drawRandomBossTemplate();
  const encIdx = bossCycleCount;
  bossCycleCount += 1;
  const grad = getSurvivalGradient(runStats.singleRunDist);
  // Boss HP scales directly with the Difficulty Coefficient (grad.dispMult) — Parry deals flat dmg so 铁山靠 never trivializes late Bosses!
  const baseTplHp = tpl.hp || 240;
  const scaledHp = Math.round(baseTplHp * (0.85 + 0.55 * grad.dispMult) + encIdx * 38);
  const tierLabels = ['初阶', '次阶', '中阶', '强敌', '狂暴', '霸主'];
  const dynTierLbl = tierLabels[Math.min(tierLabels.length - 1, encIdx)];
  activeBoss = {
    tier: Math.min(6, encIdx + 1), tierLbl: dynTierLbl, tierBg: tpl.tierBg,
    kind: tpl.kind, sprite: tpl.sprite, name: tpl.name,
    maxHp: scaledHp, hp: scaledHp,
    dmgRate: 28 + Math.min(18, encIdx * 2.5), dmgBudget: 56, maxBudget: 78,
    phase: 1, maxPhases: encIdx >= 2 ? 3 : 2,
    reward: 65 + encIdx * 28,
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

function spawnPartyRaceBoss(detIndex = 0) {
  if (activeBoss) return;
  const tpl = BOSS_ROSTER[Math.abs(Math.floor(detIndex)) % BOSS_ROSTER.length] || BOSS_ROSTER[0];
  const raceBossHp = 135;
  activeBoss = {
    tier: 2, tierLbl: '竞速', tierBg: tpl.tierBg,
    kind: tpl.kind, sprite: tpl.sprite, name: tpl.name,
    maxHp: raceBossHp, hp: raceBossHp,
    dmgRate: 36, dmgBudget: 75, maxBudget: 95,
    phase: 1, maxPhases: 2,
    reward: 45,
    partySpawnDist: runStats.dist,
    worldX: player.x + 330, yOff: 0,
    skillIdx: 0, minionTimer: 7.5,
    stunTimer: 0, flashTimer: 0
  };
  initBossCustomState(activeBoss, player.x);
  bossHazards.length = 0;
  refreshBossHudUI();
  bossHud.classList.remove('hidden');
  playSfx('crater');
  startBossBgm();
  playCriticalMomentVoice('boss_spawn', tpl.kind);
}

function hitBoss(dmg, causesStun = false, isCounter = false, isSkill = false) {
  if (!activeBoss) return;
  let dealt = 0;
  if (isCounter) {
    // Parry is a flat guard-break + stun opener (~18~32 HP), never % maxHp!
    dealt = dmg;
  } else if (isSkill) {
    // Hero Active Skills are the Primary Boss-Killer DPS (bypass dmgBudget + gain +40% bonus on stunned Bosses!)
    const stunMult = activeBoss.stunTimer > 0 ? 1.40 : 1.0;
    dealt = dmg * stunMult;
  } else {
    const mult = activeBoss.stunTimer > 0 ? 1.25 : 1.0;
    const raw = dmg * mult;
    if (activeBoss.dmgBudget >= raw) {
      dealt = raw;
      activeBoss.dmgBudget -= raw;
    } else {
      dealt = Math.max(raw * 0.50, activeBoss.dmgBudget);
      activeBoss.dmgBudget = 0;
    }
  }
  if (dealt <= 0.2) return;

  activeBoss.flashTimer = isCounter ? 0.24 : 0.14;
  activeBoss.hitSquash = isCounter ? 1.0 : 0.72;
  activeBoss.recoilX = Math.min(52, (activeBoss.recoilX || 0) + (isCounter ? 36 : 14));
  const minAllowedBossHp = (tutorialSession.active && tutorialSession.step === 9) ? 48 : 0;
  activeBoss.hp = Math.max(minAllowedBossHp, activeBoss.hp - dealt);

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
    if (partyCtrl && partyCtrl.isActive()) {
      partyCtrl.onPartyBossDefeated(bossName);
    } else {
      addSuperCharge(6.0);
      bankRunProgress(true);
      showToast(`🏆 击败${bossName} · 赏金 +${rewardBeans}🌿!`);
    }
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
  const supTalentPct = getTalentLvFromSave(store.save, 'superCharge') * 5 + (activeRunHeroId === 'pelican' ? 10 : 0);
  const supTxt = superBonusTimer > 0
    ? `🌈 超级奖励 ${superBonusTimer.toFixed(1)}s`
    : `🌈 超级奖励 ${pct}%${supTalentPct > 0 ? ` (+${supTalentPct}%)` : ''}`;
  setTextCached('supLbl', superBarLbl, supTxt);
}

// ==================== 60FPS ZERO-LEAK MAIN UPDATE LOOP ====================
let chipUiTick = 0;

function findHomingTarget(px, py) {
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < enemyShots.length; i++) {
    const sh = enemyShots[i];
    if (sh.dead || sh.parried || sh.kind === 'spike_roller') continue;
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

  tickTutorialDirector(realDt);
  if (tutorialSession.active && tutorialSession.pausedForPrompt) {
    syncControlsUI();
    updateTopHUD();
    return;
  }
  const dt = (tutorialSession.active ? tutorialSession.timeScale : 1.0) * realDt;
  const h = getHero();

  if (player.regenPool > 0.01 && player.hp < player.maxHp) {
    const tickHeal = Math.min(player.regenPool, Math.max(9, player.maxHp * 0.11) * realDt);
    player.hp = Math.min(player.maxHp, player.hp + tickHeal);
    player.regenPool = Math.max(0, player.regenPool - tickHeal);
  } else if (player.hp >= player.maxHp) {
    player.regenPool = 0;
  }

  // Talent #3: 💚 Auto HP Regen every 5.0s (0 / 1 / 2 / 3 / 4 / 5 HP per 5s)
  const autoRegenPer5s = getAutoRegenPer5sFromSave(store.save);
  if (autoRegenPer5s > 0 && state === 'PLAYING') {
    player.autoRegenTimer = (player.autoRegenTimer ?? 5.0) - realDt;
    if (player.autoRegenTimer <= 0) {
      player.autoRegenTimer += 5.0;
      if (player.hp < player.maxHp) {
        if (player.dotPool > 0) player.dotPool = Math.max(0, player.dotPool - autoRegenPer5s * 0.5);
        player.hp = Math.min(player.maxHp, player.hp + autoRegenPer5s);
        addPopup(`💚+${autoRegenPer5s}`, player.x + 12, player.y - 88, '#4ade80', 15);
      }
    }
  }

  // Crisp Collision-Only HP Rules: ZERO post-hit delayed ghost bleed & ZERO invisible air-drain!
  player.dotPool = 0;
  player.displayHp += (player.hp - player.displayHp) * Math.min(1, realDt * 13);
  if (player.trailHp > player.displayHp) {
    player.trailHp = Math.max(player.displayHp, player.trailHp - Math.max(14, player.maxHp * 0.18) * realDt);
  } else {
    player.trailHp = player.displayHp;
  }

  autoSaveTimer -= realDt;
  if (autoSaveTimer <= 0) {
    autoSaveTimer = 3.5; // Throttled save + live snapshot so page refresh never loses run progress!
    bankRunProgress(false);
    saveLivePveRunSnapshot();
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

  // Camera dynamically shifts & zooms for rear Boss pursuit AND Party neck-and-neck framing / Kun Rocket!
  const isPartyActive = Boolean(partyCtrl && partyCtrl.isActive());
  const partyKunRocket = isPartyActive && partyCtrl.isPureKunRocket && partyCtrl.isPureKunRocket();
  const partyFastSurge = isPartyActive && partyCtrl.isHighSpeedBoost && partyCtrl.isHighSpeedBoost();
  const partyCamHint = (isPartyActive && partyCtrl.getCameraFramingHint) ? partyCtrl.getCameraFramingHint() : null;
  const wantScreenRatio = (activeBoss && activeBoss.pinnedByHyper && superBonusTimer <= 0)
    ? 0.78
    : ((activeBoss && activeBoss.kind === 'dagou_jiao' && superBonusTimer <= 0)
      ? 0.39
      : (partyKunRocket ? 0.31 : (partyCamHint ? partyCamHint.ratio : (partyFastSurge ? 0.25 : 0.18))));
  smoothPlayerScreenRatio += (wantScreenRatio - smoothPlayerScreenRatio) * Math.min(1, realDt * 5.2);

  const targetZoom = (player.giantTimer > 0 || player.hyperDashActive || headStartTargetDist > 0 || superBonusTimer > 0 || player.thunderTongueTimer > 0 || partyKunRocket)
    ? 0.88
    : (partyCamHint ? partyCamHint.zoom : (partyFastSurge ? 0.93 : 1.0));
  smoothCamZoom += (targetZoom - smoothCamZoom) * Math.min(1, realDt * 4.5);
  const targetRefY = superBonusTimer > 0 ? -220 : Math.min(player.y, getBaseSurfaceY(player.x) + 35);
  smoothCamRefY += (targetRefY - smoothCamRefY) * Math.min(1, realDt * 6.8);

  if (combo > 0) { comboTimer -= realDt; if (comboTimer <= 0) { combo = 0; comboTag.classList.add('hidden'); } }
  if (shakeTime > 0) shakeTime -= realDt;
  if (player.invulnTimer > 0) player.invulnTimer -= realDt;
  if (player.hurtPoseTimer > 0) player.hurtPoseTimer -= realDt;
  if (player.whiffResetTimer > 0) {
    player.whiffResetTimer -= realDt;
    if (player.whiffResetTimer <= 0) player.whiffStreak = 0;
  }
  if (player.strikeTimer > 0) {
    player.strikeTimer -= realDt;
    let midLungeHit = false;
    for (let i = 0; i < enemies.length; i++) {
      if ((player.strikeHitCount || 0) >= 2 && !tutorialSession.active) break;
      const en = enemies[i];
      if (en.hit || en.swallowing || en.isTutStep1) continue;
      const ey = getEnemyWorldY(en);
      const dx = en.x - player.x;
      if (dx > -22 && dx < 148 && Math.abs((ey - 24) - (player.y - 38)) < 84) {
        en.shielded = false;
        defeatEnemy(en);
        player.strikeHitCount = (player.strikeHitCount || 0) + 1;
        midLungeHit = true;
        player.invulnTimer = Math.max(player.invulnTimer, 0.14);
      }
    }
    for (let i = 0; i < enemyShots.length; i++) {
      const sh = enemyShots[i];
      if (!sh.dead && sh.kind === 'spike_roller' && !sh.clangShown) {
        if (sh.x - player.x > 0 && sh.x - player.x < 125 && Math.abs(sh.y - (player.y - 24)) < 70) {
          sh.clangShown = true;
          playSfx('bean');
          addPopup('⚙️ 贴地刺轮需【起跳】躲避!', sh.x, sh.y - 46, '#fda4af', 16);
        }
      }
    }
    for (let i = 0; i < laserGates.length; i++) {
      const lg = laserGates[i];
      if (!lg.hacked && lg.x - player.x > -20 && lg.x - player.x < 150) {
        lg.hacked = true;
        lg.passed = true;
        midLungeHit = true;
        playSfx('parry');
        player.invulnTimer = Math.max(player.invulnTimer, 0.16);
      }
    }
    for (let i = 0; i < snowballs.length; i++) {
      const sb = snowballs[i];
      if (!sb.smashed && sb.x - player.x > -22 && sb.x - player.x < 150) {
        sb.smashed = true;
        midLungeHit = true;
        playSfx('crater');
        player.invulnTimer = Math.max(player.invulnTimer, 0.16);
      }
    }
    if (midLungeHit && !player.strikeConnected) {
      player.strikeConnected = true;
      player.whiffStreak = 0;
      player.actionOverheat = false;
      player.actionCd = Math.min(player.actionCd, 0.36);
      player.actionMaxCd = 0.38;
    }
  }
  if (player.parryWindowTimer > 0) {
    player.parryWindowTimer = Math.max(0, player.parryWindowTimer - realDt);
    tryExecuteParrySweep();
  }
  if (player.actionCd > 0) {
    player.actionCd = Math.max(0, player.actionCd - realDt);
    if (player.actionCd <= 0) player.actionOverheat = false;
  }
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
      player.hyperReleaseGrace = Math.max(player.hyperReleaseGrace, tutorialSession.active ? 1.65 : 0.24);
    } else {
      player.hyperReleaseGrace -= realDt;
    }
    const curE = Math.min(30, Math.max(0, Number(store.save.dashEnergy) || 0));
    if (player.hyperReleaseGrace <= 0 || curE <= 0.02 || player.hyperSessionSec >= 10.0) {
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

      // Bridge nearby pits & smash everything in path (wide sweep for 5.0x Hyper Dash speed!)
      for (let i = 0; i < pits.length; i++) {
        if (!pits[i].bridged && Math.abs(pits[i].x - player.x) < 380) pits[i].bridged = true;
      }
      checkEnvironmentImpactArea(player.x + 115, player.y - 48, 175);
      for (let i = 0; i < enemies.length; i++) {
        if (!enemies[i].hit && Math.abs(enemies[i].x - player.x) < 265) {
          enemies[i].shielded = false; defeatEnemy(enemies[i]);
        }
      }
      for (let i = 0; i < snowballs.length; i++) {
        if (!snowballs[i].smashed && Math.abs(snowballs[i].x - player.x) < 250) snowballs[i].smashed = true;
      }
      for (let i = 0; i < cashTrucks.length; i++) {
        if (!cashTrucks[i].dead && Math.abs(cashTrucks[i].x - player.x) < 250) hitCashTruck(cashTrucks[i], 10);
      }
      for (let i = 0; i < enemyShots.length; i++) {
        if (!enemyShots[i].dead && Math.abs(enemyShots[i].x - player.x) < 265) enemyShots[i].dead = true;
      }
      for (let i = 0; i < laserGates.length; i++) {
        if (!laserGates[i].hacked && Math.abs(laserGates[i].x - player.x) < 265) { laserGates[i].hacked = true; laserGates[i].passed = true; }
      }

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
            addPopup('💥 已削至残血 · 松手终结!', activeBoss.worldX - 55, getBaseSurfaceY(wallX) - 115, '#fde047', 17);
          } else {
            addPopup('💥 壁垒强压!!', activeBoss.worldX - 35, getBaseSurfaceY(wallX) - 108, '#fde047', 18);
          }
        }
      }
    }
  }
  for (let i = 0; i < hyperGhosts.length; i++) hyperGhosts[i].life -= realDt;
  compactInPlace(hyperGhosts, (g) => g.life > 0);

  if (player.vx > 480 && speedLines.length < 18 && Math.random() < 0.60) {
    const edgeY = Math.random() < 0.5 ? (Math.random() * H * 0.28) : (H * 0.72 + Math.random() * H * 0.26);
    speedLines.push({ x: W + 20, y: edgeY, len: 70 + Math.random() * 110, life: 0.22, maxLife: 0.22 });
  }
  for (let i = 0; i < speedLines.length; i++) { speedLines[i].x -= 1850 * realDt; speedLines[i].life -= realDt; }
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
      player.mortarShotTick = 0.32;
      playSfx('crater');
      const mBack = Boolean(activeBoss && superBonusTimer <= 0 && activeBoss.worldX < player.x);
      // Twin-shell smart-targeting carpet-bomb salvo!
      for (let salvoIdx = 0; salvoIdx < 2; salvoIdx++) {
        let aimX = player.x + (mBack ? (-230 - salvoIdx * 170) : (250 + salvoIdx * 230));
        if (activeBoss && superBonusTimer <= 0 && salvoIdx === 0) {
          aimX = activeBoss.worldX;
        } else {
          for (let ei = 0; ei < enemies.length; ei++) {
            const en = enemies[ei];
            if (!en.hit && en.x > player.x + 80 + salvoIdx * 160 && en.x < player.x + 760) {
              aimX = en.x;
              break;
            }
          }
        }
        const flightT = 0.48 + salvoIdx * 0.12;
        const launchX = player.x - 24;
        const launchY = player.y - 84;
        const landY = (superBonusTimer > 0 ? -220 : getBaseSurfaceY(aimX)) - 18;
        const reqVx = (aimX + player.vx * flightT * 0.42 - launchX) / flightT;
        const reqVy = (landY - launchY - 0.5 * 1050 * flightT * flightT) / flightT;
        projectiles.push({
          kind: 'mortar_shell',
          x: launchX,
          y: launchY,
          vx: Math.max(player.vx - 720, Math.min(player.vx + 980, reqVx)),
          vy: Math.max(-540, Math.min(-210, reqVy)),
          r: 25,
          rot: 0,
          life: 2.2
        });
      }
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
    fp.x += fp.vx * dt;
    fp.y += fp.vy * dt - (fp.kind === 'dust' ? 8 : 28) * dt;
    fp.r = Math.max(1.5, fp.r + ((fp.kind === 'bean_spark' || fp.kind === 'gold_spark') ? -8 : (fp.kind === 'dust' ? 14 : 24)) * dt);
    fp.life -= realDt;
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
    if (partyCtrl && partyCtrl.isActive() && partyCtrl.tryHitRivalWithHeroSkill) {
      partyCtrl.tryHitRivalWithHeroSkill(player.x + 175, player.y - 54, 240, 34, '🦩 大嘴鲸吞');
    }
    for (let i = 0; i < enemyShots.length; i++) {
      const sh = enemyShots[i];
      if (!sh.dead && sh.x > player.x - 20 && sh.x < player.x + 420 && Math.abs(sh.y - mouthY) < 125) {
        if (beans.length < 280) beans.push({ x: sh.x, y: sh.y, val: 2, giant: true, taken: false });
        sh.dead = true;
      }
    }
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing || en.isTutStep1) continue;
      const ey = getEnemyWorldY(en);
      if (en.x > player.x - 15 && en.x < player.x + 440 && Math.abs((ey - 24) - mouthY) < 125) {
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
      for (let w = 0; w < 3; w++) {
        projectiles.push({ kind: 'fish_shot', x: player.x + (pBack ? -30 - w * 22 : 50 + w * 22), y: mouthY + 10 - w * 8, vx: player.vx + (pBack ? -640 : 780), vy: -45 - w * 35, r: 18, rot: 0, life: 1.9, isSkillShot: true });
      }
      pushCapped(shockwaves, { x: mouthX + 10, y: mouthY + 20, r: 12, maxR: 170, life: 0.25, color: '#38bdf8', harmless: false }, 12);
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
      if (en.tutStep6) tutorialSession.step6Kills = (tutorialSession.step6Kills || 0) + 1;
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
    if (partyCtrl && partyCtrl.isActive() && partyCtrl.tryHitRivalWithHeroSkill) {
      partyCtrl.tryHitRivalWithHeroSkill(cx + 120, cy, 275, 34, '⚡ 雷霆长舌');
    }
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
        if (!cashTrucks[i].dead && Math.hypot(cashTrucks[i].x - cx, (cashTrucks[i].y - 28) - cy) < tongueR) hitCashTruck(cashTrucks[i], 1);
      }
      if (activeBoss) {
        const bossHitY = getBaseSurfaceY(activeBoss.worldX) - 56 + (activeBoss.yOff || 0);
        if (Math.hypot(activeBoss.worldX - cx, bossHitY - cy) < tongueR + 35) {
          handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
          hitBoss(13.5, false, false, true);
        }
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
  if (!(partyCtrl && partyCtrl.isActive()) && !tutorialSession.active && superBonusTimer <= 0) {
    if ((player.skyZoneStage || 0) < 1 && runStats.dist >= 1500) {
      player.skyZoneStage = 1;
      showToast('🔨 进入 1.5km 高空钟摆区：看准轨迹穿加速环！');
    } else if ((player.skyZoneStage || 0) < 2 && runStats.dist >= 3000) {
      player.skyZoneStage = 2;
      showToast('⚡ 进入 3.0km 高频双摆锤走廊：疏密波次升级！');
    }
  }

  if (player.midasTimer > 0) player.midasTimer = Math.max(0, player.midasTimer - realDt);
  if (player.ringBoostTimer > 0) {
    player.ringBoostTimer = Math.max(0, player.ringBoostTimer - realDt);
    if (player.ringBoostTimer <= 0) player.ringBoostGold = false;
    else if (Math.random() < 0.65) {
      pushCapped(speedLines, {
        x: Math.random() * W * 0.85,
        y: Math.random() * H * 0.72,
        len: 54 + Math.random() * 68,
        life: 0.18,
        maxLife: 0.18
      }, 28);
    }
  }
  if (player.skyWingsTimer > 0) {
    player.skyWingsTimer = Math.max(0, player.skyWingsTimer - realDt);
    if (!player.onGround && player.vy > 75) player.vy = 75;
  }
  if (player.thunderAuraTimer > 0) {
    player.thunderAuraTimer = Math.max(0, player.thunderAuraTimer - realDt);
    player.thunderAuraTick = (player.thunderAuraTick || 0) - realDt;
    if (player.thunderAuraTick <= 0) {
      player.thunderAuraTick = 0.22;
      const ay = player.y - 46;
      for (let i = 0; i < enemies.length; i++) {
        if (!enemies[i].hit && Math.hypot(enemies[i].x - player.x, (getEnemyWorldY(enemies[i]) - 24) - ay) < 215) {
          enemies[i].shielded = false;
          defeatEnemy(enemies[i]);
        }
      }
      for (let i = 0; i < laserGates.length; i++) {
        if (!laserGates[i].hacked && Math.hypot(laserGates[i].x - player.x, (getBaseSurfaceY(laserGates[i].x) - 42) - ay) < 215) {
          laserGates[i].hacked = true;
          laserGates[i].passed = true;
        }
      }
      for (let i = 0; i < enemyShots.length; i++) {
        if (!enemyShots[i].dead && Math.hypot(enemyShots[i].x - player.x, enemyShots[i].y - ay) < 200) enemyShots[i].dead = true;
      }
      if (activeBoss && superBonusTimer <= 0) {
        const bossHitY = getBaseSurfaceY(activeBoss.worldX) - 56 + (activeBoss.yOff || 0);
        if (Math.hypot(activeBoss.worldX - player.x, bossHitY - ay) < 245) {
          hitBoss(9.5, false, false, true);
        }
      }
    }
  }

  const isPartyMode = Boolean(partyCtrl && partyCtrl.isActive());
  const curNormalVx = isPartyMode ? player.baseSpeed : (player.baseSpeed + grad.speedAdd);
  let desiredVx = curNormalVx;
  if (isPartyMode) {
    const surfaceMult = onIce ? 1.18 : (inMud ? 0.76 : 1.0);
    const smallBoost = player.boostTimer > 0 ? 1.15 : 1.0;
    const ropeDelta = partyCtrl.getRopeSpeedDelta ? partyCtrl.getRopeSpeedDelta() : 0;
    desiredVx = Math.max(60, Math.round(curNormalVx * surfaceMult * smallBoost * partyCtrl.getSpeedMultiplier() + ropeDelta));
  } else if (headStartTargetDist > 0) desiredVx = Math.round(curNormalVx * 3.15);
  else if (player.hyperDashActive) {
    // PvE-Only: Exact 5.0x of current normal speed during Hyper Dash (2.15x when pinning Boss)!
    desiredVx = Math.round(curNormalVx * (activeBoss && activeBoss.pinnedByHyper ? 2.15 : 5.0));
  }
  else if (player.rocketDashTimer > 0) {
    // PvE-Only: Exact 2.0x of current normal speed during in-run Nitro Prop Dash!
    desiredVx = Math.round(curNormalVx * 2.0);
  }
  else if (superBonusTimer > 0) desiredVx = Math.round(curNormalVx * 1.42);
  else if (player.ringBoostTimer > 0) desiredVx = Math.round(curNormalVx * (player.ringBoostGold ? 1.68 : 1.46));
  else if (player.boostTimer > 0 || player.giantTimer > 0 || player.skyWingsTimer > 0 || onIce) desiredVx *= onIce ? 1.22 : 1.18;
  else if (inMud) desiredVx *= 0.75;
  const vxLerpRate = (isPartyMode || player.hyperDashActive || player.rocketDashTimer > 0 || headStartTargetDist > 0) ? 24 : 10;
  player.vx += (desiredVx - player.vx) * Math.min(1, dt * vxLerpRate);

  const isPartyKunFlight = isPartyMode && partyCtrl.isPureKunRocket && partyCtrl.isPureKunRocket();
  if (headStartTargetDist > 0) {
    player.x += player.vx * dt;
    const flyY = getBaseSurfaceY(player.x) - 115;
    player.y += (flyY - player.y) * Math.min(1, dt * 10);
    player.vy = 0; player.onGround = false; player.angle = -0.06;
    for (let i = 0; i < enemies.length; i++) if (!enemies[i].hit && Math.abs(enemies[i].x - player.x) < 150) defeatEnemy(enemies[i]);
    if (runStats.dist >= headStartTargetDist) {
      headStartTargetDist = 0;
      if (deathDashActive) {
        deathDashActive = false;
        player.hp = 0;
        refreshBuffChips();
        enterFinalDyingState();
        return;
      }
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
  } else if (player.rocketDashTimer > 0 || isPartyKunFlight) {
    player.x += player.vx * dt;
    const flyY = superBonusTimer > 0 ? -290 : getBaseSurfaceY(player.x) - (isPartyKunFlight ? 72 : 95);
    player.y += (flyY - player.y) * Math.min(1, dt * 12);
    player.vy = 0; player.onGround = false; player.angle = -0.06;
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
  if (!isPartyMode && curStageIdx !== stageIndex && superBonusTimer <= 0) {
    prevStageIndex = stageIndex;
    stageFadeTimer = 1.0;
    stageIndex = curStageIdx;
    showToast(STAGES[stageIndex].name);
  }

  if (!isPartyMode && recordFlag && !recordFlag.passed && player.x >= recordFlag.x) {
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

  if (!isPartyMode && !activeBoss && superBonusTimer <= 0 && runStats.dist >= nextTruckDist) {
    nextTruckDist = runStats.dist + 380;
    const tx = player.x + 480;
    cashTrucks.push({ x: tx, y: getBaseSurfaceY(tx), hp: 6, dead: false, flash: 0 });
    showToast('🚨 装甲运钞车！用技能或踩顶打爆它!');
  }
  if (!isPartyMode && !activeBoss && superBonusTimer <= 0 && headStartTargetDist <= 0 && runStats.dist >= nextBossDist) {
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
      if (h.id === 'pelican' && !(tutorialSession.active && tutorialSession.step === 3) && jumpHeld && player.vy > 40) {
        grav = 400; player.vy = Math.min(player.vy, 145);
      } else if (!jumpHeld && player.vy < -170) {
        grav = 2020;
      }
      player.vy += grav * dt;
      player.y += player.vy * dt;

      if (tState.isPit && player.y > tState.baseY + 84) {
        if (player.giantTimer > 0) {
          player.y = tState.baseY; player.vy = -560;
        } else if (isPartyMode) {
          if (!partyCtrl.tryConsumeOneHitShield(true)) {
            if (partyCtrl.triggerPelicanRescue) partyCtrl.triggerPelicanRescue(true);
            else partyCtrl.triggerPartyPlayerKO(true);
          }
        } else {
          player.x += 55;
          player.y = tState.baseY - 75;
          player.jumpsLeft = getMaxJumps();
          takePlayerDamage(16, true);
        }
      } else if (!tState.isPit && player.y >= gY) {
        const impactVy = player.vy;
        player.y = gY; player.vy = 0;
        player.onGround = true;
        player.jumpsLeft = getMaxJumps();
        player.angle = gSlope;
        player.jiggleVel = 210;
        if (impactVy > 220) {
          for (let d = 0; d < 5; d++) {
            pushCapped(flamePuffs, {
              kind: 'dust',
              x: player.x - 24 + d * 12,
              y: gY - 2,
              vx: player.vx * 0.35 + (d - 2) * 55,
              vy: -25 - Math.random() * 45,
              r: 7 + Math.random() * 6,
              life: 0.26,
              maxLife: 0.26
            }, 64);
          }
        }
      } else {
        player.angle += (Math.max(-0.42, Math.min(0.42, player.vy * 0.0007)) - player.angle) * dt * 8;
      }
    } else {
      player.y = gY;
      player.coyoteTimer = 0.14;
      player.angle += (gSlope - player.angle) * Math.min(1, dt * 14);
    }
  }

  // Anti-Air-Camping Sky Interceptor (PvE only): prolonged passive empty-air hovering summons active high-altitude threats!
  if (!isPartyMode && !tutorialSession.active && superBonusTimer <= 0 && headStartTargetDist <= 0 && !player.hyperDashActive && player.rocketDashTimer <= 0) {
    const airAlt = getBaseSurfaceY(player.x) - player.y;
    if (!player.onGround && !player.onRail && (player.ringBoostTimer || 0) <= 0 && airAlt > 110) {
      player.airCampSec = (player.airCampSec || 0) + dt;
      if (player.airCampSec >= 2.25) {
        player.airCampSec = 0.25;
        const ix = player.x + 690;
        const targetH = Math.max(135, Math.min(415, Math.round(airAlt)));
        enemies.push({
          x: ix,
          kind: 'drone',
          isSkyShooter: true,
          shotDone: false,
          windupTimer: 0.34,
          flyH: targetH,
          hit: false,
          phase: Math.random() * 6
        });
      }
    } else {
      player.airCampSec = 0;
    }
  }

  spawnWorldAhead();

  // Pickup Props (Includes Sky-Parachute Airdrops that hold high in the sky until inside the visible screen!)
  const camForProps = getCamera();
  const skyDropTriggerWX = Math.min(camForProps.camX + (W / camForProps.worldScale) * 0.90, player.x + 650);
  const propTouchR = (player.giantTimer > 0 || player.hyperDashActive) ? 95 : 72;
  for (let i = 0; i < worldProps.length; i++) {
    const wp = worldProps[i];
    if (wp.taken) continue;
    wp.phase += dt * 3.4;
    if (wp.parachute) {
      if (wp.x > skyDropTriggerWX) {
        // Hold high in the sky while off-screen ahead so it visibly floats down across the player's screen!
        wp.y = getBaseSurfaceY(wp.x) - 385;
      } else {
        wp.x += player.vx * 0.54 * dt + Math.sin(wp.phase * 1.15) * 42 * dt;
        wp.y += 96 * dt; // Drifts down onto Sky Tier 1 / Tier 2 (rewarding jumping & aerial routes!)
        const landingY = getBaseSurfaceY(wp.x) - (wp.hoverH || 154);
        if (wp.y >= landingY) {
          wp.y = landingY;
          wp.baseY = landingY;
          wp.parachute = false;
        }
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

    // Aerial Boost Rings (`⚡ 涡轮加速环` / `🌟 黄金加速环` in PvE)
    for (let i = 0; i < skyRings.length; i++) {
      const rg = skyRings[i];
      rg.spin += realDt * 3.6;
      rg.y = rg.baseY + Math.sin(rg.spin * 0.82) * 6;
      if (rg.cd > 0) rg.cd = Math.max(0, rg.cd - realDt);
      if (rg.cd <= 0 && Math.hypot(player.x - rg.x, (player.y - 42) - rg.y) < 58) {
        rg.cd = 1.5;
        player.ringBoostTimer = Math.max(player.ringBoostTimer || 0, rg.isGold ? 1.95 : 1.45);
        player.ringBoostGold = Boolean(player.ringBoostGold || rg.isGold);
        player.invulnTimer = Math.max(player.invulnTimer, 0.35);
        player.vy = Math.min(player.vy, rg.isGold ? -245 : -185);
        player.onGround = false;
        player.jumpsLeft = Math.max(player.jumpsLeft, rg.isGold ? getMaxJumps() : Math.max(1, getMaxJumps() - 1));
        runStats.beans += rg.isGold ? 5 : 2;
        addSuperCharge(rg.isGold ? 0.24 : 0.12);
        playSfx('hyper');
        pushCapped(shockwaves, {
          x: rg.x,
          y: rg.y,
          r: 20,
          maxR: rg.isGold ? 210 : 165,
          life: 0.28,
          color: rg.isGold ? '#fde047' : '#38bdf8',
          harmless: true
        }, 12);
        addPopup(rg.isGold ? '⚡ 黄金加速环!' : '⚡ 穿环涡轮加速!', rg.x + 16, rg.y - 58, rg.isGold ? '#fde047' : '#38bdf8', 18);
        refreshBuffChips();
      }
    }

    // Aerial Bounce Bumper Balloons (`🎈 高空弹跳气球` in PvE & PvP)
    for (let i = 0; i < skyBumpers.length; i++) {
      const bm = skyBumpers[i];
      bm.phase += realDt * 2.8;
      bm.y = bm.baseY + Math.sin(bm.phase) * 7;
      if (bm.cd > 0) bm.cd = Math.max(0, bm.cd - realDt);
      if (bm.boing > 0) bm.boing = Math.max(0, bm.boing - realDt * 3.2);
      if (bm.cd <= 0 && Math.hypot(player.x - bm.x, (player.y - 38) - bm.y) < 52) {
        bm.cd = 0.38;
        bm.boing = 1.0;
        player.vy = -615;
        player.onGround = false;
        player.onRail = null;
        player.jumpsLeft = getMaxJumps();
        if (!isPartyMode) {
          runStats.beans += 2;
          addSuperCharge(0.10);
        }
        playSfx('jump');
        pushCapped(shockwaves, { x: bm.x, y: bm.y, r: 16, maxR: 135, life: 0.24, color: '#f43f5e', harmless: true }, 12);
        addPopup('🎈 高空弹跳!', bm.x, bm.y - 42, '#fda4af', 18);
      }
    }

    // Giant Swinging Sky Pendulums (`🔨 空中巨型大摆锤` — indestructible heavy terrain hazard, requires timing or high bounce!)
    const syncClockSec = (Date.now() % 3600000) * 0.001;
    for (let i = 0; i < pendulums.length; i++) {
      const pd = pendulums[i];
      pd.time = (pd.time || 0) + dt;
      if (pd.hitCd > 0) pd.hitCd = Math.max(0, pd.hitCd - realDt);
      if (pd.clangCd > 0) pd.clangCd = Math.max(0, pd.clangCd - realDt);
      if (pd.deflectedTimer > 0) pd.deflectedTimer = Math.max(0, pd.deflectedTimer - realDt);

      const tRef = pd.syncClock ? syncClockSec : pd.time;
      const curAng = pd.deflectedTimer > 0
        ? (Math.PI * 0.86)
        : (Math.sin(tRef * pd.omega + pd.phase) * pd.maxAng);
      pd.ang = curAng;
      const pivY = getBaseSurfaceY(pd.x) - pd.pivotH;
      pd.pivotY = pivY;
      pd.bobX = pd.x + Math.sin(curAng) * pd.armLen;
      pd.bobY = pivY + Math.cos(curAng) * pd.armLen;

      if (pd.deflectedTimer > 0) continue;
      const distBob = Math.hypot(player.x - pd.bobX, (player.y - 38) - pd.bobY);
      if (player.hyperDashActive || player.giantTimer > 0 || player.rocketDashTimer > 0 || headStartTargetDist > 0 || player.ringBoostTimer > 0) {
        if (distBob < pd.bobR + 36) {
          pd.deflectedTimer = 1.20;
          playSfx('parry');
          if (player.ringBoostTimer > 0 && !player.hyperDashActive) {
            runStats.beans += 3;
            addPopup('⚡ 穿环破锤 +3🌿!', pd.bobX, pd.bobY - 46, '#38bdf8', 18);
          }
          pushCapped(shockwaves, { x: pd.bobX, y: pd.bobY, r: 16, maxR: 175, life: 0.25, color: '#fde047', harmless: true }, 12);
        }
        continue;
      }
      if (player.strikeTimer > 0 && distBob < pd.bobR + 48 && pd.clangCd <= 0) {
        pd.clangCd = 0.95;
        playSfx('bean');
        addPopup('🔨 重锤不可平A打碎!', pd.bobX, pd.bobY - 38, '#fda4af', 16);
      }
      if (pd.hitCd <= 0 && distBob < pd.bobR + 10) {
        pd.hitCd = 0.85;
        takePlayerDamage(17, false, {
          cause: '🔨 空中巨型大摆锤',
          tip: '巨型大摆锤无法用铁山靠打碎！请观察摆动虚线抓空档穿过，或踩弹跳气球穿加速环越过！'
        });
      }
    }

    // Aerial Storm-Cloud Lightning Strikes & Floating Tesla Arcs (`⚡ 高空高压雷暴闪电`)
    for (let i = 0; i < skyLightnings.length; i++) {
      const lt = skyLightnings[i];
      lt.time = (lt.time || 0) + dt;
      if (lt.hitCd > 0) lt.hitCd = Math.max(0, lt.hitCd - realDt);
      if (lt.shortCircuitTimer > 0) {
        lt.shortCircuitTimer = Math.max(0, lt.shortCircuitTimer - realDt);
        lt.isWarning = false;
        lt.isFiring = false;
        continue;
      }
      const cyc = ((lt.time + lt.phase) % lt.period) / lt.period;
      lt.isWarning = cyc >= 0.34 && cyc < 0.58;
      lt.isFiring = cyc >= 0.58;

      if (!lt.isFiring) continue;
      const y1 = getBaseSurfaceY(lt.x1) - lt.h1;
      const y2 = getBaseSurfaceY(lt.x2) - lt.h2;
      const px = player.x, py = player.y - 40;
      const vx = lt.x2 - lt.x1, vy = y2 - y1;
      const lenSq = Math.max(1, vx * vx + vy * vy);
      const tProj = Math.max(0, Math.min(1, ((px - lt.x1) * vx + (py - y1) * vy) / lenSq));
      const nearX = lt.x1 + tProj * vx, nearY = y1 + tProj * vy;
      const distBolt = Math.hypot(px - nearX, py - nearY);

      if (player.hyperDashActive || player.giantTimer > 0 || player.rocketDashTimer > 0 || headStartTargetDist > 0 || player.ringBoostTimer > 0 || player.thunderAuraTimer > 0) {
        if (distBolt < 38) {
          lt.shortCircuitTimer = 1.25;
          playSfx('parry');
          if (!player.hyperDashActive) {
            runStats.beans += 3;
            addPopup('⚡ 穿环破雷 +3🌿!', nearX, nearY - 36, '#fde047', 18);
          }
          pushCapped(shockwaves, { x: nearX, y: nearY, r: 14, maxR: 165, life: 0.24, color: '#38bdf8', harmless: true }, 12);
        }
        continue;
      }
      if (lt.hitCd <= 0 && distBolt < 24) {
        lt.hitCd = 0.85;
        takePlayerDamage(16, false, {
          cause: '⚡ 高空雷暴闪电链',
          tip: '留意高空乌云与电极的黄色蓄电预警线，趁停电空档穿过，或穿涡轮加速环直接破雷！'
        });
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
          takePlayerDamage(15, false, {
            cause: '⚡ 高压激光电网',
            tip: '靠近激光电网前按【铁山靠】或角色技能可直接破除电网并获得冲刺加速！'
          });
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
          takePlayerDamage(15, false, {
            cause: '❄️ 极寒滚石巨雪球',
            tip: '迎面滚来的大雪球按【铁山靠】可直接撞碎爆绿豆，也可起跳踩顶借力！'
          });
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
      pr.vx = player.vx + bDir * 235;
      pr.vy += 1560 * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.rot += 6.5 * dt;
      pr.life -= dt;
      checkEnvironmentImpactArea(pr.x, pr.y, pr.r + 36);

      for (let j = 0; j < enemies.length; j++) {
        if (!enemies[j].hit && !enemies[j].swallowing && Math.hypot(pr.x - enemies[j].x, pr.y - (getEnemyWorldY(enemies[j]) - 24)) < pr.r + 44) {
          enemies[j].shielded = false; defeatEnemy(enemies[j]);
        }
      }
      const gy = (superBonusTimer > 0 ? -220 : getBaseSurfaceY(pr.x)) - pr.r;
      if (pr.y >= gy && pr.life > 0) {
        pr.y = gy;
        playSfx('jump');
        pushCapped(shockwaves, { x: pr.x, y: gy + pr.r, r: 18, maxR: 215, life: 0.24, color: '#fb923c', harmless: false }, 12);
        if (pr.bouncesLeft > 0) { pr.bouncesLeft -= 1; pr.vy = -525; }
        else pr.life = 0;
      }
      if (activeBoss && pr.life > 0 && (pr.bossHitCd || 0) <= 0 && Math.hypot(pr.x - activeBoss.worldX, pr.y - (getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff)) < pr.r + 65) {
        pr.bossHitCd = 0.42;
        pr.vy = -620;
        playSfx('parry');
        handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'projectile');
        hitBoss(48, true, false, true);
      }
      if (isPartyMode && pr.life > 0 && partyCtrl.tryHitRivalWithHeroSkill && partyCtrl.tryHitRivalWithHeroSkill(pr.x, pr.y, pr.r + 48, 42, '🏀 巨型篮球')) {
        pr.vy = -620;
      }
      continue;
    } else if (pr.kind === 'riot_saw') {
      pr.x += pr.vx * dt; pr.y = getBaseSurfaceY(pr.x) - pr.r; pr.rot += 20 * dt; pr.life -= dt;
      checkEnvironmentImpactArea(pr.x, pr.y, pr.r + 26);
      for (let j = 0; j < enemies.length; j++) if (!enemies[j].hit && !enemies[j].swallowing && Math.abs(pr.x - enemies[j].x) < pr.r + 32) { enemies[j].shielded = false; defeatEnemy(enemies[j]); }
    } else if (pr.kind === 'mortar_shell') {
      pr.vy += 1050 * dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.rot += 14 * dt; pr.life -= dt;
      const gy = (superBonusTimer > 0 ? -220 : getBaseSurfaceY(pr.x)) - 12;
      let hitSomething = pr.y >= gy;
      if (!hitSomething) {
        for (let j = 0; j < enemies.length; j++) {
          if (!enemies[j].hit && !enemies[j].swallowing && Math.hypot(pr.x - enemies[j].x, pr.y - (getEnemyWorldY(enemies[j]) - 24)) < pr.r + 42) {
            hitSomething = true; break;
          }
        }
      }
      if (!hitSomething) {
        for (let j = 0; j < cashTrucks.length; j++) {
          if (!cashTrucks[j].dead && Math.hypot(pr.x - cashTrucks[j].x, pr.y - (cashTrucks[j].y - 24)) < 68) {
            hitSomething = true; break;
          }
        }
      }
      if (!hitSomething && activeBoss && superBonusTimer <= 0) {
        if (Math.hypot(pr.x - activeBoss.worldX, pr.y - (getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff)) < pr.r + 74) {
          hitSomething = true;
        }
      }
      if (hitSomething && pr.life > 0) {
        const ex = pr.x, ey = Math.min(pr.y, gy);
        pr.life = 0;
        playSfx('crater');
        shakeTime = Math.max(shakeTime, 0.14);
        shakeMag = Math.max(shakeMag, 8);
        pushCapped(roadScars, { x: ex, y: getBaseSurfaceY(ex), r: 52 }, 10);
        pushCapped(shockwaves, { x: ex, y: ey, r: 18, maxR: 285, life: 0.32, color: '#f97316', harmless: false }, 12);
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          pushCapped(flamePuffs, { x: ex, y: ey - 6, vx: Math.cos(a) * 145, vy: Math.sin(a) * 120 - 55, r: 15, life: 0.30, maxLife: 0.30 }, 36);
        }
        checkEnvironmentImpactArea(ex, ey, 250);
        for (let j = 0; j < enemies.length; j++) {
          if (!enemies[j].hit && !enemies[j].swallowing && Math.hypot(enemies[j].x - ex, (getEnemyWorldY(enemies[j]) - 24) - ey) < 285) {
            enemies[j].shielded = false; defeatEnemy(enemies[j]);
          }
        }
        for (let j = 0; j < enemyShots.length; j++) {
          if (!enemyShots[j].dead && Math.hypot(enemyShots[j].x - ex, enemyShots[j].y - ey) < 260) enemyShots[j].dead = true;
        }
        for (let j = 0; j < snowballs.length; j++) {
          if (!snowballs[j].smashed && Math.hypot(snowballs[j].x - ex, snowballs[j].y - ey) < 260) snowballs[j].smashed = true;
        }
        for (let j = 0; j < cashTrucks.length; j++) {
          if (!cashTrucks[j].dead && Math.abs(cashTrucks[j].x - ex) < 245) hitCashTruck(cashTrucks[j], 4);
        }
        if (activeBoss && superBonusTimer <= 0) {
          const bossDist = Math.hypot(ex - activeBoss.worldX, ey - (getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff));
          if (bossDist < 285) {
            handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'projectile');
            hitBoss(bossDist < 105 ? 56.0 : 36.0, true, false, true);
          }
        }
      }
    } else {
      pr.vy += 1050 * dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.rot += 12 * dt; pr.life -= dt;
      checkEnvironmentImpactArea(pr.x, pr.y, pr.r + 28);
      for (let j = 0; j < cashTrucks.length; j++) {
        if (!cashTrucks[j].dead && Math.hypot(pr.x - cashTrucks[j].x, pr.y - (cashTrucks[j].y - 20)) < 58) { hitCashTruck(cashTrucks[j], 3); pr.life = 0; }
      }
      const gy = (superBonusTimer > 0 ? -220 : getBaseSurfaceY(pr.x)) - pr.r;
      if (pr.y >= gy && pr.life > 0) {
        pr.y = gy; playSfx('crater');
        pushCapped(shockwaves, { x: pr.x, y: gy + pr.r, r: 14, maxR: 165, life: 0.22, color: '#f97316', harmless: pr.kind === 'bowling_mob' }, 12);
        if (pr.bouncesLeft && pr.bouncesLeft > 0) { pr.bouncesLeft -= 1; pr.vy = -420; }
        else pr.life = 0;
      }
      for (let j = 0; j < enemies.length; j++) {
        if (pr.life <= 0) break;
        if (!enemies[j].hit && !enemies[j].swallowing && Math.hypot(pr.x - enemies[j].x, pr.y - (getEnemyWorldY(enemies[j]) - 24)) < pr.r + 32) {
          if (pr.kind === 'bowling_mob' && enemies[j].shielded) {
            pr.life = 0;
            break;
          }
          enemies[j].shielded = false; defeatEnemy(enemies[j]);
          if (pr.kind === 'fish_shot') pr.life = 0;
          else if (pr.kind === 'bowling_mob') {
            pr.pierceLeft = (pr.pierceLeft ?? 1) - 1;
            if (pr.pierceLeft <= 0) pr.life = 0;
          }
        }
      }
    }
    if (isPartyMode && pr.life > 0 && partyCtrl.tryHitRivalWithHeroSkill) {
      const pDmg = pr.kind === 'shark_bomb' ? 38 : (pr.kind === 'bowling_mob' ? 34 : 28);
      if (partyCtrl.tryHitRivalWithHeroSkill(pr.x, pr.y, (pr.r || 18) + 46, pDmg, '🎯 飞弹技能')) {
        pr.bouncesLeft = 0;
        pr.life = 0;
      }
    }
    if (activeBoss && pr.life > 0 && Math.hypot(pr.x - activeBoss.worldX, pr.y - (getBaseSurfaceY(activeBoss.worldX) - 54 + activeBoss.yOff)) < pr.r + 60) {
      pr.bouncesLeft = 0;
      pr.life = 0;
      handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'projectile');
      if (pr.kind === 'ikun_pinball') hitBoss(11.0, false, false);
      else if (pr.kind === 'bowling_mob') hitBoss(22.0, true, false);
      else if (pr.kind === 'shark_bomb') hitBoss(44.0, true, false, true);
      else if (pr.kind === 'mini_maodie') hitBoss(16.0, false, false, true);
      else if (pr.kind === 'fish_shot') hitBoss(pr.isSkillShot ? 28.0 : 12.0, false, false, Boolean(pr.isSkillShot));
      else if (pr.kind === 'riot_saw') hitBoss(18.0, false, false);
      else hitBoss(11.0, false, false);
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

  if (activeBoss && superBonusTimer <= 0 && !activeBoss.pinnedByHyper && !(tutorialSession.active && activeBoss.isTutorialBoss)) {
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

    if (activeBoss && hasBossImmediateParryCue(activeBoss, player)) parryGlow = true;
    if (activeBoss && hasBossImmediateJumpCue(activeBoss, player)) jumpGlow = true;

    if (isPartyMode && activeBoss) {
      if (partyCtrl.isKunRocketActive() && Math.abs(activeBoss.worldX - player.x) < 150) {
        hitBoss(75 * dt, false, false, true);
      }
      if (activeBoss && (runStats.dist - (activeBoss.partySpawnDist || 0)) > 290) {
        stopBossBgm();
        bossHud.classList.add('hidden');
        bossHud.classList.remove('enraged');
        enemyShots.length = 0;
        bossHazards.length = 0;
        activeBoss = null;
      }
    }
  }

  // Road & Sky Enemy + Shot Updates (Aggression & Shot Speed Scale Purely by Distance Tier!)
  if (superBonusTimer <= 0) {
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing || en.isTutStep1) continue;
      const distAhead = en.x - player.x;
      if (en.skyRushVx > 0 && distAhead < 860 && distAhead > -90) {
        en.x -= en.skyRushVx * dt;
      }
      if (en.kind === 'drone' && distAhead < 720 && distAhead > -80) {
        if (en.baseFlyH === undefined) en.baseFlyH = en.flyH || 112;
        if (grad.tier >= 2 || en.isSkyShooter) {
          en.flyH = en.baseFlyH + Math.sin(performance.now() * 0.0055 + (en.phase || 0)) * (14 + grad.tier * 5);
        }
        if (en.isSkyShooter && !en.shotDone && distAhead < 620 && distAhead > 185) {
          en.windupTimer = (en.windupTimer ?? 0.42) - dt;
          if (en.windupTimer <= 0) {
            en.shotDone = true;
            const ey = getEnemyWorldY(en);
            const playerAlt = Math.max(44, Math.min(245, Math.round(getBaseSurfaceY(player.x) - (player.y - 42))));
            enemyShots.push({
              kind: 'lawyer_orb',
              x: en.x - 20,
              y: ey - 22,
              targetH: playerAlt,
              vx: -(165 + grad.tier * 36),
              parried: false,
              rot: 0
            });
          }
        }
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
          if (player.giantTimer <= 0) {
            takePlayerDamage(16, false, {
              cause: '⚙️ 地面高速刺轮锯',
              tip: '地面高速刺轮锯不可用铁山靠硬挡！请提前【起跳】越过、走高空滑轨，或释放角色大招清场！'
            });
          }
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
          else {
            takePlayerDamage(14, false, {
              cause: '📜 追踪律师函飞弹',
              tip: '当飞行物进入身前光圈、铁山靠亮起时，按【铁山靠】可无伤完美弹反！'
            });
          }
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

  // Grounded Bean Collection (+ Midas 3x Gold Jar Boost!)
  const magR = (player.magnetTimer > 0 || player.midasTimer > 0 || player.hyperDashActive || superBonusTimer > 0 || headStartTargetDist > 0)
    ? 540
    : (player.giantTimer > 0 ? 120 : 62);

  for (let i = 0; i < beans.length; i++) {
    const b = beans[i];
    if (b.taken) continue;
    if (player.midasTimer > 0) b.giant = true;
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
      for (let sp = 0; sp < (b.giant ? 5 : 2); sp++) {
        pushCapped(flamePuffs, {
          kind: b.giant ? 'gold_spark' : 'bean_spark',
          x: b.x + (Math.random() - 0.5) * 14,
          y: b.y + (Math.random() - 0.5) * 14,
          vx: player.vx * 0.5 + (Math.random() - 0.5) * 90,
          vy: -40 - Math.random() * 65,
          r: b.giant ? 6.5 : 4.5,
          life: 0.22,
          maxLife: 0.22
        }, 64);
      }
    }
  }

  if (superBonusTimer <= 0 && !player.hyperDashActive) {
    const stompW = player.giantTimer > 0 ? 74 : 52;
    const bodyW = player.giantTimer > 0 ? 68 : 34;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing || en.isTutStep1) continue;
      const ey = getEnemyWorldY(en);
      const dx = Math.abs(en.x - player.x);
      if (dx >= stompW) continue;

      if (player.giantTimer > 0 || player.rocketDashTimer > 0 || headStartTargetDist > 0) {
        if (Math.abs((ey - 22) - (player.y - 34)) < bodyW) {
          en.shielded = false;
          defeatEnemy(en);
        }
        continue;
      }

      // Generous Mario-grade Head-Stomp Detection (68px vertical band above enemy ankles!)
      const isDroneStomp = (en.kind === 'drone' || (en.flyH > 0 && en.kind !== 'spiky_cat')) && player.vy > -55 && player.y <= ey + 16 && player.y >= ey - 60;
      const isGroundStomp = en.kind !== 'spiky_cat' && !player.onGround && player.vy > 12 && player.y <= ey + 4 && player.y >= ey - 64;
      if (isDroneStomp || isGroundStomp) {
        en.shielded = false;
        en.stompKilled = true;
        player.vy = en.kind === 'drone' ? -600 : -555;
        player.jumpsLeft = Math.max(1, player.jumpsLeft);
        defeatEnemy(en);
        continue;
      }

      if (dx < bodyW && Math.abs((ey - 22) - (player.y - 34)) < bodyW) {
        if (en.kind === 'spiky_cat') {
          en.hit = true;
          takePlayerDamage(13, false, {
            cause: '😾 炸毛尖刺耄耋猫',
            tip: '尖刺猫不可直接踩头！请用【铁山靠】正面撞飞或释放角色大招清场！'
          });
        } else {
          en.hit = true;
          const mobMeta = en.kind === 'boar_frog'
            ? { cause: '🐗 狂暴野猪蛙冲锋', tip: '野猪蛙蓄力猛冲时，可起跳踩头击杀，或按【铁山靠】当保龄球撞飞！' }
            : (en.kind === 'shield_lawyer'
              ? { cause: '🛡️ 持盾西装律师', tip: '护盾怪正面按【铁山靠】一击破盾撞飞，也能起跳踩头解决！' }
              : { cause: '👾 赛道拦路小怪', tip: '小怪既可起跳踩头连击，也能按【铁山靠】正面撞飞清场！' });
          takePlayerDamage(en.kind === 'boar_frog' ? 15 : 12, false, mobMeta);
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

  // Zero-allocation in-place world cleanup (preserves rival surroundings during Spectator Mode)!
  const rivalWX = (isPartyMode && partyCtrl.getRivalWorldX) ? partyCtrl.getRivalWorldX() : Infinity;
  const cut = isPartyMode
    ? (Math.min(cam.camX, Number.isFinite(rivalWX) ? rivalWX : cam.camX) - 1000)
    : (cam.camX - 280);
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
  compactInPlace(pendulums, (p) => p.x + p.armLen + 70 > cut);
  compactInPlace(skyLightnings, (lt) => Math.max(lt.x1, lt.x2) + 80 > cut);
  compactInPlace(skyRings, (rg) => rg.x + 70 > cut);
  compactInPlace(skyBumpers, (bm) => bm.x + 70 > cut);
  compactInPlace(checkpointFlags, (f) => f.x > cut);
  compactInPlace(worldProps, (w) => !w.taken && w.x > cut);
  compactInPlace(cashTrucks, (c) => !c.dead && c.x > cut);
  compactInPlace(roadScars, (s) => s.x > cut);
  compactInPlace(beans, (b) => !b.taken && b.x > cut);
  compactInPlace(enemies, (e) => !e.hit && e.x > cut);

  if (isPartyMode) {
    partyCtrl.updatePartyFrame(tutorialSession.active ? dt : realDt);
  }

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
  drawHubDioramaBackdrop(pCtx, cw, ch, now);

  const t = now * 0.008;
  drawSculptedBikeAndHero(pCtx, store.save.selectedHero, cw * 0.56, ch - 11, 0, t, t * 0.8, Math.sin(t * 2) * 2.2, store.save.mods, { scale: 0.58 });
  pCtx.restore();
}

function drawAtmosphereAndScenery(camX) {
  const st = STAGES[stageIndex];
  const pst = stageFadeTimer > 0 && prevStageIndex !== stageIndex ? STAGES[prevStageIndex] : null;
  drawBiomeAtmosphere(ctx, W, H, camX, st, pst, stageFadeTimer, bonusSkyAlpha, performance.now());
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

function drawSkyBoostRing(rg, now) {
  const isGold = rg.isGold;
  const used = rg.cd > 0;
  const primary = isGold ? '#facc15' : '#38bdf8';
  const secondary = isGold ? '#f97316' : '#0284c7';
  const rx = 20, ry = 42;
  ctx.save();
  ctx.translate(rg.x, rg.y);
  if (used) ctx.globalAlpha = 0.45;

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.ellipse(-4, 0, rx, ry, 0, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();

  ctx.strokeStyle = secondary;
  ctx.lineWidth = 7.5;
  ctx.beginPath();
  ctx.ellipse(-4, 0, rx, ry, 0, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();

  ctx.fillStyle = isGold ? 'rgba(250, 204, 21, 0.24)' : 'rgba(56, 189, 248, 0.24)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx - 2, ry - 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const chevOff = ((now * 0.045) % 16) - 8;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let k = -1; k <= 1; k += 2) {
    const cx = chevOff + k * 5;
    ctx.beginPath();
    ctx.moveTo(cx - 5, -11);
    ctx.lineTo(cx + 4, 0);
    ctx.lineTo(cx - 5, 11);
    ctx.stroke();
  }

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.ellipse(3, 0, rx, ry, 0, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();

  ctx.strokeStyle = primary;
  ctx.lineWidth = 7.5;
  ctx.beginPath();
  ctx.ellipse(3, 0, rx, ry, 0, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();

  ctx.strokeStyle = '#fef9c3';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(4, 0, rx, ry, 0, -Math.PI * 0.35, Math.PI * 0.35);
  ctx.stroke();

  for (const py of [-ry, ry]) {
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(-10, py - 6, 20, 12, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = primary;
    ctx.fillRect(-5, py - 2.5, 10, 5);
  }
  ctx.restore();
}

function drawSkyBumper(bm, now) {
  const squish = bm.boing > 0 ? Math.sin(bm.boing * Math.PI) : 0;
  const sx = 1 + squish * 0.28;
  const sy = 1 - squish * 0.24;
  const colMain = bm.theme === 1 ? '#8b5cf6' : '#f43f5e';
  const colRim = bm.theme === 1 ? '#38bdf8' : '#facc15';
  ctx.save();
  ctx.translate(bm.x, bm.y);
  ctx.scale(sx, sy);

  // Outer bounce aura ring
  ctx.strokeStyle = bm.theme === 1 ? 'rgba(56, 189, 248, 0.52)' : 'rgba(250, 204, 21, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 34 + Math.sin(now * 0.008 + bm.phase) * 2.5, 0, Math.PI * 2);
  ctx.stroke();

  // Mini bottom stabilizer basket
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-9, 24, 18, 10, 3);
  ctx.fill();
  ctx.stroke();

  // Main glossy carnival bounce balloon sphere
  ctx.fillStyle = colMain;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Equatorial bounce band
  ctx.fillStyle = colRim;
  ctx.beginPath();
  ctx.roundRect(-26, -5, 52, 10, 5);
  ctx.fill();
  ctx.stroke();

  // Specular top-left highlight & upward arrow badge
  ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
  ctx.beginPath();
  ctx.ellipse(-9, -12, 8, 5, -0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-7, -11);
  ctx.lineTo(0, -18);
  ctx.lineTo(7, -11);
  ctx.stroke();
  ctx.restore();
}

function drawSkyPendulum(pd, now) {
  const pivY = pd.pivotY !== undefined ? pd.pivotY : (getBaseSurfaceY(pd.x) - pd.pivotH);
  const ang = pd.ang || 0;
  ctx.save();
  ctx.translate(pd.x, pivY);

  // 1. Readable Dashed Swing-Arc Telegraph so players can time the gap from afar!
  ctx.strokeStyle = 'rgba(253, 224, 71, 0.30)';
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, pd.armLen, Math.PI * 0.5 - pd.maxAng, Math.PI * 0.5 + pd.maxAng);
  ctx.stroke();
  ctx.setLineDash([]);

  // 2. Twin-Thruster Sky Gantry Pulley Anchor
  const jetFlicker = 8 + Math.abs(Math.sin(now * 0.035 + pd.phase)) * 7;
  ctx.fillStyle = 'rgba(56, 189, 248, 0.78)';
  ctx.beginPath();
  ctx.ellipse(-22, 11, 5, jetFlicker, 0, 0, Math.PI * 2);
  ctx.ellipse(22, 11, 5, jetFlicker, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.roundRect(-30, -9, 60, 18, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#facc15';
  ctx.fillRect(-20, -4, 10, 8);
  ctx.fillRect(10, -4, 10, 8);

  // 3. Swinging Chain Arm & Heavy Pendulum Head
  ctx.save();
  ctx.rotate(-ang);

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 9.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, pd.armLen);
  ctx.stroke();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, pd.armLen);
  ctx.stroke();

  ctx.fillStyle = '#e2e8f0';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  for (let r = 28; r < pd.armLen - 26; r += 30) {
    ctx.beginPath();
    ctx.arc(0, r, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.translate(0, pd.armLen);
  // Danger rim glow
  ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
  ctx.beginPath();
  ctx.arc(0, 0, pd.bobR + 8, 0, Math.PI * 2);
  ctx.fill();

  if (pd.style === 'hammer') {
    // Giant Arcade Hazard Warhammer Head
    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(-34, -20, 14, 40, 5);
    ctx.roundRect(20, -20, 14, 40, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(-23, -17, 46, 34, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#facc15';
    ctx.fillRect(-15, -13, 9, 26);
    ctx.fillRect(6, -13, 9, 26);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(-19, -13, 38, 5);
  } else {
    // Giant Spiked Iron Wrecking Ball
    ctx.fillStyle = '#f87171';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.6;
    for (let s = 0; s < 8; s++) {
      const sa = (s / 8) * Math.PI * 2;
      ctx.save();
      ctx.rotate(sa);
      ctx.beginPath();
      ctx.moveTo(-5, -pd.bobR + 3);
      ctx.lineTo(0, -pd.bobR - 10);
      ctx.lineTo(5, -pd.bobR + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.arc(0, 0, pd.bobR - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.beginPath();
    ctx.arc(-8, -8, 6.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Top center pivot hub gear
  ctx.fillStyle = '#facc15';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSkyLightning(lt, now) {
  const y1 = getBaseSurfaceY(lt.x1) - lt.h1;
  const y2 = getBaseSurfaceY(lt.x2) - lt.h2;
  ctx.save();

  // 1. Telegraph or Active Jagged Multi-Forked Lightning Bolt!
  if (lt.shortCircuitTimer <= 0 && lt.isWarning) {
    const blink = 0.45 + 0.50 * Math.abs(Math.sin(now * 0.032));
    ctx.strokeStyle = `rgba(250, 204, 21, ${blink.toFixed(2)})`;
    ctx.lineWidth = 3.5;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(lt.x1, y1);
    ctx.lineTo(lt.x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(lt.x2, y2, 14 + Math.sin(now * 0.025) * 4, 0, Math.PI * 2);
    ctx.stroke();
  } else if (lt.shortCircuitTimer <= 0 && lt.isFiring) {
    const segs = 9;
    const dx = lt.x2 - lt.x1, dy = y2 - y1;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len, ny = dx / len;
    const tickSeed = Math.floor(now * 0.042);

    const traceJagged = () => {
      ctx.beginPath();
      ctx.moveTo(lt.x1, y1);
      for (let s = 1; s < segs; s++) {
        const u = s / segs;
        const hash = Math.sin(tickSeed * 1.9 + s * 3.7 + lt.x1 * 0.03);
        const jag = hash * 19;
        ctx.lineTo(lt.x1 + dx * u + nx * jag, y1 + dy * u + ny * jag);
      }
      ctx.lineTo(lt.x2, y2);
    };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Outer electric plasma halo
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
    ctx.lineWidth = 17;
    traceJagged();
    ctx.stroke();
    // High-voltage golden sheath
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 9;
    ctx.stroke();
    // White-hot lightning core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.8;
    ctx.stroke();

    // Side lightning forks
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2.6;
    for (const fIdx of [3, 6]) {
      const u = fIdx / segs;
      const side = (tickSeed + fIdx) % 2 === 0 ? 1 : -1;
      const mx = lt.x1 + dx * u, my = y1 + dy * u;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + nx * side * 28 + dx * 0.08, my + ny * side * 28 + dy * 0.08);
      ctx.stroke();
    }

    // Impact plasma burst at bottom/end
    ctx.fillStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.beginPath();
    ctx.arc(lt.x2, y2, 11 + (tickSeed % 3) * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Sculpted Storm-Cloud Emitter OR Twin Floating Tesla Coils
  if (lt.kind === 'storm_strike') {
    ctx.save();
    ctx.translate(lt.x1, y1);
    ctx.fillStyle = lt.isFiring ? '#312e81' : '#1e293b';
    ctx.strokeStyle = lt.isFiring ? '#fde047' : (lt.isWarning ? '#38bdf8' : '#0f172a');
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(-18, 2, 16, 0, Math.PI * 2);
    ctx.arc(18, 2, 16, 0, Math.PI * 2);
    ctx.arc(0, -7, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Lightning crest inside storm cloud
    ctx.fillStyle = lt.isFiring ? '#fde047' : '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(3, -14);
    ctx.lineTo(-6, -2);
    ctx.lineTo(1, -2);
    ctx.lineTo(-3, 10);
    ctx.lineTo(8, -4);
    ctx.lineTo(1, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Bottom receiver node so players clearly see where the bolt lands even while cooling!
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = lt.isFiring ? '#fde047' : '#38bdf8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(lt.x2, y2, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    for (const [cx, cy] of [[lt.x1, y1], [lt.x2, y2]]) {
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = lt.isFiring ? '#fde047' : (lt.isWarning ? '#f97316' : '#38bdf8');
      ctx.beginPath();
      ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
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
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < speedLines.length; i++) {
      const sl = speedLines[i];
      const u = Math.max(0.1, sl.life / (sl.maxLife || 0.22));
      ctx.globalAlpha = u * (player.hyperDashActive ? 0.78 : 0.42);
      ctx.strokeStyle = player.hyperDashActive ? '#fde047' : '#ffffff';
      ctx.lineWidth = player.hyperDashActive ? 3.5 : 2.2;
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(sl.x + sl.len, sl.y);
      ctx.stroke();
    }
    ctx.restore();
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

  drawSculptedTerrainAndRoad(ctx, {
    startWX,
    endWX,
    camY,
    viewHWorld: H / worldScale,
    st,
    pits,
    iceZones,
    mudZones,
    roadScars,
    getTerrainStateAt,
    getBaseSurfaceY,
    superBonusTimer,
    now: performance.now()
  });

  if (superBonusTimer <= 0) {
    for (let i = 0; i < checkpointFlags.length; i++) {
      const fl = checkpointFlags[i];
      if (fl.x > endWX) continue;
      const fy = getBaseSurfaceY(fl.x);
      ctx.save(); ctx.translate(fl.x, fy);
      ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 7.5;
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -104); ctx.stroke();
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = fl.passed ? '#4ade80' : '#f97316';
      ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -102); ctx.lineTo(56, -86); ctx.lineTo(0, -70); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#0f172a'; ctx.font = '900 10.5px sans-serif';
      ctx.fillText(`${fl.dist}m`, 6, -83);
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
      if (rl.x > endWX || rl.x + rl.len < startWX) continue;
      const x1 = rl.x, x2 = rl.x + rl.len;
      ctx.save();
      ctx.lineCap = 'round';
      if (rl.hOff <= 175) {
        // Tier 1 Low Skyrail: Grounded support pylons
        for (const px of [x1 + 14, x2 - 14]) {
          if (px >= startWX - 20 && px <= endWX + 20) {
            const gy = getBaseSurfaceY(px);
            const ry = gy - rl.hOff;
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.52)';
            ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px, ry + 4); ctx.stroke();
          }
        }
      } else {
        // Tier 2 & Tier 3 High Floating Skyways: Anti-Grav Hover Thruster Pods (zero messy floor poles!)
        const podGlow = rl.kind === 'sky_gold' ? 'rgba(250, 204, 21, 0.78)' : 'rgba(56, 189, 248, 0.78)';
        for (const px of [x1 + 16, x2 - 16]) {
          if (px >= startWX - 30 && px <= endWX + 30) {
            const ry = getBaseSurfaceY(px) - rl.hOff;
            const flameH = 9 + Math.abs(Math.sin(performance.now() * 0.032 + px * 0.02)) * 7;
            ctx.fillStyle = podGlow;
            ctx.beginPath();
            ctx.ellipse(px, ry + 11, 5.5, flameH, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.roundRect(px - 12, ry + 3, 24, 9, 4);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
      // 3D Beveled Skyrail / Maglev / Cloud-Gold Beam
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 12.5;
      ctx.beginPath();
      for (let wx = x1; wx <= x2; wx += 24) {
        const ry = getBaseSurfaceY(wx) - rl.hOff;
        if (wx === x1) ctx.moveTo(wx, ry); else ctx.lineTo(wx, ry);
      }
      ctx.stroke();

      ctx.strokeStyle = rl.energizedTimer > 0
        ? '#fde047'
        : (rl.kind === 'sky_gold' ? '#facc15' : (rl.kind === 'maglev' ? '#38bdf8' : '#e2e8f0'));
      ctx.lineWidth = 7;
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }

    const skyNow = performance.now();
    for (let i = 0; i < skyRings.length; i++) {
      const rg = skyRings[i];
      if (rg.x >= startWX - 70 && rg.x <= endWX + 70) drawSkyBoostRing(rg, skyNow);
    }
    for (let i = 0; i < skyBumpers.length; i++) {
      const bm = skyBumpers[i];
      if (bm.x >= startWX - 70 && bm.x <= endWX + 70) drawSkyBumper(bm, skyNow);
    }
    for (let i = 0; i < pendulums.length; i++) {
      const pd = pendulums[i];
      if (pd.x + pd.armLen >= startWX - 80 && pd.x - pd.armLen <= endWX + 80) drawSkyPendulum(pd, skyNow);
    }
    for (let i = 0; i < skyLightnings.length; i++) {
      const lt = skyLightnings[i];
      if (Math.max(lt.x1, lt.x2) >= startWX - 80 && Math.min(lt.x1, lt.x2) <= endWX + 80) drawSkyLightning(lt, skyNow);
    }

    if (partyCtrl && partyCtrl.isActive()) {
      partyCtrl.renderWorldTrackExtras(ctx, startWX, endWX);
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
          if (en.flyH) {
            ctx.fillStyle = 'rgba(249, 115, 22, 0.82)';
            ctx.beginPath(); ctx.ellipse(en.x, ey + 2, 14, 7 + Math.sin(performance.now() * 0.04) * 3, 0, 0, Math.PI * 2); ctx.fill();
          }
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.arc(en.x, ey - 28 - hop, 31, Math.PI, 0); ctx.stroke();
        } else if (en.isSkyShooter) {
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.8;
          ctx.beginPath(); ctx.arc(en.x, ey - 26, 30, 0, Math.PI * 2); ctx.stroke();
        } else if (en.flyH > 0 && en.skyRushVx > 0) {
          ctx.strokeStyle = '#fb7185'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(en.x + 22, ey - 24); ctx.lineTo(en.x + 54, ey - 24);
          ctx.moveTo(en.x + 18, ey - 36); ctx.lineTo(en.x + 44, ey - 38); ctx.stroke();
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
      } else {
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
      const sway = Math.sin(wp.phase * 1.15) * 0.17;
      ctx.rotate(sway);
      // Parachute rigging cords & vivid striped canopy!
      ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-33, -40); ctx.lineTo(-11, -8);
      ctx.moveTo(33, -40); ctx.lineTo(11, -8);
      ctx.moveTo(-12, -43); ctx.lineTo(-4, -9);
      ctx.moveTo(12, -43); ctx.lineTo(4, -9);
      ctx.stroke();
      ctx.fillStyle = wp.chuteCol || '#ef4444';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.arc(0, -40, 35, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(0, -56, 13, 18, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
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
    else if (pr.kind === 'mortar_shell') {
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      drawModel('sharkBomb', pr.x, pr.y, Math.atan2(pr.vy, 420) * 0.45, 1.28);
    }
    else if (pr.kind === 'shark_bomb') drawModel('sharkBomb', pr.x, pr.y, Math.atan2(pr.vy, 420) * 0.45);
    else if (pr.kind === 'mini_maodie') drawModel('mini_maodie', pr.x, pr.y, pr.rot * 0.35, 0.96);
    else if (pr.kind === 'bowling_mob') drawModel(getEnemySpriteKey(pr.mobKind), pr.x, pr.y, pr.rot);
    else if (pr.kind === 'fish_shot') drawModel('fishTorpedo', pr.x, pr.y, Math.atan2(pr.vy, 500) * 0.5);
    else drawSpaldingWheelOn(ctx, pr.x, pr.y, pr.r, pr.rot);
  }

  if (activeRunHeroId === 'nailong' && (player.flameHolding || player.flameBurstTimer > 0) && player.flameFuel > 0) {
    const sx = player.x + 34, sy = player.y - 92;
    const beamLen = 475;
    const fNow = performance.now();
    const wob = Math.sin(fNow * 0.045) * 9;
    ctx.save();
    // 1. Outer Crimson Dragon-Fire Billow
    ctx.fillStyle = 'rgba(220, 38, 38, 0.58)';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 12);
    ctx.quadraticCurveTo(sx + beamLen * 0.5, sy - 54 + wob, sx + beamLen, sy - 46 - wob);
    ctx.lineTo(sx + beamLen + 18, sy + wob * 0.5);
    ctx.lineTo(sx + beamLen, sy + 46 + wob);
    ctx.quadraticCurveTo(sx + beamLen * 0.5, sy + 54 - wob, sx, sy + 14);
    ctx.closePath();
    ctx.fill();

    // 2. Inner Roaring Tangerine Plasma Cone
    ctx.fillStyle = 'rgba(249, 115, 22, 0.88)';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 8);
    ctx.lineTo(sx + beamLen * 0.92, sy - 28 + wob * 0.6);
    ctx.lineTo(sx + beamLen * 0.92, sy + 28 - wob * 0.6);
    ctx.lineTo(sx, sy + 9);
    ctx.closePath();
    ctx.fill();

    // 3. White-Hot Core Jet + Rolling Fire Rings + Dragon Muzzle Flash!
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx + 4, sy); ctx.lineTo(sx + beamLen * 0.82, sy + wob * 0.25); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.beginPath(); ctx.arc(sx + 6, sy, 15 + Math.sin(fNow * 0.08) * 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)';
    ctx.lineWidth = 3.5;
    for (let r = 0; r < 3; r++) {
      const rx = sx + 55 + (((fNow * 0.95) + r * 140) % (beamLen * 0.82));
      const rr = 14 + (rx - sx) * 0.065;
      ctx.beginPath(); ctx.ellipse(rx, sy, 7, rr, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  if (player.swallowVortexTimer > 0) {
    const mx = player.x + 42, my = player.y - 82;
    const vNow = performance.now();
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
    ctx.beginPath();
    ctx.moveTo(mx, my - 16);
    ctx.lineTo(mx + 410, my - 122);
    ctx.lineTo(mx + 410, my + 92);
    ctx.lineTo(mx, my + 20);
    ctx.closePath();
    ctx.fill();

    // Swirling Wind-Tunnel Vortex Rings Pulling Inward!
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.88)';
    ctx.lineWidth = 3.2;
    for (let k = 0; k < 4; k++) {
      const prog = 1 - (((vNow * 0.0045) + k * 0.25) % 1);
      const vx = mx + 24 + prog * 365;
      const vy = my - 12 * prog;
      const ry = 18 + prog * 86;
      ctx.globalAlpha = 0.28 + (1 - prog) * 0.65;
      ctx.beginPath();
      ctx.ellipse(vx, vy, 11 + prog * 10, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (player.thunderAuraTimer > 0) {
    const tNow = performance.now();
    const cx = player.x + 8, cy = player.y - 46;
    const baseR = 78 + Math.sin(tNow * 0.03) * 6;
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.beginPath(); ctx.arc(cx, cy, baseR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    for (let s = 0; s <= 16; s++) {
      const a = (s / 16) * Math.PI * 2 + tNow * 0.006;
      const jr = baseR + ((s % 2 === 0 ? 6 : -6) * Math.sin(tNow * 0.05 + s));
      const px = cx + Math.cos(a) * jr;
      const py = cy + Math.sin(a) * jr;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  if (player.thunderTongueTimer > 0) {
    const cx = player.x + 6, cy = player.y - 72;
    const a = player.thunderTongueAngle;
    const len = 375;
    const tx = cx + Math.cos(a) * len, ty = cy + Math.sin(a) * len;
    const nx = -Math.sin(a), ny = Math.cos(a);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 24;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 17;
    ctx.stroke();
    ctx.fillStyle = '#f472b6';
    ctx.beginPath(); ctx.arc(tx, ty, 13, 0, Math.PI * 2); ctx.fill();

    // Crackling Cyan-Gold Lightning Zigzag Wrapped Around Tongue!
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let seg = 1; seg <= 7; seg++) {
      const u = seg / 7;
      const jit = (seg % 2 === 0 ? 14 : -14);
      ctx.lineTo(cx + (tx - cx) * u + nx * jit, cy + (ty - cy) * u + ny * jit);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Multi-Kind Particles: Fire Puffs, Landing Dust, Emerald & Gold Bean Sparkles!
  for (let i = 0; i < flamePuffs.length; i++) {
    const fp = flamePuffs[i];
    const u = Math.max(0, fp.life / fp.maxLife);
    ctx.globalAlpha = u * (fp.kind === 'dust' ? 0.55 : 0.88);
    if (fp.kind === 'dust') ctx.fillStyle = '#e2e8f0';
    else if (fp.kind === 'bean_spark') ctx.fillStyle = '#86efac';
    else if (fp.kind === 'gold_spark') ctx.fillStyle = '#fef08a';
    else ctx.fillStyle = u > 0.55 ? '#fde047' : '#ef4444';
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

  if (partyCtrl && partyCtrl.isActive()) {
    partyCtrl.renderWorldRivalAndVfx(ctx, startWX, endWX);
  }

  ctx.save();
  if (player.invulnTimer > 0 && state === 'PLAYING' && !player.hyperDashActive && player.giantTimer <= 0 && headStartTargetDist <= 0 && Math.floor(player.invulnTimer * 14) % 2 === 0) {
    ctx.globalAlpha = 0.55;
  }
  const dizzyRot = (partyCtrl && partyCtrl.isActive()) ? partyCtrl.getDizzyAngleOffset() : 0;
  const partyRocket = Boolean(partyCtrl && partyCtrl.isActive() && partyCtrl.isKunRocketActive());
  const pToon = (partyCtrl && partyCtrl.isActive() && partyCtrl.getPlayerCartoonTransform)
    ? partyCtrl.getPlayerCartoonTransform()
    : null;
  if (pToon) {
    ctx.translate(player.x, player.y + (pToon.offY || 0));
    ctx.scale(pToon.sx, pToon.sy);
    ctx.translate(-player.x, -player.y);
  }
  drawSculptedBikeAndHero(
    ctx,
    activeRunHeroId,
    player.x,
    player.y,
    player.angle + dizzyRot + (pToon ? pToon.extraRot : 0),
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
      rocketDash: headStartTargetDist > 0 || player.rocketDashTimer > 0 || player.hyperDashActive || partyRocket
    }
  );
  ctx.restore();

  if (partyCtrl && partyCtrl.isActive() && partyCtrl.renderWorldPostPlayer) {
    partyCtrl.renderWorldPostPlayer(ctx, startWX, endWX);
  }

  // Tutorial Freeze-Frame World Callout Tag & Target Reticle!
  if (tutorialSession.active && tutorialSession.pausedForPrompt && tutorialSession.callout) {
    const c = tutorialSession.callout;
    const nowT = performance.now();
    const bob = Math.sin(nowT * 0.008) * 5;
    ctx.save();
    // Crisp pulsing reticle ring around the target
    ctx.strokeStyle = c.col || '#fde047';
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(c.x, c.y + 42, 42 + Math.sin(nowT * 0.01) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Floating high-contrast callout pill with downward pointer arrow
    ctx.font = '900 15px -apple-system, "PingFang SC", sans-serif';
    const tw = ctx.measureText(c.text).width;
    const pw = tw + 24;
    const ph = 30;
    const px = c.x - pw * 0.5;
    const py = c.y - 22 + bob;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = c.col || '#fde047';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 10);
    ctx.fill();
    ctx.stroke();
    // Pointer triangle
    ctx.beginPath();
    ctx.moveTo(c.x - 7, py + ph);
    ctx.lineTo(c.x + 7, py + ph);
    ctx.lineTo(c.x, py + ph + 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.col || '#fde047';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.text, c.x, py + ph * 0.5 + 0.5);
    ctx.restore();
  }

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
    const ratio = Math.max(0, pop.life / pop.maxLife);
    const popScale = ratio > 0.82 ? (1 + (ratio - 0.82) * 2.1) : 1;
    ctx.save();
    ctx.translate(pop.x, pop.y);
    if (popScale !== 1) ctx.scale(popScale, popScale);
    ctx.globalAlpha = Math.min(1, ratio * 1.25);
    ctx.font = `900 ${pop.size}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#0f172a';
    ctx.strokeText(pop.text, 0, 0);
    ctx.fillStyle = pop.color;
    ctx.fillText(pop.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  if (partyCtrl && partyCtrl.isActive()) {
    partyCtrl.renderScreenEdgeIndicators(ctx, cam, W, H);
  }

  if (state === 'DYING' || state === 'GAMEOVER') {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.38)';
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}

function startPartyRunSetup(heroId) {
  clearTutorialSpotlights();
  ensureAudio();
  const s = store.save;
  activeRunHeroId = heroId || s.selectedHero || 'nailong';
  const h = getHero();

  runStartDist = 0;
  runStats = {
    dist: 0,
    singleRunDist: 0,
    beans: 0,
    bossKills: 0,
    reviveUsed: true,
    healBuysUsed: 3,
    deathDashMeters: 0,
    deathDashUsed: true
  };
  deathDashActive = false;
  bankedRunBeans = 0;
  combo = 0; comboTimer = 0;
  superCharge = 0;
  normalPlayDistSinceBonus = 0;
  normalPlaySecSinceBonus = 0;
  superBonusTimer = 0;
  bonusSkyAlpha = 0;
  headStartTargetDist = 0;
  quickDashWindowTimer = 0;
  shakeTime = 0; hitStopTimer = 0; deathSlowTimer = 0;
  stageIndex = 0; prevStageIndex = 0; stageFadeTimer = 0;
  activeBoss = null;
  recordFlag = null;
  stopBossBgm();

  bossHud.classList.add('hidden');
  bossHud.classList.remove('enraged');
  comboTag.classList.add('hidden');
  quickDashWrap.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  hubOverlay.classList.add('hidden');

  pits = []; mudZones = []; iceZones = []; snowballs = []; lilyPads = []; catapults = []; backboards = [];
  barrels = []; hangers = []; bells = []; geysers = []; laserGates = [];
  rails = []; pendulums = []; skyLightnings = []; skyRings = []; skyBumpers = []; checkpointFlags = []; worldProps = []; cashTrucks = [];
  beans = []; enemies = []; projectiles = []; enemyShots = []; bossHazards = [];
  flamePuffs = []; speedLines = []; roadScars = []; shockwaves = [];
  flyingDebris = []; popups = []; hyperGhosts = [];

  player.x = 120;
  player.y = getBaseSurfaceY(120);
  smoothCamRefY = player.y;
  smoothCamZoom = 1.0;
  smoothPlayerScreenRatio = 0.22;
  player.vy = 0;
  player.baseSpeed = h.id === 'hakimi' ? 364 : 356;
  player.vx = 0;
  player.boostTimer = 0; player.giantTimer = 0; player.magnetTimer = 0; player.rocketDashTimer = 0;
  player.hyperDashHolding = false; player.hyperDashActive = false; player.hyperSessionSec = 0;
  player.mortarTimer = 0; player.mortarShotTick = 0;
  player.sawShieldCharges = 0; player.tempShieldHp = 0; player.tempShieldTimer = 0;
  player.angle = 0; player.onGround = true; player.onRail = null;
  player.coyoteTimer = 0; player.jumpBufferTimer = 0;
  player.maxHp = 100;
  player.hp = 100;
  player.regenPool = 0;
  player.dotPool = 0;
  player.displayHp = 100;
  player.trailHp = 100;
  hpTrailFill.style.width = '100%';
  hpMainFill.style.width = '100%';
  player.jumpsLeft = h.id === 'hakimi' ? 4 : 2;
  player.invulnTimer = 1.2; player.hurtPoseTimer = 0;
  player.strikeTimer = 0; player.actionCd = 0;
  player.skillCd = 0; player.skillMaxCd = h.skillCd || 3.0; player.skillHeld = false;
  player.flameHolding = false; player.flameBurstTimer = 0; player.flameFuel = 100;
  player.swallowVortexTimer = 0; player.swallowedCount = 0;
  player.thunderTongueTimer = 0; player.thunderTongueAngle = 0; player.thunderBossTick = 0;
  player.weaponId = null; player.weaponTimer = 0;
  player.mountId = null; player.mountTimer = 0;
  player.orbitSawTimer = 0;
  player.midasTimer = 0; player.thunderAuraTimer = 0; player.thunderAuraTick = 0; player.skyWingsTimer = 0;
  player.ringBoostTimer = 0; player.ringBoostGold = false;
  player.slashLines = [];

  state = 'PLAYING';
  refreshBuffChips();
  syncControlsUI();
  updateTopHUD();
}

function returnToHubFromParty() {
  clearTutorialSpotlights();
  stopBossBgm();
  bankRunProgress(true);
  state = 'HUB';
  const pauseStatRow = pauseDistStat ? pauseDistStat.parentElement : null;
  const healShopParent = pauseBuyHealBtn ? pauseBuyHealBtn.parentElement : null;
  if (healShopParent) healShopParent.classList.remove('hidden-block');
  if (pauseHyperShopBox) pauseHyperShopBox.classList.remove('hidden-block');
  if (pauseRestartBtn) pauseRestartBtn.classList.remove('hidden-block');
  if (pauseStatRow) pauseStatRow.classList.remove('hidden-block');
  if (pauseExitBtn) pauseExitBtn.textContent = '🏠 结算退出';
  pauseOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  bossHud.classList.add('hidden');
  quickDashWrap.classList.add('hidden');
  actionBtn.classList.remove('glow');
  refreshHubUI();
  hubOverlay.classList.remove('hidden');
}

partyCtrl = createPartyController({
  store,
  player,
  getRunStats: () => runStats,
  getState: () => state,
  startPartyRunSetup,
  returnToHubFromParty,
  startPvpTutorialFromParty: () => startPvpTutorialRun(),
  finishPvpTutorialFromSpectator: () => openPvpTutorialGraduationModal(),
  logFinishedRun,
  tryConsumePartyTutorialInput: (kind) => tryConsumeTutorialInput(kind),
  getWorldArrays: () => ({
    pits,
    mudZones,
    iceZones,
    snowballs,
    lilyPads,
    backboards,
    barrels,
    hangers,
    bells,
    laserGates,
    rails,
    pendulums,
    skyBumpers,
    beans,
    enemies,
    cashTrucks,
    shockwaves,
    flamePuffs,
    popups,
    speedLines
  }),
  addPopup,
  showToast,
  getMaxJumps,
  defeatEnemy,
  hitCashTruck,
  refreshBuffChips,
  refreshHubUI,
  playHeroSelectVoice,
  getEnemySpriteKey,
  getStages: () => STAGES,
  getStageIndex: () => stageIndex,
  spawnPartyRaceBoss,
  getActiveBoss: () => activeBoss,
  triggerPartyHitImpact: (power = 1.0, isBoostKick = false) => {
    shakeTime = Math.max(shakeTime, (isBoostKick ? 0.24 : 0.38) * power);
    shakeMag = Math.max(shakeMag, Math.round((isBoostKick ? 11 : 16) * power));
    if (!isBoostKick) {
      hitStopTimer = Math.max(hitStopTimer, 0.055 * Math.min(1.4, power));
      player.hurtPoseTimer = Math.max(player.hurtPoseTimer, 0.62);
      hurtOverlay.style.opacity = '1';
      setTimeout(() => { hurtOverlay.style.opacity = '0'; }, 240);
      for (let i = 0; i < 4; i++) {
        pushCapped(flyingDebris, {
          kind: 'loose_wheel',
          x: player.x + (Math.random() - 0.5) * 32,
          y: player.y - 36 - i * 10,
          vx: player.vx * 0.35 + (Math.random() - 0.5) * 260,
          vy: -320 - Math.random() * 190,
          rot: 0,
          vRot: (i % 2 === 0 ? 1 : -1) * 14,
          r: 14,
          life: 0.95
        }, 20);
      }
    }
  },
  setPartyStageTheme: (nextIdx) => {
    const clamped = Math.max(0, Math.min(STAGES.length - 1, Number(nextIdx) || 0));
    if (clamped !== stageIndex) {
      prevStageIndex = stageIndex;
      stageFadeTimer = 0.85;
      stageIndex = clamped;
    }
  }
});

function flushBeforeUnload() {
  if (tutorialSession.active && tutorialSession.savedDashEnergy !== undefined) {
    store.save.dashEnergy = tutorialSession.savedDashEnergy;
  }
  saveLivePveRunSnapshot();
  bankRunProgress(false);
  store.flushBeacon();
  // NOTE: Intentionally DO NOT forfeit/leave PvP room on beforeunload so F5 refresh or mobile reload seamlessly reconnects!
}
window.addEventListener('beforeunload', flushBeforeUnload);
window.addEventListener('pagehide', flushBeforeUnload);

// Boot
store.pullSessionOnBoot();
try {
  // One-time starter gift: grant 1 free 超级霸王究极冲刺 (10.0s = 1.0/3) to existing guest local saves!
  if (!localStorage.getItem('pelican_starter_bawang_v1')) {
    localStorage.setItem('pelican_starter_bawang_v1', '1');
    if (!store.auth.token && (Number(store.save.dashEnergy) || 0) < 10) {
      store.save.dashEnergy = Math.min(30, Math.round(((Number(store.save.dashEnergy) || 0) + 10) * 10) / 10);
      store.markMutatedAndSave(false);
    }
  }
} catch (_) {}
refreshHubUI();

if (hubTutorialBtn) {
  hubTutorialBtn.addEventListener('click', () => {
    openTutorialMenuModal();
  });
}
if (tutMenuCloseBtn) {
  tutMenuCloseBtn.addEventListener('click', () => {
    ensureAudio();
    playSfx('bean');
    closeTutorialMenuModal();
  });
}
if (tutorialMenuOverlay) {
  tutorialMenuOverlay.addEventListener('click', (e) => {
    if (e.target === tutorialMenuOverlay) closeTutorialMenuModal();
  });
}
if (tutMenuPveBtn) {
  tutMenuPveBtn.addEventListener('click', () => {
    startTutorialRun();
  });
}
if (tutMenuPvpBtn) {
  tutMenuPvpBtn.addEventListener('click', () => {
    startPvpTutorialRun();
  });
}
if (tutMenuAcctBtn) {
  tutMenuAcctBtn.addEventListener('click', () => {
    startAccountSaveTutorial();
  });
}
if (tutReplayStepBtn) {
  tutReplayStepBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    replayCurrentPvpTutorialLesson();
  });
}
if (tutNextStepBtn) {
  tutNextStepBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    advanceCurrentPvpTutorialLesson();
  });
}
if (tutWelcomeOpenMenuBtn) {
  tutWelcomeOpenMenuBtn.addEventListener('click', () => {
    openTutorialMenuModal();
  });
}
if (tutGradOpenMenuBtn) {
  tutGradOpenMenuBtn.addEventListener('click', () => {
    openTutorialMenuModal();
  });
}
if (pvpTutGradOpenMenuBtn) {
  pvpTutGradOpenMenuBtn.addEventListener('click', () => {
    if (partyCtrl && partyCtrl.isActive()) partyCtrl.exitPartyToHub();
    openTutorialMenuModal();
  });
}
if (guestBindGuideBtn) {
  guestBindGuideBtn.addEventListener('click', () => {
    startAccountSaveTutorial();
  });
}
if (acctNudgeStartBtn) {
  acctNudgeStartBtn.addEventListener('click', () => {
    startAccountSaveTutorial();
  });
}
if (acctNudgeLaterBtn) {
  acctNudgeLaterBtn.addEventListener('click', () => {
    ensureAudio();
    playSfx('bean');
    if (acctStrongNudgeOverlay) acctStrongNudgeOverlay.classList.add('hidden');
  });
}
if (acctTutCloseBtn) {
  acctTutCloseBtn.addEventListener('click', () => {
    ensureAudio();
    playSfx('bean');
    stopAccountSaveTutorial();
  });
}
if (acctTutSubBtn) {
  acctTutSubBtn.addEventListener('click', () => {
    ensureAudio();
    playSfx('bean');
    if (acctTutState.step === 2) {
      renderAccountTutorialStep(3);
    } else if (acctTutState.step === 4) {
      stopAccountSaveTutorial();
      openTutorialMenuModal();
    }
  });
}
if (acctTutPrimaryBtn) {
  acctTutPrimaryBtn.addEventListener('click', () => {
    ensureAudio();
    playSfx('bean');
    if (acctTutState.step === 1) {
      renderAccountTutorialStep(2);
    } else if (acctTutState.step === 2) {
      const isLogged = Boolean(store.auth && store.auth.token && store.auth.username);
      if (!isLogged && authUserInp && authPassInp && authUserInp.value.trim().length >= 2 && authPassInp.value.length >= 4 && authRegisterBtn) {
        authRegisterBtn.click();
      } else {
        renderAccountTutorialStep(3);
      }
    } else if (acctTutState.step === 3) {
      renderAccountTutorialStep(4);
    } else {
      stopAccountSaveTutorial();
    }
  });
}
if (pvpHubQuickMatchBtn) {
  pvpHubQuickMatchBtn.addEventListener('click', () => {
    ensureAudio();
    if (partyCtrl && partyCtrl.openAndQuickMatch) partyCtrl.openAndQuickMatch();
  });
}
if (pvpHubTutorialBtn) {
  pvpHubTutorialBtn.addEventListener('click', () => {
    startPvpTutorialRun();
  });
}
if (pvpTutGradMatchBtn) {
  pvpTutGradMatchBtn.addEventListener('click', () => {
    ensureAudio();
    if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.add('hidden');
    if (partyCtrl) {
      partyCtrl.exitPartyToHub();
      partyCtrl.openAndQuickMatch();
    }
  });
}
if (pvpTutGradBotBtn) {
  pvpTutGradBotBtn.addEventListener('click', () => {
    ensureAudio();
    if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.add('hidden');
    if (partyCtrl) {
      partyCtrl.exitPartyToHub();
      if (partyCtrl.startInstantBotMatch) partyCtrl.startInstantBotMatch();
    }
  });
}
if (pvpTutGradHubBtn) {
  pvpTutGradHubBtn.addEventListener('click', () => {
    ensureAudio();
    if (pvpTutorialGradOverlay) pvpTutorialGradOverlay.classList.add('hidden');
    if (partyCtrl) {
      partyCtrl.exitPartyToHub();
      if (partyCtrl.openLobbyModal) partyCtrl.openLobbyModal();
    }
  });
}
if (tutSkipRunBtn) {
  tutSkipRunBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ensureAudio();
    playSfx('bean');
    completeTutorialHandoffToLiveRun(true);
  });
}
if (tutStartWelcomeBtn) {
  tutStartWelcomeBtn.addEventListener('click', () => {
    startTutorialRun();
  });
}
if (tutSkipWelcomeBtn) {
  tutSkipWelcomeBtn.addEventListener('click', () => {
    ensureAudio();
    playSfx('bean');
    try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch (_) {}
    if (tutorialWelcomeOverlay) tutorialWelcomeOverlay.classList.add('hidden');
  });
}
if (tutGradStartRunBtn) {
  tutGradStartRunBtn.addEventListener('click', () => {
    ensureAudio();
    if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
    completeTutorialHandoffToLiveRun(false);
  });
}
if (tutGradHubBtn) {
  tutGradHubBtn.addEventListener('click', () => {
    ensureAudio();
    if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
    finishRunAndOpenHub();
  });
}

// Auto-reconnect PvP room (`?room=XXXX` or F5 mid-race reload) -> or auto-resume PvE mid-run reload -> or show fresh welcome!
(async () => {
  let handledRoomLink = false;
  if (partyCtrl && partyCtrl.checkUrlRoomAutoJoin) {
    handledRoomLink = await partyCtrl.checkUrlRoomAutoJoin();
  }
  if (!handledRoomLink) {
    const restoredPve = tryRestoreLivePveRunSnapshot();
    if (!restoredPve) {
      try {
        const tutDone = Boolean(localStorage.getItem(TUT_DONE_KEY));
        const isFreshPlayer = (store.save.bestSingleRun || 0) < 30;
        if (!tutDone && isFreshPlayer && tutorialWelcomeOverlay) {
          tutorialWelcomeOverlay.classList.remove('hidden');
        }
      } catch (_) {}
    }
  }
})();

let lastTime = performance.now();
function frame(now) {
  // Schedule NEXT frame FIRST so no unexpected exception can EVER freeze or kill the render loop!
  requestAnimationFrame(frame);
  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const dt = Number.isFinite(rawDt) ? Math.max(0, Math.min(0.04, rawDt)) : 0.016;
  try {
    update(dt);
  } catch (err) {
    console.error('[PelicanUpdateGuard]', err);
  }
  try {
    render();
  } catch (err) {
    console.error('[PelicanRenderGuard]', err);
  }
  try {
    renderHubPreview(now);
  } catch (err) {
    console.error('[PelicanHubPreviewGuard]', err);
  }
}
requestAnimationFrame(frame);

try {
  if (location.search && location.search.includes('qaBoss')) {
    history.replaceState(null, '', location.pathname);
  }
} catch (_) {}

// Localhost-only bridge consumed by gitignored `_local_dev_panel.js` (strictly disabled on any remote hostname!)
if (typeof location !== 'undefined' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.hostname === '::1')) {
  window.__pelicanLocalTestApi = {
    jumpToDist(meters) {
      const d = Math.max(0, Math.floor(Number(meters) || 0));
      if (partyCtrl && partyCtrl.isActive()) partyCtrl.exitPartyToHub();
      clearLivePveRunSnapshot();
      startNewRun(store.save.selectedHero, d, 0, true);
      showToast(`🧪 测试直达 ${d}m（不计入榜单/云存档）`);
    },
    grantTestBeans(amount = 50000) {
      store.save.beans = (store.save.beans || 0) + Math.max(0, Math.floor(Number(amount) || 0));
      if (runStats) runStats.isDevTestRun = true;
      refreshHubUI();
      refreshHealSupplyUI();
      updateTopHUD();
      showToast(`🧪 已增加测试绿豆 +${amount}🌿（仅当前会话测试）`);
    },
    testDamage(dmg = 50) {
      if (state !== 'PLAYING') {
        showToast('💡 请先发车进入局内再点扣血测试');
        return;
      }
      runStats.isDevTestRun = true;
      player.hp = Math.max(12, player.hp - Math.max(10, Number(dmg) || 50));
      player.displayHp = player.hp;
      updateTopHUD();
      showToast(`🧪 已扣血至 ${Math.round(player.hp)}/${player.maxHp} HP，可点急救包测试！`);
    },
    fillHyperDash() {
      store.save.dashEnergy = 30;
      if (runStats) runStats.isDevTestRun = true;
      syncControlsUI();
      refreshHubUI();
      showToast('🧪 霸王冲刺已补满 3.0/3！');
    },
    placeOnSkyPad() {
      if (!rails.length) {
        rails.push({ x: player.x + 10, len: 88, hOff: 165, kind: 'suspenders', energizedTimer: 0 });
      }
      const rl = rails.find((r) => r.x >= player.x - 40) || rails[0];
      player.x = rl.x + 4;
      player.y = getBaseSurfaceY(player.x) - rl.hOff;
      player.vy = 0;
      player.onRail = rl;
      player.onGround = false;
      player.invulnTimer = 2.0;
      return { x: Math.round(rl.x), len: rl.len, hOff: rl.hOff };
    },
    testBossFlameAtHeight(heightAboveGround) {
      store.save.selectedHero = 'nailong';
      activeRunHeroId = 'nailong';
      if (!activeBoss) spawnStageBoss();
      activeBoss.worldX = player.x + 220;
      activeBoss.yOff = 0;
      activeBoss.flameTick = 0;
      const roadY = getBaseSurfaceY(player.x);
      player.y = roadY - Number(heightAboveGround || 0);
      player.vy = 0;
      player.onGround = Number(heightAboveGround || 0) <= 1;
      player.flameFuel = 100;
      player.flameHolding = true;
      const hpBefore = activeBoss.hp;
      for (let i = 0; i < 10; i++) {
        player.y = roadY - Number(heightAboveGround || 0);
        activeBoss.worldX = player.x + 220;
        activeBoss.yOff = 0;
        fireNailoongFlamePulse(0.05);
      }
      const dmg = Math.max(0, hpBefore - (activeBoss ? activeBoss.hp : 0));
      return { hpBefore, hpAfter: activeBoss ? activeBoss.hp : 0, dmg };
    },
    ensureBossAndAdvance() {
      if (!activeBoss) spawnStageBoss();
      player.invulnTimer = 3.0;
      player.x += 1350;
      runStats.dist = Math.floor((player.x - 120) / 18);
      runStats.singleRunDist = runStats.dist;
      spawnWorldAhead();
      return Boolean(activeBoss);
    },
    getDebugSnapshot() {
      return {
        state,
        dist: runStats ? runStats.dist : 0,
        singleRunDist: runStats ? runStats.singleRunDist : 0,
        isDevTestRun: Boolean(runStats && runStats.isDevTestRun),
        hp: player.hp,
        maxHp: player.maxHp,
        x: player.x,
        y: player.y,
        baseY: getBaseSurfaceY(player.x),
        onGround: Boolean(player.onGround),
        onRail: Boolean(player.onRail),
        beans: store.save.beans,
        healUsed: runStats ? runStats.healBuysUsed : 0,
        actionCd: player.actionCd,
        actionOverheat: Boolean(player.actionOverheat),
        whiffStreak: player.whiffStreak || 0,
        activeBoss: activeBoss ? { kind: activeBoss.kind, worldX: Math.round(activeBoss.worldX), hp: activeBoss.hp, maxHp: activeBoss.maxHp } : null,
        rails: rails.map((r) => ({ x: Math.round(r.x), len: r.len, hOff: r.hOff, kind: r.kind })),
        skyRings: skyRings.map((r) => ({ x: Math.round(r.x), hAbove: r.hAbove, isGold: r.isGold })),
        skyBumpers: skyBumpers.map((b) => ({ x: Math.round(b.x), hAbove: b.hAbove })),
        pendulums: pendulums.map((p) => ({ x: Math.round(p.x), pivotH: p.pivotH, armLen: p.armLen })),
        skyLightnings: skyLightnings.map((l) => ({ x1: Math.round(l.x1), h1: l.h1, h2: l.h2, kind: l.kind, firing: l.isFiring })),
        aerialEnemies: enemies.filter((e) => !e.hit && e.flyH > 0).map((e) => ({ x: Math.round(e.x), kind: e.kind, flyH: Math.round(e.flyH), rush: Boolean(e.skyRushVx) }))
      };
    }
  };
}
