// ============================================================================
// 《鹈鹕测试大乱斗》 — 7 Physical, Non-Teleporting, Visually Self-Evident Bosses (v4.0)
// Core Design Laws:
//  1. ZERO TELEPORTATION: boss.worldX & boss.yOff move ONLY via continuous velocity
//     and gravity across all states (idle, attack, knockdown, stun, recovery).
//  2. ZERO INVISIBLE TIMER DAMAGE: Player ONLY takes damage from visible physical
//     collisions (body lunge, rolling wheel, tongue sweep, wall, meteor, deep water).
//  3. 100% COUNTERABLE & READABLE: Every Boss stays at a clear readable distance,
//     telegraphs physically, and can be countered by Jump, 🐔铁山靠, Skills & Props!
// ============================================================================

import { drawModelOn, drawSpaldingWheelOn } from './models.js?v=8.3';
import { playSfx, playCriticalMomentVoice } from './audio.js?v=8.3';

export function initBossCustomState(boss, playerX) {
  boss.mech = 'idle';
  boss.mechTimer = 1.15;
  boss.mechSub = 0;
  boss.objs = [];
  boss.vy = 0;
  boss.relVx = 0;
  boss.recoilX = 0;
  boss.hitSquash = 0;
  boss.floodLevel = 0;
  boss.playerCarryingBall = false;
  boss.playerHasBone = false;
  boss.cursedFaceTimer = 0;
  boss.counterBannerTimer = 0;
  boss.counterBannerTxt = '';
  // Spawn smoothly off-screen so Boss physically enters the arena!
  boss.worldX = boss.kind === 'dagou_jiao' ? (playerX - 320) : (playerX + 520);
  boss.yOff = boss.kind === 'dingdong_ji' ? -96 : (boss.kind === 'manbo_queen' ? -36 : 0);
}

function showCounterSuccess(boss, text, dmg) {
  boss.counterBannerTimer = 1.5;
  boss.counterBannerTxt = `✅ 反制成功！${text} -${dmg} HP！`;
  boss.hitSquash = 1.0;
}

export function clearBossTransientHazards(boss) {
  if (!boss) return;
  boss.mech = 'idle';
  boss.mechTimer = 1.25;
  boss.mechSub = 0;
  boss.objs = [];
  boss.vy = 0;
  boss.relVx = 0;
  boss.floodLevel = 0;
  boss.playerCarryingBall = false;
  boss.playerHasBone = false;
}

// Smoothly moves boss.yOff toward targetYOff without EVER snapping!
function approachYOff(boss, targetYOff, rate, dt) {
  boss.yOff += (targetYOff - boss.yOff) * Math.min(1, dt * rate);
}

// Smoothly moves boss.worldX toward targetWorldX while riding along highway!
function approachWorldX(boss, playerVx, targetWorldX, rate, dt) {
  boss.worldX += playerVx * dt;
  boss.worldX += (targetWorldX - boss.worldX) * Math.min(1, dt * rate);
}

export function hasBossImmediateJumpCue(boss, player) {
  if (!boss || boss.pinnedByHyper || boss.stunTimer > 0) return false;
  if (boss.kind === 'dagou_jiao') {
    if (boss.mech === 'rear_lunge' && (boss.mechSub === 1 || boss.mechTimer < 0.72)) return true;
    if (boss.mech === 'bone_bait' && boss.objs[1] && !boss.objs[1].done && Math.abs(boss.objs[1].x - player.x) < 150) return true;
  }
  if (boss.kind === 'kun_mecha' && boss.playerCarryingBall && Math.abs(player.x - (boss.worldX - 52)) < 200) return true;
  if (boss.kind === 'titan_naiwa' && (boss.mech === 'rising_flood' || (boss.mech === 'tongue_sweep' && boss.mechSub === 1))) return true;
  if (boss.kind === 'lava_dragon' && boss.mech === 'highway_collapse' && !player.onRail) return true;
  if (boss.kind === 'manbo_queen' && boss.mech === 'giant_head_bounce' && Math.abs(boss.worldX - player.x) < 150) return true;
  if (boss.kind === 'demon_hakimi' && boss.mech === 'cat_pounce' && boss.mechSub === 1 && Math.abs(boss.worldX - player.x) < 160) return true;
  return false;
}

export function hasBossImmediateParryCue(boss, player) {
  if (!boss || boss.pinnedByHyper || boss.stunTimer > 0) return false;
  if (boss.kind === 'dagou_jiao' && boss.mech === 'rear_lunge' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || (boss.mechSub === 1 && boss.worldX > player.x - 210))) return true;
  if (boss.kind === 'manbo_queen' && boss.mech === 'giant_head_bounce' && Math.abs(boss.worldX - player.x) < 280) return true;
  if (boss.kind === 'dingdong_ji' && boss.mech === 'swoop_dive' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || (boss.mechSub === 1 && Math.abs(boss.worldX - player.x) < 300))) return true;
  if (boss.kind === 'titan_naiwa' && boss.mech === 'tongue_sweep' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || boss.mechSub === 1)) return true;
  if (boss.kind === 'demon_hakimi' && boss.mech === 'cat_pounce' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || (boss.mechSub === 1 && Math.abs(boss.worldX - player.x) < 300))) return true;
  for (let i = 0; i < boss.objs.length; i++) {
    const o = boss.objs[i];
    if (o.done) continue;
    if ((o.type === 'q_wall' || o.type === 'yarn_ball' || o.type === 'magma_meteor' || o.type === 'live_ball' || o.type === 'gold_mic') &&
        Math.abs(o.x - player.x) < 280) {
      return true;
    }
  }
  if (boss.kind === 'kun_mecha') {
    if (boss.playerCarryingBall && Math.abs(player.x - (boss.worldX - 55)) < 165) return true;
    if (boss.mech === 'shoulder_charge' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || (boss.mechSub === 1 && Math.abs(boss.worldX - player.x) < 300))) return true;
  }
  return false;
}

