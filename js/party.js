// ============================================================================
// 《鹈鹕测试大乱斗》 — Online Multiplayer Party Race & Meme Item Brawl Engine
// Features:
//  1. Lobby Matchmaking: 4-Digit Room Create/Join, Quickmatch & Smart Meme AI Rival
//  2. Deterministic Spliced Track: 10 Handcrafted Modules + Start/Finish Gantries
//  3. Live Same-Track Rival Rendering, Speech Bubbles, Status VFX & Edge Pointers
//  4. 2-Slot Party Meme Item Bar + 8 Authentic Audio/Visual Meme Brawl Items
//  5. Non-Lethal 1.3s Pelican Rescue Respawn & Server-Adjudicated Finish Podium
// ============================================================================

import { HEROES } from './config.js?v=6.9';
import {
  drawModelOn,
  drawSpaldingWheelOn,
  drawSculptedBikeAndHero
} from './models.js?v=6.9';
import {
  ensureAudio,
  playVoiceSlice,
  playSfx
} from './audio.js?v=6.9';

const PARTY_PID_KEY = 'pelican_party_pid_v1';
const PARTY_TAB_SID_KEY = 'pelican_party_tabsid_v1';
const PARTY_NICK_KEY = 'pelican_party_nick_v1';

export const PARTY_MEME_ITEMS = {
  melee_bump: {
    id: 'melee_bump',
    ico: '🐔',
    shortName: '铁山靠',
    fullName: '🐔 贴脸铁山靠',
    color: '#fb923c'
  },
  timed_shield: {
    id: 'timed_shield',
    ico: '🛡️',
    shortName: '金钟罩',
    fullName: '🛡️ 背带金钟罩',
    color: '#38bdf8'
  },
  ddj_rush: {
    id: 'ddj_rush',
    ico: '🐔',
    shortName: '叮咚鸡血',
    fullName: '🐔 叮咚鸡血',
    color: '#facc15'
  },
  bean_nitro: {
    id: 'bean_nitro',
    ico: '🧋',
    shortName: '南北绿豆',
    fullName: '🧋 南北绿豆',
    color: '#4ade80'
  },
  naiwa_swarm: {
    id: 'naiwa_swarm',
    ico: '🐸',
    shortName: '狂撒奶蛙',
    fullName: '🐸 狂撒奶蛙群',
    color: '#84cc16'
  },
  truck_isekai: {
    id: 'truck_isekai',
    ico: '🚛',
    shortName: '泥头车创',
    fullName: '🚛 大运泥头车',
    color: '#ef4444'
  },
  dagou_bite: {
    id: 'dagou_bite',
    ico: '🐕',
    shortName: '大狗咬腚',
    fullName: '🐕 大狗嚼追咬',
    color: '#d97706'
  },
  bball_rain: {
    id: 'bball_rain',
    ico: '🏀',
    shortName: '篮球陨石',
    fullName: '🏀 篮球陨石雨',
    color: '#f97316'
  },
  lawyer_seal: {
    id: 'lawyer_seal',
    ico: '📜',
    shortName: '律师函',
    fullName: '📜 律师函警告',
    color: '#eab308'
  },
  maodie_trap: {
    id: 'maodie_trap',
    ico: '😾',
    shortName: '耄耋群扑',
    fullName: '😾 圆头耄耋群',
    color: '#fb923c'
  },
  pelican_carry: {
    id: 'pelican_carry',
    ico: '🦢',
    shortName: '顺丰强揽',
    fullName: '🦢 鹈鹕顺丰叼',
    color: '#38bdf8'
  },
  manbo_steal: {
    id: 'manbo_steal',
    ico: '🐴',
    shortName: '曼波偷速',
    fullName: '🐴 曼波偷速波',
    color: '#ec4899'
  },
  lightning_whip: {
    id: 'lightning_whip',
    ico: '🔔',
    shortName: '雷霆巨钟',
    fullName: '🔔 雷霆少林钟',
    color: '#a855f7'
  },
  kun_rocket: {
    id: 'kun_rocket',
    ico: '🚀',
    shortName: '窜天猴',
    fullName: '🚀 背带窜天猴',
    color: '#ef4444'
  },
  pan_shield: {
    id: 'pan_shield',
    ico: '🥘',
    shortName: '纯路人锅',
    fullName: '🥘 纯路人铁锅',
    color: '#facc15'
  }
};

export const PARTY_MODULE_META = {
  start_launchpad: { name: '🚦 竞速发车台', short: '🚦发车台', lenM: 100, stageIdx: 0 },
  ikun_trampoline: { name: '🏀 背带三连跳台', short: '🏀背带跳台', lenM: 170, stageIdx: 0 },
  canyon_skyrail: { name: '🌉 深渊高空滑轨', short: '🌉深渊滑轨', lenM: 170, stageIdx: 1 },
  truck_gauntlet: { name: '🚛 泥头车对冲廊', short: '🚛泥头车阵', lenM: 170, stageIdx: 6 },
  wave_coaster: { name: '🎢 过山车起伏坡', short: '🎢过山车坡', lenM: 170, stageIdx: 3 },
  split_decker: { name: '🛣️ 双层博弈高架', short: '🛣️双层高架', lenM: 170, stageIdx: 1 },
  maodie_ambush: { name: '😾 耄耋法务埋伏', short: '😾耄耋埋伏', lenM: 170, stageIdx: 5 },
  mega_vault: { name: '🌋 超级弹簧峡谷', short: '🌋飞跃峡谷', lenM: 170, stageIdx: 4 },
  narrow_brawl: { name: '⚔️ 窄桥互坑乱斗', short: '⚔️窄桥互坑', lenM: 170, stageIdx: 2 },
  turbo_chicane: { name: '🌈 涡轮彩虹弯道', short: '🌈涡轮弯道', lenM: 170, stageIdx: 6 },
  final_sprint: { name: '🏁 狂欢终点冲刺', short: '🏁终点冲刺', lenM: 200, stageIdx: 0 },
  finish_sprint: { name: '🏁 狂欢终点冲刺', short: '🏁终点冲刺', lenM: 200, stageIdx: 0 }
};

