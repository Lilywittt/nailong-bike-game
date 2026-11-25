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
} from './config.js?v=8.7';

import {
  buildAllSculptedAssets,
  drawModelOn,
  drawSpaldingWheelOn,
  drawSculptedBikeAndHero,
  getEnemySpriteKey,
  getHeroPortraitDataUrl
} from './models.js?v=8.7';

import {
  drawBiomeAtmosphere,
  drawSculptedTerrainAndRoad,
  drawHubDioramaBackdrop
} from './scenery.js?v=8.7';

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
} from './audio.js?v=8.7';

import { createCloudStore } from './cloud.js?v=8.7';
import { createPartyController } from './party.js?v=8.7';
import {
  initBossCustomState,
  clearBossTransientHazards,
  hasBossImmediateJumpCue,
  hasBossImmediateParryCue,
  handlePlayerBossInteraction,
  updateBossEngine,
  renderBossArenaAndModel
} from './bosses.js?v=8.7';

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
  // Decoupled, smooth, strictly bounded forward speed (+0 at 0m, +28 at 1km, +47 at 2km, upper bound = +92 px/s)
  const boundedSpeedAdd = Math.round(92 * (1 - Math.exp(-d / 2800)));
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
let preSelectedDeathBoost = 0;
let deathDashActive = false;
let bankedRunBeans = 0;

let reopenRechargeAfterAuth = false;
let lastObservedAuthUser = null;

