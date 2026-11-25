// ============================================================================
// 《鹈鹕测试大乱斗》 v8.0 — Pre-Baked 5-Layer Parallax Biome & 3D Track Studio
// Zero per-frame allocation · Offscreen tile blitting · Locked 60FPS mobile/PC
// ============================================================================

const BIOME_PALETTES = {
  court: {
    sky: ['#0284c7', '#38bdf8', '#bae6fd', '#fef3c7'],
    turfTop: '#22c55e',
    turfMid: '#15803d',
    curbA: '#ef4444',
    curbB: '#f8fafc',
    asphalt: '#334155',
    asphaltDark: '#1e293b',
    lane: 'rgba(248, 250, 252, 0.85)',
    soilBg: '#78350f',
    soilDark: '#451a03',
    pebbleA: '#92400e',
    pebbleB: '#a16207',
    moteCol: 'rgba(254, 240, 138, 0.65)',
    moteKind: 'spark'
  },
  site: {
    sky: ['#7c2d12', '#ea580c', '#fb923c', '#fef08a'],
    turfTop: '#f59e0b',
    turfMid: '#b45309',
    curbA: '#facc15',
    curbB: '#1e293b',
    asphalt: '#292524',
    asphaltDark: '#1c1917',
    lane: 'rgba(253, 224, 71, 0.82)',
    soilBg: '#57534e',
    soilDark: '#292524',
    pebbleA: '#78716c',
    pebbleB: '#44403c',
    moteCol: 'rgba(253, 224, 71, 0.55)',
    moteKind: 'dust'
  },
  swamp: {
    sky: ['#022c22', '#065f46', '#0d9488', '#99f6e4'],
    turfTop: '#10b981',
    turfMid: '#047857',
    curbA: '#34d399',
    curbB: '#134e4a',
    asphalt: '#1e293b',
    asphaltDark: '#0f172a',
    lane: 'rgba(167, 243, 208, 0.72)',
    soilBg: '#134e4a',
    soilDark: '#042f2e',
    pebbleA: '#0f766e',
    pebbleB: '#115e59',
    moteCol: 'rgba(110, 231, 183, 0.85)',
    moteKind: 'firefly'
  },
  snow: {
    sky: ['#082f49', '#0284c7', '#7dd3fc', '#f0f9ff'],
    turfTop: '#ffffff',
    turfMid: '#bae6fd',
    curbA: '#38bdf8',
    curbB: '#ffffff',
    asphalt: '#475569',
    asphaltDark: '#1e293b',
    lane: 'rgba(255, 255, 255, 0.90)',
    soilBg: '#1e3a8a',
    soilDark: '#0f172a',
    pebbleA: '#2563eb',
    pebbleB: '#38bdf8',
    moteCol: 'rgba(255, 255, 255, 0.88)',
    moteKind: 'snow'
  },
  volcano: {
    sky: ['#0c0a09', '#450a0a', '#b91c1c', '#fb923c'],
    turfTop: '#ea580c',
    turfMid: '#7f1d1d',
    curbA: '#f97316',
    curbB: '#1c1917',
    asphalt: '#27272a',
    asphaltDark: '#09090b',
    lane: 'rgba(251, 146, 60, 0.82)',
    soilBg: '#292524',
    soilDark: '#0c0a09',
    pebbleA: '#dc2626',
    pebbleB: '#f97316',
    moteCol: 'rgba(253, 186, 116, 0.90)',
    moteKind: 'ember'
  },
  bamboo: {
    sky: ['#022c22', '#047857', '#34d399', '#ecfccb'],
    turfTop: '#4ade80',
    turfMid: '#15803d',
    curbA: '#84cc16',
    curbB: '#fef9c3',
    asphalt: '#334155',
    asphaltDark: '#1e293b',
    lane: 'rgba(236, 252, 203, 0.82)',
    soilBg: '#3f6212',
    soilDark: '#1a2e05',
    pebbleA: '#4d7c0f',
    pebbleB: '#65a30d',
    moteCol: 'rgba(190, 242, 100, 0.82)',
    moteKind: 'leaf'
  },
  cyber: {
    sky: ['#050814', '#1e1b4b', '#701a75', '#f43f5e'],
    turfTop: '#c026d3',
    turfMid: '#4c1d95',
    curbA: '#22d3ee',
    curbB: '#e879f9',
    asphalt: '#0f172a',
    asphaltDark: '#020617',
    lane: 'rgba(34, 211, 238, 0.90)',
    soilBg: '#1e1b4b',
    soilDark: '#090d16',
    pebbleA: '#6d28d9',
    pebbleB: '#0891b2',
    moteCol: 'rgba(34, 211, 238, 0.78)',
    moteKind: 'cyber'
  }
};

const SCENERY_CACHE = {
  ready: false,
  clouds: [],
  farStrips: {},
  midStrips: {},
  soilTiles: {},
  soilPatterns: new WeakMap()
};

function makeOffscreen(w, h, drawFn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  g.lineCap = 'round';
  drawFn(g, w, h);
  return c;
}

function buildVolumetricClouds() {
  const specs = [
    { w: 196, h: 78, puffs: [[-52, 12, 24], [-22, -4, 31], [16, -8, 34], [50, 8, 25], [0, 14, 28]] },
    { w: 154, h: 66, puffs: [[-38, 10, 20], [-10, -4, 27], [24, 2, 24], [44, 12, 17]] },
    { w: 228, h: 86, puffs: [[-68, 15, 23], [-36, 0, 32], [4, -10, 38], [44, -2, 30], [74, 14, 22]] }
  ];
  SCENERY_CACHE.clouds = specs.map((sp) => makeOffscreen(sp.w, sp.h, (g, w, h) => {
    const cx = w * 0.5;
    const cy = h * 0.54;
    // Soft underside ambient shadow
    g.fillStyle = 'rgba(148, 163, 184, 0.36)';
    g.beginPath();
    for (const [px, py, pr] of sp.puffs) {
      g.moveTo(cx + px + pr, cy + py + 5);
      g.arc(cx + px, cy + py + 5, pr, 0, Math.PI * 2);
    }
    g.fill();
    // Main creamy-white cloud body
    const cg = g.createLinearGradient(0, cy - 36, 0, cy + 28);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.72, '#f8fafc');
    cg.addColorStop(1, '#e2e8f0');
    g.fillStyle = cg;
    g.beginPath();
    for (const [px, py, pr] of sp.puffs) {
      g.moveTo(cx + px + pr, cy + py);
      g.arc(cx + px, cy + py, pr, 0, Math.PI * 2);
    }
    g.fill();
    // Flat-bottomed anime cloud base trim + top rim shine
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (const [px, py, pr] of sp.puffs) {
      g.beginPath();
      g.arc(cx + px - pr * 0.18, cy + py - pr * 0.22, pr * 0.58, Math.PI * 1.05, Math.PI * 1.95);
      g.fill();
    }
  }));
}