function createSeededRng(seedInt) {
  let a = (Number(seedInt) >>> 0) || 0x6d2b79f5;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashTrackSegSeed(trackSeed, segIdx) {
  let h = (Number(trackSeed) ^ Math.imul(segIdx + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

function getHeroIcon(heroId) {
  const found = HEROES.find((h) => h.id === heroId);
  return found ? found.icon : '🐉';
}

function getHeroName(heroId) {
  const found = HEROES.find((h) => h.id === heroId);
  return found ? found.name : '大头奶龙';
}

function formatRaceTime(ms) {
  const safe = Math.max(0, Math.floor(Number(ms) || 0));
  const mins = Math.floor(safe / 60000);
  const secs = Math.floor((safe % 60000) / 1000);
  const tenths = Math.floor((safe % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function formatPodiumTime(ms) {
  const safe = Math.max(0, Math.floor(Number(ms) || 0));
  const mins = Math.floor(safe / 60000);
  const secs = Math.floor((safe % 60000) / 1000);
  const hundredths = Math.floor((safe % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function getOrCreatePartyPlayerId() {
  let sid = '';
  try { sid = sessionStorage.getItem(PARTY_TAB_SID_KEY) || ''; } catch (_) {}
  if (sid.length < 4) {
    sid = Math.random().toString(36).slice(2, 7);
    try { sessionStorage.setItem(PARTY_TAB_SID_KEY, sid); } catch (_) {}
  }
  let pid = '';
  try { pid = localStorage.getItem(PARTY_PID_KEY) || ''; } catch (_) {}
  if (pid.length < 6) {
    pid = `pr_${Math.random().toString(36).slice(2, 8)}`;
    try { localStorage.setItem(PARTY_PID_KEY, pid); } catch (_) {}
  }
  return `${pid}_${sid}`;
}

export function createPartyController(bridge) {
  // DOM Elements
  const partyOpenBtn = document.getElementById('partyOpenBtn');
  const partyLobbyOverlay = document.getElementById('partyLobbyOverlay');
  const partyLobbyCloseBtn = document.getElementById('partyLobbyCloseBtn');
  const partyAccountBadge = document.getElementById('partyAccountBadge');
  const partyHeroPicker = document.getElementById('partyHeroPicker');
  const partyPodiumHeroPicker = document.getElementById('partyPodiumHeroPicker');
  const partyNickInp = document.getElementById('partyNickInp');
  const partyLobbyEntryView = document.getElementById('partyLobbyEntryView');
  const partyLobbyWaitView = document.getElementById('partyLobbyWaitView');
  const partyQuickMatchBtn = document.getElementById('partyQuickMatchBtn');
  const partyInstantBotBtn = document.getElementById('partyInstantBotBtn');
  const partyCreateRoomBtn = document.getElementById('partyCreateRoomBtn');
  const partyJoinCodeInp = document.getElementById('partyJoinCodeInp');
  const partyJoinRoomBtn = document.getElementById('partyJoinRoomBtn');

  const partyWaitCodeTxt = document.getElementById('partyWaitCodeTxt');
  const partyCopyCodeBtn = document.getElementById('partyCopyCodeBtn');
  const partyWaitMeIco = document.getElementById('partyWaitMeIco');
  const partyWaitMeNm = document.getElementById('partyWaitMeNm');
  const partyWaitRivalCard = document.getElementById('partyWaitRivalCard');
  const partyWaitRivalIco = document.getElementById('partyWaitRivalIco');
  const partyWaitRivalNm = document.getElementById('partyWaitRivalNm');
  const partyWaitRivalSt = document.getElementById('partyWaitRivalSt');
  const partyPlanStrip = document.getElementById('partyPlanStrip');
  const partyWaitStatusMsg = document.getElementById('partyWaitStatusMsg');
  const partyWaitAddBotBtn = document.getElementById('partyWaitAddBotBtn');
  const partyLeaveRoomBtn = document.getElementById('partyLeaveRoomBtn');

  const singleHudRow = document.getElementById('singleHudRow');
  const feverRow = document.getElementById('feverRow');
  const hudHealBtn = document.getElementById('hudHealBtn');
  const hyperDashBtn = document.getElementById('hyperDashBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const partyStaminaBtn = document.getElementById('partyStaminaBtn');
  const partyStaminaFill = document.getElementById('partyStaminaFill');
  const partyStaminaLbl = document.getElementById('partyStaminaLbl');
  const partyProgressHud = document.getElementById('partyProgressHud');
  const partyPlaceBadge = document.getElementById('partyPlaceBadge');
  const partySegBadge = document.getElementById('partySegBadge');
  const partyTimeTxt = document.getElementById('partyTimeTxt');
  const partyTrackMeFill = document.getElementById('partyTrackMeFill');
  const partyMePin = document.getElementById('partyMePin');
  const partyMePinIco = document.getElementById('partyMePinIco');
  const partyRivalPin = document.getElementById('partyRivalPin');
  const partyRivalPinIco = document.getElementById('partyRivalPinIco');
  const partyRivalPinLbl = document.getElementById('partyRivalPinLbl');
  const partyFinishLbl = document.getElementById('partyFinishLbl');

  const partyItemBar = document.getElementById('partyItemBar');
  const slotEls = [
    {
      btn: document.getElementById('partySlot0'),
      ico: document.getElementById('partySlot0Ico'),
      nm: document.getElementById('partySlot0Nm'),
      tag: document.getElementById('partySlot0Tag')
    },
    {
      btn: document.getElementById('partySlot1'),
      ico: document.getElementById('partySlot1Ico'),
      nm: document.getElementById('partySlot1Nm'),
      tag: document.getElementById('partySlot1Tag')
    }
  ];

  const partyCountdownOverlay = document.getElementById('partyCountdownOverlay');
  const partyCdNum = document.getElementById('partyCdNum');
  const partyCdSub = document.getElementById('partyCdSub');
  const partyAttackBanner = document.getElementById('partyAttackBanner');
  const partyLawyerOverlay = document.getElementById('partyLawyerOverlay');

  const partyPodiumOverlay = document.getElementById('partyPodiumOverlay');
  const partyPodiumBanner = document.getElementById('partyPodiumBanner');
  const partyPodiumCrown = document.getElementById('partyPodiumCrown');
  const partyPodiumSub = document.getElementById('partyPodiumSub');
  const partyPodiumList = document.getElementById('partyPodiumList');
  const partyRewardNote = document.getElementById('partyRewardNote');
  const partyRematchBtn = document.getElementById('partyRematchBtn');
  const partyPodiumHubBtn = document.getElementById('partyPodiumHubBtn');

  const playerId = getOrCreatePartyPlayerId();
  let lobbyBusy = false;
  let waitPollTimer = null;
  let raceSyncTimer = null;
  let syncInFlight = false;
  let bannerHideTimer = null;

  // Core Party Race Runtime State
  const party = {
    active: false, // True when in a live party countdown/race/podium
    roomCode: '',
    status: 'idle', // 'idle' | 'waiting' | 'countdown' | 'racing' | 'finished'
    raceDist: 3500,
    finishX: 120 + 3500 * 18,
    trackSeed: 123456,
    modulePlan: [],
    segments: [], // [{ idx, id, meta, startM, endM, startX, endX, lenPx, spawned }]
    startAtMs: 0,
    serverOffsetMs: 0,
    lastCountdownBeep: 99,
    goFlashTimer: 0,

    // 2-Slot Party Meme Item Inventory
    slots: [null, null],
    outgoingEvents: [],
    pendingTrapHitId: '',
    seenEventIds: new Set(),
    triggeredTrapIds: new Set(),

    // Track Interactive Objects specific to Party Race
    crates: [], // { x, y, baseY, taken, respawnAt, phase }
    skyDrops: [], // Chasing-Shadows style sky-drifting mini props [{ x, y, kind, ico, chuteCol, parachute, taken, phase }]
    nextSkyDropDist: 55,
    skyDropCount: 0,
    boostPads: [], // { x, len, hOff, cd }
    boostRings: [], // Sculpted 3D High-Altitude Turbo Boost Rings [{ x, y, baseY, hAbove, isGold, cd, spin }]
    serverTraps: [], // Legacy road traps
    homingMissiles: [], // Long-range locked-on homing projectiles
    bossTriggerDists: [980, 1960, 2870],
    bossTriggeredIdx: -1,
    visualBballs: [], // Raining basketballs visual [{ target: 'me'|'rival', offX, y, vy, rot, bounces }]
    chaosProjectiles: [], // Sculpted 2.5D frogs, dump trucks, chomping dogs, cats & giant bells!
    sonicWaves: [], // Manbo pink sonic rings [{ x, y, r, maxR, life }]
    lightningBolts: [], // [{ target: 'me'|'rival', life }]
    whipArcs: [], // Dynamic curved 5-lash electric whip arcs [{ owner: 'me'|'rival', idx, life, maxLife }]
    hitMarkers: [], // Attacker hit-confirm crosshairs [{ target: 'rival'|'me', text, color, life }]
    confetti: [],

    // 14-Node Verlet Distance-Tension Twisted 3D Rope Tied Between Both Bikes!
    ropeNodes: [], // [{ x, y, px, py }]
    ropeTensionRatio: 0,
    ropePullVx: 0,
    ropePullDir: 0,
    ropeSparkCd: 0,
    rivalTrailHp: 100,
    rivalHitFlash: 0,
    sync404Count: 0,

    // Interactive Genshin-Style Charging Sprint Bar (2~3 full charges per match, fast 1.55s drain!)
    stamina: 65,
    staminaTrail: 65,
    staminaShowAlpha: 1.0,
    staminaHeld: false,
    staminaBoosting: false,
    staminaExhaustCd: 0,
    staminaRegenDelay: 0,
    staminaSparkTick: 0,
    sprintGhosts: [], // [{ x, y, angle, heroId, life }]

    // Duel Tug-of-War, 20s Linear 2x Alive Ramp & Hero Skill PvP
    aliveStreakSec: 0,
    heroSkillHitCd: 0,
    dogYankTick: 0,
    dribbleSlamTick: 0,
    rematchVotes: [],
    roomPlayerCount: 2,
    wasAheadOfRival: null,
    overtakeCd: 0,
    meleeBumpCd: 0,
    rivalEdgeHitFlash: 0,
    rivalEdgeHitTxt: '',

    // Active Buff / Debuff / Respawn Timers on Local Player
    fx: {
      koCrawlTimer: 0,
      oneHitShieldTimer: 0,
      oneHitShieldMax: 7.0,
      panShieldTimer: 0,
      kunRocketTimer: 0,
      ddjRushTimer: 0,
      beanNitroTimer: 0,
      spicyDashTimer: 0,
      whipBoostTimer: 0,
      whipComboTimer: 0,
      whipComboNextLash: 0,
      pelicanBoostTimer: 0,
      pelicanClampedTimer: 0,
      naiwaPileTimer: 0,
      truckRammedTimer: 0,
      dagouBiteTimer: 0,
      bellCrushTimer: 0,
      manboBoostTimer: 0,
      manboSlowTimer: 0,
      bballSlowTimer: 0,
      lawyerBlindTimer: 0,
      maodieDizzyTimer: 0,
      dizzySpinTimer: 0,
      lightningStunTimer: 0,
      roadPadBoostTimer: 0,
      respawnTimer: 0,
      respawnStartX: 120,
      respawnStartY: 0,
      respawnTargetX: 120,
      mySpeech: '',
      mySpeechTimer: 0
    },

    // Live Rival Telemetry & Smooth 60fps Dead-Reckoning State
    rival: null, // Latest server snapshot
    rivalRender: {
      hasData: false,
      x: 120,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      wheelAngle: 0,
      crankAngle: 0,
      jiggle: 0,
      bballTimer: 0
    },

    // Settlement & Podium
    localFinished: false,
    finishedClientMs: 0,
    myItemsLanded: 0,
    myItemsUsed: 0,
    results: [],
    rewardClaimed: false
  };

  // ==================== DETERMINISTIC SPLICED TRACK BUILDER ====================
  function buildTrackSegments(modulePlan, raceDist, trackSeed) {
    const plan = Array.isArray(modulePlan) && modulePlan.length >= 2
      ? modulePlan
      : ['start_launchpad', 'ikun_trampoline', 'canyon_skyrail', 'wave_coaster', 'split_decker', 'maodie_ambush', 'truck_gauntlet', 'mega_vault', 'narrow_brawl', 'turbo_chicane', 'ikun_trampoline', 'final_sprint'];

    // Scale segment lengths proportionally if needed so total distance equals exact raceDist
    const rawTotalM = plan.reduce((acc, id) => acc + ((PARTY_MODULE_META[id] && PARTY_MODULE_META[id].lenM) || 170), 0);
    const scaleM = raceDist / Math.max(100, rawTotalM);

    const segs = [];
    let curM = 0;
    for (let i = 0; i < plan.length; i++) {
      const id = PARTY_MODULE_META[plan[i]] ? plan[i] : 'ikun_trampoline';
      const meta = PARTY_MODULE_META[id];
      const isLast = i === plan.length - 1;
      const segM = isLast ? Math.max(80, raceDist - curM) : Math.round(meta.lenM * scaleM);
      const startM = curM;
      const endM = curM + segM;
      const startX = 120 + startM * 18;
      const endX = 120 + endM * 18;
      segs.push({
        idx: i,
        id: id === 'finish_sprint' ? 'final_sprint' : id,
        meta,
        seed: hashTrackSegSeed(trackSeed, i),
        startM,
        endM,
        startX,
        endX,
        lenPx: Math.max(360, endX - startX),
        spawned: false
      });
      curM = endM;
    }
    party.segments = segs;
    party.finishX = 120 + raceDist * 18;
  }

  function findSegmentAtX(wx) {
    const segs = party.segments;
    if (!segs.length) return null;
    if (wx <= segs[0].startX) return segs[0];
    if (wx >= segs[segs.length - 1].endX) return segs[segs.length - 1];
    // Binary search over ~12 segments
    let lo = 0;
    let hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segs[mid];
      if (wx < s.startX) hi = mid - 1;
      else if (wx >= s.endX) lo = mid + 1;
      else return s;
    }
    return segs[0];
  }

  // C1-Continuous Deterministic Surface Height Shared 100% Identically by P1 & P2!
  function getSurfaceY(wx) {
    if (wx < 260 || wx >= party.finishX - 180) return 0;
    const seg = findSegmentAtX(wx);
    if (!seg) return 0;
    const u = Math.max(0, Math.min(1, (wx - seg.startX) / seg.lenPx));
    // Smooth Hann window: value = 0 and derivative = 0 at both u=0 and u=1!
    const env = Math.pow(Math.sin(Math.PI * u), 2);
    const id = seg.id;

    if (id === 'wave_coaster') {
      return (Math.sin(u * Math.PI * 6) * 56 + Math.sin(u * Math.PI * 12) * 10) * env;
    }
    if (id === 'turbo_chicane') {
      return Math.sin(u * Math.PI * 8) * 34 * env;
    }
    if (id === 'truck_gauntlet') {
      return -Math.abs(Math.sin(u * Math.PI * 3)) * 42 * env;
    }
    if (id === 'mega_vault') {
      // Ski-jump launch hill peaking around u=0.36 before the giant canyon!
      const ramp = u < 0.45 ? -Math.sin((u / 0.45) * Math.PI) * 48 : Math.sin(((u - 0.45) / 0.55) * Math.PI) * 18;
      return ramp * env;
    }
    if (id === 'ikun_trampoline') {
      return Math.sin(u * Math.PI * 4) * 22 * env;
    }
    if (id === 'canyon_skyrail' || id === 'split_decker') {
      return Math.sin(u * Math.PI * 2) * 16 * env;
    }
    if (id === 'maodie_ambush') {
      return Math.sin(u * Math.PI * 5 + 0.6) * 24 * env;
    }
    return Math.sin(u * Math.PI * 2) * 8 * env;
  }

  function addCrate(x, hAboveRoad = 52) {
    const ry = getSurfaceY(x);
    party.crates.push({
      x,
      y: ry - hAboveRoad,
      baseY: ry - hAboveRoad,
      taken: false,
      respawnTimer: 0,
      phase: (x * 0.017) % 6.28
    });
  }

  function addBoostPad(x, len = 135, hOff = 0) {
    party.boostPads.push({ x, len, hOff, cd: 0 });
  }

  function addBoostRing(x, hAboveRoad = 148, isGold = false) {
    const ry = getSurfaceY(x);
    party.boostRings.push({
      x,
      y: ry - hAboveRoad,
      baseY: ry - hAboveRoad,
      hAbove: hAboveRoad,
      isGold: Boolean(isGold),
      cd: 0,
      spin: (x * 0.013) % 6.28
    });
  }

  function addBeanArc(beansArr, startX, count, spacing, baseH, arcH, giantEvery = 4) {
    for (let i = 0; i < count; i++) {
      const bx = startX + i * spacing;
      const u = count > 1 ? i / (count - 1) : 0.5;
      const by = getSurfaceY(bx) - baseH - Math.sin(u * Math.PI) * arcH;
      beansArr.push({
        x: bx,
        y: by,
        val: 1,
        giant: giantEvery > 0 && i % giantEvery === Math.floor(giantEvery / 2),
        taken: false
      });
    }
  }

  function populateSegment(seg) {
    if (seg.spawned) return;
    seg.spawned = true;
    const rng = createSeededRng(seg.seed);
    const w = bridge.getWorldArrays();
    const sx = seg.startX;
    const L = seg.lenPx;
    const id = seg.id;
    const jitter = (rng() - 0.5) * 40;

    if (id === 'start_launchpad') {
      // Aerial Turbo Ring right after start so active jumpers burst ahead!
      addBoostRing(sx + 560, 138, false);
      addBeanArc(w.beans, sx + 440, 6, 40, 92, 58, 3);
      addCrate(sx + 1080, 128);
      addCrate(sx + 1165, 178);
      return;
    }

    if (id === 'ikun_trampoline') {
      // 1. 背带裤三连弹簧跳台 + 高空加速环与盲盒
      const step = L / 4;
      for (let k = 0; k < 3; k++) {
        const px = sx + 340 + k * step + jitter * 0.5;
        w.lilyPads.push({ x: px, yOff: 26, anim: 0 });
        if (k === 1) {
          w.pits.push({ x: px + 55, len: 135, bridged: false });
        }
        addBoostRing(px + 145, k === 1 ? 192 : 162, k === 1);
        addBeanArc(w.beans, px + 30, 5, 38, 115, 85, 2);
      }
      w.backboards.push({ x: sx + 340 + step + 210, y: getSurfaceY(sx + 340 + step + 210) - 165, triggered: false });
      addCrate(sx + 340 + 195, 172);
      addCrate(sx + 340 + step * 2 + 195, 182);
      w.enemies.push({ x: sx + step * 1.45, kind: 'dribbler', hit: false, phase: 0.3 });
      w.enemies.push({ x: sx + L - 460, kind: 'pelican_guard', hit: false, phase: 1.2 });
      return;
    }

    if (id === 'canyon_skyrail') {
      // 2. 深渊断桥 + 高空滑轨加速带与空中涡轮环
      const p1x = sx + 430 + jitter;
      const p2x = sx + 1580 - jitter;
      w.pits.push({ x: p1x, len: 155, bridged: false });
      w.lilyPads.push({ x: p1x - 48, yOff: 24, anim: 0 });
      w.rails.push({ x: p1x - 65, len: 470, hOff: 148, kind: 'maglev', energizedTimer: 0 });
      addBoostPad(p1x + 40, 160, 148); // Elevated Skyrail Boost!
      addCrate(p1x + 215, 196);
      addBeanArc(w.beans, p1x - 20, 7, 52, 184, 22, 3);

      addBoostRing(sx + 1090, 154, false);
      w.enemies.push({ x: sx + 1090, kind: 'spiky_cat', hit: false, phase: 0.5 });

      w.pits.push({ x: p2x, len: 160, bridged: false });
      w.rails.push({ x: p2x - 75, len: 490, hOff: 152, kind: 'suspenders', energizedTimer: 0 });
      addBoostRing(p2x + 165, 205, true);
      addCrate(p2x + 250, 198);
      w.enemies.push({ x: sx + 1290, kind: 'drone', flyH: 115, hit: false, phase: 0.7 });
      return;
    }

    if (id === 'truck_gauntlet') {
      // 3. 泥头车对冲走廊 + 飞跃泥头车顶穿环加速
      const t1 = sx + 880 + jitter;
      const t2 = sx + 1980 - jitter;
      w.cashTrucks.push({ x: t1, y: getSurfaceY(t1), hp: 5, dead: false, flash: 0 });
      w.barrels.push({ x: t1 - 130, y: getSurfaceY(t1 - 130) - 24, exploded: false });
      addBoostRing(t1 + 10, 158, true); // Leap OVER the truck through the gold turbo ring!
      addCrate(t1 + 95, 162);

      w.rails.push({ x: sx + 1320, len: 310, hOff: 138, kind: 'maglev', energizedTimer: 0 });
      addBoostPad(sx + 1365, 150, 138); // Elevated rail boost!
      addCrate(sx + 1500, 184);

      w.cashTrucks.push({ x: t2, y: getSurfaceY(t2), hp: 5, dead: false, flash: 0 });
      addBoostRing(t2 + 15, 162, false);
      addCrate(sx + L - 330, 138);
      addBeanArc(w.beans, sx + 520, 8, 44, 112, 65, 3);
      return;
    }

    if (id === 'wave_coaster') {
      // 4. 过山车正弦起伏坡 + 高空加速环链 (地面滚雪球施压!)
      w.iceZones.push({ x: sx + 260, len: 680 });
      w.iceZones.push({ x: sx + 1420, len: 720 });
      addBoostRing(sx + L * 0.24, 148, false);
      addCrate(sx + L * 0.30, 154);
      addBoostRing(sx + L * 0.54, 182, true);
      addCrate(sx + L * 0.60, 178);
      addCrate(sx + L * 0.84, 142);
      w.snowballs.push({ x: sx + 1320, y: getSurfaceY(sx + 1320) - 28, vx: -155, rot: 0, smashed: false });
      w.snowballs.push({ x: sx + 2360, y: getSurfaceY(sx + 2360) - 28, vx: -165, rot: 0, smashed: false });
      addBeanArc(w.beans, sx + 360, 10, 48, 108, 64, 4);
      addBeanArc(w.beans, sx + 1580, 10, 48, 112, 68, 4);
      return;
    }

    if (id === 'split_decker') {
      // 5. 上下双层博弈道：高处加速环+滑轨加速带远多于地面 (地面仅1处且紧挨电网与野猪蛙!)
      w.lilyPads.push({ x: sx + 260, yOff: 26, anim: 0 });
      // Upper continuous elevated skyway (3 high-altitude boosts + 2 crates!)
      w.rails.push({ x: sx + 340, len: 920, hOff: 152, kind: 'suspenders', energizedTimer: 0 });
      w.rails.push({ x: sx + 1340, len: 960, hOff: 156, kind: 'maglev', energizedTimer: 0 });
      addBoostPad(sx + 520, 165, 152);
      addBoostRing(sx + 1300, 202, true);
      addBoostPad(sx + 1680, 165, 156);
      addBeanArc(w.beans, sx + 420, 12, 64, 192, 16, 3);
      addCrate(sx + 980, 196);
      addCrate(sx + 1860, 202);

      // Lower high-risk road: guarded by laser gate, spiky cat & boar frog, only 1 ground boost!
      w.laserGates.push({ x: sx + 780, hacked: false });
      addBoostPad(sx + 940, 130, 0);
      w.enemies.push({ x: sx + 1420, kind: 'spiky_cat', hit: false, phase: 0.4 });
      w.enemies.push({ x: sx + 2180, kind: 'boar_frog', chargePrep: 0.42, hit: false, phase: 1.0 });
      return;
    }

    if (id === 'maodie_ambush') {
      // 6. 圆头耄耋埋伏阵 + 高空穿环越障
      const bellX = sx + 460;
      w.bells.push({ x: bellX, y: getSurfaceY(bellX) - 96, rungTimer: 0 });
      for (let k = 0; k < 3; k++) {
        const ex = sx + 640 + k * 210;
        const kind = k === 1 ? 'shield_lawyer' : 'spiky_cat';
        w.enemies.push({
          x: ex,
          kind,
          shielded: kind === 'shield_lawyer',
          windupTimer: 0.55,
          shotDone: false,
          hit: false,
          phase: k * 0.8
        });
      }
      addBoostRing(sx + 850, 165, false);
      addCrate(sx + 920, 168);
      w.rails.push({ x: sx + 1480, len: 420, hOff: 142, kind: 'suspenders', energizedTimer: 0 });
      addBoostPad(sx + 1580, 155, 142);
      addCrate(sx + 1780, 188);
      w.enemies.push({
        x: sx + 1860,
        kind: 'shield_lawyer',
        shielded: true,
        windupTimer: 0.50,
        shotDone: false,
        hit: false,
        phase: 0.2
      });
      w.enemies.push({ x: sx + 2140, kind: 'spiky_cat', hit: false, phase: 1.5 });
      addBoostRing(sx + L - 480, 152, false);
      return;
    }

    if (id === 'mega_vault') {
      // 7. 超级弹簧飞跃大峡谷 + 双高空金环
      const padX = sx + 880;
      w.lilyPads.push({ x: padX, yOff: 28, anim: 0 });
      w.lilyPads.push({ x: padX + 56, yOff: 42, anim: 0 });
      w.pits.push({ x: padX + 110, len: 245, bridged: false, lava: true });
      w.rails.push({ x: padX + 165, len: 320, hOff: 168, kind: 'maglev', energizedTimer: 0 });
      addBoostRing(padX + 145, 215, true);
      addBeanArc(w.beans, padX + 60, 9, 46, 142, 95, 2);
      addCrate(padX + 260, 216);

      w.laserGates.push({ x: sx + 1880, hacked: false });
      addBoostRing(sx + 1880, 168, false);
      addCrate(sx + 2360, 152);
      return;
    }

    if (id === 'narrow_brawl') {
      // 8. 窄桥互坑段：地面泥潭与深坑，高空加速环奖励操作!
      w.mudZones.push({ x: sx + 320, len: 260, dried: false });
      addBoostRing(sx + 450, 146, false);
      addCrate(sx + 540, 148);
      w.pits.push({ x: sx + 980, len: 135, bridged: false });
      w.lilyPads.push({ x: sx + 935, yOff: 24, anim: 0 });
      addBoostRing(sx + 1050, 178, true);

      w.mudZones.push({ x: sx + 1780, len: 240, dried: false });
      addCrate(sx + 1900, 154);
      w.enemies.push({ x: sx + 2180, kind: 'boar_frog', chargePrep: 0.45, hit: false, phase: 0.5 });
      addBeanArc(w.beans, sx + 1180, 8, 45, 110, 52, 3);
      return;
    }

    if (id === 'turbo_chicane') {
      // 9. 涡轮彩虹弯道：3连高空涡轮加速环 + 仅1条地面险道加速带
      addBoostRing(sx + 420, 146, false);
      addBoostRing(sx + 1280, 186, true);
      w.laserGates.push({ x: sx + 1720, hacked: false });
      addBoostPad(sx + 1860, 135, 0);
      addBoostRing(sx + 2240, 158, false);
      addBeanArc(w.beans, sx + 360, 11, 46, 108, 76, 2);
      addBeanArc(w.beans, sx + 1320, 11, 46, 116, 76, 2);
      addCrate(sx + 920, 152);
      addCrate(sx + 1920, 164);
      w.enemies.push({ x: sx + 1080, kind: 'drone', flyH: 118, hit: false, phase: 0.4 });
      w.enemies.push({ x: sx + 2040, kind: 'spiky_cat', hit: false, phase: 1.6 });
      return;
    }

    // 10. final_sprint: 终点前高空双金环冲刺 + 地面电网拦阻挂机!
    w.laserGates.push({ x: sx + 480, hacked: false });
    addBoostRing(sx + 480, 165, true);
    addCrate(sx + 640, 152);
    addBeanArc(w.beans, sx + 740, 10, 44, 112, 72, 2);
    addBoostRing(sx + 1420, 178, true);
    addCrate(sx + 1660, 158);
    w.laserGates.push({ x: sx + 2020, hacked: false });
    addBoostPad(sx + 2260, 155, 0);
    addBoostRing(sx + 2460, 185, true);
    addBeanArc(w.beans, sx + 2450, 14, 45, 115, 84, 2);
  }

  function spawnTrackAhead(playerX) {
    const horizonX = playerX + 2100;
    for (let i = 0; i < party.segments.length; i++) {
      const seg = party.segments[i];
      if (!seg.spawned && seg.startX <= horizonX) {
        populateSegment(seg);
      }
    }
  }

  // ==================== MEME ITEM BAR & RUBBER-BANDING ====================
  function rollRubberBandedItem() {
    const myDist = (bridge.getRunStats().dist || 0);
    const rivalDist = party.rival ? Number(party.rival.dist || 0) : myDist;
    const delta = myDist - rivalDist; // < 0 means trailing

    const heldSet = new Set(party.slots.filter(Boolean));
    const table = delta < -12
      ? [
          ['truck_isekai', 20],
          ['naiwa_swarm', 19],
          ['dagou_bite', 17],
          ['kun_rocket', 18],
          ['ddj_rush', 16],
          ['pelican_carry', 15],
          ['lightning_whip', 14],
          ['bean_nitro', 13],
          ['timed_shield', 13],
          ['manbo_steal', 10],
          ['bball_rain', 9],
          ['maodie_trap', 8],
          ['pan_shield', 5]
        ]
      : [
          ['naiwa_swarm', 22],
          ['timed_shield', 21],
          ['truck_isekai', 16],
          ['dagou_bite', 15],
          ['maodie_trap', 15],
          ['ddj_rush', 15],
          ['bball_rain', 14],
          ['bean_nitro', 13],
          ['pan_shield', 12],
          ['lightning_whip', 11],
          ['lawyer_seal', 9],
          ['manbo_steal', 9],
          ['kun_rocket', 6],
          ['pelican_carry', 4]
        ];

    let totalW = 0;
    const filtered = table.map(([id, w]) => {
      const effW = heldSet.has(id) ? Math.max(1, Math.floor(w * 0.25)) : w;
      totalW += effW;
      return [id, effW];
    });

    let r = Math.random() * totalW;
    for (const [id, w] of filtered) {
      r -= w;
      if (r <= 0) return id;
    }
    return 'bball_rain';
  }

  function renderItemSlotsUI() {
    for (let idx = 0; idx < 2; idx++) {
      const el = slotEls[idx];
      if (!el.btn) continue;
      const itemId = party.slots[idx];
      const def = itemId ? PARTY_MEME_ITEMS[itemId] : null;
      if (!def) {
        el.btn.classList.add('empty');
        el.btn.classList.remove('armed');
        el.ico.textContent = '🎁';
        if (el.nm) el.nm.textContent = '';
        if (el.tag) el.tag.textContent = '';
      } else {
        el.btn.classList.remove('empty');
        el.btn.classList.add('armed');
        el.ico.textContent = def.ico;
        if (el.nm) el.nm.textContent = def.shortName;
        if (el.tag) el.tag.textContent = '';
      }
    }
  }

  function grantMysteryBoxItem() {
    playSfx('crate');
    const emptyIdx = party.slots[0] === null ? 0 : (party.slots[1] === null ? 1 : -1);
    const p = bridge.player;
    if (emptyIdx === -1) {
      bridge.getRunStats().beans += 8;
      bridge.addPopup('+8🌿', p.x + 20, p.y - 96, '#4ade80', 17);
      return;
    }
    const picked = rollRubberBandedItem();
    party.slots[emptyIdx] = picked;
    renderItemSlotsUI();
    const def = PARTY_MEME_ITEMS[picked];
    bridge.addPopup(`+${def.ico}${def.shortName}`, p.x + 24, p.y - 102, def.color, 19);
  }

  function launchHomingMissileVisual(targetWho, itemId, onImpact = null) {
    const def = PARTY_MEME_ITEMS[itemId] || PARTY_MEME_ITEMS.bball_rain;
    const p = bridge.player;
    const rr = party.rivalRender;
    let sx = p.x + 18;
    let sy = p.y - 58;
    if (targetWho === 'me') {
      const rivalAhead = rr.hasData ? (rr.x >= p.x) : false;
      sx = rr.hasData && Math.abs(rr.x - p.x) < 900 ? rr.x : (p.x + (rivalAhead ? 560 : -440));
      sy = getSurfaceY(sx) - 185;
    }
    party.homingMissiles.push({
      target: targetWho,
      itemId,
      ico: def.ico,
      color: def.color,
      startX: sx,
      startY: sy,
      curX: sx,
      curY: sy,
      prog: 0,
      dur: targetWho === 'me' ? 1.28 : 0.60,
      onImpact
    });
  }

  function showPartyBanner(text, durationMs = 2450) {
    if (!partyAttackBanner) return;
    partyAttackBanner.textContent = text;
    partyAttackBanner.classList.remove('hidden');
    if (bannerHideTimer) clearTimeout(bannerHideTimer);
    bannerHideTimer = setTimeout(() => {
      partyAttackBanner.classList.add('hidden');
    }, durationMs);
  }

  function playItemMemeAudio(itemId) {
    ensureAudio();
    if (itemId === 'naiwa_swarm') {
      playVoiceSlice('nailong', 0.0, 1.65, 0.45, 'party_vo', 550, true);
      playSfx('crate');
    } else if (itemId === 'truck_isekai') {
      playVoiceSlice('jntm', 0.0, 1.8, 0.44, 'party_vo', 550, true);
      playSfx('crater');
    } else if (itemId === 'dagou_bite') {
      playVoiceSlice('ddj', 1.15, 2.55, 0.45, 'party_vo', 550, true);
      playSfx('slash');
    } else if (itemId === 'bball_rain') {
      playVoiceSlice('jntm', 0.0, 2.1, 0.43, 'party_vo', 700, true);
      playSfx('crater');
    } else if (itemId === 'lawyer_seal') {
      playVoiceSlice('ngm', 0, 0, 0.45, 'party_vo', 700, true);
      playSfx('parry');
    } else if (itemId === 'maodie_trap') {
      playVoiceSlice('hakimi', 0.0, 2.3, 0.41, 'party_vo', 700, true);
      playSfx('slash');
    } else if (itemId === 'pelican_carry') {
      playVoiceSlice('ddj', 1.20, 2.85, 0.43, 'party_vo', 700, true);
      playSfx('hyper');
    } else if (itemId === 'manbo_steal') {
      playVoiceSlice('manbo', 0.0, 1.80, 0.45, 'party_vo', 700, true);
      playSfx('chime', 2);
    } else if (itemId === 'lightning_whip') {
      playVoiceSlice('ji', 0, 0, 0.42, 'party_vo', 700, true);
      playSfx('crater');
      playSfx('parry');
    } else if (itemId === 'kun_rocket') {
      playVoiceSlice('nailong', 0.06, 1.38, 0.41, 'party_vo', 700, true);
      playSfx('hyper');
    } else if (itemId === 'ddj_rush') {
      playVoiceSlice('ddj', 0.0, 1.15, 0.44, 'party_vo', 600, true);
      playSfx('hyper');
    } else if (itemId === 'bean_nitro') {
      playVoiceSlice('hakimi', 0.0, 1.75, 0.42, 'party_vo', 600, true);
      playSfx('chime', 2);
    } else if (itemId === 'timed_shield') {
      playVoiceSlice('ji', 0, 0, 0.40, 'party_vo', 600, true);
      playSfx('parry');
    } else if (itemId === 'pan_shield') {
      playSfx('crate');
      playSfx('parry');
    }
  }

  function spawnBasketballRainVisual(targetWho) {
    for (let i = 0; i < 6; i++) {
      party.visualBballs.push({
        target: targetWho,
        offX: (i - 2.5) * 34,
        y: -250 - i * 68,
        vy: 690 + i * 65,
        rot: i * 0.9,
        bounces: 3,
        life: 2.6
      });
    }
  }

  // Thunderous Multi-Body 2.5D Sculpted Chaos Barrages (Frogs, Dump Trucks, Dogs, Cats, Giant Bells!)
  function spawnSculptedChaosBarrage(casterWho, targetWho, itemId) {
    const p = bridge.player;
    const rr = party.rivalRender;
    const sx = casterWho === 'me' ? p.x : (rr.hasData ? rr.x : p.x - 260);
    const sy = casterWho === 'me' ? (p.y - 54) : (rr.hasData ? (rr.y - 54) : (p.y - 54));
    const tx = targetWho === 'me' ? p.x : (rr.hasData ? rr.x : p.x + 260);
    const dir = tx >= sx ? 1 : -1;

    if (itemId === 'naiwa_swarm') {
      // Hurl 7 chubby sculpted Naiwa frogs (including 1 Giant Golden Toilet Frog King!) backward OR forward!
      const sprites = ['naiwa_rig', 'mob_frog', 'mob_boar_frog', 'boss_naiwa', 'naiwa_rig', 'mob_frog', 'naiwa_rig'];
      for (let i = 0; i < 7; i++) {
        party.chaosProjectiles.push({
          kind: 'frog',
          sprite: sprites[i],
          scale: i === 3 ? 0.86 : (0.72 + (i % 2) * 0.14),
          target: targetWho,
          x: sx + dir * (12 + i * 14),
          y: sy - 16 - (i % 3) * 18,
          vx: (casterWho === 'me' ? p.vx : (rr.vx || 350)) * 0.55 + dir * (340 + i * 62),
          vy: -380 - i * 52,
          rot: i * 0.5,
          vRot: dir * (7 + i * 1.6),
          bounces: 4,
          homingPull: 4.5,
          life: 2.35
        });
      }
    } else if (itemId === 'truck_isekai') {
      // Summon a roaring full-size sculpted 2.5D Dump/Armored Truck charging down the asphalt!
      const startTruckX = targetWho === 'me' ? (p.x - 460) : (Math.min(sx - 60, tx - 380));
      party.chaosProjectiles.push({
        kind: 'truck',
        sprite: 'cashTruck',
        scale: 1.42,
        target: targetWho,
        x: startTruckX,
        y: getSurfaceY(startTruckX) - 36,
        vx: 1180,
        vy: 0,
        rot: 0,
        vRot: 0,
        bounces: 0,
        homingPull: 0,
        life: 1.75
      });
    } else if (itemId === 'dagou_bite') {
      // Unleash Giant Chomping Dog (`boss_dagou`) sprinting & leaping across the road!
      party.chaosProjectiles.push({
        kind: 'dog',
        sprite: 'boss_dagou',
        scale: 0.92,
        target: targetWho,
        x: sx + dir * 28,
        y: sy,
        vx: dir * 820,
        vy: -260,
        rot: 0,
        vRot: 0,
        bounces: 4,
        homingPull: 6.8,
        life: 1.95
      });
    } else if (itemId === 'maodie_trap') {
      // Carpet-bomb 5 sculpted Hissing Maodie Cats + TNT Barrels!
      for (let i = 0; i < 5; i++) {
        party.chaosProjectiles.push({
          kind: 'cat',
          sprite: i % 2 === 0 ? 'prop_maodie' : 'mini_maodie',
          scale: 0.88 + (i % 2) * 0.14,
          target: targetWho,
          x: sx + dir * (16 + i * 18),
          y: sy - 14 - i * 14,
          vx: (casterWho === 'me' ? p.vx : 350) * 0.5 + dir * (360 + i * 68),
          vy: -360 - i * 48,
          rot: 0,
          vRot: dir * 9,
          bounces: 3,
          homingPull: 4.8,
          life: 2.1
        });
      }
    } else if (itemId === 'lightning_whip') {
      // Drop a Giant Sculpted Shaolin Bronze Bell (`bronzeBell`) slamming onto target's head!
      party.chaosProjectiles.push({
        kind: 'bell',
        sprite: 'bronzeBell',
        scale: 1.65,
        target: targetWho,
        x: tx,
        y: getSurfaceY(tx) - 340,
        vx: 0,
        vy: 980,
        rot: 0,
        vRot: 0,
        bounces: 1,
        homingPull: 12.0,
        life: 1.45
      });
    }
  }

  function useItemSlot(slotIdx) {
    if (!party.active || bridge.getState() !== 'PLAYING') return false;
    if (party.status !== 'racing' || party.localFinished) return false;
    const itemId = party.slots[slotIdx];
    if (!itemId) return false;

    party.slots[slotIdx] = null;
    party.myItemsUsed += 1;
    renderItemSlotsUI();

    const p = bridge.player;
    const w = bridge.getWorldArrays();
    const def = PARTY_MEME_ITEMS[itemId];
    playItemMemeAudio(itemId);

    const eventId = `ev_${playerId}_${Date.now()}_${party.myItemsUsed}`;
    const evtPayload = { eventId, itemId };

    if (itemId === 'timed_shield') {
      party.fx.oneHitShieldTimer = 7.0;
      party.fx.oneHitShieldMax = 7.0;
      party.fx.mySpeech = '🛡️ 背带金钟罩，黑子别沾边！';
      party.fx.mySpeechTimer = 2.0;
      bridge.addPopup('🛡️ 背带金钟罩!', p.x + 15, p.y - 98, '#38bdf8', 19);
    } else if (itemId === 'ddj_rush') {
      party.fx.ddjRushTimer = 1.45;
      party.fx.bballSlowTimer = 0;
      party.fx.manboSlowTimer = 0;
      p.vx = Math.max(p.vx, p.baseSpeed * 1.88);
      p.vy = Math.min(p.vy, -240);
      p.onGround = false;
      if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.6, true);
      party.fx.mySpeech = '🐔 叮咚鸡血飙车！';
      party.fx.mySpeechTimer = 1.8;
      w.shockwaves.push({ x: p.x, y: p.y - 38, r: 14, maxR: 235, life: 0.30, color: '#facc15', harmless: false });
      bridge.addPopup('🐔 叮咚鸡飙车!', p.x + 18, p.y - 98, '#facc15', 20);
    } else if (itemId === 'bean_nitro') {
      party.fx.beanNitroTimer = 2.7;
      p.vx = Math.max(p.vx, p.baseSpeed * 1.56);
      p.magnetTimer = Math.max(p.magnetTimer || 0, 3.6);
      if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.45, true);
      party.fx.mySpeech = '🧋 南北绿豆吨吨吨！';
      party.fx.mySpeechTimer = 2.0;
      bridge.addPopup('🧋 南北绿豆氮气!', p.x + 18, p.y - 98, '#4ade80', 19);
    } else if (itemId === 'pan_shield') {
      party.fx.panShieldTimer = 4.5;
      party.fx.mySpeech = '🥘 纯路人别扇我！';
      party.fx.mySpeechTimer = 2.0;
      bridge.addPopup('🥘 纯路人铁锅!', p.x + 15, p.y - 98, '#facc15', 19);
    } else if (itemId === 'kun_rocket') {
      party.fx.kunRocketTimer = 3.0;
      party.fx.bballSlowTimer = 0;
      party.fx.manboSlowTimer = 0;
      party.fx.maodieDizzyTimer = 0;
      party.fx.lightningStunTimer = 0;
      party.fx.pelicanClampedTimer = 0;
      p.vx = Math.max(p.vx, p.baseSpeed * 2.22);
      p.invulnTimer = Math.max(p.invulnTimer, 3.2);
      if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.95, true);
      party.fx.mySpeech = '🚀 背带窜天猴升空！';
      party.fx.mySpeechTimer = 2.2;
      w.shockwaves.push({ x: p.x, y: p.y - 36, r: 18, maxR: 320, life: 0.36, color: '#ef4444', harmless: false });
      bridge.addPopup('🚀 背带窜天猴!!', p.x + 18, p.y - 98, '#ef4444', 22);
    } else {
      // ALL 6 Offensive Meme Items fire Long-Range Guaranteed Homing Missiles!
      if (itemId === 'pelican_carry') {
        party.fx.pelicanBoostTimer = 2.6;
        p.vx = Math.max(p.vx, p.baseSpeed * 1.48);
      } else if (itemId === 'manbo_steal') {
        party.fx.manboBoostTimer = 3.2;
        p.vx = Math.max(p.vx, p.baseSpeed * 1.40);
        party.sonicWaves.push({ x: p.x + 20, y: p.y - 48, r: 18, maxR: 380, life: 0.55 });
      } else if (itemId === 'lightning_whip') {
        // Real 5-lash electro-whip forward acceleration surge — ZERO instant teleport!
        party.fx.whipBoostTimer = 1.45;
        party.fx.whipComboTimer = 0.58;
        party.fx.whipComboNextLash = 0;
        p.vx = Math.max(p.vx, p.baseSpeed * 1.72);
        p.invulnTimer = Math.max(p.invulnTimer, 0.9);
        if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.55, true);
        party.whipArcs.push({ owner: 'me', idx: 0, life: 0.24, maxLife: 0.24 });
        w.shockwaves.push({ x: p.x + 36, y: p.y - 40, r: 16, maxR: 220, life: 0.28, color: '#a855f7', harmless: false });
      }
      bridge.addPopup(`🎯 发射 ${def.fullName}!`, p.x + 25, p.y - 102, def.color, 19);
      spawnSculptedChaosBarrage('me', 'rival', itemId);
      launchHomingMissileVisual('rival', itemId, () => {
        const rx = party.rivalRender.hasData ? party.rivalRender.x : p.x + 320;
        const ry = party.rivalRender.hasData ? party.rivalRender.y : p.y;
        w.shockwaves.push({ x: rx, y: ry - 44, r: 16, maxR: 260, life: 0.34, color: def.color, harmless: true });
        if (itemId === 'bball_rain') {
          party.rivalRender.bballTimer = 2.4;
          spawnBasketballRainVisual('rival');
        } else if (itemId === 'lightning_whip') {
          party.lightningBolts.push({ target: 'rival', life: 0.72 });
          spawnSculptedChaosBarrage('me', 'rival', 'lightning_whip');
          for (let k = 0; k < 3; k++) {
            party.whipArcs.push({ owner: 'rival', idx: k, life: 0.34, maxLife: 0.34 });
          }
        }
      });
    }

    party.outgoingEvents.push(evtPayload);
    bridge.refreshBuffChips();
    triggerPartySyncNow();
    return true;
  }

  function tryMeleeShoulderBump() {
    if (!party.active || party.status !== 'racing' || party.localFinished) return false;
    if (party.meleeBumpCd > 0 || !party.rival || !party.rivalRender.hasData) return false;
    const p = bridge.player;
    const rr = party.rivalRender;
    if (Math.abs(rr.x - p.x) > 86 || Math.abs(rr.y - p.y) > 74) return false;

    party.meleeBumpCd = 1.6;
    party.myItemsUsed += 1;
    p.vx = Math.max(p.vx, p.baseSpeed * 1.42);
    playSfx('crater');
    playSfx('parry');
    if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.55, true);
    bridge.getWorldArrays().shockwaves.push({
      x: (p.x + rr.x) * 0.5, y: p.y - 44, r: 14, maxR: 210, life: 0.28, color: '#fb923c', harmless: false
    });
    bridge.addPopup('💥 贴脸铁山靠!!', p.x + 22, p.y - 108, '#fde047', 21);
    party.hitMarkers.push({ target: 'rival', text: '💥 撞飞!', color: '#fde047', life: 0.85 });
    party.outgoingEvents.push({
      eventId: `bump_${playerId}_${Date.now()}`,
      itemId: 'melee_bump'
    });
    triggerPartySyncNow();
    return true;
  }

  function tryConsumeOneHitShield(isPitFall = false) {
    if (!party.active || party.fx.oneHitShieldTimer <= 0) return false;
    party.fx.oneHitShieldTimer = 0;
    party.fx.roadPadBoostTimer = Math.max(party.fx.roadPadBoostTimer, 1.25);
    const p = bridge.player;
    const w = bridge.getWorldArrays();
    p.vx = Math.max(p.vx, p.baseSpeed * 1.48);
    p.invulnTimer = Math.max(p.invulnTimer, 0.95);
    if (isPitFall) {
      // Smooth continuous upward vault — ZERO vertical position snap!
      p.vy = -690;
      p.onGround = false;
      p.jumpsLeft = bridge.getMaxJumps();
    }
    playSfx('parry');
    if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.55, true);
    w.shockwaves.push({ x: p.x, y: p.y - 46, r: 18, maxR: 295, life: 0.38, color: '#38bdf8', harmless: false });
    bridge.addPopup('🛡️ 黑子不破防!', p.x + 18, p.y - 104, '#38bdf8', 21);
    bridge.refreshBuffChips();
    triggerPartySyncNow();
    return true;
  }

  const PARTY_ITEM_DMG_MAP = {
    truck_isekai: 50,
    lightning_whip: 45,
    naiwa_swarm: 42,
    dagou_bite: 38,
    bball_rain: 36,
    maodie_trap: 34,
    pelican_carry: 32,
    manbo_steal: 30,
    lawyer_seal: 30,
    melee_bump: 28
  };

  // Hero Skills & Projectiles Hitting Rival (`人物技能打对方`!)
  function tryHitRivalWithHeroSkill(wx, wy, rad, dmg = 32, skillLabel = '✨ 技能') {
    if (!party.active || party.status !== 'racing' || party.localFinished) return false;
    if (party.heroSkillHitCd > 0 || !party.rival || !party.rivalRender.hasData) return false;
    const rr = party.rivalRender;
    if (Math.hypot(rr.x - wx, (rr.y - 46) - wy) > rad) return false;

    party.heroSkillHitCd = 0.38;
    party.myItemsUsed += 1;
    playSfx('parry');
    playSfx('crater');
    if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.45, true);
    bridge.getWorldArrays().shockwaves.push({
      x: rr.x, y: rr.y - 46, r: 16, maxR: 230, life: 0.30, color: '#ef4444', harmless: true
    });
    party.hitMarkers.push({ target: 'rival', text: `${skillLabel} -${dmg}HP!`, color: '#fb7185', life: 0.95 });
    party.outgoingEvents.push({
      eventId: `sk_${playerId}_${Date.now()}_${party.myItemsUsed}`,
      itemId: 'hero_skill_hit',
      dmg
    });
    triggerPartySyncNow();
    return true;
  }

  // Lethal KO Crawl (`打死了速度降到最慢` + `死了速度回到最初 1.0x`, ZERO teleport!)
  function triggerPartyPlayerKO(isPitFall = false) {
    if (!party.active) return false;
    const p = bridge.player;
    const w = bridge.getWorldArrays();

    party.aliveStreakSec = 0; // Reset 20s 1.0x -> 2.0x survival speed ramp to initial 1.0x!
    party.fx.koCrawlTimer = 2.4;
    party.staminaBoosting = false;

    playSfx('crater');
    playSfx('hurt');
    playVoiceSlice('ji', 0, 0, 0.42, 'party_ko', 900, false);
    if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(1.35, false);

    if (isPitFall) {
      // Smooth continuous hop out onto pit lip — NEVER instant x-teleport!
      p.vy = -720;
      p.onGround = false;
      p.jumpsLeft = bridge.getMaxJumps();
    } else {
      p.vy = -260;
      p.onGround = false;
    }
    p.vx = 55;
    p.hp = p.maxHp;
    p.regenPool = 0;
    p.dotPool = 0;
    p.displayHp = p.maxHp;
    p.trailHp = p.maxHp;
    p.invulnTimer = 2.5;

    w.shockwaves.push({ x: p.x, y: p.y - 42, r: 18, maxR: 310, life: 0.42, color: '#ef4444', harmless: true });
    bridge.addPopup('💀 被打爆！加速归零·龟速爬行!', p.x + 16, p.y - 114, '#ef4444', 21);
    bridge.refreshBuffChips();
    return true;
  }

  function applyDirectHitEffectOnMe(itemId, reflected = false, serverDmg = 0, forceKo = false) {
    const p = bridge.player;
    const w = bridge.getWorldArrays();
    if (!reflected && party.fx.panShieldTimer > 0) {
      party.fx.panShieldTimer = 0;
      playSfx('parry');
      if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.65, true);
      w.shockwaves.push({ x: p.x, y: p.y - 46, r: 18, maxR: 320, life: 0.4, color: '#facc15', harmless: false });
      bridge.addPopup('🥘 纯路人反弹!!', p.x + 18, p.y - 104, '#facc15', 22);
      spawnSculptedChaosBarrage('me', 'rival', itemId);
      launchHomingMissileVisual('rival', itemId);
      bridge.refreshBuffChips();
      return;
    }
    if (party.fx.oneHitShieldTimer > 0) {
      tryConsumeOneHitShield(false);
      return;
    }

    playItemMemeAudio(itemId);
    playSfx('hurt');
    const def = PARTY_MEME_ITEMS[itemId] || PARTY_MEME_ITEMS.bball_rain;
    w.shockwaves.push({ x: p.x, y: p.y - 44, r: 18, maxR: 295, life: 0.38, color: def.color, harmless: true });
    const rocketImmune = party.fx.kunRocketTimer > 0;

    // Differentiated 30~50 HP Item Damage!
    const rawItemDmg = serverDmg > 0 ? serverDmg : (PARTY_ITEM_DMG_MAP[itemId] || 34);
    if (!rocketImmune) {
      const scaledDmg = Math.round((rawItemDmg / 100) * p.maxHp);
      p.hp = Math.max(0, p.hp - scaledDmg);
      bridge.addPopup(`💔 -${rawItemDmg} HP`, p.x - 18, p.y - 132, '#fb7185', 20);
      if (bridge.triggerPartyHitImpact) {
        bridge.triggerPartyHitImpact(itemId === 'truck_isekai' ? 1.45 : 1.15, false);
      }
    }

    // 7 Wildly Exaggerated, Non-Cookie-Cutter Cartoon Physics Reactions!
    if (itemId === 'naiwa_swarm') {
      if (!rocketImmune) {
        party.fx.naiwaPileTimer = 2.8;
        p.vx = Math.min(p.vx, 85);
        p.vy = 420; // Heavy frog stack slams bike suspension down!
      }
      bridge.addPopup('🐸 奶蛙叠罗汉压塌车架!!', p.x + 12, p.y - 108, '#84cc16', 21);
    } else if (itemId === 'truck_isekai') {
      if (!rocketImmune) {
        party.fx.truckRammedTimer = 1.45;
        party.fx.dizzySpinTimer = 1.45;
        p.vx = 48;
        p.vy = -680; // Launched sky-high doing 1080° ragdoll somersaults!
        p.onGround = false;
      }
      bridge.addPopup('🚛 被大运泥头车创飞上天!!', p.x + 12, p.y - 112, '#ef4444', 22);
    } else if (itemId === 'dagou_bite') {
      if (!rocketImmune) {
        party.fx.dagouBiteTimer = 2.4;
        party.dogYankTick = 0.05;
        p.vx = -95; // Violent backward yank!
      }
      bridge.addPopup('🐕 恶犬咬胎疯狂往后拽!!', p.x + 12, p.y - 108, '#d97706', 21);
    } else if (itemId === 'melee_bump') {
      if (!rocketImmune) {
        party.fx.bballSlowTimer = Math.max(party.fx.bballSlowTimer, 1.1);
        p.vx = Math.min(p.vx, 95);
        p.vy = -360;
        p.onGround = false;
      }
      bridge.addPopup('🐔 被贴脸铁山靠撞飞!!', p.x + 12, p.y - 104, '#fb923c', 20);
    } else if (itemId === 'bball_rain') {
      spawnBasketballRainVisual('me');
      if (!rocketImmune) {
        party.fx.bballSlowTimer = 2.6;
        party.dribbleSlamTick = 0.05;
        p.vx = Math.min(p.vx, 90);
        p.vy = -420;
        p.onGround = false;
      }
      bridge.addPopup('🏀 被当成篮球疯狂拍地!!', p.x + 12, p.y - 108, '#f97316', 21);
    } else if (itemId === 'lawyer_seal') {
      party.fx.lawyerBlindTimer = 2.7;
      if (!rocketImmune) p.vx = Math.min(p.vx, 130);
      if (partyLawyerOverlay) partyLawyerOverlay.classList.remove('hidden');
      bridge.addPopup('📜 律师函糊脸摇晃!!', p.x + 12, p.y - 104, '#eab308', 20);
    } else if (itemId === 'maodie_trap') {
      if (!rocketImmune) {
        party.fx.maodieDizzyTimer = 2.3;
        party.fx.dizzySpinTimer = 1.6;
        p.vx = Math.min(p.vx, 75);
        p.vy = -470;
        p.onGround = false;
      }
      bridge.addPopup('😾 耄耋龙卷风抓花脸!!', p.x + 12, p.y - 108, '#fb923c', 21);
    } else if (itemId === 'pelican_carry') {
      if (!rocketImmune) {
        party.fx.pelicanClampedTimer = 1.65;
        p.vx = Math.min(p.vx, 60);
        p.onGround = false;
      }
      bridge.addPopup('🦢 被鹈鹕倒挂半空叼走!!', p.x + 12, p.y - 108, '#38bdf8', 21);
    } else if (itemId === 'manbo_steal') {
      if (!rocketImmune) {
        party.fx.manboSlowTimer = 3.0;
        p.vx = Math.min(p.vx, 115);
      }
      party.sonicWaves.push({ x: p.x, y: p.y - 48, r: 240, maxR: 18, life: 0.65 });
      bridge.addPopup('🐴 曼波抽干你的车速!!', p.x + 12, p.y - 104, '#ec4899', 20);
    } else if (itemId === 'lightning_whip') {
      party.lightningBolts.push({ target: 'me', life: 0.95 });
      for (let k = 0; k < 3; k++) {
        party.whipArcs.push({ owner: 'me', idx: k, life: 0.38, maxLife: 0.38 });
      }
      if (!rocketImmune) {
        party.fx.lightningStunTimer = 1.35;
        party.fx.bellCrushTimer = 1.55;
        p.vx = Math.min(p.vx, 45);
        p.vy = 600; // Slammed flat onto the road like a pancake!
      }
      bridge.addPopup('🔔 少林巨钟把你压成铁饼!!', p.x + 12, p.y - 110, '#fde047', 22);
    }

    if (!rocketImmune && (forceKo || p.hp <= 0)) {
      triggerPartyPlayerKO(false);
    }
    bridge.refreshBuffChips();
  }

  function applyIncomingPartyEvent(ev) {
    if (!ev || !ev.eventId || party.seenEventIds.has(ev.eventId)) return;
    party.seenEventIds.add(ev.eventId);

    // 1. Attacker Dopamine Hit Confirmation (`打到别人要有明显反馈`!)
    if (ev.type === 'attack_hit_confirm') {
      const def = PARTY_MEME_ITEMS[ev.itemId] || PARTY_MEME_ITEMS.bball_rain;
      const hits = Number(ev.comboHits || party.myItemsLanded || 1);
      const dmg = Number(ev.dmg || PARTY_ITEM_DMG_MAP[ev.itemId] || 35);
      const isKo = Boolean(ev.lethalKo);
      setTimeout(() => {
        if (!party.active) return;
        playSfx('crate');
        playSfx('parry');
        playVoiceSlice('ji', 0, 0, 0.38, 'party_hit_ack', 450, false);
        if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(isKo ? 0.75 : 0.45, true);
        const p = bridge.player;
        bridge.addPopup(
          isKo ? `💀 击毙对手!! ${def.ico} 敌方速度归零!` : `🎯 暴击对手 -${dmg}HP! (${def.ico}x${hits})`,
          p.x + 28,
          p.y - 124,
          isKo ? '#fde047' : '#4ade80',
          isKo ? 22 : 20
        );
        party.hitMarkers.push({
          target: 'rival',
          text: isKo ? `💀 击倒龟速!` : `💥 -${dmg} HP!`,
          color: isKo ? '#ef4444' : '#fde047',
          life: 1.15
        });
        party.rivalEdgeHitFlash = 1.5;
        party.rivalEdgeHitTxt = isKo ? `💀 被你打爆龟速!` : `💥 -${dmg}HP!`;
      }, ev.itemId === 'melee_bump' ? 30 : 520);
      return;
    }

    if (ev.type === 'hero_skill_ack') {
      playSfx('crate');
      party.rivalEdgeHitFlash = 1.1;
      party.rivalEdgeHitTxt = `🔥 技能 -${ev.dmg || 30}HP!`;
      return;
    }

    if (ev.type === 'hero_ko_killer') {
      playSfx('crate');
      playSfx('parry');
      if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.7, true);
      showPartyBanner(`💀 大招击毙 ${ev.targetNick || '对手'}！对方加速清零进入龟速爬行！`, 2100);
      party.hitMarkers.push({ target: 'rival', text: '💀 技能击杀!', color: '#fde047', life: 1.25 });
      party.rivalEdgeHitFlash = 1.8;
      party.rivalEdgeHitTxt = '💀 被你击杀龟速!';
      return;
    }

    if (ev.type === 'hero_skill_hurt') {
      const p = bridge.player;
      if (party.fx.oneHitShieldTimer > 0) {
        tryConsumeOneHitShield(false);
        return;
      }
      const dmg = Number(ev.dmg || 30);
      p.hp = Math.max(1, p.hp - Math.round((dmg / 100) * p.maxHp));
      p.vx = Math.min(p.vx, p.vx * 0.72);
      playSfx('hurt');
      if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.85, false);
      bridge.addPopup(`🔥 遭技能轰击 -${dmg}HP!`, p.x + 12, p.y - 110, '#fb7185', 20);
      return;
    }

    if (ev.type === 'hero_ko_victim') {
      if (party.fx.oneHitShieldTimer > 0) {
        tryConsumeOneHitShield(false);
        return;
      }
      showPartyBanner(`💀 被 ${ev.fromNick || '对手'} 技能打爆！速度降到最慢并重置加速！`, 2100);
      triggerPartyPlayerKO(false);
      return;
    }

    if (ev.type === 'attack_blocked_ack') {
      setTimeout(() => {
        if (!party.active) return;
        playSfx('parry');
        const p = bridge.player;
        bridge.addPopup('🛡️ 被对手金钟罩挡下!', p.x + 24, p.y - 116, '#94a3b8', 18);
        party.hitMarkers.push({ target: 'rival', text: '🛡️ 格挡!', color: '#38bdf8', life: 0.9 });
      }, 520);
      return;
    }

    if (ev.type === 'rival_boost_notice') {
      showPartyBanner(`🚨 警惕！${ev.fromNick || '对手'} 点燃了 🚀 背带窜天猴！`, 1850);
      playSfx('chime', 2);
      return;
    }

    if (ev.type === 'rival_forfeit_win') {
      const reasonTxt = ev.reason === 'disconnect' ? '掉线超时' : '中途退赛';
      showPartyBanner(`🏳️ 对手 ${ev.fromNick || '劲敌'} ${reasonTxt} · 本局直接判你获胜！`, 3200);
      playSfx('crate');
      playSfx('chime', 3);
      return;
    }

    if (ev.type === 'rival_quit_takeover') {
      showPartyBanner(`🏳️ ${ev.fromNick || '对手'} 破防逃跑！AI代驾无缝接管完赛！`, 2600);
      playSfx('crate');
      return;
    }

    if (ev.type === 'shield_reflect_win') {
      party.fx.panShieldTimer = 0;
      playVoiceSlice('ngm', 0, 0, 0.46, 'party_vo', 500, true);
      playSfx('parry');
      if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.6, true);
      const p = bridge.player;
      bridge.getWorldArrays().shockwaves.push({
        x: p.x, y: p.y - 46, r: 18, maxR: 310, life: 0.4, color: '#facc15', harmless: false
      });
      bridge.addPopup('🥘 纯路人反弹!!', p.x + 18, p.y - 104, '#facc15', 21);
      spawnSculptedChaosBarrage('me', 'rival', ev.itemId || 'bball_rain');
      launchHomingMissileVisual('rival', ev.itemId || 'bball_rain');
      bridge.refreshBuffChips();
      return;
    }

    if (ev.type === 'one_hit_shield_block') {
      const itemId = ev.itemId || 'bball_rain';
      const def = PARTY_MEME_ITEMS[itemId] || PARTY_MEME_ITEMS.bball_rain;
      // Immediate 1.28s Advance Warning BEFORE impact!
      showPartyBanner(`⚠️ 来袭预警：对手释放 ${def.fullName}！`, 1450);
      playSfx('chime', 3);
      spawnSculptedChaosBarrage('rival', 'me', itemId);
      launchHomingMissileVisual('me', itemId, () => {
        if (party.fx.oneHitShieldTimer > 0) {
          tryConsumeOneHitShield(false);
        } else {
          party.fx.roadPadBoostTimer = Math.max(party.fx.roadPadBoostTimer, 1.25);
          const p = bridge.player;
          playSfx('parry');
          if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.55, true);
          bridge.getWorldArrays().shockwaves.push({
            x: p.x, y: p.y - 46, r: 18, maxR: 285, life: 0.36, color: '#38bdf8', harmless: false
          });
          bridge.addPopup('🛡️ 黑子不破防!', p.x + 18, p.y - 104, '#38bdf8', 21);
          bridge.refreshBuffChips();
        }
      });
      return;
    }

    if (ev.type === 'trap_landed_ack') {
      playSfx('crate');
      return;
    }

    if (ev.type !== 'attack') return;

    const itemId = ev.itemId;
    const reflected = Boolean(ev.reflected);
    const srvDmg = Number(ev.dmg || 0);
    const srvKo = Boolean(ev.lethalKo);
    if (itemId === 'melee_bump') {
      applyDirectHitEffectOnMe('melee_bump', false, srvDmg, srvKo);
      return;
    }

    // Immediate 1.28s Advance Warning so player can reactively pop 金钟罩 or 纯路人铁锅!
    const def = PARTY_MEME_ITEMS[itemId] || PARTY_MEME_ITEMS.bball_rain;
    showPartyBanner(
      reflected ? `⚠️ 反弹预警：你的 ${def.fullName} 被弹回来了！` : `⚠️ 来袭预警：对手释放 ${def.fullName}！`,
      1450
    );
    playSfx('chime', 3);
    spawnSculptedChaosBarrage('rival', 'me', itemId);
    launchHomingMissileVisual('me', itemId, () => {
      applyDirectHitEffectOnMe(itemId, reflected, srvDmg, srvKo);
    });
  }

  // ==================== PELICAN RESCUE AIRDROP (1.3s NON-LETHAL RESPAWN) ====================
  function triggerPelicanRescue(isPitFall = false) {
    if (!party.active) return false;
    const p = bridge.player;
    if (party.fx.respawnTimer > 0) return true;

    playSfx('hurt');
    playVoiceSlice('ji', 0, 0, 0.36, 'party_rescue', 1400, false);

    // Find safe non-pit landing spot slightly ahead (capped before finish line)
    let safeX = Math.min(party.finishX - 36, Math.max(160, p.x + (isPitFall ? 145 : 75)));
    const w = bridge.getWorldArrays();
    for (let i = 0; i < w.pits.length; i++) {
      const pit = w.pits[i];
      if (!pit.bridged && safeX >= pit.x - 24 && safeX <= pit.x + pit.len + 36) {
        safeX = Math.min(party.finishX - 30, pit.x + pit.len + 54);
      }
    }

    party.fx.respawnTimer = 1.3;
    party.fx.respawnStartX = p.x;
    party.fx.respawnStartY = p.y;
    party.fx.respawnTargetX = safeX;
    party.fx.lightningStunTimer = 0;
    party.fx.pelicanClampedTimer = 0;
    party.fx.mySpeech = '';
    party.fx.mySpeechTimer = 0;

    p.hp = p.maxHp;
    p.regenPool = 0;
    p.dotPool = 0;
    p.displayHp = p.maxHp;
    p.trailHp = p.maxHp;
    p.vy = 0;
    p.onGround = false;
    p.onRail = null;
    p.invulnTimer = 2.2;
    p.jumpsLeft = bridge.getMaxJumps();
    return true;
  }

  // ==================== NETWORK LOBBY & 80ms LIVE SYNC ====================
  function getDesiredNickname() {
    const authUser = bridge.store.auth && bridge.store.auth.username;
    const inpVal = partyNickInp ? String(partyNickInp.value || '').trim() : '';
    const nick = inpVal || authUser || '背带乐子人';
    try { localStorage.setItem(PARTY_NICK_KEY, nick); } catch (_) {}
    return nick.slice(0, 14);
  }

  function updateServerClockOffset(serverNowMs) {
    if (!Number.isFinite(serverNowMs)) return;
    const sample = serverNowMs - Date.now();
    if (party.serverOffsetMs === 0) party.serverOffsetMs = sample;
    else party.serverOffsetMs = party.serverOffsetMs * 0.7 + sample * 0.3;
  }

  function estServerNow() {
    return Date.now() + party.serverOffsetMs;
  }

  function clearPartyTimers() {
    if (waitPollTimer) { clearInterval(waitPollTimer); waitPollTimer = null; }
    if (raceSyncTimer) { clearInterval(raceSyncTimer); raceSyncTimer = null; }
  }

  function setHudPartyVisibility(isParty) {
    if (singleHudRow) singleHudRow.classList.toggle('hidden', isParty);
    if (feverRow) feverRow.classList.toggle('hidden', isParty);
    if (hudHealBtn) hudHealBtn.classList.toggle('hidden', isParty);
    if (hyperDashBtn) hyperDashBtn.classList.toggle('hidden', isParty);
    if (partyStaminaBtn) partyStaminaBtn.classList.toggle('hidden', !isParty);
    if (pauseBtn) pauseBtn.textContent = isParty ? '🏳️ 退出' : '⏸️ 暂停';
    const buffStripEl = document.getElementById('buffStrip');
    if (buffStripEl) buffStripEl.classList.toggle('party-left', isParty);
    if (partyProgressHud) partyProgressHud.classList.toggle('hidden', !isParty);
    if (partyItemBar) partyItemBar.classList.toggle('hidden', !isParty);
    if (!isParty) {
      party.staminaHeld = false;
      party.staminaBoosting = false;
      if (partyCountdownOverlay) partyCountdownOverlay.classList.add('hidden');
      if (partyAttackBanner) partyAttackBanner.classList.add('hidden');
      if (partyLawyerOverlay) partyLawyerOverlay.classList.add('hidden');
    }
  }

  function renderLobbyPlanPreview(modulePlan) {
    if (!partyPlanStrip) return;
    partyPlanStrip.innerHTML = '';
    const plan = modulePlan || [];
    for (let i = 0; i < plan.length; i++) {
      const meta = PARTY_MODULE_META[plan[i]] || { short: plan[i] };
      const span = document.createElement('span');
      span.className = 'ppp-chip';
      span.textContent = `${i + 1}.${meta.short}`;
      partyPlanStrip.appendChild(span);
    }
  }

  function applyLobbySnapshot(data) {
    if (!data || !data.ok) return;
    updateServerClockOffset(Number(data.serverNowMs));
    party.roomCode = data.roomCode;
    party.status = data.status;
    party.raceDist = Number(data.raceDist) || 2000;
    party.trackSeed = Number(data.trackSeed) || 123456;
    party.modulePlan = Array.isArray(data.modulePlan) ? data.modulePlan : [];
    party.startAtMs = Number(data.startAtMs) || 0;
    party.rival = data.rival || null;

    if (partyWaitCodeTxt) partyWaitCodeTxt.textContent = party.roomCode;
    if (data.you) {
      if (partyWaitMeIco) partyWaitMeIco.textContent = getHeroIcon(data.you.heroId);
      if (partyWaitMeNm) partyWaitMeNm.textContent = `${data.you.nickname} (你)`;
    }
    if (data.rival) {
      if (partyWaitRivalCard) partyWaitRivalCard.classList.add('ready');
      if (partyWaitRivalIco) partyWaitRivalIco.textContent = getHeroIcon(data.rival.heroId);
      if (partyWaitRivalNm) partyWaitRivalNm.textContent = data.rival.nickname;
      if (partyWaitRivalSt) partyWaitRivalSt.textContent = '🔥 劲敌就位 · 即将发车！';
      if (partyWaitAddBotBtn) partyWaitAddBotBtn.classList.add('hidden-block');
      if (partyWaitStatusMsg) partyWaitStatusMsg.textContent = '🚦 双人已集结！正在进入同道竞速赛场...';
    } else {
      if (partyWaitRivalCard) partyWaitRivalCard.classList.remove('ready');
      if (partyWaitRivalIco) partyWaitRivalIco.textContent = '⏳';
      if (partyWaitRivalNm) partyWaitRivalNm.textContent = '等待劲敌...';
      if (partyWaitRivalSt) partyWaitRivalSt.textContent = '分享4位房号或秒加AI';
      if (partyWaitAddBotBtn) partyWaitAddBotBtn.classList.remove('hidden-block');
      if (partyWaitStatusMsg) {
        partyWaitStatusMsg.textContent = data.isQuickmatch
          ? '⚡ 正在全服匹配真人骑手... 也可点击下方按钮秒加抽象AI劲敌立即开跑！'
          : '⏳ 等待好友输入 4 位房间号加入，或点击下方添加抽象AI劲敌立即开跑！';
      }
    }
    renderLobbyPlanPreview(party.modulePlan);

    if (data.status === 'countdown' || data.status === 'racing') {
      launchPartyRaceSession(data);
    }
  }

  function launchPartyRaceSession(data) {
    clearPartyTimers();
    if (partyLobbyOverlay) partyLobbyOverlay.classList.add('hidden');
    if (partyPodiumOverlay) partyPodiumOverlay.classList.add('hidden');

    party.active = true;
    party.status = data.status === 'racing' ? 'racing' : 'countdown';
    party.raceDist = Number(data.raceDist) || 3500;
    party.trackSeed = Number(data.trackSeed) || 123456;
    party.modulePlan = Array.isArray(data.modulePlan) ? data.modulePlan : [];
    party.startAtMs = Number(data.startAtMs) || (estServerNow() + 3000);
    party.lastCountdownBeep = 99;
    party.goFlashTimer = 0;

    party.slots = [null, null];
    party.outgoingEvents = [];
    party.pendingTrapHitId = '';
    party.seenEventIds.clear();
    party.triggeredTrapIds.clear();
    party.crates = [];
    party.skyDrops = [];
    party.nextSkyDropDist = 52;
    party.skyDropCount = 0;
    party.boostPads = [];
    party.boostRings = [];
    party.serverTraps = Array.isArray(data.trackTraps) ? data.trackTraps : [];
    party.homingMissiles = [];
    party.bossTriggerDists = [
      Math.round(party.raceDist * 0.28),
      Math.round(party.raceDist * 0.56),
      Math.round(party.raceDist * 0.82)
    ];
    party.bossTriggeredIdx = -1;
    party.visualBballs = [];
    party.chaosProjectiles = [];
    party.sonicWaves = [];
    party.lightningBolts = [];
    party.whipArcs = [];
    party.hitMarkers = [];
    party.confetti = [];

    const initRoadY = getSurfaceY(120) - 32;
    party.ropeNodes = Array.from({ length: 14 }, (_, idx) => {
      const rx = 120 - (idx / 13) * 52;
      const ry = getSurfaceY(rx) - 31 + Math.sin((idx / 13) * Math.PI) * 18;
      return { x: rx, y: ry, px: rx, py: ry };
    });
    party.ropeTensionRatio = 0;
    party.ropePullVx = 0;
    party.ropePullDir = 0;
    party.ropeSparkCd = 0;
    party.rivalTrailHp = 100;
    party.rivalHitFlash = 0;
    party.sync404Count = 0;

    party.stamina = 65;
    party.staminaTrail = 65;
    party.staminaShowAlpha = 1.0;
    party.staminaHeld = false;
    party.staminaBoosting = false;
    party.staminaExhaustCd = 0;
    party.staminaRegenDelay = 0;
    party.staminaSparkTick = 0;
    party.sprintGhosts = [];
    party.lastBeanCount = 0;
    party.aliveStreakSec = 0;
    party.heroSkillHitCd = 0;
    party.dogYankTick = 0;
    party.dribbleSlamTick = 0;
    party.rematchVotes = [];
    party.roomPlayerCount = 2;
    party.wasAheadOfRival = null;
    party.overtakeCd = 0;
    party.meleeBumpCd = 0;
    party.rivalEdgeHitFlash = 0;
    party.rivalEdgeHitTxt = '';

    Object.assign(party.fx, {
      koCrawlTimer: 0,
      oneHitShieldTimer: 0,
      oneHitShieldMax: 7.0,
      panShieldTimer: 0,
      kunRocketTimer: 0,
      ddjRushTimer: 0,
      beanNitroTimer: 0,
      spicyDashTimer: 0,
      whipBoostTimer: 0,
      whipComboTimer: 0,
      whipComboNextLash: 0,
      pelicanBoostTimer: 0,
      pelicanClampedTimer: 0,
      naiwaPileTimer: 0,
      truckRammedTimer: 0,
      dagouBiteTimer: 0,
      bellCrushTimer: 0,
      manboBoostTimer: 0,
      manboSlowTimer: 0,
      bballSlowTimer: 0,
      lawyerBlindTimer: 0,
      maodieDizzyTimer: 0,
      dizzySpinTimer: 0,
      lightningStunTimer: 0,
      roadPadBoostTimer: 0,
      respawnTimer: 0,
      respawnStartX: 120,
      respawnStartY: initRoadY,
      respawnTargetX: 120,
      mySpeech: '',
      mySpeechTimer: 0
    });

    party.localFinished = false;
    party.finishedClientMs = 0;
    party.myItemsLanded = 0;
    party.myItemsUsed = 0;
    party.results = [];
    party.rewardClaimed = false;

    party.rival = data.rival || null;
    const initRivalX = 72; // Staggered starting grid so both bikes + slack rope are clearly visible on countdown!
    party.rivalRender = {
      hasData: Boolean(data.rival),
      x: data.status === 'racing' && data.rival ? Number(data.rival.x || 120) : initRivalX,
      y: getSurfaceY(initRivalX),
      vx: 0,
      vy: 0,
      angle: 0,
      wheelAngle: 0,
      crankAngle: 0,
      jiggle: 0,
      bballTimer: 0
    };

    buildTrackSegments(party.modulePlan, party.raceDist, party.trackSeed);
    const heroId = bridge.store.save.selectedHero || 'nailong';
    bridge.startPartyRunSetup(heroId);
    spawnTrackAhead(120);

    setHudPartyVisibility(true);
    renderItemSlotsUI();
    if (partyFinishLbl) partyFinishLbl.textContent = `🏁${party.raceDist}m`;
    if (partyMePinIco) partyMePinIco.textContent = getHeroIcon(heroId);
    if (party.rival) {
      if (partyRivalPinIco) partyRivalPinIco.textContent = getHeroIcon(party.rival.heroId);
      if (partyRivalPinLbl) partyRivalPinLbl.textContent = party.rival.nickname.slice(0, 5);
    }

    raceSyncTimer = setInterval(triggerPartySyncNow, 80);
    triggerPartySyncNow();
  }

  async function triggerPartySyncNow() {
    if (!party.active || !party.roomCode || syncInFlight) return;
    syncInFlight = true;

    const p = bridge.player;
    const rs = bridge.getRunStats();
    const sentEvents = party.outgoingEvents.splice(0, 4);
    const sentTrapHit = party.pendingTrapHitId;
    party.pendingTrapHitId = '';

    const payload = {
      roomCode: party.roomCode,
      playerId,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      vx: Math.round(p.vx * 10) / 10,
      vy: Math.round(p.vy * 10) / 10,
      dist: Math.min(party.raceDist, Math.max(0, Math.round(((p.x - 120) / 18) * 10) / 10)),
      heroId: bridge.store.save.selectedHero || 'nailong',
      hp: Math.max(0, Math.min(100, Math.round((p.hp / Math.max(1, p.maxHp || 100)) * 100))),
      animState: {
        onGround: Boolean(p.onGround || p.onRail),
        striking: p.strikeTimer > 0,
        shieldActive: party.fx.panShieldTimer > 0,
        oneHitShield: party.fx.oneHitShieldTimer > 0,
        rocketActive: party.fx.kunRocketTimer > 0,
        staminaBoost: Boolean(party.staminaBoosting),
        koCrawl: party.fx.koCrawlTimer > 0,
        toonBell: party.fx.bellCrushTimer > 0,
        toonTruck: party.fx.truckRammedTimer > 0,
        toonNaiwa: party.fx.naiwaPileTimer > 0,
        toonDagou: party.fx.dagouBiteTimer > 0,
        dizzy: party.fx.maodieDizzyTimer > 0 || party.fx.lightningStunTimer > 0,
        clamped: party.fx.pelicanClampedTimer > 0 || party.fx.respawnTimer > 0,
        speech: party.fx.mySpeechTimer > 0 ? party.fx.mySpeech : ''
      }
    };
    if (sentEvents.length === 1) payload.useItemEvent = sentEvents[0];
    else if (sentEvents.length > 1) payload.useItemEvents = sentEvents;
    if (sentTrapHit) payload.trapHitId = sentTrapHit;
    if (party.localFinished && party.finishedClientMs > 0) {
      payload.finishedClientMs = party.finishedClientMs;
      payload.dist = party.raceDist;
    }

    try {
      const resp = await fetch('/api/party/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (resp.ok && data && data.ok) {
        party.sync404Count = 0;
        updateServerClockOffset(Number(data.serverNowMs));
        if (data.startAtMs) party.startAtMs = Number(data.startAtMs);
        if (data.status === 'racing' && party.status === 'countdown' && estServerNow() >= party.startAtMs) {
          party.status = 'racing';
        }
        if (data.you) {
          party.myItemsLanded = Number(data.you.itemsLanded || 0);
        }
        if (data.rival) {
          const prevHp = party.rival ? Number(party.rival.hp ?? 100) : 100;
          const nextHp = Number(data.rival.hp ?? 100);
          if (nextHp < prevHp - 2) {
            party.rivalHitFlash = 0.45;
          }
          party.rival = data.rival;
          if (!party.rivalRender.hasData) {
            party.rivalRender.hasData = true;
            party.rivalRender.x = Number(data.rival.x || 120);
            party.rivalRender.y = getSurfaceY(party.rivalRender.x);
          }
          if (partyRivalPinIco) partyRivalPinIco.textContent = getHeroIcon(data.rival.heroId);
          if (partyRivalPinLbl) partyRivalPinLbl.textContent = String(data.rival.nickname || '对手').slice(0, 5);
        }
        if (Array.isArray(data.trackTraps)) {
          party.serverTraps = data.trackTraps.filter((t) => !party.triggeredTrapIds.has(t.trapId));
        }
        if (Array.isArray(data.incomingEvents)) {
          for (const ev of data.incomingEvents) applyIncomingPartyEvent(ev);
        }
        if (Array.isArray(data.rematchVotes)) {
          party.rematchVotes = data.rematchVotes;
        }
        if (typeof data.playerCount === 'number') {
          party.roomPlayerCount = data.playerCount;
        }
        if (Array.isArray(data.results) && data.results.length > 0) {
          party.results = data.results;
          const myRes = data.results.find((r) => r.playerId === playerId);
          if (myRes || data.status === 'finished') {
            openOrRefreshPodium(data.results, data.status);
          }
        }
      } else {
        if (resp.status === 404 || resp.status === 403) {
          party.sync404Count = (party.sync404Count || 0) + 1;
          if (party.sync404Count >= 2 && party.status !== 'finished') {
            bridge.showToast('⚠️ 房间已结束或连接重置，已安全返回大厅');
            exitPartyToHub();
            return;
          }
        }
        if (sentEvents.length) party.outgoingEvents.unshift(...sentEvents);
      }
    } catch (_) {
      if (sentEvents.length) party.outgoingEvents.unshift(...sentEvents);
    } finally {
      syncInFlight = false;
    }
  }

  // ==================== PODIUM SETTLEMENT MODAL ====================
  function openOrRefreshPodium(results, roomStatus) {
    if (!partyPodiumOverlay || !partyPodiumList) return;
    const meEntry = results.find((r) => r.playerId === playerId);
    if (!meEntry && roomStatus !== 'finished') return;

    const myPlace = meEntry ? meEntry.place : 2;
    const isChamp = myPlace === 1;
    const rewardBeans = isChamp ? 500 : 200;

    if (!party.rewardClaimed && meEntry) {
      party.rewardClaimed = true;
      bridge.store.save.beans = (bridge.store.save.beans || 0) + rewardBeans;
      bridge.store.markMutatedAndSave(true);
      playSfx('crate');
      playVoiceSlice(isChamp ? 'manbo' : 'hakimi', 0.0, 1.8, 0.44, 'party_podium', 500, true);
    }

    if (partyPodiumBanner) partyPodiumBanner.classList.toggle('second', !isChamp);
    if (partyPodiumCrown) partyPodiumCrown.textContent = isChamp ? '🥇 第一名' : '🥈 第二名';

    const rows = [...results];
    if (rows.length < 2 && party.rival && !rows.some((r) => r.playerId === party.rival.playerId)) {
      rows.push({
        place: 2,
        playerId: party.rival.playerId,
        nickname: party.rival.nickname,
        heroId: party.rival.heroId,
        elapsedMs: null,
        dist: Math.round(party.rival.dist || 0),
        rewardBeans: 200
      });
    }

    partyPodiumList.innerHTML = '';
    for (const r of rows) {
      const div = document.createElement('div');
      div.className = `party-podium-row ${r.place === 1 ? 'winner' : ''}`;
      const isForfeited = Boolean(r.forfeited);
      const medal = r.place === 1 ? '🥇' : (isForfeited ? '🏳️' : '🥈');
      const timeStr = isForfeited
        ? (r.forfeitReason === 'disconnect' ? '掉线退赛' : '中途退赛')
        : (r.elapsedMs ? formatPodiumTime(r.elapsedMs) : `${r.dist}m`);
      const beansGrant = isForfeited ? 0 : (r.rewardBeans ?? (r.place === 1 ? 500 : 200));
      const isMeTag = r.playerId === playerId ? ' (我)' : '';
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:900;">
          <span>${medal} ${getHeroIcon(r.heroId)}</span>
          <span class="p-nick"></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:12.5px;font-weight:800;color:${isForfeited ? '#dc2626' : '#475569'};font-variant-numeric:tabular-nums;">${timeStr}</span>
          <span style="font-size:14.5px;font-weight:900;color:${isForfeited ? '#94a3b8' : '#15803d'};">+${beansGrant}🌿</span>
        </div>
      `;
      div.querySelector('.p-nick').textContent = `${r.nickname}${isMeTag}`;
      partyPodiumList.appendChild(div);
    }

    if (partyCountdownOverlay) partyCountdownOverlay.classList.add('hidden');
    if (partyLawyerOverlay) partyLawyerOverlay.classList.add('hidden');
    partyPodiumOverlay.classList.remove('hidden');
    renderHeroPickersUI();
    updateRematchButtonUI();

    if (roomStatus === 'finished') {
      if (raceSyncTimer) {
        clearInterval(raceSyncTimer);
        raceSyncTimer = null;
      }
      startPodiumConsentPoll();
    }
  }

  function updateRematchButtonUI() {
    if (!partyRematchBtn) return;
    const votes = Array.isArray(party.rematchVotes) ? party.rematchVotes : [];
    const iVoted = votes.includes(playerId);
    const rivalVoted = votes.some((v) => v !== playerId);
    if (party.roomPlayerCount < 2) {
      partyRematchBtn.textContent = '🚪 对手已离开 · 重新匹配';
    } else if (iVoted && !rivalVoted) {
      partyRematchBtn.textContent = '⏳ 已准备 (1/2) · 等对手同意';
    } else if (!iVoted && rivalVoted) {
      partyRematchBtn.textContent = '🔥 对手邀战！点击同意 (1/2)';
    } else {
      partyRematchBtn.textContent = '🔄 再来一局';
    }
  }

  function startPodiumConsentPoll() {
    if (waitPollTimer) return;
    waitPollTimer = setInterval(async () => {
      if (!party.roomCode || !partyPodiumOverlay || partyPodiumOverlay.classList.contains('hidden')) {
        if (waitPollTimer) { clearInterval(waitPollTimer); waitPollTimer = null; }
        return;
      }
      try {
        const resp = await fetch(`/api/party/room?roomCode=${encodeURIComponent(party.roomCode)}&playerId=${encodeURIComponent(playerId)}`);
        const data = await resp.json();
        if (!resp.ok || !data || !data.ok) return;
        if (Array.isArray(data.rematchVotes)) party.rematchVotes = data.rematchVotes;
        if (typeof data.playerCount === 'number') party.roomPlayerCount = data.playerCount;
        if (data.status === 'countdown' || data.status === 'racing') {
          clearPartyTimers();
          launchPartyRaceSession(data);
          return;
        }
        updateRematchButtonUI();
      } catch (_) {}
    }, 450);
  }

  function stepVerletRopeAndTension(realDt, p, w, isCountdown) {
    if (!party.rival || !party.rivalRender.hasData) {
      party.ropeTensionRatio = 0;
      party.ropePullVx = 0;
      party.ropePullDir = 0;
      return;
    }
    const rv = party.rival;
    const rr = party.rivalRender;

    // Update smooth rival HP trail for real-time HP bar!
    const curRivalHp = Math.max(0, Math.min(100, Number(rv.hp ?? 100)));
    if (party.rivalTrailHp > curRivalHp) {
      party.rivalTrailHp = Math.max(curRivalHp, party.rivalTrailHp - 38 * realDt);
    } else {
      party.rivalTrailHp = curRivalHp;
    }
    if (party.rivalHitFlash > 0) {
      party.rivalHitFlash = Math.max(0, party.rivalHitFlash - realDt);
    }

    if (isCountdown) {
      rr.x = 72;
      rr.y = getSurfaceY(72);
      rr.vx = 0;
      rr.wheelAngle += realDt * 16;
      rr.crankAngle += realDt * 11;
    }

    const rivalAhead = rr.x >= p.x;
    const ax = p.x + (rivalAhead ? 26 : -26);
    const ay = p.y - 31;
    const bx = rr.x + (rivalAhead ? -26 : 26);
    const by = rr.y - 31;
    const spanDX = bx - ax;
    const spanDY = by - ay;
    const spanDist = Math.hypot(spanDX, spanDY);
    const restLen = 150;
    const rivalStale = Number(rv.staleMs || 0) > 1600;

    let wantPullVx = 0;
    if (!isCountdown && spanDist > restLen && !party.localFinished && !rv.finished && !rivalStale && party.fx.respawnTimer <= 0) {
      const stretch = spanDist - restLen;
      party.ropeTensionRatio = Math.min(1, stretch / 720);
      // Pure distance-dependent pull (`拉力受距离影响，影响系数调小`)
      const rawPull = Math.min(72, stretch * 0.065);
      if (spanDX >= 0) {
        wantPullVx = rawPull;
        party.ropePullDir = 1;
      } else {
        const boostActive = party.fx.kunRocketTimer > 0
          || party.staminaBoosting
          || party.fx.ddjRushTimer > 0
          || party.fx.whipBoostTimer > 0;
        wantPullVx = -rawPull * (boostActive ? 0.16 : 0.48);
        party.ropePullDir = -1;
      }
    } else {
      party.ropeTensionRatio *= Math.max(0, 1 - realDt * 8);
      party.ropePullDir = 0;
    }
    party.ropePullVx += (wantPullVx - (party.ropePullVx || 0)) * Math.min(1, realDt * 8);

    // Clamp visual Verlet far-anchor to 820px along exact direction so off-screen rope stays dense & rock-solid across viewport!
    const maxVisSpan = 820;
    let vbx = bx;
    let vby = by;
    if (spanDist > maxVisSpan) {
      const inv = maxVisSpan / spanDist;
      vbx = ax + spanDX * inv;
      vby = ay + spanDY * inv;
    }
    const visSpanDist = Math.min(spanDist, maxVisSpan);

    const N = party.ropeNodes.length;
    if (N >= 2) {
      party.ropeNodes[0].x = ax; party.ropeNodes[0].y = ay;
      party.ropeNodes[0].px = ax; party.ropeNodes[0].py = ay;
      party.ropeNodes[N - 1].x = vbx; party.ropeNodes[N - 1].y = vby;
      party.ropeNodes[N - 1].px = vbx; party.ropeNodes[N - 1].py = vby;

      const grav = (1 - party.ropeTensionRatio * 0.84) * 1420;
      const twang = party.ropeTensionRatio > 0.22
        ? Math.sin(performance.now() * 0.05) * party.ropeTensionRatio * 2.4
        : 0;

      for (let i = 1; i < N - 1; i++) {
        const nd = party.ropeNodes[i];
        const vx = (nd.x - nd.px) * 0.96;
        const vy = (nd.y - nd.py) * 0.96;
        nd.px = nd.x;
        nd.py = nd.y;
        nd.x += vx;
        nd.y += vy + grav * realDt * realDt + twang * Math.sin((i / (N - 1)) * Math.PI);
      }

      const slackTarget = Math.max(visSpanDist, isCountdown ? 72 : Math.min(restLen * 1.06, visSpanDist * 1.18 + 26));
      const segTarget = Math.max(6, slackTarget / (N - 1));
      for (let iter = 0; iter < 10; iter++) {
        party.ropeNodes[0].x = ax; party.ropeNodes[0].y = ay;
        party.ropeNodes[N - 1].x = vbx; party.ropeNodes[N - 1].y = vby;
        for (let i = 0; i < N - 1; i++) {
          const n1 = party.ropeNodes[i];
          const n2 = party.ropeNodes[i + 1];
          const rdx = n2.x - n1.x;
          const rdy = n2.y - n1.y;
          const d = Math.hypot(rdx, rdy) || 0.001;
          const diff = (d - segTarget) / d;
          if (i === 0) {
            n2.x -= rdx * diff;
            n2.y -= rdy * diff;
          } else if (i + 1 === N - 1) {
            n1.x += rdx * diff;
            n1.y += rdy * diff;
          } else {
            n1.x += rdx * diff * 0.5;
            n1.y += rdy * diff * 0.5;
            n2.x -= rdx * diff * 0.5;
            n2.y -= rdy * diff * 0.5;
          }
        }
        for (let i = 1; i < N - 1; i++) {
          const nd = party.ropeNodes[i];
          const floorY = getSurfaceY(nd.x) - 6;
          if (nd.y > floorY) {
            nd.y = floorY;
            if (!isCountdown && i === Math.floor(N / 2) && party.ropeSparkCd <= 0 && p.vx > 260) {
              party.ropeSparkCd = 0.16;
              w.flamePuffs.push({
                x: nd.x, y: floorY, vx: -120, vy: -95, r: 5, life: 0.16, maxLife: 0.16
              });
            }
          }
        }
      }
    }
  }

  // ==================== 60FPS GAMEPLAY HOOKS CALLED BY MAIN.JS ====================
  function updatePartyFrame(realDt) {
    if (!party.active) return;
    const p = bridge.player;
    const w = bridge.getWorldArrays();
    const nowSrv = estServerNow();

    // 1. Pre-Start Synchronized 3..2..1..GO! Countdown
    const remMs = party.startAtMs - nowSrv;
    if (remMs > 0) {
      party.status = 'countdown';
      p.x = 120;
      p.y = getSurfaceY(120);
      p.vx = 0;
      p.vy = 0;
      p.onGround = true;
      p.wheelAngle += realDt * 18;
      p.crankAngle += realDt * 12;
      stepVerletRopeAndTension(realDt, p, w, true);

      const secCeil = Math.min(3, Math.max(1, Math.ceil(remMs / 1000)));
      if (secCeil !== party.lastCountdownBeep) {
        party.lastCountdownBeep = secCeil;
        playSfx('chime', 3 - secCeil);
      }
      if (partyCountdownOverlay && partyCdNum) {
        partyCountdownOverlay.classList.remove('hidden');
        partyCdNum.textContent = String(secCeil);
        if (partyCdSub) {
          partyCdSub.textContent = party.rival
            ? `🆚 对决 ${party.rival.nickname} · 终点 ${(party.raceDist / 1000).toFixed(1)}km！`
            : `🎲 ${(party.raceDist / 1000).toFixed(1)}km 竞速赛道！`;
        }
      }
      updatePartyHudBar(0);
      return;
    }

    if (party.status === 'countdown') {
      party.status = 'racing';
      party.goFlashTimer = 0.95;
      playSfx('chime', 3);
      playSfx('hyper');
      if (partyCdNum) partyCdNum.textContent = 'GO!!';
      if (partyCdSub) partyCdSub.textContent = '🔥 全速飙车 · 抢盲盒互坑对手！';
    }
    if (party.goFlashTimer > 0) {
      party.goFlashTimer -= realDt;
      if (party.goFlashTimer <= 0 && partyCountdownOverlay) {
        partyCountdownOverlay.classList.add('hidden');
      }
    }

    // 2. Tick Local Party Buff / Debuff / Rescue Timers
    const fx = party.fx;
    for (const k of [
      'koCrawlTimer',
      'oneHitShieldTimer',
      'panShieldTimer',
      'kunRocketTimer',
      'ddjRushTimer',
      'beanNitroTimer',
      'spicyDashTimer',
      'whipBoostTimer',
      'whipComboTimer',
      'pelicanBoostTimer',
      'pelicanClampedTimer',
      'naiwaPileTimer',
      'truckRammedTimer',
      'dagouBiteTimer',
      'bellCrushTimer',
      'manboBoostTimer',
      'manboSlowTimer',
      'bballSlowTimer',
      'maodieDizzyTimer',
      'dizzySpinTimer',
      'lightningStunTimer',
      'roadPadBoostTimer',
      'mySpeechTimer'
    ]) {
      if (fx[k] > 0) fx[k] = Math.max(0, fx[k] - realDt);
    }
    if (party.overtakeCd > 0) party.overtakeCd = Math.max(0, party.overtakeCd - realDt);
    if (party.meleeBumpCd > 0) party.meleeBumpCd = Math.max(0, party.meleeBumpCd - realDt);
    if (party.heroSkillHitCd > 0) party.heroSkillHitCd = Math.max(0, party.heroSkillHitCd - realDt);
    if (party.rivalEdgeHitFlash > 0) party.rivalEdgeHitFlash = Math.max(0, party.rivalEdgeHitFlash - realDt);
    if (party.ropeSparkCd > 0) party.ropeSparkCd = Math.max(0, party.ropeSparkCd - realDt);

    // 2A. Exact 40s Linear 1.0x -> 2.0x Unbroken-Survival Acceleration (`一直没死40s线性加满到2倍，死了回到最初`)!
    if (!party.localFinished && fx.koCrawlTimer <= 0 && fx.respawnTimer <= 0) {
      party.aliveStreakSec = Math.min(40.0, party.aliveStreakSec + realDt);
    }

    // Exaggerated Continuous Per-Frame Attack Physics (Pelican Upside-Down Dangle, Dog Rear-Tire Yank, Basketball Dribble, Frog Weight)!
    if (fx.pelicanClampedTimer > 0 && fx.respawnTimer <= 0) {
      // Hoisted 135px into the air dangling upside-down!
      const dangleY = getSurfaceY(p.x) - 135;
      p.y += (dangleY - p.y) * Math.min(1, realDt * 14);
      p.vy = 0;
      p.onGround = false;
    }
    if (fx.dagouBiteTimer > 0) {
      party.dogYankTick -= realDt;
      if (party.dogYankTick <= 0) {
        party.dogYankTick = 0.28;
        p.vx = Math.min(p.vx, -70); // Violent rhythmic backward yank by giant dog!
        playSfx('slash');
      }
    }
    if (fx.bballSlowTimer > 0) {
      party.dribbleSlamTick -= realDt;
      if (party.dribbleSlamTick <= 0 && p.onGround) {
        party.dribbleSlamTick = 0.42;
        p.vy = -370; // Dribbled off the asphalt like a basketball!
        p.onGround = false;
        playSfx('jump');
      }
    }
    if (fx.naiwaPileTimer > 0 && !p.onGround) {
      p.vy += 880 * realDt; // Stack of 6 frogs weighs down jumps!
    }

    // 2B. Genshin-Style Charging Sprint Gauge (Charges ~2.5 full bars per match; holding drains FAST in ~1.55s with blazing Mach VFX!)
    const curBeans = bridge.getRunStats().beans || 0;
    if (curBeans > (party.lastBeanCount || 0)) {
      const gained = curBeans - (party.lastBeanCount || 0);
      if (!party.staminaBoosting) {
        party.stamina = Math.min(100, party.stamina + gained * 0.55);
      }
    }
    party.lastBeanCount = curBeans;

    if (party.staminaExhaustCd > 0) {
      party.staminaExhaustCd = Math.max(0, party.staminaExhaustCd - realDt);
    }
    const canHoldSprint = !party.localFinished
      && fx.respawnTimer <= 0
      && fx.lightningStunTimer <= 0
      && fx.truckRammedTimer <= 0
      && party.staminaExhaustCd <= 0;

    if (party.staminaHeld && canHoldSprint && (party.staminaBoosting ? party.stamina > 0.5 : party.stamina >= 12)) {
      if (!party.staminaBoosting) {
        party.staminaBoosting = true;
        playSfx('hyper');
        if (bridge.triggerPartyHitImpact) bridge.triggerPartyHitImpact(0.45, true);
        p.vx = Math.max(p.vx, p.baseSpeed * 1.98);
        w.shockwaves.push({ x: p.x + 10, y: p.y - 44, r: 14, maxR: 220, life: 0.26, color: '#38bdf8', harmless: true });
      }
      // Fast Genshin sprint burn (~64%/sec -> ~1.56s full-bar burst!)
      party.stamina = Math.max(0, party.stamina - 64 * realDt);
      party.staminaRegenDelay = 0.55;
      party.staminaSparkTick -= realDt;
      if (party.staminaSparkTick <= 0) {
        party.staminaSparkTick = 0.045;
        party.sprintGhosts.push({
          x: p.x,
          y: p.y,
          angle: p.angle,
          heroId: bridge.store.save.selectedHero || 'nailong',
          life: 0.24
        });
        if (party.sprintGhosts.length > 8) party.sprintGhosts.shift();
        w.flamePuffs.push({
          x: p.x - 30,
          y: p.y - 16 + (Math.random() - 0.5) * 12,
          vx: p.vx * 0.22 - 220,
          vy: (Math.random() - 0.5) * 90,
          r: 12 + Math.random() * 8,
          life: 0.26,
          maxLife: 0.26
        });
      }
      if (party.stamina <= 0.5) {
        party.stamina = 0;
        party.staminaBoosting = false;
        party.staminaExhaustCd = 1.25;
      }
    } else {
      party.staminaBoosting = false;
      if (party.staminaRegenDelay > 0) {
        party.staminaRegenDelay = Math.max(0, party.staminaRegenDelay - realDt);
      } else if (party.stamina < 100) {
        // Tuned for 3.5km (~85s): ~2.75%/sec passive (+ aerial ring sparks => 2~3 full charges per match!)
        party.stamina = Math.min(100, party.stamina + 2.75 * realDt);
      }
    }
    // White delayed burn-down ghost bar (classic Genshin stamina trail!)
    if (party.staminaTrail > party.stamina) {
      party.staminaTrail = Math.max(party.stamina, party.staminaTrail - (party.staminaBoosting ? 24 : 58) * realDt);
    } else {
      party.staminaTrail = party.stamina;
    }
    const wantStamAlpha = (party.stamina < 99.5 || party.staminaBoosting || party.staminaExhaustCd > 0) ? 1.0 : 0.38;
    party.staminaShowAlpha += (wantStamAlpha - party.staminaShowAlpha) * Math.min(1, realDt * 7);

    if (partyStaminaFill) partyStaminaFill.style.width = `${party.stamina.toFixed(1)}%`;
    if (partyStaminaBtn) {
      partyStaminaBtn.classList.toggle('boosting', party.staminaBoosting);
      partyStaminaBtn.classList.toggle('exhausted', party.staminaExhaustCd > 0 || (!party.staminaBoosting && party.stamina < 12));
    }
    if (partyStaminaLbl) {
      if (party.staminaExhaustCd > 0) {
        partyStaminaLbl.textContent = `🥵 充能 ${Math.round(party.stamina)}%`;
      } else if (party.staminaBoosting) {
        partyStaminaLbl.textContent = `⚡ 疾驰 ${Math.round(party.stamina)}%`;
      } else {
        partyStaminaLbl.textContent = `⚡ 按住冲刺 ${Math.round(party.stamina)}%`;
      }
    }

    // 5-Lash Whip Combo Cadence
    if (fx.whipComboTimer > 0) {
      fx.whipComboNextLash -= realDt;
      if (fx.whipComboNextLash <= 0) {
        fx.whipComboNextLash = 0.12;
        playSfx('slash');
        party.whipArcs.push({
          owner: 'me',
          idx: Math.floor((0.6 - fx.whipComboTimer) * 9),
          life: 0.22,
          maxLife: 0.22
        });
      }
    }

    if (fx.lawyerBlindTimer > 0) {
      fx.lawyerBlindTimer = Math.max(0, fx.lawyerBlindTimer - realDt);
      if (fx.lawyerBlindTimer <= 0 && partyLawyerOverlay) {
        partyLawyerOverlay.classList.add('hidden');
      }
    }

    // Pelican 1.3s Rescue Airdrop Smooth Carry (ZERO 1-frame snap — interpolates smoothly from respawnStartY!)
    if (fx.respawnTimer > 0) {
      fx.respawnTimer = Math.max(0, fx.respawnTimer - realDt);
      const prog = 1 - fx.respawnTimer / 1.3;
      p.x = fx.respawnStartX + (fx.respawnTargetX - fx.respawnStartX) * prog;
      const endRoadY = getSurfaceY(fx.respawnTargetX);
      const baseCurveY = fx.respawnStartY + (endRoadY - fx.respawnStartY) * prog;
      const liftArc = Math.sin(prog * Math.PI) * 105;
      p.y = baseCurveY - liftArc;
      p.vx = 135;
      p.vy = 0;
      p.onGround = false;
      p.angle = 0;
      if (fx.respawnTimer <= 0) {
        p.y = getSurfaceY(p.x);
        p.onGround = true;
        p.invulnTimer = 1.6;
        playSfx('jump');
        bridge.addPopup('🦩 空投复位完成!', p.x + 20, p.y - 88, '#4ade80', 18);
      }
    }

    // Kun Rocket Invincible Smash!
    if (fx.kunRocketTimer > 0) {
      p.invulnTimer = Math.max(p.invulnTimer, 0.35);
      for (let i = 0; i < w.enemies.length; i++) {
        if (!w.enemies[i].hit && Math.abs(w.enemies[i].x - p.x) < 120) {
          w.enemies[i].shielded = false;
          bridge.defeatEnemy(w.enemies[i]);
        }
      }
      for (let i = 0; i < w.laserGates.length; i++) {
        if (!w.laserGates[i].hacked && Math.abs(w.laserGates[i].x - p.x) < 120) {
          w.laserGates[i].hacked = true;
          w.laserGates[i].passed = true;
        }
      }
    }

    // Pelican Clamp holds victim slightly off ground
    if (fx.pelicanClampedTimer > 0 && fx.respawnTimer <= 0) {
      const clampY = getSurfaceY(p.x) - 62;
      p.y += (clampY - p.y) * Math.min(1, realDt * 12);
      p.vy = 0;
      p.onGround = false;
    }

    // Spawn upcoming deterministic spliced modules for BOTH us and our live Rival PiP camera!
    const leadWorldX = party.rivalRender.hasData ? Math.max(p.x, party.rivalRender.x) : p.x;
    spawnTrackAhead(leadWorldX);

    // Update current Stage visual theme from active spliced segment!
    const curSeg = findSegmentAtX(p.x);
    if (curSeg && curSeg.meta) {
      bridge.setPartyStageTheme(curSeg.meta.stageIdx || 0);
    }

    // 3. Party Mystery Crates (`🎁 梗盲盒`) Pickup & Respawn (so trailing player can ALSO grab boxes!)
    for (let i = 0; i < party.crates.length; i++) {
      const cr = party.crates[i];
      cr.phase += realDt * 3.8;
      if (cr.taken) {
        cr.respawnTimer -= realDt;
        if (cr.respawnTimer <= 0) cr.taken = false;
        continue;
      }
      cr.y = cr.baseY + Math.sin(cr.phase) * 9;
      if (!party.localFinished && Math.hypot(cr.x - p.x, cr.y - (p.y - 46)) < 68) {
        cr.taken = true;
        cr.respawnTimer = 2.8;
        grantMysteryBoxItem();
      }
    }

    // 3B. Chasing-Shadows Style Sky-Falling Meme Props (金钟罩 + 叮咚鸡血 + 南北绿豆 + 辣条喷射 + 唱跳飞翼)!
    const curRunM = Math.max(0, (p.x - 120) / 18);
    while (curRunM + 34 >= party.nextSkyDropDist && party.nextSkyDropDist < party.raceDist - 35) {
      const idx = party.skyDropCount++;
      const rSeed = hashTrackSegSeed(party.trackSeed + 777, idx);
      const rng = createSeededRng(rSeed);
      const roll = rng();
      let kind = 'sky_shield';
      let ico = '🛡️';
      let chuteCol = '#38bdf8';
      if (roll < 0.30) {
        kind = 'sky_shield'; ico = '🛡️'; chuteCol = '#38bdf8'; // 背带金钟罩
      } else if (roll < 0.54) {
        kind = 'sky_ddj'; ico = '🐔'; chuteCol = '#facc15'; // 叮咚鸡血瞬喷
      } else if (roll < 0.74) {
        kind = 'sky_bean_nitro'; ico = '🧋'; chuteCol = '#4ade80'; // 南北绿豆氮气
      } else if (roll < 0.88) {
        kind = 'sky_spicy'; ico = '🌶️'; chuteCol = '#f97316'; // 卫龙辣条喷射
      } else {
        kind = 'sky_spring'; ico = '🪽'; chuteCol = '#a855f7'; // 唱跳五连飞翼
      }
      const dropX = 120 + party.nextSkyDropDist * 18;
      const roadY = getSurfaceY(dropX);
      const hoverH = 132 + Math.floor(rng() * 48); // Stays airborne (132~180px high) so AFK ground riders CANNOT get it!
      party.skyDrops.push({
        x: dropX,
        y: roadY - 255,
        baseY: roadY - hoverH,
        hoverH,
        kind,
        ico,
        chuteCol,
        parachute: true,
        taken: false,
        phase: rng() * 6.28
      });
      party.nextSkyDropDist += 68 + Math.floor(rng() * 32);
    }

    for (let i = 0; i < party.skyDrops.length; i++) {
      const sd = party.skyDrops[i];
      if (sd.taken) continue;
      sd.phase += realDt * 3.5;
      if (sd.x - p.x > 680) {
        sd.y = getSurfaceY(sd.x) - 255;
      } else {
        sd.x += p.vx * 0.36 * realDt + Math.sin(sd.phase * 1.15) * 28 * realDt;
        const targetAirY = getSurfaceY(sd.x) - (sd.hoverH || 148) + Math.sin(sd.phase) * 10;
        if (sd.y < targetAirY) {
          sd.y = Math.min(targetAirY, sd.y + 135 * realDt);
        } else {
          sd.y += (targetAirY - sd.y) * Math.min(1, realDt * 8);
        }
      }

      if (!party.localFinished && Math.hypot(sd.x - p.x, sd.y - (p.y - 46)) < 62) {
        sd.taken = true;
        playSfx('crate');
        if (sd.kind === 'sky_shield') {
          if (fx.oneHitShieldTimer > 1.0 && (party.slots[0] === null || party.slots[1] === null)) {
            const si = party.slots[0] === null ? 0 : 1;
            party.slots[si] = 'timed_shield';
            renderItemSlotsUI();
            bridge.addPopup('+🛡️背带金钟罩', p.x + 22, p.y - 102, '#38bdf8', 19);
          } else {
            fx.oneHitShieldTimer = 7.0;
            fx.oneHitShieldMax = 7.0;
            playSfx('parry');
            bridge.addPopup('🛡️ 背带金钟罩!', p.x + 22, p.y - 102, '#38bdf8', 19);
          }
        } else if (sd.kind === 'sky_ddj') {
          fx.ddjRushTimer = Math.max(fx.ddjRushTimer, 1.45);
          fx.bballSlowTimer = 0;
          fx.manboSlowTimer = 0;
          p.vy = Math.min(p.vy, -220);
          p.onGround = false;
          playVoiceSlice('ddj', 0.0, 1.1, 0.40, 'party_vo', 600, false);
          playSfx('hyper');
          bridge.addPopup('🐔 叮咚鸡飙车!', p.x + 22, p.y - 102, '#facc15', 19);
        } else if (sd.kind === 'sky_bean_nitro') {
          fx.beanNitroTimer = Math.max(fx.beanNitroTimer, 2.7);
          p.magnetTimer = Math.max(p.magnetTimer || 0, 3.6);
          playVoiceSlice('hakimi', 0.0, 1.6, 0.38, 'party_vo', 600, false);
          playSfx('chime', 2);
          bridge.addPopup('🧋 南北绿豆氮气!', p.x + 22, p.y - 102, '#4ade80', 19);
        } else if (sd.kind === 'sky_spicy') {
          fx.spicyDashTimer = Math.max(fx.spicyDashTimer, 2.2);
          playSfx('hyper');
          bridge.addPopup('🌶️ 辣条喷射!', p.x + 22, p.y - 102, '#f97316', 19);
        } else if (sd.kind === 'sky_spring') {
          p.skyWingsTimer = Math.max(p.skyWingsTimer || 0, 5.0);
          fx.roadPadBoostTimer = Math.max(fx.roadPadBoostTimer, 1.4);
          p.jumpsLeft = 5;
          p.vy = Math.min(p.vy, -460);
          p.onGround = false;
          playSfx('jump');
          bridge.addPopup('🪽 唱跳五连跳!', p.x + 22, p.y - 102, '#a855f7', 19);
        } else {
          grantMysteryBoxItem();
        }
        bridge.refreshBuffChips();
      }
    }

    // 4A. Sculpted 3D High-Altitude Turbo Boost Rings (`⚡ 空中涡轮加速环` — rewards active jumping/flying!)
    for (let i = 0; i < party.boostRings.length; i++) {
      const rg = party.boostRings[i];
      rg.spin += realDt * 3.6;
      rg.y = rg.baseY + Math.sin(rg.spin * 0.8) * 6;
      if (rg.cd > 0) rg.cd = Math.max(0, rg.cd - realDt);
      if (rg.cd <= 0 && !party.localFinished && Math.hypot(p.x - rg.x, (p.y - 42) - rg.y) < 58) {
        rg.cd = 1.6;
        fx.roadPadBoostTimer = Math.max(fx.roadPadBoostTimer, rg.isGold ? 2.05 : 1.55);
        party.stamina = Math.min(100, party.stamina + (rg.isGold ? 12 : 8));
        p.vy = Math.min(p.vy, rg.isGold ? -220 : -165);
        p.onGround = false;
        playSfx('hyper');
        w.shockwaves.push({
          x: rg.x,
          y: rg.y,
          r: 22,
          maxR: rg.isGold ? 210 : 165,
          life: 0.28,
          color: rg.isGold ? '#fde047' : '#38bdf8',
          harmless: true
        });
        bridge.addPopup(rg.isGold ? '🌟 高空金环超喷!' : '⚡ 穿环涡轮加速!', rg.x + 18, rg.y - 42, rg.isGold ? '#fde047' : '#38bdf8', 19);
        bridge.refreshBuffChips();
      }
    }

    // 4B. Party Turbo Boost Strips (mostly on high Skyrails; very few on ground!)
    for (let i = 0; i < party.boostPads.length; i++) {
      const bp = party.boostPads[i];
      if (bp.cd > 0) bp.cd = Math.max(0, bp.cd - realDt);
      const padSurfY = getSurfaceY(p.x) - (bp.hOff || 0);
      if (bp.cd <= 0 && p.x >= bp.x && p.x <= bp.x + bp.len && Math.abs(p.y - padSurfY) < 42) {
        bp.cd = 1.2;
        fx.roadPadBoostTimer = Math.max(fx.roadPadBoostTimer, (bp.hOff || 0) > 40 ? 1.55 : 1.22);
        playSfx('hyper');
        bridge.addPopup((bp.hOff || 0) > 40 ? '⚡ 高架涡轮轨!' : '⚡ 加速带!', p.x + 28, p.y - 86, '#38bdf8', 17);
        bridge.refreshBuffChips();
      }
    }

    // 5. Shared Track Traps (`😾 圆头耄耋哈气路障`) Collision
    for (let i = 0; i < party.serverTraps.length; i++) {
      const tr = party.serverTraps[i];
      if (!tr.active || tr.ownerId === playerId || party.triggeredTrapIds.has(tr.trapId)) continue;
      const roadY = getSurfaceY(tr.x);
      if (!party.localFinished && fx.respawnTimer <= 0 && Math.abs(p.x - tr.x) < 44 && p.y > roadY - 46) {
        tr.active = false;
        party.triggeredTrapIds.add(tr.trapId);
        party.pendingTrapHitId = tr.trapId;

        if (fx.panShieldTimer > 0) {
          fx.panShieldTimer = 0;
          playSfx('parry');
          showPartyBanner('🥘 纯路人铁锅震飞了圆头耄耋路障！', 2200);
        } else if (fx.kunRocketTimer > 0) {
          playSfx('crater');
          bridge.addPopup('🚀 窜天猴撞飞耄耋!', tr.x, roadY - 68, '#fde047', 17);
        } else {
          fx.maodieDizzyTimer = 2.2;
          fx.dizzySpinTimer = 1.1;
          p.vy = -440;
          p.onGround = false;
          playVoiceSlice('ddj', 4.22, 1.08, 0.42, 'party_vo', 700, true);
          playSfx('hurt');
          fx.mySpeech = '😾 哎哟踩中圆头耄耋了！';
          fx.mySpeechTimer = 2.2;
          showPartyBanner(`😾 踩中 ${tr.ownerNick || '对手'} 的圆头耄耋哈气路障！减速 -45%！`, 2400);
        }
        bridge.refreshBuffChips();
        triggerPartySyncNow();
      }
    }

    // 6. Smooth Zero-Teleport Rival Dead-Reckoning + 14-Node Verlet Spring-Damper Rope Physics!
    if (party.rival && party.rivalRender.hasData) {
      const rv = party.rival;
      const rr = party.rivalRender;
      if (rr.bballTimer > 0) rr.bballTimer = Math.max(0, rr.bballTimer - realDt);

      // Continuous velocity-smoothed tracking — NEVER hard-snaps (`rr.x = targetX` forbidden during race!)
      const targetX = Number(rv.x || 120);
      const srvVx = Number(rv.vx || 350);
      const dx = targetX - rr.x;
      const catchupVx = srvVx + Math.max(-520, Math.min(520, dx * 5.8));
      rr.vx += (catchupVx - (rr.vx || srvVx)) * Math.min(1, realDt * 14);
      rr.x += rr.vx * realDt;

      const roadYAtRival = getSurfaceY(rr.x);
      const anim = rv.animState || {};
      const wantY = anim.onGround !== false ? roadYAtRival : Math.min(roadYAtRival, roadYAtRival + Number(rv.y || 0));
      rr.y += (wantY - rr.y) * Math.min(1, realDt * 14);
      rr.wheelAngle += (Math.max(120, Math.abs(rr.vx || 320)) * realDt) / 23;
      rr.crankAngle += (Math.max(120, Math.abs(rr.vx || 320)) * realDt) / 32;
      const slope = Math.atan2(getSurfaceY(rr.x + 8) - getSurfaceY(rr.x - 8), 16);
      rr.angle += ((anim.dizzy ? Math.sin(performance.now() * 0.03) * 0.8 : slope) - rr.angle) * Math.min(1, realDt * 12);

      // Overtake / Lead-Swap Clash Feedback (`你追我赶`!)
      const nowAhead = p.x >= rr.x;
      if (party.wasAheadOfRival !== null && nowAhead !== party.wasAheadOfRival && party.overtakeCd <= 0 && !party.localFinished) {
        party.overtakeCd = 1.8;
        if (nowAhead) {
          playSfx('chime', 3);
          bridge.addPopup('🔥 弹射反超!!', p.x + 24, p.y - 112, '#fde047', 21);
        } else {
          playSfx('slash');
          bridge.addPopup('⚡ 被超车! 绳索牵引追击!', p.x + 24, p.y - 112, '#38bdf8', 19);
        }
      }
      party.wasAheadOfRival = nowAhead;

      // 6B. Distance-Proportional Visible Rope Physics & Tension Update
      stepVerletRopeAndTension(realDt, p, w, false);
    } else {
      party.ropeTensionRatio *= Math.max(0, 1 - realDt * 8);
      party.ropePullVx *= Math.max(0, 1 - realDt * 8);
      party.ropePullDir = 0;
    }

    // 7. Tick Party Visual Effects (Basketball Rain, Sculpted Chaos Barrages, Whip Arcs, Ghosts, HitMarkers)
    for (let i = 0; i < party.chaosProjectiles.length; i++) {
      const cp = party.chaosProjectiles[i];
      cp.life -= realDt;
      const tx = cp.target === 'rival'
        ? (party.rivalRender.hasData ? party.rivalRender.x : p.x + 280)
        : p.x;
      if (cp.homingPull > 0) {
        cp.vx += (tx - cp.x) * cp.homingPull * realDt;
      }
      if (cp.kind === 'truck') {
        cp.x += cp.vx * realDt;
        cp.y = getSurfaceY(cp.x) - 34;
      } else {
        cp.vy += 1520 * realDt;
        cp.x += cp.vx * realDt;
        cp.y += cp.vy * realDt;
        cp.rot += cp.vRot * realDt;
        const floorY = getSurfaceY(cp.x) - (cp.kind === 'bell' ? 32 : 24);
        if (cp.y >= floorY) {
          cp.y = floorY;
          if (cp.bounces > 0) {
            cp.bounces -= 1;
            cp.vy = cp.kind === 'bell' ? -240 : -460;
          } else {
            cp.vy = 0;
          }
        }
      }
    }
    party.chaosProjectiles = party.chaosProjectiles.filter((c) => c.life > 0);

    for (let i = 0; i < party.whipArcs.length; i++) party.whipArcs[i].life -= realDt;
    party.whipArcs = party.whipArcs.filter((a) => a.life > 0);

    for (let i = 0; i < party.sprintGhosts.length; i++) party.sprintGhosts[i].life -= realDt;
    party.sprintGhosts = party.sprintGhosts.filter((g) => g.life > 0);

    for (let i = 0; i < party.hitMarkers.length; i++) party.hitMarkers[i].life -= realDt;
    party.hitMarkers = party.hitMarkers.filter((h) => h.life > 0);

    for (let i = 0; i < party.visualBballs.length; i++) {
      const bb = party.visualBballs[i];
      bb.life -= realDt;
      bb.vy += 1550 * realDt;
      bb.y += bb.vy * realDt;
      bb.rot += 9 * realDt;
      const anchorX = bb.target === 'rival' ? party.rivalRender.x : p.x;
      const floorY = getSurfaceY(anchorX + bb.offX) - 26;
      if (bb.y >= floorY) {
        bb.y = floorY;
        if (bb.bounces > 0) {
          bb.bounces -= 1;
          bb.vy = -480;
          playSfx('jump');
        }
      }
    }
    party.visualBballs = party.visualBballs.filter((b) => b.life > 0);

    for (let i = 0; i < party.sonicWaves.length; i++) {
      const sw = party.sonicWaves[i];
      sw.r += (sw.maxR - sw.r) * realDt * 6.5;
      sw.life -= realDt;
    }
    party.sonicWaves = party.sonicWaves.filter((s) => s.life > 0);

    for (let i = 0; i < party.lightningBolts.length; i++) {
      party.lightningBolts[i].life -= realDt;
    }
    party.lightningBolts = party.lightningBolts.filter((l) => l.life > 0);

    for (let i = 0; i < party.confetti.length; i++) {
      const cf = party.confetti[i];
      cf.x += cf.vx * realDt;
      cf.y += cf.vy * realDt;
      cf.vy += 320 * realDt;
      cf.rot += cf.vRot * realDt;
      cf.life -= realDt;
    }
    party.confetti = party.confetti.filter((c) => c.life > 0);

    // 7B. Tick Long-Range Homing Missiles (100% Lock-On Tracking onto Moving Target!)
    for (let i = party.homingMissiles.length - 1; i >= 0; i--) {
      const hm = party.homingMissiles[i];
      hm.prog = Math.min(1, hm.prog + realDt / Math.max(0.15, hm.dur));
      const tx = hm.target === 'me'
        ? p.x
        : (party.rivalRender.hasData ? party.rivalRender.x : p.x + 420);
      const ty = hm.target === 'me'
        ? (p.y - 48)
        : (party.rivalRender.hasData ? (party.rivalRender.y - 48) : (p.y - 48));
      const arcLift = Math.sin(hm.prog * Math.PI) * 140;
      hm.curX = hm.startX + (tx - hm.startX) * hm.prog;
      hm.curY = hm.startY + (ty - hm.startY) * hm.prog - arcLift;
      if (hm.prog >= 1) {
        const cb = hm.onImpact;
        party.homingMissiles.splice(i, 1);
        if (typeof cb === 'function') cb();
      }
    }

    // 7C. Deterministic Shared Party Race Bosses (640m & 1360m)!
    const curMeters = Math.max(0, (p.x - 120) / 18);
    const nextBossSlot = party.bossTriggeredIdx + 1;
    if (
      !party.localFinished
      && nextBossSlot < party.bossTriggerDists.length
      && curMeters >= party.bossTriggerDists[nextBossSlot]
      && bridge.spawnPartyRaceBoss
      && (!bridge.getActiveBoss || !bridge.getActiveBoss())
    ) {
      party.bossTriggeredIdx = nextBossSlot;
      bridge.spawnPartyRaceBoss(party.trackSeed + nextBossSlot * 5);
    }

    // 8. Check Crossing 2000m Finish Arch!
    if (!party.localFinished && curMeters >= party.raceDist) {
      party.localFinished = true;
      party.finishedClientMs = Math.round(estServerNow());
      p.invulnTimer = 15.0;
      playSfx('crate');
      const cols = ['#fde047', '#ec4899', '#38bdf8', '#4ade80', '#f97316'];
      for (let c = 0; c < 36; c++) {
        party.confetti.push({
          x: party.finishX + (Math.random() - 0.3) * 140,
          y: getSurfaceY(party.finishX) - 90 - Math.random() * 110,
          vx: (Math.random() - 0.2) * 380,
          vy: -240 - Math.random() * 280,
          col: cols[c % cols.length],
          rot: Math.random() * 6,
          vRot: (Math.random() - 0.5) * 14,
          life: 2.8
        });
      }
      triggerPartySyncNow();
    }

    const elapsedMs = Math.max(0, nowSrv - party.startAtMs);
    updatePartyHudBar(elapsedMs);
  }

  function updatePartyHudBar(elapsedMs) {
    const p = bridge.player;
    const myM = Math.min(party.raceDist, Math.max(0, (p.x - 120) / 18));
    const rvM = party.rival ? Math.min(party.raceDist, Math.max(0, Number(party.rival.dist || 0))) : 0;
    const myPct = Math.min(100, Math.max(0, (myM / party.raceDist) * 100));
    const rvPct = Math.min(100, Math.max(0, (rvM / party.raceDist) * 100));

    if (partyTrackMeFill) partyTrackMeFill.style.width = `${myPct.toFixed(1)}%`;
    if (partyMePin) partyMePin.style.left = `${myPct.toFixed(1)}%`;
    if (partyRivalPin) partyRivalPin.style.left = `${rvPct.toFixed(1)}%`;

    const isLeading = myM >= rvM - 0.2;
    if (partyPlaceBadge) {
      const gap = Math.round(Math.abs(myM - rvM));
      partyPlaceBadge.textContent = isLeading ? `🥇 1st +${gap}m` : `🥈 2nd -${gap}m`;
      partyPlaceBadge.classList.toggle('trailing', !isLeading);
    }
    if (partyTimeTxt) {
      partyTimeTxt.textContent = formatRaceTime(elapsedMs);
    }
  }

  function getSpeedMultiplier() {
    if (!party.active) return 1.0;
    if (party.status === 'countdown') return 0.0;
    const fx = party.fx;
    if (party.localFinished) return 0.55;
    if (fx.koCrawlTimer > 0) return 0.16; // Killed -> drops to absolute minimum crawl speed!
    if (fx.respawnTimer > 0) return 0.35;

    // 40-Second Linear 1.00x -> 2.00x Unbroken-Survival Speed Ramp (resets to 1.00x on death!)
    const aliveMult = 1.0 + Math.min(1.0, party.aliveStreakSec / 40.0);

    if (fx.kunRocketTimer > 0) return Math.max(2.35, aliveMult * 1.48);

    let boostMult = 1.0;
    if (party.staminaBoosting) boostMult = Math.max(boostMult, 1.72);
    if (fx.ddjRushTimer > 0) boostMult = Math.max(boostMult, 1.66);
    if (fx.whipBoostTimer > 0) boostMult = Math.max(boostMult, 1.50);
    if (fx.spicyDashTimer > 0) boostMult = Math.max(boostMult, 1.44);
    if (fx.beanNitroTimer > 0) boostMult = Math.max(boostMult, 1.40);
    if (fx.pelicanBoostTimer > 0) boostMult = Math.max(boostMult, 1.38);
    if (fx.roadPadBoostTimer > 0) boostMult = Math.max(boostMult, 1.32);
    if (fx.manboBoostTimer > 0) boostMult = Math.max(boostMult, 1.30);

    let mult = aliveMult * boostMult;

    if (fx.truckRammedTimer > 0) mult = 0.18;
    else if (fx.lightningStunTimer > 0 || fx.bellCrushTimer > 0) mult = 0.20;
    else if (fx.pelicanClampedTimer > 0) mult = 0.22;
    else if (fx.dagouBiteTimer > 0) mult *= 0.36;
    else if (fx.naiwaPileTimer > 0) mult *= 0.42;
    else if (fx.maodieDizzyTimer > 0) mult *= 0.46;
    else if (fx.bballSlowTimer > 0) mult *= 0.50;
    else if (fx.manboSlowTimer > 0) mult *= 0.60;
    else if (fx.lawyerBlindTimer > 0) mult *= 0.76;

    return mult;
  }

  function getExtraBuffLabels() {
    if (!party.active) return [];
    const fx = party.fx;
    const out = [];
    const aliveMult = 1.0 + Math.min(1.0, party.aliveStreakSec / 40.0);
    if (fx.koCrawlTimer > 0) out.push(`💀 击倒龟速 ${fx.koCrawlTimer.toFixed(1)}s`);
    else if (party.aliveStreakSec >= 1.5) out.push(`🔥 无伤提速 ${aliveMult.toFixed(2)}x`);
    if (fx.oneHitShieldTimer > 0) out.push(`🛡️ 背带金钟罩 ${fx.oneHitShieldTimer.toFixed(1)}s`);
    if (fx.panShieldTimer > 0) out.push(`🥘 纯路人铁锅 ${fx.panShieldTimer.toFixed(1)}s`);
    if (party.staminaBoosting) out.push(`⚡ 疾驰冲刺`);
    if (fx.kunRocketTimer > 0) out.push(`🚀 背带窜天猴 ${fx.kunRocketTimer.toFixed(1)}s`);
    if (fx.ddjRushTimer > 0) out.push(`🐔 叮咚鸡血 ${fx.ddjRushTimer.toFixed(1)}s`);
    if (fx.beanNitroTimer > 0) out.push(`🧋 南北绿豆 ${fx.beanNitroTimer.toFixed(1)}s`);
    if (fx.spicyDashTimer > 0) out.push(`🌶️ 辣条喷射 ${fx.spicyDashTimer.toFixed(1)}s`);
    if (fx.naiwaPileTimer > 0) out.push(`🐸 奶蛙压塌 ${fx.naiwaPileTimer.toFixed(1)}s`);
    if (fx.truckRammedTimer > 0) out.push(`🚛 被泥头车创飞!`);
    if (fx.dagouBiteTimer > 0) out.push(`🐕 恶犬拽车 ${fx.dagouBiteTimer.toFixed(1)}s`);
    if (fx.bellCrushTimer > 0) out.push(`🔔 压成铁饼!`);
    if (fx.bballSlowTimer > 0) out.push(`🏀 被拍篮球 ${fx.bballSlowTimer.toFixed(1)}s`);
    if (fx.maodieDizzyTimer > 0) out.push(`😾 猫爪旋风 ${fx.maodieDizzyTimer.toFixed(1)}s`);
    if (fx.pelicanClampedTimer > 0) out.push(`🦢 倒挂半空!`);
    return out;
  }

  function getPlayerCartoonTransform() {
    if (!party.active) return null;
    const fx = party.fx;
    const now = performance.now();
    if (fx.bellCrushTimer > 0) {
      // Squashed flat into a wide pancake under the Giant Shaolin Bronze Bell!
      return { sx: 1.64, sy: 0.36, offY: 6, extraRot: 0 };
    }
    if (fx.truckRammedTimer > 0) {
      // Wild 1080° ragdoll airborne somersault!
      return { sx: 1.06, sy: 0.94, offY: 0, extraRot: fx.truckRammedTimer * Math.PI * 5.2 };
    }
    if (fx.pelicanClampedTimer > 0) {
      // Dangling upside-down like a pendulum in the giant pelican's beak!
      return { sx: 0.96, sy: 1.04, offY: 0, extraRot: Math.PI * 0.88 + Math.sin(now * 0.018) * 0.35 };
    }
    if (fx.naiwaPileTimer > 0) {
      // Crushed downward under a bouncing stack of 5 Naiwa frogs!
      const squish = Math.abs(Math.sin(now * 0.016)) * 0.14;
      return { sx: 1.18 + squish, sy: 0.78 - squish * 0.7, offY: 4, extraRot: 0 };
    }
    if (fx.dagouBiteTimer > 0) {
      // Violently jerked backward into a steep wheelie by Giant Dog biting rear tire!
      return { sx: 1.05, sy: 0.96, offY: 0, extraRot: -0.38 + Math.sin(now * 0.04) * 0.12 };
    }
    if (fx.maodieDizzyTimer > 0) {
      // Cartoon horizontal flip-spin inside cat-scratch tornado!
      return { sx: Math.cos(now * 0.024) * 0.95 || 0.25, sy: 1.05, offY: 0, extraRot: Math.sin(now * 0.02) * 0.25 };
    }
    if (fx.bballSlowTimer > 0) {
      // Squash-and-stretch basketball dribble deformation!
      const s = Math.sin(now * 0.022) * 0.22;
      return { sx: 1.0 + s, sy: 1.0 - s, offY: 2, extraRot: 0 };
    }
    return null;
  }

  // ==================== WORLD-SPACE & SCREEN-SPACE CANVAS RENDERING ====================
  function renderWorldTrackExtras(ctx, startWX, endWX) {
    if (!party.active) return;
    const now = performance.now();

    // 1. Start & Finish Archways (Clean, zero mid-track text signposts!)
    if (120 >= startWX - 220 && 120 <= endWX + 220) {
      drawArchGantry(ctx, 120, getSurfaceY(120), 'START', '#38bdf8', false);
    }
    if (party.finishX >= startWX - 260 && party.finishX <= endWX + 260) {
      drawArchGantry(ctx, party.finishX, getSurfaceY(party.finishX), 'FINISH 🏁', '#fde047', true);
    }

    // 2A. Sculpted 3D High-Altitude Turbo Boost Rings (`⚡ 空中涡轮加速环`)!
    for (let i = 0; i < party.boostRings.length; i++) {
      const rg = party.boostRings[i];
      if (rg.x < startWX - 80 || rg.x > endWX + 80) continue;
      drawSculptedBoostRing(ctx, rg, now);
    }

    // 2B. Glowing Neon Speed Boost Strips (primarily on high Skyrails!)
    const scrollPhase = (now * 0.015) % 28;
    for (let i = 0; i < party.boostPads.length; i++) {
      const bp = party.boostPads[i];
      if (bp.x + bp.len < startWX || bp.x > endWX) continue;
      const hOff = bp.hOff || 0;
      const y1 = getSurfaceY(bp.x) - hOff;
      const y2 = getSurfaceY(bp.x + bp.len) - hOff;
      const slope = Math.atan2(y2 - y1, bp.len);
      ctx.save();
      ctx.translate(bp.x, y1 + (hOff > 0 ? 0 : 2));
      ctx.rotate(slope);
      ctx.fillStyle = hOff > 0 ? 'rgba(16, 185, 129, 0.92)' : 'rgba(14, 165, 233, 0.88)';
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(0, -7, bp.len, 13, 6);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      for (let cx = 14 + (scrollPhase % 24); cx < bp.len - 12; cx += 24) {
        ctx.beginPath();
        ctx.moveTo(cx - 6, -4);
        ctx.lineTo(cx + 2, 0);
        ctx.lineTo(cx - 6, 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Rainbow Meme Mystery Boxes (`🎁 梗盲盒`)
    for (let i = 0; i < party.crates.length; i++) {
      const cr = party.crates[i];
      if (cr.taken || cr.x < startWX - 60 || cr.x > endWX + 60) continue;
      ctx.save();
      ctx.translate(cr.x, cr.y);
      const wob = Math.sin(cr.phase * 1.2) * 0.14;
      ctx.rotate(wob);

      // Outer rainbow glow ring
      const ringCols = ['#ec4899', '#fde047', '#38bdf8', '#4ade80'];
      ctx.strokeStyle = ringCols[Math.floor((now * 0.008 + i) % ringCols.length)];
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 31, 0, Math.PI * 2);
      ctx.stroke();

      // 3D Mystery Cube
      ctx.fillStyle = '#7c3aed';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-22, -22, 44, 44, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ec4899';
      ctx.beginPath();
      ctx.roundRect(-17, -17, 34, 16, 6);
      ctx.fill();

      // Ribbon & Question Mark
      ctx.fillStyle = '#fde047';
      ctx.fillRect(-4, -22, 8, 44);
      ctx.fillRect(-22, -4, 44, 8);
      ctx.font = '900 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.5;
      ctx.strokeText('?', 0, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('?', 0, 1);
      ctx.restore();
    }

    // 3B. Sky-Falling Parachute Mini Props (`噩梦逐影风格高空飘落小道具`)
    for (let i = 0; i < party.skyDrops.length; i++) {
      const sd = party.skyDrops[i];
      if (sd.taken || sd.x < startWX - 70 || sd.x > endWX + 70) continue;
      ctx.save();
      ctx.translate(sd.x, sd.y);
      const sway = sd.parachute ? Math.sin(sd.phase * 1.15) * 0.16 : Math.sin(sd.phase) * 0.06;
      ctx.rotate(sway);

      if (sd.parachute) {
        // Rigging cords
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.88)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-26, -34); ctx.lineTo(-9, -15);
        ctx.moveTo(0, -37);   ctx.lineTo(0, -18);
        ctx.moveTo(26, -34);  ctx.lineTo(9, -15);
        ctx.stroke();

        // Striped colorful parachute canopy
        ctx.fillStyle = sd.chuteCol || '#38bdf8';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(0, -34, 28, Math.PI, 0, false);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // White center gore stripe
        ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
        ctx.beginPath();
        ctx.ellipse(0, -34, 10, 27, 0, Math.PI, 0, false);
        ctx.closePath();
        ctx.fill();
      }

      // Glowing Mini-Prop Pod (Clean icon-only, zero text clutter!)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = sd.chuteCol || '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '900 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sd.ico || '🛡️', 0, 1);
      ctx.restore();
    }

    // 4. Shared Track Traps (`😾 圆头耄耋哈气路障`)
    for (let i = 0; i < party.serverTraps.length; i++) {
      const tr = party.serverTraps[i];
      if (!tr.active || tr.x < startWX - 80 || tr.x > endWX + 80) continue;
      const isMine = tr.ownerId === playerId;
      const ry = getSurfaceY(tr.x);
      ctx.save();
      ctx.translate(tr.x, ry);
      ctx.fillStyle = isMine ? 'rgba(56, 189, 248, 0.26)' : 'rgba(239, 68, 68, 0.36)';
      ctx.strokeStyle = isMine ? '#38bdf8' : '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -2, 36, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      const hop = Math.abs(Math.sin(now * 0.014 + i)) * 7;
      drawModelOn(ctx, 'prop_maodie', tr.x, ry - 28 - hop, Math.sin(now * 0.02) * 0.12, 1.05);

      ctx.save();
      ctx.font = '900 10.5px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isMine ? '#38bdf8' : '#fda4af';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      const lbl = isMine ? '😾我方路障' : `😾${(tr.ownerNick || '对手').slice(0, 4)}的路障!`;
      ctx.strokeText(lbl, tr.x, ry - 64 - hop);
      ctx.fillText(lbl, tr.x, ry - 64 - hop);
      ctx.restore();
    }
  }

  function drawArchGantry(ctx, wx, wy, labelText, accentCol, isFinish) {
    ctx.save();
    ctx.translate(wx, wy);
    // Twin Pillars
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(-62, -210, 16, 214, 5);
    ctx.roundRect(46, -210, 16, 214, 5);
    ctx.fill();
    ctx.stroke();

    // Checkered Road Strip
    for (let r = 0; r < 2; r++) {
      for (let c = -3; c < 3; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#0f172a';
        ctx.fillRect(c * 14, -4 + r * 7, 14, 7);
      }
    }

    // Top Checkered Arch Beam
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = accentCol;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-84, -246, 168, 44, 12);
    ctx.fill();
    ctx.stroke();

    if (isFinish) {
      for (let c = -5; c < 5; c++) {
        ctx.fillStyle = c % 2 === 0 ? '#ffffff' : '#1e293b';
        ctx.fillRect(c * 15, -242, 15, 8);
      }
    }

    ctx.fillStyle = accentCol;
    ctx.font = '900 13.5px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labelText, 0, -217);
    ctx.restore();
  }

  // Sculpted 3D High-Altitude Turbo Boost Ring (`⚡ 空中涡轮加速环` — 3D Torus Bevel + Thruster Pods + Plasma Core!)
  function drawSculptedBoostRing(ctx, rg, now) {
    const isGold = rg.isGold;
    const used = rg.cd > 0;
    const primary = isGold ? '#facc15' : '#38bdf8';
    const secondary = isGold ? '#f97316' : '#0284c7';
    const rx = 20;
    const ry = 42;
    ctx.save();
    ctx.translate(rg.x, rg.y);
    if (used) ctx.globalAlpha = 0.45;

    // Back 3D armored rim half
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

    // Inner glowing energy plasma field + animated forward >> chevrons!
    ctx.fillStyle = isGold ? 'rgba(250, 204, 21, 0.22)' : 'rgba(56, 189, 248, 0.22)';
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

    // Front 3D beveled torus half + top/bottom thruster pods!
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

  function drawRopeEndCollar(ctx, anchor, toward, tension) {
    if (!anchor || !toward) return;
    const ang = Math.atan2(toward.y - anchor.y, toward.x - anchor.x);
    const springLen = 22 + tension * 16;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(ang);

    // Forged steel riveted frame collar clamp
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = tension > 0.45 ? '#ef4444' : '#facc15';
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();

    // U-Shackle (`U型锻钢卸扣`)
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.moveTo(4, -5.5);
    ctx.lineTo(13.5, -5.5);
    ctx.arc(13.5, 0, 5.5, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(4, 5.5);
    ctx.stroke();

    // 5-Coil Metallic Helical Buffer Spring (`缓冲螺旋弹簧`)
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5.2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    for (let c = 0; c < 5; c++) {
      const cx = 17 + (c + 0.5) * (springLen / 5);
      const cy = (c % 2 === 0 ? -7 : 7);
      ctx.lineTo(cx, cy);
    }
    ctx.lineTo(17 + springLen, 0);
    ctx.stroke();

    ctx.strokeStyle = tension > 0.5 ? '#fde047' : '#f8fafc';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // Sculpted 2.5D Multi-Node Braided Rope + Arc-Length Strands + Tension Force Chevrons + Brass Swivel!
  function drawSculptedDampedRope(ctx, now, startWX = -999999, endWX = 999999) {
    const nodes = party.ropeNodes;
    if (!nodes || nodes.length < 4 || !party.rival || !party.rivalRender.hasData) return;
    const N = nodes.length;
    const tension = party.ropeTensionRatio;

    ctx.save();
    // 1. Soft Projected Ground Shadow Ribbon along Asphalt
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.30)';
    ctx.lineWidth = 10 - tension * 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const gx = nodes[i].x;
      const gy = getSurfaceY(gx) + 2;
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    }
    ctx.stroke();

    // 2. Outer Tension Glow + Dark Ink Bed so the rope pops against ANY background!
    const ropeR = 7.0 - tension * 1.3;
    const baseHue = tension > 0.62 ? '#ef4444' : (tension > 0.22 ? '#fb923c' : '#facc15');
    const altHue = tension > 0.62 ? '#facc15' : (tension > 0.22 ? '#fde047' : '#eab308');
    const hiHue = tension > 0.62 ? '#fecaca' : '#fef9c3';

    if (tension > 0.12) {
      ctx.strokeStyle = tension > 0.62 ? 'rgba(239, 68, 68, 0.42)' : 'rgba(251, 146, 60, 0.38)';
      ctx.lineWidth = ropeR * 2 + 11;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      for (let i = 1; i < N; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = ropeR * 2 + 5.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < N; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
    ctx.stroke();

    // 3. Step Along True World Arc-Length Every 8.5px so Strands NEVER Separate Into Dots at Long Distance!
    const stepPx = 8.5;
    let accum = 0;
    let strandIdx = 0;
    let midPt = { x: nodes[Math.floor(N / 2)].x, y: nodes[Math.floor(N / 2)].y, ang: 0 };
    const totalApprox = Math.hypot(nodes[N - 1].x - nodes[0].x, nodes[N - 1].y - nodes[0].y);

    for (let i = 0; i < N - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 0.5) continue;
      const ang = Math.atan2(dy, dx);
      if (i === Math.floor(N / 2)) midPt = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, ang };

      let d = accum;
      while (d <= segLen) {
        const u = d / segLen;
        const sx = a.x + dx * u;
        const sy = a.y + dy * u;
        strandIdx += 1;
        if (sx >= startWX - 45 && sx <= endWX + 45) {
          const nearStart = Math.hypot(sx - nodes[0].x, sy - nodes[0].y) < 38;
          const nearEnd = Math.hypot(sx - nodes[N - 1].x, sy - nodes[N - 1].y) < 38;
          const isWrap = nearStart || nearEnd;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(ang + (isWrap ? 0 : 0.40));
          ctx.fillStyle = isWrap
            ? (strandIdx % 2 === 0 ? '#1e293b' : '#facc15')
            : (strandIdx % 3 === 0 ? altHue : baseHue);
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          ctx.ellipse(0, 0, ropeR * 1.42, ropeR * 0.98, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          if (!isWrap) {
            ctx.fillStyle = hiHue;
            ctx.beginPath();
            ctx.ellipse(-0.4, -ropeR * 0.34, ropeR * 0.92, ropeR * 0.34, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          // Animated Directional Pull Chevrons gliding along the rope when taut!
          if (tension > 0.16 && party.ropePullDir !== 0) {
            const flow = Math.floor(now * 0.022) * (party.ropePullDir > 0 ? -1 : 1);
            if (((strandIdx + flow) % 9 + 9) % 9 === 0) {
              ctx.save();
              ctx.translate(sx, sy);
              ctx.rotate(ang + (party.ropePullDir < 0 ? Math.PI : 0));
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2.6;
              ctx.beginPath();
              ctx.moveTo(-4, -5);
              ctx.lineTo(3, 0);
              ctx.lineTo(-4, 5);
              ctx.stroke();
              ctx.restore();
            }
          }
        }
        d += stepPx;
      }
      accum = d - segLen;
    }

    // 4. Mid-Span Heavy Brass Swivel Coupler (`中央黄铜万向转环扣`)
    if (totalApprox > 55 && midPt.x >= startWX - 40 && midPt.x <= endWX + 40) {
      ctx.save();
      ctx.translate(midPt.x, midPt.y);
      ctx.rotate(midPt.ang);
      ctx.fillStyle = '#d97706';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.roundRect(-12, -8, 24, 16, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(-6, -4.5, 12, 4.5);
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-6.5, 0, 2.3, 0, Math.PI * 2);
      ctx.arc(6.5, 0, 2.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Rival-end shackle & coil spring
    drawRopeEndCollar(ctx, nodes[N - 1], nodes[Math.max(0, N - 3)], tension);
    ctx.restore();
  }

  function renderWorldRivalAndVfx(ctx, startWX, endWX) {
    if (!party.active) return;
    const p = bridge.player;
    const fx = party.fx;
    const now = performance.now();

    // 0. Sculpted 2.5D 14-Node Verlet Distance-Tension Rope Tied Between Both Bikes!
    drawSculptedDampedRope(ctx, now, startWX, endWX);

    // 0B. Genshin Sprint Cyan-Gold Afterimage Ghosts (`疾驰残影`)!
    for (let i = 0; i < party.sprintGhosts.length; i++) {
      const g = party.sprintGhosts[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, (g.life / 0.24) * 0.42);
      drawSculptedBikeAndHero(ctx, g.heroId, g.x, g.y, g.angle, 0, 0, 0, {}, { scale: 0.98, rocketDash: true });
      ctx.restore();
    }

    // 1. Render Same-Track Live Rival Rider + Live Rival HP Bar!
    if (party.rival && party.rivalRender.hasData) {
      const rv = party.rival;
      const rr = party.rivalRender;
      if (rr.x >= startWX - 180 && rr.x <= endWX + 180) {
        const anim = rv.animState || {};
        ctx.save();
        ctx.fillStyle = 'rgba(236, 72, 153, 0.28)';
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(rr.x, rr.y - 2, 46, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        drawSculptedBikeAndHero(
          ctx,
          rv.heroId || 'ikun',
          rr.x,
          rr.y,
          rr.angle,
          rr.wheelAngle,
          rr.crankAngle,
          Math.sin(now * 0.015) * 2.5,
          {},
          {
            scale: 0.98,
            striking: Boolean(anim.striking),
            rocketDash: Boolean(rv.rocketActive)
          }
        );

        if (rv.shieldActive) {
          ctx.strokeStyle = '#facc15';
          ctx.fillStyle = 'rgba(250, 204, 21, 0.20)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(rr.x, rr.y - 54, 64, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (rv.oneHitShield) {
          ctx.strokeStyle = '#38bdf8';
          ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(rr.x, rr.y - 52, 60, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (anim.clamped) {
          drawModelOn(ctx, 'pelican_rig', rr.x, rr.y - 134, 0.1, 1.55);
        }
        if (anim.dizzy) {
          ctx.font = '900 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('💫💫', rr.x, rr.y - 134);
        }

        // Rival Overhead Live HP Bar (`100 HP`) + Nickname Pill!
        const hpPct = Math.max(0, Math.min(1, Number(rv.hp ?? 100) / 100));
        const hpW = 68;
        const hpY = rr.y - 122;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(rr.x - hpW / 2, hpY, hpW, 8, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = hpPct > 0.45 ? '#fb7185' : '#ef4444';
        ctx.beginPath();
        ctx.roundRect(rr.x - hpW / 2 + 1, hpY + 1, Math.max(3, (hpW - 2) * hpPct), 6, 3);
        ctx.fill();

        const tagY = rr.y - 140;
        ctx.font = '900 11.5px -apple-system, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        const label = `👾 ${rv.nickname}`;
        const tw = Math.max(68, ctx.measureText(label).width + 18);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.roundRect(rr.x - tw / 2, tagY - 12, tw, 21, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fbcfe8';
        ctx.fillText(label, rr.x, tagY + 3);

        if (rv.speech) {
          drawSpeechBubble(ctx, rr.x, tagY - 26, rv.speech, '#fde047');
        }
        ctx.restore();
      }
    }

    // 2. Blazing `🚀 背带窜天猴` Firework Thruster Plume & Genshin Wind-Shear Cone!
    if (fx.kunRocketTimer > 0 || party.staminaBoosting) {
      ctx.save();
      ctx.translate(p.x + 8, p.y - 48);
      const isKun = fx.kunRocketTimer > 0;
      ctx.fillStyle = isKun ? 'rgba(239, 68, 68, 0.88)' : 'rgba(56, 189, 248, 0.82)';
      ctx.beginPath();
      ctx.moveTo(-36, 4);
      ctx.lineTo(-175 - Math.sin(now * 0.06) * 34, -22);
      ctx.lineTo(-125, 6);
      ctx.lineTo(-182 - Math.cos(now * 0.06) * 34, 30);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isKun ? '#fde047' : '#a7f3d0';
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(-14, -62);
      ctx.quadraticCurveTo(92, 0, -14, 58);
      ctx.stroke();

      if (isKun) {
        drawModelOn(ctx, 'prop_rocket', -32, -16, 0.2, 1.25);
      }
      ctx.restore();
    }

    // 2B. Genshin-Style Curved Stamina Arc Floating Right Beside Your Rider!
    if (party.staminaShowAlpha > 0.04) {
      const ratio = Math.max(0, Math.min(1, party.stamina / 100));
      const trailRatio = Math.max(ratio, Math.min(1, party.staminaTrail / 100));
      const cx = p.x - 56;
      const cy = p.y - 62;
      const rArc = 36;
      const a0 = Math.PI * 0.68;
      const span = Math.PI * 0.64;
      ctx.save();
      ctx.globalAlpha = party.staminaShowAlpha;
      // Outer dark track
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.lineWidth = 8.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, rArc, a0, a0 + span, false);
      ctx.stroke();
      // White burn-down ghost trail
      if (trailRatio > ratio + 0.01) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, rArc, a0, a0 + span * trailRatio, false);
        ctx.stroke();
      }
      // Glowing emerald-gold -> crimson stamina fill
      ctx.strokeStyle = (party.staminaExhaustCd > 0 || ratio < 0.22)
        ? '#ef4444'
        : (party.staminaBoosting ? '#fde047' : '#4ade80');
      ctx.lineWidth = 5;
      if (ratio > 0.01) {
        ctx.beginPath();
        ctx.arc(cx, cy, rArc, a0, a0 + span * ratio, false);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2C. Exaggerated Attached Attack Models on Local Player (Stacked Frogs, Giant Bell, Rear-Biting Dog, Pelican, Cat Tornado)!
    if (fx.naiwaPileTimer > 0) {
      const hop = Math.abs(Math.sin(now * 0.018)) * 9;
      drawModelOn(ctx, 'naiwa_rig', p.x - 16, p.y - 82 - hop, -0.18, 0.72);
      drawModelOn(ctx, 'mob_frog', p.x + 18, p.y - 78 - hop * 0.7, 0.2, 0.78);
      drawModelOn(ctx, 'boss_naiwa', p.x + 2, p.y - 118 - hop * 1.2, Math.sin(now * 0.02) * 0.14, 0.72);
    }
    if (fx.bellCrushTimer > 0) {
      // Huge Bronze Bell covering the flattened rider + rippling golden soundwaves!
      drawModelOn(ctx, 'bronzeBell', p.x + 2, p.y - 44, Math.sin(now * 0.05) * 0.08, 2.05);
      ctx.save();
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.75)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(p.x + 2, p.y - 44, 48 + ((now * 0.18) % 55), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (fx.dagouBiteTimer > 0) {
      // Giant Chomping Dog clamped onto rear tire!
      drawModelOn(ctx, 'boss_dagou', p.x - 62, p.y - 36 + Math.sin(now * 0.04) * 6, 0.08, 0.95);
    }
    if (fx.maodieDizzyTimer > 0) {
      for (let m = 0; m < 3; m++) {
        const ma = now * 0.015 + m * 2.1;
        drawModelOn(ctx, 'mini_maodie', p.x + Math.cos(ma) * 52, p.y - 52 + Math.sin(ma) * 28, ma, 0.78);
      }
    }

    // 2D. Shields, Pelican Carry & Speech Bubbles
    if (fx.oneHitShieldTimer > 0) {
      const ratio = Math.max(0.03, Math.min(1, fx.oneHitShieldTimer / Math.max(1, fx.oneHitShieldMax || 7)));
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x + 2, p.y - 52, 62 + Math.sin(now * 0.018) * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x + 2, p.y - 52, 63, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
      ctx.stroke();
      drawModelOn(ctx, 'prop_shield', p.x + Math.cos(-now * 0.007) * 62, p.y - 50 + Math.sin(-now * 0.007) * 40, 0, 0.55);
      ctx.restore();
    }

    if (fx.panShieldTimer > 0) {
      ctx.save();
      ctx.strokeStyle = '#facc15';
      ctx.fillStyle = 'rgba(250, 204, 21, 0.22)';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(p.x + 2, p.y - 54, 68 + Math.sin(now * 0.02) * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '900 22px sans-serif';
      ctx.textAlign = 'center';
      const orbitA = now * 0.008;
      ctx.fillText('🥘', p.x + Math.cos(orbitA) * 66, p.y - 52 + Math.sin(orbitA) * 44);
      ctx.restore();
    }

    if (fx.respawnTimer > 0 || fx.pelicanClampedTimer > 0) {
      drawModelOn(ctx, 'pelican_rig', p.x + 4, p.y - 78 + Math.sin(now * 0.025) * 6, 0.08, 1.65);
    }

    if (fx.mySpeechTimer > 0 && fx.mySpeech) {
      drawSpeechBubble(ctx, p.x + 8, p.y - 148, fx.mySpeech, '#4ade80');
    }

    // 3. Sculpted 2.5D Chaos Projectiles (Bouncing Naiwa Frogs, Roaring Dump Trucks, Chomping Dogs, Cats, Giant Bells)!
    for (let i = 0; i < party.chaosProjectiles.length; i++) {
      const cp = party.chaosProjectiles[i];
      if (cp.x < startWX - 160 || cp.x > endWX + 160) continue;
      if (cp.kind === 'truck') {
        ctx.save();
        ctx.fillStyle = 'rgba(254, 240, 138, 0.42)';
        ctx.beginPath();
        ctx.moveTo(cp.x + 56, cp.y - 6);
        ctx.lineTo(cp.x + 240, cp.y - 46);
        ctx.lineTo(cp.x + 240, cp.y + 32);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      drawModelOn(ctx, cp.sprite, cp.x, cp.y, cp.rot, cp.scale);
    }

    // 3B. Curved 5-Lash Purple-Gold Whip Arcs (`party.whipArcs`)
    for (let i = 0; i < party.whipArcs.length; i++) {
      const wa = party.whipArcs[i];
      const ox = wa.owner === 'rival' ? party.rivalRender.x : p.x;
      const oy = (wa.owner === 'rival' ? party.rivalRender.y : p.y) - 52;
      const u = 1 - wa.life / wa.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - u);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox + 12, oy);
      ctx.bezierCurveTo(ox + 95, oy - 75 + (wa.idx % 2) * 95, ox + 175, oy + 55 - (wa.idx % 2) * 85, ox + 265 * (0.45 + u * 0.65), oy - 12);
      ctx.stroke();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.8;
      ctx.stroke();
      ctx.restore();
    }

    // 3C. Floating Attacker Hitmarkers (`🎯 暴击!`)
    for (let i = 0; i < party.hitMarkers.length; i++) {
      const hm = party.hitMarkers[i];
      const hx = hm.target === 'rival' && party.rivalRender.hasData ? party.rivalRender.x : p.x;
      const hy = (hm.target === 'rival' && party.rivalRender.hasData ? party.rivalRender.y : p.y) - 156 - (1 - hm.life) * 28;
      ctx.save();
      ctx.font = '900 16px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4;
      ctx.strokeText(hm.text, hx, hy);
      ctx.fillStyle = hm.color || '#fde047';
      ctx.fillText(hm.text, hx, hy);
      ctx.restore();
    }

    // 3. Raining Giant Basketballs (`🏀 鸡你太美篮球雨`)
    for (let i = 0; i < party.visualBballs.length; i++) {
      const bb = party.visualBballs[i];
      const baseX = bb.target === 'rival' ? party.rivalRender.x : p.x;
      drawSpaldingWheelOn(ctx, baseX + bb.offX, bb.y, 30, bb.rot);
    }

    // 4. Manbo Pink Sonic Waves (`🐴 曼波魔音偷速波`)
    for (let i = 0; i < party.sonicWaves.length; i++) {
      const sw = party.sonicWaves[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, sw.life / 0.55);
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, Math.max(8, sw.r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '900 18px sans-serif';
      ctx.fillStyle = '#f472b6';
      ctx.fillText('🎵曼波~', sw.x + sw.r * 0.65, sw.y - sw.r * 0.55);
      ctx.restore();
    }

    // 5. Lightning Whip Bolts (`⚡ 不讲武德闪电鞭`)
    for (let i = 0; i < party.lightningBolts.length; i++) {
      const lb = party.lightningBolts[i];
      const tx = lb.target === 'rival' ? party.rivalRender.x : p.x;
      const ty = lb.target === 'rival' ? party.rivalRender.y : p.y;
      ctx.save();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(tx - 24, ty - 340);
      ctx.lineTo(tx + 18, ty - 220);
      ctx.lineTo(tx - 16, ty - 140);
      ctx.lineTo(tx + 14, ty - 75);
      ctx.lineTo(tx, ty - 20);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // 6. Finish Line Confetti
    for (let i = 0; i < party.confetti.length; i++) {
      const cf = party.confetti[i];
      ctx.save();
      ctx.translate(cf.x, cf.y);
      ctx.rotate(cf.rot);
      ctx.fillStyle = cf.col;
      ctx.fillRect(-5, -3, 10, 6);
      ctx.restore();
    }

    // 7. Long-Range Homing Missiles + Lock-On Target Reticles (`🎯`)!
    for (let i = 0; i < party.homingMissiles.length; i++) {
      const hm = party.homingMissiles[i];
      const tx = hm.target === 'me'
        ? p.x
        : (party.rivalRender.hasData ? party.rivalRender.x : p.x + 420);
      const ty = hm.target === 'me'
        ? (p.y - 48)
        : (party.rivalRender.hasData ? (party.rivalRender.y - 48) : (p.y - 48));

      // Pulsing Red Lock-On Crosshair on Target
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(now * 0.008);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, 44 + Math.sin(now * 0.03) * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(-54, 0); ctx.lineTo(-34, 0);
      ctx.moveTo(34, 0); ctx.lineTo(54, 0);
      ctx.moveTo(0, -54); ctx.lineTo(0, -34);
      ctx.moveTo(0, 34); ctx.lineTo(0, 54);
      ctx.stroke();
      ctx.restore();

      // Dashed Homing Trajectory Laser Line + Glowing Rocket Trail
      ctx.save();
      ctx.strokeStyle = hm.color || '#f97316';
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(hm.curX, hm.curY);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Glowing Warhead Pod + Meme Icon
      ctx.translate(hm.curX, hm.curY);
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = hm.color || '#fde047';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '900 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hm.ico || '🚀', 0, 1);
      ctx.restore();
    }
  }

  function drawSpeechBubble(ctx, cx, cy, text, borderCol) {
    ctx.save();
    ctx.font = '900 11.5px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    const w = Math.max(84, ctx.measureText(text).width + 20);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = borderCol || '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - 15, w, 24, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.fillText(text, cx, cy + 1);
    ctx.restore();
  }

  // Post-Player Foreground Hardware: Local Bike's Forged Steel Rope Collar + Stretching Coil Spring!
  function renderWorldPostPlayer(ctx) {
    if (!party.active || !party.rival || !party.rivalRender.hasData) return;
    const nodes = party.ropeNodes;
    if (nodes && nodes.length >= 4) {
      drawRopeEndCollar(ctx, nodes[0], nodes[2], party.ropeTensionRatio);
    }
  }

  // Real-Time 60FPS Top-Right Rival Picture-in-Picture Camera + Prominent Rival HP Bar!
  function renderRivalLivePipAndHp(ctx, W, H) {
    if (!party.active || !party.rival || !party.rivalRender.hasData) return;
    const rv = party.rival;
    const rr = party.rivalRender;
    const p = bridge.player;
    const w = bridge.getWorldArrays();
    const now = performance.now();
    const anim = rv.animState || {};

    const pipW = Math.min(182, Math.max(146, Math.round(W * 0.33)));
    const viewH = Math.round(pipW * 0.54);
    const hdrH = 18;
    const hpH = 17;
    const totalH = hdrH + viewH + hpH;
    const px = W - pipW - 10;
    const py = 132;

    ctx.save();
    // Outer Armored Monitor Bezel
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = party.rivalHitFlash > 0 ? '#fde047' : '#ec4899';
    ctx.lineWidth = party.rivalHitFlash > 0 ? 3.2 : 2.4;
    ctx.beginPath();
    ctx.roundRect(px, py, pipW, totalH, 12);
    ctx.fill();
    ctx.stroke();

    // 1. Top LIVE Header (`● 实况 · 昵称 +XXm`)
    const pulseOn = Math.floor(now / 380) % 2 === 0;
    ctx.fillStyle = pulseOn ? '#ef4444' : '#991b1b';
    ctx.beginPath();
    ctx.arc(px + 11, py + 9.5, 4, 0, Math.PI * 2);
    ctx.fill();

    const deltaM = Math.round((rr.x - p.x) / 18);
    const gapStr = `${deltaM >= 0 ? '+' : ''}${deltaM}m`;
    const shortNick = String(rv.nickname || '对手').slice(0, 6);
    ctx.font = '900 10.5px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`实况·${getHeroIcon(rv.heroId)}${shortNick}`, px + 19, py + 9.5);
    ctx.textAlign = 'right';
    ctx.fillStyle = deltaM >= 0 ? '#fda4af' : '#86efac';
    ctx.fillText(gapStr, px + pipW - 7, py + 9.5);

    // 2. Clipped 60FPS Real-Time Rival World Camera Viewport!
    const vx0 = px + 3;
    const vy0 = py + hdrH;
    const vw = pipW - 6;
    const vh = viewH;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(vx0, vy0, vw, vh, 6);
    ctx.clip();

    const stages = bridge.getStages ? bridge.getStages() : null;
    const stgIdx = bridge.getStageIndex ? bridge.getStageIndex() : 0;
    const stg = stages && stages[stgIdx] ? stages[stgIdx] : { skyTop: '#0ea5e9', skyBot: '#fef08a', road: '#334155' };
    ctx.fillStyle = stg.skyTop || '#0ea5e9';
    ctx.fillRect(vx0, vy0, vw, vh * 0.56);
    ctx.fillStyle = stg.skyBot || '#bae6fd';
    ctx.fillRect(vx0, vy0 + vh * 0.56, vw, vh * 0.44);

    // Sub-camera world transform centered on rival!
    const subZoom = 0.36;
    const focusWX = rr.x + 42;
    const focusWY = rr.y - 46;
    const subStartWX = focusWX - (vw / subZoom) * 0.55 - 80;
    const subEndWX = focusWX + (vw / subZoom) * 0.65 + 80;

    ctx.translate(vx0 + vw * 0.40, vy0 + vh * 0.68);
    ctx.scale(subZoom, subZoom);
    ctx.translate(-focusWX, -focusWY);

    // Terrain road polygon + pits inside rival's camera view
    ctx.fillStyle = stg.road || '#334155';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    let firstPt = true;
    for (let wx = Math.floor(subStartWX / 28) * 28; wx <= subEndWX; wx += 28) {
      let inPit = false;
      for (let k = 0; k < w.pits.length; k++) {
        const pt = w.pits[k];
        if (!pt.bridged && wx > pt.x && wx < pt.x + pt.len) { inPit = true; break; }
      }
      const gy = inPit ? (getSurfaceY(wx) + 220) : getSurfaceY(wx);
      if (firstPt) { ctx.moveTo(wx, gy + 260); ctx.lineTo(wx, gy); firstPt = false; }
      else ctx.lineTo(wx, gy);
    }
    ctx.lineTo(subEndWX, getSurfaceY(subEndWX) + 260);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Elevated Skyrails in rival's view
    for (let i = 0; i < w.rails.length; i++) {
      const rl = w.rails[i];
      if (rl.x + rl.len < subStartWX || rl.x > subEndWX) continue;
      ctx.strokeStyle = rl.kind === 'maglev' ? '#38bdf8' : '#f8fafc';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(rl.x, getSurfaceY(rl.x) - rl.hOff);
      ctx.lineTo(rl.x + rl.len, getSurfaceY(rl.x + rl.len) - rl.hOff);
      ctx.stroke();
    }

    // Aerial Boost Rings & Crates in rival's view
    for (let i = 0; i < party.boostRings.length; i++) {
      const rg = party.boostRings[i];
      if (rg.x >= subStartWX && rg.x <= subEndWX) drawSculptedBoostRing(ctx, rg, now);
    }
    for (let i = 0; i < party.crates.length; i++) {
      const cr = party.crates[i];
      if (!cr.taken && cr.x >= subStartWX && cr.x <= subEndWX) {
        ctx.fillStyle = '#7c3aed';
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 4;
        ctx.fillRect(cr.x - 18, cr.y - 18, 36, 36);
        ctx.strokeRect(cr.x - 18, cr.y - 18, 36, 36);
      }
    }

    // Track Obstacles & Enemies in rival's view
    for (let i = 0; i < w.laserGates.length; i++) {
      const lg = w.laserGates[i];
      if (!lg.hacked && lg.x >= subStartWX && lg.x <= subEndWX) {
        const gy = getSurfaceY(lg.x);
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(lg.x, gy - 8); ctx.lineTo(lg.x, gy - 72); ctx.stroke();
      }
    }
    for (let i = 0; i < w.cashTrucks.length; i++) {
      const ct = w.cashTrucks[i];
      if (!ct.dead && ct.x >= subStartWX && ct.x <= subEndWX) {
        drawModelOn(ctx, 'cashTruck', ct.x, ct.y - 34, 0, 1.0);
      }
    }
    if (bridge.getEnemySpriteKey) {
      for (let i = 0; i < w.enemies.length; i++) {
        const en = w.enemies[i];
        if (!en.hit && en.x >= subStartWX && en.x <= subEndWX) {
          const ey = getSurfaceY(en.x) - (en.flyH || 0);
          drawModelOn(ctx, bridge.getEnemySpriteKey(en.kind), en.x, ey - 28, 0, 1.0);
        }
      }
    }

    // Sculpted 3D Rope + Local Player if inside rival's camera frame!
    drawSculptedDampedRope(ctx, now, subStartWX, subEndWX);
    if (p.x >= subStartWX - 40 && p.x <= subEndWX + 40) {
      drawSculptedBikeAndHero(
        ctx,
        bridge.store.save.selectedHero || 'nailong',
        p.x,
        p.y,
        p.angle,
        p.wheelAngle,
        p.crankAngle,
        0,
        {},
        { scale: 0.96, rocketDash: party.staminaBoosting || party.fx.kunRocketTimer > 0 }
      );
    }

    // Live Rival Sculpted Bike & Hero + Real-Time Cartoon Hit Deformations & Sprint Plume!
    if (rv.rocketActive || anim.staminaBoost) {
      ctx.fillStyle = rv.rocketActive ? 'rgba(239, 68, 68, 0.85)' : 'rgba(56, 189, 248, 0.82)';
      ctx.beginPath();
      ctx.moveTo(rr.x - 24, rr.y - 42);
      ctx.lineTo(rr.x - 145, rr.y - 62);
      ctx.lineTo(rr.x - 145, rr.y - 20);
      ctx.closePath();
      ctx.fill();
    }

    ctx.save();
    let extraRot = 0;
    if (anim.toonBell) {
      ctx.translate(rr.x, rr.y + 6);
      ctx.scale(1.62, 0.38);
      ctx.translate(-rr.x, -rr.y);
    } else if (anim.toonTruck) {
      extraRot = now * 0.018;
    } else if (anim.clamped) {
      extraRot = Math.PI * 0.88 + Math.sin(now * 0.018) * 0.3;
    } else if (anim.toonNaiwa) {
      ctx.translate(rr.x, rr.y + 4);
      ctx.scale(1.22, 0.76);
      ctx.translate(-rr.x, -rr.y);
    }
    drawSculptedBikeAndHero(
      ctx,
      rv.heroId || 'ikun',
      rr.x,
      rr.y,
      rr.angle + extraRot,
      rr.wheelAngle,
      rr.crankAngle,
      Math.sin(now * 0.016) * 2.5,
      {},
      {
        scale: 1.0,
        striking: Boolean(anim.striking),
        rocketDash: Boolean(rv.rocketActive || anim.staminaBoost)
      }
    );
    ctx.restore();

    if (anim.toonBell) drawModelOn(ctx, 'bronzeBell', rr.x, rr.y - 44, 0, 1.95);
    if (anim.toonNaiwa) drawModelOn(ctx, 'boss_naiwa', rr.x, rr.y - 108, 0, 0.72);
    if (anim.toonDagou) drawModelOn(ctx, 'boss_dagou', rr.x - 58, rr.y - 34, 0.08, 0.92);
    if (anim.clamped) drawModelOn(ctx, 'pelican_rig', rr.x, rr.y - 130, 0.1, 1.5);
    if (rv.oneHitShield || rv.shieldActive) {
      ctx.strokeStyle = rv.oneHitShield ? '#38bdf8' : '#facc15';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(rr.x, rr.y - 50, 62, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < party.chaosProjectiles.length; i++) {
      const cp = party.chaosProjectiles[i];
      if (cp.x >= subStartWX && cp.x <= subEndWX) {
        drawModelOn(ctx, cp.sprite, cp.x, cp.y, cp.rot, cp.scale);
      }
    }
    ctx.restore(); // End clipped sub-camera

    // 3. Prominent Real-Time Rival HP Bar Strip (`❤️ XX / 100 HP`)!
    const hpVal = Math.max(0, Math.min(100, Math.round(Number(rv.hp ?? 100))));
    const hpRatio = hpVal / 100;
    const trailRatio = Math.max(hpRatio, Math.min(1, (party.rivalTrailHp || hpVal) / 100));
    const bx0 = px + 5;
    const by0 = py + hdrH + viewH + 2;
    const bw = pipW - 10;
    const bh = hpH - 4;

    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.roundRect(bx0, by0, bw, bh, 6);
    ctx.fill();

    if (trailRatio > hpRatio + 0.005) {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.roundRect(bx0 + 1, by0 + 1, Math.max(2, (bw - 2) * trailRatio), bh - 2, 5);
      ctx.fill();
    }
    ctx.fillStyle = party.rivalHitFlash > 0 ? '#fde047' : (hpVal > 45 ? '#f43f5e' : '#dc2626');
    if (hpRatio > 0.005) {
      ctx.beginPath();
      ctx.roundRect(bx0 + 1, by0 + 1, Math.max(4, (bw - 2) * hpRatio), bh - 2, 5);
      ctx.fill();
    }
    ctx.font = '900 10px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(anim.koCrawl ? '💀 击倒龟速中!' : `❤️ 对手 ${hpVal}/100`, bx0 + bw / 2, by0 + bh / 2 + 0.5);
    ctx.restore();
  }

  // Screen-Space Rival Live PiP Monitor + Crisp Off-Screen Rival Edge Indicator
  function renderScreenEdgeIndicators(ctx, cam, W, H) {
    if (!party.active || !party.rival || !party.rivalRender.hasData) return;

    // Always render Real-Time 60FPS Rival PiP Window + Prominent Rival HP Bar in top-right corner!
    renderRivalLivePipAndHp(ctx, W, H);

    const rr = party.rivalRender;
    const rv = party.rival;
    const screenX = (rr.x - cam.camX) * cam.worldScale;
    if (screenX >= 28 && screenX <= W - 28) return; // Rival is visible on main screen!

    const p = bridge.player;
    const deltaM = Math.round((rr.x - p.x) / 18);
    const isAhead = deltaM >= 0;
    const ico = getHeroIcon(rv.heroId);
    const shortNick = String(rv.nickname || '对手').slice(0, 6);
    const hitActive = party.rivalEdgeHitFlash > 0 && party.rivalEdgeHitTxt;
    const label = hitActive
      ? `${party.rivalEdgeHitTxt} (${deltaM >= 0 ? '+' : ''}${deltaM}m)`
      : (isAhead
        ? `${ico} ${shortNick} +${Math.max(1, deltaM)}m ▶`
        : `◀ ${ico} ${shortNick} ${Math.min(-1, deltaM)}m`);

    ctx.save();
    ctx.font = '900 12px -apple-system, "PingFang SC", sans-serif';
    const pw = Math.max(118, ctx.measureText(label).width + 22);
    const px = isAhead ? (W - pw - 12) : 12;
    const py = Math.min(H * 0.58, Math.max(268, H * 0.48));

    ctx.fillStyle = hitActive ? 'rgba(127, 29, 29, 0.95)' : 'rgba(15, 23, 42, 0.90)';
    ctx.strokeStyle = hitActive ? '#fde047' : (isAhead ? '#ec4899' : '#38bdf8');
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, 28, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isAhead ? '#fbcfe8' : '#bae6fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + pw / 2, py + 14);
    ctx.restore();
  }

  // ==================== LOBBY & READY-SCREEN HERO PICKER + ACCOUNT GUARD ====================
  function refreshPartyAccountBadge() {
    if (!partyAccountBadge) return;
    const uname = bridge.store.auth && bridge.store.auth.username;
    partyAccountBadge.textContent = uname ? `👤 账号:${uname}` : '👤 游客模式';
  }

  function selectPartyHero(heroId) {
    if (!HEROES.some((h) => h.id === heroId)) return;
    ensureAudio();
    bridge.store.save.selectedHero = heroId;
    bridge.store.markMutatedAndSave(false);
    if (bridge.refreshHubUI) bridge.refreshHubUI();
    if (bridge.playHeroSelectVoice) bridge.playHeroSelectVoice(heroId);
    else playSfx('crate');
    renderHeroPickersUI();
    if (partyWaitMeIco) partyWaitMeIco.textContent = getHeroIcon(heroId);

    // Sync live hero switch to waiting room or podium room immediately!
    if (party.roomCode && (party.status === 'waiting' || party.status === 'finished')) {
      fetch('/api/party/set_hero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: party.roomCode,
          playerId,
          heroId,
          nickname: getDesiredNickname()
        })
      }).catch(() => {});
    }
  }

  const HERO_SHORT_NAMES = {
    nailong: '奶龙',
    ikun: '阿坤',
    pelican: '鹈鹕',
    naiwa: '奶蛙',
    hakimi: '哈基米'
  };

  function renderHeroPickersUI() {
    const curHero = bridge.store.save.selectedHero || 'nailong';
    for (const container of [partyHeroPicker, partyPodiumHeroPicker]) {
      if (!container) continue;
      container.innerHTML = '';
      for (const h of HEROES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `party-hpill ${h.id === curHero ? 'active' : ''}`;
        btn.dataset.hero = h.id;
        const shortNm = HERO_SHORT_NAMES[h.id] || h.name.slice(0, 3);
        btn.innerHTML = `<span class="php-ico">${h.icon}</span><span class="php-nm">${shortNm}</span>`;
        btn.addEventListener('click', () => selectPartyHero(h.id));
        container.appendChild(btn);
      }
    }
  }

  function openLobbyModal() {
    ensureAudio();
    playSfx('crate');
    refreshPartyAccountBadge();
    renderHeroPickersUI();
    if (partyNickInp && !partyNickInp.value) {
      let savedNick = '';
      try { savedNick = localStorage.getItem(PARTY_NICK_KEY) || ''; } catch (_) {}
      partyNickInp.value = (bridge.store.auth && bridge.store.auth.username) || savedNick || '';
    }
    if (partyLobbyEntryView) partyLobbyEntryView.classList.remove('hidden-block');
    if (partyLobbyWaitView) partyLobbyWaitView.classList.add('hidden-block');
    if (partyLobbyOverlay) partyLobbyOverlay.classList.remove('hidden');
  }

  function flushLeaveBeacon() {
    if (!party.roomCode) return;
    const payload = JSON.stringify({ roomCode: party.roomCode, playerId });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/party/leave', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/party/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function closeLobbyModal() {
    if (party.status === 'waiting' && party.roomCode) {
      leaveWaitingRoomSilently();
    }
    clearPartyTimers();
    if (partyLobbyOverlay) partyLobbyOverlay.classList.add('hidden');
  }

  function leaveWaitingRoomSilently() {
    const code = party.roomCode;
    party.roomCode = '';
    party.status = 'idle';
    if (code) {
      fetch('/api/party/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: code, playerId }),
        keepalive: true
      }).catch(() => {});
    }
  }

  function startWaitingRoomPoll() {
    clearPartyTimers();
    waitPollTimer = setInterval(async () => {
      if (!party.roomCode || party.status !== 'waiting') return;
      try {
        const curHero = bridge.store.save.selectedHero || 'nailong';
        const resp = await fetch(`/api/party/room?roomCode=${encodeURIComponent(party.roomCode)}&playerId=${encodeURIComponent(playerId)}&heroId=${encodeURIComponent(curHero)}`);
        const data = await resp.json();
        if (resp.ok && data && data.ok) {
          applyLobbySnapshot(data);
        }
      } catch (_) {}
    }, 450);
  }

  async function callPartyLobbyApi(endpoint, extraBody = {}) {
    if (lobbyBusy) return null;
    lobbyBusy = true;
    ensureAudio();
    const authToken = (bridge.store.auth && bridge.store.auth.token) || '';
    const authUser = (bridge.store.auth && bridge.store.auth.username) || '';
    const hdrs = { 'Content-Type': 'application/json' };
    if (authToken) hdrs['Authorization'] = `Bearer ${authToken}`;
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({
          playerId,
          token: authToken,
          authUser,
          nickname: getDesiredNickname(),
          heroId: bridge.store.save.selectedHero || 'nailong',
          raceDist: 3500,
          ...extraBody
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok) {
        bridge.showToast(`⚠️ ${(data && data.error) || '联机请求失败，请重试'}`);
        return null;
      }
      return data;
    } catch (_) {
      bridge.showToast('⚠️ 网络连接异常，请确认服务运行正常');
      return null;
    } finally {
      lobbyBusy = false;
    }
  }

  async function handleCreateRoom() {
    const data = await callPartyLobbyApi('/api/party/create');
    if (!data) return;
    playSfx('crate');
    if (partyLobbyEntryView) partyLobbyEntryView.classList.add('hidden-block');
    if (partyLobbyWaitView) partyLobbyWaitView.classList.remove('hidden-block');
    applyLobbySnapshot(data);
    startWaitingRoomPoll();
  }

  async function handleQuickMatch() {
    const data = await callPartyLobbyApi('/api/party/quickmatch');
    if (!data) return;
    playSfx('crate');
    if (data.status === 'waiting') {
      if (partyLobbyEntryView) partyLobbyEntryView.classList.add('hidden-block');
      if (partyLobbyWaitView) partyLobbyWaitView.classList.remove('hidden-block');
      applyLobbySnapshot(data);
      startWaitingRoomPoll();
    } else {
      applyLobbySnapshot(data);
    }
  }

  async function handleJoinRoom() {
    const code = partyJoinCodeInp ? String(partyJoinCodeInp.value || '').replace(/\D/g, '').slice(0, 4) : '';
    if (code.length !== 4) {
      bridge.showToast('✏️ 请输入 4 位数字房间号！');
      if (partyJoinCodeInp) partyJoinCodeInp.focus();
      return;
    }
    const data = await callPartyLobbyApi('/api/party/join', { roomCode: code });
    if (!data) return;
    playSfx('crate');
    applyLobbySnapshot(data);
  }

  async function handleInstantBotStart() {
    // 1-tap solo test: create room + add smart meme AI rival immediately!
    const created = await callPartyLobbyApi('/api/party/create');
    if (!created) return;
    party.roomCode = created.roomCode;
    const withBot = await callPartyLobbyApi('/api/party/add_bot', { roomCode: created.roomCode });
    if (!withBot) return;
    playSfx('crate');
    applyLobbySnapshot(withBot);
  }

  async function handleWaitRoomAddBot() {
    if (!party.roomCode) return;
    const data = await callPartyLobbyApi('/api/party/add_bot', { roomCode: party.roomCode });
    if (!data) return;
    playSfx('crate');
    applyLobbySnapshot(data);
  }

  async function handleRematch() {
    ensureAudio();
    if (!party.roomCode || party.roomPlayerCount < 2) {
      exitPartyToHub();
      openLobbyModal();
      return;
    }
    const data = await callPartyLobbyApi('/api/party/rematch', { roomCode: party.roomCode });
    if (!data) {
      exitPartyToHub();
      openLobbyModal();
      return;
    }
    playSfx('crate');
    if (Array.isArray(data.rematchVotes)) party.rematchVotes = data.rematchVotes;
    if (typeof data.playerCount === 'number') party.roomPlayerCount = data.playerCount;
    if (data.status === 'countdown' || data.status === 'racing') {
      clearPartyTimers();
      launchPartyRaceSession(data);
    } else if (data.status === 'finished') {
      // Waiting for the 2nd player to also click Agree (1/2)!
      updateRematchButtonUI();
      startPodiumConsentPoll();
    } else {
      exitPartyToHub();
      openLobbyModal();
      if (partyLobbyEntryView) partyLobbyEntryView.classList.add('hidden-block');
      if (partyLobbyWaitView) partyLobbyWaitView.classList.remove('hidden-block');
      applyLobbySnapshot(data);
      startWaitingRoomPoll();
    }
  }

  function exitPartyToHub() {
    if (party.roomCode) {
      fetch('/api/party/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: party.roomCode, playerId }),
        keepalive: true
      }).catch(() => {});
    }
    clearPartyTimers();
    party.active = false;
    party.roomCode = '';
    party.status = 'idle';
    party.slots = [null, null];
    party.ropePullVx = 0;
    setHudPartyVisibility(false);
    if (partyPodiumOverlay) partyPodiumOverlay.classList.add('hidden');
    if (partyLobbyOverlay) partyLobbyOverlay.classList.add('hidden');
    bridge.returnToHubFromParty();
  }

  // Bind UI Events
  if (partyOpenBtn) partyOpenBtn.addEventListener('click', openLobbyModal);
  if (partyLobbyCloseBtn) partyLobbyCloseBtn.addEventListener('click', closeLobbyModal);
  if (partyLobbyOverlay) {
    partyLobbyOverlay.addEventListener('click', (e) => {
      if (e.target === partyLobbyOverlay) closeLobbyModal();
    });
  }
  if (partyCreateRoomBtn) partyCreateRoomBtn.addEventListener('click', handleCreateRoom);
  if (partyQuickMatchBtn) partyQuickMatchBtn.addEventListener('click', handleQuickMatch);
  if (partyJoinRoomBtn) partyJoinRoomBtn.addEventListener('click', handleJoinRoom);
  if (partyJoinCodeInp) {
    partyJoinCodeInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleJoinRoom();
    });
  }
  if (partyInstantBotBtn) partyInstantBotBtn.addEventListener('click', handleInstantBotStart);
  if (partyWaitAddBotBtn) partyWaitAddBotBtn.addEventListener('click', handleWaitRoomAddBot);
  if (partyLeaveRoomBtn) {
    partyLeaveRoomBtn.addEventListener('click', () => {
      leaveWaitingRoomSilently();
      clearPartyTimers();
      if (partyLobbyWaitView) partyLobbyWaitView.classList.add('hidden-block');
      if (partyLobbyEntryView) partyLobbyEntryView.classList.remove('hidden-block');
    });
  }
  if (partyCopyCodeBtn) {
    partyCopyCodeBtn.addEventListener('click', () => {
      if (!party.roomCode) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(party.roomCode).catch(() => {});
      }
      playSfx('crate');
      bridge.showToast(`📋 已复制房间号：${party.roomCode}，快发给好友输入吧！`);
    });
  }

  if (slotEls[0].btn) {
    slotEls[0].btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      useItemSlot(0);
    });
  }
  if (slotEls[1].btn) {
    slotEls[1].btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      useItemSlot(1);
    });
  }

  if (partyStaminaBtn) {
    const startHold = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (partyStaminaBtn.setPointerCapture && e.pointerId !== undefined) {
        try { partyStaminaBtn.setPointerCapture(e.pointerId); } catch (_) {}
      }
      party.staminaHeld = true;
    };
    const stopHold = (e) => {
      if (e) e.preventDefault();
      party.staminaHeld = false;
    };
    partyStaminaBtn.addEventListener('pointerdown', startHold);
    partyStaminaBtn.addEventListener('pointerup', stopHold);
    partyStaminaBtn.addEventListener('pointercancel', stopHold);
  }

  if (partyRematchBtn) partyRematchBtn.addEventListener('click', handleRematch);
  if (partyPodiumHubBtn) partyPodiumHubBtn.addEventListener('click', exitPartyToHub);

  function onPartyBossDefeated() {
    if (!party.active) return;
    party.fx.roadPadBoostTimer = Math.max(party.fx.roadPadBoostTimer, 1.9);
    grantMysteryBoxItem();
    const p = bridge.player;
    bridge.addPopup('🏆 首领击破! +加速', p.x + 20, p.y - 118, '#fde047', 20);
    bridge.refreshBuffChips();
  }

  function getCameraFramingHint() {
    if (!party.active || !party.rival || !party.rivalRender.hasData) return null;
    const p = bridge.player;
    const dx = party.rivalRender.x - p.x;
    const fast = party.staminaBoosting || party.fx.ddjRushTimer > 0 || party.fx.whipBoostTimer > 0;
    if (dx >= -290 && dx < -15) {
      // Rival right behind us -> shift player slightly right so we see rival + rope behind us!
      return { ratio: 0.30, zoom: 0.91 };
    }
    if (dx >= -15 && dx <= 640) {
      // Rival neck-and-neck or tethered ahead -> frame both bikes & the 3D rope cleanly!
      return { ratio: fast ? 0.24 : 0.19, zoom: 0.90 };
    }
    return fast ? { ratio: 0.26, zoom: 0.92 } : null;
  }

  return {
    isActive: () => party.active,
    isModalOpen: () => Boolean(
      (partyLobbyOverlay && !partyLobbyOverlay.classList.contains('hidden'))
      || (partyPodiumOverlay && !partyPodiumOverlay.classList.contains('hidden'))
    ),
    closeModalsOnEsc: () => {
      if (partyLobbyOverlay && !partyLobbyOverlay.classList.contains('hidden')) closeLobbyModal();
    },
    setStaminaHeld: (v) => { party.staminaHeld = Boolean(v); },
    getSurfaceY,
    getSpeedMultiplier,
    getRopeSpeedDelta: () => (party.active ? (party.ropePullVx || 0) : 0),
    getExtraBuffLabels,
    getPlayerCartoonTransform,
    getCameraFramingHint,
    tryConsumeOneHitShield,
    tryMeleeShoulderBump,
    tryHitRivalWithHeroSkill,
    triggerPartyPlayerKO,
    triggerPelicanRescue,
    onPartyBossDefeated,
    useItemSlot,
    hasItemInSlot: (idx) => Boolean(party.slots[idx]),
    updatePartyFrame,
    renderWorldTrackExtras,
    renderWorldRivalAndVfx,
    renderWorldPostPlayer,
    renderScreenEdgeIndicators,
    flushLeaveBeacon,
    exitPartyToHub,
    getDizzyAngleOffset: () => 0,
    isPureKunRocket: () => party.fx.kunRocketTimer > 0,
    isHighSpeedBoost: () => (
      party.staminaBoosting
      || party.fx.ddjRushTimer > 0
      || party.fx.whipBoostTimer > 0
      || party.fx.spicyDashTimer > 0
      || party.fx.beanNitroTimer > 0
      || party.aliveStreakSec >= 12
    ),
    isKunRocketActive: () => (
      party.fx.kunRocketTimer > 0
      || party.staminaBoosting
      || party.fx.ddjRushTimer > 0
      || party.fx.spicyDashTimer > 0
      || party.fx.beanNitroTimer > 0
    )
  };
}
