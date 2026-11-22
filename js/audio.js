// ============================================================================
// 《鹈鹕测试大乱斗》 — Ear-Friendly Original Audio & Meme-Matched Voice Engine
// Rules:
//  1. 100% clean original meme audio (/audio/*) — ZERO harsh/shrill laughs,
//     ZERO "哎哟我滴妈", ZERO unrequested random audio!
//  2. Sample-accurate WebAudio BufferSource playback + PCM-level muting of any
//     unwanted laugh segments so they can NEVER play under any circumstance.
//  3. WebAudio DynamicsCompressorNode master limiter + strict onended.disconnect()
//     cleanup = ZERO node leaks even after hours of continuous gameplay!
// ============================================================================

const MELODY = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 659.25, 523.25];
const BONUS_MELODY = [659.25, 783.99, 987.77, 1046.5, 987.77, 783.99, 1046.5, 1318.5];
const SCALE_HZ = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5, 1567.98, 1760.0];

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
bossBgmEl.volume = 0.36;

function getOutNode() {
  if (!audioCtx) return null;
  if (!masterBus) {
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-16, audioCtx.currentTime);
    comp.knee.setValueAtTime(18, audioCtx.currentTime);
    comp.ratio.setValueAtTime(8, audioCtx.currentTime);
    comp.attack.setValueAtTime(0.003, audioCtx.currentTime);
    comp.release.setValueAtTime(0.22, audioCtx.currentTime);

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.80, audioCtx.currentTime);
    comp.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    masterBus = comp;
  }
  return masterBus;
}

// Physically silence unwanted harsh laugh regions in decoded AudioBuffers!
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

function sanitizeDecodedClip(kind, buf) {
  if (kind === 'ddj') {
    // Strip 0.0..1.15s shrill opening laugh AND 8.65..11.15s "哎哟我滴妈+难听笑声"!
    silenceAudioRegion(buf, 0.0, 1.15);
    silenceAudioRegion(buf, 8.65, 11.15);
  } else if (kind === 'nailong') {
    // Strip 5.15..13.05s shrill squeaky laugh & coughing noises!
    silenceAudioRegion(buf, 5.15, 13.05);
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
    try { bossBgmEl.pause(); } catch (_) {}
  } else if (isBossActive) {
    try { bossBgmEl.play().catch(() => {}); } catch (_) {}
  }
  return soundOn;
}

function duckBossBgmBriefly(ms = 2200) {
  if (!soundOn || bossBgmEl.paused) return;
  bossBgmEl.volume = 0.18;
  if (bgmDuckTimer) clearTimeout(bgmDuckTimer);
  bgmDuckTimer = setTimeout(() => {
    bossBgmEl.volume = 0.36;
  }, ms);
}

function startBufferSlice(buf, offsetSec, durSec, clampedVol) {
  const out = getOutNode();
  if (!audioCtx || !out || !buf) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, buf.duration - 0.05)));
  const src = audioCtx.createBufferSource();
  const g = audioCtx.createGain();
  src.buffer = buf;
  g.gain.value = clampedVol;
  src.connect(g);
  g.connect(out);
  src.onended = () => {
    try { src.disconnect(); g.disconnect(); } catch (_) {}
  };
  if (durSec > 0) src.start(0, safeOffset, Math.min(durSec, buf.duration - safeOffset));
  else src.start(0, safeOffset);
}

export function playVoiceSlice(kind, offsetSec = 0, durSec = 0, vol = 0.52, throttleKey = kind, minGapMs = 1500, force = false) {
  if (!soundOn) return;
  ensureAudio();
  const nowMs = performance.now();
  if (!force && minGapMs > 0) {
    const prev = voiceThrottleMap[throttleKey] || 0;
    if (nowMs - prev < minGapMs) return;
  }
  voiceThrottleMap[throttleKey] = nowMs;

  const clampedVol = Math.min(0.70, Math.max(0.05, vol));
  if (realClipBuffers[kind]) {
    startBufferSlice(realClipBuffers[kind], offsetSec, durSec, clampedVol);
    return;
  }
  // Queue sample-accurate playback as soon as WebAudio finishes decoding (~30ms) — NEVER fall back to offset-0 HTMLAudio!
  if (!pendingPlayCallbacks[kind]) pendingPlayCallbacks[kind] = [];
  pendingPlayCallbacks[kind].push(() => {
    if (soundOn && realClipBuffers[kind]) {
      startBufferSlice(realClipBuffers[kind], offsetSec, durSec, clampedVol);
    }
  });
}

