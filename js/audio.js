// ============================================================================
// 《鹈鹕测试大乱斗》 — Ear-Friendly Original Audio & Meme-Matched Voice Engine (v6.1)
// Rules:
//  1. 100% authentic original meme sources (/audio/*) — ZERO shrill fan-made
//     synth remixes (二创尖锐电音/复读叮咚鸡音乐), ZERO harsh laughs, ZERO "哎哟我滴妈"!
//  2. Sample-accurate WebAudio BufferSource playback + PCM-level silencing of
//     all non-source / remix / harsh segments so they can NEVER play.
//  3. Warm low-pass anti-harshness filtering + single-voice overlap protection
//     + strict per-line cooldowns ("可恶你竟然都会" capped to <=1 per 65s at soft gain).
// ============================================================================

const MELODY = [392.0, 493.88, 587.33, 493.88, 440.0, 523.25, 493.88, 392.0];
const BONUS_MELODY = [440.0, 523.25, 659.25, 783.99, 659.25, 523.25, 659.25, 783.99];
const SCALE_HZ = [329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

const REAL_CLIP_URLS = {
  ji: '/audio/ji.mp3',
  ngm: '/audio/ngm.mp3',
  jntm: '/audio/jntm.mp3',
  ddj: '/audio/ddj.m4a',
  hakimi: '/audio/hakimi.m4a',
  nailong: '/audio/nailong.m4a',
  manbo: '/audio/manbo.m4a'
};

let audioCtx = null;
let masterBus = null;
let voiceBus = null;
let activeVoiceHandle = null;
let lastCombatVoiceMs = 0;
let soundOn = true;
let bgmTimer = 0;
let bgmStep = 0;
let bgmDuckTimer = null;

const voiceThrottleMap = {};
const sfxThrottleMap = {};
const rawClipArrayBuffers = {};
const realClipBuffers = {};
const pendingPlayCallbacks = {};
let clipsPreloaded = false;

export const bossBgmEl = new Audio('/audio/boss_bgm.m4a');
bossBgmEl.loop = true;
bossBgmEl.preload = 'auto';
bossBgmEl.volume = 0.26;

function getOutNode() {
  if (!audioCtx) return null;
  if (!masterBus) {
    // Warm low-pass stage removes piercing >3.1kHz harshness across all SFX & voices
    const warmthFilter = audioCtx.createBiquadFilter();
    warmthFilter.type = 'lowpass';
    warmthFilter.frequency.setValueAtTime(3100, audioCtx.currentTime);
    warmthFilter.Q.setValueAtTime(0.55, audioCtx.currentTime);

    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-18, audioCtx.currentTime);
    comp.knee.setValueAtTime(20, audioCtx.currentTime);
    comp.ratio.setValueAtTime(10, audioCtx.currentTime);
    comp.attack.setValueAtTime(0.003, audioCtx.currentTime);
    comp.release.setValueAtTime(0.24, audioCtx.currentTime);

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.72, audioCtx.currentTime);

    warmthFilter.connect(comp);
    comp.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    masterBus = warmthFilter;
  }
  return masterBus;
}

function getVoiceNode() {
  const out = getOutNode();
  if (!audioCtx || !out) return null;
  if (!voiceBus) {
    // Extra gentle roll-off on megaphone/cartoon voices so high-pitched sibilance never stabs ears
    const vf = audioCtx.createBiquadFilter();
    vf.type = 'lowpass';
    vf.frequency.setValueAtTime(2500, audioCtx.currentTime);
    vf.Q.setValueAtTime(0.5, audioCtx.currentTime);
    vf.connect(out);
    voiceBus = vf;
  }
  return voiceBus;
}

// Physically silence unwanted laughs, bystanders, and shrill fan-made remixes in decoded AudioBuffers!
function silenceAudioRegion(buf, startSec, endSec) {
  if (!buf) return;
  const sr = buf.sampleRate;
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const i1 = Math.min(buf.length, Math.ceil(endSec * sr));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = i0; i < i1; i++) data[i] = 0;
  }
}