const store = createCloudStore(() => {
  const curAuthUser = (store.auth && store.auth.username) || '';
  if (lastObservedAuthUser !== null && lastObservedAuthUser !== curAuthUser) {
    preSelectedBoost = 0;
    preSelectedDeathBoost = 0;
    activeRunHeroId = store.save.selectedHero;
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
  if (reopenRechargeAfterAuth) {
    reopenRechargeAfterAuth = false;
    closeAuthModal();
    openRechargeModal();
    return;
  }
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
    if (logged) {
      rechargeAcctBar.classList.remove('warn-guest');
      rechargeAcctTxt.textContent = `👤 入账绑定账号：${store.auth.username}（多端防丢）`;
      rechargeGoLoginBtn.classList.add('hidden-block');
    } else {
      rechargeAcctBar.classList.add('warn-guest');
      rechargeAcctTxt.textContent = '⚠️ 当前为游客，请先登录/注册账号再充值！';
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
      showToast(`⚠️ ${(data && data.error) || '创建订单失败'}`);
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

function openRechargeModal() {
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

if (hubRechargeBtn) hubRechargeBtn.addEventListener('click', openRechargeModal);
if (hubWalletChip) hubWalletChip.addEventListener('click', openRechargeModal);
if (pauseRechargeBtn) pauseRechargeBtn.addEventListener('click', openRechargeModal);
if (talentRechargeBtn) talentRechargeBtn.addEventListener('click', openRechargeModal);
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
    hubOrientBtn.textContent = manualLandscape ? '📱 竖屏版' : (autoLand ? '🔒 锁横屏' : '🔄 横屏版');
  }
  if (hudOrientBtn) {
    hudOrientBtn.textContent = manualLandscape ? '📱 竖屏' : (autoLand ? '🔒 锁横屏' : '🔄 横屏');
  }
}

function resize() {
  const rawW = window.innerWidth || 390;
  const rawH = window.innerHeight || 844;
  const isCoarseTouch = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const isMobileDev = isCoarseTouch || Math.max(rawW, rawH) <= 960;
  const root = document.documentElement;
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
window.addEventListener('orientationchange', () => setTimeout(resize, 80));
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
let lastDamageMeta = {
  cause: '赛道冲撞',
  tip: '善用铁山靠（电脑左键/J）可正面破盾撞怪并弹反飞行物！'
};

// ==================== PROGRESSIVE 10-STEP FULL-CURRICULUM FREEZE-FRAME TUTORIAL STATE (v8.7) ====================
const TUT_DONE_KEY = 'pelican_tutorial_done_v4';
const TUT_REWARD_KEY = 'pelican_tutorial_reward_v4';
const tutorialCoachHud = document.getElementById('tutorialCoachHud');
const tutStepBadge = document.getElementById('tutStepBadge');
const tutPauseBadge = document.getElementById('tutPauseBadge');
const tutSkipRunBtn = document.getElementById('tutSkipRunBtn');
const tutCoachTitleTxt = document.getElementById('tutCoachTitleTxt');
const tutCoachMainTxt = document.getElementById('tutCoachMainTxt');
const tutCoachActionCta = document.getElementById('tutCoachActionCta');
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
const tutorialWelcomeOverlay = document.getElementById('tutorialWelcomeOverlay');
const tutStartWelcomeBtn = document.getElementById('tutStartWelcomeBtn');
const tutSkipWelcomeBtn = document.getElementById('tutSkipWelcomeBtn');
const tutorialGradOverlay = document.getElementById('tutorialGradOverlay');
const tutGradRewardBanner = document.getElementById('tutGradRewardBanner');
const tutGradStartRunBtn = document.getElementById('tutGradStartRunBtn');
const tutGradHubBtn = document.getElementById('tutGradHubBtn');
const goDeathCauseTxt = document.getElementById('goDeathCauseTxt');
const goDeathTipTxt = document.getElementById('goDeathTipTxt');

const tutorialSession = {
  active: false,
  step: 1, // 1..7
  subPhase: 'approach',
  pausedForPrompt: false,
  expectedInput: null, // 'jump' | 'action' | 'skill'
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

function getCamera() {
  const isPortrait = H > W;
  const isMobileLand = !isPortrait && H < 480;
  const baseScale = isPortrait
    ? Math.max(0.58, Math.min(0.72, W / 535))
    : (isMobileLand ? Math.max(0.66, Math.min(0.84, H / 515)) : Math.max(0.76, Math.min(0.95, H / 500)));
  const worldScale = baseScale * smoothCamZoom;
  // When 🐕 大狗嚼 chases from BEHIND, shift rider toward 0.37*W so player clearly sees rear pursuit!
  const playerScreenX = W * smoothPlayerScreenRatio;
  const groundScreenY = isPortrait ? H * 0.66 : (isMobileLand ? H * 0.74 : H * 0.70);
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
  if (player.midasTimer > 0) list.push(`🪙 点豆成金 ${player.midasTimer.toFixed(1)}s`);
  if (player.thunderAuraTimer > 0) list.push(`⚡ 雷电护体 ${player.thunderAuraTimer.toFixed(1)}s`);
  if (player.skyWingsTimer > 0) list.push(`🪽 滑翔飞翼 ${player.skyWingsTimer.toFixed(1)}s`);
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

function clearTutorialSpotlights() {
  if (tutorialSession.active && tutorialSession.savedDashEnergy !== undefined) {
    store.save.dashEnergy = tutorialSession.savedDashEnergy;
    tutorialSession.savedDashEnergy = undefined;
  }
  tutorialSession.active = false;
  tutorialSession.pausedForPrompt = false;
  tutorialSession.expectedInput = null;
  tutorialSession.callout = null;
  tutorialSession.timeScale = 1.0;
  tutorialSession.graduatingTimer = 0;
  document.documentElement.classList.remove(
    'tutorial-clean-mode',
    'tutorial-hp-unlocked',
    'tutorial-heal-unlocked',
    'tutorial-hyper-unlocked',
    'tutorial-boss-stage'
  );
  if (tutorialCoachHud) {
    tutorialCoachHud.classList.add('hidden');
    tutorialCoachHud.classList.remove('parry-alert');
  }
  if (tutPauseBadge) tutPauseBadge.classList.add('hidden');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
  for (const btn of [jumpBtn, actionBtn, skillBtn, hudHealBtn, hyperDashBtn]) {
    if (!btn) continue;
    btn.classList.remove('tut-spotlight', 'tut-hidden-ctrl', 'tut-unlock-pop');
  }
}

function syncTutorialDots(stepNum) {
  for (let i = 0; i < tutDots.length; i++) {
    const dot = tutDots[i];
    if (!dot) continue;
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

function setTutorialCoachDisplay({ badge, title, main, cta, spotlightBtn = null, paused = false, alertGlow = false }) {
  if (tutStepBadge && badge) tutStepBadge.textContent = badge;
  if (tutCoachTitleTxt && title !== undefined) tutCoachTitleTxt.innerHTML = title;
  if (tutCoachMainTxt && main !== undefined) tutCoachMainTxt.innerHTML = main;
  if (tutCoachActionCta && cta !== undefined) {
    tutCoachActionCta.innerHTML = cta;
    tutCoachActionCta.classList.toggle('waiting-ride', !paused && spotlightBtn === null);
  }
  if (tutPauseBadge) tutPauseBadge.classList.toggle('hidden', !paused);
  if (tutorialCoachHud) tutorialCoachHud.classList.toggle('parry-alert', Boolean(alertGlow));
  if (jumpBtn) jumpBtn.classList.toggle('tut-spotlight', spotlightBtn === 'jump');
  if (actionBtn) actionBtn.classList.toggle('tut-spotlight', spotlightBtn === 'action' || spotlightBtn === 'both_atk');
  if (skillBtn) skillBtn.classList.toggle('tut-spotlight', spotlightBtn === 'skill' || spotlightBtn === 'both_atk');
  if (hudHealBtn) hudHealBtn.classList.toggle('tut-spotlight', spotlightBtn === 'heal');
  if (hyperDashBtn) hyperDashBtn.classList.toggle('tut-spotlight', spotlightBtn === 'hyper');
}

function pauseForTutorialPrompt(expectedInput, cfg) {
  tutorialSession.pausedForPrompt = true;
  tutorialSession.expectedInput = expectedInput;
  tutorialSession.timeScale = 0;
  tutorialSession.callout = cfg.callout || null;
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

function beginTutorialLesson(stepNum) {
  if (!tutorialSession.active) return;
  const pc = isPcControlHintMode();
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

  // Keep activeBoss & its minions intact when transitioning from Step 9 -> Step 10!
  if (stepNum !== 10) {
    enemies.length = 0;
    laserGates.length = 0;
    pits.length = 0;
    rails.length = 0;
    enemyShots.length = 0;
    worldProps.length = 0;
    cashTrucks.length = 0;
  }

  if (stepNum === 1) {
    const tx = player.x + 310;
    tutorialSession.targetX = tx;
    enemies.push({ x: tx, kind: 'pelican_guard', isTutStep1: true, hit: false, phase: 0 });
    for (let k = 0; k < 5; k++) {
      const bx = tx - 50 + k * 26;
      const ay = 75 + Math.sin((k / 4) * Math.PI) * 58;
      beans.push({ x: bx, y: -ay, val: 1, giant: k === 2, taken: false });
    }
    setTutorialCoachDisplay({
      badge: '🎓 基础教学 1/10',
      title: '自动骑行与一段起跳',
      main: '欢迎！小车会<b>自动向前行驶</b>，前方即将遇到第一个障碍，到跟前时<b>画面会自动暂停</b>教你操作……',
      cta: '👀 请先放松观察路面，马上到教学点',
      paused: false
    });
  } else if (stepNum === 2) {
    const px = player.x + 280;
    tutorialSession.targetX = px;
    tutorialSession.pitEndX = px + 235;
    pits.push({ x: px, len: 235, bridged: false, isTutPit: true });
    rails.push({ x: px + 65, len: 275, hOff: 132, kind: 'suspenders', energizedTimer: 0 });
    for (let k = 0; k < 5; k++) {
      beans.push({ x: px + 95 + k * 42, y: -158, val: 1, giant: k === 2, taken: false });
    }
    setTutorialCoachDisplay({
      badge: '🎓 基础教学 2/10',
      title: '宽断桥、二段跳与高空滑轨',
      main: '前方出现<b>超宽断桥</b>与<b>高空背带滑轨</b>，到断桥边画面会自动暂停分两步教你<b>二段跳</b>……',
      cta: '👀 正在驶向断桥教学点……',
      paused: false
    });
  } else if (stepNum === 3) {
    const ex = player.x + 335;
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
    setTutorialCoachDisplay({
      badge: '🎓 基础教学 3/10',
      title: '踩扁普通小怪',
      main: '前方是一排没有护盾的<b>普通小怪</b>，接近时画面会暂停教你如何<b>起跳踩头击败</b>它们……',
      cta: '👀 正在接近普通小怪……',
      paused: false
    });
  } else if (stepNum === 4) {
    playSfx('crate');
    const ex = player.x + 320;
    tutorialSession.targetX = ex;
    enemies.push({ x: ex, kind: 'shield_lawyer', shielded: true, shotDone: true, tutStep4: true, hit: false, phase: 0 });
    laserGates.push({ x: ex + 96, hacked: false, tutStep4: true });
    setTutorialCoachDisplay({
      badge: '⚔️ 战斗教学 4/10 · 解锁铁山靠',
      title: '新动作解锁：【🐔 铁山靠】破盾清障',
      main: `右下角已解锁 <b>🐔 铁山靠</b>（${pc ? '点击<b>鼠标左键</b>或<b>J键</b>' : '点击右下角橙色按钮'}），马上暂停实操破盾！`,
      cta: '👀 正在接近持盾怪与激光电网……',
      paused: false
    });
  } else if (stepNum === 5) {
    const casterX = player.x + 540;
    const orbX = player.x + 390;
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
    setTutorialCoachDisplay({
      badge: '⚔️ 战斗教学 5/10',
      title: '铁山靠完美弹反飞弹',
      main: '远处敌人射出了<b>📜 律师函飞弹</b>！等飞弹飞近车头时画面会自动定格教你<b>无伤弹反</b>！',
      cta: '👀 观察迎面飞来的律师函……',
      paused: false
    });
  } else if (stepNum === 6) {
    playSfx('crate');
    player.skillCd = 0;
    player.flameFuel = 100;
    syncControlsUI();
    const packX = player.x + 330;
    tutorialSession.targetX = packX;
    tutorialSession.step6Kills = 0;
    const kinds = ['normal_frog', 'spiky_cat', 'boar_frog', 'dribbler'];
    for (let k = 0; k < 4; k++) {
      enemies.push({ x: packX + k * 46, kind: kinds[k], chargePrep: 99, tutStep6: true, hit: false, phase: k * 0.6 });
    }
    setTutorialCoachDisplay({
      badge: '⚔️ 战斗教学 6/10 · 解锁大招',
      title: `新动作解锁：角色大招【${h.skillLbl}】`,
      main: `右侧已解锁紫色大招 <b>${h.skillIcon || '✨'} ${h.skillLbl}</b>（${pc ? '点击<b>鼠标右键</b>或<b>K键</b>' : '点击右侧紫色按钮'}），接近怪群时定格实操！`,
      cta: '👀 正在接近前方密集怪群……',
      paused: false
    });
  } else if (stepNum === 7) {
    playSfx('crate');
    player.hp = player.maxHp;
    player.displayHp = player.maxHp;
    player.trailHp = player.maxHp;
    const propX = player.x + 210;
    tutorialSession.targetX = propX + 120;
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
    setTutorialCoachDisplay({
      badge: '💊 生存教学 7/10 · 空投道具与急救回血',
      title: '认识生命条、空投道具与【🧰 急救包】',
      main: '顶部已解锁<b>❤️ 生命条</b>，左侧已解锁<b>🧰 急救包</b>！赛道上会掉落巨化、加特林、护盾等强力道具，先拾取前方的护盾……',
      cta: '🪂 正在拾取赛道增益道具……',
      paused: false
    });
  } else if (stepNum === 8) {
    playSfx('crate');
    store.save.dashEnergy = 20;
    superCharge = 85;
    syncControlsUI();
    updateTopHUD();
    const gx = player.x + 310;
    tutorialSession.targetX = gx;
    pits.push({ x: gx + 30, len: 150, bridged: false, isTutPit: true });
    laserGates.push({ x: gx + 210, hacked: false });
    enemies.push({ x: gx + 260, kind: 'shield_lawyer', shielded: true, shotDone: true, hit: false, phase: 0 });
    enemies.push({ x: gx + 315, kind: 'spiky_cat', hit: false, phase: 1 });
    cashTrucks.push({ x: gx + 370, y: 0, hp: 6, dead: false, flash: 0 });
    setTutorialCoachDisplay({
      badge: '☄️ 进阶神技 8/10 · 超级霸王究极冲刺',
      title: '解锁【☄️ 超级霸王究极冲刺】与彩虹奖励槽！',
      main: '左侧已解锁金色<b>超级霸王究极冲刺</b>，顶部解锁<b>🌈 超级奖励槽</b>（攒满100%飞入云端金豆关）！前方有断桥、电网与<b>🚨 装甲运钞车</b>……',
      cta: '👀 正在接近高危障碍群与装甲运钞车……',
      paused: false
    });
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
      worldX: player.x + 380, yOff: 0,
      skillIdx: 0, minionTimer: 999,
      stunTimer: 0, flashTimer: 0
    };
    initBossCustomState(activeBoss, player.x);
    refreshBossHudUI();
    bossHud.classList.remove('hidden');
    // Launch a ground shockwave roller first so Lesson 9A teaches dodging un-parryable ground attacks!
    const wx = player.x + 335;
    tutorialSession.targetX = wx;
    enemyShots.push({ kind: 'spike_roller', isTutBossWave: true, x: wx, y: 0, vx: -130, parried: false, rot: 0 });
    syncControlsUI();
    updateTopHUD();
    setTutorialCoachDisplay({
      badge: '⚔️ 首领教学 9/10 · 躲招、破防与暴击',
      title: '首领战（上）：躲地面招 -> 铁山靠破防 -> 大招暴击！',
      main: '<b>🐔 陪练叮咚鸡</b>降临！首领既有需要<b>起跳躲避</b>的地面滚轮，也有可用<b>铁山靠破防打晕</b>的猛扑……',
      cta: '👀 首领放出了地面滚轮，准备定格躲避……',
      paused: false
    });
  } else if (stepNum === 10) {
    store.save.dashEnergy = 20;
    player.skillCd = 0;
    player.flameFuel = 100;
    syncControlsUI();
    updateTopHUD();
    setTutorialCoachDisplay({
      badge: '🔥 毕业决战 10/10 · 狂暴压制与斩杀',
      title: '首领战（下）：二阶狂暴 + 霸王冲刺怼墙斩杀！',
      main: '首领半血触发了<b>🔥 二阶狂暴</b>并召唤护卫小怪！马上定格教你用<b>霸王冲刺把首领死死顶在钢墙上</b>摩擦削至残血！',
      cta: '🔥 首领狂暴咆哮中……',
      paused: false
    });
  }
}

function tryConsumeTutorialInput(kind) {
  if (!tutorialSession.active) return true;

  if (tutorialSession.pausedForPrompt) {
    if (kind !== tutorialSession.expectedInput) return false;
    tutorialSession.pausedForPrompt = false;
    tutorialSession.expectedInput = null;
    tutorialSession.callout = null;
    tutorialSession.timeScale = 1.0;
    if (tutPauseBadge) tutPauseBadge.classList.add('hidden');
    if (tutorialCoachHud) tutorialCoachHud.classList.remove('parry-alert');

    const st = tutorialSession.step;
    const pc = isPcControlHintMode();
    if (st === 1) {
      tutorialSession.subPhase = '1_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '🎓 基础教学 1/10',
        title: '漂亮！成功跃过障碍！',
        main: '普通低矮障碍只需跳一下就能轻松越过。',
        cta: '✅ 落地后进入第 2 步……',
        paused: false
      });
    } else if (st === 2 && tutorialSession.subPhase === 'approach') {
      tutorialSession.subPhase = '2A_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '🎓 基础教学 2/10（第1跳）',
        title: '已跃入空中！准备二段跳……',
        main: '到达空中最高点时画面会再次暂停，教你按第二次起跳！',
        cta: '⏳ 升空中……',
        paused: false
      });
    } else if (st === 2 && tutorialSession.subPhase === '2A_jumped') {
      tutorialSession.subPhase = '2B_done';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '🎓 基础教学 2/10（第2跳完成）',
        title: '太棒了！成功跳上高空背带滑轨！',
        main: '落到背带滑轨上会自动高速滑行越过断桥，同时重置跳跃次数！',
        cta: '✅ 滑过断桥进入第 3 步……',
        paused: false
      });
    } else if (st === 3) {
      tutorialSession.subPhase = '3_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '🎓 基础教学 3/10',
        title: '精准起跳！看准小怪头顶踩下去！',
        main: '踩中普通小怪头顶不仅无伤击杀，还会借力再次弹起！',
        cta: '👟 空中下落踩头中……',
        paused: false
      });
    } else if (st === 4) {
      tutorialSession.subPhase = '4_struck';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '⚔️ 战斗教学 4/10',
        title: '爽快！护盾怪变保龄球撞爆电网！',
        main: '记住：凡是<b>持盾怪、尖刺猫、激光电网、滚石大雪球</b>，全都用<b>🐔 铁山靠</b>正面轰飞！',
        cta: '✅ 即将进入第 5 步弹反教学……',
        paused: false
      });
    } else if (st === 5) {
      tutorialSession.subPhase = '5_parried';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '⚔️ 战斗教学 5/10',
        title: '完美弹反！！飞弹原路抽爆敌人！',
        main: '实战中只要右下角<b>铁山靠亮起黄光</b>，按左键就能无伤把首领或小怪的飞行物反抽回去！',
        cta: '✅ 即将解锁角色专属大招……',
        paused: false
      });
    } else if (st === 6) {
      tutorialSession.subPhase = '6_cast';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '⚔️ 战斗教学 6/10',
        title: '火力全开！清空整排怪群！',
        main: '每位角色的大招效果各不相同，车库里可随时切换 5 位角色！',
        cta: '✅ 即将进入生存道具与急救教学……',
        paused: false
      });
    } else if (st === 7) {
      tutorialSession.subPhase = '7_healed';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '💊 生存教学 7/10 · 满血恢复！',
        title: '瞬间回满！绝境救命神技！',
        main: '实战中每局最多可用绿豆购买 3 次急救包（快捷键 <b>H</b>），残血打首领时能瞬间救场！',
        cta: '✅ 即将解锁【☄️ 超级霸王究极冲刺】……',
        paused: false
      });
    } else if (st === 8) {
      tutorialSession.subPhase = '8_dashing';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '☄️ 进阶神技 8/10 · 彗星冲刺中！',
        title: '无敌彗星！碾碎一切障碍与运钞车！',
        main: '冲刺期间<b>全程无敌、自动铺平断桥、撞爆运钞车狂爆绿豆</b>！实战中松开按键即可随时停下节省能量！',
        cta: '☄️ 正在轰爆装甲运钞车……',
        paused: false
      });
    } else if (st === 9 && tutorialSession.subPhase === 'approach') {
      tutorialSession.subPhase = '9A_jumped';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '⚔️ 首领教学 9/10（1/3 躲招成功）',
        title: '漂亮跃过首领地面冲击！',
        main: '接下来首领会发光近身俯冲，准备用<b>🐔 铁山靠</b>打断它！',
        cta: '⏳ 等待首领俯冲逼近……',
        paused: false
      });
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
      setTutorialCoachDisplay({
        badge: '⚔️ 首领教学 9/10（2/3 破防成功！）',
        title: '破防成功！叮咚鸡头冒金星陷入眩晕！',
        main: '马上定格教你趁首领眩晕释放<b>角色大招</b>灌满 <b>140% 暴击伤害</b>！',
        cta: '💫 首领破防硬直中……',
        paused: false
      });
    } else if (st === 9 && tutorialSession.subPhase === '9C_wait_skill') {
      tutorialSession.subPhase = '9C_cast';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '⚔️ 首领教学 9/10（3/3 暴击重创！）',
        title: '140% 眩晕暴击！！把首领轰进狂暴阶段！',
        main: '看！重创之下叮咚鸡触发了半血<b>🔥 二阶狂暴形态</b>并召唤了护卫小怪！',
        cta: '🔥 即将进入第 10 步狂暴怼墙斩杀……',
        paused: false
      });
    } else if (st === 10 && tutorialSession.subPhase === 'approach') {
      tutorialSession.subPhase = '10_pinning';
      tutorialSession.phaseTimer = 0;
      setTutorialCoachDisplay({
        badge: '🔥 毕业决战 10/10 · 怼墙狂创！！',
        title: '钢铁护盾墙开启！把狂暴首领按在墙上摩擦！',
        main: '霸王冲刺面对首领时会展开<b>钢铁压制墙</b>一路怼边削至残血，同时清光周围所有小怪！',
        cta: '💥 正在把叮咚鸡削至一丝残血……',
        paused: false
      });
    }
    return true;
  }

  // Responsive natural allowances right near targets or during free-finisher phase
  if (tutorialSession.subPhase === 'approach') {
    const distToTarget = tutorialSession.targetX - player.x;
    if (tutorialSession.step === 1 && kind === 'jump' && distToTarget <= 230 && player.onGround) {
      tutorialSession.subPhase = '1_jumped';
      tutorialSession.phaseTimer = 0;
      return true;
    }
    if (tutorialSession.step === 2 && kind === 'jump' && distToTarget <= 135 && player.onGround) {
      tutorialSession.subPhase = '2A_jumped';
      tutorialSession.phaseTimer = 0;
      return true;
    }
    if (tutorialSession.step === 3 && kind === 'jump' && distToTarget <= 245 && player.onGround) {
      tutorialSession.subPhase = '3_jumped';
      tutorialSession.phaseTimer = 0;
      return true;
    }
    if (tutorialSession.step === 4 && kind === 'action' && distToTarget <= 170) {
      tutorialSession.subPhase = '4_struck';
      tutorialSession.phaseTimer = 0;
      return true;
    }
    if (tutorialSession.step === 6 && kind === 'skill' && distToTarget <= 230) {
      tutorialSession.subPhase = '6_cast';
      tutorialSession.phaseTimer = 0;
      return true;
    }
  }
  if (tutorialSession.step === 2 && tutorialSession.subPhase === '2A_jumped' && kind === 'jump' && !player.onGround) {
    tutorialSession.subPhase = '2B_done';
    tutorialSession.phaseTimer = 0;
    return true;
  }
  if ((tutorialSession.step === 6 && tutorialSession.subPhase === '6_cast')
      || (tutorialSession.step === 9 && tutorialSession.subPhase === '9C_cast')) {
    return kind === 'skill';
  }
  if (tutorialSession.step === 10 && tutorialSession.subPhase === '10_finish') {
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
      tutGradRewardBanner.textContent = '🎁 首次毕业奖励 +300 🌿 绿豆已入账！';
    }
  } else if (tutGradRewardBanner) {
    tutGradRewardBanner.textContent = '✨ 温习通关！全部核心机制手感已拉满！';
  }

  clearTutorialSpotlights();
  state = 'PAUSED';
  playSfx('crate');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.remove('hidden');
}