export function handlePlayerBossInteraction(boss, env, triggerType) {
  if (!boss || boss.pinnedByHyper) return false;
  const { player, hitBoss, addPopup, spawnShockwave, spawnBeans, grantShield, getGroundY } = env;

  // 1. Check Interactive Physical Objects First (Walls, Yarn Ball, Magma Meteor, Basketball, Golden Mic, Flush Lever, TNT)!
  for (let i = 0; i < boss.objs.length; i++) {
    const o = boss.objs[i];
    if (o.done) continue;

    // 🐔 Break Quarantine Wall!
    if (o.type === 'q_wall' && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      if (o.x - player.x > -35 && o.x - player.x < 300) {
        o.done = true;
        boss.wallsBroken = (boss.wallsBroken || 0) + 1;
        player.invulnTimer = Math.max(player.invulnTimer, 0.45);
        player.actionCd = 0;
        playSfx('crater');
        const wy = getGroundY(o.x);
        spawnShockwave(o.x, wy - 55, 185, '#38bdf8');
        const full = boss.wallsBroken >= 2;
        const dmg = (full ? 26 : 14);
        if (full) {
          boss.mech = 'idle';
          boss.mechTimer = 1.8;
          boss.stunTimer = 1.7;
          boss.vy = 140; // Physically falls to road with gravity!
          addPopup(`⚡-${dmg}!`, o.x, wy - 115, '#fde047', 20);
        } else {
          addPopup(`⚡-${dmg}!`, o.x, wy - 100, '#38bdf8', 18);
        }
        hitBoss(dmg, full, true);
        return true;
      }
    }

    // 🐱 Kick Giant Yarn Ball Straight Back into Hakimi!
    if (o.type === 'yarn_ball' && !o.reflected && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      if (Math.abs(o.x - player.x) < 290) {
        o.reflected = true;
        o.vx = player.vx + 760;
        o.vy = -180;
        player.invulnTimer = Math.max(player.invulnTimer, 0.65);
        player.actionCd = 0;
        playSfx('parry');
        addPopup('↩️ 反击!', o.x, o.y - 36, '#fde047', 19);
        return true;
      }
    }

    // 🐱 Swat Boss Hakimi's Bouncing Mini Round-Head Maodie ("小圆头耄耋")!
    if (o.type === 'boss_maodie' && !o.reflected && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      if (Math.abs(o.x - player.x) < 245) {
        o.reflected = true;
        o.vx = player.vx + 740;
        o.vy = -240;
        player.invulnTimer = Math.max(player.invulnTimer, 0.38);
        player.actionCd = 0;
        playSfx('parry');
        spawnBeans(o.x, o.y, 2, 1);
        return true;
      }
    }

    // 🐉 Home-Run Reflect Colossal Magma Meteor Back into Lava Dragon!
    if (o.type === 'magma_meteor' && !o.reflected && (triggerType === 'parry' || triggerType === 'skill')) {
      if (Math.abs(o.x - player.x) < 300) {
        o.reflected = true;
        o.vx = player.vx + 820;
        o.vy = -140;
        player.invulnTimer = Math.max(player.invulnTimer, 0.85);
        player.actionCd = 0;
        playSfx('parry');
        spawnShockwave(o.x, o.y, 210, '#fde047');
        addPopup('↩️ 反击!', o.x, o.y - 36, '#fde047', 19);
        return true;
      }
    }

    // 🎵 Smash Music Wheel with 铁山靠 / Skill!
    if (o.type === 'music_wheel' && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      if (Math.abs(o.x - player.x) < 280) {
        o.done = true;
        player.invulnTimer = Math.max(player.invulnTimer, 0.45);
        player.actionCd = 0;
        playSfx('parry');
        return true;
      }
    }

    // 🐕 Detonate TNT Wall with 铁山靠 / Skill to Blast Pursuing Dagou!
    if (o.type === 'tnt_wall' && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      if (Math.abs(o.x - player.x) < 290) {
        o.done = true;
        boss.playerHasBone = false;
        boss.mech = 'idle';
        boss.mechTimer = 1.9;
        boss.stunTimer = 1.7;
        boss.relVx = -290;
        player.invulnTimer = Math.max(player.invulnTimer, 0.85);
        playSfx('crater');
        const dmg = 26;
        spawnShockwave(o.x, getGroundY(o.x) - 40, 290, '#ef4444');
        addPopup(`⚡-${dmg}!`, o.x, getGroundY(o.x) - 105, '#fde047', 20);
        hitBoss(dmg, true, true);
        return true;
      }
    }

    // 🎵 Smack Golden Microphone to Blast Sonic Shockwave into Manbo!
    if (o.type === 'gold_mic' && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      if (Math.hypot(o.x - player.x, o.y - (player.y - 48)) < 280) {
        o.done = true;
        boss.cursedFaceTimer = 2.2;
        boss.mech = 'idle';
        boss.mechTimer = 1.8;
        boss.stunTimer = 1.6;
        boss.recoilX = 110;
        playSfx('crate');
        playCriticalMomentVoice('boss_clash_parry', 'manbo_queen');
        const dmg = 26;
        spawnShockwave(boss.worldX, getGroundY(boss.worldX) - 52 + boss.yOff, 280, '#fde047');
        addPopup(`⚡-${dmg}!`, boss.worldX - 20, getGroundY(boss.worldX) - 115, '#fde047', 20);
        hitBoss(dmg, true, true);
        return true;
      }
    }

    // 🐸 Trigger Golden Flush Lever by Parry / Skill / Projectile!
    if (o.type === 'flush_lever' && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      const oy = getGroundY(o.x) - o.hOff;
      if (Math.hypot(o.x - player.x, oy - (player.y - 48)) < 175) {
        o.done = true;
        boss.mech = 'idle';
        boss.mechTimer = 1.9;
        boss.stunTimer = 1.8;
        boss.recoilX = 120;
        playSfx('crate');
        const dmg = 28;
        spawnShockwave(boss.worldX, getGroundY(boss.worldX) - 55, 310, '#38bdf8');
        spawnBeans(o.x, oy, 8, 2);
        addPopup(`⚡-${dmg}!`, o.x, oy - 35, '#fde047', 20);
        hitBoss(dmg, true, true);
        return true;
      }
    }

    // 🏀 Steal Live Basketball!
    if (o.type === 'live_ball' && !boss.playerCarryingBall && (triggerType === 'parry' || triggerType === 'skill' || triggerType === 'projectile')) {
      if (Math.hypot(o.x - (player.x + 28), o.y - (player.y - 50)) < 290) {
        o.done = true;
        boss.playerCarryingBall = true;
        player.invulnTimer = Math.max(player.invulnTimer, 0.55);
        player.actionCd = 0;
        playSfx('parry');
        addPopup('🏀 持球!', player.x + 25, player.y - 96, '#4ade80', 18);
        return true;
      }
    }
  }

  // 2. Boss Direct Physical Clash Counters!

  // 🏀 Kun Mecha: Slam Dunk when carrying ball OR Shoulder-Charge Clash!
  if (boss.kind === 'kun_mecha') {
    const hoopX = boss.worldX - 52;
    const hoopY = getGroundY(hoopX) - 142;
    if (boss.playerCarryingBall && (triggerType === 'jump' || triggerType === 'parry' || triggerType === 'skill')) {
      if (Math.abs(player.x - hoopX) < 290) {
        boss.playerCarryingBall = false;
        boss.mech = 'idle';
        boss.mechTimer = 1.9;
        boss.stunTimer = 1.7;
        boss.recoilX = 120;
        player.vy = -540;
        player.onGround = false;
        player.invulnTimer = Math.max(player.invulnTimer, 0.95);
        playSfx('crate');
        playCriticalMomentVoice('boss_clash_parry', 'kun_mecha');
        const dmg = 28;
        spawnShockwave(hoopX, hoopY, 290, '#fb923c');
        spawnBeans(hoopX, hoopY + 25, 8, 2);
        grantShield(15, 5.5, false);
        addPopup(`⚡-${dmg}!`, hoopX - 20, hoopY - 28, '#fde047', 21);
        hitBoss(dmg, true, true);
        return true;
      }
    }
    if (boss.mech === 'shoulder_charge' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || boss.mechSub === 1) && (triggerType === 'parry' || triggerType === 'skill')) {
      if (Math.abs(boss.worldX - player.x) < 310) {
        boss.mech = 'idle';
        boss.mechTimer = 1.8;
        boss.stunTimer = 1.6;
        boss.relVx = 320;
        player.invulnTimer = Math.max(player.invulnTimer, 0.85);
        playSfx('parry');
        const dmg = 24;
        spawnShockwave(player.x + 55, player.y - 45, 260, '#fde047');
        addPopup(`⚡-${dmg}!`, boss.worldX - 25, getGroundY(boss.worldX) - 105, '#fde047', 20);
        hitBoss(dmg, true, true);
        return true;
      }
    }
  }

  // 🐕 Dagou Jiao: Rear Kick Parry during Lunge!
  if (boss.kind === 'dagou_jiao' && boss.mech === 'rear_lunge' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || boss.mechSub === 1) && (triggerType === 'parry' || triggerType === 'skill')) {
    if (boss.worldX > player.x - 235) {
      boss.mech = 'idle';
      boss.mechTimer = 1.75;
      boss.stunTimer = 1.5;
      boss.relVx = -280; // Smoothly knocked backward!
      player.invulnTimer = Math.max(player.invulnTimer, 0.85);
      playSfx('parry');
      playCriticalMomentVoice('boss_clash_parry', 'dagou_jiao');
      const dmg = 24;
      spawnShockwave(player.x - 32, player.y - 32, 230, '#fde047');
      addPopup(`⚡-${dmg}!`, player.x - 25, player.y - 96, '#fde047', 20);
      hitBoss(dmg, true, true);
      return true;
    }
  }

  // 🎵 Manbo: Bat Giant Bouncing Head Backward!
  if (boss.kind === 'manbo_queen' && boss.mech === 'giant_head_bounce' && (triggerType === 'parry' || triggerType === 'skill')) {
    const by = getGroundY(boss.worldX) - 52 + boss.yOff;
    if (Math.hypot(boss.worldX - (player.x + 32), by - (player.y - 52)) < 280) {
      boss.cursedFaceTimer = 2.0;
      boss.mech = 'idle';
      boss.mechTimer = 1.85;
      boss.stunTimer = 1.6;
      boss.vy = -260;
      boss.relVx = 250; // Physically batted back to the right & stunned!
      player.invulnTimer = Math.max(player.invulnTimer, 0.85);
      player.actionCd = 0;
      playSfx('parry');
      playCriticalMomentVoice('boss_clash_parry', 'manbo_queen');
      const dmg = 26;
      spawnShockwave(boss.worldX, by, 250, '#a78bfa');
      addPopup(`⚡-${dmg}!`, boss.worldX, by - 55, '#fde047', 20);
      hitBoss(dmg, true, true);
      return true;
    }
  }

  // 🐔 Dingdong Ji: Parry Swoop Dive!
  if (boss.kind === 'dingdong_ji' && boss.mech === 'swoop_dive' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || boss.mechSub === 1) && (triggerType === 'parry' || triggerType === 'skill')) {
    if (Math.abs(boss.worldX - player.x) < 315) {
      boss.mech = 'idle';
      boss.mechTimer = 1.85;
      boss.stunTimer = 1.7;
      boss.relVx = 250;
      boss.vy = -180;
      player.invulnTimer = Math.max(player.invulnTimer, 0.85);
      playSfx('parry');
      const dmg = 26;
      spawnShockwave(boss.worldX, getGroundY(boss.worldX) - 50 + boss.yOff, 250, '#4ade80');
      addPopup(`⚡-${dmg}!`, boss.worldX, getGroundY(boss.worldX) - 110, '#fde047', 20);
      hitBoss(dmg, true, true);
      return true;
    }
  }

  // 🐸 Titan Naiwa: Chop Sweeping Pink Tongue!
  if (boss.kind === 'titan_naiwa' && boss.mech === 'tongue_sweep' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || boss.mechSub === 1) && (triggerType === 'parry' || triggerType === 'skill')) {
    boss.mech = 'idle';
    boss.mechTimer = 1.8;
    boss.stunTimer = 1.6;
    boss.recoilX = 110;
    player.invulnTimer = Math.max(player.invulnTimer, 0.85);
    playSfx('parry');
    const dmg = 24;
    spawnShockwave(player.x + 65, player.y - 38, 240, '#ec4899');
    addPopup(`⚡-${dmg}!`, boss.worldX - 30, getGroundY(boss.worldX) - 105, '#f472b6', 20);
    hitBoss(dmg, true, true);
    return true;
  }

  // 🐱 Demon Hakimi: Bat Cat Mid-Pounce!
  if (boss.kind === 'demon_hakimi' && boss.mech === 'cat_pounce' && ((boss.mechSub === 0 && boss.mechTimer < 0.72) || boss.mechSub === 1) && (triggerType === 'parry' || triggerType === 'skill')) {
    if (Math.abs(boss.worldX - player.x) < 315) {
      boss.mech = 'idle';
      boss.mechTimer = 1.85;
      boss.stunTimer = 1.65;
      boss.vy = -340;
      boss.relVx = 290;
      player.invulnTimer = Math.max(player.invulnTimer, 0.85);
      playSfx('parry');
      const dmg = 26;
      spawnShockwave(boss.worldX, getGroundY(boss.worldX) - 52 + boss.yOff, 250, '#f472b6');
      addPopup(`⚡-${dmg}!`, boss.worldX, getGroundY(boss.worldX) - 110, '#fde047', 20);
      hitBoss(dmg, true, true);
      return true;
    }
  }

  return false;
}

