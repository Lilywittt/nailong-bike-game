// ============================================================================
// 《鹈鹕测试大乱斗》 v8.0 — 3x Super-Sampled Cel-Shaded Vinyl Rig, Boss & Prop Studio
// Double-pass outer ink contours · Articulated footwear IK · HD Hero Portraits
// ============================================================================

export const MODELS = {};
const HERO_PORTRAIT_URLS = {};

const INK = '#18181b';

function inkFill(g, fillStyle, outerWidth = 5.0, strokeCol = INK) {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = strokeCol;
  g.lineWidth = outerWidth;
  g.stroke();
  g.fillStyle = fillStyle;
  g.fill();
}

function makeSprite(w, h, drawFn) {
  const c = document.createElement('canvas');
  const s = 3; // 3x Retina Super-Sampling for crisp edges at any zoom!
  c.width = Math.ceil(w * s);
  c.height = Math.ceil(h * s);
  const g = c.getContext('2d');
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  drawFn(g, w, h);
  return { canvas: c, w, h };
}

export function drawModelOn(targetCtx, key, x, y, rot = 0, sx = 1, sy = sx) {
  const m = MODELS[key];
  if (!m) return;
  targetCtx.save();
  targetCtx.translate(x, y);
  if (rot) targetCtx.rotate(rot);
  if (sx !== 1 || sy !== 1) targetCtx.scale(sx, sy);
  targetCtx.drawImage(m.canvas, -m.w * 0.5, -m.h * 0.5, m.w, m.h);
  targetCtx.restore();
}

