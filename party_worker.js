
let partyTableInitialized = false;
const PARTY_COUNTDOWN_MS = 3200;
const PARTY_ROOM_IDLE_TTL_MS = 900000;
const PARTY_CORE_MODULES = [
  'ikun_trampoline', 'canyon_skyrail', 'truck_gauntlet', 'wave_coaster',
  'split_decker', 'maodie_ambush', 'mega_vault', 'narrow_brawl', 'turbo_chicane'
];
const PARTY_VALID_ITEMS = new Set([
  'melee_bump', 'timed_shield', 'ddj_rush', 'bean_nitro', 'naiwa_swarm',
  'truck_isekai', 'dagou_bite', 'bball_rain', 'lawyer_seal', 'maodie_trap',
  'pelican_carry', 'manbo_steal', 'lightning_whip', 'kun_rocket', 'pan_shield', 'hero_skill_hit'
]);
const PARTY_ITEM_DAMAGE = {
  truck_isekai: 50, lightning_whip: 45, naiwa_swarm: 42, dagou_bite: 38,
  bball_rain: 36, maodie_trap: 34, pelican_carry: 32, manbo_steal: 30, lawyer_seal: 30, melee_bump: 30
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
  ['🤖 抽象大帝', 'ikun'], ['🤖 圆头耄耋王', 'hakimi'], ['🤖 背带顺丰王', 'pelican'],
  ['🤖 狂笑冒牌龙', 'naiwa'], ['🤖 喷火大头王', 'nailong']
];

async function ensurePartyRoomsTable(env) {
  if (partyTableInitialized) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS party_rooms (room_code TEXT PRIMARY KEY, status TEXT NOT NULL, is_quickmatch INTEGER NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL, state_json TEXT NOT NULL)'
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_party_qm ON party_rooms(is_quickmatch, status, updated_at)').run();
  partyTableInitialized = true;
}