function attenuateAudioRegion(buf, startSec, endSec, factor) {
  if (!buf) return;
  const sr = buf.sampleRate;
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const i1 = Math.min(buf.length, Math.ceil(endSec * sr));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = i0; i < i1; i++) data[i] *= factor;
  }
}

function sanitizeDecodedClip(kind, buf) {
  if (kind === 'ddj') {
    // Keep ONLY the authentic Hainan做核酸 megaphone source:
    //   1.20..5.32s ("楼上的下来做核酸，叮咚鸡！大狗嚼！")
    //   6.58..8.50s ("带身份证，带一袋！")
    // Permanently wipe opening laugh, "你别笑", "哎哟我滴妈", AND the entire 11.15..25s shrill二创 synth remix!
    silenceAudioRegion(buf, 0.0, 1.18);
    silenceAudioRegion(buf, 5.34, 6.56);
    silenceAudioRegion(buf, 8.50, buf.duration);
  } else if (kind === 'nailong') {
    // Strip 4.85..13.15s coughing/shrill laugh/boings, 15.30..22.05s noisy filler, and 25.40s+ bass drop
    silenceAudioRegion(buf, 4.85, 13.15);
    silenceAudioRegion(buf, 15.30, 22.05);
    silenceAudioRegion(buf, 25.40, buf.duration);
    // Tame peak amplitude of 13.20..15.28s ("可恶！你竟然都会！") directly in PCM so it is never loud/shrill
    attenuateAudioRegion(buf, 13.15, 15.30, 0.52);
  } else if (kind === 'hakimi') {
    // Strip 20.20s+ reversed-audio鬼畜 section
    silenceAudioRegion(buf, 20.20, buf.duration);
  }
}

function decodePendingAudioBuffers() {
  if (!audioCtx) return;
  for (const [k, ab] of Object.entries(rawClipArrayBuffers)) {
    if (ab && !realClipBuffers[k] && !ab._decoding) {
      ab._decoding = true;
      audioCtx.decodeAudioData(
        ab.slice(0),
        (buf) => {
          sanitizeDecodedClip(k, buf);
          realClipBuffers[k] = buf;
          delete rawClipArrayBuffers[k];
          const q = pendingPlayCallbacks[k];
          if (q && q.length) {
            delete pendingPlayCallbacks[k];
            const fn = q[q.length - 1];
            try { fn(); } catch (_) {}
          }
        },
        () => { ab._decoding = false; }
      );
    }
  }
}

export function preloadRealAudioClips() {
  if (clipsPreloaded) return;
  clipsPreloaded = true;
  for (const [k, url] of Object.entries(REAL_CLIP_URLS)) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => {
        if (ab) {
          rawClipArrayBuffers[k] = ab;
          decodePendingAudioBuffers();
        }
      })
      .catch(() => {});
  }
}

export function ensureAudio() {
  if (!soundOn) return;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  getOutNode();
  preloadRealAudioClips();
  decodePendingAudioBuffers();
}

export function isSoundOn() {
  return soundOn;
}

export function toggleSound(isBossActive) {
  soundOn = !soundOn;
  if (!soundOn) {
    stopActiveVoiceQuick();
    try { bossBgmEl.pause(); } catch (_) {}
  } else if (isBossActive) {
    try { bossBgmEl.play().catch(() => {}); } catch (_) {}
  }
  return soundOn;
}

function duckBossBgmBriefly(ms = 2000) {
  if (!soundOn || bossBgmEl.paused) return;
  bossBgmEl.volume = 0.13;
  if (bgmDuckTimer) clearTimeout(bgmDuckTimer);
  bgmDuckTimer = setTimeout(() => {
    bossBgmEl.volume = 0.26;
  }, ms);
}

function stopActiveVoiceQuick() {
  if (!activeVoiceHandle || !audioCtx) return;
  const prev = activeVoiceHandle;
  activeVoiceHandle = null;
  try {
    const now = audioCtx.currentTime;
    prev.gain.gain.cancelScheduledValues(now);
    prev.gain.gain.setValueAtTime(Math.max(0.0001, prev.gain.gain.value), now);
    prev.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    prev.src.stop(now + 0.035);
  } catch (_) {}
}