function completeTutorialHandoffToLiveRun(skipped = false) {
  try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch (_) {}
  clearTutorialSpotlights();
  if (skipped) {
    finishRunAndOpenHub();
    showToast('🏠 已退出新手教学，随时可点顶栏【🎓 新手教程】重温！');
    return;
  }
  startNewRun(store.save.selectedHero, 0, 0);
  showToast('🚀 正式挑战发车！冲刺单命最高纪录吧！');
}

function startTutorialRun() {
  if (tutorialWelcomeOverlay) tutorialWelcomeOverlay.classList.add('hidden');
  if (tutorialGradOverlay) tutorialGradOverlay.classList.add('hidden');
  if (partyCtrl && partyCtrl.isActive()) {
    partyCtrl.exitPartyToHub();
  }
  const realSavedDash = store.save.dashEnergy;
  startNewRun(store.save.selectedHero, 0, 0);
  tutorialSession.savedDashEnergy = realSavedDash;

  enemies.length = 0;
  laserGates.length = 0;
  rails.length = 0;
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
  tutorialSession.graduatingTimer = 0;
  document.documentElement.classList.add('tutorial-clean-mode');
  document.documentElement.classList.remove(
    'tutorial-hp-unlocked',
    'tutorial-heal-unlocked',
    'tutorial-hyper-unlocked',
    'tutorial-boss-stage'
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
      if (tutorialSession.targetX - player.x <= 122 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '🎓 基础教学 1/10 · 已暂停',
          title: '第 1 步：一段起跳越过障碍',
          main: '小车会自动向前骑行。遇到前方矮路障时，只需<b>起跳一次</b>就能轻松从上方跃过！',
          cta: pc ? '👉 请按键盘 <b>[空格键]</b>（或 W / ↑）起跳' : '👉 请点击左下角发光的 <b>[⬆️ 起跳]</b> 按钮',
          callout: { x: tutorialSession.targetX, y: -92, text: '⚠️ 拦路障碍 · 起跳越过', col: '#fde047' }
        });
      }
    } else if (tutorialSession.subPhase === '1_jumped') {
      if (player.x > tutorialSession.targetX + 75 && player.onGround) {
        tutorialSession.phaseTimer += realDt;
        if (tutorialSession.phaseTimer >= 0.35) {
          addPopup('👏 一段跳掌握！', player.x + 28, player.y - 96, '#4ade80', 19);
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
          badge: '🎓 基础教学 2/10（第1跳）· 已暂停',
          title: '第 2 步（上）：遇到宽断桥先起跳',
          main: '前方是<b>超宽断桥</b>（掉下去会扣血），上方架着<b>背带滑轨</b>。一段跳不够远，我们先按<b>第一次起跳</b>跃入空中！',
          cta: pc ? '👉 先按一次 <b>[空格键]</b> 跃向空中' : '👉 先点一次左下角 <b>[⬆️ 起跳]</b> 按钮',
          callout: { x: tutorialSession.targetX + 105, y: -38, text: '🕳️ 超宽断桥 · 掉入扣血！', col: '#fb7185' }
        });
      }
    } else if (tutorialSession.subPhase === '2A_jumped') {
      jumpHeld = true;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.22 || player.y <= -92) {
        jumpHeld = false;
        pauseForTutorialPrompt('jump', {
          badge: '🎓 基础教学 2/10（第2跳）· 空中定格',
          title: '第 2 步（下）：空中再按一次触发二段跳！',
          main: '角色在<b>半空中还能再跳第二次</b>！现在再按起跳，就能稳稳跃上高空<b>背带滑轨</b>滑过断桥！',
          cta: pc ? '👉 在空中<b>再按一次 [空格键]</b> 二段跳！' : '👉 在空中<b>再点一次 [⬆️ 起跳]</b> 二段跳！',
          callout: { x: tutorialSession.targetX + 145, y: -175, text: '✨ 高空背带滑轨 · 二段跳踩上去！', col: '#4ade80' }
        });
      }
    } else if (tutorialSession.subPhase === '2B_done') {
      if (player.x > tutorialSession.pitEndX + 65 && (player.onGround || player.onRail)) {
        tutorialSession.phaseTimer += realDt;
        if (tutorialSession.phaseTimer >= 0.35 && player.onGround) {
          addPopup('👏 二段跳与滑轨掌握！', player.x + 32, player.y - 98, '#4ade80', 19);
          tutorialSession.step3Tries = 0;
          beginTutorialLesson(3);
        }
      }
    }
    return;
  }

  if (st === 3) {
    const firstEn = enemies.find((e) => e.tutStep3 && !e.hit);
    if (tutorialSession.subPhase === 'approach') {
      if (firstEn && firstEn.x - player.x <= 188 && player.onGround) {
        pauseForTutorialPrompt('jump', {
          badge: '🎓 基础教学 3/10 · 已暂停',
          title: '第 3 步：踩头击败普通小怪',
          main: '遇到<b>没有护盾和尖刺</b>的普通小怪时，跳起来落到它们<b>头顶</b>就能直接踩扁，还会弹起爆出绿豆！',
          cta: pc ? '👉 按一下 <b>[空格键]</b> 跳起踩扁前方小怪！' : '👉 点击一下 <b>[⬆️ 起跳]</b> 踩扁前方小怪！',
          callout: { x: firstEn.x + 44, y: -92, text: '👟 普通小怪队列 · 跳起踩头！', col: '#38bdf8' }
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
        setTutorialCoachDisplay({
          badge: '🎓 基础教学 3/10 · 踩头成功！',
          title: '干得漂亮！小怪被一脚踩扁！',
          main: '踩中普通小怪头顶会无伤消灭它并借力弹起，接下来学习如何对付<b>持盾怪与电网</b>！',
          cta: '✅ 落地后解锁【🐔 铁山靠】……',
          paused: false
        });
      } else if (player.x > tutorialSession.targetX + 210 && player.onGround) {
        tutorialSession.step3Tries = (tutorialSession.step3Tries || 0) + 1;
        if (tutorialSession.step3Tries >= 2) {
          beginTutorialLesson(4);
        } else {
          beginTutorialLesson(3);
        }
      }
    } else if (tutorialSession.subPhase === '3_stomped') {
      tutorialSession.phaseTimer += realDt;
      if (player.onGround && tutorialSession.phaseTimer >= 0.32) {
        addPopup('👏 踩头连击掌握！', player.x + 28, player.y - 96, '#4ade80', 19);
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
          badge: '⚔️ 战斗教学 4/10 · 新按键已暂停',
          title: '第 4 步：【🐔 铁山靠】破盾与清电网',
          main: '前方的<b>持盾律师、尖刺猫、激光电网</b>不能踩头硬撞！使用新解锁的<b>🐔 铁山靠</b>可正面把护盾怪当保龄球撞飞并轰碎电网！',
          cta: pc ? '👉 点击 <b>[鼠标左键]</b>（或按键盘 <b>[J键]</b>）使出铁山靠！' : '👉 点击右下角发光的 <b>[🐔 铁山靠]</b> 按钮！',
          callout: { x: en.x + 35, y: -102, text: '🛡️ 持盾怪 + ⚡电网 · 铁山靠撞飞！', col: '#fb923c' }
        });
      }
    } else if (tutorialSession.subPhase === '4_struck') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.80) {
        addPopup('👏 铁山靠破盾掌握！', player.x + 32, player.y - 98, '#4ade80', 19);
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
          badge: '⚔️ 战斗教学 5/10 · 飞弹定格',
          title: '第 5 步：【🐔 铁山靠】完美弹反飞弹！',
          main: '敌人发射的<b>📜 律师函</b>已飞到车头前！此时使出<b>🐔 铁山靠</b>不仅完全免伤，还能把飞弹<b>反抽回去</b>秒杀远处敌人！',
          cta: pc ? '👉 点击 <b>[鼠标左键]</b>（或按 <b>[J键]</b>）完美弹反！' : '👉 点击右下角发光的 <b>[🐔 铁山靠]</b> 完美弹反！',
          callout: { x: orb.x, y: orb.y - 46, text: '📜 敌方飞弹 · 按铁山靠弹反！', col: '#4ade80' }
        });
      } else if (!orb) {
        beginTutorialLesson(5);
      }
    } else if (tutorialSession.subPhase === '5_parried') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.82) {
        addPopup('👏 完美弹反掌握！', player.x + 32, player.y - 98, '#4ade80', 19);
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
          badge: '⚔️ 战斗教学 6/10 · 大招定格',
          title: `第 6 步：释放角色专属大招【${h.skillLbl}】`,
          main: '面对成群怪物或尖刺怪时，使用右侧紫色<b>角色专属大招</b>可瞬间大范围清场！（奶龙可按住持续喷火）',
          cta: pc ? '👉 点击 <b>[鼠标右键]</b>（或按键盘 <b>[K键]</b>）释放大招！' : `👉 点击右侧发光的 <b>[${h.skillIcon || '✨'} ${h.skillLbl}]</b> 按钮！`,
          callout: { x: firstMob.x + 65, y: -98, text: '👾 密集怪群 · 开大招一键清场！', col: '#c084fc' }
        });
      }
    } else if (tutorialSession.subPhase === '6_cast') {
      player.invulnTimer = Math.max(player.invulnTimer, 0.45);
      tutorialSession.phaseTimer += realDt;
      if ((tutorialSession.step6Kills || 0) >= 4 && tutorialSession.phaseTimer >= 0.72) {
        addPopup('👏 角色大招掌握！', player.x + 32, player.y - 98, '#4ade80', 19);
        beginTutorialLesson(7);
      } else if (tutorialSession.phaseTimer >= 2.2) {
        beginTutorialLesson(6);
      }
    }
    return;
  }

  if (st === 7) {
    if (tutorialSession.subPhase === 'approach') {
      if (player.x >= tutorialSession.targetX && player.onGround) {
        // Simulate low HP right after picking up the track prop so player learns emergency Medkit healing!
        player.tempShieldHp = 0;
        player.tempShieldTimer = 0;
        player.hp = Math.max(18, Math.round(player.maxHp * 0.25));
        player.displayHp = player.hp;
        player.trailHp = player.maxHp;
        refreshBuffChips();
        updateTopHUD();
        pauseForTutorialPrompt('heal', {
          badge: '💊 生存教学 7/10 · 残血定格',
          title: '第 7 步：赛道道具与【🧰 急救包】救场！',
          main: '赛道上常会飘落<b>🪂 空投护盾、巨化蘑菇、篮球加特林</b>等道具！若不慎被打至<b>红血危急状态</b>，使用左侧<b>🧰 急救包</b>可立即回 100 血（本教学免费体验）！',
          cta: pc ? '👉 请按键盘 <b>[H键]</b>（或点击左侧发光的<b>🧰 急救包</b>）瞬间回满血！' : '👉 请点击左侧发光的 <b>[🧰 急救包 +100]</b> 瞬间回满血！',
          callout: { x: player.x + 10, y: -110, text: '💔 模拟残血危急 · 按 H 急救回满！', col: '#fb7185' }
        });
      }
    } else if (tutorialSession.subPhase === '7_healed') {
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.68) {
        addPopup('👏 生存补给掌握！', player.x + 28, player.y - 96, '#4ade80', 19);
        beginTutorialLesson(8);
      }
    }
    return;
  }

  if (st === 8) {
    if (tutorialSession.subPhase === 'approach') {
      if (tutorialSession.targetX - player.x <= 125 && player.onGround) {
        pauseForTutorialPrompt('hyper', {
          badge: '☄️ 进阶神技 8/10 · 冲刺定格',
          title: '第 8 步：【☄️ 超级霸王究极冲刺】碾碎运钞车！',
          main: '前方同时出现<b>断桥、激光电网与🚨 装甲运钞车</b>！启动左侧金色<b>超级霸王究极冲刺</b>将化身无敌彗星，自动铺桥并撞爆运钞车狂爆绿豆！（教学免费，实战松手即停省能量）',
          cta: pc ? '👉 按住键盘 <b>[Shift键]</b>（或点击左侧金色<b>霸王冲刺</b>）无敌冲锋！' : '👉 按住左侧发光的金色 <b>[☄️ 超级霸王究极冲刺]</b> 按钮！',
          callout: { x: tutorialSession.targetX + 210, y: -96, text: '🚨 电网与装甲运钞车 · 开霸王冲刺撞爆！', col: '#fde047' }
        });
      }
    } else if (tutorialSession.subPhase === '8_dashing') {
      store.save.dashEnergy = 20;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 1.45) {
        forceStopHyperDash();
        addPopup('👏 霸王冲刺掌握！', player.x + 32, player.y - 98, '#fde047', 20);
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
          badge: '⚔️ 首领教学 9/10（1/3 躲招）· 已暂停',
          title: '第 9 步（一）：起跳躲避首领地面招式！',
          main: '首领 <b>🐔 陪练叮咚鸡</b> 放出了贴地刺轮冲击！实战中首领放出地面招式时（起跳键亮光），先<b>起跳躲开</b>！',
          cta: pc ? '👉 按 <b>[空格键]</b> 跃过首领的地面刺轮！' : '👉 点击左下角 <b>[⬆️ 起跳]</b> 跃过地面刺轮！',
          callout: { x: wave.x, y: -76, text: '⚙️ 首领地面冲击 · 起跳躲避！', col: '#38bdf8' }
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
          badge: '⚔️ 首领教学 9/10（2/3 破防）· 已暂停',
          title: '第 9 步（二）：【🐔 铁山靠】弹反破防打晕首领！',
          main: '叮咚鸡发光俯冲扑来了！在首领近身冲撞或投掷道具时（铁山靠亮黄框），用<b>🐔 铁山靠</b>可直接将首领<b>弹反打晕</b>！',
          cta: pc ? '👉 点击 <b>[鼠标左键 / J键]</b> 破防打晕叮咚鸡！' : '👉 点击右下角发光的 <b>[🐔 铁山靠]</b> 破防打晕叮咚鸡！',
          callout: { x: activeBoss.worldX, y: -125, text: '🐔 首领发光俯冲 · 铁山靠破防！', col: '#fde047' }
        });
      }
    } else if (tutorialSession.subPhase === '9B_parried' && activeBoss) {
      activeBoss.stunTimer = 8.0;
      activeBoss.worldX = player.x + 158;
      activeBoss.yOff = 0;
      tutorialSession.phaseTimer += realDt;
      if (tutorialSession.phaseTimer >= 0.35 && player.onGround) {
        tutorialSession.subPhase = '9C_wait_skill';
        player.skillCd = 0;
        player.flameFuel = 100;
        syncControlsUI();
        pauseForTutorialPrompt('skill', {
          badge: '⚔️ 首领教学 9/10（3/3 暴击）· 已暂停',
          title: '第 9 步（三）：趁首领眩晕开大招享 140% 暴击！',
          main: '平A打首领有护甲减伤，而趁首领<b>💫 破防眩晕</b>时释放<b>角色大招</b>可无视护甲打出 <b>140% 巨额暴击</b>！现在开大招重创它！',
          cta: pc ? '👉 点击 <b>[鼠标右键 / K键]</b> 趁眩晕灌满大招暴击！' : `👉 点击右侧紫色 <b>[${h.skillIcon || '✨'} ${h.skillLbl}]</b> 灌满暴击！`,
          callout: { x: activeBoss.worldX, y: -125, text: '💫 破防眩晕中 · 开大招 140% 暴击！', col: '#c084fc' }
        });
      }
    } else if (tutorialSession.subPhase === '9C_cast') {
      if (activeBoss) {
        activeBoss.worldX = player.x + 162;
        activeBoss.yOff = 0;
        tutorialSession.phaseTimer += realDt;
        // Guarantee transition into Enrage Phase 2 once skill lands!
        if (tutorialSession.phaseTimer >= 0.45 && activeBoss.phase < 2) {
          hitBoss(65, false, false, true);
        }
        if (activeBoss.phase >= 2 && tutorialSession.phaseTimer >= 0.85) {
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
          badge: '🔥 毕业决战 10/10 · 狂暴定格',
          title: '第 10 步：首领二阶狂暴 +【☄️ 霸王冲刺】怼墙压制！',
          main: '叮咚鸡半血进入了<b>🔥 二阶狂暴形态</b>并召唤护卫小怪！此时开启<b>超级霸王究极冲刺</b>不仅瞬间清光小怪，还会展开<b>钢铁护盾墙</b>把狂暴首领死死按在墙上削至残血！',
          cta: pc ? '👉 按住 <b>[Shift键]</b>（或点击左侧金色<b>霸王冲刺</b>）把首领怼在钢墙上！' : '👉 按住左侧金色 <b>[☄️ 超级霸王究极冲刺]</b> 把首领怼墙削血！',
          callout: { x: activeBoss.worldX, y: -125, text: '🔥 二阶狂暴首领 · 开霸王冲刺怼墙！', col: '#ef4444' }
        });
      }
    } else if (tutorialSession.subPhase === '10_pinning') {
      store.save.dashEnergy = 20;
      tutorialSession.phaseTimer += realDt;
      if (activeBoss && activeBoss.hp > 16) {
        activeBoss.hp = Math.max(16, activeBoss.hp - 42 * realDt);
        refreshBossHudUI();
      }
      if (tutorialSession.phaseTimer >= 1.45) {
        forceStopHyperDash();
        tutorialSession.subPhase = '10_finish';
        tutorialSession.phaseTimer = 0;
        player.skillCd = 0;
        player.flameFuel = 100;
        if (activeBoss) {
          activeBoss.hp = Math.min(activeBoss.hp, 14);
          activeBoss.stunTimer = 6.0;
          activeBoss.worldX = player.x + 155;
          activeBoss.yOff = 0;
          refreshBossHudUI();
        }
        syncControlsUI();
        setTutorialCoachDisplay({
          badge: '🏆 毕业决战 10/10 · 最后一击！',
          title: '首领仅剩一丝残血！亲手终结它完成毕业！',
          main: '霸王冲刺会将首领精准削至残血留给你收尾！现在用<b>铁山靠</b>或<b>角色大招</b>完成最后一击！',
          cta: pc ? '⚡ 点击 <b>[鼠标左键·铁山靠]</b> 或 <b>[鼠标右键·大招]</b> 斩杀首领！' : '⚡ 点击右下角 <b>[🐔 铁山靠]</b> 或 <b>[角色大招]</b> 斩杀首领！',
          spotlightBtn: 'both_atk',
          paused: false,
          alertGlow: true
        });
      }
    } else if (tutorialSession.subPhase === '10_finish') {
      player.skillCd = 0;
      if (h.id === 'nailong') player.flameFuel = Math.max(player.flameFuel, 85);
      if (activeBoss) {
        activeBoss.stunTimer = Math.max(activeBoss.stunTimer, 2.0);
        activeBoss.worldX = player.x + 155;
        activeBoss.yOff = 0;
      } else if (tutorialSession.bossSpawned && tutorialSession.graduatingTimer <= 0) {
        tutorialSession.graduatingTimer = 0.75;
        setTutorialCoachDisplay({
          badge: '🎉 恭喜满分毕业！',
          title: '太强了！你已彻底贯通全部机制与首领战法！',
          main: '首领被击败会爆出大量绿豆并为你恢复生命！',
          cta: '🎁 正在打开毕业总结卡并发放 +300🌿 绿豆……',
          paused: false
        });
      }
    }
  }
}