function buildSoilTile(id, pal) {
  return makeOffscreen(192, 192, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, pal.soilBg);
    bg.addColorStop(1, pal.soilDark);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // Diagonal geological strata bands (tileable across 192px)
    g.fillStyle = 'rgba(0, 0, 0, 0.14)';
    for (let y = 18; y < h; y += 48) {
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(64, y + 10, 128, y - 10, w, y);
      g.lineTo(w, y + 20);
      g.bezierCurveTo(128, y + 10, 64, y + 30, 0, y + 20);
      g.closePath();
      g.fill();
    }

    if (id === 'cyber') {
      // Glowing cybernetic circuit grid underground
      g.strokeStyle = 'rgba(34, 211, 238, 0.18)';
      g.lineWidth = 2;
      for (let x = 24; x < w; x += 48) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
      for (let y = 24; y < h; y += 48) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
      g.fillStyle = 'rgba(232, 121, 249, 0.38)';
      for (const [nx, ny] of [[24, 24], [120, 72], [72, 120], [168, 168]]) {
        g.beginPath(); g.arc(nx, ny, 4, 0, Math.PI * 2); g.fill();
      }
      return;
    }

    if (id === 'volcano') {
      // Glowing magma veins inside obsidian rock
      g.strokeStyle = 'rgba(249, 115, 22, 0.42)';
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(0, 56); g.lineTo(52, 74); g.lineTo(108, 48); g.lineTo(192, 56);
      g.moveTo(0, 144); g.lineTo(74, 126); g.lineTo(142, 158); g.lineTo(192, 144);
      g.stroke();
    }

    // Subtle low-contrast faceted geological rock blocks (clean & non-distracting!)
    const blocks = [
      [18, 28, 36, 16], [96, 36, 44, 18], [154, 24, 30, 14],
      [48, 92, 46, 20], [132, 102, 38, 16],
      [22, 152, 40, 18], [104, 156, 50, 20]
    ];
    g.fillStyle = 'rgba(0, 0, 0, 0.16)';
    for (let i = 0; i < blocks.length; i++) {
      const [rx, ry, rw, rh] = blocks[i];
      g.beginPath();
      g.moveTo(rx, ry + rh * 0.5);
      g.lineTo(rx + rw * 0.25, ry);
      g.lineTo(rx + rw * 0.82, ry + 2);
      g.lineTo(rx + rw, ry + rh * 0.6);
      g.lineTo(rx + rw * 0.7, ry + rh);
      g.lineTo(rx + rw * 0.15, ry + rh * 0.9);
      g.closePath();
      g.fill();
    }
  });
}