// Gentle voice preview when tapping a Hero card in Garage Hub
export function playHeroSelectVoice(heroId) {
  if (heroId === 'nailong') playVoiceSlice('nailong', 0.06, 1.38, 0.48, 'hero_sel', 550, true); // "我是奶龙！"
  else if (heroId === 'naiwa') playVoiceSlice('nailong', 1.48, 1.62, 0.50, 'hero_sel', 550, true); // "我才是奶龙！"
  else if (heroId === 'hakimi') playVoiceSlice('hakimi', 0.0, 2.5, 0.44, 'hero_sel', 550, true);
  else if (heroId === 'ikun') playVoiceSlice('jntm', 0.0, 2.2, 0.42, 'hero_sel', 550, true);
  else playVoiceSlice('ji', 0, 0, 0.42, 'hero_sel', 550, true);
}

// Rare, low-volume accent during normal talent use (max once per 20s, muted during Boss BGM)
export function playGentleSkillAccent(heroId, isBossActive) {
  if (isBossActive) return;
  if (heroId === 'nailong') playVoiceSlice('nailong', 3.22, 1.55, 0.28, 'skill_vo', 20000, false); // "我会喷火，你会吗？"
  else if (heroId === 'naiwa') playVoiceSlice('nailong', 1.48, 1.60, 0.28, 'skill_vo', 20000, false); // "我才是奶龙！"
  else if (heroId === 'hakimi') playVoiceSlice('hakimi', 0.0, 2.2, 0.28, 'skill_vo', 18000, false);
  else if (heroId === 'ikun') playVoiceSlice('jntm', 0.0, 1.8, 0.26, 'skill_vo', 22000, false);
}

// Clean Meme-Matched Critical Highlight Voice Events (ZERO harsh laughs!)
export function playCriticalMomentVoice(eventKind, subKind = '') {
  if (!soundOn) return;
  if (eventKind === 'boss_spawn') {
    duckBossBgmBriefly(2600);
    if (subKind === 'dingdong_ji') playVoiceSlice('ddj', 1.20, 2.95, 0.62, 'crit_boss', 600, true); // "楼上的下来做核酸，叮咚鸡！"
    else if (subKind === 'dagou_jiao') playVoiceSlice('ddj', 4.25, 1.25, 0.62, 'crit_boss', 600, true); // "大狗嚼！"
    else if (subKind === 'manbo_queen') playVoiceSlice('manbo', 0.0, 1.85, 0.65, 'crit_boss', 600, true); // "曼波～"
    else if (subKind === 'demon_hakimi') playVoiceSlice('hakimi', 0.0, 3.0, 0.60, 'crit_boss', 600, true);
    else if (subKind === 'titan_naiwa') playVoiceSlice('nailong', 1.48, 1.62, 0.60, 'crit_boss', 600, true); // "我才是奶龙！"
    else if (subKind === 'lava_dragon') playVoiceSlice('nailong', 0.06, 3.04, 0.60, 'crit_boss', 600, true); // "我是奶龙！我才是奶龙！"
    else playVoiceSlice('jntm', 0.0, 2.3, 0.56, 'crit_boss', 600, true);
  } else if (eventKind === 'boss_enrage') {
    duckBossBgmBriefly(2200);
    if (subKind === 'dingdong_ji') playVoiceSlice('ddj', 13.45, 2.05, 0.60, 'crit_enrage', 800, true); // "叮咚鸡，叮咚鸡！"
    else if (subKind === 'dagou_jiao') playVoiceSlice('ddj', 15.55, 1.75, 0.60, 'crit_enrage', 800, true); // "大狗大狗嚼嚼嚼！"
    else if (subKind === 'manbo_queen') playVoiceSlice('hakimi', 12.6, 2.5, 0.58, 'crit_enrage', 800, true);
    else if (subKind === 'demon_hakimi') playVoiceSlice('hakimi', 5.3, 2.9, 0.58, 'crit_enrage', 800, true);
    else if (subKind === 'titan_naiwa') playVoiceSlice('nailong', 13.20, 2.0, 0.58, 'crit_enrage', 800, true); // "可恶！你竟然都会！"
    else if (subKind === 'lava_dragon') playVoiceSlice('nailong', 3.22, 1.75, 0.58, 'crit_enrage', 800, true); // "我会喷火，你会吗？"
    else playVoiceSlice('ji', 0, 0, 0.52, 'crit_enrage', 800, true);
  } else if (eventKind === 'boss_clash_parry') {
    if (subKind === 'dagou_jiao') playVoiceSlice('ddj', 4.25, 1.20, 0.48, 'crit_parry', 2600, false);
    else if (subKind === 'manbo_queen') playVoiceSlice('manbo', 0.0, 1.6, 0.50, 'crit_parry', 3200, false);
    else playVoiceSlice('ji', 0, 0, 0.44, 'crit_parry', 3500, false);
  } else if (eventKind === 'boss_defeat') {
    if (subKind === 'kun_mecha') {
      playVoiceSlice('ngm', 0, 0, 0.66, 'crit_defeat', 500, true);
    } else if (subKind === 'dingdong_ji') {
      playVoiceSlice('ddj', 13.45, 2.05, 0.64, 'crit_defeat', 500, true); // "叮咚鸡，叮咚鸡！" (clean, NO "哎哟我滴妈"!)
    } else if (subKind === 'dagou_jiao') {
      playVoiceSlice('ddj', 15.55, 1.75, 0.64, 'crit_defeat', 500, true); // "大狗大狗嚼嚼嚼！"
    } else if (subKind === 'manbo_queen') {
      playVoiceSlice('manbo', 0.0, 1.85, 0.68, 'crit_defeat', 500, true); // "曼波～"
    } else if (subKind === 'demon_hakimi') {
      playVoiceSlice('hakimi', 17.5, 2.5, 0.64, 'crit_defeat', 500, true);
    } else if (subKind === 'titan_naiwa') {
      playVoiceSlice('nailong', 22.10, 3.30, 0.66, 'crit_defeat', 500, true); // "你是奶龙！诶，你才是奶龙～"
    } else if (subKind === 'lava_dragon') {
      playVoiceSlice('nailong', 13.20, 2.05, 0.66, 'crit_defeat', 500, true); // "可恶！你竟然都会！"
    } else {
      playVoiceSlice('ngm', 0, 0, 0.66, 'crit_defeat', 500, true);
    }
  } else if (eventKind === 'player_death') {
    playVoiceSlice('ngm', 0, 0, 0.66, 'crit_ngm_die', 600, true);
  } else if (eventKind === 'new_record') {
    playVoiceSlice('manbo', 0.0, 1.75, 0.54, 'crit_rec', 5000, true);
  }
}