export function updateBossEngine(boss, env, dt) {
  const {
    player, cam, W, threatMult, getGroundY,
    takeDamage, hitBoss, addPopup, spawnShockwave, spawnBeans, grantShield, spawnRail, spawnPit
  } = env;

  if (boss.cursedFaceTimer > 0) boss.cursedFaceTimer -= dt;
  if (boss.counterBannerTimer > 0) boss.counterBannerTimer -= dt;
  if (boss.hitSquash > 0) boss.hitSquash = Math.max(0, boss.hitSquash - dt * 4.5);
  if (boss.recoilX > 0.5) {
    const push = boss.recoilX * Math.min(1, dt * 10);
    boss.worldX += (boss.kind === 'dagou_jiao' ? -push : push);
    boss.recoilX = Math.max(0, boss.recoilX - push);
  }

  if (boss.mech !== 'rising_flood' && boss.floodLevel > 0) {
    boss.floodLevel = Math.max(0, boss.floodLevel - dt * 1.6);
  }

  const tempo = (boss.phase >= 3 ? 1.28 : (boss.phase === 2 ? 1.14 : 1.0)) * Math.min(1.55, 0.96 + threatMult * 0.08);
  const rightHomeX = player.x + (boss.kind === 'lava_dragon' ? 305 : 275);
  const rearDogHomeX = player.x - 155;

  // ==================== CONTINUOUS GRAVITY STUN / KNOCKDOWN STATE (ZERO TELEPORT!) ====================
  if (boss.stunTimer > 0) {
    boss.stunTimer -= dt;
    const home = boss.kind === 'dagou_jiao' ? (rearDogHomeX - 35) : rightHomeX;
    if (Math.abs(boss.relVx || 0) > 8) {
      boss.worldX += (player.vx + boss.relVx) * dt;
      boss.relVx *= Math.max(0, 1 - dt * 4.5);
    } else {
      approachWorldX(boss, player.vx, home, 4.5, dt);
    }
    // Physical gravity fall to road (yOff = 0) instead of snapping!
    if (boss.yOff < 0 || (boss.vy || 0) !== 0) {
      boss.vy = (boss.vy || 0) + 980 * dt;
      boss.yOff += boss.vy * dt;
      if (boss.yOff >= 0) {
        boss.yOff = 0;
        boss.vy = Math.abs(boss.vy) > 140 ? -boss.vy * 0.32 : 0;
      }
    }
    return;
  }

  // ==================== SMOOTH IDLE POSITIONING & NEXT SKILL SELECTION ====================
  if (boss.mech === 'idle') {
    boss.relVx = 0;
    const home = boss.kind === 'dagou_jiao' ? rearDogHomeX : rightHomeX;
    approachWorldX(boss, player.vx, home, 5.2, dt);

    const bob = Math.sin(performance.now() * 0.006) * 10;
    const hoverTarget = boss.kind === 'dingdong_ji' ? (-98 + bob) : (boss.kind === 'manbo_queen' ? (-36 + bob) : 0);
    boss.vy = 0;
    approachYOff(boss, hoverTarget, 5.0, dt);

    boss.mechTimer -= dt * tempo;
    if (boss.mechTimer > 0) return;

    const pickIdx = (boss.skillIdx = (boss.skillIdx || 0) + 1) % 2;
    boss.objs.length = 0;
    boss.mechSub = 0;

    if (boss.kind === 'manbo_queen') {
      if (pickIdx === 1) {
        boss.mech = 'giant_head_bounce';
        boss.mechSub = 0; // 0.65s visible crouch windup before bouncing!
        boss.mechTimer = 0.95;
      } else {
        boss.mech = 'sonic_ring_mic';
        boss.mechTimer = 4.2;
        boss.objs.push(
          { type: 'music_wheel', x: boss.worldX - 30, vx: -185, rot: 0, done: false },
          { type: 'music_pad', x: player.x + 135, done: false },
          { type: 'gold_mic', x: boss.worldX - 20, y: getGroundY(boss.worldX) - 125, vx: player.vx - 95, vy: -260, done: false }
        );
      }
    } else if (boss.kind === 'dagou_jiao') {
      if (pickIdx === 1) {
        boss.mech = 'rear_lunge';
        boss.mechSub = 0; // 1.0s crouch & bark telegraph!
        boss.mechTimer = 1.25;
      } else {
        boss.mech = 'bone_bait';
        boss.mechTimer = 4.5;
        boss.playerHasBone = false;
        boss.objs.push(
          { type: 'meat_bone', x: player.x + 275, y: getGroundY(player.x + 275) - 46, done: false },
          { type: 'tnt_wall', x: player.x + 635, done: false }
        );
      }
    } else if (boss.kind === 'dingdong_ji') {
      if (pickIdx === 1) {
        boss.mech = 'barricade_drop';
        boss.mechTimer = 4.2;
        boss.wallsBroken = 0;
        for (let k = 0; k < 2; k++) {
          const wx = player.x + 255 + k * 255;
          boss.objs.push({ type: 'q_wall', x: wx, yOff: -95, fallVy: 0, done: false });
        }
      } else {
        boss.mech = 'swoop_dive';
        boss.mechSub = 0; // 0.95s visible aim telegraph!
        boss.mechTimer = 1.25;
      }
    } else if (boss.kind === 'titan_naiwa') {
      if (pickIdx === 1) {
        boss.mech = 'rising_flood';
        boss.mechTimer = 4.8;
        boss.drownTick = 1.05;
        spawnRail(player.x + 55, 560, 96, 'suspenders');
        for (let k = 0; k < 4; k++) {
          boss.objs.push({ type: 'float_pad', x: player.x + 85 + k * 150, hOff: 72 + (k % 2) * 26, done: false });
        }
        boss.objs.push({ type: 'flush_lever', x: player.x + 600, hOff: 92, done: false });
      } else {
        boss.mech = 'tongue_sweep';
        boss.mechSub = 0; // 1.0s open-mouth pink glow telegraph!
        boss.mechTimer = 1.25;
        boss.tongueLen = 0;
      }
    } else if (boss.kind === 'kun_mecha') {
      if (pickIdx === 1) {
        boss.mech = 'streetball_1v1';
        boss.mechTimer = 5.2;
        boss.playerCarryingBall = false;
        boss.objs.push({
          type: 'live_ball',
          x: boss.worldX - 45,
          y: getGroundY(boss.worldX) - 92,
          vx: player.vx - 108,
          vy: -360,
          done: false
        });
      } else {
        boss.mech = 'shoulder_charge';
        boss.mechSub = 0; // 0.95s golden suspender charge telegraph!
        boss.mechTimer = 1.25;
      }
    } else if (boss.kind === 'demon_hakimi') {
      const hkMode = boss.skillIdx % 3;
      if (hkMode === 0) {
        boss.mech = 'maodie_barrage';
        boss.mechTimer = 4.6;
        for (let m = 0; m < 5; m++) {
          boss.objs.push({
            type: 'boss_maodie',
            x: boss.worldX - 24 + m * 52,
            y: getGroundY(boss.worldX) - 62 - (m % 2) * 34,
            vx: player.vx - (115 + m * 16),
            vy: -310 - (m % 3) * 75,
            rot: 0,
            reflected: false,
            done: false
          });
        }
        addPopup('🐱 吃我一窝圆头耄耋!!', boss.worldX - 45, getGroundY(boss.worldX) - 120, '#fb923c', 18);
      } else if (hkMode === 1) {
        boss.mech = 'cat_pounce';
        boss.mechSub = 0; // 0.95s unmistakable cat-butt crouch + red arc preview!
        boss.mechTimer = 1.25;
      } else {
        boss.mech = 'yarn_ball_kick';
        boss.mechTimer = 4.2;
        boss.objs.push({
          type: 'yarn_ball',
          x: boss.worldX - 38,
          y: getGroundY(boss.worldX) - 36,
          vx: player.vx - 148,
          vy: -320,
          rot: 0,
          reflected: false,
          done: false
        });
      }
    } else {
      // 🐉 Lava Dragon
      if (pickIdx === 1) {
        boss.mech = 'highway_collapse';
        boss.mechTimer = 4.0;
        boss.bridgeBonusDone = false;
        for (let k = 0; k < 2; k++) {
          const px = player.x + 215 + k * 295;
          spawnPit(px, 140);
          spawnRail(px - 55, 255, 96 + k * 18, 'maglev');
        }
      } else {
        boss.mech = 'magma_meteor_spit';
        boss.mechSub = 0; // 1.25s glowing magma charge in jaws!
        boss.mechTimer = 1.25;
      }
    }
    return;
  }

  // ==================== ACTIVE PHYSICAL MECHANIC EXECUTION ====================

  // 1. 🎵 曼波 (Continuous Gravity Bouncing Head + Music Wheel & Golden Mic)
  if (boss.kind === 'manbo_queen') {
    if (boss.mech === 'giant_head_bounce') {
      if (boss.mechSub === 0) {
        approachWorldX(boss, player.vx, rightHomeX, 6, dt);
        approachYOff(boss, 8, 9, dt); // Visibly squashes onto road before jumping!
        boss.mechTimer -= dt;
        if (boss.mechTimer <= 0) {
          boss.mechSub = 1;
          boss.mechTimer = 4.6;
          boss.relVx = -122;
          boss.vy = -590;
          playSfx('jump');
        }
      } else {
        boss.mechTimer -= dt;
        boss.worldX += (player.vx + boss.relVx) * dt;
        boss.vy += 860 * dt;
        boss.yOff += boss.vy * dt;

        const leftBound = player.x - 90;
        const rightBound = player.x + 320;
        if (boss.worldX < leftBound && boss.relVx < 0) boss.relVx = 175;
        if (boss.worldX > rightBound && boss.relVx > 0) boss.relVx = -122;

        if (boss.yOff >= 0) {
          boss.yOff = 0;
          boss.vy = -590; // High 195px bounce arc so player can cleanly ride underneath!
          playSfx('jump');
        }
        const gy = getGroundY(boss.worldX);
        const bossCenterY = gy - 56 + boss.yOff;
        if (Math.abs(player.x - boss.worldX) < 62) {
          if (player.y < bossCenterY - 8 && player.vy >= -40) {
            player.vy = -600;
            player.onGround = false;
            player.invulnTimer = Math.max(player.invulnTimer, 0.85);
            boss.cursedFaceTimer = 2.0;
            boss.vy = 260;
            boss.relVx = 210;
            playSfx('crate');
            playCriticalMomentVoice('boss_clash_parry', 'manbo_queen');
            const dmg = 26;
            spawnShockwave(boss.worldX, bossCenterY, 250, '#fde047');
            addPopup(`⚡-${dmg}!`, boss.worldX, bossCenterY - 58, '#fde047', 21);
            hitBoss(dmg, false, true);
          } else if (Math.abs((player.y - 40) - bossCenterY) < 42 && boss.cursedFaceTimer <= 0 && player.giantTimer <= 0 && player.rocketDashTimer <= 0) {
            boss.relVx = 195;
            boss.vy = -420;
            takeDamage(9);
          }
        }
        if (boss.mechTimer <= 0) { boss.mech = 'idle'; boss.mechTimer = 1.4; }
      }
    } else if (boss.mech === 'sonic_ring_mic') {
      boss.mechTimer -= dt;
      approachWorldX(boss, player.vx, rightHomeX, 5.5, dt);
      approachYOff(boss, -32 + Math.sin(performance.now() * 0.012) * 10, 6, dt);

      for (let i = 0; i < boss.objs.length; i++) {
        const o = boss.objs[i];
        if (o.done) continue;
        if (o.type === 'music_pad') {
          const py = getGroundY(o.x);
          if (Math.abs(player.x - o.x) < 48 && Math.abs(player.y - py) < 34 && player.vy >= -40) {
            player.vy = -690;
            player.onGround = false;
            player.jumpsLeft = 2;
            playSfx('chime', 2);
          }
        } else if (o.type === 'music_wheel') {
          o.x += (player.vx + o.vx) * dt;
          o.rot -= 10 * dt;
          const wy = getGroundY(o.x);
          if (Math.abs(player.x - o.x) < 30 && player.y > wy - 44) {
            o.done = true;
            if (player.giantTimer <= 0 && player.rocketDashTimer <= 0) takeDamage(10);
          }
        } else if (o.type === 'gold_mic') {
          o.vy += 420 * dt;
          o.x += o.vx * dt;
          o.y += o.vy * dt;
          const fy = getGroundY(o.x) - 34;
          if (o.y >= fy) { o.y = fy; o.vy = -260; }
          if (Math.hypot(o.x - player.x, o.y - (player.y - 48)) < 68) {
            handlePlayerBossInteraction(boss, env, 'parry');
            return;
          }
        }
      }
      if (boss.mechTimer <= 0) { boss.mech = 'idle'; boss.mechTimer = 1.4; }
    }
    return;
  }

  // 2. 🐕 大狗嚼 (Smooth Rear Lunge + Bone Bait into TNT — ZERO TELEPORT!)
  if (boss.kind === 'dagou_jiao') {
    if (boss.mech === 'rear_lunge') {
      if (boss.mechSub === 0) {
        approachWorldX(boss, player.vx, rearDogHomeX - 20, 7, dt);
        approachYOff(boss, 8, 10, dt); // Visibly crouches low!
        boss.mechTimer -= dt;
        if (boss.mechTimer <= 0) {
          boss.mechSub = 1;
          boss.mechTimer = 1.25;
          boss.relVx = 310;
          boss.vy = -160;
          playSfx('slash');
        }
      } else {
        boss.mechTimer -= dt;
        boss.worldX += (player.vx + boss.relVx) * dt;
        boss.vy += 720 * dt;
        boss.yOff = Math.min(0, boss.yOff + boss.vy * dt);

        const gy = getGroundY(player.x);
        if (Math.abs(boss.worldX - player.x) < 42) {
          if (player.y < gy - 32 || player.giantTimer > 0 || player.rocketDashTimer > 0) {
            // Player jumped over the dog! Dog physically overshoots & tumbles stunned!
            boss.mech = 'idle';
            boss.mechTimer = 1.75;
            boss.stunTimer = 1.5;
            boss.relVx = 160; // Continues sliding smoothly forward, NO teleport!
            playSfx('crater');
            const dmg = 18;
            addPopup(`⚡-${dmg}!`, boss.worldX, gy - 92, '#4ade80', 18);
            hitBoss(dmg, true, true);
            return;
          } else {
            boss.mech = 'idle';
            boss.mechTimer = 1.6;
            boss.relVx = -240; // Bounces smoothly back behind bike!
            takeDamage(9);
            return;
          }
        }
        if (boss.worldX > player.x + 135 || boss.mechTimer <= 0) {
          boss.mech = 'idle';
          boss.mechTimer = 1.5;
        }
      }
    } else if (boss.mech === 'bone_bait') {
      boss.mechTimer -= dt;
      const bone = boss.objs[0];
      const wall = boss.objs[1];
      if (bone && !bone.done && Math.hypot(bone.x - player.x, bone.y - (player.y - 46)) < 76) {
        bone.done = true;
        boss.playerHasBone = true;
        playSfx('crate');
      }
      if (boss.playerHasBone) {
        boss.worldX += (player.vx + 365) * dt;
        approachYOff(boss, -Math.abs(Math.sin(performance.now() * 0.035)) * 16, 12, dt);
        if (wall && !wall.done && boss.worldX >= wall.x - 26) {
          wall.done = true;
          boss.playerHasBone = false;
          boss.mech = 'idle';
          boss.mechTimer = 2.0;
          boss.stunTimer = 1.85;
          boss.relVx = -320; // Smoothly blasted backward by TNT!
          boss.vy = -260;
          playSfx('crater');
          const dmg = 28;
          spawnShockwave(wall.x, getGroundY(wall.x) - 40, 320, '#ef4444');
          spawnBeans(wall.x, getGroundY(wall.x) - 45, 8, 2);
          addPopup(`⚡-${dmg}!`, wall.x, getGroundY(wall.x) - 115, '#fde047', 21);
          hitBoss(dmg, true, true);
          return;
        }
      } else {
        approachWorldX(boss, player.vx, rearDogHomeX, 5.5, dt);
        approachYOff(boss, 0, 8, dt);
      }
      if (wall && !wall.done && Math.abs(player.x - wall.x) < 34 && player.y > getGroundY(wall.x) - 68) {
        wall.done = true;
        if (player.giantTimer <= 0 && player.rocketDashTimer <= 0) takeDamage(9);
      }
      if (boss.mechTimer <= 0) {
        boss.playerHasBone = false;
        boss.mech = 'idle';
        boss.mechTimer = 1.4;
      }
    }
    return;
  }

  // 3. 🐔 叮咚鸡 (Smooth Low-Altitude Flight + Drop Barricades + Physical Swoop Dive)
  if (boss.kind === 'dingdong_ji') {
    if (boss.mech === 'barricade_drop') {
      boss.mechTimer -= dt;
      approachWorldX(boss, player.vx, rightHomeX - 15, 5.5, dt);
      approachYOff(boss, -102 + Math.sin(performance.now() * 0.012) * 8, 6, dt);

      let activeCnt = 0;
      for (let i = 0; i < boss.objs.length; i++) {
        const w = boss.objs[i];
        if (w.done) continue;
        activeCnt++;
        if (w.yOff < 0) {
          w.fallVy = (w.fallVy || 0) + 920 * dt;
          w.yOff = Math.min(0, w.yOff + w.fallVy * dt);
        }
        const gy = getGroundY(w.x);
        if (Math.abs(player.x - w.x) < 32 && player.y > gy - 84 + w.yOff) {
          w.done = true;
          if (player.giantTimer > 0 || player.rocketDashTimer > 0) {
            playSfx('crater');
          } else {
            takeDamage(9);
          }
        }
      }
      if (activeCnt === 0 || boss.mechTimer <= 0) {
        boss.mech = 'idle';
        boss.mechTimer = 1.45;
      }
    } else if (boss.mech === 'swoop_dive') {
      if (boss.mechSub === 0) {
        approachWorldX(boss, player.vx, player.x + 285, 6.5, dt);
        approachYOff(boss, -118, 6, dt);
        boss.mechTimer -= dt;
        if (boss.mechTimer <= 0) {
          boss.mechSub = 1;
          boss.mechTimer = 1.35;
          boss.relVx = -320; // Swoops smoothly leftward along the road!
          playSfx('slash');
        }
      } else {
        boss.mechTimer -= dt;
        boss.worldX += (player.vx + boss.relVx) * dt;
        approachYOff(boss, -18, 9.5, dt); // Glides just above road!

        const gy = getGroundY(boss.worldX);
        const by = gy - 50 + boss.yOff;
        if (Math.abs(player.x - boss.worldX) < 52) {
          if (player.y < by - 8 && player.vy >= -40) {
            player.vy = -580;
            player.onGround = false;
            player.invulnTimer = Math.max(player.invulnTimer, 0.85);
            boss.mech = 'idle';
            boss.mechTimer = 1.85;
            boss.stunTimer = 1.7;
            boss.vy = 180;
            boss.relVx = 210;
            playSfx('crate');
            const dmg = 26;
            spawnShockwave(boss.worldX, by, 240, '#4ade80');
            addPopup(`⚡-${dmg}!`, boss.worldX, by - 50, '#fde047', 20);
            hitBoss(dmg, true, true);
            return;
          } else if (Math.abs((player.y - 38) - by) < 38 && player.giantTimer <= 0 && player.rocketDashTimer <= 0) {
            boss.relVx = 220;
            boss.mech = 'idle';
            boss.mechTimer = 1.5;
            takeDamage(9);
            return;
          }
        }
        if (boss.worldX < player.x - 110 || boss.mechTimer <= 0) {
          boss.mech = 'idle';
          boss.mechTimer = 1.5;
        }
      }
    }
    return;
  }

  // 4. 🐸 黄金马桶蛙皇 (Gradual Floodwater Parkour + Physical Ground Tongue Sweep)
  if (boss.kind === 'titan_naiwa') {
    approachWorldX(boss, player.vx, rightHomeX, 5.5, dt);
    approachYOff(boss, 0, 7, dt);

    if (boss.mech === 'rising_flood') {
      boss.floodLevel = Math.min(1, (boss.floodLevel || 0) + dt * 0.72);
      boss.mechTimer -= dt;

      let onSafePad = false;
      for (let i = 0; i < boss.objs.length; i++) {
        const o = boss.objs[i];
        if (o.done) continue;
        const oy = getGroundY(o.x) - o.hOff;
        if (o.type === 'float_pad') {
          if (Math.abs(player.x - o.x) < 56 && Math.abs(player.y - oy) < 36 && player.vy >= -50) {
            onSafePad = true;
            player.y = oy;
            player.vy = -630;
            player.onGround = false;
            player.jumpsLeft = 2;
            playSfx('jump');
          }
        } else if (o.type === 'flush_lever') {
          if (Math.hypot(player.x - o.x, (player.y - 45) - oy) < 82) {
            handlePlayerBossInteraction(boss, env, 'parry');
            return;
          }
        }
      }
      if (boss.floodLevel > 0.85 && !onSafePad && !player.onRail && player.giantTimer <= 0 && player.rocketDashTimer <= 0 && player.y >= getGroundY(player.x) - 14) {
        player.vx = Math.min(player.vx, 245);
        boss.drownTick = (boss.drownTick || 0) - dt;
        if (boss.drownTick <= 0) {
          boss.drownTick = 0.85;
          player.vy = -550;
          player.onGround = false;
          takeDamage(9);
        }
      }
      if (boss.mechTimer <= 0) { boss.mech = 'idle'; boss.mechTimer = 1.45; }
    } else if (boss.mech === 'tongue_sweep') {
      if (boss.mechSub === 0) {
        boss.mechTimer -= dt;
        if (boss.mechTimer <= 0) {
          boss.mechSub = 1;
          boss.mechTimer = 1.25;
          boss.tongueLen = 0;
          playSfx('slash');
        }
      } else {
        boss.mechTimer -= dt;
        const maxReach = Math.max(240, boss.worldX - player.x + 55);
        boss.tongueLen = Math.min(maxReach, (boss.tongueLen || 0) + 640 * dt);
        const tipX = boss.worldX - boss.tongueLen;
        const gy = getGroundY(player.x);
        if (tipX <= player.x + 28 && tipX >= player.x - 45 && !boss.tongueHitDone) {
          if (player.y > gy - 38 && player.giantTimer <= 0 && player.rocketDashTimer <= 0) {
            boss.tongueHitDone = true;
            takeDamage(9);
          }
        }
        if (boss.mechTimer <= 0) {
          boss.tongueHitDone = false;
          boss.tongueLen = 0;
          boss.mech = 'idle';
          boss.mechTimer = 1.45;
        }
      }
    }
    return;
  }

  // 5. 🏀 两年半机甲坤王 (Physical Live Basketball Steal & Dunk + Shoulder Charge Clash)
  if (boss.kind === 'kun_mecha') {
    if (boss.mech === 'streetball_1v1') {
      const targetDist = boss.playerCarryingBall ? 195 : 275;
      approachWorldX(boss, player.vx, player.x + targetDist, 5.8, dt);
      approachYOff(boss, Math.sin(performance.now() * 0.014) * 10, 7, dt);
      boss.mechTimer -= dt;

      const b = boss.objs[0];
      if (!boss.playerCarryingBall && b && !b.done) {
        b.vy += 880 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const fy = getGroundY(b.x) - 28;
        if (b.y >= fy) {
          b.y = fy;
          b.vy = -510;
          playSfx('jump');
        }
        const distPlayer = Math.hypot(b.x - (player.x + 18), b.y - (player.y - 46));
        if (distPlayer < 64) {
          if (player.y < b.y - 6 || player.giantTimer > 0 || player.rocketDashTimer > 0) {
            // Jumped on / intercepted the ball -> steal!
            b.done = true;
            boss.playerCarryingBall = true;
            playSfx('parry');
            addPopup('🏀 持球!', player.x + 25, player.y - 96, '#4ade80', 18);
          } else {
            // Physical ball hit player's chest!
            b.done = true;
            takeDamage(10);
            boss.mech = 'idle';
            boss.mechTimer = 1.4;
          }
        } else if (b.x < player.x - 140) {
          // Ball cleanly dodged past behind player — ZERO unfair off-screen damage!
          b.done = true;
          boss.mech = 'idle';
          boss.mechTimer = 1.25;
        }
      }
      if (boss.mechTimer <= 0) {
        boss.playerCarryingBall = false;
        boss.mech = 'idle';
        boss.mechTimer = 1.35;
      }
    } else if (boss.mech === 'shoulder_charge') {
      if (boss.mechSub === 0) {
        approachWorldX(boss, player.vx, rightHomeX + 15, 6, dt);
        approachYOff(boss, 6, 9, dt);
        boss.mechTimer -= dt;
        if (boss.mechTimer <= 0) {
          boss.mechSub = 1;
          boss.mechTimer = 1.25;
          boss.relVx = -335;
          playSfx('slash');
        }
      } else {
        boss.mechTimer -= dt;
        boss.worldX += (player.vx + boss.relVx) * dt;
        approachYOff(boss, 0, 10, dt);
        const gy = getGroundY(boss.worldX);
        if (Math.abs(boss.worldX - player.x) < 48) {
          if (player.y < gy - 42 || player.giantTimer > 0 || player.rocketDashTimer > 0) {
            player.vy = -560;
            player.onGround = false;
            boss.mech = 'idle';
            boss.mechTimer = 1.7;
            boss.stunTimer = 1.4;
            boss.relVx = 220;
            playSfx('crate');
            const dmg = 20;
            addPopup(`⚡-${dmg}!`, boss.worldX, gy - 98, '#4ade80', 19);
            hitBoss(dmg, true, true);
            return;
          } else {
            boss.relVx = 230;
            boss.mech = 'idle';
            boss.mechTimer = 1.5;
            takeDamage(12);
            return;
          }
        }
        if (boss.worldX < player.x - 95 || boss.mechTimer <= 0) {
          boss.mech = 'idle';
          boss.mechTimer = 1.4;
        }
      }
    }
    return;
  }

  // 6. 🐱 双涡轮机甲猫 (100% Clear Physical Cat Pounce + Giant Yarn Ball Kick-Back — ZERO Blackout, ZERO Invisible Hits!)
  if (boss.kind === 'demon_hakimi') {
    if (boss.mech === 'cat_pounce') {
      if (boss.mechSub === 0) {
        approachWorldX(boss, player.vx, rightHomeX + 10, 6.5, dt);
        approachYOff(boss, 10, 10, dt); // Unmistakable cat crouch wiggle!
        boss.mechTimer -= dt;
        if (boss.mechTimer <= 0) {
          boss.mechSub = 1;
          boss.mechTimer = 1.3;
          boss.relVx = -345;
          boss.vy = -440; // Clear parabolic cat leap!
          playSfx('slash');
        }
      } else {
        boss.mechTimer -= dt;
        boss.worldX += (player.vx + boss.relVx) * dt;
        boss.vy += 880 * dt;
        boss.yOff = Math.min(0, boss.yOff + boss.vy * dt);

        const gy = getGroundY(boss.worldX);
        const by = gy - 48 + boss.yOff;
        if (Math.abs(player.x - boss.worldX) < 48) {
          if (player.y < by - 10 && player.vy >= -40) {
            player.vy = -580;
            player.onGround = false;
            player.invulnTimer = Math.max(player.invulnTimer, 0.85);
            boss.mech = 'idle';
            boss.mechTimer = 1.8;
            boss.stunTimer = 1.65;
            boss.relVx = 240;
            boss.vy = 160;
            playSfx('crate');
            const dmg = 24;
            spawnShockwave(boss.worldX, by, 240, '#f472b6');
            addPopup(`⚡-${dmg}!`, boss.worldX, by - 50, '#fde047', 20);
            hitBoss(dmg, true, true);
            return;
          } else if (Math.abs((player.y - 38) - by) < 38 && player.giantTimer <= 0 && player.rocketDashTimer <= 0) {
            boss.relVx = 240;
            boss.vy = -260;
            boss.mech = 'idle';
            boss.mechTimer = 1.5;
            takeDamage(9);
            return;
          }
        }
        if (boss.worldX < player.x - 105 || boss.mechTimer <= 0) {
          boss.mech = 'idle';
          boss.mechTimer = 1.45;
        }
      }
    } else if (boss.mech === 'yarn_ball_kick') {
      boss.mechTimer -= dt;
      approachWorldX(boss, player.vx, rightHomeX, 5.5, dt);
      approachYOff(boss, 0, 7, dt);

      const yb = boss.objs[0];
      if (yb && !yb.done) {
        yb.vy += 860 * dt;
        yb.x += yb.vx * dt;
        yb.y += yb.vy * dt;
        yb.rot += (yb.reflected ? 16 : -12) * dt;
        const fy = getGroundY(yb.x) - 34;
        if (yb.y >= fy) {
          yb.y = fy;
          yb.vy = -380;
          playSfx('jump');
        }
        if (!yb.reflected) {
          if (Math.hypot(yb.x - player.x, yb.y - (player.y - 40)) < 44) {
            if (player.giantTimer > 0 || player.rocketDashTimer > 0) {
              yb.reflected = true;
              yb.vx = player.vx + 760;
              yb.vy = -180;
            } else {
              yb.done = true;
              takeDamage(9);
            }
          } else if (yb.x < player.x - 130) {
            yb.done = true;
          }
        } else {
          // Reflected Yarn Ball slams right into Hakimi and tangles her up!
          const by = getGroundY(boss.worldX) - 50 + boss.yOff;
          if (Math.hypot(yb.x - boss.worldX, yb.y - by) < 76) {
            yb.done = true;
            boss.mech = 'idle';
            boss.mechTimer = 2.0;
            boss.stunTimer = 1.9;
            boss.recoilX = 125;
            playSfx('crate');
            const dmg = 28;
            spawnShockwave(boss.worldX, by, 290, '#f472b6');
            spawnBeans(boss.worldX - 20, by, 8, 2);
            addPopup(`⚡-${dmg}!`, boss.worldX - 20, by - 55, '#fde047', 21);
            hitBoss(dmg, true, true);
            return;
          }
        }
      }
        if (!yb || yb.done || boss.mechTimer <= 0) {
        boss.mech = 'idle';
        boss.mechTimer = 1.4;
      }
    } else if (boss.mech === 'maodie_barrage') {
      boss.mechTimer -= dt;
      approachWorldX(boss, player.vx, rightHomeX + 10, 5.5, dt);
      approachYOff(boss, -Math.abs(Math.sin(performance.now() * 0.02)) * 14, 8, dt);
      let liveCnt = 0;
      for (let i = 0; i < boss.objs.length; i++) {
        const md = boss.objs[i];
        if (md.done || md.type !== 'boss_maodie') continue;
        liveCnt++;
        md.vy += 880 * dt;
        md.x += md.vx * dt;
        md.y += md.vy * dt;
        md.rot += (md.reflected ? 14 : -9) * dt;
        const fy = getGroundY(md.x) - 22;
        if (md.y >= fy) {
          md.y = fy;
          md.vy = -395 - (i % 2) * 55;
        }
        if (!md.reflected) {
          if (Math.hypot(md.x - player.x, md.y - (player.y - 38)) < 36) {
            if (player.giantTimer > 0 || player.rocketDashTimer > 0) {
              md.reflected = true;
              md.vx = player.vx + 740;
              md.vy = -220;
            } else {
              md.done = true;
              takeDamage(8);
            }
          } else if (md.x < player.x - 140) {
            md.done = true;
          }
        } else {
          const by = getGroundY(boss.worldX) - 50 + boss.yOff;
          if (Math.hypot(md.x - boss.worldX, md.y - by) < 70) {
            md.done = true;
            playSfx('parry');
            hitBoss(10, false, true);
          }
        }
      }
      if (liveCnt === 0 || boss.mechTimer <= 0) {
        boss.mech = 'idle';
        boss.mechTimer = 1.35;
      }
    }
    return;
  }

  // 7. 🐉 暗黑熔岩暴龙王 (Lava Chasms + Physical Home-Run Magma Meteor — NEVER sticks onto player!)
  if (boss.kind === 'lava_dragon') {
    approachWorldX(boss, player.vx, rightHomeX, 5.2, dt);
    approachYOff(boss, -12 + Math.sin(performance.now() * 0.012) * 8, 6, dt);

    if (boss.mech === 'highway_collapse') {
      boss.mechTimer -= dt;
      if (player.onRail && !boss.bridgeBonusDone && boss.mechTimer < 3.5) {
        boss.bridgeBonusDone = true;
        boss.mech = 'idle';
        boss.mechTimer = 1.8;
        boss.stunTimer = 1.5;
        boss.recoilX = 110;
        const dmg = 24;
        playSfx('crate');
        addPopup(`⚡-${dmg}!`, boss.worldX - 35, getGroundY(boss.worldX) - 135, '#fde047', 19);
        hitBoss(dmg, true, true);
      }
      if (boss.mechTimer <= 0) {
        boss.bridgeBonusDone = false;
        boss.mech = 'idle';
        boss.mechTimer = 1.4;
      }
    } else if (boss.mech === 'magma_meteor_spit') {
      if (boss.mechSub === 0) {
        boss.mechTimer -= dt;
        if (boss.mechTimer <= 0) {
          boss.mechSub = 1;
          boss.mechTimer = 4.0;
          playSfx('crater');
          boss.objs.push({
            type: 'magma_meteor',
            x: boss.worldX - 55,
            y: getGroundY(boss.worldX) - 62,
            vx: player.vx - 152,
            vy: -180,
            rot: 0,
            reflected: false,
            done: false
          });
        }
      } else {
        boss.mechTimer -= dt;
        const mt = boss.objs[0];
        if (mt && !mt.done) {
          mt.vy += 680 * dt;
          mt.x += mt.vx * dt;
          mt.y += mt.vy * dt;
          mt.rot -= 8 * dt;
          const fy = getGroundY(mt.x) - 38;
          if (mt.y >= fy) {
            mt.y = fy;
            mt.vy = -310;
          }
          if (!mt.reflected) {
            if (Math.hypot(mt.x - player.x, mt.y - (player.y - 42)) < 46) {
              if (player.giantTimer > 0 || player.rocketDashTimer > 0) {
                mt.reflected = true;
                mt.vx = player.vx + 820;
                mt.vy = -140;
              } else {
                mt.done = true;
                takeDamage(10);
              }
            } else if (mt.x < player.x - 140) {
              mt.done = true;
            }
          } else {
            const by = getGroundY(boss.worldX) - 56 + boss.yOff;
            if (Math.hypot(mt.x - boss.worldX, mt.y - by) < 88) {
              mt.done = true;
              boss.mech = 'idle';
              boss.mechTimer = 2.0;
              boss.stunTimer = 2.0;
              boss.recoilX = 140;
              playSfx('crate');
              grantShield(16, 5.5, false);
              const dmg = 32;
              spawnShockwave(boss.worldX, by, 330, '#fde047');
              spawnBeans(boss.worldX - 25, by, 8, 2);
              addPopup(`⚡-${dmg}!`, boss.worldX - 30, by - 65, '#fde047', 21);
              hitBoss(dmg, true, true);
              return;
            }
          }
        }
        if (!mt || mt.done || boss.mechTimer <= 0) {
          boss.mech = 'idle';
          boss.mechTimer = 1.45;
        }
      }
    }
  }
}