function startBufferSlice(buf, offsetSec, durSec, clampedVol) {
  const out = getVoiceNode();
  if (!audioCtx || !out || !buf) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, buf.duration - 0.05)));
  const playDur = durSec > 0 ? Math.min(durSec, buf.duration - safeOffset) : (buf.duration - safeOffset);
  if (playDur <= 0.03) return;

  // Never let two voice lines overlap and shout over each other
  stopActiveVoiceQuick();

  const now = audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  const g = audioCtx.createGain();
  src.buffer = buf;

  // Soft 18ms fade-in & 35ms fade-out prevents clicks/transients
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(clampedVol, now + 0.018);
  if (playDur > 0.09) {
    g.gain.setValueAtTime(clampedVol, now + playDur - 0.04);
    g.gain.linearRampToValueAtTime(0.0001, now + playDur);
  }

  src.connect(g);
  g.connect(out);
  const handle = { src, gain: g };
  activeVoiceHandle = handle;

  src.onended = () => {
    if (activeVoiceHandle === handle) activeVoiceHandle = null;
    try { src.disconnect(); g.disconnect(); } catch (_) {}
  };
  src.start(now, safeOffset, playDur);
}

export function playVoiceSlice(kind, offsetSec = 0, durSec = 0, vol = 0.42, throttleKey = kind, minGapMs = 2500, force = false) {
  if (!soundOn) return;
  ensureAudio();
  const nowMs = performance.now();
  if (!force && minGapMs > 0) {
    const prev = voiceThrottleMap[throttleKey] || 0;
    if (nowMs - prev < minGapMs) return;
  }
  voiceThrottleMap[throttleKey] = nowMs;

  const clampedVol = Math.min(0.52, Math.max(0.04, vol));
  if (realClipBuffers[kind]) {
    startBufferSlice(realClipBuffers[kind], offsetSec, durSec, clampedVol);
    return;
  }
  if (!pendingPlayCallbacks[kind]) pendingPlayCallbacks[kind] = [];
  pendingPlayCallbacks[kind].push(() => {
    if (soundOn && realClipBuffers[kind]) {
      startBufferSlice(realClipBuffers[kind], offsetSec, durSec, clampedVol);
    }
  });
}

// Gentle voice preview when tapping a Hero card in Garage Hub
export function playHeroSelectVoice(heroId) {
  if (heroId === 'nailong') playVoiceSlice('nailong', 0.06, 1.38, 0.38, 'hero_sel', 650, true); // "我是奶龙！"
  else if (heroId === 'naiwa') playVoiceSlice('nailong', 1.48, 1.62, 0.38, 'hero_sel', 650, true); // "我才是奶龙！"
  else if (heroId === 'hakimi') playVoiceSlice('hakimi', 0.0, 2.5, 0.36, 'hero_sel', 650, true);
  else if (heroId === 'ikun') playVoiceSlice('jntm', 0.0, 2.1, 0.36, 'hero_sel', 650, true);
  else playVoiceSlice('ji', 0, 0, 0.34, 'hero_sel', 650, true);
}

// Rare, low-volume accent during normal talent use (max once per 28s, muted during Boss BGM)
export function playGentleSkillAccent(heroId, isBossActive) {
  if (isBossActive) return;
  if (heroId === 'nailong') playVoiceSlice('nailong', 3.22, 1.55, 0.22, 'skill_vo', 28000, false); // "我会喷火，你会吗？"
  else if (heroId === 'naiwa') playVoiceSlice('nailong', 1.48, 1.60, 0.22, 'skill_vo', 28000, false); // "我才是奶龙！"
  else if (heroId === 'hakimi') playVoiceSlice('hakimi', 0.0, 2.2, 0.22, 'skill_vo', 26000, false);
  else if (heroId === 'ikun') playVoiceSlice('jntm', 0.0, 1.8, 0.22, 'skill_vo', 28000, false);
}