function partyCleanId(rawId, randomHex) {
  const s = String(rawId || '').trim().replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 48);
  return s.length >= 3 ? s : 'p_' + randomHex(5);
}
function partyCleanNick(rawNick, fb = '派对骑手') {
  const s = String(rawNick || '').trim().replace(/[\r\n\t<>'"\\/;]/g, '').slice(0, 16);
  return s.length >= 1 ? s : fb;
}
function partyCleanHero(rawHero, VALID_HEROES) {
  const h = String(rawHero || '').trim();
  return VALID_HEROES.has(h) ? h : 'nailong';
}

async function resolvePartyAccountKey(env, token, fbUser) {
  if (token) {
    const row = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
    if (row && row.username) {
      return { accountKey: 'user:' + String(row.username).trim().toLowerCase(), accountName: String(row.display_name || row.username).trim() };
    }
  }
  const cleanFb = String(fbUser || '').trim().replace(/[\s<>'"\\/;]/g, '').slice(0, 20);
  if (cleanFb.length >= 2) return { accountKey: 'user:' + cleanFb.toLowerCase(), accountName: cleanFb };
  return { accountKey: '', accountName: '' };
}

function generatePartyModulePlan(trackSeed, raceDist) {
  let state = ((Number(trackSeed) ^ 0x9e3779b9) >>> 0) || 0x6d2b79f5;
  const nextRand = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state; };
  const midCount = Math.max(3, Math.round(Math.max(510, Number(raceDist) - 300) / 170));
  const pool = [...PARTY_CORE_MODULES];
  for (let i = pool.length - 1; i > 0; i--) { const j = nextRand() % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const middle = [];
  while (middle.length < midCount) {
    for (const modId of pool) {
      if (middle.length >= midCount) break;
      if (middle.length && middle[middle.length - 1] === modId) middle.push(pool[(pool.indexOf(modId) + 1) % pool.length]);
      else middle.push(modId);
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = nextRand() % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  }
  return ['start_launchpad', ...middle, 'final_sprint'];
}

function makePartyPlayerState(playerId, slot, nickname, heroId, nowMs, isBot = false, accountKey = '', accountName = '') {
  const p = {
    playerId, slot, nickname, heroId, accountKey, accountName, isBot: Boolean(isBot), ready: Boolean(isBot),
    x: 120, y: 0, vx: 0, vy: 0, dist: 0, hp: 100, maxHp: 100,
    animState: { onGround: true, striking: false, shieldActive: false, rocketActive: false, dizzy: false, clamped: false },
    shieldUntilMs: 0, shieldConsumedAtMs: 0, oneHitShieldUntilMs: 0, oneHitConsumedAtMs: 0, rocketUntilMs: 0,
    speech: '', speechUntilMs: 0, itemsUsed: 0, itemsLanded: 0,
    finishedServerMs: null, finishedClientMs: null, elapsedMs: null, inbox: [], lastSyncMs: nowMs
  };
  if (isBot) {
    p._bot = {
      lastTickMs: nowMs, nextCrateDist: 70, heldItem: '', useItemAtMs: 0, aliveSec: 0, koUntilMs: 0,
      nextHazardCheckM: 95, slowUntilMs: 0, slowMult: 1, stunUntilMs: 0, clampedUntilMs: 0, boostUntilMs: 0, boostMult: 1, hopPhase: 0
    };
  }
  return p;
}

function publicPartyPlayerView(p, nowMs) {
  if (!p) return null;
  const anim = (p.animState && typeof p.animState === 'object') ? p.animState : {};
  const shieldOn = (Number(p.shieldUntilMs || 0) > nowMs) || (Boolean(anim.shieldActive) && (nowMs - Number(p.shieldConsumedAtMs || 0) > 1500));
  const oneHitOn = (Number(p.oneHitShieldUntilMs || 0) > nowMs) || (Boolean(anim.oneHitShield) && (nowMs - Number(p.oneHitConsumedAtMs || 0) > 1500));
  const rocketOn = (Number(p.rocketUntilMs || 0) > nowMs) || Boolean(anim.rocketActive);
  const speech = Number(p.speechUntilMs || 0) > nowMs ? p.speech : '';
  return {
    playerId: p.playerId, slot: p.slot, nickname: p.nickname, heroId: p.heroId, isBot: Boolean(p.isBot), ready: Boolean(p.ready || p.isBot),
    x: Math.round(Number(p.x || 120) * 10) / 10, y: Math.round(Number(p.y || 0) * 10) / 10,
    vx: Math.round(Number(p.vx || 0) * 10) / 10, vy: Math.round(Number(p.vy || 0) * 10) / 10,
    dist: Math.round(Number(p.dist || 0) * 10) / 10, hp: Number(p.hp ?? 100), animState: anim,
    shieldActive: shieldOn, oneHitShield: oneHitOn, rocketActive: rocketOn,
    speech: speech || String(anim.speech || '').slice(0, 32),
    itemsUsed: Number(p.itemsUsed || 0), itemsLanded: Number(p.itemsLanded || 0),
    finished: p.finishedServerMs !== null && p.finishedServerMs !== undefined,
    elapsedMs: p.elapsedMs,
    staleMs: p.isBot ? 0 : Math.max(0, nowMs - Number(p.lastSyncMs || nowMs))
  };
}

function buildPartyRoomResponse(room, callerId, nowMs, drainInbox = false) {
  const caller = room.players[callerId] || null;
  let rival = null;
  for (const [pid, pobj] of Object.entries(room.players)) { if (pid !== callerId) { rival = pobj; break; } }
  let incoming = [];
  if (caller && drainInbox && Array.isArray(caller.inbox) && caller.inbox.length) {
    incoming = [...caller.inbox]; caller.inbox = [];
  }
  return {
    ok: true, roomCode: room.roomCode, roundId: Number(room.roundId || 1), status: room.status, isQuickmatch: Boolean(room.isQuickmatch),
    raceDist: room.raceDist, trackSeed: room.trackSeed, modulePlan: room.modulePlan, startAtMs: room.startAtMs,
    serverNowMs: nowMs, you: publicPartyPlayerView(caller, nowMs), rival: publicPartyPlayerView(rival, nowMs),
    incomingEvents: incoming, trackTraps: (room.trackTraps || []).filter(t => t && t.active),
    results: room.results || [], rematchVotes: Array.isArray(room.rematchVotes) ? [...room.rematchVotes].sort() : [],
    playerCount: Object.keys(room.players).length
  };
}

function forfeitPartyPlayer(room, quitterId, reason, nowMs) {
  const quitter = room.players[quitterId];
  const otherHumans = Object.values(room.players).filter(p => p.playerId !== quitterId && !p.isBot);
  if ((room.status === 'countdown' || room.status === 'racing') && otherHumans.length && quitter) {
    room.isQuickmatch = false;
    const survivor = otherHumans[0];
    const oldNick = quitter.nickname || '对手';
    const elapsed = Math.max(1000, nowMs - Number(room.startAtMs || room.createdAtMs || nowMs));
    survivor.finishedServerMs = nowMs; survivor.finishedClientMs = nowMs; survivor.elapsedMs = elapsed;
    room.status = 'finished';
    room.results = [
      { place: 1, title: '🥇 对手退赛判胜', rewardBeans: 500, playerId: survivor.playerId, nickname: survivor.nickname, heroId: survivor.heroId, isBot: false, dist: Math.round(Number(survivor.dist || 0) * 10) / 10, elapsedMs: elapsed, finishedServerMs: nowMs, itemsLanded: Number(survivor.itemsLanded || 0), itemsUsed: Number(survivor.itemsUsed || 0), forfeited: false },
      { place: 2, title: reason === 'disconnect' ? '📡 掉线判负' : '🏳️ 中途退赛', rewardBeans: 0, playerId: quitter.playerId, nickname: oldNick, heroId: quitter.heroId, isBot: Boolean(quitter.isBot), dist: Math.round(Number(quitter.dist || 0) * 10) / 10, elapsedMs: null, finishedServerMs: nowMs, itemsLanded: Number(quitter.itemsLanded || 0), itemsUsed: Number(quitter.itemsUsed || 0), forfeited: true, forfeitReason: reason }
    ];
    delete room.players[quitterId];
    room.rematchVotes = (room.rematchVotes || []).filter(v => v !== quitterId);
    survivor.inbox = survivor.inbox || [];
    survivor.inbox.push({ eventId: 'forfeit_' + quitterId + '_' + nowMs, type: 'rival_forfeit_win', fromNick: oldNick, reason });
    room.updatedAtMs = nowMs;
    return false;
  }
  delete room.players[quitterId];
  room.rematchVotes = (room.rematchVotes || []).filter(v => v !== quitterId);
  const remHumans = Object.values(room.players).filter(p => !p.isBot);
  if (remHumans.length === 0) {
    room.isQuickmatch = false;
    return true;
  }
  if (room.status === 'waiting' && remHumans.length === 1) {
    const survivor = remHumans[0];
    room.hostId = survivor.playerId;
    survivor.slot = 1;
    survivor.ready = false;
    survivor.lastSyncMs = nowMs;
    if (room.wasQuickmatch) room.isQuickmatch = true;
    room.updatedAtMs = nowMs;
  } else {
    room.isQuickmatch = false;
  }
  return false;
}

function recomputePartyResults(room, nowMs) {
  const fpList = Object.values(room.players).filter(p => p.finishedServerMs !== null && p.finishedServerMs !== undefined);
  fpList.sort((a, b) => Number(a.finishedServerMs) - Number(b.finishedServerMs) || Number(a.finishedClientMs || a.finishedServerMs) - Number(b.finishedClientMs || b.finishedServerMs));
  room.results = fpList.map((fp, idx) => ({
    place: idx + 1, title: idx === 0 ? '🥇 冠军梗王' : '🥈 惜败乐子人', rewardBeans: idx === 0 ? 500 : 200,
    playerId: fp.playerId, nickname: fp.nickname, heroId: fp.heroId, isBot: Boolean(fp.isBot),
    dist: Math.round(Number(fp.dist || room.raceDist) * 10) / 10,
    elapsedMs: Number(fp.elapsedMs || Math.max(1000, Number(fp.finishedServerMs) - Number(room.startAtMs || room.createdAtMs))),
    finishedServerMs: Number(fp.finishedServerMs), itemsLanded: Number(fp.itemsLanded || 0), itemsUsed: Number(fp.itemsUsed || 0)
  }));
  const total = Object.keys(room.players).length;
  if (total >= 2 && fpList.length >= total) room.status = 'finished';
  else if (fpList.length >= 1 && nowMs - Number(fpList[0].finishedServerMs) >= 16000) {
    for (const up of Object.values(room.players)) {
      if (up.finishedServerMs === null || up.finishedServerMs === undefined) {
        up.finishedServerMs = nowMs; up.elapsedMs = Math.max(1000, nowMs - Number(room.startAtMs || room.createdAtMs));
      }
    }
    recomputePartyResults(room, nowMs);
  }
}

function applyOffensiveHitToBot(botP, itemId, nowMs) {
  const bs = botP._bot; if (!bs) return;
  if (itemId === 'truck_isekai' || itemId === 'lightning_whip') bs.stunUntilMs = Math.max(bs.stunUntilMs, nowMs + 1200);
  else if (itemId === 'pelican_carry') bs.clampedUntilMs = Math.max(bs.clampedUntilMs, nowMs + 1300);
  else { bs.slowUntilMs = Math.max(bs.slowUntilMs, nowMs + 2400); bs.slowMult = 0.50; }
}

function processPartyItemEvent(room, caller, rival, evt, nowMs) {
  if (!evt || typeof evt !== 'object') return;
  const eventId = String(evt.eventId || '').trim().replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 80) || ('evt_' + caller.playerId + '_' + nowMs + '_' + (room.processedEventIds || []).length);
  room.processedEventIds = room.processedEventIds || [];
  if (room.processedEventIds.includes(eventId)) return;
  room.processedEventIds.push(eventId);
  if (room.processedEventIds.length > 400) room.processedEventIds = room.processedEventIds.slice(-250);
  const itemId = String(evt.itemId || '').trim();
  if (!PARTY_VALID_ITEMS.has(itemId)) return;
  caller.itemsUsed = Number(caller.itemsUsed || 0) + 1;

  if (itemId === 'timed_shield') { caller.oneHitShieldUntilMs = nowMs + 7000; caller.oneHitConsumedAtMs = 0; return; }
  if (itemId === 'pan_shield') { caller.shieldUntilMs = nowMs + 4500; caller.shieldConsumedAtMs = 0; return; }
  if (itemId === 'kun_rocket') {
    caller.rocketUntilMs = nowMs + 3000;
    if (caller.isBot && caller._bot) { caller._bot.boostUntilMs = nowMs + 3000; caller._bot.boostMult = 2.05; }
    if (rival && !rival.isBot) rival.inbox.push({ eventId: eventId + '_cast_notice', type: 'rival_boost_notice', itemId, fromNick: caller.nickname });
    return;
  }
  if (itemId === 'ddj_rush' || itemId === 'bean_nitro') {
    const dur = itemId === 'ddj_rush' ? 1450 : 2650;
    caller.rocketUntilMs = Math.max(Number(caller.rocketUntilMs || 0), nowMs + dur);
    if (caller.isBot && caller._bot) { caller._bot.boostUntilMs = Math.max(caller._bot.boostUntilMs, nowMs + dur); caller._bot.boostMult = itemId === 'ddj_rush' ? 1.82 : 1.54; }
    return;
  }
  if (!rival) return;
  const rAnim = (rival.animState && typeof rival.animState === 'object') ? rival.animState : {};
  const rOneHit = (Number(rival.oneHitShieldUntilMs || 0) > nowMs) || (Boolean(rAnim.oneHitShield) && (nowMs - Number(rival.oneHitConsumedAtMs || 0) > 1500));

  if (itemId === 'hero_skill_hit') {
    if (rOneHit) {
      rival.oneHitShieldUntilMs = 0; rival.oneHitConsumedAtMs = nowMs;
      if (rival.animState) rival.animState.oneHitShield = false;
      if (!rival.isBot) rival.inbox.push({ eventId: eventId + '_skblk', type: 'one_hit_shield_block', itemId: 'melee_bump' });
      if (!caller.isBot) caller.inbox.push({ eventId: eventId + '_skblk_ack', type: 'attack_blocked_ack', itemId: 'melee_bump' });
      return;
    }
    const dmg = Math.min(45, Math.max(16, Math.floor(Number(evt.dmg) || 30)));
    const curHp = Number(rival.hp ?? 100) - dmg;
    if (curHp <= 0) {
      rival.hp = 100; caller.itemsLanded = Number(caller.itemsLanded || 0) + 1;
      if (rival.isBot && rival._bot) { rival._bot.koUntilMs = nowMs + 2400; rival._bot.aliveSec = 0; }
      else if (!rival.isBot) rival.inbox.push({ eventId: eventId + '_ko_v', type: 'hero_ko_victim', fromNick: caller.nickname });
      if (!caller.isBot) caller.inbox.push({ eventId: eventId + '_ko_k', type: 'hero_ko_killer', targetNick: rival.nickname });
    } else {
      rival.hp = curHp;
      if (!rival.isBot) rival.inbox.push({ eventId: eventId + '_skhurt', type: 'hero_skill_hurt', dmg, fromNick: caller.nickname });
      if (!caller.isBot) caller.inbox.push({ eventId: eventId + '_skack', type: 'hero_skill_ack', dmg, rivalHp: curHp });
    }
    return;
  }

  const rShield = (Number(rival.shieldUntilMs || 0) > nowMs) || (Boolean(rAnim.shieldActive) && (nowMs - Number(rival.shieldConsumedAtMs || 0) > 1500));
  if (rShield) {
    rival.shieldUntilMs = 0; rival.shieldConsumedAtMs = nowMs;
    if (rival.animState) rival.animState.shieldActive = false;
    rival.itemsLanded = Number(rival.itemsLanded || 0) + 1;
    if (!rival.isBot) rival.inbox.push({ eventId: eventId + '_shield_win', type: 'shield_reflect_win', itemId, fromId: caller.playerId, fromNick: caller.nickname, reflected: true });
    if (caller.isBot) applyOffensiveHitToBot(caller, itemId, nowMs);
    else caller.inbox.push({ eventId: eventId + '_reflected', type: 'attack', itemId, fromId: rival.playerId, fromNick: rival.nickname, targetId: caller.playerId, reflected: true });
    return;
  }
  if (rOneHit) {
    rival.oneHitShieldUntilMs = 0; rival.oneHitConsumedAtMs = nowMs;
    if (rival.animState) rival.animState.oneHitShield = false;
    if (!rival.isBot) rival.inbox.push({ eventId: eventId + '_onehit_block', type: 'one_hit_shield_block', itemId, fromId: caller.playerId, fromNick: caller.nickname });
    if (!caller.isBot) caller.inbox.push({ eventId: eventId + '_blk_ack', type: 'attack_blocked_ack', itemId, targetNick: rival.nickname });
    return;
  }

  caller.itemsLanded = Number(caller.itemsLanded || 0) + 1;
  const itemDmg = Number(PARTY_ITEM_DAMAGE[itemId] || 35);
  const nextHp = Number(rival.hp ?? 100) - itemDmg;
  const lethalKo = nextHp <= 0;
  rival.hp = lethalKo ? 100 : nextHp;
  if (!caller.isBot) caller.inbox.push({ eventId: eventId + '_hit_ack', type: 'attack_hit_confirm', itemId, dmg: itemDmg, lethalKo, targetNick: rival.nickname, comboHits: caller.itemsLanded });
  if (rival.isBot) {
    applyOffensiveHitToBot(rival, itemId, nowMs);
    if (lethalKo && rival._bot) { rival._bot.koUntilMs = nowMs + 2400; rival._bot.aliveSec = 0; }
  } else {
    rival.inbox.push({ eventId, type: 'attack', itemId, dmg: itemDmg, lethalKo, fromId: caller.playerId, fromNick: caller.nickname, targetId: rival.playerId, reflected: false, banner: PARTY_ITEM_BANNERS[itemId] || '💥 遭到对手梗道具袭击！' });
  }
}

function tickPartyBot(room, botP, humanP, nowMs) {
  const bs = botP._bot; if (!bs) return;
  const prevMs = Number(bs.lastTickMs || nowMs); bs.lastTickMs = nowMs;
  if (room.status !== 'countdown' && room.status !== 'racing') return;
  const startAt = Number(room.startAtMs || nowMs);
  if (nowMs < startAt) { botP.x = 120; botP.dist = 0; botP.vx = 0; return; }
  if (room.status === 'countdown') room.status = 'racing';
  if (botP.finishedServerMs !== null && botP.finishedServerMs !== undefined) { botP.vx = 0; return; }
  const dt = Math.min(0.25, Math.max(0, (nowMs - prevMs) / 1000));
  if (dt <= 0.0001) return;

  const gapM = (humanP ? Number(humanP.dist || 0) : 0) - Number(botP.dist || 0);
  const rocketOn = nowMs < Number(botP.rocketUntilMs || 0);
  let koCrawling = nowMs < Number(bs.koUntilMs || 0);
  if (koCrawling) bs.aliveSec = 0;
  else bs.aliveSec = Math.min(40, Number(bs.aliveSec || 0) + dt);
  let baseSpd = 365 * (1 + Math.min(1, Number(bs.aliveSec) / 40));
  if (gapM > 16) baseSpd *= Math.min(1.36, 1 + (gapM - 16) * 0.011);
  else if (gapM < -20) baseSpd *= Math.max(0.76, 1 + (gapM + 20) * 0.009);

  const clamped = nowMs < Number(bs.clampedUntilMs || 0);
  const stunned = nowMs < Number(bs.stunUntilMs || 0);
  let spd = koCrawling ? 58 : (stunned ? 65 : (clamped ? 95 : baseSpd));
  if (!koCrawling && !stunned && !clamped) {
    if (nowMs < Number(bs.boostUntilMs || 0)) spd *= Number(bs.boostMult || 1.35);
    if (!rocketOn && nowMs < Number(bs.slowUntilMs || 0)) spd *= Number(bs.slowMult || 0.65);
  }
  if (humanP) {
    const dxPx = Number(humanP.x || 120) - Number(botP.x || 120);
    const absDx = Math.abs(dxPx);
    if (absDx > 150) {
      const pullV = Math.min(72, (absDx - 150) * 0.065);
      if (dxPx > 0) spd += pullV;
      else spd = Math.max(145, spd - pullV * (rocketOn ? 0.16 : 0.48));
    }
  }
  botP.vx = spd; botP.x += spd * dt; botP.dist = Math.max(0, (botP.x - 120) / 18);
  bs.hopPhase = (Number(bs.hopPhase || 0) + dt * 1.9) % (Math.PI * 2);
  const hopSin = Math.sin(bs.hopPhase);
  const inAir = hopSin > 0.58 || clamped;
  botP.y = (clamped ? -95 : (inAir ? -Math.max(0, (hopSin - 0.58) / 0.42) * 86 : 0));
  botP.vy = inAir ? -220 : 0;
  botP.animState = { onGround: !inAir, striking: false, shieldActive: nowMs < Number(botP.shieldUntilMs || 0), rocketActive: rocketOn, koCrawl: koCrawling, dizzy: stunned, clamped };

  if (botP.dist >= Number(bs.nextCrateDist || 75) && botP.dist < Number(room.raceDist) - 45) {
    bs.nextCrateDist = botP.dist + 160 + ((nowMs % 5) * 14);
    if (!bs.heldItem) {
      const choices = ['naiwa_swarm', 'truck_isekai', 'dagou_bite', 'bball_rain', 'maodie_trap', 'timed_shield', 'ddj_rush', 'kun_rocket', 'lightning_whip'];
      bs.heldItem = choices[Math.floor(nowMs / 97) % choices.length];
      bs.useItemAtMs = nowMs + 1600;
    }
  }
  if (bs.heldItem && nowMs >= Number(bs.useItemAtMs || 0) && !stunned && !clamped) {
    const ch = bs.heldItem; bs.heldItem = '';
    processPartyItemEvent(room, botP, humanP, { eventId: 'bot_evt_' + room.roomCode + '_' + nowMs, itemId: ch }, nowMs);
  }
  if (botP.dist >= Number(room.raceDist) && (botP.finishedServerMs === null || botP.finishedServerMs === undefined)) {
    botP.dist = Number(room.raceDist); botP.x = 120 + Number(room.raceDist) * 18;
    botP.finishedServerMs = nowMs; botP.finishedClientMs = nowMs; botP.elapsedMs = Math.max(1000, nowMs - startAt);
    recomputePartyResults(room, nowMs);
  }
}

function partyCleanRoomCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function hashRoomCodeNum(code) {
  let acc = 0;
  for (let i = 0; i < code.length; i++) acc = (acc * 31 + code.charCodeAt(i)) >>> 0;
  return acc;
}

async function prunePartyRoomsD1(env, nowMs) {
  await ensurePartyRoomsTable(env);
  await env.DB.prepare(
    'DELETE FROM party_rooms WHERE updated_at < ? OR (status = ? AND is_quickmatch = 1 AND updated_at < ?) OR (status = ? AND is_quickmatch = 0 AND updated_at < ?)'
  ).bind(nowMs - PARTY_ROOM_IDLE_TTL_MS, 'waiting', nowMs - 120000, 'waiting', nowMs - 300000).run();
}

async function createPartyRoomD1(env, pid, nick, hero, raceDist, nowMs, isQm, acctKey, acctName, customCode = '') {
  await prunePartyRoomsD1(env, nowMs);
  if (customCode) {
    const existing = await env.DB.prepare('SELECT status, updated_at FROM party_rooms WHERE room_code = ?').bind(customCode).first();
    if (existing) {
      if (existing.status === 'finished' && (nowMs - Number(existing.updated_at || 0)) > 15000) {
        await env.DB.prepare('DELETE FROM party_rooms WHERE room_code = ?').bind(customCode).run();
      } else {
        return { errorResp: { status: 409, msg: '房号【' + customCode + '】已被使用，请换一个房号或直接点击“加入”进房！' } };
      }
    }
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    const trackSeed = (r[0] % 1900000000) + 100000;
    const room = {
      roomCode: customCode, roundId: 1, hostId: pid, status: 'waiting', isQuickmatch: false, wasQuickmatch: false, raceDist, trackSeed,
      modulePlan: generatePartyModulePlan(trackSeed, raceDist), createdAtMs: nowMs, updatedAtMs: nowMs, startAtMs: null,
      players: { [pid]: makePartyPlayerState(pid, 1, nick, hero, nowMs, false, acctKey, acctName) },
      processedEventIds: [], trackTraps: [], results: [], rematchVotes: []
    };
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO party_rooms (room_code, status, is_quickmatch, rev, updated_at, state_json) VALUES (?, ?, 0, 1, ?, ?)')
      .bind(customCode, 'waiting', nowMs, JSON.stringify(room)).run();
    if (ins.meta && ins.meta.changes > 0) return { room };
    return { errorResp: { status: 409, msg: '房号【' + customCode + '】刚刚被抢注，请换一个房号或直接加入！' } };
  }
  for (let a = 0; a < 16; a++) {
    const r = new Uint32Array(2); crypto.getRandomValues(r);
    const roomCode = String((r[0] % 9000) + 1000);
    const trackSeed = (r[1] % 1900000000) + 100000;
    const room = {
      roomCode, roundId: 1, hostId: pid, status: 'waiting', isQuickmatch: Boolean(isQm), wasQuickmatch: Boolean(isQm), raceDist, trackSeed,
      modulePlan: generatePartyModulePlan(trackSeed, raceDist), createdAtMs: nowMs, updatedAtMs: nowMs, startAtMs: null,
      players: { [pid]: makePartyPlayerState(pid, 1, nick, hero, nowMs, false, acctKey, acctName) },
      processedEventIds: [], trackTraps: [], results: [], rematchVotes: []
    };
    const res = await env.DB.prepare('INSERT OR IGNORE INTO party_rooms (room_code, status, is_quickmatch, rev, updated_at, state_json) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(roomCode, 'waiting', isQm ? 1 : 0, nowMs, JSON.stringify(room)).run();
    if (res.meta && res.meta.changes > 0) return { room };
  }
  throw new Error('Room busy');
}

async function mutatePartyRoomCAS(env, roomCode, nowMs, fn) {
  await ensurePartyRoomsTable(env);
  let lastRoom = null;
  for (let a = 0; a < 10; a++) {
    if (a > 0) await new Promise(res => setTimeout(res, 6 * a + (nowMs % 5)));
    const row = await env.DB.prepare('SELECT rev, state_json FROM party_rooms WHERE room_code = ?').bind(roomCode).first();
    if (!row) return { notFound: true };
    const rev = Number(row.rev || 1);
    const room = JSON.parse(row.state_json);
    lastRoom = room;
    const out = fn(room, nowMs) || {};
    if (out.abortResp) return out;
    if (out.deleteRoom) {
      await env.DB.prepare('DELETE FROM party_rooms WHERE room_code = ?').bind(roomCode).run();
      return out;
    }
    const upd = await env.DB.prepare('UPDATE party_rooms SET status = ?, is_quickmatch = ?, rev = ?, updated_at = ?, state_json = ? WHERE room_code = ? AND rev = ?')
      .bind(room.status, room.isQuickmatch && room.status === 'waiting' && Object.keys(room.players).length < 2 ? 1 : 0, rev + 1, nowMs, JSON.stringify(room), roomCode, rev).run();
    if (upd.meta && upd.meta.changes > 0) return { room, ...out };
  }
  const latestRow = await env.DB.prepare('SELECT state_json FROM party_rooms WHERE room_code = ?').bind(roomCode).first();
  if (latestRow && latestRow.state_json) {
    try { lastRoom = JSON.parse(latestRow.state_json); } catch (_) {}
  }
  return { conflict: true, latestRoom: lastRoom };
}

export async function handlePartyApi(request, env, url, path, extractToken, readSafeJson, jsonResp, randomHex, VALID_HEROES) {
  const now = Date.now();
  if (path === '/api/party/room' && request.method === 'GET') {
    const rcode = partyCleanRoomCode(url.searchParams.get('roomCode') || '');
    const pid = partyCleanId(url.searchParams.get('playerId') || '', randomHex);
    const qsHero = String(url.searchParams.get('heroId') || '').trim();
    await prunePartyRoomsD1(env, now);
    if (rcode.length < 2) return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
    const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
      if (room.players[pid]) {
        const me = room.players[pid];
        me.lastSyncMs = nowMs; room.updatedAtMs = nowMs;
        if (VALID_HEROES.has(qsHero) && (room.status === 'waiting' || room.status === 'finished' || me.finishedServerMs !== null)) {
          me.heroId = qsHero;
        }
      }
      if (room.status === 'finished') {
        for (const [opId, opObj] of Object.entries(room.players)) {
          if (opId !== pid && !opObj.isBot && (nowMs - Number(opObj.lastSyncMs || nowMs)) > 120000) {
            if (forfeitPartyPlayer(room, opId, 'disconnect', nowMs)) return { deleteRoom: true };
          }
        }
      }
      return {};
    });
    if (res.conflict && res.latestRoom) return jsonResp(buildPartyRoomResponse(res.latestRoom, pid, now, false));
    if (res.notFound || res.deleteRoom || !res.room) return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
    return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
  }

  if (request.method !== 'POST') return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  const parsed = await readSafeJson(request, 8192);
  if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
  const body = parsed.body || {};

  if (path === '/api/party/create') {
    const pid = partyCleanId(body.playerId, randomHex);
    const nick = partyCleanNick(body.nickname, '派对房主');
    const hero = partyCleanHero(body.heroId, VALID_HEROES);
    const rawCustom = String(body.customCode || '').trim();
    const customCode = partyCleanRoomCode(rawCustom);
    if (rawCustom.length > 0 && customCode.length < 2) return jsonResp({ ok: false, error: '自定义房号需为 2~8 位数字或字母！' }, 400);
    const { accountKey, accountName } = await resolvePartyAccountKey(env, extractToken(request, body), body.authUser || '');
    const raceDist = Math.min(5000, Math.max(1200, Math.floor(Number(body.raceDist) || 3500)));
    const created = await createPartyRoomD1(env, pid, nick, hero, raceDist, now, false, accountKey, accountName, customCode);
    if (created.errorResp) return jsonResp({ ok: false, error: created.errorResp.msg }, created.errorResp.status);
    return jsonResp(buildPartyRoomResponse(created.room, pid, now, false));
  }

  if (path === '/api/party/set_hero') {
    const rcode = partyCleanRoomCode(body.roomCode);
    const pid = partyCleanId(body.playerId, randomHex);
    const hero = partyCleanHero(body.heroId, VALID_HEROES);
    const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
      const caller = room.players[pid];
      if (!caller) return { abortResp: jsonResp({ ok: false, error: '房间不存在或已过期' }, 404) };
      if (room.status === 'waiting' || room.status === 'finished' || caller.finishedServerMs !== null) {
        caller.heroId = hero;
        if (body.nickname) caller.nickname = partyCleanNick(body.nickname, caller.nickname);
        caller.lastSyncMs = nowMs; room.updatedAtMs = nowMs;
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
    const pid = partyCleanId(body.playerId, randomHex);
    const wantReady = body.ready !== undefined ? Boolean(body.ready) : true;
    const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
      const caller = room.players[pid];
      if (!caller) return { abortResp: jsonResp({ ok: false, error: '房间不存在或已过期' }, 404) };
      caller.lastSyncMs = nowMs; room.updatedAtMs = nowMs;
      if (VALID_HEROES.has(body.heroId) && room.status === 'waiting') caller.heroId = body.heroId;
      if (body.nickname && room.status === 'waiting') caller.nickname = partyCleanNick(body.nickname, caller.nickname);
      if (room.status === 'waiting') {
        caller.ready = wantReady;
        const plist = Object.values(room.players);
        if (plist.length >= 2 && plist.every(p => Boolean(p.ready || p.isBot))) {
          room.status = 'countdown';
          room.isQuickmatch = false;
          room.startAtMs = nowMs + PARTY_COUNTDOWN_MS;
          for (const pobj of plist) pobj.lastSyncMs = nowMs;
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
    const pid = partyCleanId(body.playerId, randomHex);
    const nick = partyCleanNick(body.nickname, '挑战骑手');
    const hero = partyCleanHero(body.heroId, VALID_HEROES);
    if (rcode.length < 2) return jsonResp({ ok: false, error: '请输入正确的 2~8 位房间号！' }, 400);
    const { accountKey, accountName } = await resolvePartyAccountKey(env, extractToken(request, body), body.authUser || '');
    await prunePartyRoomsD1(env, now);
    const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
      if (room.players[pid]) {
        if (room.status === 'waiting') { room.players[pid].nickname = nick; room.players[pid].heroId = hero; }
        room.players[pid].lastSyncMs = nowMs; room.updatedAtMs = nowMs;
        return {};
      }
      if (accountKey && Object.values(room.players).some(op => !op.isBot && op.accountKey === accountKey)) {
        return { abortResp: jsonResp({ ok: false, error: '不能用相同账号【' + (accountName || nick) + '】同房互匹！请在另一窗口切换其他账号登录' }, 409) };
      }
      if (Object.keys(room.players).length >= 2 || room.status !== 'waiting') {
        return { abortResp: jsonResp({ ok: false, error: '该房间已满员或已发车，请创建新房间或使用快速匹配！' }, 409) };
      }
      const usedSlots = new Set(Object.values(room.players).map(p => p.slot));
      const freeSlot = usedSlots.has(1) ? 2 : 1;
      room.players[pid] = makePartyPlayerState(pid, freeSlot, nick, hero, nowMs, false, accountKey, accountName);
      room.isQuickmatch = false;
      for (const pobj of Object.values(room.players)) pobj.lastSyncMs = nowMs;
      room.updatedAtMs = nowMs;
      return {};
    });
    if (res.abortResp) return res.abortResp;
    if (res.notFound || !res.room) return jsonResp({ ok: false, error: '房间号不存在或已过期，请核对房间号！' }, 404);
    return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
  }

  if (path === '/api/party/quickmatch') {
    const pid = partyCleanId(body.playerId, randomHex);
    const nick = partyCleanNick(body.nickname, '派对骑手');
    const hero = partyCleanHero(body.heroId, VALID_HEROES);
    const raceDist = Math.min(5000, Math.max(1200, Math.floor(Number(body.raceDist) || 3500)));
    const { accountKey, accountName } = await resolvePartyAccountKey(env, extractToken(request, body), body.authUser || '');
    await prunePartyRoomsD1(env, now);
    const openRows = await env.DB.prepare('SELECT room_code, state_json FROM party_rooms WHERE is_quickmatch = 1 AND status = ? ORDER BY updated_at ASC LIMIT 12').bind('waiting').all();
    for (const qr of (openRows.results || [])) {
      let qrm = null; try { qrm = JSON.parse(qr.state_json); } catch (_) {}
      if (!qrm || qrm.status !== 'waiting') continue;
      if (qrm.players[pid] && Object.keys(qrm.players).length === 1) {
        const reuse = await mutatePartyRoomCAS(env, qr.room_code, now, (room, nowMs) => {
          if (!room.players[pid] || Object.keys(room.players).length !== 1) return { abortResp: true };
          room.players[pid].nickname = nick; room.players[pid].heroId = hero; room.players[pid].lastSyncMs = nowMs; room.updatedAtMs = nowMs;
          return {};
        });
        if (reuse.room) { const o = buildPartyRoomResponse(reuse.room, pid, now, false); o.matched = false; return jsonResp(o); }
      }
      if (accountKey && !qrm.players[pid] && Object.values(qrm.players).some(op => !op.isBot && op.accountKey === accountKey)) {
        return jsonResp({ ok: false, error: '账号【' + (accountName || nick) + '】已在另一窗口匹配中，不能同号互匹！请切换其他账号登录' }, 409);
      }
    }
    for (const qr of (openRows.results || [])) {
      const claim = await mutatePartyRoomCAS(env, qr.room_code, now, (room, nowMs) => {
        if (room.status !== 'waiting' || Object.keys(room.players).length !== 1 || room.players[pid]) return { abortResp: true };
        if (accountKey && Object.values(room.players).some(op => !op.isBot && op.accountKey === accountKey)) return { abortResp: true };
        const usedSlots = new Set(Object.values(room.players).map(p => p.slot));
        const freeSlot = usedSlots.has(1) ? 2 : 1;
        room.players[pid] = makePartyPlayerState(pid, freeSlot, nick, hero, nowMs, false, accountKey, accountName);
        room.isQuickmatch = false;
        for (const pobj of Object.values(room.players)) pobj.lastSyncMs = nowMs;
        room.updatedAtMs = nowMs;
        return {};
      });
      if (claim.room) { const o = buildPartyRoomResponse(claim.room, pid, now, false); o.matched = true; return jsonResp(o); }
    }
    const created = await createPartyRoomD1(env, pid, nick, hero, raceDist, now, true, accountKey, accountName, '');
    const out = buildPartyRoomResponse(created.room, pid, now, false); out.matched = false;
    return jsonResp(out);
  }

  if (path === '/api/party/add_bot') {
    const rcode = partyCleanRoomCode(body.roomCode);
    const pid = partyCleanId(body.playerId, randomHex);
    const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
      if (!room.players[pid]) return { abortResp: jsonResp({ ok: false, error: '无权操作此房间' }, 403) };
      if (Object.keys(room.players).length >= 2) {
        if (Object.values(room.players).some(p => p.isBot)) return {};
        return { abortResp: jsonResp({ ok: false, error: '真人劲敌已进房，请点击准备发车！' }, 409) };
      }
      room.players[pid].ready = true; room.players[pid].lastSyncMs = nowMs;
      const cands = PARTY_BOT_PERSONAS.filter(bp => bp[1] !== room.players[pid].heroId);
      const pool = cands.length ? cands : PARTY_BOT_PERSONAS;
      const [botNick, botHero] = pool[(hashRoomCodeNum(rcode) + nowMs) % pool.length];
      room.players['bot_' + rcode] = makePartyPlayerState('bot_' + rcode, 2, botNick, botHero, nowMs, true);
      room.status = 'countdown'; room.isQuickmatch = false; room.startAtMs = nowMs + PARTY_COUNTDOWN_MS; room.updatedAtMs = nowMs;
      return {};
    });
    if (res.abortResp) return res.abortResp;
    if (res.notFound || !res.room) return jsonResp({ ok: false, error: '房间不存在或已过期' }, 404);
    return jsonResp(buildPartyRoomResponse(res.room, pid, now, false));
  }

  if (path === '/api/party/sync') {
    const rcode = partyCleanRoomCode(body.roomCode);
    const pid = partyCleanId(body.playerId, randomHex);
    let builtResp = null;
    const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
      const caller = room.players[pid];
      if (!caller) return { abortResp: jsonResp({ ok: false, error: '不在此房间内' }, 403) };
      room.updatedAtMs = nowMs; caller.lastSyncMs = nowMs;
      if (room.status === 'countdown' && room.startAtMs && nowMs >= Number(room.startAtMs)) room.status = 'racing';
      const curRoundId = Number(room.roundId || 1);
      const staleRoundSync = body.roundId !== undefined && Number(body.roundId) !== curRoundId;
      let rival = null;
      for (const [opId, opObj] of Object.entries(room.players)) { if (opId !== pid) { rival = opObj; break; } }
      if (rival && !rival.isBot && (room.status === 'countdown' || room.status === 'racing') && (nowMs - Number(rival.lastSyncMs || nowMs)) > 60000) {
        forfeitPartyPlayer(room, rival.playerId, 'disconnect', nowMs); rival = null;
      }
      if (!staleRoundSync && room.status !== 'finished') {
        for (const nk of ['x', 'y', 'vx', 'vy', 'dist']) {
          if (typeof body[nk] === 'number' && Number.isFinite(body[nk])) caller[nk] = body[nk];
        }
        if (typeof body.hp === 'number' && Number.isFinite(body.hp)) caller.hp = Math.max(0, Math.min(999, Math.round(body.hp)));
        if (VALID_HEROES.has(body.heroId) && (caller.finishedServerMs === null || caller.finishedServerMs === undefined)) {
          caller.heroId = body.heroId;
        }
        if (body.animState && typeof body.animState === 'object') {
          const cleanAnim = { ...body.animState };
          if (nowMs - Number(caller.shieldConsumedAtMs || 0) <= 1500) cleanAnim.shieldActive = false;
          if (nowMs - Number(caller.oneHitConsumedAtMs || 0) <= 1500) cleanAnim.oneHitShield = false;
          caller.animState = cleanAnim;
        }
        if (body.useItemEvent && typeof body.useItemEvent === 'object') processPartyItemEvent(room, caller, rival, body.useItemEvent, nowMs);
        if (Array.isArray(body.useItemEvents)) {
          for (const ev of body.useItemEvents.slice(0, 6)) if (ev && typeof ev === 'object') processPartyItemEvent(room, caller, rival, ev, nowMs);
        }
        if (rival && rival.isBot) tickPartyBot(room, rival, caller, nowMs);
        if ((room.status === 'racing' || room.status === 'countdown') && Number(caller.dist || 0) >= Number(room.raceDist)) {
          if (room.status === 'countdown') room.status = 'racing';
          if (caller.finishedServerMs === null || caller.finishedServerMs === undefined) {
            caller.dist = Number(room.raceDist); caller.x = Math.max(Number(caller.x || 120), 120 + Number(room.raceDist) * 18);
            caller.finishedServerMs = nowMs; caller.finishedClientMs = typeof body.finishedClientMs === 'number' ? Math.floor(body.finishedClientMs) : nowMs;
            caller.elapsedMs = Math.max(1000, nowMs - Number(room.startAtMs || room.createdAtMs));
          }
        }
      }
      if (room.status === 'racing' || room.status === 'finished') recomputePartyResults(room, nowMs);
      builtResp = buildPartyRoomResponse(room, pid, nowMs, !staleRoundSync);
      return {};
    });
    if (res.abortResp) return res.abortResp;
    if (res.conflict && res.latestRoom) return jsonResp(buildPartyRoomResponse(res.latestRoom, pid, now, false));
    if (res.notFound || !builtResp) return jsonResp({ ok: false, error: '房间已结束或过期' }, 404);
    return jsonResp(builtResp);
  }

  if (path === '/api/party/rematch') {
    const rcode = partyCleanRoomCode(body.roomCode);
    const pid = partyCleanId(body.playerId, randomHex);
    const res = await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
      const caller = room.players[pid];
      if (!caller) return { abortResp: jsonResp({ ok: false, error: '房间已失效，请重新创建房间' }, 404) };
      caller.lastSyncMs = nowMs;
      if (VALID_HEROES.has(body.heroId)) caller.heroId = body.heroId;
      const voteSet = new Set(Array.isArray(room.rematchVotes) ? room.rematchVotes : []);
      if (room.status === 'finished' || caller.finishedServerMs !== null) {
        voteSet.add(pid);
        for (const [k, pobj] of Object.entries(room.players)) if (pobj.isBot) voteSet.add(k);
        const pKeys = Object.keys(room.players);
        if (room.status === 'finished' && pKeys.length >= 2 && pKeys.every(k => voteSet.has(k))) {
          const r = new Uint32Array(1); crypto.getRandomValues(r);
          const newSeed = (r[0] % 1900000000) + 100000;
          room.roundId = Number(room.roundId || 1) + 1;
          room.trackSeed = newSeed; room.modulePlan = generatePartyModulePlan(newSeed, room.raceDist);
          room.trackTraps = []; room.processedEventIds = []; room.results = []; room.rematchVotes = [];
          for (const pobj of Object.values(room.players)) {
            const fresh = makePartyPlayerState(pobj.playerId, pobj.slot, pobj.nickname, pobj.heroId, nowMs, Boolean(pobj.isBot), pobj.accountKey || '', pobj.accountName || '');
            fresh.ready = true;
            Object.assign(pobj, fresh);
          }
          room.status = 'countdown'; room.startAtMs = nowMs + PARTY_COUNTDOWN_MS;
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
    const pid = partyCleanId(body.playerId, randomHex);
    if (rcode.length >= 2) {
      await mutatePartyRoomCAS(env, rcode, now, (room, nowMs) => {
        if (!room.players[pid]) return {};
        return forfeitPartyPlayer(room, pid, 'quit', nowMs) ? { deleteRoom: true } : {};
      });
    }
    return jsonResp({ ok: true });
  }

  return jsonResp({ ok: false, error: 'Not found' }, 404);
}