function startNewRun(heroId, startDistMeters = 0, boostMeters = 0) {
  clearTutorialSpotlights();
  ensureAudio();
  const s = store.save;
  activeRunHeroId = heroId || s.selectedHero;
  const h = getHero();

  const initDist = startDistMeters;
  runStartDist = initDist;
  prevBestSingleRun = s.bestSingleRun || 0;
  runStats = {
    dist: initDist,
    singleRunDist: 0,
    beans: 0,
    bossKills: 0,
    reviveUsed: false,
    healBuysUsed: 0,
    deathDashMeters: 0,
    deathDashUsed: false
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
  bossCycleCount = 0;
  lastThreatTier = 1;
  pendingShare = null;
  if (reviveStatusHint) reviveStatusHint.classList.add('hidden-block');
  nextBossDist = initDist + 150;
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
  player.dotPool = 0;
  player.autoRegenTimer = 5.0;
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
  player.midasTimer = 0; player.thunderAuraTimer = 0; player.thunderAuraTick = 0; player.skyWingsTimer = 0;
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
}

const hudHealBtn = document.getElementById('hudHealBtn');
const hudHealLbl = document.getElementById('hudHealLbl');
const pauseHealStock = document.getElementById('pauseHealStock');
const pauseBuyHealBtn = document.getElementById('pauseBuyHealBtn');
const goDeathDashRow = document.getElementById('goDeathDashRow');
const goDeath400Btn = document.getElementById('goDeath400Btn');
const goDeath800Btn = document.getElementById('goDeath800Btn');

function refreshHealSupplyUI() {
  const used = runStats.healBuysUsed || 0;
  const left = Math.max(0, 3 - used);
  if (hudHealBtn) {
    const lblEl = hudHealLbl || hudHealBtn;
    setTextCached('hHealTxt', lblEl, `急救包 +100 (${left}/3)`);
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
  if (!pauseOverlay.classList.contains('hidden') || state === 'PAUSED') resumeFromPause();
  else if (state === 'PLAYING') pauseGame();
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
  if (partyCtrl && partyCtrl.isActive()) {
    partyCtrl.exitPartyToHub();
    return;
  }
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
    const shRoadY = getBaseSurfaceY(shx);
    const shPara = Math.random() < 0.50;
    const shy = shPara ? (shRoadY - 330) : (shRoadY - 96);
    worldProps.push({
      x: shx,
      y: shy,
      baseY: shy,
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
      const hy = getBaseSurfaceY(hx) - 108;
      worldProps.push({ x: hx, y: hy, baseY: hy, def: HEAL_BOBA_PROP, taken: false, phase: Math.random() * 6 });
    } else {
      nextHealDist = chunkDist + 240;
    }
  }

  // 2. Rich Track Props (First prop guaranteed sky-floating parachute airdrop; ~68% sky-drifting thereafter!)
  if (chunkDist >= nextPropDist) {
    nextPropDist = chunkDist + 125 + Math.floor(Math.random() * 55);
    const isParachute = !runStats.firstSkyPropSpawned || Math.random() < 0.68;
    runStats.firstSkyPropSpawned = true;
    const px = spawnX + 165;
    const roadY = getBaseSurfaceY(px);
    const py = isParachute ? (roadY - 330) : (roadY - 94);
    const pick = WORLD_PROP_POOL[Math.floor(Math.random() * WORLD_PROP_POOL.length)];
    const chutePalette = ['#ef4444', '#f97316', '#3b82f6', '#a855f7'];
    worldProps.push({
      x: px,
      y: py,
      baseY: py,
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

  // 100% FULL stage spawning at all times (normal, Hyper Dash, HeadStart, AND Boss fights!)
  while (nextSpawnX < player.x + 1650) {
    const st = getStageForWorldX(nextSpawnX);
    const chunkDist = Math.max(0, (nextSpawnX - 120) / 18);
    const r = Math.random();

    trySpawnTrackPropsAt(chunkDist, nextSpawnX);

    // Pure Distance-Scaled Ambush Saws & Staggered High+Low Crossfire!
    const allowPit = !activeBoss || player.hyperDashActive;
    const willBePit = allowPit && ((st.id === 'site' && r < 0.34) || (st.id === 'volcano' && r < 0.36));
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
          if (beans.length < 280) beans.push({ x: bx, y: getBaseSurfaceY(bx) - 172, val: 1, giant: i === 2, taken: false });
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
          if (beans.length < 280) beans.push({ x: bx, y: getBaseSurfaceY(bx) - 174, val: 1, giant: i === 3, taken: false });
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
        if (beans.length < 280) beans.push({ x: jx, y: getBaseSurfaceY(jx) - 165, val: 1, giant: i === 3, taken: false });
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
      cause: '🪼 曼波女王 · 深海涨潮与音符弹幕',
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
  if (!tryConsumeTutorialInput('action')) return;
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
  if (partyCtrl && partyCtrl.isActive() && partyCtrl.tryMeleeShoulderBump) {
    partyCtrl.tryMeleeShoulderBump();
  }
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
    if (activeBoss.flameTick >= 0.16) {
      activeBoss.flameTick = 0;
      handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
      hitBoss(14.5, false, false, true);
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
    handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
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
    || (tutorialWelcomeOverlay && !tutorialWelcomeOverlay.classList.contains('hidden'))
    || (tutorialGradOverlay && !tutorialGradOverlay.classList.contains('hidden'))
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
      if (tutorialWelcomeOverlay && !tutorialWelcomeOverlay.classList.contains('hidden')) {
        try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch (_) {}
        tutorialWelcomeOverlay.classList.add('hidden');
      }
      if (tutorialGradOverlay && !tutorialGradOverlay.classList.contains('hidden')) {
        tutorialGradOverlay.classList.add('hidden');
        finishRunAndOpenHub();
      }
      if (partyCtrl) partyCtrl.closeModalsOnEsc();
    } else if (tutorialWelcomeOverlay && !tutorialWelcomeOverlay.classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      startTutorialRun();
    } else if (tutorialGradOverlay && !tutorialGradOverlay.classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      tutorialGradOverlay.classList.add('hidden');
      completeTutorialHandoffToLiveRun(false);
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
    if (tutorialSession.step === 3) {
      tutorialSession.bulletTimeActive = false;
      tutorialSession.timeScale = 1.0;
      tutorialSession.shotTimer = 0.45;
      if (tutorialCoachHud) tutorialCoachHud.classList.remove('parry-alert');
      addPopup('⏱️ 再试一次弹反!', player.x + 28, player.y - 98, '#fde047', 17);
      setTutorialStepUI(3);
    } else {
      player.invulnTimer = 0.45;
    }
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
      if (en.hit || en.swallowing || en.isTutStep1) continue;
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
      player.hyperReleaseGrace = Math.max(player.hyperReleaseGrace, tutorialSession.active ? 1.65 : 0.24);
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
      for (let i = 0; i < enemyShots.length; i++) {
        if (!enemyShots[i].dead && Math.abs(enemyShots[i].x - player.x) < 165) enemyShots[i].dead = true;
      }
      for (let i = 0; i < laserGates.length; i++) {
        if (!laserGates[i].hacked && Math.abs(laserGates[i].x - player.x) < 165) { laserGates[i].hacked = true; laserGates[i].passed = true; }
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
            addPopup('💥 怼边狂创!!', activeBoss.worldX - 35, getBaseSurfaceY(wallX) - 108, '#fde047', 18);
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
      if (!sh.dead && sh.x > player.x - 20 && sh.x < player.x + 420) {
        if (beans.length < 280) beans.push({ x: sh.x, y: sh.y, val: 2, giant: true, taken: false });
        sh.dead = true;
      }
    }
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing || en.isTutStep1) continue;
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
        if (!cashTrucks[i].dead && Math.abs(cashTrucks[i].x - cx) < tongueR) hitCashTruck(cashTrucks[i], 1);
      }
      if (activeBoss && Math.abs(activeBoss.worldX - cx) < tongueR + 60) {
        handlePlayerBossInteraction(activeBoss, getBossCallbacks(), 'skill');
        hitBoss(13.5, false, false, true);
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

  if (player.midasTimer > 0) player.midasTimer = Math.max(0, player.midasTimer - realDt);
  if (player.skyWingsTimer > 0) {
    player.skyWingsTimer = Math.max(0, player.skyWingsTimer - realDt);
    if (!player.onGround && player.vy > 75) player.vy = 75;
  }
  if (player.thunderAuraTimer > 0) {
    player.thunderAuraTimer = Math.max(0, player.thunderAuraTimer - realDt);
    player.thunderAuraTick = (player.thunderAuraTick || 0) - realDt;
    if (player.thunderAuraTick <= 0) {
      player.thunderAuraTick = 0.22;
      for (let i = 0; i < enemies.length; i++) {
        if (!enemies[i].hit && Math.abs(enemies[i].x - player.x) < 220) {
          enemies[i].shielded = false;
          defeatEnemy(enemies[i]);
        }
      }
      for (let i = 0; i < laserGates.length; i++) {
        if (!laserGates[i].hacked && Math.abs(laserGates[i].x - player.x) < 220) {
          laserGates[i].hacked = true;
          laserGates[i].passed = true;
        }
      }
      for (let i = 0; i < enemyShots.length; i++) {
        if (!enemyShots[i].dead && Math.abs(enemyShots[i].x - player.x) < 200) enemyShots[i].dead = true;
      }
      if (activeBoss && superBonusTimer <= 0 && Math.abs(activeBoss.worldX - player.x) < 280) {
        hitBoss(9.5, false, false, true);
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
    // Anchored directly to current normal speed — distinctly faster even when pinning a Boss!
    desiredVx = Math.round(curNormalVx * (activeBoss && activeBoss.pinnedByHyper ? 1.78 : 2.35));
  }
  else if (player.rocketDashTimer > 0) desiredVx = Math.round(curNormalVx * 2.15);
  else if (superBonusTimer > 0) desiredVx = Math.round(curNormalVx * 1.42);
  else if (player.boostTimer > 0 || player.giantTimer > 0 || player.skyWingsTimer > 0 || onIce) desiredVx *= onIce ? 1.22 : 1.18;
  else if (inMud) desiredVx *= 0.75;
  player.vx += (desiredVx - player.vx) * Math.min(1, dt * (isPartyMode ? 24 : 8));

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
            partyCtrl.triggerPartyPlayerKO(true);
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
        wp.y = getBaseSurfaceY(wp.x) - 330;
      } else {
        wp.x += player.vx * 0.54 * dt + Math.sin(wp.phase * 1.15) * 42 * dt;
        wp.y += 108 * dt; // Drifts smoothly down from the sky right in front of the rider!
        const landingY = getBaseSurfaceY(wp.x) - 56;
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

    if (hasBossImmediateParryCue(activeBoss, player)) parryGlow = true;
    if (hasBossImmediateJumpCue(activeBoss, player)) jumpGlow = true;

    if (isPartyMode) {
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

  // Road Enemy & Shot Updates (Aggression & Shot Speed Scale Purely by Distance Tier!)
  if (superBonusTimer <= 0) {
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.hit || en.swallowing || en.isTutStep1) continue;
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
          if (player.giantTimer <= 0) {
            takePlayerDamage(16, false, {
              cause: '⚙️ 地面高速刺轮锯',
              tip: '看到地面刺轮逼近可【起跳】越过，或正面挥出【铁山靠】直接打爆！'
            });
          }
        }
      } else if (sh.kind === 'hover_saw') {
        if (sh.x - player.x < 940) sh.x += sh.vx * dt;
        sh.y = getBaseSurfaceY(sh.x) - (sh.hOff || 98);
        sh.rot -= 15 * dt;
        if (Math.hypot(sh.x - player.x, sh.y - (player.y - 40)) < 33) {
          sh.dead = true;
          if (player.giantTimer <= 0) {
            takePlayerDamage(16, false, {
              cause: '🪚 低空悬浮电锯',
              tip: '悬浮电锯在半空飞行，保持地面骑行从下方穿过，或按【铁山靠】击毁！'
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
      const isDroneStomp = en.kind === 'drone' && player.vy > -55 && player.y <= ey + 16 && player.y >= ey - 60;
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

  // Zero-allocation in-place world cleanup!
  const cut = isPartyMode ? (cam.camX - 1000) : (cam.camX - 280);
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

  if (isPartyMode) {
    partyCtrl.updatePartyFrame(realDt);
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
  drawSculptedBikeAndHero(pCtx, store.save.selectedHero, cw * 0.48, ch - 13, 0, t, t * 0.8, Math.sin(t * 2) * 3, store.save.mods, { scale: 0.65 });
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
      // Support pylons at rail ends
      for (const px of [x1 + 14, x2 - 14]) {
        if (px >= startWX - 20 && px <= endWX + 20) {
          const gy = getBaseSurfaceY(px);
          const ry = gy - rl.hOff;
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.52)';
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px, ry + 4); ctx.stroke();
        }
      }
      // 3D Beveled Skyrail / Maglev Beam
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 12;
      ctx.beginPath();
      for (let wx = x1; wx <= x2; wx += 24) {
        const ry = getBaseSurfaceY(wx) - rl.hOff;
        if (wx === x1) ctx.moveTo(wx, ry); else ctx.lineTo(wx, ry);
      }
      ctx.stroke();

      ctx.strokeStyle = rl.energizedTimer > 0 ? '#fde047' : (rl.kind === 'maglev' ? '#38bdf8' : '#e2e8f0');
      ctx.lineWidth = 6.5;
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
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
  rails = []; checkpointFlags = []; worldProps = []; cashTrucks = [];
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
  bankRunProgress(false);
  store.flushBeacon();
  if (partyCtrl && partyCtrl.flushLeaveBeacon) {
    partyCtrl.flushLeaveBeacon();
  }
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
    startTutorialRun();
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

// Auto-join PvP room if URL has ?room=XXXX; otherwise show 30s Hands-On Tutorial prompt for brand-new players!
(async () => {
  let handledRoomLink = false;
  if (partyCtrl && partyCtrl.checkUrlRoomAutoJoin) {
    handledRoomLink = await partyCtrl.checkUrlRoomAutoJoin();
  }
  if (!handledRoomLink) {
    try {
      const tutDone = Boolean(localStorage.getItem(TUT_DONE_KEY));
      const isFreshPlayer = (store.save.bestSingleRun || 0) < 30;
      if (!tutDone && isFreshPlayer && tutorialWelcomeOverlay) {
        tutorialWelcomeOverlay.classList.remove('hidden');
      }
    } catch (_) {}
  }
})();

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

try {
  if (location.search && location.search.includes('qaBoss')) {
    history.replaceState(null, '', location.pathname);
  }
} catch (_) {}