function buildBiomeParallaxStrips(id) {
  const FW = 768, FH = 280;
  const MW = 640, MH = 240;

  const far = makeOffscreen(FW, FH, (g) => {
    if (id === 'court') {
      // Distant city skyline + Olympic stadium bowl + floodlight towers
      g.fillStyle = 'rgba(15, 23, 42, 0.22)';
      const bldgs = [[10, 95, 52], [70, 130, 44], [124, 82, 48], [390, 118, 54], [455, 88, 46], [660, 112, 56], [724, 85, 44]];
      for (const [bx, bh, bw] of bldgs) {
        g.fillRect(bx, FH - bh, bw, bh);
        g.fillStyle = 'rgba(254, 240, 138, 0.28)';
        for (let wy = FH - bh + 12; wy < FH - 18; wy += 16) {
          for (let wx = bx + 8; wx < bx + bw - 10; wx += 13) g.fillRect(wx, wy, 6, 8);
        }
        g.fillStyle = 'rgba(15, 23, 42, 0.22)';
      }
      // Grand Stadium Dome & Floodlights
      const dg = g.createLinearGradient(180, FH - 145, 380, FH);
      dg.addColorStop(0, 'rgba(30, 58, 138, 0.55)');
      dg.addColorStop(1, 'rgba(15, 23, 42, 0.65)');
      g.fillStyle = dg;
      g.beginPath();
      g.moveTo(165, FH);
      g.quadraticCurveTo(280, FH - 165, 395, FH);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(125, 211, 252, 0.55)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(180, FH - 12);
      g.quadraticCurveTo(280, FH - 142, 380, FH - 12);
      g.stroke();
      // Stadium Floodlight Pylons
      for (const tx of [190, 370, 565]) {
        g.strokeStyle = 'rgba(30, 41, 59, 0.68)';
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(tx, FH); g.lineTo(tx, FH - 175); g.stroke();
        g.fillStyle = '#fef08a';
        g.beginPath(); g.roundRect(tx - 18, FH - 188, 36, 16, 4); g.fill();
        // Soft light beam cone
        const lg = g.createLinearGradient(tx, FH - 172, tx, FH - 20);
        lg.addColorStop(0, 'rgba(254, 240, 138, 0.26)');
        lg.addColorStop(1, 'rgba(254, 240, 138, 0)');
        g.fillStyle = lg;
        g.beginPath(); g.moveTo(tx - 14, FH - 172); g.lineTo(tx - 58, FH); g.lineTo(tx + 58, FH); g.lineTo(tx + 14, FH - 172); g.closePath(); g.fill();
      }
    } else if (id === 'site') {
      // Sunset metropolis + giant tower cranes + suspension bridge
      g.fillStyle = 'rgba(67, 20, 7, 0.36)';
      for (let x = 0; x < FW; x += 64) {
        const h = 70 + ((x * 37) % 85);
        g.fillRect(x + 4, FH - h, 50, h);
      }
      // Giant Yellow Tower Cranes
      for (const [cx, ch] of [[140, 215], [510, 195]]) {
        g.strokeStyle = 'rgba(120, 53, 15, 0.78)';
        g.lineWidth = 6;
        g.strokeRect(cx - 8, FH - ch, 16, ch);
        g.beginPath();
        g.moveTo(cx - 56, FH - ch + 14);
        g.lineTo(cx + 135, FH - ch + 14);
        g.lineTo(cx, FH - ch - 24);
        g.closePath();
        g.stroke();
        // Hanging steel girder
        g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(cx + 95, FH - ch + 14); g.lineTo(cx + 95, FH - ch + 72); g.stroke();
        g.fillStyle = '#d97706';
        g.fillRect(cx + 72, FH - ch + 72, 46, 10);
      }
    } else if (id === 'swamp') {
      // Ancient misty banyan silhouettes + giant glowing swamp mushrooms
      g.fillStyle = 'rgba(4, 47, 46, 0.55)';
      for (const tx of [60, 250, 460, 650]) {
        g.beginPath();
        g.moveTo(tx - 28, FH);
        g.quadraticCurveTo(tx - 12, FH - 95, tx - 36, FH - 168);
        g.lineTo(tx + 36, FH - 168);
        g.quadraticCurveTo(tx + 12, FH - 95, tx + 28, FH);
        g.closePath();
        g.fill();
        g.beginPath();
        g.ellipse(tx, FH - 176, 78, 42, 0, 0, Math.PI * 2);
        g.fill();
      }
      for (const [mx, mh] of [[155, 68], [360, 82], [560, 62]]) {
        g.fillStyle = 'rgba(20, 83, 45, 0.72)';
        g.fillRect(mx - 6, FH - mh, 12, mh);
        g.fillStyle = '#2dd4bf';
        g.beginPath(); g.arc(mx, FH - mh, 28, Math.PI, 0); g.closePath(); g.fill();
        g.fillStyle = '#ccfbf1';
        g.beginPath(); g.arc(mx - 10, FH - mh - 10, 5, 0, Math.PI * 2); g.arc(mx + 9, FH - mh - 8, 4, 0, Math.PI * 2); g.fill();
      }
    } else if (id === 'snow') {
      // Faceted two-tone Alpine snow peaks!
      const peaks = [[95, 215, 130], [275, 248, 155], [475, 198, 135], [665, 236, 148]];
      for (const [px, ph, pw] of peaks) {
        // Left sunlit face
        g.fillStyle = '#e0f2fe';
        g.beginPath(); g.moveTo(px - pw, FH); g.lineTo(px, FH - ph); g.lineTo(px + 14, FH); g.closePath(); g.fill();
        // Right glacial shadow face
        g.fillStyle = '#7dd3fc';
        g.beginPath(); g.moveTo(px, FH - ph); g.lineTo(px + pw, FH); g.lineTo(px - 8, FH); g.closePath(); g.fill();
        // Bright snow cap ridge
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(px, FH - ph);
        g.lineTo(px - pw * 0.36, FH - ph * 0.64);
        g.lineTo(px - pw * 0.12, FH - ph * 0.70);
        g.lineTo(px + pw * 0.08, FH - ph * 0.60);
        g.lineTo(px + pw * 0.32, FH - ph * 0.66);
        g.closePath();
        g.fill();
      }
    } else if (id === 'volcano') {
      // Twin smoking volcanoes with glowing lava rivers!
      const vols = [[190, 228, 165], [575, 205, 150]];
      for (const [vx, vh, vw] of vols) {
        // Ash cloud plume above crater
        g.fillStyle = 'rgba(41, 37, 36, 0.62)';
        g.beginPath();
        g.arc(vx - 18, FH - vh - 22, 32, 0, Math.PI * 2);
        g.arc(vx + 22, FH - vh - 30, 38, 0, Math.PI * 2);
        g.arc(vx + 58, FH - vh - 38, 28, 0, Math.PI * 2);
        g.fill();
        // Volcano cone
        g.fillStyle = '#1c1917';
        g.beginPath();
        g.moveTo(vx - vw, FH);
        g.lineTo(vx - 32, FH - vh);
        g.lineTo(vx + 32, FH - vh);
        g.lineTo(vx + vw, FH);
        g.closePath();
        g.fill();
        // Glowing crater rim & magma stream
        g.strokeStyle = '#f97316';
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(vx - 26, FH - vh + 2);
        g.lineTo(vx + 26, FH - vh + 2);
        g.moveTo(vx - 6, FH - vh + 4);
        g.quadraticCurveTo(vx - 28, FH - vh * 0.5, vx - 52, FH);
        g.moveTo(vx + 10, FH - vh + 4);
        g.quadraticCurveTo(vx + 34, FH - vh * 0.55, vx + 46, FH);
        g.stroke();
        g.strokeStyle = '#fef08a';
        g.lineWidth = 2.5;
        g.stroke();
      }
    } else if (id === 'bamboo') {
      // Ink-jade Guilin karst mountains + misty cliffside pagoda
      const karsts = [[80, 195, 76], [220, 235, 88], [395, 180, 74], [555, 225, 86], [705, 190, 72]];
      for (const [kx, kh, kw] of karsts) {
        const kg = g.createLinearGradient(kx, FH - kh, kx, FH);
        kg.addColorStop(0, 'rgba(6, 95, 70, 0.58)');
        kg.addColorStop(1, 'rgba(167, 243, 208, 0.18)');
        g.fillStyle = kg;
        g.beginPath();
        g.moveTo(kx - kw, FH);
        g.bezierCurveTo(kx - kw * 0.7, FH - kh * 0.95, kx + kw * 0.7, FH - kh * 0.95, kx + kw, FH);
        g.closePath();
        g.fill();
      }
      // Cliffside Pagoda Silhouette at x=220
      g.fillStyle = 'rgba(6, 78, 59, 0.75)';
      for (let tier = 0; tier < 3; tier++) {
        const ty = FH - 235 - tier * 15;
        const tw = 34 - tier * 6;
        g.beginPath();
        g.moveTo(220 - tw, ty);
        g.quadraticCurveTo(220, ty - 10, 220 + tw, ty);
        g.lineTo(220 + tw * 0.65, ty + 8);
        g.lineTo(220 - tw * 0.65, ty + 8);
        g.closePath();
        g.fill();
      }
    } else {
      // Cyber Megacity Neon Skyscrapers + Searchlights
      for (const sx of [160, 540]) {
        const sg = g.createLinearGradient(sx, FH, sx + 90, 0);
        sg.addColorStop(0, 'rgba(34, 211, 238, 0.28)');
        sg.addColorStop(1, 'rgba(34, 211, 238, 0)');
        g.fillStyle = sg;
        g.beginPath(); g.moveTo(sx - 12, FH); g.lineTo(sx + 65, 10); g.lineTo(sx + 115, 10); g.lineTo(sx + 18, FH); g.closePath(); g.fill();
      }
      const towers = [[20, 185, 62, '#22d3ee'], [96, 235, 74, '#f472b6'], [188, 165, 58, '#a855f7'], [265, 215, 68, '#fde047'], [360, 248, 80, '#22d3ee'], [458, 178, 62, '#f43f5e'], [538, 222, 72, '#c084fc'], [628, 195, 64, '#38bdf8'], [704, 160, 56, '#f472b6']];
      for (const [bx, bh, bw, col] of towers) {
        g.fillStyle = '#090d16';
        g.strokeStyle = col;
        g.lineWidth = 2;
        g.fillRect(bx, FH - bh, bw, bh);
        g.strokeRect(bx, FH - bh, bw, bh);
        g.fillStyle = col;
        g.globalAlpha = 0.55;
        for (let wy = FH - bh + 14; wy < FH - 16; wy += 14) {
          for (let wx = bx + 8; wx < bx + bw - 10; wx += 12) {
            if ((wx + wy) % 5 !== 0) g.fillRect(wx, wy, 6, 6);
          }
        }
        g.globalAlpha = 1;
      }
    }
  });

  const mid = makeOffscreen(MW, MH, (g) => {
    if (id === 'court') {
      // Rolling park hills + stadium trees + basketball court banners
      g.fillStyle = 'rgba(21, 128, 61, 0.58)';
      g.beginPath();
      g.moveTo(0, MH);
      g.bezierCurveTo(160, MH - 95, 280, MH - 35, 320, MH - 65);
      g.bezierCurveTo(420, MH - 105, 540, MH - 40, MW, MH - 72);
      g.lineTo(MW, MH);
      g.closePath();
      g.fill();
      for (const tx of [72, 235, 415, 565]) {
        g.fillStyle = '#78350f';
        g.fillRect(tx - 5, MH - 62, 10, 42);
        g.fillStyle = '#16a34a';
        g.beginPath();
        g.arc(tx, MH - 76, 26, 0, Math.PI * 2);
        g.arc(tx - 18, MH - 64, 19, 0, Math.PI * 2);
        g.arc(tx + 18, MH - 64, 19, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#4ade80';
        g.beginPath(); g.arc(tx - 6, MH - 84, 14, 0, Math.PI * 2); g.fill();
      }
    } else if (id === 'site') {
      // Steel truss scaffolds & orange-black hazard barriers
      for (let x = 24; x < MW; x += 160) {
        g.strokeStyle = 'rgba(180, 83, 9, 0.72)';
        g.lineWidth = 5;
        g.strokeRect(x, MH - 110, 76, 110);
        g.beginPath();
        g.moveTo(x, MH - 110); g.lineTo(x + 76, MH - 55);
        g.moveTo(x + 76, MH - 110); g.lineTo(x, MH - 55);
        g.moveTo(x, MH - 55); g.lineTo(x + 76, MH);
        g.stroke();
      }
    } else if (id === 'swamp') {
      // Cattail reeds + glowing swamp lanterns
      for (let x = 20; x < MW; x += 64) {
        g.strokeStyle = '#064e3b';
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(x, MH); g.quadraticCurveTo(x + 8, MH - 48, x + 4, MH - 86); g.stroke();
        g.fillStyle = '#78350f';
        g.beginPath(); g.roundRect(x + 1, MH - 88, 7, 22, 3.5); g.fill();
      }
      for (const lx of [140, 460]) {
        g.strokeStyle = '#115e59'; g.lineWidth = 5;
        g.beginPath(); g.moveTo(lx, MH); g.lineTo(lx, MH - 74); g.lineTo(lx + 18, MH - 74); g.stroke();
        g.fillStyle = 'rgba(94, 234, 212, 0.35)';
        g.beginPath(); g.arc(lx + 18, MH - 64, 22, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#99f6e4';
        g.beginPath(); g.arc(lx + 18, MH - 64, 8, 0, Math.PI * 2); g.fill();
      }
    } else if (id === 'snow') {
      // Layered snow-capped pine trees
      for (let x = 28; x < MW; x += 80) {
        const th = 78 + ((x * 19) % 42);
        g.fillStyle = '#0f172a';
        g.fillRect(x - 4, MH - 22, 8, 22);
        for (let t = 0; t < 3; t++) {
          const ty = MH - 20 - t * (th * 0.28);
          const tw = 28 - t * 6;
          g.fillStyle = '#0369a1';
          g.beginPath(); g.moveTo(x - tw, ty); g.lineTo(x, ty - 34); g.lineTo(x + tw, ty); g.closePath(); g.fill();
          g.fillStyle = '#f0f9ff';
          g.beginPath(); g.moveTo(x - tw * 0.65, ty - 12); g.lineTo(x, ty - 34); g.lineTo(x + tw * 0.65, ty - 12); g.closePath(); g.fill();
        }
      }
    } else if (id === 'volcano') {
      // Jagged basalt spires & glowing magma crystals
      for (let x = 35; x < MW; x += 128) {
        g.fillStyle = '#1c1917';
        g.beginPath();
        g.moveTo(x - 28, MH); g.lineTo(x - 6, MH - 98); g.lineTo(x + 14, MH - 74); g.lineTo(x + 32, MH);
        g.closePath(); g.fill();
        g.fillStyle = '#f97316';
        g.beginPath();
        g.moveTo(x + 42, MH); g.lineTo(x + 52, MH - 46); g.lineTo(x + 64, MH);
        g.closePath(); g.fill();
      }
    } else if (id === 'bamboo') {
      // Multi-node jointed emerald bamboo stalks + leaf clusters!
      for (let x = 18; x < MW; x += 46) {
        const tilt = ((x % 3) - 1) * 0.03;
        g.save();
        g.translate(x, MH);
        g.rotate(tilt);
        const bw = 9 + (x % 4);
        const bg = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
        bg.addColorStop(0, '#047857');
        bg.addColorStop(0.45, '#34d399');
        bg.addColorStop(1, '#065f46');
        g.fillStyle = bg;
        g.fillRect(-bw / 2, -MH + 8, bw, MH);
        // Bamboo joints & leaves
        g.strokeStyle = '#ecfccb';
        g.lineWidth = 2;
        for (let jy = -36; jy > -MH + 20; jy -= 44) {
          g.beginPath(); g.moveTo(-bw / 2 - 1, jy); g.lineTo(bw / 2 + 1, jy); g.stroke();
          if ((jy + x) % 2 === 0) {
            g.fillStyle = '#10b981';
            g.beginPath();
            g.ellipse(bw + 8, jy - 4, 12, 3.5, -0.35, 0, Math.PI * 2);
            g.ellipse(bw + 5, jy + 3, 10, 3, 0.25, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.restore();
      }
    } else {
      // Cyber neon billboards & holographic arches
      const signs = [[60, '⚖️ 法务警告', '#22d3ee'], [270, '🎵 曼波 LIVE', '#f472b6'], [480, '🚫 禁止超车', '#fde047']];
      for (const [sx, txt, col] of signs) {
        g.strokeStyle = '#334155'; g.lineWidth = 6;
        g.beginPath(); g.moveTo(sx + 52, MH); g.lineTo(sx + 52, MH - 86); g.stroke();
        g.fillStyle = 'rgba(15, 23, 42, 0.92)';
        g.strokeStyle = col;
        g.lineWidth = 3;
        g.beginPath(); g.roundRect(sx, MH - 128, 108, 44, 8); g.fill(); g.stroke();
        g.fillStyle = col;
        g.font = '900 13px "PingFang SC", "Microsoft YaHei", sans-serif';
        g.textAlign = 'center';
        g.fillText(txt, sx + 54, MH - 101);
      }
    }
  });

  SCENERY_CACHE.farStrips[id] = far;
  SCENERY_CACHE.midStrips[id] = mid;
}

export function ensureSceneryStudio() {
  if (SCENERY_CACHE.ready) return;
  SCENERY_CACHE.ready = true;
  buildVolumetricClouds();
  for (const [id, pal] of Object.entries(BIOME_PALETTES)) {
    SCENERY_CACHE.soilTiles[id] = buildSoilTile(id, pal);
    buildBiomeParallaxStrips(id);
  }
}

function getSoilPattern(ctx, id) {
  ensureSceneryStudio();
  let map = SCENERY_CACHE.soilPatterns.get(ctx);
  if (!map) {
    map = {};
    SCENERY_CACHE.soilPatterns.set(ctx, map);
  }
  const key = BIOME_PALETTES[id] ? id : 'court';
  if (!map[key]) {
    map[key] = ctx.createPattern(SCENERY_CACHE.soilTiles[key], 'repeat');
  }
  return map[key];
}

function drawBiomeLayerSet(ctx, W, H, camX, stageId, now) {
  const pal = BIOME_PALETTES[stageId] || BIOME_PALETTES.court;

  // 1. 4-Stop Rich Atmospheric Sky Gradient
  const sg = ctx.createLinearGradient(0, 0, 0, H * 0.78);
  sg.addColorStop(0, pal.sky[0]);
  sg.addColorStop(0.38, pal.sky[1]);
  sg.addColorStop(0.76, pal.sky[2]);
  sg.addColorStop(1, pal.sky[3]);
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, W, H);

  // 2. Celestial Centerpiece (Radiant Sun / Jade Moon / Synthwave Sun / Aurora)
  const sunX = W * 0.78;
  const sunY = H * 0.19;
  if (stageId === 'cyber') {
    const cg = ctx.createLinearGradient(sunX, sunY - 46, sunX, sunY + 46);
    cg.addColorStop(0, '#fde047');
    cg.addColorStop(0.55, '#f43f5e');
    cg.addColorStop(1, '#a855f7');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(sunX, sunY, 44, 0, Math.PI * 2); ctx.fill();
    // Synthwave horizontal scanline cuts
    ctx.fillStyle = pal.sky[1];
    for (let s = 4; s < 40; s += 9) {
      ctx.fillRect(sunX - 46, sunY + s, 92, 3);
    }
  } else if (stageId === 'snow') {
    // Shimmering Aurora Borealis Ribbon + Crisp Polar Sun
    ctx.save();
    ctx.globalAlpha = 0.34;
    const ag = ctx.createLinearGradient(0, H * 0.06, W, H * 0.28);
    ag.addColorStop(0, 'rgba(52, 211, 153, 0)');
    ag.addColorStop(0.35, 'rgba(52, 211, 153, 0.85)');
    ag.addColorStop(0.7, 'rgba(56, 189, 248, 0.75)');
    ag.addColorStop(1, 'rgba(168, 85, 247, 0)');
    ctx.strokeStyle = ag;
    ctx.lineWidth = 28;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 36) {
      const y = H * 0.16 + Math.sin(x * 0.012 + now * 0.0015) * 18;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath(); ctx.arc(sunX, sunY, 42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath(); ctx.arc(sunX, sunY, 24, 0, Math.PI * 2); ctx.fill();
  } else if (stageId === 'swamp' || stageId === 'bamboo') {
    ctx.fillStyle = 'rgba(236, 252, 203, 0.18)';
    ctx.beginPath(); ctx.arc(sunX, sunY, 52, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fef9c3';
    ctx.beginPath(); ctx.arc(sunX, sunY, 28, 0, Math.PI * 2); ctx.fill();
  } else {
    const col = stageId === 'volcano' ? 'rgba(249, 115, 22, 0.28)' : 'rgba(254, 240, 138, 0.28)';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(sunX, sunY, 56 + Math.sin(now * 0.003) * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = stageId === 'volcano' ? '#fb923c' : '#fef08a';
    ctx.beginPath(); ctx.arc(sunX, sunY, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sunX - 6, sunY - 6, 12, 0, Math.PI * 2); ctx.fill();
  }

  // 3. Volumetric Drifting Clouds (2 Parallax Depths — replaces flat white lines!)
  if (stageId !== 'cyber') {
    const clouds = SCENERY_CACHE.clouds;
    const cloudSpan = 340;
    const cloudAlpha = stageId === 'volcano' ? 0.28 : (stageId === 'swamp' ? 0.42 : 0.86);
    ctx.save();
    ctx.globalAlpha = cloudAlpha;
    for (let i = -1; i <= Math.ceil(W / cloudSpan) + 1; i++) {
      const cImg = clouds[Math.abs(i) % clouds.length];
      const scroll = (camX * 0.055 + now * 0.012) % cloudSpan;
      const cx = i * cloudSpan - scroll;
      const cy = H * (0.11 + (Math.abs(i * 7) % 3) * 0.065);
      ctx.drawImage(cImg, cx, cy, cImg.width * 0.78, cImg.height * 0.78);
    }
    ctx.restore();
  }

  // 4. Seamless Far Parallax Strip (`0.11x`) + Midground Strip (`0.25x`) + Horizon Skirt (eliminates downhill sky gaps!)
  const horizonY = H * 0.69;
  ctx.fillStyle = pal.turfMid;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, horizonY + 8, W, H - horizonY);
  ctx.globalAlpha = 1;

  const farStrip = SCENERY_CACHE.farStrips[stageId] || SCENERY_CACHE.farStrips.court;
  if (farStrip) {
    const fw = farStrip.width;
    const offX = -(((camX * 0.11) % fw + fw) % fw);
    for (let x = offX; x < W; x += fw) {
      ctx.drawImage(farStrip, x, horizonY - farStrip.height + 24);
    }
  }

  const midStrip = SCENERY_CACHE.midStrips[stageId] || SCENERY_CACHE.midStrips.court;
  if (midStrip) {
    const mw = midStrip.width;
    const offX = -(((camX * 0.25) % mw + mw) % mw);
    for (let x = offX; x < W; x += mw) {
      ctx.drawImage(midStrip, x, horizonY - midStrip.height + 34);
    }
  }

  // 5. Lightweight Ambient Biome Motes (Snowflakes / Embers / Fireflies / Bamboo Leaves)
  ctx.save();
  ctx.fillStyle = pal.moteCol;
  for (let m = 0; m < 16; m++) {
    const seed = m * 97.31;
    const mx = (((seed * 23.7 - camX * 0.35 + now * (pal.moteKind === 'snow' ? -0.03 : 0.02)) % (W + 40)) + (W + 40)) % (W + 40) - 20;
    const dirY = pal.moteKind === 'ember' ? -0.055 : (pal.moteKind === 'firefly' ? 0.012 : 0.045);
    const my = (((seed * 41.9 + now * dirY) % (H * 0.68)) + (H * 0.68)) % (H * 0.68);
    const r = 1.8 + (m % 3) * 1.1;
    if (pal.moteKind === 'leaf') {
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(now * 0.003 + m);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 2.2, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

export function drawBiomeAtmosphere(ctx, W, H, camX, st, prevSt, stageFadeTimer, bonusSkyAlpha, now = performance.now()) {
  ensureSceneryStudio();
  const curId = (st && st.id) || 'court';
  drawBiomeLayerSet(ctx, W, H, camX, curId, now);

  if (stageFadeTimer > 0.01 && prevSt && prevSt.id !== curId) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, stageFadeTimer);
    drawBiomeLayerSet(ctx, W, H, camX, prevSt.id, now);
    ctx.restore();
  }

  if (bonusSkyAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, bonusSkyAlpha);
    const rg = ctx.createLinearGradient(0, 0, 0, H);
    rg.addColorStop(0, '#1e1b4b');
    rg.addColorStop(0.38, '#6d28d9');
    rg.addColorStop(0.74, '#ec4899');
    rg.addColorStop(1, '#fef08a');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
    // Fever Starlight Sparkles & Rainbow Ribbons
    ctx.fillStyle = '#ffffff';
    for (let s = 0; s < 22; s++) {
      const sx = (((s * 131 - now * 0.18) % W) + W) % W;
      const sy = ((s * 67) % Math.max(80, H * 0.65));
      const sr = 1.5 + (s % 3) * 1.4;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

export function drawSculptedTerrainAndRoad(ctx, opts) {
  const {
    startWX, endWX, camY, viewHWorld, st,
    pits, iceZones, mudZones, roadScars,
    getTerrainStateAt, getBaseSurfaceY,
    superBonusTimer, now = performance.now()
  } = opts;

  if (!Number.isFinite(startWX) || !Number.isFinite(endWX) || endWX < startWX || (endWX - startWX) > 25000) return;

  ensureSceneryStudio();
  const stageId = (st && st.id) || 'court';
  const pal = BIOME_PALETTES[stageId] || BIOME_PALETTES.court;
  const bottomY = camY + viewHWorld + 320;

  if (superBonusTimer > 0) {
    // 3D Starlight Rainbow Skybridge!
    const ry = -214;
    const rg = ctx.createLinearGradient(0, ry - 8, 0, ry + 34);
    rg.addColorStop(0, '#fde047');
    rg.addColorStop(0.35, '#ec4899');
    rg.addColorStop(0.72, '#38bdf8');
    rg.addColorStop(1, '#4f46e5');
    ctx.fillStyle = rg;
    ctx.fillRect(startWX, ry - 6, endWX - startWX, 32);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(startWX, ry - 6); ctx.lineTo(endWX, ry - 6);
    ctx.stroke();
    // Animated light-chaser chevrons along Rainbow Road
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 3;
    const flow = (now * 0.18) % 56;
    for (let wx = Math.floor(startWX / 56) * 56 + flow; wx < endWX; wx += 56) {
      ctx.beginPath();
      ctx.moveTo(wx - 8, ry + 4); ctx.lineTo(wx + 4, ry + 10); ctx.lineTo(wx - 8, ry + 16);
      ctx.stroke();
    }
    return;
  }

  // 1. Rich Sub-Surface Geological Cross-Section Polygon (Pattern-Filled!)
  ctx.save();
  ctx.fillStyle = getSoilPattern(ctx, stageId);
  ctx.beginPath();
  ctx.moveTo(startWX, bottomY);
  for (let wx = startWX; wx <= endWX; wx += 18) {
    const ts = getTerrainStateAt(wx);
    ctx.lineTo(wx, ts.isPit ? bottomY : ts.y + 18);
  }
  ctx.lineTo(endWX, bottomY);
  ctx.closePath();
  ctx.fill();

  // Deep Bottom Vignette over Underground so Bottom UI Controls Pop Crisp & Clear!
  const dg = ctx.createLinearGradient(0, camY + viewHWorld * 0.54, 0, camY + viewHWorld + 30);
  dg.addColorStop(0, 'rgba(2, 6, 23, 0.08)');
  dg.addColorStop(1, 'rgba(2, 6, 23, 0.78)');
  ctx.fillStyle = dg;
  ctx.fill();
  ctx.restore();

  // 2. Lush Turf / Snow / Crust Overhang Band right under the Road Deck!
  ctx.save();
  ctx.strokeStyle = pal.turfMid;
  ctx.lineWidth = 22;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  let pen = false;
  for (let wx = startWX; wx <= endWX; wx += 18) {
    const ts = getTerrainStateAt(wx);
    if (ts.isPit) pen = false;
    else {
      if (!pen) { ctx.moveTo(wx, ts.y + 20); pen = true; }
      else ctx.lineTo(wx, ts.y + 20);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = pal.turfTop;
  ctx.lineWidth = 9;
  ctx.beginPath();
  pen = false;
  for (let wx = startWX; wx <= endWX; wx += 18) {
    const ts = getTerrainStateAt(wx);
    if (ts.isPit) pen = false;
    else {
      if (!pen) { ctx.moveTo(wx, ts.y + 13); pen = true; }
      else ctx.lineTo(wx, ts.y + 13);
    }
  }
  ctx.stroke();

  // Periodic Roadside Grass Blades / Snow Tufts / Crystals behind the curb!
  ctx.fillStyle = pal.turfTop;
  for (let wx = Math.floor(startWX / 76) * 76; wx <= endWX; wx += 76) {
    const ts = getTerrainStateAt(wx);
    if (ts.isPit) continue;
    const gy = ts.y;
    if (stageId === 'cyber') {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(wx - 3, gy - 14, 6, 14);
      ctx.fillStyle = (wx / 76) % 2 === 0 ? '#22d3ee' : '#e879f9';
      ctx.fillRect(wx - 2, gy - 13, 4, 5);
    } else {
      ctx.fillStyle = pal.turfTop;
      ctx.beginPath();
      ctx.moveTo(wx - 9, gy + 2);
      ctx.lineTo(wx - 5, gy - 9);
      ctx.lineTo(wx - 1, gy + 1);
      ctx.lineTo(wx + 3, gy - 11);
      ctx.lineTo(wx + 8, gy + 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 3. 3D Beveled Racing Asphalt Highway + Center Lane Dashes + Red/White Rumble Curbs!
  // Dark structural base
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  pen = false;
  for (let wx = startWX; wx <= endWX; wx += 18) {
    const ts = getTerrainStateAt(wx);
    if (ts.isPit) pen = false;
    else {
      if (!pen) { ctx.moveTo(wx, ts.y + 6); pen = true; }
      else ctx.lineTo(wx, ts.y + 6);
    }
  }
  ctx.stroke();

  // Main Asphalt Surface
  ctx.strokeStyle = pal.asphalt;
  ctx.lineWidth = 16;
  ctx.beginPath();
  pen = false;
  for (let wx = startWX; wx <= endWX; wx += 18) {
    const ts = getTerrainStateAt(wx);
    if (ts.isPit) pen = false;
    else {
      if (!pen) { ctx.moveTo(wx, ts.y + 4.5); pen = true; }
      else ctx.lineTo(wx, ts.y + 4.5);
    }
  }
  ctx.stroke();

  // Top Specular Road Shoulder Rim
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  pen = false;
  for (let wx = startWX; wx <= endWX; wx += 18) {
    const ts = getTerrainStateAt(wx);
    if (ts.isPit) pen = false;
    else {
      if (!pen) { ctx.moveTo(wx, ts.y - 2); pen = true; }
      else ctx.lineTo(wx, ts.y - 2);
    }
  }
  ctx.stroke();

  // Single Crisp Center Racing Lane Dashes + Continuous Alternating Rumble Curb!
  ctx.lineCap = 'butt';
  for (let wx = Math.floor(startWX / 32) * 32; wx <= endWX; wx += 32) {
    const ts1 = getTerrainStateAt(wx);
    const ts2 = getTerrainStateAt(wx + 32);
    if (ts1.isPit || ts2.isPit) continue;
    ctx.strokeStyle = (Math.floor(wx / 32) % 2 === 0) ? pal.curbA : pal.curbB;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(wx, ts1.y + 13);
    ctx.lineTo(wx + 32, ts2.y + 13);
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  for (let wx = Math.floor(startWX / 64) * 64; wx <= endWX; wx += 64) {
    const ts1 = getTerrainStateAt(wx);
    const ts2 = getTerrainStateAt(wx + 24);
    if (ts1.isPit || ts2.isPit) continue;
    ctx.strokeStyle = pal.lane;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(wx, ts1.y + 4.5);
    ctx.lineTo(wx + 24, ts2.y + 4.5);
    ctx.stroke();
  }
  ctx.restore();

  // 4. Special Surface Overlays: Ice Glaze, Bubbling Mud, Crater Scars & Chasm Pits!
  if (iceZones) {
    for (let i = 0; i < iceZones.length; i++) {
      const iz = iceZones[i];
      if (iz.x + iz.len < startWX || iz.x > endWX) continue;
      ctx.save();
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 14;
      ctx.beginPath();
      for (let wx = iz.x; wx <= iz.x + iz.len; wx += 20) {
        const iy = getBaseSurfaceY(wx) + 3;
        if (wx === iz.x) ctx.moveTo(wx, iy); else ctx.lineTo(wx, iy);
      }
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  if (mudZones) {
    for (let i = 0; i < mudZones.length; i++) {
      const mz = mudZones[i];
      if (mz.x + mz.len < startWX || mz.x > endWX) continue;
      ctx.save();
      ctx.strokeStyle = mz.dried ? '#d97706' : '#7e22ce';
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let wx = mz.x; wx <= mz.x + mz.len; wx += 20) {
        const my = getBaseSurfaceY(wx) + 4;
        if (wx === mz.x) ctx.moveTo(wx, my); else ctx.lineTo(wx, my);
      }
      ctx.stroke();
      if (!mz.dried) {
        ctx.fillStyle = '#d8b4fe';
        for (let b = 0; b < 4; b++) {
          const bx = mz.x + 22 + b * ((mz.len - 44) / 3);
          const br = 2.5 + Math.abs(Math.sin(now * 0.008 + b * 1.7)) * 3.5;
          ctx.beginPath(); ctx.arc(bx, getBaseSurfaceY(bx) + 1, br, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  if (roadScars) {
    for (let i = 0; i < roadScars.length; i++) {
      const sc = roadScars[i];
      if (sc.x < startWX - 60 || sc.x > endWX + 60) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.beginPath(); ctx.ellipse(sc.x, sc.y + 4, sc.r * 0.65, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  if (pits) {
    for (let i = 0; i < pits.length; i++) {
      const pit = pits[i];
      if (pit.x + pit.len < startWX - 80 || pit.x > endWX + 120) continue;
      const y1 = getBaseSurfaceY(pit.x);
      const y2 = getBaseSurfaceY(pit.x + pit.len);
      ctx.save();
      if (!pit.bridged) {
        // Glowing Hazardous Chasm Depth + Jagged Cliff Walls
        const pg = ctx.createLinearGradient(0, y1, 0, y1 + 210);
        pg.addColorStop(0, 'rgba(15, 23, 42, 0.25)');
        pg.addColorStop(0.55, 'rgba(220, 38, 38, 0.55)');
        pg.addColorStop(1, 'rgba(249, 115, 22, 0.92)');
        ctx.fillStyle = pg;
        ctx.fillRect(pit.x, y1 + 8, pit.len, 220);

        // Jagged cliff edges & yellow-black hazard posts
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(pit.x - 8, y1 - 2, 10, 185);
        ctx.fillRect(pit.x + pit.len - 2, y2 - 2, 10, 185);
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(pit.x - 14, y1 - 24, 14, 24, 3);
        ctx.roundRect(pit.x + pit.len, y2 - 24, 14, 24, 3);
        ctx.fill();
        ctx.stroke();

        // Floating Neon Jump Prompt Badge
        const warnX = pit.x - 42;
        const warnY = getBaseSurfaceY(warnX) - 50 + Math.sin(now * 0.015) * 6;
        ctx.translate(warnX, warnY);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = '900 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⬆️', 0, 1);
      } else {
        // 3D Holographic Hard-Light Energy Bridge!
        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.fillRect(pit.x - 10, y1 + 4, pit.len + 20, 14);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(pit.x - 10, y1 + 2); ctx.lineTo(pit.x + pit.len + 10, y2 + 2); ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

export function drawHubDioramaBackdrop(pCtx, cw, ch, now = performance.now()) {
  ensureSceneryStudio();
  // 1. Vibrant Golden-Morning Sky
  const sg = pCtx.createLinearGradient(0, 0, 0, ch);
  sg.addColorStop(0, '#0284c7');
  sg.addColorStop(0.55, '#38bdf8');
  sg.addColorStop(1, '#fef08a');
  pCtx.fillStyle = sg;
  pCtx.fillRect(0, 0, cw, ch);

  // Soft Sunbeams
  pCtx.save();
  pCtx.translate(cw * 0.84, ch * 0.24);
  pCtx.fillStyle = 'rgba(254, 249, 195, 0.26)';
  pCtx.beginPath(); pCtx.arc(0, 0, 32, 0, Math.PI * 2); pCtx.fill();
  pCtx.fillStyle = '#fef08a';
  pCtx.beginPath(); pCtx.arc(0, 0, 17, 0, Math.PI * 2); pCtx.fill();
  pCtx.restore();

  // Drifting Mini Volumetric Clouds
  const clouds = SCENERY_CACHE.clouds;
  if (clouds.length > 0) {
    const c1 = ((now * 0.018) % (cw + 120)) - 60;
    const c2 = (((now * 0.012) + cw * 0.52) % (cw + 120)) - 60;
    pCtx.drawImage(clouds[0], cw - c1, 8, 86, 34);
    pCtx.drawImage(clouds[1], cw - c2, 20, 68, 28);
  }

  // Distant Rolling Emerald Park Hills & Trees
  const roadTop = ch - 26;
  pCtx.fillStyle = '#16a34a';
  pCtx.beginPath();
  pCtx.moveTo(0, roadTop);
  pCtx.quadraticCurveTo(cw * 0.24, roadTop - 28, cw * 0.52, roadTop - 10);
  pCtx.quadraticCurveTo(cw * 0.78, roadTop - 32, cw, roadTop - 8);
  pCtx.lineTo(cw, roadTop + 6);
  pCtx.lineTo(0, roadTop + 6);
  pCtx.closePath();
  pCtx.fill();

  pCtx.fillStyle = '#22c55e';
  for (const tx of [cw * 0.14, cw * 0.31, cw * 0.72, cw * 0.90]) {
    pCtx.beginPath();
    pCtx.arc(tx, roadTop - 14, 11, 0, Math.PI * 2);
    pCtx.arc(tx + 9, roadTop - 10, 8, 0, Math.PI * 2);
    pCtx.fill();
  }

  // 3D Beveled Racing Road + Scrolling Lane Stripes + Rumble Curbs!
  pCtx.fillStyle = '#15803d';
  pCtx.fillRect(0, ch - 12, cw, 12);
  pCtx.fillStyle = '#0f172a';
  pCtx.fillRect(0, roadTop - 2, cw, 17);
  pCtx.fillStyle = '#334155';
  pCtx.fillRect(0, roadTop, cw, 13);

  const stripeOff = (now * 0.16) % 44;
  pCtx.fillStyle = 'rgba(248, 250, 252, 0.88)';
  for (let x = -stripeOff; x < cw + 44; x += 44) {
    pCtx.fillRect(x, roadTop + 5, 20, 2.6);
  }
  for (let x = -stripeOff; x < cw + 44; x += 22) {
    pCtx.fillStyle = Math.floor((x + stripeOff) / 22) % 2 === 0 ? '#ef4444' : '#f8fafc';
    pCtx.fillRect(x, roadTop + 12, 22, 3);
  }

  // Ground Contact Shadow under Hero Bike
  pCtx.fillStyle = 'rgba(15, 23, 42, 0.38)';
  pCtx.beginPath();
  pCtx.ellipse(cw * 0.48, ch - 13, 38, 5.5, 0, 0, Math.PI * 2);
  pCtx.fill();
}

export function drawPipMiniScenery(ctx, vx0, vy0, vw, vh, st, focusWX, getSurfaceY, subStartWX, subEndWX, pits) {
  ensureSceneryStudio();
  const stageId = (st && st.id) || 'court';
  const pal = BIOME_PALETTES[stageId] || BIOME_PALETTES.court;

  // Sky gradient in screen-space of PiP viewport (before world transform)
  const sg = ctx.createLinearGradient(0, vy0, 0, vy0 + vh);
  sg.addColorStop(0, pal.sky[0]);
  sg.addColorStop(0.55, pal.sky[2]);
  sg.addColorStop(1, pal.sky[3]);
  ctx.fillStyle = sg;
  ctx.fillRect(vx0, vy0, vw, vh);

  const farStrip = SCENERY_CACHE.farStrips[stageId] || SCENERY_CACHE.farStrips.court;
  if (farStrip) {
    const scale = 0.34;
    const sw = farStrip.width * scale;
    const sh = farStrip.height * scale;
    const offX = -(((focusWX * 0.05) % sw + sw) % sw);
    for (let x = vx0 + offX; x < vx0 + vw; x += sw) {
      ctx.drawImage(farStrip, x, vy0 + vh * 0.72 - sh, sw, sh);
    }
  }
}

export function drawPipMiniTrackWorld(ctx, st, getSurfaceY, subStartWX, subEndWX, pits) {
  if (!Number.isFinite(subStartWX) || !Number.isFinite(subEndWX) || subEndWX < subStartWX || (subEndWX - subStartWX) > 16000) return;
  const stageId = (st && st.id) || 'court';
  const pal = BIOME_PALETTES[stageId] || BIOME_PALETTES.court;

  ctx.fillStyle = pal.soilBg;
  ctx.beginPath();
  let firstPt = true;
  for (let wx = Math.floor(subStartWX / 28) * 28; wx <= subEndWX; wx += 28) {
    let inPit = false;
    for (let k = 0; k < pits.length; k++) {
      const pt = pits[k];
      if (!pt.bridged && wx > pt.x && wx < pt.x + pt.len) { inPit = true; break; }
    }
    const gy = inPit ? (getSurfaceY(wx) + 220) : getSurfaceY(wx);
    if (firstPt) { ctx.moveTo(wx, gy + 260); ctx.lineTo(wx, gy + 10); firstPt = false; }
    else ctx.lineTo(wx, gy + 10);
  }
  ctx.lineTo(subEndWX, getSurfaceY(subEndWX) + 260);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = pal.turfTop;
  ctx.lineWidth = 14;
  ctx.beginPath();
  let pen = false;
  for (let wx = Math.floor(subStartWX / 28) * 28; wx <= subEndWX; wx += 28) {
    let inPit = false;
    for (let k = 0; k < pits.length; k++) {
      const pt = pits[k];
      if (!pt.bridged && wx > pt.x && wx < pt.x + pt.len) { inPit = true; break; }
    }
    if (inPit) pen = false;
    else {
      const gy = getSurfaceY(wx) + 12;
      if (!pen) { ctx.moveTo(wx, gy); pen = true; } else ctx.lineTo(wx, gy);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = pal.asphalt;
  ctx.lineWidth = 18;
  ctx.beginPath();
  pen = false;
  for (let wx = Math.floor(subStartWX / 28) * 28; wx <= subEndWX; wx += 28) {
    let inPit = false;
    for (let k = 0; k < pits.length; k++) {
      const pt = pits[k];
      if (!pt.bridged && wx > pt.x && wx < pt.x + pt.len) { inPit = true; break; }
    }
    if (inPit) pen = false;
    else {
      const gy = getSurfaceY(wx) + 3;
      if (!pen) { ctx.moveTo(wx, gy); pen = true; } else ctx.lineTo(wx, gy);
    }
  }
  ctx.stroke();
}