// Clean Authentic Meme-Matched Highlight Voice Events (ZERO shrill二创 remixes, ZERO spam!)
export function playCriticalMomentVoice(eventKind, subKind = '') {
  if (!soundOn) return;
  const nowMs = performance.now();

  if (eventKind === 'player_death') {
    lastCombatVoiceMs = nowMs;
    playVoiceSlice('ngm', 0, 0, 0.48, 'crit_ngm_die', 1800, true);
    return;
  }

  // Global combat voice spacing so rapid phase shifts / Hyper Dash kills never spam the player's ears
  if (nowMs - lastCombatVoiceMs < 2600) return;

  if (eventKind === 'boss_spawn') {
    lastCombatVoiceMs = nowMs;
    duckBossBgmBriefly(2200);
    if (subKind === 'dingdong_ji') {
      // Authentic Hainan做核酸 megaphone source
      playVoiceSlice('ddj', 1.20, 2.90, 0.45, 'crit_boss', 3500, false); // "楼上的下来做核酸，叮咚鸡！"
    } else if (subKind === 'dagou_jiao') {
      // Authentic Hainan做核酸 megaphone source
      playVoiceSlice('ddj', 4.22, 1.12, 0.46, 'crit_boss', 3500, false); // "大狗嚼！"
    } else if (subKind === 'manbo_queen') {
      playVoiceSlice('manbo', 0.0, 1.80, 0.46, 'crit_boss', 3500, false); // "曼波～"
    } else if (subKind === 'demon_hakimi') {
      playVoiceSlice('hakimi', 0.0, 4.95, 0.43, 'crit_boss', 3500, false); // "哈基米南北绿豆，阿西嘎阿亚库～"
    } else if (subKind === 'titan_naiwa') {
      playVoiceSlice('nailong', 1.48, 1.60, 0.43, 'crit_boss', 3500, false); // "我才是奶龙！"
    } else if (subKind === 'lava_dragon') {
      playVoiceSlice('nailong', 0.06, 3.02, 0.43, 'crit_boss', 3500, false); // "我是奶龙！我才是奶龙！"
    } else {
      playVoiceSlice('jntm', 0.0, 2.25, 0.43, 'crit_boss', 3500, false); // "只因你太美 baby"
    }
  } else if (eventKind === 'boss_enrage') {
    if (nowMs - (voiceThrottleMap.crit_enrage_any || 0) < 7500) return;
    voiceThrottleMap.crit_enrage_any = nowMs;
    lastCombatVoiceMs = nowMs;
    duckBossBgmBriefly(1800);
    if (subKind === 'dingdong_ji' || subKind === 'dagou_jiao') {
      // Replaced shrill二创 with authentic做核酸 megaphone line: "带身份证，带一袋！"
      playVoiceSlice('ddj', 6.60, 1.88, 0.42, 'crit_enrage', 7500, false);
    } else if (subKind === 'manbo_queen') {
      playVoiceSlice('hakimi', 0.0, 2.50, 0.40, 'crit_enrage', 7500, false); // "哈基米南北绿豆～"
    } else if (subKind === 'demon_hakimi') {
      playVoiceSlice('hakimi', 13.10, 4.20, 0.42, 'crit_enrage', 7500, false); // "曼波越大越美丽，阿亚库哈基米～"
    } else if (subKind === 'titan_naiwa') {
      // Replaced noisy "可恶你竟然都会" with playful "你是奶龙！诶，你才是奶龙～"
      playVoiceSlice('nailong', 22.10, 3.20, 0.42, 'crit_enrage', 7500, false);
    } else if (subKind === 'lava_dragon') {
      playVoiceSlice('nailong', 3.22, 1.58, 0.41, 'crit_enrage', 7500, false); // "我会喷火，你会吗？"
    } else {
      playVoiceSlice('ngm', 0, 0, 0.42, 'crit_enrage', 7500, false); // "你干嘛～哎哟"
    }
  } else if (eventKind === 'boss_clash_parry') {
    if (nowMs - (voiceThrottleMap.crit_parry_any || 0) < 6500) return;
    voiceThrottleMap.crit_parry_any = nowMs;
    lastCombatVoiceMs = nowMs;
    if (subKind === 'dagou_jiao') playVoiceSlice('ddj', 4.22, 1.08, 0.38, 'crit_parry', 7000, false); // "大狗嚼！"
    else if (subKind === 'dingdong_ji') playVoiceSlice('ddj', 2.98, 1.12, 0.38, 'crit_parry', 7000, false); // "叮咚鸡！"
    else if (subKind === 'manbo_queen') playVoiceSlice('manbo', 0.0, 1.60, 0.40, 'crit_parry', 7000, false); // "曼波～"
    else if (subKind === 'demon_hakimi') playVoiceSlice('hakimi', 0.0, 2.35, 0.38, 'crit_parry', 7000, false); // "哈基米南北绿豆～"
    else if (subKind === 'kun_mecha') playVoiceSlice('jntm', 0.0, 1.65, 0.38, 'crit_parry', 7000, false); // "鸡你太美"
    else playVoiceSlice('ji', 0, 0, 0.36, 'crit_parry', 6500, false);
  } else if (eventKind === 'boss_defeat') {
    lastCombatVoiceMs = nowMs;
    if (subKind === 'kun_mecha') {
      playVoiceSlice('ngm', 0, 0, 0.46, 'crit_defeat', 4000, false);
    } else if (subKind === 'dingdong_ji') {
      // Replaced二创复读 music with authentic做核酸 spoken "楼上的下来做核酸，叮咚鸡！"
      playVoiceSlice('ddj', 1.20, 2.90, 0.44, 'crit_defeat', 4000, false);
    } else if (subKind === 'dagou_jiao') {
      // Replaced二创尖锐音乐 with authentic做核酸 spoken "大狗嚼！"
      playVoiceSlice('ddj', 4.22, 1.12, 0.45, 'crit_defeat', 4000, false);
    } else if (subKind === 'manbo_queen') {
      playVoiceSlice('manbo', 0.0, 1.80, 0.46, 'crit_defeat', 4000, false);
    } else if (subKind === 'demon_hakimi') {
      playVoiceSlice('hakimi', 15.30, 2.25, 0.43, 'crit_defeat', 4000, false); // "阿亚库哈基米～"
    } else if (subKind === 'titan_naiwa') {
      playVoiceSlice('nailong', 22.10, 3.20, 0.44, 'crit_defeat', 4500, false); // "你是奶龙！诶，你才是奶龙～"
    } else if (subKind === 'lava_dragon') {
      // Low-frequency (<= once per 75s) soft "可恶！你竟然都会！"; replaced on cooldown by playful "你是奶龙！诶，你才是奶龙～"
      const prevKewu = voiceThrottleMap.vo_kewu_rare || 0;
      if (nowMs - prevKewu >= 75000) {
        voiceThrottleMap.vo_kewu_rare = nowMs;
        playVoiceSlice('nailong', 13.20, 2.00, 0.32, 'crit_defeat', 4000, false);
      } else {
        playVoiceSlice('nailong', 22.10, 3.20, 0.43, 'crit_defeat', 4000, false);
      }
    } else {
      playVoiceSlice('ngm', 0, 0, 0.46, 'crit_defeat', 4000, false);
    }
  } else if (eventKind === 'new_record') {
    lastCombatVoiceMs = nowMs;
    playVoiceSlice('manbo', 0.0, 1.75, 0.40, 'crit_rec', 12000, false);
  }
}