function drawAnimeEye(g, ex, ey, er, irisTop, irisBot, lookX = 1.4) {
  g.beginPath();
  g.arc(ex, ey, er, 0, Math.PI * 2);
  inkFill(g, '#ffffff', 3.8);

  const ig = g.createLinearGradient(ex, ey - er * 0.65, ex, ey + er * 0.65);
  ig.addColorStop(0, irisBot);
  ig.addColorStop(1, irisTop);
  g.fillStyle = ig;
  g.beginPath();
  g.arc(ex + lookX, ey + 0.3, er * 0.66, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = '#090d16';
  g.beginPath();
  g.arc(ex + lookX * 1.15, ey + 0.4, er * 0.35, 0, Math.PI * 2);
  g.fill();

  // Upper eyelid crease + twin starlight catchlights
  g.strokeStyle = INK;
  g.lineWidth = 2.0;
  g.beginPath();
  g.arc(ex, ey, er * 0.96, Math.PI * 1.12, Math.PI * 1.88);
  g.stroke();

  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(ex + lookX + er * 0.22, ey - er * 0.28, er * 0.24, 0, Math.PI * 2);
  g.arc(ex + lookX - er * 0.20, ey + er * 0.24, er * 0.12, 0, Math.PI * 2);
  g.fill();
}

export function buildAllSculptedAssets() {
  // ---------- A. 5 CEL-SHADED TOY-VINYL PLAYER HEROES ----------

  // 1. NAILOONG (大头奶龙 — Plump golden-butter dragon, tangerine spikes, emerald anime eyes & baby fang!)
  MODELS.nailong_torso = makeSprite(90, 80, (g) => {
    g.translate(48, 44);
    // 3 Glossy Tangerine Dorsal Spikes along Tail & Back
    for (const [sx, sy, sr] of [[-29, -4, 5.8], [-37, -12, 5.0], [-21, -18, 6.2]]) {
      const sg = g.createRadialGradient(sx - 1, sy - 2, 1, sx, sy, sr);
      sg.addColorStop(0, '#fed7aa');
      sg.addColorStop(0.55, '#fb923c');
      sg.addColorStop(1, '#ea580c');
      g.beginPath();
      g.arc(sx, sy, sr, 0, Math.PI * 2);
      inkFill(g, sg, 4.4);
    }
    // Chubby Pear-Shaped Dragon Body & Sweeping Tail
    const tg = g.createRadialGradient(-2, -6, 4, -6, 4, 36);
    tg.addColorStop(0, '#fef9c3');
    tg.addColorStop(0.55, '#facc15');
    tg.addColorStop(0.88, '#eab308');
    tg.addColorStop(1, '#ca8a04');
    g.beginPath();
    g.moveTo(-16, 19);
    g.quadraticCurveTo(-41, 15, -42, -8);
    g.quadraticCurveTo(-30, 3, -20, -4);
    g.bezierCurveTo(-22, -27, 15, -29, 19, -2);
    g.bezierCurveTo(23, 19, 5, 25, -16, 19);
    g.closePath();
    inkFill(g, tg, 5.0);

    // Cream Dragon Belly Patch + Ribbed Tummy Lines
    g.fillStyle = '#fefce8';
    g.beginPath();
    g.ellipse(5, 2, 12.5, 15.5, 0.12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(202, 138, 4, 0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(5, -2, 7.5, 0.25, 2.85);
    g.moveTo(-2, 5);
    g.quadraticCurveTo(5, 8, 12, 4);
    g.stroke();
  });

  MODELS.nailong_head = makeSprite(96, 90, (g) => {
    g.translate(46, 48);
    // Cute Tangerine Horns & Dorsal Fin
    const hg = g.createLinearGradient(0, -38, 0, -18);
    hg.addColorStop(0, '#ffedd5');
    hg.addColorStop(0.5, '#fb923c');
    hg.addColorStop(1, '#ea580c');
    for (const [hx, hy, rot] of [[-10, -29, -0.25], [5, -30, 0.22]]) {
      g.save();
      g.translate(hx, hy);
      g.rotate(rot);
      g.beginPath();
      g.ellipse(0, 0, 5.8, 9.5, 0, 0, Math.PI * 2);
      inkFill(g, hg, 4.4);
      g.restore();
    }
    g.beginPath();
    g.arc(-27, -6, 6.2, 0, Math.PI * 2);
    inkFill(g, hg, 4.2);

    // Ear nub
    g.beginPath();
    g.ellipse(-25, -15, 6.4, 4.8, -0.4, 0, Math.PI * 2);
    inkFill(g, '#fde047', 4.2);

    // Chubby Pinchable Cheeks + Protruding Snout Cranium
    const sk = g.createRadialGradient(-3, -13, 5, 2, 2, 40);
    sk.addColorStop(0, '#ffffff');
    sk.addColorStop(0.24, '#fef08a');
    sk.addColorStop(0.72, '#facc15');
    sk.addColorStop(1, '#d97706');
    g.beginPath();
    g.moveTo(-19, -23);
    g.bezierCurveTo(-4, -31, 17, -28, 23, -12);
    g.bezierCurveTo(37, -9, 41, 7, 31, 16);
    g.bezierCurveTo(18, 28, -15, 29, -25, 14);
    g.bezierCurveTo(-34, 2, -30, -16, -19, -23);
    g.closePath();
    inkFill(g, sk, 5.2);

    // Warm Cel-Shadow Crescent Under Jaw + Vinyl Top Highlight
    g.fillStyle = 'rgba(217, 119, 6, 0.28)';
    g.beginPath();
    g.bezierCurveTo(-22, 12, 2, 25, 28, 13);
    g.bezierCurveTo(14, 27, -14, 27, -24, 14);
    g.fill();

    g.fillStyle = 'rgba(255, 255, 255, 0.68)';
    g.beginPath();
    g.ellipse(-6, -18, 9.5, 4.2, -0.25, 0, Math.PI * 2);
    g.fill();

    // Airbrushed Coral Cheek Blush + Cute Blush Slash Marks
    g.fillStyle = 'rgba(251, 113, 133, 0.56)';
    g.beginPath();
    g.ellipse(-1, 7, 8.8, 5.4, 0, 0, Math.PI * 2);
    g.fill();

    // Sparkling Emerald Dragon Eyes
    drawAnimeEye(g, 6, -7, 8.4, '#4ade80', '#15803d', 1.4);
    drawAnimeEye(g, 20.5, -7, 7.0, '#4ade80', '#15803d', 1.2);

    // Snout Nostrils
    g.fillStyle = '#92400e';
    g.beginPath();
    g.arc(28, -2, 1.5, 0, Math.PI * 2);
    g.arc(33, -1.5, 1.4, 0, Math.PI * 2);
    g.fill();

    // Joyful Open Dragon Mouth + Pink Tongue + Iconic Baby Fang!
    g.beginPath();
    g.moveTo(9, 6);
    g.quadraticCurveTo(22, 4, 30, 7);
    g.quadraticCurveTo(24, 21, 11, 16);
    g.closePath();
    inkFill(g, '#881337', 3.6);

    g.fillStyle = '#fb7185';
    g.beginPath();
    g.ellipse(19.5, 13.8, 7.2, 4.2, 0, 0, Math.PI * 2);
    g.fill();

    g.beginPath();
    g.moveTo(20, 6.2);
    g.lineTo(22.6, 11.4);
    g.lineTo(25.2, 6.6);
    g.closePath();
    inkFill(g, '#ffffff', 2.4);
  });

  // 2. IKUN (中分ikun — Layered silver idol curtain hair, tailored idol suit, crisp shirt & brass suspenders!)
  MODELS.ikun_torso = makeSprite(76, 76, (g) => {
    g.translate(38, 40);
    const sg = g.createLinearGradient(-16, -22, 16, 22);
    sg.addColorStop(0, '#334155');
    sg.addColorStop(0.6, '#1e293b');
    sg.addColorStop(1, '#090d16');
    g.beginPath();
    g.roundRect(-16, -23, 30, 40, 10);
    inkFill(g, sg, 5.0);

    // Crisp White Dress Shirt V-Neck + Red Tie Accent
    g.beginPath();
    g.moveTo(-7, -23);
    g.lineTo(2, -9);
    g.lineTo(9, -23);
    g.closePath();
    inkFill(g, '#ffffff', 3.4);

    g.fillStyle = '#e11d48';
    g.beginPath();
    g.moveTo(0, -18);
    g.lineTo(4, -18);
    g.lineTo(3, -10);
    g.lineTo(1, -10);
    g.closePath();
    g.fill();

    // Iconic White Suspenders (背带) + Gleaming Gold Clips!
    for (const [x1, x2] of [[-11, -9], [6, 4]]) {
      g.strokeStyle = INK;
      g.lineWidth = 7.4;
      g.beginPath(); g.moveTo(x1, -21); g.lineTo(x2, 15); g.stroke();
      g.strokeStyle = '#f8fafc';
      g.lineWidth = 4.4;
      g.stroke();
    }
    for (const cx of [-12, 1]) {
      g.beginPath();
      g.roundRect(cx, 4, 6.5, 5.5, 1.5);
      inkFill(g, '#facc15', 3.0);
    }
  });

  MODELS.ikun_head = makeSprite(88, 86, (g) => {
    g.translate(44, 46);
    // Back Hair Volume
    g.beginPath();
    g.arc(-4, -6, 24, 0, Math.PI * 2);
    inkFill(g, '#64748b', 5.0);

    // Anime Idol Face & Ear
    const fg = g.createRadialGradient(3, -2, 3, 0, 2, 24);
    fg.addColorStop(0, '#fff7ed');
    fg.addColorStop(0.7, '#ffedd5');
    fg.addColorStop(1, '#fdba74');
    g.beginPath();
    g.arc(-16, 2, 5.2, 0, Math.PI * 2);
    inkFill(g, fg, 4.2);

    g.beginPath();
    g.moveTo(-16, -11);
    g.bezierCurveTo(-16, 15, 0, 20, 9, 18);
    g.bezierCurveTo(19, 15, 21, -4, 17, -14);
    g.closePath();
    inkFill(g, fg, 4.8);

    // Subtle Idol Cheek Blush + Confident Eye + Smirk
    g.fillStyle = 'rgba(251, 113, 133, 0.36)';
    g.beginPath(); g.ellipse(4, 5, 5.5, 3.2, 0, 0, Math.PI * 2); g.fill();

    drawAnimeEye(g, 9.5, -1, 5.4, '#38bdf8', '#1e293b', 1.1);
    g.strokeStyle = INK;
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(3, -8); g.lineTo(15, -6.5); g.stroke();
    g.strokeStyle = '#be123c';
    g.lineWidth = 2.2;
    g.beginPath(); g.arc(8.5, 7.5, 4.5, 0.15, Math.PI * 0.85); g.stroke();

    // Sculpted Silver-Platinum Middle-Part Curtain Hair (中分银发) + Angel-Ring Shine!
    const hg = g.createLinearGradient(0, -29, 0, 12);
    hg.addColorStop(0, '#ffffff');
    hg.addColorStop(0.48, '#e2e8f0');
    hg.addColorStop(1, '#64748b');
    g.beginPath();
    g.moveTo(2, -25);
    g.bezierCurveTo(-22, -28, -31, -8, -25, 11);
    g.quadraticCurveTo(-15, -2, -5, -9);
    g.quadraticCurveTo(0, -16, 3, -14);
    g.bezierCurveTo(12, -4, 19, 2, 25, 10);
    g.bezierCurveTo(29, -10, 21, -27, 2, -25);
    g.closePath();
    inkFill(g, hg, 5.0);

    // Hair Gloss Arcs & Center Part Crease
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(-11, -13, 9, 3.5, 5.1);
    g.moveTo(6, -19);
    g.quadraticCurveTo(14, -19, 19, -11);
    g.stroke();
  });

  // 3. PELICAN (背带鹈鹕 — Snow-white plumage, denim overalls, golden ribbed pouch & curtain crest!)
  MODELS.pelican_rig = makeSprite(124, 112, (g) => {
    g.translate(50, 68);
    // Feathered Tail & Plump Body
    const wg = g.createRadialGradient(-4, 2, 4, -8, 8, 28);
    wg.addColorStop(0, '#ffffff');
    wg.addColorStop(0.72, '#f1f5f9');
    wg.addColorStop(1, '#cbd5e1');
    g.beginPath();
    g.moveTo(-28, 4);
    g.lineTo(-39, -3);
    g.lineTo(-34, 9);
    g.lineTo(-40, 14);
    g.lineTo(-24, 14);
    g.closePath();
    inkFill(g, wg, 4.4);

    g.beginPath();
    g.ellipse(-7, 6, 25, 17.5, -0.16, 0, Math.PI * 2);
    inkFill(g, wg, 5.0);

    // Denim Suspender Overalls + Brass Buttons
    const dg = g.createLinearGradient(-20, -6, 10, 20);
    dg.addColorStop(0, '#334155');
    dg.addColorStop(1, '#0f172a');
    g.beginPath();
    g.ellipse(-6, 7.5, 16.5, 14, -0.16, 0, Math.PI * 2);
    inkFill(g, dg, 4.4);

    g.strokeStyle = '#ffffff';
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(-14, -5); g.lineTo(-2, 18);
    g.moveTo(0, -5); g.lineTo(-12, 18);
    g.stroke();
    g.fillStyle = '#facc15';
    g.beginPath(); g.arc(-8, 5, 2.5, 0, Math.PI * 2); g.fill();

    // Sculpted S-Curve Neck & Head
    g.beginPath();
    g.moveTo(2, 0);
    g.bezierCurveTo(16, -12, -4, -26, 8, -43);
    g.lineTo(19, -41);
    g.bezierCurveTo(10, -24, 28, -10, 14, 6);
    g.closePath();
    inkFill(g, wg, 4.8);

    g.beginPath();
    g.arc(14, -45, 13.5, 0, Math.PI * 2);
    inkFill(g, '#ffffff', 4.8);

    // Ribbed Golden-Orange Gular Throat Pouch + Hooked Beak!
    const pg = g.createLinearGradient(20, -45, 52, -16);
    pg.addColorStop(0, '#fdba74');
    pg.addColorStop(0.45, '#f97316');
    pg.addColorStop(1, '#eab308');
    g.beginPath();
    g.moveTo(20, -42);
    g.lineTo(65, -45);
    g.quadraticCurveTo(49, -12, 17, -33);
    g.closePath();
    inkFill(g, pg, 4.8);

    // Pouch ribs
    g.strokeStyle = 'rgba(154, 52, 18, 0.45)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(24, -36); g.quadraticCurveTo(42, -26, 56, -41);
    g.moveTo(22, -32); g.quadraticCurveTo(38, -21, 50, -35);
    g.stroke();

    // Upper Beak & Crimson Hook Nail
    g.beginPath();
    g.moveTo(20, -50);
    g.lineTo(66, -49);
    g.lineTo(65, -42);
    g.lineTo(20, -41);
    g.closePath();
    inkFill(g, '#fef08a', 4.2);

    g.beginPath();
    g.moveTo(64, -49);
    g.lineTo(70, -44);
    g.lineTo(63, -41);
    g.closePath();
    inkFill(g, '#ef4444', 3.4);

    // Expressive Pelican Eye + Silver Curtain Feather Tuft
    drawAnimeEye(g, 17.5, -46.5, 4.8, '#fde047', '#ca8a04', 0.9);
    g.beginPath();
    g.ellipse(7, -56, 10, 4.6, -0.35, 0, Math.PI * 2);
    g.ellipse(19, -56, 10, 4.6, 0.35, 0, Math.PI * 2);
    inkFill(g, '#cbd5e1', 4.0);

    // Layered Folded Wing
    g.beginPath();
    g.moveTo(-17, 2);
    g.quadraticCurveTo(4, -9, 22, 0);
    g.quadraticCurveTo(8, 13, -18, 12);
    g.closePath();
    inkFill(g, '#ffffff', 4.4);
  });

  // 4. LAUGHING NAIWA (狂笑奶蛙 — Glossy golden-lime skin, spots, bulging eyes, hilarious toothy grin & 3D tongue!)
  MODELS.naiwa_rig = makeSprite(98, 102, (g) => {
    g.translate(48, 58);
    const bg = g.createRadialGradient(-2, 6, 4, -4, 12, 30);
    bg.addColorStop(0, '#fef08a');
    bg.addColorStop(0.65, '#eab308');
    bg.addColorStop(1, '#a16207');
    g.beginPath();
    g.ellipse(-6, 12, 24.5, 21.5, 0.1, 0, Math.PI * 2);
    inkFill(g, bg, 5.0);

    g.fillStyle = '#fef9c3';
    g.beginPath();
    g.ellipse(3, 14, 14, 14.5, 0.1, 0, Math.PI * 2);
    g.fill();

    // Cute Amphibian Back Spots
    g.fillStyle = 'rgba(161, 98, 7, 0.45)';
    g.beginPath();
    g.arc(-18, 6, 4, 0, Math.PI * 2);
    g.arc(-15, 16, 3, 0, Math.PI * 2);
    g.fill();

    // Wide Sculpted Frog Head
    g.beginPath();
    g.ellipse(4, -20, 29, 20.5, -0.06, 0, Math.PI * 2);
    inkFill(g, bg, 5.2);

    // Glossy Bulging Amphibian Eyes
    drawAnimeEye(g, -5, -37.5, 9.2, '#4ade80', '#15803d', 1.5);
    drawAnimeEye(g, 15.5, -37.5, 9.2, '#4ade80', '#15803d', 1.5);

    // Hilarious Cursed Laughing Mouth + Gleaming Teeth + Curling Pink Tongue!
    g.beginPath();
    g.moveTo(-15, -17);
    g.lineTo(30, -20);
    g.quadraticCurveTo(15, 6, -15, -17);
    g.closePath();
    inkFill(g, '#881337', 4.2);

    g.fillStyle = '#ffffff';
    g.fillRect(-5, -18.5, 26, 4.5);

    const tng = g.createLinearGradient(0, -12, 24, -4);
    tng.addColorStop(0, '#fb7185');
    tng.addColorStop(1, '#f43f5e');
    g.beginPath();
    g.ellipse(13, -7.5, 12, 5.4, 0.16, 0, Math.PI * 2);
    inkFill(g, tng, 3.6);
  });

  // 5. HAKIMI CAT (哈基米猫 — Fluffy ginger tabby, M-stripes, crimson headband, neon shades & chest fluff!)
  MODELS.hakimi_rig = makeSprite(96, 100, (g) => {
    g.translate(48, 58);
    // Fluffy Striped Ginger Tail
    g.strokeStyle = INK;
    g.lineWidth = 12;
    g.beginPath(); g.moveTo(-18, 18); g.quadraticCurveTo(-39, 8, -33, -11); g.stroke();
    g.strokeStyle = '#f97316';
    g.lineWidth = 7.5;
    g.stroke();

    // Plump Ginger Tabby Body + Fluffy White Chest Ruff
    const cg = g.createRadialGradient(0, 8, 3, -4, 10, 28);
    cg.addColorStop(0, '#fed7aa');
    cg.addColorStop(0.6, '#fb923c');
    cg.addColorStop(1, '#c2410c');
    g.beginPath();
    g.ellipse(-6, 10, 20.5, 22.5, 0.08, 0, Math.PI * 2);
    inkFill(g, cg, 5.0);

    g.fillStyle = '#fff7ed';
    g.beginPath();
    g.ellipse(3, 11, 11.5, 15.5, 0.1, 0, Math.PI * 2);
    g.fill();

    // Fluttering Crimson Racing Headband Tails
    for (const [y1, x2, y2, x3, y3] of [[-30, -36, -37, -29, -24], [-27, -34, -19, -25, -13]]) {
      g.beginPath();
      g.moveTo(-14, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath();
      inkFill(g, '#e11d48', 4.0);
    }

    // Fluffy Cat Head + Pointed Ears with Pink Inner Fluff
    g.beginPath();
    g.moveTo(-15, -32);
    g.lineTo(-20, -50);
    g.lineTo(-4, -39);
    g.lineTo(8, -39);
    g.lineTo(23, -50);
    g.lineTo(19, -32);
    g.bezierCurveTo(29, -24, 28, -8, 14, -4.5);
    g.bezierCurveTo(2, -1.5, -17, -4, -21, -16);
    g.closePath();
    inkFill(g, cg, 5.0);

    g.fillStyle = '#fda4af';
    g.beginPath();
    g.moveTo(-13, -34); g.lineTo(-17, -45); g.lineTo(-7, -37); g.closePath();
    g.moveTo(15, -34); g.lineTo(19, -45); g.lineTo(9, -37); g.closePath();
    g.fill();

    // Crimson Headband + Metallic Forehead Plate
    g.beginPath();
    g.roundRect(-18, -34.5, 39, 6.8, 2.5);
    inkFill(g, '#e11d48', 4.0);
    g.beginPath();
    g.roundRect(-1, -34, 13, 5.5, 1.5);
    inkFill(g, '#f8fafc', 2.8);

    // Cool Cyan-Reflective Aviator Shades + ':3' Cat Smirk & Whiskers!
    const sg = g.createLinearGradient(-6, -26, 22, -16);
    sg.addColorStop(0, '#090d16');
    sg.addColorStop(0.5, '#1e293b');
    sg.addColorStop(1, '#0284c7');
    g.beginPath();
    g.roundRect(-7, -25.5, 14, 8.8, 3);
    g.roundRect(9, -25.5, 14, 8.8, 3);
    inkFill(g, sg, 3.4);

    g.strokeStyle = '#7dd3fc';
    g.lineWidth = 2.0;
    g.beginPath();
    g.moveTo(-4, -23.5); g.lineTo(3, -19);
    g.moveTo(12, -23.5); g.lineTo(19, -19);
    g.stroke();

    // Pink nose + ':3' mouth + whiskers
    g.fillStyle = '#fb7185';
    g.beginPath(); g.arc(7, -14.5, 2.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.0;
    g.beginPath();
    g.arc(4, -12, 3.2, 0, Math.PI);
    g.arc(10.4, -12, 3.2, 0, Math.PI);
    g.moveTo(-9, -14); g.lineTo(-19, -15);
    g.moveTo(-9, -11); g.lineTo(-18, -9);
    g.stroke();
  });

  // ---------- B. 7 CEL-SHADED 2.5D BOSSES & 8 ENEMY MOBS ----------

  // BOSS 1: Golden Toilet Mecha-Throne Frog King (黄金马桶蛙皇)
  MODELS.boss_naiwa = makeSprite(142, 142, (g) => {
    g.translate(71, 78);
    // Blazing Thruster Cones
    for (const tx of [-24, 24]) {
      g.beginPath();
      g.moveTo(tx - 8, 34); g.lineTo(tx - 13, 54); g.lineTo(tx, 48); g.lineTo(tx + 13, 54); g.lineTo(tx + 8, 34);
      g.closePath();
      inkFill(g, '#f97316', 4.4);
    }
    const tg = g.createLinearGradient(-36, -24, 38, 38);
    tg.addColorStop(0, '#fef9c3');
    tg.addColorStop(0.5, '#facc15');
    tg.addColorStop(1, '#a16207');
    g.beginPath(); g.roundRect(18, -24, 25, 54, 7); inkFill(g, tg, 5.2);
    g.beginPath(); g.roundRect(-36, 8, 68, 30, 13); inkFill(g, tg, 5.2);

    const fg = g.createRadialGradient(-4, -10, 4, -2, -6, 36);
    fg.addColorStop(0, '#fef08a');
    fg.addColorStop(0.7, '#eab308');
    fg.addColorStop(1, '#854d0e');
    g.beginPath(); g.ellipse(-2, -6, 35, 29, 0, 0, Math.PI * 2); inkFill(g, fg, 5.4);

    // Royal Crown + Ruby
    g.beginPath();
    g.moveTo(-19, -32); g.lineTo(-23, -54); g.lineTo(-8, -42); g.lineTo(0, -58);
    g.lineTo(8, -42); g.lineTo(23, -54); g.lineTo(19, -32); g.closePath();
    inkFill(g, '#fde047', 4.8);
    g.beginPath(); g.arc(0, -41, 5, 0, Math.PI * 2); inkFill(g, '#e11d48', 3.2);

    drawAnimeEye(g, -14, -28, 9.6, '#ef4444', '#7f1d1d', -1.8);
    drawAnimeEye(g, 10, -28, 9.6, '#ef4444', '#7f1d1d', -1.8);

    g.beginPath();
    g.moveTo(-25, -8); g.lineTo(21, -8); g.quadraticCurveTo(-2, 18, -25, -8);
    g.closePath();
    inkFill(g, '#881337', 4.4);
    g.fillStyle = '#ffffff'; g.fillRect(-16, -8, 28, 4.5);

    g.save();
    g.translate(-39, -14);
    g.rotate(-0.4);
    g.beginPath(); g.roundRect(-4, -6, 8, 36, 3); inkFill(g, '#78350f', 4.4);
    g.beginPath(); g.roundRect(-17, -21, 34, 17, 5); inkFill(g, '#92400e', 4.8);
    g.restore();
  });

  // BOSS 2: Twin-Turbine Cyber Mecha-Cat (双涡轮机甲猫)
  MODELS.boss_hakimi = makeSprite(146, 142, (g) => {
    g.translate(73, 76);
    for (const px of [-49, 25]) {
      g.beginPath(); g.roundRect(px, -27, 24, 34, 6); inkFill(g, '#475569', 5.0);
    }
    g.fillStyle = '#ef4444';
    for (const mx of [-41, -33, 33, 41]) {
      g.beginPath(); g.arc(mx, -16, 3.8, 0, Math.PI * 2); g.arc(mx, -5, 3.8, 0, Math.PI * 2); g.fill();
    }
    const mg = g.createLinearGradient(-30, -20, 30, 38);
    mg.addColorStop(0, '#475569');
    mg.addColorStop(1, '#0f172a');
    g.beginPath(); g.roundRect(-31, -12, 62, 49, 13); inkFill(g, mg, 5.4);
    g.beginPath(); g.moveTo(0, -8); g.lineTo(-8, 16); g.lineTo(0, 27); g.lineTo(8, 16); g.closePath();
    inkFill(g, '#e11d48', 3.6);

    const cg = g.createRadialGradient(0, -28, 4, 0, -24, 32);
    cg.addColorStop(0, '#fed7aa');
    cg.addColorStop(0.65, '#fb923c');
    cg.addColorStop(1, '#c2410c');
    g.beginPath();
    g.moveTo(-22, -32); g.lineTo(-29, -57); g.lineTo(-8, -42);
    g.lineTo(8, -42); g.lineTo(29, -57); g.lineTo(22, -32);
    g.arc(0, -24, 25.5, -0.3, Math.PI + 0.3);
    g.closePath();
    inkFill(g, cg, 5.4);

    // Glowing Cyber Visor
    const vg = g.createLinearGradient(-22, -32, 22, -20);
    vg.addColorStop(0, '#22d3ee');
    vg.addColorStop(1, '#3b82f6');
    g.beginPath(); g.roundRect(-23, -33, 46, 13, 6); inkFill(g, vg, 4.4);
    g.fillStyle = '#fef08a';
    g.fillRect(-16, -28.5, 11, 4.2);
    g.fillRect(5, -28.5, 11, 4.2);
  });

  // BOSS 3: 2.5-Year Basketball Mecha Rooster King (两年半机甲坤王)
  MODELS.boss_kun_mecha = makeSprite(150, 146, (g) => {
    g.translate(75, 80);
    g.strokeStyle = '#f97316'; g.lineWidth = 6;
    g.beginPath(); g.arc(0, -18, 49, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#fde047'; g.lineWidth = 2.6; g.setLineDash([7, 4]);
    g.beginPath(); g.arc(0, -18, 43, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);

    for (const sx of [-43, 43]) {
      drawSpaldingWheelOn(g, sx, -14, 15.5, 0.3);
    }
    const kg = g.createLinearGradient(-32, -20, 32, 38);
    kg.addColorStop(0, '#334155');
    kg.addColorStop(1, '#090d16');
    g.beginPath(); g.roundRect(-31, -10, 62, 49, 12); inkFill(g, kg, 5.4);
    g.strokeStyle = '#facc15'; g.lineWidth = 6.5;
    g.beginPath(); g.moveTo(-16, -8); g.lineTo(-12, 34); g.moveTo(16, -8); g.lineTo(12, 34); g.stroke();

    g.beginPath(); g.arc(0, -56, 8.5, 0, Math.PI * 2); inkFill(g, '#e11d48', 4.4);
    g.beginPath(); g.arc(0, -30, 24.5, 0, Math.PI * 2); inkFill(g, '#facc15', 5.2);
    g.beginPath(); g.moveTo(-22, -30); g.lineTo(-38, -25); g.lineTo(-22, -19); g.closePath(); inkFill(g, '#f97316', 4.4);

    g.beginPath();
    g.ellipse(-14, -46, 15.5, 7.2, -0.42, 0, Math.PI * 2);
    g.ellipse(14, -46, 15.5, 7.2, 0.42, 0, Math.PI * 2);
    inkFill(g, '#e2e8f0', 4.6);

    g.beginPath(); g.roundRect(-21, -36, 37, 9.5, 4.5); inkFill(g, '#ef4444', 4.0);
  });

  // BOSS 4: Obsidian Magma Mecha-Tyrannosaur (暗黑熔岩暴龙王)
  MODELS.boss_lava_dragon = makeSprite(154, 146, (g) => {
    g.translate(78, 78);
    g.beginPath();
    g.moveTo(12, -16); g.lineTo(58, -44); g.lineTo(49, 9); g.lineTo(16, 13); g.closePath();
    inkFill(g, '#dc2626', 5.0);

    const dg = g.createLinearGradient(-35, -24, 35, 40);
    dg.addColorStop(0, '#475569');
    dg.addColorStop(0.55, '#1e293b');
    dg.addColorStop(1, '#090d16');
    g.beginPath(); g.ellipse(0, 8, 35, 31, 0, 0, Math.PI * 2); inkFill(g, dg, 5.4);

    g.beginPath(); g.arc(-6, 10, 13, 0, Math.PI * 2); inkFill(g, '#f97316', 4.2);
    g.fillStyle = '#fef08a'; g.beginPath(); g.arc(-6, 10, 6.5, 0, Math.PI * 2); g.fill();

    g.beginPath(); g.moveTo(4, -42); g.lineTo(23, -63); g.lineTo(14, -36); g.closePath(); inkFill(g, '#fde047', 4.6);
    g.beginPath();
    g.moveTo(-42, -24); g.lineTo(-8, -45); g.lineTo(21, -36); g.lineTo(23, -11); g.lineTo(-37, -10); g.closePath();
    inkFill(g, dg, 5.4);

    g.fillStyle = '#ef4444'; g.beginPath(); g.arc(-14, -28, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fef08a'; g.beginPath(); g.arc(-15, -28, 2.8, 0, Math.PI * 2); g.fill();
    for (const fx of [-33, -24, -15]) {
      g.beginPath(); g.moveTo(fx, -10); g.lineTo(fx + 4, -1); g.lineTo(fx + 8, -10); g.closePath();
      inkFill(g, '#ffffff', 3.4);
    }
  });

  // BOSS 5: Hainan Meme Megaphone Rooster (🐔 叮咚鸡)
  MODELS.boss_dingdong = makeSprite(150, 144, (g) => {
    g.translate(78, 80);
    g.strokeStyle = 'rgba(56, 189, 248, 0.85)'; g.lineWidth = 3.6;
    g.beginPath(); g.arc(-53, -16, 14, 2.3, 4.0); g.stroke();
    g.beginPath(); g.arc(-60, -16, 23, 2.3, 4.0); g.stroke();

    const cg = g.createRadialGradient(-4, 4, 5, 0, 8, 39);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.7, '#f1f5f9');
    cg.addColorStop(1, '#cbd5e1');
    g.beginPath(); g.ellipse(4, 10, 35, 31, 0, 0, Math.PI * 2); inkFill(g, cg, 5.4);

    g.beginPath(); g.roundRect(-22, -4, 50, 30, 10); inkFill(g, '#0ea5e9', 4.6);
    g.fillStyle = '#ffffff'; g.fillRect(-4, -4, 12, 30);
    g.beginPath(); g.roundRect(10, 4, 16, 11, 3); inkFill(g, '#ef4444', 3.6);

    g.beginPath();
    g.arc(-6, -51, 7.5, 0, Math.PI * 2);
    g.arc(3, -55, 9, 0, Math.PI * 2);
    g.arc(13, -50, 7.5, 0, Math.PI * 2);
    inkFill(g, '#e11d48', 4.6);

    g.beginPath(); g.arc(2, -28, 24.5, 0, Math.PI * 2); inkFill(g, '#ffffff', 5.2);
    g.strokeStyle = '#0284c7'; g.lineWidth = 4.5;
    g.beginPath(); g.arc(2, -28, 21.5, -1.3, 1.1); g.stroke();

    drawAnimeEye(g, -8, -32, 7.8, '#fde047', '#ca8a04', -1.5);
    g.beginPath(); g.moveTo(-18, -28); g.lineTo(-35, -33); g.lineTo(-20, -21); g.closePath(); inkFill(g, '#f97316', 4.0);
    g.beginPath(); g.moveTo(-18, -21); g.lineTo(-33, -16); g.lineTo(-17, -14); g.closePath(); inkFill(g, '#f97316', 4.0);
    g.beginPath(); g.ellipse(-14, -10, 4.8, 7.2, 0.2, 0, Math.PI * 2); inkFill(g, '#e11d48', 3.8);

    // 3D Red-White Megaphone
    g.save();
    g.translate(-27, -15);
    g.rotate(0.08);
    g.beginPath(); g.moveTo(4, -5); g.lineTo(-25, -19); g.lineTo(-25, 13); g.lineTo(4, 5); g.closePath();
    inkFill(g, '#ef4444', 4.6);
    g.beginPath(); g.roundRect(-10, -9, 12, 14, 2); inkFill(g, '#ffffff', 3.6);
    g.beginPath(); g.ellipse(-25, -3, 4.5, 15.5, 0, 0, Math.PI * 2); inkFill(g, '#fde047', 4.0);
    g.restore();
  });

  // BOSS 6: Wide-Jawed Meme Hound (🐕 大狗嚼)
  MODELS.boss_dagou = makeSprite(154, 142, (g) => {
    g.translate(80, 78);
    g.strokeStyle = INK; g.lineWidth = 12;
    g.beginPath(); g.moveTo(42, 4); g.quadraticCurveTo(61, -14, 49, -29); g.stroke();
    g.strokeStyle = '#b45309'; g.lineWidth = 7.5; g.stroke();

    const bg = g.createRadialGradient(-4, 6, 6, 4, 12, 44);
    bg.addColorStop(0, '#fef08a');
    bg.addColorStop(0.55, '#d97706');
    bg.addColorStop(1, '#92400e');
    g.beginPath(); g.ellipse(12, 12, 35.5, 26.5, -0.12, 0, Math.PI * 2); inkFill(g, bg, 5.4);

    g.beginPath(); g.roundRect(-14, -8, 34, 11, 4); inkFill(g, '#dc2626', 4.4);
    for (const sx of [-8, 2, 12]) {
      g.beginPath(); g.moveTo(sx, -8); g.lineTo(sx + 3, -16); g.lineTo(sx + 6, -8); g.closePath();
      inkFill(g, '#f8fafc', 3.2);
    }

    g.beginPath(); g.ellipse(18, -34, 9.5, 18.5, 0.45, 0, Math.PI * 2); inkFill(g, bg, 4.8);
    g.beginPath();
    g.moveTo(18, -16); g.bezierCurveTo(22, -47, -12, -53, -26, -36);
    g.lineTo(-57, -34); g.quadraticCurveTo(-61, -20, -48, -16);
    g.lineTo(-10, -14); g.closePath();
    inkFill(g, bg, 5.4);

    g.fillStyle = '#7f1d1d';
    g.beginPath(); g.moveTo(-48, -17); g.lineTo(-8, -14); g.lineTo(-42, 10); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(-8, -12); g.lineTo(-48, 8); g.quadraticCurveTo(-52, 18, -36, 18); g.lineTo(6, 2); g.closePath();
    inkFill(g, bg, 5.0);
    g.beginPath(); g.ellipse(-28, -2, 13.5, 5.2, 0.28, 0, Math.PI * 2); inkFill(g, '#fb7185', 3.8);

    for (const fx of [-48, -36, -24]) {
      g.beginPath(); g.moveTo(fx, -16); g.lineTo(fx + 4, -7); g.lineTo(fx + 8, -16); g.closePath();
      inkFill(g, '#ffffff', 3.2);
    }
    g.fillStyle = INK; g.beginPath(); g.ellipse(-54, -31, 6, 4.5, 0, 0, Math.PI * 2); g.fill();
    drawAnimeEye(g, -16, -35, 9.2, '#fde047', '#ca8a04', -1.8);
  });

  // Sculpted Enemies (8 Distinct Cel-Shaded Mobs)
  MODELS.mob_lawyer = makeSprite(72, 78, (g) => {
    g.translate(38, 44);
    g.beginPath(); g.roundRect(-13, -10, 28, 36, 7); inkFill(g, '#1e293b', 4.8);
    g.fillStyle = '#e11d48';
    g.beginPath(); g.moveTo(1, -8); g.lineTo(-3, 8); g.lineTo(1, 14); g.lineTo(5, 8); g.closePath(); g.fill();
    g.beginPath(); g.arc(1, -22, 12.5, 0, Math.PI * 2); inkFill(g, '#fed7aa', 4.6);
    g.fillStyle = '#090d16'; g.fillRect(-9, -25, 16, 5.2);

    const rg = g.createLinearGradient(-28, 0, -12, 0);
    rg.addColorStop(0, '#e0f2fe');
    rg.addColorStop(0.5, '#0284c7');
    rg.addColorStop(1, '#1e3a8a');
    g.beginPath(); g.roundRect(-28, -26, 15, 52, 5); inkFill(g, rg, 4.8);
    g.fillStyle = '#fde047'; g.fillRect(-25, -15, 9, 8);
  });

  MODELS.mob_frog = makeSprite(66, 64, (g) => {
    g.translate(33, 36);
    const fg = g.createRadialGradient(0, 0, 2, 0, 4, 23);
    fg.addColorStop(0, '#fef08a');
    fg.addColorStop(1, '#ca8a04');
    g.beginPath(); g.ellipse(0, 6, 20.5, 16.5, 0, 0, Math.PI * 2); inkFill(g, fg, 4.8);
    g.beginPath(); g.arc(-2, 7, 10, 0, Math.PI); inkFill(g, '#be123c', 3.6);

    g.beginPath(); g.arc(0, -6, 16.5, Math.PI, 0); g.closePath(); inkFill(g, '#f97316', 4.6);
    g.beginPath(); g.roundRect(-20, -8, 40, 4.5, 2); inkFill(g, '#fb923c', 3.8);
    drawAnimeEye(g, -7, -2, 5.2, '#4ade80', '#15803d', -1.0);
    drawAnimeEye(g, 5, -2, 5.2, '#4ade80', '#15803d', -1.0);
  });

  MODELS.mob_spiky = makeSprite(70, 66, (g) => {
    g.translate(35, 38);
    for (let i = -2; i <= 2; i++) {
      const sx = i * 7.5;
      g.beginPath(); g.moveTo(sx - 5.5, -6); g.lineTo(sx, -29); g.lineTo(sx + 5.5, -6); g.closePath();
      inkFill(g, '#fde047', 4.2);
    }
    const cg = g.createRadialGradient(0, 2, 2, 0, 4, 23);
    cg.addColorStop(0, '#fdba74');
    cg.addColorStop(1, '#c2410c');
    g.beginPath(); g.ellipse(0, 6, 20.5, 15.5, 0, 0, Math.PI * 2); inkFill(g, cg, 4.8);
    drawAnimeEye(g, -7, 3, 4.2, '#38bdf8', '#0284c7', -0.9);
    drawAnimeEye(g, 5, 3, 4.2, '#38bdf8', '#0284c7', -0.9);
  });

  MODELS.mob_dribbler = makeSprite(76, 72, (g) => {
    g.translate(40, 40);
    const yg = g.createRadialGradient(0, -2, 2, 2, 4, 23);
    yg.addColorStop(0, '#fef9c3');
    yg.addColorStop(0.65, '#facc15');
    yg.addColorStop(1, '#ca8a04');
    g.beginPath(); g.ellipse(2, 4, 18.5, 19.5, 0, 0, Math.PI * 2); inkFill(g, yg, 4.8);
    g.beginPath(); g.arc(2, 9, 16.5, 0.1, Math.PI - 0.1); g.closePath(); inkFill(g, '#1e293b', 4.4);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(-5, -2); g.lineTo(-4, 18); g.moveTo(8, -2); g.lineTo(7, 18); g.stroke();

    g.beginPath(); g.moveTo(-14, -2); g.lineTo(-24, 1); g.lineTo(-14, 5); g.closePath(); inkFill(g, '#f97316', 4.0);
    g.fillStyle = INK; g.beginPath(); g.arc(-6, -5, 2.8, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.ellipse(-4, -15, 10, 4.6, -0.35, 0, Math.PI * 2);
    g.ellipse(9, -15, 10, 4.6, 0.35, 0, Math.PI * 2);
    inkFill(g, '#e2e8f0', 4.0);
    drawSpaldingWheelOn(g, -22, 14, 9, 0.4);
  });

  MODELS.mob_drone = makeSprite(82, 60, (g) => {
    g.translate(41, 30);
    g.fillStyle = 'rgba(56, 189, 248, 0.48)';
    g.strokeStyle = '#0284c7'; g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(-23, -14, 15.5, 4.2, 0, 0, Math.PI * 2); g.ellipse(23, -14, 15.5, 4.2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 4.6;
    g.beginPath(); g.moveTo(-22, -12); g.lineTo(22, -12); g.moveTo(-10, 6); g.lineTo(-15, 18); g.moveTo(10, 6); g.lineTo(15, 18); g.stroke();
    g.beginPath(); g.roundRect(-16, -9, 32, 18, 8); inkFill(g, '#334155', 4.8);
    g.beginPath(); g.arc(-4, 0, 6.8, 0, Math.PI * 2); inkFill(g, '#ef4444', 3.8);
    g.fillStyle = '#fef08a'; g.beginPath(); g.arc(-6, -2, 2.4, 0, Math.PI * 2); g.fill();
  });

  MODELS.mob_pelican_guard = makeSprite(82, 80, (g) => {
    g.translate(44, 44);
    g.beginPath(); g.ellipse(4, 10, 19.5, 16.5, 0, 0, Math.PI * 2); inkFill(g, '#f8fafc', 4.8);
    g.beginPath(); g.arc(-2, -12, 12.5, 0, Math.PI * 2); inkFill(g, '#ffffff', 4.8);
    g.beginPath(); g.moveTo(-10, -12); g.lineTo(-37, -14); g.quadraticCurveTo(-24, 6, -8, -4); g.closePath();
    inkFill(g, '#fb923c', 4.6);
    g.beginPath(); g.arc(-1, -18, 15.5, Math.PI, 0); g.closePath(); inkFill(g, '#334155', 4.8);
    g.strokeStyle = INK; g.lineWidth = 4.2; g.beginPath(); g.moveTo(13, -20); g.lineTo(25, -25); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(-6, -13, 2.7, 0, Math.PI * 2); g.fill();
  });

  MODELS.mob_boar_frog = makeSprite(86, 76, (g) => {
    g.translate(44, 42);
    g.beginPath(); g.arc(4, -14, 11.5, 0, Math.PI * 2); inkFill(g, '#84cc16', 4.4);
    g.fillStyle = '#ef4444'; g.fillRect(-7, -20, 22, 4.5);
    const bg = g.createRadialGradient(-2, 6, 3, 0, 8, 27);
    bg.addColorStop(0, '#d97706');
    bg.addColorStop(1, '#451a03');
    g.beginPath(); g.ellipse(0, 9, 25.5, 16.5, 0, 0, Math.PI * 2); inkFill(g, bg, 5.0);
    g.beginPath(); g.ellipse(-25, 10, 6.2, 8.2, 0, 0, Math.PI * 2); inkFill(g, '#fda4af', 4.0);
    g.beginPath(); g.moveTo(-21, 14); g.quadraticCurveTo(-34, 6, -29, -3); g.quadraticCurveTo(-24, 6, -17, 12); g.closePath();
    inkFill(g, '#ffffff', 3.8);
    g.beginPath(); g.arc(-14, 4, 3.5, 0, Math.PI * 2); inkFill(g, '#fde047', 3.2);
  });

  MODELS.mob_snowman = makeSprite(72, 80, (g) => {
    g.translate(36, 44);
    const sg = g.createRadialGradient(-3, 0, 3, 0, 6, 27);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(0.7, '#e0f2fe');
    sg.addColorStop(1, '#7dd3fc');
    g.beginPath(); g.arc(0, 12, 19.5, 0, Math.PI * 2); inkFill(g, sg, 4.8);
    g.beginPath(); g.arc(0, -11, 14.5, 0, Math.PI * 2); inkFill(g, sg, 4.8);
    g.beginPath(); g.roundRect(-14, -2, 28, 6.5, 3); inkFill(g, '#e11d48', 4.2);
    g.beginPath(); g.moveTo(-8, -10); g.lineTo(-25, -8); g.lineTo(-8, -5); g.closePath(); inkFill(g, '#f97316', 3.8);
    g.beginPath(); g.moveTo(-11, -21); g.lineTo(-8, -36); g.lineTo(9, -35); g.lineTo(12, -20); g.closePath();
    inkFill(g, '#dc2626', 4.4);
    g.fillStyle = INK; g.beginPath(); g.arc(-5, -13, 2.5, 0, Math.PI * 2); g.fill();
  });

  MODELS.snowballGiant = makeSprite(72, 72, (g) => {
    g.translate(36, 36);
    const sg = g.createRadialGradient(-8, -8, 4, 0, 0, 31);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(0.65, '#bae6fd');
    sg.addColorStop(1, '#38bdf8');
    g.beginPath(); g.arc(0, 0, 29.5, 0, Math.PI * 2); inkFill(g, sg, 5.0);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3.2;
    g.beginPath(); g.arc(-4, -4, 16, 2.2, 4.8); g.stroke();
  });

  // ---------- C. JUICY 3D EMERALD & GOLDEN BEANS + 12 IN-WORLD PROPS ----------

  // 1. Plump Glossy 3D Emerald Mung-Bean (`晶莹翡翠绿豆` — replaces Mason jar!)
  MODELS.beanJar = makeSprite(42, 42, (g) => {
    g.translate(21, 22);
    // Soft emerald aura glow
    g.fillStyle = 'rgba(74, 222, 128, 0.28)';
    g.beginPath(); g.arc(0, 0, 18, 0, Math.PI * 2); g.fill();

    // Cute Twin Sprout Leaves on Top
    g.save();
    g.translate(1, -12);
    g.beginPath();
    g.ellipse(-4, -3, 5, 2.5, -0.45, 0, Math.PI * 2);
    g.ellipse(4, -3, 5, 2.5, 0.45, 0, Math.PI * 2);
    inkFill(g, '#86efac', 3.2);
    g.restore();

    // Plump Tilted 3D Jade Mung-Bean Body
    g.save();
    g.rotate(-0.28);
    const jg = g.createRadialGradient(-4, -5, 2, 0, 1, 15);
    jg.addColorStop(0, '#dcfce7');
    jg.addColorStop(0.35, '#4ade80');
    jg.addColorStop(0.82, '#16a34a');
    jg.addColorStop(1, '#14532d');
    g.beginPath();
    g.ellipse(0, 1, 11.5, 14, 0, 0, Math.PI * 2);
    inkFill(g, jg, 4.4);

    // Classic Mung-Bean White Hilum Stripe (`绿豆白芽线`) + Jelly Shine
    g.strokeStyle = '#fefce8';
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(4.5, 1, 6.8, -0.65, 0.65);
    g.stroke();

    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    g.beginPath();
    g.ellipse(-4.2, -5.5, 3.2, 5.2, 0.2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });

  // 1B. Radiant 24K Starlight Giant Golden Bean (`10倍璀璨金豆`)
  MODELS.goldJar = makeSprite(56, 56, (g) => {
    g.translate(28, 29);
    g.fillStyle = 'rgba(250, 204, 21, 0.36)';
    g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill();

    // Mini Golden Crown on Giant Bean!
    g.beginPath();
    g.moveTo(-8, -14); g.lineTo(-10, -22); g.lineTo(-3, -17); g.lineTo(0, -24);
    g.lineTo(3, -17); g.lineTo(10, -22); g.lineTo(8, -14); g.closePath();
    inkFill(g, '#fde047', 3.8);

    g.save();
    g.rotate(-0.22);
    const jg = g.createRadialGradient(-5, -6, 2, 0, 2, 20);
    jg.addColorStop(0, '#ffffff');
    jg.addColorStop(0.32, '#fef08a');
    jg.addColorStop(0.75, '#facc15');
    jg.addColorStop(1, '#b45309');
    g.beginPath();
    g.ellipse(0, 2, 15, 18, 0, 0, Math.PI * 2);
    inkFill(g, jg, 4.8);

    g.fillStyle = 'rgba(255, 255, 255, 0.90)';
    g.beginPath();
    g.ellipse(-5.5, -5.5, 4.2, 6.8, 0.2, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.fillStyle = '#b45309';
    g.font = '900 12px sans-serif';
    g.textAlign = 'center';
    g.fillText('★', 1, 6);
  });

  // 2. Props & Weapons
  MODELS.prop_giant = makeSprite(58, 60, (g) => {
    g.translate(29, 30);
    g.fillStyle = 'rgba(253, 224, 71, 0.38)'; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
    g.rotate(-0.18);
    const lg = g.createLinearGradient(-14, -18, 14, 18);
    lg.addColorStop(0, '#f87171'); lg.addColorStop(0.4, '#ef4444'); lg.addColorStop(1, '#991b1b');
    g.beginPath(); g.roundRect(-14, -18, 28, 36, 5); inkFill(g, lg, 4.6);
    g.beginPath(); g.roundRect(-14, -20, 28, 6.5, 2); inkFill(g, '#fde047', 3.6);
    g.fillStyle = '#fff'; g.font = '900 10.5px sans-serif'; g.textAlign = 'center';
    g.fillText('辣条', 0, 4);
  });

  MODELS.prop_rocket = makeSprite(64, 56, (g) => {
    g.translate(32, 28);
    g.fillStyle = 'rgba(56, 189, 248, 0.34)'; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
    g.rotate(-0.45);
    g.beginPath(); g.moveTo(-14, -8); g.lineTo(-23, -17); g.lineTo(-18, 0); g.lineTo(-23, 17); g.lineTo(-14, 8); g.closePath();
    inkFill(g, '#ef4444', 4.4);
    g.beginPath(); g.ellipse(2, 0, 20.5, 10.5, 0, 0, Math.PI * 2); inkFill(g, '#f8fafc', 4.6);
    g.fillStyle = '#ef4444'; g.beginPath(); g.arc(16, 0, 8.2, -1.1, 1.1); g.fill();
    g.beginPath(); g.arc(3, 0, 4.8, 0, Math.PI * 2); inkFill(g, '#38bdf8', 3.6);
  });

  MODELS.prop_magnet = makeSprite(58, 58, (g) => {
    g.translate(29, 29);
    g.fillStyle = 'rgba(244, 63, 94, 0.30)'; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
    g.lineWidth = 10.5; g.strokeStyle = INK;
    g.beginPath(); g.arc(0, 2, 13, Math.PI, 0); g.lineTo(13, 15); g.moveTo(-13, 2); g.lineTo(-13, 15); g.stroke();
    g.lineWidth = 6.5; g.strokeStyle = '#ef4444';
    g.beginPath(); g.arc(0, 2, 13, Math.PI, 0); g.lineTo(13, 10); g.moveTo(-13, 2); g.lineTo(-13, 10); g.stroke();
    g.beginPath(); g.roundRect(-17, 9, 8, 7, 1.5); g.roundRect(9, 9, 8, 7, 1.5); inkFill(g, '#f1f5f9', 3.6);
  });

  MODELS.prop_midas = makeSprite(60, 58, (g) => {
    g.translate(30, 29);
    g.fillStyle = 'rgba(250, 204, 21, 0.38)'; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
    const mg = g.createLinearGradient(-16, -12, 18, 14);
    mg.addColorStop(0, '#fef9c3'); mg.addColorStop(0.5, '#facc15'); mg.addColorStop(1, '#ca8a04');
    g.beginPath();
    g.moveTo(-16, 8); g.quadraticCurveTo(-4, 16, 4, 2);
    g.lineTo(18, -12); g.lineTo(20, 6); g.quadraticCurveTo(4, 22, -16, 14);
    g.closePath();
    inkFill(g, mg, 4.6);
  });

  MODELS.prop_boba = makeSprite(54, 60, (g) => {
    g.translate(27, 31);
    g.fillStyle = 'rgba(74, 222, 128, 0.28)'; g.beginPath(); g.arc(0, -2, 24, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 6.5;
    g.beginPath(); g.moveTo(2, -12); g.lineTo(7, -23); g.stroke();
    g.strokeStyle = '#22c55e'; g.lineWidth = 3.8; g.stroke();
    g.beginPath(); g.moveTo(-12, -10); g.lineTo(12, -10); g.lineTo(9, 16); g.lineTo(-9, 16); g.closePath();
    inkFill(g, '#bbf7d0', 4.6);
    g.beginPath(); g.arc(0, -10, 12, Math.PI, 0); inkFill(g, '#ffffff', 4.2);
    g.fillStyle = '#e11d48'; g.font = '900 12.5px sans-serif'; g.textAlign = 'center';
    g.fillText('♥', 0, 8);
  });

  MODELS.airdropCrate = makeSprite(66, 84, (g) => {
    g.translate(33, 51);
    g.strokeStyle = '#e2e8f0'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(-22, -24); g.lineTo(-12, -6); g.moveTo(22, -24); g.lineTo(12, -6); g.stroke();
    g.beginPath(); g.arc(0, -24, 24, Math.PI, 0); g.closePath(); inkFill(g, '#ef4444', 4.4);
    g.beginPath(); g.ellipse(0, -35, 9, 12, 0, Math.PI, 0); g.closePath(); inkFill(g, '#ffffff', 3.6);
    g.beginPath(); g.roundRect(-16, -7, 32, 30, 5); inkFill(g, '#f59e0b', 4.6);
    g.fillStyle = '#fde047'; g.fillRect(-15, -6, 30, 5);
    g.beginPath(); g.arc(0, 9, 8.8, 0, Math.PI * 2); inkFill(g, '#0ea5e9', 3.8);
    g.fillStyle = '#fff'; g.font = '900 12px sans-serif'; g.textAlign = 'center'; g.fillText('?', 0, 13);
  });

  MODELS.gatlingGun = makeSprite(60, 32, (g) => {
    g.translate(25, 16);
    g.beginPath(); g.roundRect(-20, -9, 18, 18, 4); inkFill(g, '#d97706', 4.2);
    for (const by of [-6, 0, 6]) {
      g.beginPath(); g.roundRect(-2, by - 2, 30, 4, 1); inkFill(g, '#cbd5e1', 3.2);
    }
    g.beginPath(); g.roundRect(10, -8, 5.5, 16, 1.5); inkFill(g, '#fde047', 3.4);
  });

  MODELS.bazookaGun = makeSprite(66, 30, (g) => {
    g.translate(33, 15);
    g.beginPath(); g.roundRect(-24, -7, 46, 14, 3.5); inkFill(g, '#15803d', 4.6);
    g.beginPath(); g.roundRect(6, -12, 6, 5, 1.5); inkFill(g, '#fde047', 3.4);
  });

  MODELS.prop_saw = makeSprite(66, 66, (g) => {
    g.translate(33, 33);
    g.fillStyle = 'rgba(168, 85, 247, 0.36)'; g.beginPath(); g.arc(0, 0, 29, 0, Math.PI * 2); g.fill();
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a1 = (i * Math.PI * 2) / 10, a2 = a1 + 0.31, a3 = a1 + 0.62;
      if (i === 0) g.moveTo(Math.cos(a1) * 18, Math.sin(a1) * 18);
      g.lineTo(Math.cos(a2) * 27, Math.sin(a2) * 27);
      g.lineTo(Math.cos(a3) * 18, Math.sin(a3) * 18);
    }
    g.closePath();
    inkFill(g, '#f8fafc', 4.2);
    g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); inkFill(g, '#7c3aed', 4.2);
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); inkFill(g, '#fde047', 3.4);
  });

  MODELS.prop_mortar_cat = makeSprite(66, 66, (g) => {
    g.translate(33, 35);
    g.fillStyle = 'rgba(251, 146, 60, 0.36)'; g.beginPath(); g.arc(0, -2, 28, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.moveTo(-15, -8); g.lineTo(-19, -24); g.lineTo(-6, -15);
    g.lineTo(6, -15); g.lineTo(19, -24); g.lineTo(15, -8);
    g.arc(0, 0, 17, -0.3, Math.PI + 0.3); g.closePath();
    inkFill(g, '#fb923c', 4.6);
    g.beginPath(); g.arc(0, -8, 16, Math.PI, 0); g.closePath(); inkFill(g, '#15803d', 4.4);
    g.save(); g.translate(14, 4); g.rotate(-0.55);
    g.beginPath(); g.roundRect(-6, -6, 20, 11, 3); inkFill(g, '#334155', 4.2);
    g.restore();
    g.fillStyle = INK; g.beginPath(); g.arc(-6, -1, 2.6, 0, Math.PI * 2); g.arc(5, -1, 2.6, 0, Math.PI * 2); g.fill();
  });

  MODELS.prop_gatling = makeSprite(68, 64, (g) => {
    g.translate(34, 32);
    g.fillStyle = 'rgba(14, 165, 233, 0.36)'; g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.roundRect(-22, -10, 18, 20, 4); inkFill(g, '#d97706', 4.4);
    for (const by of [-6, 0, 6]) {
      g.beginPath(); g.roundRect(-4, by - 2, 27, 4, 1); inkFill(g, '#e2e8f0', 3.2);
    }
    g.beginPath(); g.roundRect(9, -9, 5, 18, 1.5); inkFill(g, '#fde047', 3.4);
  });

  MODELS.prop_bazooka = makeSprite(68, 64, (g) => {
    g.translate(34, 32);
    g.fillStyle = 'rgba(34, 197, 94, 0.36)'; g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
    g.save(); g.rotate(-0.22);
    g.beginPath(); g.roundRect(-23, -8, 44, 16, 4); inkFill(g, '#15803d', 4.6);
    g.beginPath(); g.moveTo(19, -7); g.lineTo(28, 0); g.lineTo(19, 7); g.closePath(); inkFill(g, '#ef4444', 4.0);
    g.restore();
  });

  MODELS.cashTruck = makeSprite(128, 80, (g) => {
    g.translate(64, 42);
    const tg = g.createLinearGradient(-50, -26, 52, 18);
    tg.addColorStop(0, '#2563eb'); tg.addColorStop(0.6, '#1e3a8a'); tg.addColorStop(1, '#0f172a');
    g.beginPath();
    g.moveTo(-50, 16); g.lineTo(-50, -24); g.lineTo(22, -24); g.lineTo(42, -7); g.lineTo(52, -3); g.lineTo(52, 16);
    g.closePath();
    inkFill(g, tg, 5.2);
    g.beginPath(); g.moveTo(20, -20); g.lineTo(38, -6); g.lineTo(20, -6); g.closePath(); inkFill(g, '#7dd3fc', 3.8);
    g.fillStyle = '#facc15'; g.fillRect(-48, -5, 65, 11);
    g.beginPath(); g.roundRect(6, -32, 10, 8, 3); inkFill(g, '#ef4444', 3.6);
    g.beginPath(); g.roundRect(16, -32, 10, 8, 3); inkFill(g, '#3b82f6', 3.6);
    for (const wx of [-28, 28]) {
      g.beginPath(); g.arc(wx, 18, 13.5, 0, Math.PI * 2); inkFill(g, '#1e293b', 4.6);
      g.beginPath(); g.arc(wx, 18, 6, 0, Math.PI * 2); inkFill(g, '#e2e8f0', 3.2);
    }
  });

  MODELS.fishTorpedo = makeSprite(60, 36, (g) => {
    g.translate(30, 18);
    g.beginPath(); g.moveTo(-16, 0); g.lineTo(-26, -11); g.lineTo(-21, 0); g.lineTo(-26, 11); g.closePath();
    inkFill(g, '#0284c7', 4.0);
    const fg = g.createLinearGradient(0, -10, 0, 10);
    fg.addColorStop(0, '#0369a1'); fg.addColorStop(0.5, '#7dd3fc'); fg.addColorStop(1, '#f8fafc');
    g.beginPath(); g.moveTo(-17, 0); g.quadraticCurveTo(0, -13, 21, -2); g.lineTo(24, 1); g.quadraticCurveTo(0, 13, -17, 0);
    inkFill(g, fg, 4.4);
    g.fillStyle = '#ef4444'; g.fillRect(7, -8, 5, 15);
    g.beginPath(); g.arc(14, -3, 4, 0, Math.PI * 2); inkFill(g, '#ffffff', 3.0);
  });

  MODELS.riotSaw = makeSprite(66, 66, (g) => {
    g.translate(33, 33);
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const a1 = (i * Math.PI * 2) / 12, a2 = a1 + 0.28, a3 = a1 + 0.52;
      if (i === 0) g.moveTo(Math.cos(a1) * 21, Math.sin(a1) * 21);
      g.lineTo(Math.cos(a2) * 30, Math.sin(a2) * 30);
      g.lineTo(Math.cos(a3) * 21, Math.sin(a3) * 21);
    }
    g.closePath();
    inkFill(g, '#e2e8f0', 4.2);
    g.beginPath(); g.arc(0, 0, 21, 0, Math.PI * 2); inkFill(g, '#1d4ed8', 4.4);
    g.beginPath(); g.roundRect(-12, -5, 24, 10, 4); inkFill(g, '#38bdf8', 3.6);
    g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); inkFill(g, '#facc15', 3.4);
  });

  MODELS.sharkBomb = makeSprite(66, 50, (g) => {
    g.translate(33, 25);
    g.beginPath(); g.moveTo(-14, -8); g.lineTo(-28, -18); g.lineTo(-24, 0); g.lineTo(-28, 18); g.lineTo(-14, 8); g.closePath();
    inkFill(g, '#facc15', 4.4);
    g.beginPath(); g.ellipse(3, 0, 22, 15, 0, 0, Math.PI * 2); inkFill(g, '#dc2626', 4.6);
    g.beginPath(); g.moveTo(4, 3); g.lineTo(19, 1); g.quadraticCurveTo(14, 11, 4, 8); g.closePath(); inkFill(g, '#ffffff', 3.4);
    g.beginPath(); g.arc(12, -5, 4, 0, Math.PI * 2); inkFill(g, '#ffffff', 3.2);
  });

  MODELS.tntBarrel = makeSprite(50, 62, (g) => {
    g.translate(25, 34);
    g.beginPath(); g.roundRect(-15, -17, 30, 38, 5); inkFill(g, '#dc2626', 4.8);
    g.beginPath(); g.ellipse(0, -17, 15, 5, 0, 0, Math.PI * 2); inkFill(g, '#cbd5e1', 4.0);
    g.beginPath(); g.roundRect(-15, -4, 30, 12, 1); inkFill(g, '#fde047', 3.8);
    g.fillStyle = INK; g.font = '900 9.5px sans-serif'; g.textAlign = 'center'; g.fillText('TNT', 0, 5);
    g.strokeStyle = '#78350f'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(2, -18); g.quadraticCurveTo(7, -27, 2, -29); g.stroke();
    g.fillStyle = '#fde047'; g.beginPath(); g.arc(2, -29, 4.5, 0, Math.PI * 2); g.fill();
  });

  MODELS.lawyerScroll = makeSprite(68, 54, (g) => {
    g.translate(34, 27);
    for (const dir of [-1, 1]) {
      g.save(); g.scale(dir, 1);
      g.beginPath(); g.moveTo(12, -4); g.quadraticCurveTo(29, -18, 30, -5); g.quadraticCurveTo(25, 6, 13, 6); g.closePath();
      inkFill(g, '#f8fafc', 4.0);
      g.restore();
    }
    g.beginPath(); g.roundRect(-15, -19, 30, 38, 4); inkFill(g, '#fffbeb', 4.4);
    g.fillStyle = '#e11d48'; g.fillRect(-11, -14, 22, 6);
    g.beginPath(); g.arc(0, 11, 6, 0, Math.PI * 2); inkFill(g, '#be123c', 3.6);
  });

  MODELS.kunai = makeSprite(68, 34, (g) => {
    g.translate(34, 17);
    g.beginPath(); g.moveTo(-18, 0); g.lineTo(-31, -7); g.lineTo(-28, 5); g.closePath(); inkFill(g, '#4ade80', 3.6);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(7, -9); g.lineTo(29, 0); g.closePath(); inkFill(g, '#f8fafc', 3.8);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(7, 9); g.lineTo(29, 0); g.closePath(); inkFill(g, '#64748b', 3.8);
  });

  MODELS.lotusPad = makeSprite(78, 38, (g) => {
    g.translate(39, 21);
    g.beginPath(); g.ellipse(0, 2, 31.5, 11, 0, 0.25, Math.PI * 2 - 0.25); g.lineTo(0, 2); g.closePath();
    inkFill(g, '#22c55e', 4.6);
    for (const px of [-8, 8, 0]) {
      g.beginPath(); g.ellipse(px, -5, 6.8, 8.8, 0, 0, Math.PI * 2); inkFill(g, '#f472b6', 3.8);
    }
  });

  MODELS.bronzeBell = makeSprite(68, 76, (g) => {
    g.translate(34, 39);
    g.beginPath(); g.roundRect(-24, -30, 48, 8.5, 3); inkFill(g, '#991b1b', 4.6);
    const bg = g.createLinearGradient(-22, -20, 22, 18);
    bg.addColorStop(0, '#fef08a'); bg.addColorStop(0.5, '#eab308'); bg.addColorStop(1, '#854d0e');
    g.beginPath();
    g.moveTo(-14, -20); g.quadraticCurveTo(-18, 2, -24, 19); g.lineTo(24, 19); g.quadraticCurveTo(18, 2, 14, -20);
    g.closePath();
    inkFill(g, bg, 4.8);
    g.strokeStyle = '#fef9c3'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-18, 12); g.lineTo(18, 12); g.stroke();
  });

  MODELS.rockChunk = makeSprite(28, 24, (g) => {
    g.translate(14, 12);
    g.beginPath(); g.moveTo(-9, 4); g.lineTo(-5, -7); g.lineTo(5, -8); g.lineTo(10, 1); g.lineTo(3, 8); g.closePath();
    inkFill(g, '#64748b', 4.0);
  });

  MODELS.woodSplinter = makeSprite(34, 18, (g) => {
    g.translate(17, 9);
    g.beginPath(); g.moveTo(-13, -4); g.lineTo(11, -4); g.lineTo(14, 0); g.lineTo(9, 4); g.lineTo(-14, 4); g.closePath();
    inkFill(g, '#d97706', 3.8);
  });

  // Boss 7: 🎵 曼波 (Real viral meme textures framed with glowing starlight halo!)
  MODELS.boss_manbo = makeSprite(150, 150, (g) => {
    g.translate(75, 75);
    g.beginPath(); g.arc(0, 0, 56, 0, Math.PI * 2); inkFill(g, '#a78bfa', 5.4);
  });
  MODELS.boss_manbo_meme = makeSprite(150, 150, (g) => {
    g.translate(75, 75);
    g.beginPath(); g.arc(0, 0, 56, 0, Math.PI * 2); inkFill(g, '#fda4af', 5.4);
  });
  const loadMemeSprite = (url, targetKey, haloCol) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      MODELS[targetKey] = makeSprite(152, 152, (g) => {
        g.fillStyle = haloCol;
        g.beginPath(); g.arc(76, 76, 68, 0, Math.PI * 2); g.fill();
        g.drawImage(img, 8, 8, 136, 136);
      });
    };
    img.src = url;
  };
  loadMemeSprite('/assets/boss_manbo.png?v=4.2', 'boss_manbo', 'rgba(192, 132, 252, 0.22)');
  loadMemeSprite('/assets/boss_manbo_meme.png?v=4.2', 'boss_manbo_meme', 'rgba(244, 63, 94, 0.28)');

  MODELS.prop_shield = makeSprite(60, 60, (g) => {
    g.translate(30, 30);
    const sg = g.createLinearGradient(0, -22, 0, 22);
    sg.addColorStop(0, '#7dd3fc'); sg.addColorStop(0.5, '#0284c7'); sg.addColorStop(1, '#1d4ed8');
    g.beginPath();
    g.moveTo(0, -22); g.lineTo(19, -14); g.quadraticCurveTo(19, 10, 0, 23); g.quadraticCurveTo(-19, 10, -19, -14);
    g.closePath();
    inkFill(g, sg, 5.2);
    g.strokeStyle = '#fef08a'; g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(0, -14); g.lineTo(11, -9); g.quadraticCurveTo(11, 5, 0, 14); g.quadraticCurveTo(-11, 5, -11, -9);
    g.closePath(); g.stroke();
  });

  // Mini Round-Head Maodie ("小圆头耄耋")
  MODELS.mini_maodie = makeSprite(60, 60, (g) => {
    g.translate(30, 31);
    g.beginPath(); g.ellipse(0, 12, 15.5, 11.5, 0, 0, Math.PI * 2); inkFill(g, '#fb923c', 4.8);
    g.beginPath();
    g.ellipse(-16, -6, 5.2, 2.6, -0.35, 0, Math.PI * 2);
    g.ellipse(16, -6, 5.2, 2.6, 0.35, 0, Math.PI * 2);
    inkFill(g, '#ea580c', 4.0);

    const hg = g.createRadialGradient(-4, -10, 3, 0, -5, 20);
    hg.addColorStop(0, '#fed7aa'); hg.addColorStop(0.65, '#f97316'); hg.addColorStop(1, '#c2410c');
    g.beginPath(); g.arc(0, -5, 18.8, 0, Math.PI * 2); inkFill(g, hg, 5.0);

    g.fillStyle = '#fffbeb';
    g.beginPath(); g.ellipse(0, 2, 14, 9.5, 0, 0, Math.PI); g.fill();
    g.strokeStyle = '#9a3412'; g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(0, -21); g.lineTo(0, -13);
    g.moveTo(-6, -19); g.lineTo(-4, -13);
    g.moveTo(6, -19); g.lineTo(4, -13);
    g.stroke();

    g.beginPath();
    g.ellipse(-7, -6, 4.6, 3.3, 0.28, 0, Math.PI * 2);
    g.ellipse(7, -6, 4.6, 3.3, -0.28, 0, Math.PI * 2);
    inkFill(g, '#fef08a', 3.4);
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(-6.8, -6, 1.4, 2.7, 0, 0, Math.PI * 2);
    g.ellipse(6.8, -6, 1.4, 2.7, 0, 0, Math.PI * 2);
    g.fill();

    g.beginPath(); g.ellipse(0, 3.5, 7, 5.4, 0, 0, Math.PI * 2); inkFill(g, '#e11d48', 3.6);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(-4.2, -0.5); g.lineTo(-2.6, 2.8); g.lineTo(-1.2, -0.5);
    g.moveTo(4.2, -0.5); g.lineTo(2.6, 2.8); g.lineTo(1.2, -0.5);
    g.fill();
  });

  MODELS.prop_maodie = makeSprite(64, 64, (g) => {
    g.translate(32, 34);
    g.beginPath(); g.roundRect(-18, 0, 36, 20, 6); inkFill(g, '#facc15', 4.8);
    drawModelOn(g, 'mini_maodie', 0, -6, 0, 0.78);
  });

  MODELS.prop_lightning = makeSprite(62, 62, (g) => {
    g.translate(31, 31);
    g.beginPath(); g.arc(0, 0, 21.5, 0, Math.PI * 2); inkFill(g, '#38bdf8', 5.0);
    g.beginPath();
    g.moveTo(4, -18); g.lineTo(-10, 2); g.lineTo(-1, 2); g.lineTo(-5, 18); g.lineTo(11, -3); g.lineTo(2, -3);
    g.closePath();
    inkFill(g, '#fde047', 4.2);
  });

  MODELS.prop_wings = makeSprite(66, 60, (g) => {
    g.translate(33, 32);
    for (const dir of [-1, 1]) {
      g.save(); g.scale(dir, 1);
      g.beginPath();
      g.moveTo(2, 4); g.quadraticCurveTo(18, -20, 26, -12); g.quadraticCurveTo(22, 2, 14, 10);
      g.closePath();
      inkFill(g, '#bae6fd', 4.6);
      g.restore();
    }
    g.beginPath(); g.arc(0, 4, 7.2, 0, Math.PI * 2); inkFill(g, '#fde047', 4.0);
  });
}
buildAllSculptedAssets();

// Custom HD Illustrated Hero Portrait Generator for Garage Hub & PvP Lobby Cards!
export function getHeroPortraitDataUrl(heroId) {
  if (HERO_PORTRAIT_URLS[heroId]) return HERO_PORTRAIT_URLS[heroId];
  const themes = {
    nailong: ['#fef08a', '#f97316', 'nailong_head', 0, 4, 1.05],
    naiwa: ['#d9f99d', '#16a34a', 'naiwa_rig', -2, 22, 0.96],
    ikun: ['#e0f2fe', '#3b82f6', 'ikun_head', 0, 3, 1.08],
    pelican: ['#ffedd5', '#ea580c', 'pelican_rig', -14, 24, 0.88],
    hakimi: ['#fce7f3', '#e11d48', 'hakimi_rig', -2, 24, 0.96]
  };
  const [cTop, cBot, modelKey, ox, oy, sc] = themes[heroId] || themes.nailong;
  const sz = 96;
  const c = document.createElement('canvas');
  c.width = sz;
  c.height = sz;
  const g = c.getContext('2d');
  const cx = sz / 2;
  const cy = sz / 2;

  // Circular Arcade Medallion Frame + Sunburst Gradient
  const bg = g.createRadialGradient(cx - 8, cy - 10, 6, cx, cy, 44);
  bg.addColorStop(0, cTop);
  bg.addColorStop(1, cBot);
  g.save();
  g.beginPath();
  g.arc(cx, cy, 43, 0, Math.PI * 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = INK;
  g.stroke();
  g.clip();

  // Subtle glossy top crescent
  g.fillStyle = 'rgba(255, 255, 255, 0.28)';
  g.beginPath();
  g.ellipse(cx, cy - 26, 34, 16, 0, 0, Math.PI * 2);
  g.fill();

  drawModelOn(g, modelKey, cx + ox, cy + oy, 0, sc);
  g.restore();

  // Outer crisp inner white rim
  g.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, 39.5, 0, Math.PI * 2);
  g.stroke();

  const url = c.toDataURL('image/png');
  HERO_PORTRAIT_URLS[heroId] = url;
  return url;
}

export function getEnemySpriteKey(kind) {
  if (kind === 'shield_lawyer') return 'mob_lawyer';
  if (kind === 'spiky_cat') return 'mob_spiky';
  if (kind === 'dribbler') return 'mob_dribbler';
  if (kind === 'drone') return 'mob_drone';
  if (kind === 'pelican_guard') return 'mob_pelican_guard';
  if (kind === 'boar_frog') return 'mob_boar_frog';
  if (kind === 'snowman') return 'mob_snowman';
  return 'mob_frog';
}

export function solveIK(hx, hy, tx, ty, L1, L2, bendDir) {
  let dx = tx - hx, dy = ty - hy;
  let dist = Math.hypot(dx, dy);
  const maxR = (L1 + L2) * 0.994;
  if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; dist = maxR; }
  const minR = Math.abs(L1 - L2) + 2;
  if (dist < minR) dist = minR;
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const base = Math.atan2(dy, dx);
  const jointA = base + bendDir * Math.acos(cosA);
  return { jx: hx + Math.cos(jointA) * L1, jy: hy + Math.sin(jointA) * L1, fx: hx + dx, fy: hy + dy };
}

export function drawSpaldingWheelOn(c, x, y, r, angle) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);

  // 1. Chunky Dark-Rubber Racing Tire Tread Outer Ring
  const tireR = r;
  const coreR = r * 0.78;
  c.fillStyle = '#1e293b';
  c.strokeStyle = INK;
  c.lineWidth = 2.6;
  c.beginPath();
  c.arc(0, 0, tireR, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  if (r > 28) {
    c.fillStyle = '#0f172a';
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI * 2) / 10;
      c.beginPath();
      c.arc(Math.cos(a) * (r + 2), Math.sin(a) * (r + 2), 4.2, 0, Math.PI * 2);
      c.fill();
    }
  }

  // 2. Glossy Spalding Basketball Core + Classic Curved Seams
  const grad = c.createRadialGradient(-coreR * 0.3, -coreR * 0.3, 2, 0, 0, coreR);
  grad.addColorStop(0, '#fed7aa');
  grad.addColorStop(0.48, '#f97316');
  grad.addColorStop(1, '#9a3412');
  c.fillStyle = grad;
  c.beginPath();
  c.arc(0, 0, coreR, 0, Math.PI * 2);
  c.fill();

  c.strokeStyle = '#1e293b';
  c.lineWidth = 1.8;
  c.beginPath();
  c.moveTo(-coreR, 0); c.lineTo(coreR, 0);
  c.moveTo(0, -coreR); c.lineTo(0, coreR);
  c.arc(-coreR * 0.68, 0, coreR * 0.68, -0.82, 0.82);
  c.stroke();

  // 3. Chrome Alloy Hubcap + Motion Rim Glint
  c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  c.lineWidth = 1.8;
  c.beginPath();
  c.arc(0, 0, coreR * 0.84, 0.3, 1.35);
  c.stroke();

  c.fillStyle = '#fde047';
  c.strokeStyle = INK;
  c.lineWidth = 2.0;
  c.beginPath();
  c.arc(0, 0, r * 0.23, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.restore();
}

function drawArticulatedLegAndShoe(c, heroId, hx, hy, leg, isFar) {
  const legStyles = {
    nailong: { leg: '#facc15', legW: 10.5, shoe: '#fb923c', sole: '#fef08a' },
    ikun: { leg: '#1e293b', legW: 8.8, shoe: '#0f172a', sole: '#ffffff' },
    pelican: { leg: '#f97316', legW: 6.5, shoe: '#fb923c', sole: '#fde047' },
    naiwa: { leg: '#84cc16', legW: 6.5, shoe: '#22c55e', sole: '#bef264' },
    hakimi: { leg: '#fb923c', legW: 8.8, shoe: '#ffffff', sole: '#fda4af' }
  };
  const st = legStyles[heroId] || legStyles.nailong;
  c.save();
  if (isFar) c.globalAlpha = 0.86;
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // Outlined Thigh -> Knee -> Calf
  c.strokeStyle = INK;
  c.lineWidth = st.legW + 4.4;
  c.beginPath();
  c.moveTo(hx, hy);
  c.lineTo(leg.jx, leg.jy);
  c.lineTo(leg.fx, leg.fy);
  c.stroke();

  c.strokeStyle = st.leg;
  c.lineWidth = st.legW;
  c.stroke();

  // Cute Sneaker / Webbed Foot / Cat Paw on Pedal!
  c.translate(leg.fx, leg.fy);
  c.fillStyle = st.shoe;
  c.strokeStyle = INK;
  c.lineWidth = 2.4;
  c.beginPath();
  c.ellipse(3.5, 0.5, 8.2, 4.8, 0.08, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  c.fillStyle = st.sole;
  c.fillRect(-3.5, 2.2, 13.5, 2.2);
  c.restore();
}

// Unified 3x Cel-Shaded Hero + Hydroformed Racing BMX Renderer!
export function drawSculptedBikeAndHero(c, heroId, px, py, pAngle, wAngle, cAngle, jig, modsObj, opts = {}) {
  c.save();
  c.translate(px, py);

  // Soft Ground Contact Shadow right on the asphalt (before pAngle rotation when near ground)
  if (!opts.hideWheels) {
    c.fillStyle = 'rgba(15, 23, 42, 0.30)';
    c.beginPath();
    c.ellipse(0, -2, 54 * (opts.scale || 1), 7.5 * (opts.scale || 1), 0, 0, Math.PI * 2);
    c.fill();
  }

  c.rotate(pAngle);

  const totalScale = opts.scale || 1;
  if (totalScale !== 1) c.scale(totalScale, totalScale);

  const isMonster = opts.mountId === 'monster_truck';
  const isPlane = opts.mountId === 'biplane';
  const isRocket = opts.rocketDash;
  const wR = isMonster ? 35 : 23.5;
  const lift = isMonster ? 18 : 0;

  if (isRocket) {
    drawModelOn(c, 'prop_rocket', -12, -45, 0.45, 2.2);
  }

  if (isPlane) {
    c.save();
    c.translate(0, -36);
    c.fillStyle = '#ef4444'; c.strokeStyle = INK; c.lineWidth = 3.0;
    c.beginPath(); c.roundRect(-55, -12, 112, 26, 10); c.fill(); c.stroke();
    c.fillStyle = '#fde047';
    c.beginPath(); c.roundRect(-24, -34, 58, 9, 4); c.roundRect(-24, 12, 58, 9, 4); c.fill(); c.stroke();
    const propH = 6 + Math.abs(Math.sin(performance.now() * 0.04)) * 24;
    c.fillStyle = '#cbd5e1'; c.beginPath(); c.ellipse(60, 0, 4, propH, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.restore();
  }

  const rearX = -38, rearY = -wR;
  const frontX = 40, frontY = -wR;
  const bbX = -4, bbY = -24 - lift;
  const seatX = -21, seatY = -55 - lift;
  const headTopX = 25, headTopY = -58 - lift;
  const headBotX = 28, headBotY = -46 - lift;
  const handleX = 18, handleY = -70 - lift;

  const lp = { x: bbX + Math.cos(cAngle + Math.PI) * 12, y: bbY + Math.sin(cAngle + Math.PI) * 12 };
  const rp = { x: bbX + Math.cos(cAngle) * 12, y: bbY + Math.sin(cAngle) * 12 };
  const hipX = -16, hipY = -58 - lift + jig * 0.2;
  const bendDir = heroId === 'pelican' ? 1 : -1;

  // 1. Far Articulated Leg & Sneaker
  const farLeg = solveIK(hipX, hipY, lp.x, lp.y, 22, 21, bendDir);
  drawArticulatedLegAndShoe(c, heroId, hipX, hipY, farLeg, true);

  // 2. Treaded Racing Basketball Wheels
  if (!opts.hideWheels && !isPlane) {
    drawSpaldingWheelOn(c, rearX, rearY, wR, wAngle);
    drawSpaldingWheelOn(c, frontX, frontY, wR, wAngle);
  }

  if (isMonster) {
    c.strokeStyle = '#fde047'; c.lineWidth = 5.5;
    c.beginPath(); c.moveTo(rearX, rearY); c.lineTo(seatX, seatY); c.moveTo(frontX, frontY); c.lineTo(headTopX, headTopY); c.stroke();
  }

  if (opts.hasSaw) {
    drawModelOn(c, 'riotSaw', frontX + 20, frontY - 4, wAngle * 2.4, 0.56);
  }

  // 3. Chrome Twin Exhaust Pipe + Hydroformed 3D Crimson-Gold Racing BMX Frame!
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // Rear Chrome Exhaust Muffler
  c.fillStyle = '#94a3b8';
  c.strokeStyle = INK;
  c.lineWidth = 2.4;
  c.beginPath();
  c.roundRect(rearX - 18, rearY - 16 - lift * 0.4, 22, 7, 3);
  c.fill();
  c.stroke();

  // Drive Chain & Golden Chainring Sprocket
  c.strokeStyle = '#334155';
  c.lineWidth = 2.6;
  c.beginPath();
  c.ellipse((rearX + bbX) * 0.5, (rearY + bbY) * 0.5, 19, 5.5, 0.05, 0, Math.PI * 2);
  c.stroke();

  // Chrome Suspension Front Fork
  c.strokeStyle = INK;
  c.lineWidth = 8.2;
  c.beginPath();
  c.moveTo(headBotX, headBotY);
  c.quadraticCurveTo(34, -33 - lift * 0.5, frontX, frontY);
  c.stroke();
  c.strokeStyle = '#e2e8f0';
  c.lineWidth = 4.4;
  c.stroke();

  // Outlined Hydroformed Diamond Frame + Specular Highlight
  c.strokeStyle = INK;
  c.lineWidth = 9.6;
  c.beginPath();
  c.moveTo(rearX, rearY); c.lineTo(bbX, bbY); c.lineTo(seatX, seatY); c.closePath();
  c.moveTo(bbX, bbY); c.lineTo(headBotX, headBotY); c.lineTo(headTopX, headTopY); c.lineTo(seatX + 1, seatY + 3);
  c.stroke();

  c.strokeStyle = '#e11d48';
  c.lineWidth = 5.4;
  c.stroke();

  c.strokeStyle = '#fda4af';
  c.lineWidth = 1.8;
  c.beginPath();
  c.moveTo(seatX + 3, seatY + 3); c.lineTo(headTopX - 2, headTopY);
  c.stroke();

  // Golden Crankset Gear
  c.fillStyle = '#facc15';
  c.strokeStyle = INK;
  c.lineWidth = 2.4;
  c.beginPath();
  c.arc(bbX, bbY, 7.2, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  // Plush Contoured Racing Saddle + Chrome BMX Stem & Grips
  c.fillStyle = '#1e293b';
  c.beginPath();
  c.ellipse(seatX - 1, seatY - 3, 11, 4.2, -0.1, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  c.strokeStyle = INK;
  c.lineWidth = 7.2;
  c.beginPath();
  c.moveTo(headTopX, headTopY); c.lineTo(22, -68 - lift); c.lineTo(handleX - 5, handleY);
  c.stroke();
  c.strokeStyle = '#f1f5f9';
  c.lineWidth = 3.6;
  c.stroke();
  c.restore();

  if (opts.mortarActive) {
    drawModelOn(c, 'prop_mortar_cat', -46, -66 - lift + Math.sin(performance.now() * 0.02) * 3, 0, 0.74);
  }

  // 4. Woven Rattan Front Basket + Mini Nailong Co-Pilot Mascot!
  c.save();
  c.translate(36, -59 - lift);
  if (opts.magnetActive) {
    drawModelOn(c, 'prop_magnet', 18, 0, 1.57, 0.55);
  }
  drawModelOn(c, 'nailong_head', 0, -11 + Math.sin(performance.now() * 0.012) * 1.2, 0, 0.34);
  const bsk = c.createLinearGradient(-11, -3, 11, 12);
  bsk.addColorStop(0, '#fbbf24');
  bsk.addColorStop(1, '#b45309');
  c.fillStyle = bsk;
  c.strokeStyle = INK;
  c.lineWidth = 2.6;
  c.beginPath();
  c.roundRect(-11.5, -3, 23, 14.5, 3.5);
  c.fill();
  c.stroke();
  // Woven rattan cross-lines
  c.strokeStyle = 'rgba(120, 53, 15, 0.55)';
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(-10, 4); c.lineTo(10, 4);
  c.moveTo(-4, -2); c.lineTo(-4, 10);
  c.moveTo(4, -2); c.lineTo(4, 10);
  c.stroke();
  if (opts.weaponId === 'gatling') drawModelOn(c, 'gatlingGun', 18, -8, 0, 0.95);
  else if (opts.weaponId === 'bazooka') drawModelOn(c, 'bazookaGun', 12, -16, -0.12, 0.95);
  c.restore();

  // 5. Near Articulated Leg + Main 3x Cel-Shaded Rider + Outlined Arm!
  const nLeg = solveIK(hipX + 2, hipY, rp.x, rp.y, 22, 21, bendDir);
  drawArticulatedLegAndShoe(c, heroId, hipX + 2, hipY, nLeg, false);

  const drawArm = (x1, y1, cx1, cy1, armCol, w) => {
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.lineWidth = w + 4.4;
    c.beginPath();
    c.moveTo(x1, y1);
    c.quadraticCurveTo(cx1, cy1, handleX, handleY);
    c.stroke();
    c.strokeStyle = armCol;
    c.lineWidth = w;
    c.stroke();
  };

  if (heroId === 'nailong') {
    drawModelOn(c, 'nailong_torso', -14, -72 - lift + jig * 0.3, 0, 0.96);
    drawModelOn(c, 'nailong_head', -6, -109 - lift + jig * 0.42, Math.sin(performance.now() * 0.008) * 0.04, 0.94);
    drawArm(-4, -80 - lift, 7, -75 - lift, '#facc15', 8.5);
  } else if (heroId === 'ikun') {
    drawModelOn(c, 'ikun_torso', -14, -77 - lift + jig * 0.25, 0, 0.96);
    drawModelOn(c, 'ikun_head', -10, -113 - lift + jig * 0.35, 0, 0.96);
    drawArm(-6, -86 - lift, 5, -76 - lift, '#1e293b', 7.8);
  } else if (heroId === 'pelican') {
    drawModelOn(c, 'pelican_rig', -4, -88 - lift + jig * 0.3, 0, 0.94);
  } else if (heroId === 'naiwa') {
    drawModelOn(c, 'naiwa_rig', -8, -92 - lift + jig * 0.38, 0, 0.94);
    drawArm(-2, -80 - lift, 8, -75 - lift, '#eab308', 5.8);
  } else {
    drawModelOn(c, 'hakimi_rig', -8, -90 - lift + jig * 0.3, 0, 0.96);
    drawArm(-4, -78 - lift, 7, -74 - lift, '#fb923c', 7.8);
  }

  // 6. Explosive Ink-Gold Shoulder-Barge Slash Crescent (`🐔 铁山靠刀光`)!
  if (opts.striking) {
    c.save();
    c.translate(22, -58 - lift);
    c.strokeStyle = 'rgba(249, 115, 22, 0.85)';
    c.lineWidth = 14;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(0, 0, 62, -0.88, 0.88);
    c.stroke();

    c.strokeStyle = '#fde047';
    c.lineWidth = 7.5;
    c.beginPath();
    c.arc(4, 0, 62, -0.78, 0.78);
    c.stroke();

    c.strokeStyle = '#ffffff';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(6, 0, 62, -0.58, 0.58);
    c.stroke();
    c.restore();
  }

  c.restore();
}