// Pure-Visual Target Badge: Pulsing Bullseye Ring + Action Icon (Zero Reading Needed!)
function drawActionIconBadge(ctx, x, y, icon, ringCol = '#fde047', now = 0) {
  const shrinkPhase = 1 - ((now * 0.0017) % 1); // Shrinking timing ring visually guides when to press!
  const outerR = 22 + shrinkPhase * 28;
  const pulse = 1 + Math.sin(now * 0.016) * 0.10;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ringCol;
  ctx.globalAlpha = 0.35 + (1 - shrinkPhase) * 0.55;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, outerR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.scale(pulse, pulse);
  ctx.lineWidth = 4;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = '900 21px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(icon, 0, 1);
  ctx.restore();
}

function drawBouncingArrow(ctx, x, y, icon = '⬇️', col = '#4ade80', now = 0) {
  const bob = Math.sin(now * 0.015) * 7;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.80)';
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = '900 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, 0, 1);
  ctx.restore();
}

export function renderBossArenaAndModel(ctx, boss, env) {
  const { player, startWX, endWX, cam, W, H, getGroundY, drawParryRing } = env;
  const now = performance.now();
  const groundBY = getGroundY(boss.worldX);
  const bx = boss.worldX;
  const by = groundBY - 52 + boss.yOff;

  // -------------------- 1. PURE-VISUAL PHYSICAL OBJECTS & INTUITIVE ICON CUES --------------------

  // 🐸 Titan Naiwa Rising Water + Lotus Pads + Glowing Flush Lever!
  if ((boss.floodLevel || 0) > 0.02) {
    const waterTopY = getGroundY(player.x) - 30 * boss.floodLevel;
    ctx.save();
    ctx.fillStyle = `rgba(6, 182, 212, ${0.48 * boss.floodLevel})`;
    ctx.fillRect(startWX, waterTopY, endWX - startWX, 320);
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let x = startWX; x <= endWX; x += 24) {
      const wy = waterTopY + Math.sin(x * 0.06 + now * 0.015) * 5;
      if (x === startWX) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
    }
    ctx.stroke();
    for (let i = 0; i < boss.objs.length; i++) {
      const o = boss.objs[i];
      if (o.done) continue;
      const oy = getGroundY(o.x) - o.hOff;
      if (o.type === 'float_pad') {
        drawModelOn(ctx, 'lotusPad', o.x, oy, 0, 1.22);
      } else if (o.type === 'flush_lever') {
        ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.roundRect(o.x - 24, oy - 28, 48, 56, 12); ctx.fill(); ctx.stroke();
        ctx.font = '900 26px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🚽', o.x, oy + 10);
        drawActionIconBadge(ctx, o.x, oy - 48, '🐔', '#fde047', now);
      }
    }
    ctx.restore();
  }

  // 🐸 Titan Naiwa Sweeping Pink Tongue!
  if (boss.kind === 'titan_naiwa' && boss.mech === 'tongue_sweep') {
    ctx.save();
    const gy = getGroundY(player.x);
    if (boss.mechSub === 0) {
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.65)';
      ctx.lineWidth = 7;
      ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.moveTo(bx - 28, gy - 26); ctx.lineTo(player.x - 40, gy - 26); ctx.stroke();
      ctx.setLineDash([]);
      drawActionIconBadge(ctx, bx - 70, gy - 54, '🐔', '#f472b6', now);
    } else if ((boss.tongueLen || 0) > 4) {
      const tipX = bx - boss.tongueLen;
      const tipY = getGroundY(tipX) - 24;
      ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx - 24, by + 10); ctx.lineTo(tipX, tipY); ctx.stroke();
      ctx.fillStyle = '#f472b6';
      ctx.beginPath(); ctx.arc(tipX, tipY, 13, 0, Math.PI * 2); ctx.fill();
      drawParryRing(tipX, tipY, Math.abs(tipX - (player.x + 28)));
      drawActionIconBadge(ctx, tipX, tipY - 34, '🐔', '#fde047', now);
    }
    ctx.restore();
  }

  // 🐔 Dingdong Ji Barricades & Swoop Path!
  if (boss.kind === 'dingdong_ji') {
    ctx.save();
    if (boss.mech === 'barricade_drop') {
      for (let i = 0; i < boss.objs.length; i++) {
        const w = boss.objs[i];
        if (w.done || w.x < startWX - 60 || w.x > endWX + 60) continue;
        const gy = getGroundY(w.x) + (w.yOff || 0);
        ctx.fillStyle = '#1d4ed8'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.roundRect(w.x - 17, gy - 112, 34, 112, 6); ctx.fill(); ctx.stroke();
        drawParryRing(w.x, gy - 54, Math.abs(w.x - (player.x + 35)));
        drawActionIconBadge(ctx, w.x, gy - 56, '🐔', '#fde047', now);
      }
    } else if (boss.mech === 'swoop_dive') {
      if (boss.mechSub === 0) {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.80)';
        ctx.lineWidth = 5;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.moveTo(bx - 20, by + 10); ctx.lineTo(player.x + 20, getGroundY(player.x) - 22); ctx.stroke();
        ctx.setLineDash([]);
      }
      drawActionIconBadge(ctx, bx - 15, by - 58, '🐔', '#fde047', now);
      drawBouncingArrow(ctx, bx + 24, by - 58, '👟', '#4ade80', now);
    }
    ctx.restore();
  }

  // 🐕 Dagou Jiao Rear Lunge & Bone + TNT!
  if (boss.kind === 'dagou_jiao') {
    ctx.save();
    if (boss.mech === 'rear_lunge') {
      drawActionIconBadge(ctx, bx + 28, by - 54, '🐔', '#fde047', now);
      drawBouncingArrow(ctx, player.x, player.y - 108, '⬆️', '#4ade80', now);
    } else if (boss.mech === 'bone_bait') {
      const bone = boss.objs[0];
      const wall = boss.objs[1];
      if (bone && !bone.done) {
        ctx.font = '900 34px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🍖', bone.x, bone.y);
        drawBouncingArrow(ctx, bone.x, bone.y - 42, '⬇️', '#4ade80', now);
      }
      if (boss.playerHasBone) {
        ctx.font = '900 26px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🍖', player.x, player.y - 108);
        ctx.fillText('😍', bx + 22, by - 46);
      }
      if (wall && !wall.done) {
        const wy = getGroundY(wall.x);
        drawModelOn(ctx, 'tntBarrel', wall.x, wy - 22, 0, 1.15);
        drawModelOn(ctx, 'tntBarrel', wall.x, wy - 58, 0, 1.15);
        drawBouncingArrow(ctx, wall.x, wy - 102, '⬆️', '#4ade80', now);
      }
    }
    ctx.restore();
  }

  // 🏀 Kun Mecha Hoop, Ball & Shoulder Charge!
  if (boss.kind === 'kun_mecha') {
    const hoopX = bx - 52;
    const hoopY = groundBY - 142;
    ctx.save();
    ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.roundRect(hoopX + 8, hoopY - 40, 14, 54, 4); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(hoopX - 12, hoopY + 4, 24, 7, 0, 0, Math.PI * 2); ctx.stroke();

    if (boss.playerCarryingBall) {
      drawSpaldingWheelOn(ctx, player.x + 36, player.y - 68, 24, now * 0.02);
      drawBouncingArrow(ctx, hoopX - 12, hoopY - 38, '🏀', '#4ade80', now);
      if (Math.abs(player.x - hoopX) < 290) drawParryRing(hoopX - 10, hoopY, 85);
    } else if (boss.objs[0] && !boss.objs[0].done) {
      const b = boss.objs[0];
      drawSpaldingWheelOn(ctx, b.x, b.y, 28, now * 0.015);
      drawParryRing(b.x, b.y, Math.hypot(b.x - (player.x + 25), b.y - (player.y - 50)));
      drawActionIconBadge(ctx, b.x, b.y - 42, '🐔', '#fde047', now);
    }
    if (boss.mech === 'shoulder_charge') {
      drawActionIconBadge(ctx, bx - 32, by - 52, '🐔', '#fde047', now);
    }
    ctx.restore();
  }

  // 🎵 Manbo Landing Shadow, Beret Stomp Arrow, Spring Pad & Golden Mic!
  if (boss.kind === 'manbo_queen') {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
    const shadowW = Math.max(22, 54 + boss.yOff * 0.16);
    ctx.beginPath(); ctx.ellipse(bx, groundBY - 4, shadowW, 10, 0, 0, Math.PI * 2); ctx.fill();

    if (boss.mech === 'giant_head_bounce') {
      drawBouncingArrow(ctx, bx, by - 76, '👟', '#4ade80', now);
      if (Math.abs(bx - player.x) < 280) drawActionIconBadge(ctx, bx - 52, by, '🐔', '#fde047', now);
    }
    for (let i = 0; i < boss.objs.length; i++) {
      const o = boss.objs[i];
      if (o.done) continue;
      if (o.type === 'music_pad') {
        const py = getGroundY(o.x);
        ctx.fillStyle = '#f472b6'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(o.x, py - 6, 34, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        drawBouncingArrow(ctx, o.x, py - 34, '⬆️', '#f472b6', now);
      } else if (o.type === 'music_wheel') {
        const wy = getGroundY(o.x) - 24;
        ctx.save();
        ctx.translate(o.x, wy);
        ctx.rotate(o.rot || 0);
        ctx.fillStyle = '#ec4899'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (o.type === 'gold_mic') {
        ctx.fillStyle = '#fde047'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(o.x, o.y, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = '900 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🎤', o.x, o.y + 8);
        drawActionIconBadge(ctx, o.x, o.y - 38, '🐔', '#4ade80', now);
      }
    }
    ctx.restore();
  }

  // 🐱 Demon Hakimi Pounce Arc & Giant Yarn Ball!
  if (boss.kind === 'demon_hakimi') {
    ctx.save();
    if (boss.mech === 'cat_pounce') {
      if (boss.mechSub === 0) {
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
        ctx.lineWidth = 5;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(bx - 20, by + 10);
        ctx.quadraticCurveTo((bx + player.x) * 0.5, by - 125, player.x + 10, getGroundY(player.x) - 18);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawActionIconBadge(ctx, bx - 30, by - 56, '🐔', '#fde047', now);
      drawBouncingArrow(ctx, bx + 14, by - 56, '👟', '#4ade80', now);
    }
    const yb = boss.objs[0];
    if (yb && !yb.done && yb.type === 'yarn_ball') {
      ctx.save();
      ctx.translate(yb.x, yb.y);
      ctx.rotate(yb.rot || 0);
      ctx.fillStyle = '#f472b6'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fbcfe8'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0.2, 2.5);
      ctx.moveTo(-24, -8); ctx.lineTo(24, 10);
      ctx.moveTo(-14, 22); ctx.lineTo(18, -20);
      ctx.stroke();
      ctx.restore();
      if (!yb.reflected) {
        drawParryRing(yb.x, yb.y, Math.abs(yb.x - (player.x + 35)));
        drawActionIconBadge(ctx, yb.x, yb.y - 48, '🐔', '#fde047', now);
      }
    }
    for (let i = 0; i < boss.objs.length; i++) {
      const md = boss.objs[i];
      if (!md || md.done || md.type !== 'boss_maodie') continue;
      drawModelOn(ctx, 'mini_maodie', md.x, md.y, md.rot || 0, 0.92);
    }
    ctx.restore();
  }

  // 🐉 Lava Dragon Bridge Arrow & Magma Meteor!
  if (boss.kind === 'lava_dragon') {
    ctx.save();
    if (boss.mech === 'highway_collapse' && !player.onRail) {
      drawBouncingArrow(ctx, player.x + 120, getGroundY(player.x + 120) - 128, '⬆️', '#4ade80', now);
    } else if (boss.mech === 'magma_meteor_spit') {
      if (boss.mechSub === 0) {
        const r = 18 + (1 - boss.mechTimer) * 20;
        ctx.fillStyle = '#f97316'; ctx.strokeStyle = '#fde047'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(bx - 52, by - 4, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (boss.objs[0] && !boss.objs[0].done) {
        const mt = boss.objs[0];
        ctx.save();
        ctx.translate(mt.x, mt.y);
        ctx.rotate(mt.rot || 0);
        ctx.fillStyle = '#ea580c'; ctx.strokeStyle = '#fde047'; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.arc(0, 0, 36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath(); ctx.arc(-8, -8, 14, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (!mt.reflected) {
          drawParryRing(mt.x, mt.y, Math.abs(mt.x - (player.x + 38)));
          drawActionIconBadge(ctx, mt.x, mt.y - 52, '🐔', '#fde047', now);
        }
      }
    }
    ctx.restore();
  }

  // -------------------- 2. BOSS SPRITE + RAGE AURA, CONTACT SHADOW & HIT FEEDBACK --------------------
  ctx.save();
  // Ground contact shadow beneath Boss
  ctx.fillStyle = 'rgba(15, 23, 42, 0.34)';
  const bShadowW = Math.max(26, 62 + Math.min(0, boss.yOff) * 0.18);
  ctx.beginPath();
  ctx.ellipse(bx, groundBY - 2, bShadowW, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  if (boss.phase >= 2) {
    const pulseR = 64 + Math.sin(now * 0.018) * 8;
    ctx.fillStyle = boss.phase >= 3 ? 'rgba(239, 68, 68, 0.18)' : 'rgba(250, 204, 21, 0.16)';
    ctx.beginPath(); ctx.arc(bx, by, pulseR + 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = boss.phase >= 3 ? 'rgba(239, 68, 68, 0.85)' : 'rgba(250, 204, 21, 0.80)';
    ctx.lineWidth = 4.5;
    ctx.setLineDash([12, 6]);
    ctx.beginPath(); ctx.arc(bx, by, pulseR, now * 0.004, now * 0.004 + Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  const faceRight = boss.kind === 'dagou_jiao' && !boss.pinnedByHyper;
  const hitTilt = (boss.hitSquash || 0) * (faceRight ? -0.35 : 0.35);
  const bossRot = boss.pinnedByHyper
    ? (0.22 + Math.sin(now * 0.09) * 0.12)
    : (boss.stunTimer > 0 ? Math.sin(now * 0.025) * 0.24 : hitTilt);

  let baseSc = 1.18 + Math.min(0.22, (boss.tier - 1) * 0.04);
  if (boss.kind === 'lava_dragon') baseSc *= 1.42;
  if (boss.kind === 'manbo_queen' && boss.mech === 'giant_head_bounce') baseSc *= 1.32;

  const squashX = baseSc * (1 + (boss.hitSquash || 0) * 0.18);
  const squashY = baseSc * (1 - (boss.hitSquash || 0) * 0.14);

  let spriteKey = boss.sprite || 'boss_dingdong';
  if (boss.kind === 'manbo_queen' && (boss.cursedFaceTimer > 0 || boss.stunTimer > 0 || boss.pinnedByHyper || boss.flashTimer > 0)) {
    spriteKey = 'boss_manbo_meme';
  }
  drawModelOn(ctx, spriteKey, bx, by, bossRot, faceRight ? -squashX : squashX, squashY);

  // Pink Yarn Strands wrapped around Hakimi when stunned!
  if (boss.kind === 'demon_hakimi' && boss.stunTimer > 0) {
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(bx - 34, by - 12); ctx.lineTo(bx + 34, by + 10);
    ctx.moveTo(bx - 32, by + 14); ctx.lineTo(bx + 32, by - 10);
    ctx.stroke();
  }

  if (boss.flashTimer > 0) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#fef08a';
    ctx.beginPath(); ctx.arc(bx, by, 58, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Orbiting 3D Halo of Spinning Dizzy Stars (100% Intuitive Stun Visual, Zero Text!)
  if (boss.stunTimer > 0) {
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'center';
    for (let s = 0; s < 3; s++) {
      const a = now * 0.009 + (s * Math.PI * 2) / 3;
      const sx = bx + Math.cos(a) * 42;
      const sy = by - 56 + Math.sin(a) * 11;
      ctx.fillText(s % 2 === 0 ? '⭐' : '💫', sx, sy);
    }
  }

  // Compact 4-Char Visual Stamp ONLY on Counter Break ("✅ 破防!")
  if ((boss.counterBannerTimer || 0) > 0) {
    const hudCx = cam.camX + (W * 0.50) / cam.worldScale;
    const hudCy = cam.camY + 174 / cam.worldScale;
    ctx.fillStyle = 'rgba(22, 163, 74, 0.94)';
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(hudCx - 68, hudCy - 16, 136, 32, 16);
    ctx.fill();
    ctx.stroke();
    ctx.font = '900 15px sans-serif';
    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'center';
    const MEME_WIN = {
      manbo_queen: '🎵 曼波破防!',
      dagou_jiao: '🐕 踹飞大狗嚼!',
      dingdong_ji: '🐔 叮咚鸡坠机!',
      titan_naiwa: '🚽 冲走蛙皇!',
      kun_mecha: '🏀 只因暴扣!',
      demon_hakimi: '🐾 拿捏哈基米!',
      lava_dragon: '☄️ 暴打奶龙王!'
    };
    ctx.fillText(MEME_WIN[boss.kind] || '✅ 反制破防!', hudCx, hudCy + 5);
  }
  ctx.restore();
}