export function startBossBgm() {
  if (!soundOn) return;
  try {
    bossBgmEl.currentTime = 0;
    bossBgmEl.volume = 0.36;
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

// Leak-Free, Rate-Limited Procedural Arcade SFX
export function playSfx(kind, pitchIdx = 0) {
  const out = getOutNode();
  if (!soundOn || !audioCtx || !out) return;

  const nowMs = performance.now();
  const minGap = kind === 'bean' ? 46 : (kind === 'slash' ? 38 : 22);
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
    osc.frequency.setValueAtTime(255, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.10);
    gain.gain.setValueAtTime(0.10, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now); osc.stop(now + 0.12);
  } else if (kind === 'combo_kill') {
    const hz = SCALE_HZ[Math.min(SCALE_HZ.length - 1, Math.max(0, pitchIdx))];
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.exponentialRampToValueAtTime(hz * 1.22, now + 0.08);
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.start(now); osc.stop(now + 0.11);
  } else if (kind === 'chime') {
    const noteNotes = [523.25, 659.25, 783.99, 1046.5];
    const hz = noteNotes[Math.min(noteNotes.length - 1, Math.max(0, pitchIdx))];
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.setValueAtTime(hz * 1.5, now + 0.07);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.start(now); osc.stop(now + 0.24);
  } else if (kind === 'hyper') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.16);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.start(now); osc.stop(now + 0.19);
  } else if (kind === 'crate') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587, now);
    osc.frequency.setValueAtTime(880, now + 0.05);
    osc.frequency.setValueAtTime(1318, now + 0.10);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.start(now); osc.stop(now + 0.25);
  } else if (kind === 'parry') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(659, now);
    osc.frequency.setValueAtTime(1318, now + 0.045);
    osc.frequency.setValueAtTime(1760, now + 0.09);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.start(now); osc.stop(now + 0.24);
  } else if (kind === 'crater') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.22);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.start(now); osc.stop(now + 0.24);
  } else if (kind === 'hurt') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(175, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.16);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.start(now); osc.stop(now + 0.18);
  } else if (kind === 'slash') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.08);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.start(now); osc.stop(now + 0.09);
  } else if (kind === 'bean') {
    const hz = 740 + (pitchIdx % 6) * 55;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.setValueAtTime(hz * 1.25, now + 0.035);
    gain.gain.setValueAtTime(0.055, now);
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
    const spdFactor = Math.min(1.65, playerVx / 320);
    bgmTimer = superBonusActive ? 0.13 : Math.max(0.12, 0.24 / spdFactor);
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    const notes = superBonusActive ? BONUS_MELODY : MELODY;
    osc.frequency.setValueAtTime(notes[bgmStep++ % notes.length], now);
    g.gain.setValueAtTime(0.015, now);
    g.gain.exponentialRampToValueAtTime(0.0006, now + 0.12);
    osc.connect(g);
    g.connect(out);
    osc.onended = () => {
      try { osc.disconnect(); g.disconnect(); } catch (_) {}
    };
    osc.start(now);
    osc.stop(now + 0.13);
  }
}
