// ============================================================================
// 《鹈鹕测试大乱斗》 — 2.5D High-DPI Sculpted Character, Boss & Prop Studio
// ============================================================================

export const MODELS = {};

      function makeSprite(w, h, drawFn) {
        const c = document.createElement('canvas');
        const s = 2; // High-DPI 2x super-sampling!
        c.width = w * s;
        c.height = h * s;
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


export function buildAllSculptedAssets() {
        // ---------- A. SCULPTED 2.5D PLAYER HEROES (NO cheap primitive circles!) ----------

        // 1. NAILOONG (大头奶龙 — Authentic chubby pear-cheeks snouted dragon head + dorsal spikes + emerald eyes + baby fang!)
        MODELS.nailong_torso = makeSprite(86, 76, (g) => {
          g.translate(46, 42);
          // Sweeping plump dragon tail + 3 orange dorsal plates!
          g.fillStyle = '#f97316'; g.strokeStyle = '#292524'; g.lineWidth = 2.2;
          for (const [sx, sy, sr] of [[-28, -4, 5], [-36, -12, 4.5], [-20, -18, 5.5]]) {
            g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill(); g.stroke();
          }
          const tg = g.createRadialGradient(-4, -6, 4, -8, 4, 34);
          tg.addColorStop(0, '#fef08a'); tg.addColorStop(0.65, '#facc15'); tg.addColorStop(1, '#d97706');
          g.fillStyle = tg;
          g.beginPath();
          g.moveTo(-16, 18);
          g.quadraticCurveTo(-40, 14, -41, -8);
          g.quadraticCurveTo(-30, 2, -20, -4);
          g.bezierCurveTo(-22, -26, 14, -28, 18, -2);
          g.bezierCurveTo(22, 18, 4, 24, -16, 18);
          g.fill(); g.stroke();
          // Soft cream tummy patch + tummy crease!
          g.fillStyle = '#fef9c3';
          g.beginPath(); g.ellipse(4, 2, 12, 15, 0.12, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#ca8a04'; g.lineWidth = 1.5;
          g.beginPath(); g.arc(5, 5, 6, 0.3, 2.5); g.stroke();
        });

        MODELS.nailong_head = makeSprite(92, 86, (g) => {
          g.translate(44, 46);
          // 3D Tangerine Dragon Horns & Cute Round Ear Nubs
          g.strokeStyle = '#292524'; g.lineWidth = 2.3;
          const hg = g.createLinearGradient(0, -36, 0, -18);
          hg.addColorStop(0, '#fdba74'); hg.addColorStop(1, '#ea580c');
          g.fillStyle = hg;
          g.beginPath(); g.ellipse(-10, -28, 5.5, 9, -0.25, 0, Math.PI * 2); g.fill(); g.stroke();
          g.beginPath(); g.ellipse(5, -29, 5.5, 9, 0.22, 0, Math.PI * 2); g.fill(); g.stroke();
          // Back dorsal head fin
          g.beginPath(); g.arc(-26, -6, 6, 0, Math.PI * 2); g.fill(); g.stroke();
          // Ear nub
          g.fillStyle = '#facc15';
          g.beginPath(); g.ellipse(-24, -14, 6, 4.5, -0.4, 0, Math.PI * 2); g.fill(); g.stroke();

          // Sculpted Nailoong Cranium + Pinchable Chubby Cheeks + Snout Muzzle!
          const sk = g.createRadialGradient(-2, -12, 5, 2, 2, 38);
          sk.addColorStop(0, '#fffbeb');
          sk.addColorStop(0.35, '#fde047');
          sk.addColorStop(0.78, '#facc15');
          sk.addColorStop(1, '#d97706');
          g.fillStyle = sk;
          g.beginPath();
          g.moveTo(-18, -22);
          g.bezierCurveTo(-4, -30, 16, -27, 22, -12);
          // Protruding cute dragon snout!
          g.bezierCurveTo(36, -9, 40, 6, 30, 15);
          // Plump lower jaw & chubby cheek pouch!
          g.bezierCurveTo(18, 27, -14, 28, -24, 14);
          g.bezierCurveTo(-33, 2, -29, -15, -18, -22);
          g.closePath(); g.fill(); g.stroke();

          // Specular Forehead Shine
          g.fillStyle = 'rgba(255, 255, 255, 0.55)';
          g.beginPath(); g.ellipse(-5, -17, 9, 4, -0.25, 0, Math.PI * 2); g.fill();

          // Rosy Airbrushed Cheek Blushes
          g.fillStyle = 'rgba(251, 113, 133, 0.52)';
          g.beginPath(); g.ellipse(0, 7, 8, 5, 0, 0, Math.PI * 2); g.fill();

          // Expressive 3D Emerald Dragon Eyes + Upper Eyelids + Double Starlight!
          for (const [ex, ey, er] of [[6, -7, 8.2], [20, -7, 6.8]]) {
            g.fillStyle = '#ffffff';
            g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.fill(); g.stroke();
            const ig = g.createRadialGradient(ex + 1, ey - 1, 1, ex + 1, ey, er * 0.65);
            ig.addColorStop(0, '#86efac'); ig.addColorStop(0.55, '#16a34a'); ig.addColorStop(1, '#14532d');
            g.fillStyle = ig;
            g.beginPath(); g.arc(ex + 1.4, ey, er * 0.62, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#0f172a';
            g.beginPath(); g.arc(ex + 1.8, ey, er * 0.32, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#ffffff';
            g.beginPath(); g.arc(ex + 3, ey - 2.2, er * 0.22, 0, Math.PI * 2); g.fill();
            g.beginPath(); g.arc(ex - 0.5, ey + 2, er * 0.11, 0, Math.PI * 2); g.fill();
          }
          // Cute Snout Nostrils
          g.fillStyle = '#92400e';
          g.beginPath(); g.arc(27, -2, 1.4, 0, Math.PI * 2); g.arc(32, -1.5, 1.3, 0, Math.PI * 2); g.fill();

          // Recessed Joyful Dragon Mouth + Plump Pink Tongue + Iconic Baby Fang!
          g.fillStyle = '#881337';
          g.beginPath();
          g.moveTo(9, 6); g.quadraticCurveTo(22, 4, 29, 7);
          g.quadraticCurveTo(24, 20, 11, 16); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#fb7185';
          g.beginPath(); g.ellipse(19, 13.5, 7, 4, 0, 0, Math.PI * 2); g.fill();
          // Single White Baby Fang!
          g.fillStyle = '#ffffff'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(20, 6); g.lineTo(22.5, 11); g.lineTo(25, 6.5); g.closePath(); g.fill(); g.stroke();
        });

        // 2. IKUN (中分ikun — Sculpted chibi idol face, layered silver curtain hair strands, collared shirt & brass suspenders!)
        MODELS.ikun_torso = makeSprite(70, 72, (g) => {
          g.translate(35, 38);
          const sg = g.createLinearGradient(-15, -20, 15, 20);
          sg.addColorStop(0, '#334155'); sg.addColorStop(1, '#0f172a');
          g.fillStyle = sg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-15, -22, 28, 38, 9); g.fill(); g.stroke();
          // White shirt collar V-neck
          g.fillStyle = '#f8fafc';
          g.beginPath(); g.moveTo(-6, -22); g.lineTo(2, -13); g.lineTo(8, -22); g.closePath(); g.fill(); g.stroke();
          // Tailored White Suspenders + Brass Clips!
          g.strokeStyle = '#ffffff'; g.lineWidth = 4.5;
          g.beginPath(); g.moveTo(-10, -20); g.lineTo(-8, 14); g.moveTo(5, -20); g.lineTo(3, 14); g.stroke();
          g.fillStyle = '#facc15';
          g.fillRect(-11, 4, 6, 5); g.strokeRect(-11, 4, 6, 5);
          g.fillRect(1, 4, 6, 5); g.strokeRect(1, 4, 6, 5);
        });

        MODELS.ikun_head = makeSprite(82, 82, (g) => {
          g.translate(41, 44);
          // Sculpted Anime Jawline & Ear
          const fg = g.createRadialGradient(2, -2, 3, 0, 0, 22);
          fg.addColorStop(0, '#ffedd5'); fg.addColorStop(1, '#fdba74');
          g.fillStyle = fg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.arc(-15, 2, 5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.beginPath();
          g.moveTo(-15, -10); g.bezierCurveTo(-15, 14, 0, 19, 8, 17);
          g.bezierCurveTo(18, 15, 20, -4, 16, -13);
          g.closePath(); g.fill(); g.stroke();
          // Confident Idol Eyes, Sharp Brow & Smirk!
          g.fillStyle = '#ffffff';
          g.beginPath(); g.ellipse(9, -1, 5, 3.8, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#1e293b'; g.beginPath(); g.arc(10, -1, 2.4, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#ffffff'; g.beginPath(); g.arc(11, -2, 1, 0, Math.PI * 2); g.fill();
          g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(3, -7); g.lineTo(14, -6); g.stroke();
          g.strokeStyle = '#be123c';
          g.beginPath(); g.arc(8, 7, 4.5, 0.15, Math.PI * 0.85); g.stroke();

          // Layered 3D Silver-Grey Middle-Part Curtain Hair with Gloss Bands!
          const hg = g.createLinearGradient(0, -28, 0, 10);
          hg.addColorStop(0, '#f8fafc'); hg.addColorStop(0.55, '#cbd5e1'); hg.addColorStop(1, '#64748b');
          g.fillStyle = hg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(2, -23);
          g.bezierCurveTo(-20, -26, -29, -8, -24, 10);
          g.quadraticCurveTo(-14, -2, -5, -8);
          g.quadraticCurveTo(0, -14, 2, -13);
          g.bezierCurveTo(12, -4, 18, 2, 24, 9);
          g.bezierCurveTo(28, -9, 20, -25, 2, -23);
          g.fill(); g.stroke();
          // Hair strand detail lines
          g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.6;
          g.beginPath(); g.arc(-11, -13, 8, 3.4, 5.2); g.arc(12, -13, 8, 4.2, 6.0); g.stroke();
        });

        // 3. PELICAN (背带鹈鹕 — Feathered body in overalls + S-neck + 3D hooked beak & ribbed golden throat pouch!)
        MODELS.pelican_rig = makeSprite(118, 106, (g) => {
          g.translate(48, 66);
          // Plump Feathered Body + Overalls
          g.fillStyle = '#f8fafc'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.ellipse(-8, 6, 25, 17, -0.18, 0, Math.PI * 2); g.fill(); g.stroke();
          // Denim/Black Suspenders Overalls
          g.fillStyle = '#1e293b';
          g.beginPath(); g.ellipse(-6, 7, 16, 14, -0.18, 0, Math.PI * 2); g.fill(); g.stroke();
          g.strokeStyle = '#ffffff'; g.lineWidth = 3.2;
          g.beginPath(); g.moveTo(-14, -6); g.lineTo(-2, 18); g.moveTo(0, -6); g.lineTo(-12, 18); g.stroke();
          // Sculpted S-Curve Neck
          g.fillStyle = '#f8fafc'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(2, 0); g.bezierCurveTo(16, -12, -4, -26, 8, -42);
          g.lineTo(19, -40); g.bezierCurveTo(10, -24, 28, -10, 14, 6);
          g.closePath(); g.fill(); g.stroke();
          // Pelican Head + Curtain Hair Tuft!
          g.beginPath(); g.arc(14, -44, 13, 0, Math.PI * 2); g.fill(); g.stroke();
          // Ribbed Golden-Orange Gular Pouch + Hooked Upper Beak!
          const pg = g.createLinearGradient(20, -44, 48, -18);
          pg.addColorStop(0, '#fb923c'); pg.addColorStop(1, '#eab308');
          g.fillStyle = pg;
          g.beginPath(); g.moveTo(20, -41); g.lineTo(64, -45); g.quadraticCurveTo(48, -14, 17, -33); g.closePath(); g.fill(); g.stroke();
          // Upper Beak & Red Nail Tip
          g.fillStyle = '#fef08a';
          g.beginPath(); g.moveTo(20, -49); g.lineTo(65, -48); g.lineTo(64, -42); g.lineTo(20, -41); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#dc2626';
          g.beginPath(); g.moveTo(64, -48); g.lineTo(69, -44); g.lineTo(63, -41); g.closePath(); g.fill();
          // Eye & Middle-Part Feathers
          g.fillStyle = '#fde047'; g.beginPath(); g.arc(18, -46, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(19, -46, 2, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#cbd5e1';
          g.beginPath(); g.ellipse(7, -55, 10, 4.5, -0.35, 0, Math.PI * 2); g.ellipse(19, -55, 10, 4.5, 0.35, 0, Math.PI * 2); g.fill(); g.stroke();
          // Layered Wing Plumage
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.moveTo(-16, 2); g.quadraticCurveTo(4, -8, 22, 0);
          g.quadraticCurveTo(8, 12, -18, 12); g.closePath(); g.fill(); g.stroke();
        });

        // 4. LAUGHING NAIWA (狂笑奶蛙 — Sculpted amphibian spots, brow domes, glossy bulging eyes, toothy grin & 3D tongue!)
        MODELS.naiwa_rig = makeSprite(94, 98, (g) => {
          g.translate(46, 56);
          const bg = g.createRadialGradient(-2, 8, 4, -4, 12, 28);
          bg.addColorStop(0, '#fef08a'); bg.addColorStop(0.7, '#eab308'); bg.addColorStop(1, '#a16207');
          g.fillStyle = bg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.3;
          g.beginPath(); g.ellipse(-6, 12, 24, 21, 0.1, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#fef9c3'; g.beginPath(); g.ellipse(2, 14, 14, 14, 0.1, 0, Math.PI * 2); g.fill();

          // Sculpted Wide Frog Head + Brow Ridges
          g.fillStyle = bg;
          g.beginPath(); g.ellipse(4, -20, 28, 20, -0.06, 0, Math.PI * 2); g.fill(); g.stroke();
          for (const ex of [-5, 15]) {
            g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex, -37, 9, 0, Math.PI * 2); g.fill(); g.stroke();
            g.fillStyle = '#16a34a'; g.beginPath(); g.arc(ex + 1.5, -37, 5, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#0f172a'; g.beginPath(); g.arc(ex + 2, -37, 2.4, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex + 3, -39, 1.4, 0, Math.PI * 2); g.fill();
          }
          // Giant Cursed Laughing Mouth + White Teeth Row + Curling Tongue!
          g.fillStyle = '#881337';
          g.beginPath(); g.moveTo(-14, -17); g.lineTo(29, -20); g.quadraticCurveTo(15, 4, -14, -17); g.fill(); g.stroke();
          g.fillStyle = '#ffffff';
          g.fillRect(-4, -18, 24, 4);
          g.fillStyle = '#fb7185';
          g.beginPath(); g.ellipse(12, -8, 11, 5, 0.15, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        // 5. HAKIMI CAT (哈基米猫 — Fluffy ginger tabby ruffs, 'M' stripes, pink ears, reflective shades & headband!)
        MODELS.hakimi_rig = makeSprite(92, 96, (g) => {
          g.translate(46, 56);
          // Striped Ginger Tail
          g.strokeStyle = '#ea580c'; g.lineWidth = 7;
          g.beginPath(); g.moveTo(-18, 18); g.quadraticCurveTo(-38, 8, -32, -10); g.stroke();
          // Plump Tabby Body + White Chest Fluff
          const cg = g.createRadialGradient(0, 8, 3, -4, 10, 26);
          cg.addColorStop(0, '#fdba74'); cg.addColorStop(0.65, '#fb923c'); cg.addColorStop(1, '#c2410c');
          g.fillStyle = cg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.ellipse(-6, 10, 20, 22, 0.08, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#fff7ed'; g.beginPath(); g.ellipse(2, 11, 11, 15, 0.1, 0, Math.PI * 2); g.fill();

          // Ninja Headband Fluttering Ribbons
          g.fillStyle = '#e11d48';
          g.beginPath(); g.moveTo(-14, -30); g.lineTo(-34, -36); g.lineTo(-28, -24); g.closePath(); g.fill(); g.stroke();
          g.beginPath(); g.moveTo(-14, -27); g.lineTo(-32, -20); g.lineTo(-24, -14); g.closePath(); g.fill(); g.stroke();

          // Fluffy Cat Head + Pointed Ears with Pink Inner Fur!
          g.fillStyle = cg;
          g.beginPath();
          g.moveTo(-14, -32); g.lineTo(-19, -49); g.lineTo(-4, -39);
          g.lineTo(8, -39); g.lineTo(22, -49); g.lineTo(18, -32);
          g.bezierCurveTo(28, -24, 27, -8, 14, -5);
          g.bezierCurveTo(2, -2, -16, -4, -20, -16);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#fda4af';
          g.beginPath(); g.moveTo(-13, -34); g.lineTo(-16, -44); g.lineTo(-7, -37); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(15, -34); g.lineTo(18, -44); g.lineTo(9, -37); g.closePath(); g.fill();

          // Red Headband + Metal Forehead Plate
          g.fillStyle = '#e11d48'; g.fillRect(-17, -34, 37, 6); g.strokeRect(-17, -34, 37, 6);
          g.fillStyle = '#e2e8f0'; g.fillRect(0, -34, 12, 5);

          // Cool Reflective Aviator Shades + ':3' Cat Smirk & Whiskers!
          g.fillStyle = '#0f172a';
          g.beginPath(); g.roundRect(-6, -25, 13, 8, 3); g.roundRect(9, -25, 13, 8, 3); g.fill();
          g.strokeStyle = '#38bdf8'; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(-3, -23); g.lineTo(3, -19); g.moveTo(12, -23); g.lineTo(18, -19); g.stroke();
          g.strokeStyle = '#0f172a'; g.lineWidth = 1.8;
          g.beginPath(); g.arc(4, -12, 3, 0, Math.PI); g.arc(10, -12, 3, 0, Math.PI); g.stroke();
        });

        // ---------- B. SCULPTED 2.5D BOSSES & ENEMIES ----------

        // BOSS 1: Golden Toilet Mecha-Throne Frog King (黄金马桶机甲蛙皇!)
        MODELS.boss_naiwa = makeSprite(136, 136, (g) => {
          g.translate(68, 76);
          // Rocket Exhaust Thrusters under Golden Toilet Mech!
          g.fillStyle = '#f97316'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          g.beginPath(); g.moveTo(-26, 36); g.lineTo(-34, 54); g.lineTo(-14, 54); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(22, 36); g.lineTo(14, 54); g.lineTo(34, 54); g.closePath(); g.fill();
          // Golden Toilet Tank & Porcelain Throne Base
          const tg = g.createLinearGradient(-35, 0, 35, 38);
          tg.addColorStop(0, '#fef08a'); tg.addColorStop(0.5, '#eab308'); tg.addColorStop(1, '#854d0e');
          g.fillStyle = tg;
          g.beginPath(); g.roundRect(18, -22, 24, 52, 6); g.fill(); g.stroke();
          g.beginPath(); g.roundRect(-34, 8, 66, 30, 12); g.fill(); g.stroke();
          // Giant Crowned Frog King Body & Head
          g.fillStyle = '#facc15';
          g.beginPath(); g.ellipse(-2, -6, 34, 28, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          // Royal Red Cape & Golden Crown with Ruby!
          g.fillStyle = '#fde047';
          g.beginPath();
          g.moveTo(-18, -32); g.lineTo(-22, -52); g.lineTo(-8, -41); g.lineTo(0, -56);
          g.lineTo(8, -41); g.lineTo(22, -52); g.lineTo(18, -32); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#e11d48'; g.beginPath(); g.arc(0, -40, 4.5, 0, Math.PI * 2); g.fill();
          // Bulging Boss Eyes & Maniacal Grin
          for (const ex of [-14, 10]) {
            g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, -28, 9.5, 0, Math.PI * 2); g.fill(); g.stroke();
            g.fillStyle = '#dc2626'; g.beginPath(); g.arc(ex - 2, -28, 4.5, 0, Math.PI * 2); g.fill();
          }
          g.fillStyle = '#881337';
          g.beginPath(); g.moveTo(-24, -8); g.lineTo(20, -8); g.quadraticCurveTo(-2, 16, -24, -8); g.fill(); g.stroke();
          // Giant Wooden Judge Gavel Held in Hand!
          g.fillStyle = '#78350f';
          g.save(); g.translate(-38, -14); g.rotate(-0.4);
          g.fillRect(-4, -6, 8, 36); g.strokeRect(-4, -6, 8, 36);
          g.beginPath(); g.roundRect(-16, -20, 32, 16, 4); g.fill(); g.stroke();
          g.restore();
        });

        // BOSS 2: Twin-Turbine Cyber Mecha-Lawyer Hakimi (双涡轮机甲哈基米总监!)
        MODELS.boss_hakimi = makeSprite(140, 136, (g) => {
          g.translate(70, 74);
          // Shoulder Missile Pods!
          g.fillStyle = '#475569'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          g.beginPath(); g.roundRect(-48, -26, 24, 32, 5); g.roundRect(24, -26, 24, 32, 5); g.fill(); g.stroke();
          g.fillStyle = '#ef4444';
          for (const mx of [-40, -32, 32, 40]) {
            g.beginPath(); g.arc(mx, -16, 3.5, 0, Math.PI * 2); g.arc(mx, -6, 3.5, 0, Math.PI * 2); g.fill();
          }
          // Armored Suit Chest + Red Power Tie
          const mg = g.createLinearGradient(-30, -20, 30, 36);
          mg.addColorStop(0, '#334155'); mg.addColorStop(1, '#0f172a');
          g.fillStyle = mg;
          g.beginPath(); g.roundRect(-30, -12, 60, 48, 12); g.fill(); g.stroke();
          g.fillStyle = '#e11d48';
          g.beginPath(); g.moveTo(0, -8); g.lineTo(-7, 16); g.lineTo(0, 26); g.lineTo(7, 16); g.closePath(); g.fill();
          // Giant Ginger Cyber-Cat Head + Glowing Neon Visor!
          g.fillStyle = '#fb923c';
          g.beginPath();
          g.moveTo(-22, -32); g.lineTo(-28, -56); g.lineTo(-8, -42);
          g.lineTo(8, -42); g.lineTo(28, -56); g.lineTo(22, -32);
          g.arc(0, -24, 25, -0.3, Math.PI + 0.3); g.closePath(); g.fill(); g.stroke();
          // Glowing Cyan-Pink Cyber Visor
          g.fillStyle = '#0ea5e9';
          g.beginPath(); g.roundRect(-22, -32, 44, 12, 5); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.fillRect(-16, -28, 10, 4); g.fillRect(6, -28, 10, 4);
        });

        // BOSS 3: 2.5-Year Basketball Mecha Rooster King (两年半机甲坤王!)
        MODELS.boss_kun_mecha = makeSprite(146, 142, (g) => {
          g.translate(73, 78);
          // Flaming Basketball Hoop Halo Behind Mecha!
          g.strokeStyle = '#f97316'; g.lineWidth = 5;
          g.beginPath(); g.arc(0, -18, 48, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = '#fde047'; g.lineWidth = 2.2; g.setLineDash([6, 4]);
          g.beginPath(); g.arc(0, -18, 42, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
          // Twin Spalding Shoulder Basketball Cannons!
          for (const sx of [-42, 42]) {
            g.fillStyle = '#ea580c'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
            g.beginPath(); g.arc(sx, -14, 15, 0, Math.PI * 2); g.fill(); g.stroke();
            g.beginPath(); g.moveTo(sx - 14, -14); g.lineTo(sx + 14, -14); g.stroke();
          }
          // Black & Gold Suspender Mecha Chestplate
          const kg = g.createLinearGradient(-32, -20, 32, 38);
          kg.addColorStop(0, '#334155'); kg.addColorStop(1, '#0f172a');
          g.fillStyle = kg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.5;
          g.beginPath(); g.roundRect(-30, -10, 60, 48, 11); g.fill(); g.stroke();
          g.strokeStyle = '#facc15'; g.lineWidth = 6;
          g.beginPath(); g.moveTo(-16, -8); g.lineTo(-12, 34); g.moveTo(16, -8); g.lineTo(12, 34); g.stroke();
          // Armored Golden Rooster Mecha Head + Silver Curtain Crest + Glowing Visor!
          g.fillStyle = '#facc15'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          g.beginPath(); g.arc(0, -30, 24, 0, Math.PI * 2); g.fill(); g.stroke();
          // Red Comb & Sharp Golden Beak
          g.fillStyle = '#e11d48';
          g.beginPath(); g.arc(0, -55, 8, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#f97316';
          g.beginPath(); g.moveTo(-22, -30); g.lineTo(-37, -25); g.lineTo(-22, -20); g.closePath(); g.fill(); g.stroke();
          // Silver Middle-Part Armor Wings on Head!
          g.fillStyle = '#cbd5e1';
          g.beginPath();
          g.ellipse(-14, -46, 15, 7, -0.42, 0, Math.PI * 2);
          g.ellipse(14, -46, 15, 7, 0.42, 0, Math.PI * 2);
          g.fill(); g.stroke();
          // Fierce Crimson-Gold Visor
          g.fillStyle = '#dc2626';
          g.beginPath(); g.roundRect(-20, -36, 36, 9, 4); g.fill(); g.stroke();
        });

        // BOSS 4: Obsidian Magma Mecha-Tyrannosaur (暗黑熔岩暴龙王!)
        MODELS.boss_lava_dragon = makeSprite(148, 140, (g) => {
          g.translate(76, 76);
          // Glowing Magma Jetpack Wings!
          g.fillStyle = '#dc2626'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          g.beginPath(); g.moveTo(12, -16); g.lineTo(56, -42); g.lineTo(48, 8); g.lineTo(16, 12); g.closePath(); g.fill(); g.stroke();
          // Obsidian Armored Dino Torso with Magma Core!
          const dg = g.createLinearGradient(-34, -22, 34, 40);
          dg.addColorStop(0, '#475569'); dg.addColorStop(0.55, '#1e293b'); dg.addColorStop(1, '#090d16');
          g.fillStyle = dg;
          g.beginPath(); g.ellipse(0, 8, 34, 30, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#f97316';
          g.beginPath(); g.arc(-6, 10, 12, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#fef08a'; g.beginPath(); g.arc(-6, 10, 6, 0, Math.PI * 2); g.fill();
          // Fierce Horned Mecha-Dragon Head & Snapping Metal Jaw!
          g.fillStyle = '#fde047';
          g.beginPath(); g.moveTo(4, -42); g.lineTo(22, -62); g.lineTo(14, -36); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = dg;
          g.beginPath();
          g.moveTo(-40, -24); g.lineTo(-8, -44); g.lineTo(20, -36);
          g.lineTo(22, -12); g.lineTo(-36, -10); g.closePath(); g.fill(); g.stroke();
          // Glowing Lava Eye & Jagged Steel Fangs
          g.fillStyle = '#ef4444'; g.beginPath(); g.arc(-14, -28, 5.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fef08a'; g.beginPath(); g.arc(-15, -28, 2.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#f8fafc';
          for (const fx of [-32, -23, -14]) {
            g.beginPath(); g.moveTo(fx, -10); g.lineTo(fx + 4, -2); g.lineTo(fx + 8, -10); g.closePath(); g.fill(); g.stroke();
          }
        });

        // BOSS 5 (NEW!): Hainan Meme Megaphone Rooster (🐔 叮咚鸡防疫官!)
        MODELS.boss_dingdong = makeSprite(146, 140, (g) => {
          g.translate(76, 78);
          // Sonic Megaphone Wave Rings Ahead!
          g.strokeStyle = 'rgba(56, 189, 248, 0.78)'; g.lineWidth = 3.2;
          g.beginPath(); g.arc(-52, -16, 14, 2.3, 4.0); g.stroke();
          g.beginPath(); g.arc(-58, -16, 23, 2.3, 4.0); g.stroke();
          // Plump White Chicken Body in Sky-Blue Hazmat Vest!
          const cg = g.createRadialGradient(-4, 4, 5, 0, 8, 38);
          cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.7, '#f1f5f9'); cg.addColorStop(1, '#cbd5e1');
          g.fillStyle = cg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.5;
          g.beginPath(); g.ellipse(4, 10, 34, 30, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          // Blue Hazmat Protective Stripe & Red Armband!
          g.fillStyle = '#0ea5e9';
          g.beginPath(); g.roundRect(-22, -4, 50, 30, 10); g.fill(); g.stroke();
          g.fillStyle = '#ffffff'; g.fillRect(-4, -4, 12, 30);
          g.fillStyle = '#ef4444'; g.beginPath(); g.roundRect(10, 4, 16, 11, 3); g.fill(); g.stroke();
          // Big Round Startled Rooster Head + Red Comb & Wattle!
          g.fillStyle = '#e11d48';
          g.beginPath();
          g.arc(-6, -50, 7, 0, Math.PI * 2);
          g.arc(3, -54, 8.5, 0, Math.PI * 2);
          g.arc(13, -49, 7, 0, Math.PI * 2);
          g.fill(); g.stroke();
          g.fillStyle = '#ffffff';
          g.beginPath(); g.arc(2, -28, 24, 0, Math.PI * 2); g.fill(); g.stroke();
          // Blue Protective Hood Rim
          g.strokeStyle = '#0284c7'; g.lineWidth = 4;
          g.beginPath(); g.arc(2, -28, 22, -1.3, 1.1); g.stroke();
          g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          // Wide Meme Eyes + Open Shouting Beak + Red Wattle
          g.fillStyle = '#fef08a'; g.beginPath(); g.arc(-8, -32, 7.5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(-9, -32, 3.4, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#f97316';
          g.beginPath(); g.moveTo(-18, -28); g.lineTo(-34, -33); g.lineTo(-20, -21); g.closePath(); g.fill(); g.stroke();
          g.beginPath(); g.moveTo(-18, -21); g.lineTo(-32, -16); g.lineTo(-17, -14); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#e11d48'; g.beginPath(); g.ellipse(-14, -10, 4.5, 7, 0.2, 0, Math.PI * 2); g.fill(); g.stroke();
          // Giant Red-and-White Loudspeaker Megaphone (大喇叭)!
          g.save(); g.translate(-26, -15); g.rotate(0.08);
          g.fillStyle = '#ef4444';
          g.beginPath(); g.moveTo(4, -5); g.lineTo(-24, -18); g.lineTo(-24, 12); g.lineTo(4, 5); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#f8fafc';
          g.beginPath(); g.roundRect(-10, -9, 12, 14, 2); g.fill(); g.stroke();
          g.fillStyle = '#fde047';
          g.beginPath(); g.ellipse(-24, -3, 4, 15, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.restore();
        });

        // BOSS 6 (NEW!): Wide-Jawed Meme Hound (🐕 大狗嚼!)
        MODELS.boss_dagou = makeSprite(150, 138, (g) => {
          g.translate(78, 76);
          // Muscular Golden-Tan Dog Torso + Spiked Red Collar!
          const bg = g.createRadialGradient(-4, 6, 6, 4, 12, 42);
          bg.addColorStop(0, '#fde68a'); bg.addColorStop(0.55, '#d97706'); bg.addColorStop(1, '#92400e');
          g.fillStyle = bg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.5;
          g.beginPath(); g.ellipse(12, 12, 35, 26, -0.12, 0, Math.PI * 2); g.fill(); g.stroke();
          // Wagging Curled Tail
          g.lineWidth = 8; g.strokeStyle = '#b45309';
          g.beginPath(); g.moveTo(42, 4); g.quadraticCurveTo(60, -14, 48, -28); g.stroke();
          g.lineWidth = 2.5; g.strokeStyle = '#0f172a';
          // Spiked Crimson Collar
          g.fillStyle = '#dc2626';
          g.beginPath(); g.roundRect(-14, -8, 34, 11, 4); g.fill(); g.stroke();
          g.fillStyle = '#f8fafc';
          for (const sx of [-8, 2, 12]) {
            g.beginPath(); g.moveTo(sx, -8); g.lineTo(sx + 3, -15); g.lineTo(sx + 6, -8); g.closePath(); g.fill(); g.stroke();
          }
          // Comically Huge Wide-Open Snapping Meme Dog Jaws (大狗嚼)!
          g.fillStyle = bg;
          // Floppy Ear
          g.beginPath(); g.ellipse(18, -34, 9, 18, 0.45, 0, Math.PI * 2); g.fill(); g.stroke();
          // Upper Snout & Cranium
          g.beginPath();
          g.moveTo(18, -16); g.bezierCurveTo(22, -46, -12, -52, -26, -36);
          g.lineTo(-56, -34); g.quadraticCurveTo(-60, -20, -48, -16);
          g.lineTo(-10, -14); g.closePath(); g.fill(); g.stroke();
          // Lower Snapping Jaw & Wild Pink Tongue!
          g.fillStyle = '#7f1d1d';
          g.beginPath(); g.moveTo(-48, -17); g.lineTo(-8, -14); g.lineTo(-42, 10); g.closePath(); g.fill();
          g.fillStyle = bg;
          g.beginPath(); g.moveTo(-8, -12); g.lineTo(-48, 8); g.quadraticCurveTo(-52, 18, -36, 18); g.lineTo(6, 2); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#fb7185';
          g.beginPath(); g.ellipse(-28, -2, 13, 5, 0.28, 0, Math.PI * 2); g.fill(); g.stroke();
          // Gleaming White Cartoon Fangs (Upper & Lower)!
          g.fillStyle = '#ffffff';
          for (const fx of [-48, -36, -24]) {
            g.beginPath(); g.moveTo(fx, -16); g.lineTo(fx + 4, -7); g.lineTo(fx + 8, -16); g.closePath(); g.fill(); g.stroke();
          }
          for (const fx of [-42, -30]) {
            g.beginPath(); g.moveTo(fx, 6); g.lineTo(fx + 4, -2); g.lineTo(fx + 8, 4); g.closePath(); g.fill(); g.stroke();
          }
          // Black Dog Nose & Wild Meme Bulging Eyes!
          g.fillStyle = '#0f172a'; g.beginPath(); g.ellipse(-54, -31, 6, 4.5, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-16, -35, 9, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(-18, -35, 3.8, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fde047'; g.beginPath(); g.arc(-19, -37, 1.5, 0, Math.PI * 2); g.fill();
        });

        // Sculpted Enemies (8 Distinct 2.5D Mobs!)
        MODELS.mob_lawyer = makeSprite(68, 74, (g) => {
          g.translate(36, 42);
          g.fillStyle = '#1e293b'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-13, -10, 28, 36, 7); g.fill(); g.stroke();
          g.fillStyle = '#e11d48';
          g.beginPath(); g.moveTo(1, -8); g.lineTo(-3, 8); g.lineTo(1, 14); g.lineTo(5, 8); g.closePath(); g.fill();
          g.fillStyle = '#fed7aa';
          g.beginPath(); g.arc(1, -22, 12, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#0f172a'; g.fillRect(-9, -25, 16, 5);
          // 3D Curved Riot Shield
          const rg = g.createLinearGradient(-28, 0, -12, 0);
          rg.addColorStop(0, '#bae6fd'); rg.addColorStop(0.5, '#0284c7'); rg.addColorStop(1, '#1e3a8a');
          g.fillStyle = rg;
          g.beginPath(); g.roundRect(-27, -26, 14, 52, 5); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.fillRect(-25, -15, 10, 8);
        });

        MODELS.mob_frog = makeSprite(62, 60, (g) => {
          g.translate(31, 34);
          const fg = g.createRadialGradient(0, 0, 2, 0, 4, 22);
          fg.addColorStop(0, '#fef08a'); fg.addColorStop(1, '#ca8a04');
          g.fillStyle = fg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.ellipse(0, 6, 20, 16, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#be123c'; g.beginPath(); g.arc(-2, 7, 10, 0, Math.PI); g.fill(); g.stroke();
          // Yellow Hard-Hat Helmet!
          g.fillStyle = '#f97316';
          g.beginPath(); g.arc(0, -6, 16, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
          g.fillRect(-19, -7, 38, 4); g.strokeRect(-19, -7, 38, 4);
          g.fillStyle = '#fff'; g.beginPath(); g.arc(-7, -2, 5, 0, Math.PI * 2); g.arc(5, -2, 5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(-8, -2, 2.2, 0, Math.PI * 2); g.arc(4, -2, 2.2, 0, Math.PI * 2); g.fill();
        });

        MODELS.mob_spiky = makeSprite(66, 62, (g) => {
          g.translate(33, 36);
          // Electric Lightning Quills
          g.fillStyle = '#fde047'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          for (let i = -2; i <= 2; i++) {
            const sx = i * 7.5;
            g.beginPath(); g.moveTo(sx - 5, -6); g.lineTo(sx, -28); g.lineTo(sx + 5, -6); g.fill(); g.stroke();
          }
          const cg = g.createRadialGradient(0, 2, 2, 0, 4, 22);
          cg.addColorStop(0, '#fdba74'); cg.addColorStop(1, '#c2410c');
          g.fillStyle = cg;
          g.beginPath(); g.ellipse(0, 6, 20, 15, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#38bdf8';
          g.beginPath(); g.arc(-7, 3, 3.5, 0, Math.PI * 2); g.arc(5, 3, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        // NEW MOB 4: Dribbling Basketball Chick (唱跳运球鸡!)
        MODELS.mob_dribbler = makeSprite(72, 68, (g) => {
          g.translate(38, 38);
          const yg = g.createRadialGradient(0, -2, 2, 2, 4, 22);
          yg.addColorStop(0, '#fef9c3'); yg.addColorStop(0.65, '#facc15'); yg.addColorStop(1, '#ca8a04');
          g.fillStyle = yg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.ellipse(2, 4, 18, 19, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          // Black Overalls & White Suspenders
          g.fillStyle = '#1e293b';
          g.beginPath(); g.arc(2, 9, 16, 0.1, Math.PI - 0.1); g.closePath(); g.fill(); g.stroke();
          g.strokeStyle = '#ffffff'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(-5, -2); g.lineTo(-4, 18); g.moveTo(8, -2); g.lineTo(7, 18); g.stroke();
          // Beak, Eyes & Curtain Hair
          g.fillStyle = '#f97316'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(-14, -2); g.lineTo(-23, 1); g.lineTo(-14, 5); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(-6, -5, 2.6, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#cbd5e1';
          g.beginPath(); g.ellipse(-4, -15, 10, 4.5, -0.35, 0, Math.PI * 2); g.ellipse(9, -15, 10, 4.5, 0.35, 0, Math.PI * 2); g.fill(); g.stroke();
          // Mini Basketball Dribbled in Front!
          g.fillStyle = '#f97316';
          g.beginPath(); g.arc(-22, 14, 8.5, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        // NEW MOB 5: Aerial Paparazzi Camera Drone (航拍狗仔无人机 — Flying!)
        MODELS.mob_drone = makeSprite(78, 56, (g) => {
          g.translate(39, 28);
          // Spinning Cyan Rotor Discs
          g.fillStyle = 'rgba(56, 189, 248, 0.45)'; g.strokeStyle = '#0284c7'; g.lineWidth = 1.8;
          g.beginPath(); g.ellipse(-22, -14, 15, 4, 0, 0, Math.PI * 2); g.ellipse(22, -14, 15, 4, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          // Carbon Quadcopter Frame & Claws
          g.strokeStyle = '#0f172a'; g.lineWidth = 4;
          g.beginPath(); g.moveTo(-22, -12); g.lineTo(22, -12); g.moveTo(-10, 6); g.lineTo(-15, 18); g.moveTo(10, 6); g.lineTo(15, 18); g.stroke();
          g.fillStyle = '#334155'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-16, -9, 32, 18, 8); g.fill(); g.stroke();
          // Glowing Red Camera Lens Eye!
          g.fillStyle = '#ef4444'; g.beginPath(); g.arc(-4, 0, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.beginPath(); g.arc(-6, -2, 2.2, 0, Math.PI * 2); g.fill();
        });

        // NEW MOB 6: Wok-Helmet Pelican Guard (铁锅背带鹕!)
        MODELS.mob_pelican_guard = makeSprite(78, 76, (g) => {
          g.translate(42, 42);
          g.fillStyle = '#f8fafc'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.ellipse(4, 10, 19, 16, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.beginPath(); g.arc(-2, -12, 12, 0, Math.PI * 2); g.fill(); g.stroke();
          // Golden Pelican Pouch Facing Left!
          g.fillStyle = '#fb923c';
          g.beginPath(); g.moveTo(-10, -12); g.lineTo(-36, -14); g.quadraticCurveTo(-24, 6, -8, -4); g.closePath(); g.fill(); g.stroke();
          // Upside-Down Cast-Iron Wok Helmet!
          g.fillStyle = '#334155';
          g.beginPath(); g.arc(-1, -18, 15, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
          g.lineWidth = 3.5; g.beginPath(); g.moveTo(13, -20); g.lineTo(24, -25); g.stroke();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(-6, -13, 2.5, 0, Math.PI * 2); g.fill();
        });

        // NEW MOB 7: Wild Boar Rider Frog (野猪骑士蛙 — Fast Charger!)
        MODELS.mob_boar_frog = makeSprite(82, 72, (g) => {
          g.translate(42, 40);
          // Mini Frog Rider on Top!
          g.fillStyle = '#84cc16'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          g.beginPath(); g.arc(4, -14, 11, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#ef4444'; g.fillRect(-7, -20, 22, 4);
          // Fierce Bristly Brown Boar Mount + White Curved Tusks!
          const bg = g.createRadialGradient(-2, 6, 3, 0, 8, 26);
          bg.addColorStop(0, '#b45309'); bg.addColorStop(1, '#451a03');
          g.fillStyle = bg; g.lineWidth = 2.3;
          g.beginPath(); g.ellipse(0, 9, 25, 16, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          // Pink Boar Snout & White Curved Tusk
          g.fillStyle = '#fda4af';
          g.beginPath(); g.ellipse(-25, 10, 6, 8, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#ffffff';
          g.beginPath(); g.moveTo(-21, 14); g.quadraticCurveTo(-34, 6, -29, -3); g.quadraticCurveTo(-24, 6, -17, 12); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.beginPath(); g.arc(-14, 4, 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        // NEW MOB 8: Suspender Bucket Snowman (背带雪人怪!)
        MODELS.mob_snowman = makeSprite(68, 76, (g) => {
          g.translate(34, 42);
          const sg = g.createRadialGradient(-3, 0, 3, 0, 6, 26);
          sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.7, '#e0f2fe'); sg.addColorStop(1, '#7dd3fc');
          g.fillStyle = sg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.arc(0, 12, 19, 0, Math.PI * 2); g.fill(); g.stroke();
          g.beginPath(); g.arc(0, -11, 14, 0, Math.PI * 2); g.fill(); g.stroke();
          // Red Scarf & Carrot Nose & Bucket Hat!
          g.fillStyle = '#e11d48'; g.beginPath(); g.roundRect(-14, -2, 28, 6, 3); g.fill(); g.stroke();
          g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(-8, -10); g.lineTo(-24, -8); g.lineTo(-8, -5); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#dc2626';
          g.beginPath(); g.moveTo(-11, -21); g.lineTo(-8, -36); g.lineTo(9, -35); g.lineTo(12, -20); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(-5, -13, 2.3, 0, Math.PI * 2); g.fill();
        });

        // Giant Rolling Alpine Snowball!
        MODELS.snowballGiant = makeSprite(68, 68, (g) => {
          g.translate(34, 34);
          const sg = g.createRadialGradient(-8, -8, 4, 0, 0, 30);
          sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.65, '#bae6fd'); sg.addColorStop(1, '#38bdf8');
          g.fillStyle = sg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          g.beginPath(); g.arc(0, 0, 29, 0, Math.PI * 2); g.fill(); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
          g.beginPath(); g.arc(-4, -4, 16, 2.2, 4.8); g.stroke();
        });

        // ---------- C. 12 DIRECT IN-WORLD 3D PROPS & WEAPONS ----------

        // 1. Bean Jar & 10x Giant Golden Jar (for Super Bonus Stage!)
        MODELS.beanJar = makeSprite(36, 40, (g) => {
          g.translate(18, 21);
          const jg = g.createLinearGradient(-11, -10, 11, 12);
          jg.addColorStop(0, '#bbf7d0'); jg.addColorStop(0.45, '#4ade80'); jg.addColorStop(1, '#15803d');
          g.fillStyle = jg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-11, -9, 22, 22, 6); g.fill(); g.stroke();
          g.fillStyle = '#d97706'; g.beginPath(); g.roundRect(-7, -14, 14, 6, 2); g.fill(); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(-7, -4); g.lineTo(-7, 7); g.stroke();
        });

        MODELS.goldJar = makeSprite(48, 52, (g) => {
          g.translate(24, 27);
          const jg = g.createRadialGradient(-4, -4, 3, 0, 2, 20);
          jg.addColorStop(0, '#ffffff'); jg.addColorStop(0.35, '#fde047'); jg.addColorStop(1, '#ca8a04');
          g.fillStyle = jg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          g.beginPath(); g.roundRect(-15, -12, 30, 28, 8); g.fill(); g.stroke();
          g.fillStyle = '#e11d48'; g.beginPath(); g.roundRect(-10, -18, 20, 7, 3); g.fill(); g.stroke();
          g.fillStyle = '#b45309'; g.font = '900 11px sans-serif'; g.textAlign = 'center';
          g.fillText('★', 0, 7);
        });

        // 2. Direct Prop: Giant Spicy Strip Potion (巨大化辣条!)
        MODELS.prop_giant = makeSprite(56, 58, (g) => {
          g.translate(28, 29);
          g.fillStyle = 'rgba(253, 224, 71, 0.35)'; g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.fill();
          g.rotate(-0.18);
          const lg = g.createLinearGradient(-14, -18, 14, 18);
          lg.addColorStop(0, '#ef4444'); lg.addColorStop(1, '#991b1b');
          g.fillStyle = lg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-14, -18, 28, 36, 5); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.fillRect(-14, -20, 28, 6); g.strokeRect(-14, -20, 28, 6);
          g.fillStyle = '#fff'; g.font = '900 10px sans-serif'; g.textAlign = 'center';
          g.fillText('辣条', 0, 4);
        });

        // 3. Direct Prop: Supersonic Booster Rocket (冲刺火箭!)
        MODELS.prop_rocket = makeSprite(62, 54, (g) => {
          g.translate(31, 27);
          g.fillStyle = 'rgba(56, 189, 248, 0.32)'; g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.fill();
          g.rotate(-0.45);
          g.fillStyle = '#ef4444'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(-14, -8); g.lineTo(-22, -16); g.lineTo(-18, 0); g.lineTo(-22, 16); g.lineTo(-14, 8); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#f8fafc';
          g.beginPath(); g.ellipse(2, 0, 20, 10, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#ef4444';
          g.beginPath(); g.arc(16, 0, 8, -1.1, 1.1); g.fill();
          g.fillStyle = '#38bdf8'; g.beginPath(); g.arc(3, 0, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        // 4. Direct Prop: Super Horseshoe Magnet (吸星磁铁!)
        MODELS.prop_magnet = makeSprite(56, 56, (g) => {
          g.translate(28, 28);
          g.fillStyle = 'rgba(244, 63, 94, 0.28)'; g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.fill();
          g.lineWidth = 9; g.strokeStyle = '#0f172a';
          g.beginPath(); g.arc(0, 2, 13, Math.PI, 0); g.lineTo(13, 15); g.moveTo(-13, 2); g.lineTo(-13, 15); g.stroke();
          g.lineWidth = 6; g.strokeStyle = '#ef4444';
          g.beginPath(); g.arc(0, 2, 13, Math.PI, 0); g.lineTo(13, 10); g.moveTo(-13, 2); g.lineTo(-13, 10); g.stroke();
          g.fillStyle = '#e2e8f0'; g.strokeStyle = '#0f172a'; g.lineWidth = 1.8;
          g.fillRect(-17, 9, 8, 7); g.strokeRect(-17, 9, 8, 7);
          g.fillRect(9, 9, 8, 7); g.strokeRect(9, 9, 8, 7);
        });

        // 5. Direct Prop: Golden Midas Horn (点石成金号角!)
        MODELS.prop_midas = makeSprite(58, 56, (g) => {
          g.translate(29, 28);
          g.fillStyle = 'rgba(250, 204, 21, 0.35)'; g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.fill();
          const mg = g.createLinearGradient(-16, -12, 18, 14);
          mg.addColorStop(0, '#fef08a'); mg.addColorStop(1, '#ca8a04');
          g.fillStyle = mg; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(-16, 8); g.quadraticCurveTo(-4, 16, 4, 2);
          g.lineTo(18, -12); g.lineTo(20, 6); g.quadraticCurveTo(4, 22, -16, 14);
          g.closePath(); g.fill(); g.stroke();
        });

        // 6. Direct Prop: Chilled Mung-Bean Boba Cup (+1❤️!)
        MODELS.prop_boba = makeSprite(52, 58, (g) => {
          g.translate(26, 30);
          g.strokeStyle = '#16a34a'; g.lineWidth = 4;
          g.beginPath(); g.moveTo(2, -12); g.lineTo(7, -23); g.stroke();
          g.fillStyle = '#bbf7d0'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(-12, -10); g.lineTo(12, -10); g.lineTo(9, 16); g.lineTo(-9, 16); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#f8fafc'; g.beginPath(); g.arc(0, -10, 12, Math.PI, 0); g.fill(); g.stroke();
          g.fillStyle = '#e11d48'; g.font = '900 12px sans-serif'; g.textAlign = 'center';
          g.fillText('♥', 0, 8);
        });

        // Parachute Crate, Drone, Gatling, Bazooka, CashTruck, Weapons & World Props
        MODELS.airdropCrate = makeSprite(64, 82, (g) => {
          g.translate(32, 50);
          g.strokeStyle = '#e2e8f0'; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(-22, -24); g.lineTo(-12, -6); g.moveTo(22, -24); g.lineTo(12, -6); g.stroke();
          g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.fillStyle = '#ef4444'; g.beginPath(); g.arc(0, -24, 24, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(0, -35, 9, 12, 0, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#f59e0b'; g.beginPath(); g.roundRect(-16, -7, 32, 30, 5); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.fillRect(-16, -7, 32, 5); g.strokeRect(-16, -7, 32, 5);
          g.fillStyle = '#0ea5e9'; g.beginPath(); g.arc(0, 9, 8.5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#fff'; g.font = '900 12px sans-serif'; g.textAlign = 'center'; g.fillText('?', 0, 13);
        });

        MODELS.gatlingGun = makeSprite(58, 30, (g) => {
          g.translate(24, 15);
          g.fillStyle = '#d97706'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          g.beginPath(); g.roundRect(-20, -9, 18, 18, 4); g.fill(); g.stroke();
          g.fillStyle = '#94a3b8';
          for (const by of [-6, 0, 6]) { g.fillRect(-2, by - 2, 30, 4); g.strokeRect(-2, by - 2, 30, 4); }
          g.fillStyle = '#fde047'; g.fillRect(10, -8, 5, 16); g.strokeRect(10, -8, 5, 16);
        });

        MODELS.bazookaGun = makeSprite(64, 28, (g) => {
          g.translate(32, 14);
          g.fillStyle = '#15803d'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-24, -7, 46, 14, 3); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.fillRect(6, -12, 6, 5); g.strokeRect(6, -12, 6, 5);
        });

        // High-Clarity Track Prop Icons (Unmistakable silhouettes & color halos!)
        MODELS.prop_saw = makeSprite(64, 64, (g) => {
          g.translate(32, 32);
          g.fillStyle = 'rgba(168, 85, 247, 0.34)'; g.beginPath(); g.arc(0, 0, 29, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#f8fafc'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.1;
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const a1 = (i * Math.PI * 2) / 10, a2 = a1 + 0.31, a3 = a1 + 0.62;
            if (i === 0) g.moveTo(Math.cos(a1) * 18, Math.sin(a1) * 18);
            g.lineTo(Math.cos(a2) * 27, Math.sin(a2) * 27);
            g.lineTo(Math.cos(a3) * 18, Math.sin(a3) * 18);
          }
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#7c3aed'; g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        MODELS.prop_mortar_cat = makeSprite(64, 64, (g) => {
          g.translate(32, 34);
          g.fillStyle = 'rgba(251, 146, 60, 0.34)'; g.beginPath(); g.arc(0, -2, 28, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fb923c'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(-15, -8); g.lineTo(-19, -24); g.lineTo(-6, -15);
          g.lineTo(6, -15); g.lineTo(19, -24); g.lineTo(15, -8);
          g.arc(0, 0, 17, -0.3, Math.PI + 0.3); g.closePath(); g.fill(); g.stroke();
          // Green Army Mortar Helmet + Mini Cannon Barrel!
          g.fillStyle = '#15803d';
          g.beginPath(); g.arc(0, -8, 16, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#334155';
          g.save(); g.translate(14, 4); g.rotate(-0.55);
          g.beginPath(); g.roundRect(-6, -6, 20, 11, 3); g.fill(); g.stroke();
          g.restore();
          g.fillStyle = '#0f172a'; g.beginPath(); g.arc(-6, -1, 2.5, 0, Math.PI * 2); g.arc(5, -1, 2.5, 0, Math.PI * 2); g.fill();
        });

        MODELS.prop_gatling = makeSprite(66, 62, (g) => {
          g.translate(33, 31);
          g.fillStyle = 'rgba(14, 165, 233, 0.34)'; g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#d97706'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.1;
          g.beginPath(); g.roundRect(-22, -10, 18, 20, 4); g.fill(); g.stroke();
          g.fillStyle = '#e2e8f0';
          for (const by of [-6, 0, 6]) { g.fillRect(-4, by - 2, 27, 4); g.strokeRect(-4, by - 2, 27, 4); }
          g.fillStyle = '#fde047'; g.fillRect(9, -9, 5, 18); g.strokeRect(9, -9, 5, 18);
        });

        MODELS.prop_bazooka = makeSprite(66, 62, (g) => {
          g.translate(33, 31);
          g.fillStyle = 'rgba(34, 197, 94, 0.34)'; g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
          g.save(); g.rotate(-0.22);
          g.fillStyle = '#15803d'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-23, -8, 44, 16, 4); g.fill(); g.stroke();
          g.fillStyle = '#ef4444'; g.beginPath(); g.moveTo(19, -7); g.lineTo(28, 0); g.lineTo(19, 7); g.closePath(); g.fill(); g.stroke();
          g.restore();
        });

        MODELS.cashTruck = makeSprite(124, 76, (g) => {
          g.translate(62, 40);
          g.fillStyle = '#1e3a8a'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.6;
          g.beginPath(); g.moveTo(-50, 16); g.lineTo(-50, -24); g.lineTo(22, -24); g.lineTo(42, -7); g.lineTo(52, -3); g.lineTo(52, 16); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#7dd3fc'; g.beginPath(); g.moveTo(20, -20); g.lineTo(38, -6); g.lineTo(20, -6); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#facc15'; g.fillRect(-48, -5, 65, 11);
          g.fillStyle = '#ef4444'; g.beginPath(); g.roundRect(6, -32, 10, 8, 3); g.fill(); g.stroke();
          g.fillStyle = '#3b82f6'; g.beginPath(); g.roundRect(16, -32, 10, 8, 3); g.fill(); g.stroke();
          for (const wx of [-28, 28]) {
            g.fillStyle = '#1e293b'; g.beginPath(); g.arc(wx, 18, 13, 0, Math.PI * 2); g.fill(); g.stroke();
            g.fillStyle = '#cbd5e1'; g.beginPath(); g.arc(wx, 18, 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
          }
        });

        MODELS.fishTorpedo = makeSprite(58, 34, (g) => {
          g.translate(29, 17);
          g.fillStyle = '#0284c7'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(-16, 0); g.lineTo(-26, -11); g.lineTo(-21, 0); g.lineTo(-26, 11); g.closePath(); g.fill(); g.stroke();
          const fg = g.createLinearGradient(0, -10, 0, 10);
          fg.addColorStop(0, '#0369a1'); fg.addColorStop(0.5, '#7dd3fc'); fg.addColorStop(1, '#f8fafc');
          g.fillStyle = fg;
          g.beginPath(); g.moveTo(-17, 0); g.quadraticCurveTo(0, -13, 21, -2); g.lineTo(24, 1); g.quadraticCurveTo(0, 13, -17, 0); g.fill(); g.stroke();
          g.fillStyle = '#ef4444'; g.fillRect(7, -8, 5, 15);
          g.fillStyle = '#fff'; g.beginPath(); g.arc(14, -3, 4, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        MODELS.riotSaw = makeSprite(64, 64, (g) => {
          g.translate(32, 32);
          g.fillStyle = '#e2e8f0'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          g.beginPath();
          for (let i = 0; i < 12; i++) {
            const a1 = (i * Math.PI * 2) / 12, a2 = a1 + 0.28, a3 = a1 + 0.52;
            if (i === 0) g.moveTo(Math.cos(a1) * 21, Math.sin(a1) * 21);
            g.lineTo(Math.cos(a2) * 30, Math.sin(a2) * 30);
            g.lineTo(Math.cos(a3) * 21, Math.sin(a3) * 21);
          }
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#1d4ed8'; g.beginPath(); g.arc(0, 0, 21, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#38bdf8'; g.beginPath(); g.roundRect(-12, -5, 24, 10, 4); g.fill(); g.stroke();
          g.fillStyle = '#facc15'; g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        MODELS.sharkBomb = makeSprite(64, 48, (g) => {
          g.translate(32, 24);
          g.fillStyle = '#facc15'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(-14, -8); g.lineTo(-28, -18); g.lineTo(-24, 0); g.lineTo(-28, 18); g.lineTo(-14, 8); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#dc2626'; g.beginPath(); g.ellipse(3, 0, 22, 15, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(4, 3); g.lineTo(19, 1); g.quadraticCurveTo(14, 11, 4, 8); g.closePath(); g.fill(); g.stroke();
          g.beginPath(); g.arc(12, -5, 4, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        MODELS.tntBarrel = makeSprite(48, 60, (g) => {
          g.translate(24, 33);
          g.fillStyle = '#dc2626'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.4;
          g.beginPath(); g.roundRect(-15, -17, 30, 38, 5); g.fill(); g.stroke();
          g.fillStyle = '#cbd5e1'; g.beginPath(); g.ellipse(0, -17, 15, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = '#fde047'; g.fillRect(-15, -4, 30, 12); g.strokeRect(-15, -4, 30, 12);
          g.fillStyle = '#0f172a'; g.font = '900 9px sans-serif'; g.textAlign = 'center'; g.fillText('TNT', 0, 5);
          g.strokeStyle = '#78350f'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(2, -18); g.quadraticCurveTo(7, -27, 2, -29); g.stroke();
          g.fillStyle = '#fde047'; g.beginPath(); g.arc(2, -29, 4, 0, Math.PI * 2); g.fill();
        });

        MODELS.lawyerScroll = makeSprite(66, 52, (g) => {
          g.translate(33, 26);
          g.fillStyle = '#f8fafc'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          for (const dir of [-1, 1]) {
            g.save(); g.scale(dir, 1);
            g.beginPath(); g.moveTo(12, -4); g.quadraticCurveTo(29, -18, 30, -5); g.quadraticCurveTo(25, 6, 13, 6); g.closePath(); g.fill(); g.stroke();
            g.restore();
          }
          g.fillStyle = '#fffbeb'; g.beginPath(); g.roundRect(-15, -19, 30, 38, 4); g.fill(); g.stroke();
          g.fillStyle = '#e11d48'; g.fillRect(-11, -14, 22, 6);
          g.fillStyle = '#be123c'; g.beginPath(); g.arc(0, 11, 6, 0, Math.PI * 2); g.fill(); g.stroke();
        });

        MODELS.kunai = makeSprite(66, 32, (g) => {
          g.translate(33, 16);
          g.fillStyle = '#4ade80'; g.strokeStyle = '#0f172a'; g.lineWidth = 1.8;
          g.beginPath(); g.moveTo(-18, 0); g.lineTo(-31, -7); g.lineTo(-28, 5); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#f8fafc'; g.beginPath(); g.moveTo(0, 0); g.lineTo(7, -9); g.lineTo(29, 0); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#64748b'; g.beginPath(); g.moveTo(0, 0); g.lineTo(7, 9); g.lineTo(29, 0); g.closePath(); g.fill(); g.stroke();
        });

        MODELS.lotusPad = makeSprite(76, 36, (g) => {
          g.translate(38, 20);
          g.fillStyle = '#16a34a'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.3;
          g.beginPath(); g.ellipse(0, 2, 31, 10.5, 0, 0.25, Math.PI * 2 - 0.25); g.lineTo(0, 2); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#f472b6';
          for (const px of [-8, 8, 0]) { g.beginPath(); g.ellipse(px, -5, 6.5, 8.5, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
        });

        MODELS.bronzeBell = makeSprite(64, 72, (g) => {
          g.translate(32, 37);
          g.fillStyle = '#991b1b'; g.strokeStyle = '#0f172a'; g.lineWidth = 2.2;
          g.beginPath(); g.roundRect(-24, -30, 48, 8, 3); g.fill(); g.stroke();
          g.fillStyle = '#eab308';
          g.beginPath(); g.moveTo(-14, -20); g.quadraticCurveTo(-18, 2, -23, 18); g.lineTo(23, 18); g.quadraticCurveTo(18, 2, 14, -20); g.closePath(); g.fill(); g.stroke();
        });

        MODELS.rockChunk = makeSprite(26, 22, (g) => {
          g.translate(13, 11);
          g.fillStyle = '#64748b'; g.strokeStyle = '#0f172a'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(-9, 4); g.lineTo(-5, -7); g.lineTo(5, -8); g.lineTo(10, 1); g.lineTo(3, 8); g.closePath(); g.fill(); g.stroke();
        });

        MODELS.woodSplinter = makeSprite(32, 16, (g) => {
          g.translate(16, 8);
          g.fillStyle = '#d97706'; g.strokeStyle = '#0f172a'; g.lineWidth = 1.8;
          g.beginPath(); g.moveTo(-13, -4); g.lineTo(11, -4); g.lineTo(14, 0); g.lineTo(9, 4); g.lineTo(-14, 4); g.closePath(); g.fill(); g.stroke();
        });

        // Boss 7: 🎵 曼波 (Uses the REAL viral 诗歌剧 "铸币大头照曼波" meme image textures!)
        MODELS.boss_manbo = makeSprite(144, 144, (g) => {
          g.translate(72, 72);
          g.fillStyle = '#a78bfa'; g.strokeStyle = '#0f172a'; g.lineWidth = 3;
          g.beginPath(); g.arc(0, 0, 56, 0, Math.PI * 2); g.fill(); g.stroke();
        });
        MODELS.boss_manbo_meme = makeSprite(144, 144, (g) => {
          g.translate(72, 72);
          g.fillStyle = '#fda4af'; g.strokeStyle = '#0f172a'; g.lineWidth = 3;
          g.beginPath(); g.arc(0, 0, 56, 0, Math.PI * 2); g.fill(); g.stroke();
        });
        const loadMemeSprite = (url, targetKey) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => {
            MODELS[targetKey] = makeSprite(148, 148, (g) => {
              g.drawImage(img, 6, 6, 136, 136);
            });
          };
          img.src = url;
        };
        loadMemeSprite('/assets/boss_manbo.png?v=4.2', 'boss_manbo');
        loadMemeSprite('/assets/boss_manbo_meme.png?v=4.2', 'boss_manbo_meme');

        MODELS.prop_shield = makeSprite(58, 58, (g) => {
          g.translate(29, 29);
          const sg = g.createLinearGradient(0, -22, 0, 22);
          sg.addColorStop(0, '#7dd3fc');
          sg.addColorStop(0.5, '#0284c7');
          sg.addColorStop(1, '#1d4ed8');
          g.fillStyle = sg;
          g.strokeStyle = '#0f172a';
          g.lineWidth = 2.8;
          g.beginPath();
          g.moveTo(0, -22);
          g.lineTo(19, -14);
          g.quadraticCurveTo(19, 10, 0, 23);
          g.quadraticCurveTo(-19, 10, -19, -14);
          g.closePath();
          g.fill();
          g.stroke();
          g.strokeStyle = '#fef08a';
          g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(0, -14);
          g.lineTo(11, -9);
          g.quadraticCurveTo(11, 5, 0, 14);
          g.quadraticCurveTo(-11, 5, -11, -9);
          g.closePath();
          g.stroke();
        });
      }
      buildAllSculptedAssets();

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
        c.save(); c.translate(x, y); c.rotate(angle);
        const grad = c.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
        grad.addColorStop(0, '#fdba74'); grad.addColorStop(0.55, '#f97316'); grad.addColorStop(1, '#9a3412');
        c.fillStyle = grad; c.strokeStyle = '#0f172a'; c.lineWidth = 2.5;
        c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
        if (r > 28) {
          c.fillStyle = '#1e293b';
          for (let i = 0; i < 10; i++) {
            const a = (i * Math.PI * 2) / 10;
            c.beginPath(); c.arc(Math.cos(a) * (r + 2), Math.sin(a) * (r + 2), 4, 0, Math.PI * 2); c.fill();
          }
        }
        c.strokeStyle = '#1e293b'; c.lineWidth = 1.8;
        c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, -r); c.lineTo(0, r); c.arc(-r * 0.7, 0, r * 0.7, -0.82, 0.82); c.stroke();
        c.fillStyle = '#fde047'; c.beginPath(); c.arc(0, 0, r * 0.22, 0, Math.PI * 2); c.fill(); c.stroke();
        c.restore();
      }

      // Unified Sculpted Hero + Bike Rig Renderer (Used in BOTH Main Game AND Live Garage Hub Preview!)
export function drawSculptedBikeAndHero(c, heroId, px, py, pAngle, wAngle, cAngle, jig, modsObj, opts = {}) {
        c.save();
        c.translate(px, py);
        c.rotate(pAngle);

        const totalScale = opts.scale || 1;
        if (totalScale !== 1) c.scale(totalScale, totalScale);

        const isMonster = opts.mountId === 'monster_truck';
        const isPlane = opts.mountId === 'biplane';
        const isRocket = opts.rocketDash;
        const wR = isMonster ? 35 : 23;
        const lift = isMonster ? 18 : 0;

        if (isRocket) {
          // Giant Starlight Dragon Booster Rocket strapped to Bike!
          drawModelOn(c, 'prop_rocket', -10, -45, 0.45, 2.2);
        }

        if (isPlane) {
          c.save(); c.translate(0, -36);
          c.fillStyle = '#ef4444'; c.strokeStyle = '#0f172a'; c.lineWidth = 2.6;
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

        // Far Leg
        const farLeg = solveIK(hipX, hipY, lp.x, lp.y, 22, 21, bendDir);
        c.strokeStyle = heroId === 'ikun' ? '#1e293b' : '#d97706';
        c.lineWidth = heroId === 'naiwa' ? 5 : 9;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(hipX, hipY); c.lineTo(farLeg.jx, farLeg.jy); c.lineTo(farLeg.fx, farLeg.fy); c.stroke();

        if (!opts.hideWheels && !isPlane) {
          drawSpaldingWheelOn(c, rearX, rearY, wR, wAngle);
          drawSpaldingWheelOn(c, frontX, frontY, wR, wAngle);
        }

        if (isMonster) {
          c.strokeStyle = '#fde047'; c.lineWidth = 5;
          c.beginPath(); c.moveTo(rearX, rearY); c.lineTo(seatX, seatY); c.moveTo(frontX, frontY); c.lineTo(headTopX, headTopY); c.stroke();
        }

        if (opts.hasSaw) {
          drawModelOn(c, 'riotSaw', frontX + 20, frontY - 4, wAngle * 2.4, 0.54);
        }

        // Diamond Frame
        c.strokeStyle = '#e11d48'; c.lineWidth = 5;
        c.beginPath();
        c.moveTo(rearX, rearY); c.lineTo(bbX, bbY); c.lineTo(seatX, seatY); c.lineTo(rearX, rearY);
        c.moveTo(bbX, bbY); c.lineTo(headBotX, headBotY); c.lineTo(headTopX, headTopY); c.lineTo(seatX + 1, seatY + 3);
        c.moveTo(headBotX, headBotY); c.quadraticCurveTo(33, -33 - lift * 0.5, frontX, frontY);
        c.stroke();
        c.strokeStyle = '#cbd5e1'; c.lineWidth = 3.8;
        c.beginPath(); c.moveTo(headTopX, headTopY); c.lineTo(22, -68 - lift); c.lineTo(handleX - 5, handleY); c.stroke();

        // Temporary Mortar Cat Prop on Rear Rack ONLY while mortarTimer > 0!
        if (opts.mortarActive) {
          drawModelOn(c, 'prop_mortar_cat', -46, -66 - lift + Math.sin(performance.now() * 0.02) * 3, 0, 0.72);
        }

        // Front Basket + Temporary Magnet / Mounted Weapons ONLY while active!
        c.save(); c.translate(36, -59 - lift);
        if (opts.magnetActive) {
          drawModelOn(c, 'prop_magnet', 18, 0, 1.57, 0.55);
        }
        drawModelOn(c, 'nailong_head', 0, -11, 0, 0.34);
        c.fillStyle = '#d97706'; c.strokeStyle = '#0f172a'; c.lineWidth = 2;
        c.beginPath(); c.roundRect(-11, -3, 22, 14, 3); c.fill(); c.stroke();
        if (opts.weaponId === 'gatling') drawModelOn(c, 'gatlingGun', 18, -8, 0, 0.95);
        else if (opts.weaponId === 'bazooka') drawModelOn(c, 'bazookaGun', 12, -16, -0.12, 0.95);
        c.restore();

        // Near Leg + SCULPTED 2.5D MAIN RIDER!
        const nLeg = solveIK(hipX + 2, hipY, rp.x, rp.y, 22, 21, bendDir);
        const legCol = heroId === 'ikun' ? '#1e293b' : (heroId === 'nailong' ? '#facc15' : '#eab308');
        c.strokeStyle = legCol;
        c.lineWidth = heroId === 'nailong' ? 11 : (heroId === 'naiwa' ? 5 : 9);
        c.beginPath(); c.moveTo(hipX + 2, hipY); c.lineTo(nLeg.jx, nLeg.jy); c.lineTo(nLeg.fx, nLeg.fy); c.stroke();

        if (heroId === 'nailong') {
          drawModelOn(c, 'nailong_torso', -14, -72 - lift + jig * 0.3, 0, 0.96);
          drawModelOn(c, 'nailong_head', -6, -109 - lift + jig * 0.42, Math.sin(performance.now() * 0.008) * 0.04, 0.94);
          // Chubby Dragon Arm gripping Handlebar
          c.strokeStyle = '#292524'; c.lineWidth = 13;
          c.beginPath(); c.moveTo(-4, -80 - lift); c.lineTo(handleX, handleY); c.stroke();
          c.strokeStyle = '#facc15'; c.lineWidth = 9; c.stroke();
        } else if (heroId === 'ikun') {
          drawModelOn(c, 'ikun_torso', -14, -77 - lift + jig * 0.25, 0, 0.96);
          drawModelOn(c, 'ikun_head', -10, -113 - lift + jig * 0.35, 0, 0.96);
          c.strokeStyle = '#1e293b'; c.lineWidth = 8.5;
          c.beginPath(); c.moveTo(-6, -86 - lift); c.quadraticCurveTo(5, -76 - lift, handleX, handleY); c.stroke();
        } else if (heroId === 'pelican') {
          drawModelOn(c, 'pelican_rig', -4, -88 - lift + jig * 0.3, 0, 0.94);
        } else if (heroId === 'naiwa') {
          drawModelOn(c, 'naiwa_rig', -8, -92 - lift + jig * 0.38, 0, 0.94);
          c.strokeStyle = '#eab308'; c.lineWidth = 5;
          c.beginPath(); c.moveTo(-2, -80 - lift); c.lineTo(handleX, handleY); c.stroke();
        } else {
          drawModelOn(c, 'hakimi_rig', -8, -90 - lift + jig * 0.3, 0, 0.96);
          c.strokeStyle = '#fb923c'; c.lineWidth = 8.5;
          c.beginPath(); c.moveTo(-4, -78 - lift); c.lineTo(handleX, handleY); c.stroke();
        }

        if (opts.striking) {
          c.strokeStyle = '#fde047'; c.lineWidth = 6.5;
          c.beginPath(); c.arc(18, -60 - lift, 58, -0.8, 0.8); c.stroke();
        }

        c.restore();
      }