export function startBossBgm() {
  if (!soundOn) return;
  try {
    bossBgmEl.currentTime = 0;
    bossBgmEl.volume = 0.26;
    bossBgmEl.play().catch(() => {});
  } catch (_) {}
}

export function pauseBossBgm() {
  try { bossBgmEl.pause(); } catch (_) {}
}

export function resumeBossBgmIfNeeded(shouldPlay) {
  if (soundOn && shouldPlay) {
    try { bossBgmEl.play().catch(() => {}); } catch (_) {}
  }
}

export function stopBossBgm() {
  try {
    bossBgmEl.pause();
    bossBgmEl.currentTime = 0;
  } catch (_) {}
}

// Warm, Rounded, Ear-Friendly Procedural Arcade SFX (zero piercing >900Hz whistles or sawtooth harshness)
export function playSfx(kind, pitchIdx = 0) {
  const out = getOutNode();
  if (!soundOn || !audioCtx || !out) return;

  const nowMs = performance.now();
  const minGap = kind === 'bean' ? 68
    : (kind === 'parry' ? 135
    : (kind === 'slash' ? 88
    : (kind === 'combo_kill' ? 85 : 35)));
  if (nowMs - (sfxThrottleMap[kind] || 0) < minGap) return;
  sfxThrottleMap[kind] = nowMs;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(out);
  osc.onended = () => {
    try { osc.disconnect(); gain.disconnect(); } catch (_) {}
  };

  if (kind === 'jump') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.10);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now); osc.stop(now + 0.12);
  } else if (kind === 'combo_kill') {
    const hz = SCALE_HZ[Math.min(SCALE_HZ.length - 1, Math.max(0, pitchIdx))];
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.exponentialRampToValueAtTime(hz * 1.15, now + 0.08);
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.start(now); osc.stop(now + 0.11);
  } else if (kind === 'chime') {
    const noteNotes = [392.0, 493.88, 587.33, 659.25];
    const hz = noteNotes[Math.min(noteNotes.length - 1, Math.max(0, pitchIdx))];
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.setValueAtTime(hz * 1.25, now + 0.07);
    gain.gain.setValueAtTime(0.10, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.start(now); osc.stop(now + 0.22);
  } else if (kind === 'hyper') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.16);
    gain.gain.setValueAtTime(0.095, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.start(now); osc.stop(now + 0.19);
  } else if (kind === 'crate') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(554.37, now + 0.055);
    osc.frequency.setValueAtTime(659.25, now + 0.11);
    gain.gain.setValueAtTime(0.105, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
    osc.start(now); osc.stop(now + 0.23);
  } else if (kind === 'parry') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(587.33, now + 0.045);
    osc.frequency.setValueAtTime(783.99, now + 0.09);
    gain.gain.setValueAtTime(0.095, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
    osc.start(now); osc.stop(now + 0.20);
  } else if (kind === 'crater') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.22);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.start(now); osc.stop(now + 0.24);
  } else if (kind === 'hurt') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.16);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.start(now); osc.stop(now + 0.18);
  } else if (kind === 'slash') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.075);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    osc.start(now); osc.stop(now + 0.085);
  } else if (kind === 'bean') {
    const hz = 520 + (pitchIdx % 5) * 42;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.setValueAtTime(hz * 1.18, now + 0.035);
    gain.gain.setValueAtTime(0.036, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.start(now); osc.stop(now + 0.07);
  } else {
    try { osc.disconnect(); gain.disconnect(); } catch (_) {}
  }
}

export function tickProceduralBgm(realDt, playerVx, superBonusActive, bossBgmActive) {
  const out = getOutNode();
  if (!soundOn || !audioCtx || !out || bossBgmActive) return;
  bgmTimer -= realDt;
  if (bgmTimer <= 0) {
    const spdFactor = Math.min(1.55, playerVx / 320);
    bgmTimer = superBonusActive ? 0.14 : Math.max(0.13, 0.25 / spdFactor);
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    const notes = superBonusActive ? BONUS_MELODY : MELODY;
    osc.frequency.setValueAtTime(notes[bgmStep++ % notes.length], now);
    g.gain.setValueAtTime(0.011, now);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.12);
    osc.connect(g);
    g.connect(out);
    osc.onended = () => {
      try { osc.disconnect(); g.disconnect(); } catch (_) {}
    };
    osc.start(now);
    osc.stop(now + 0.13);
  }
}
