/* Phase 3 sprite layer: baked atlases, hero body + single separate sword (state machine), enemy clips.
   Right-facing frames are separately drawn art (anatomically turned), never a mirrored copy.
   Visual only: reads game state, never writes gameplay values. */
window.BailuSprites = (() => {
  const A = (window.BAILU_ATLAS || {}).atlases || {};
  const imgs = {}, frameCache = new Map();
  for (const [n, at] of Object.entries(A)) { const i = new Image(); i.decoding = 'async'; i.src = at.file; imgs[n] = i; }
  const ok = n => imgs[n] && imgs[n].complete && imgs[n].naturalWidth > 0;
  const fr = (n, k) => A[n] && A[n].frames[k];
  /* Per-frame canvas (cached) so existing tint helpers (red hit flash) keep working on a single frame. */
  function frameCanvas(n, k) {
    const id = n + '/' + k; let c = frameCache.get(id); if (c) return c;
    const f = fr(n, k); if (!f || !ok(n)) return null;
    c = document.createElement('canvas'); c.width = f.r[2]; c.height = f.r[3];
    c.getContext('2d').drawImage(imgs[n], f.r[0], f.r[1], f.r[2], f.r[3], 0, 0, f.r[2], f.r[3]);
    c._anchor = f.a; frameCache.set(id, c); return c;
  }
  function blit(g, n, k, s) {
    const c = frameCanvas(n, k); if (!c) return null;
    g.drawImage(c, -c._anchor[0] * s, -c._anchor[1] * s, c.width * s, c.height * s); return c;
  }
  const pick = (opts) => { for (const [n, k] of opts) if (fr(n, k) && ok(n)) return [n, k]; return null; };
  const ready = () => ok('hero') && ok('enemies') && ok('sword');

  /* ------------------------------------------------------------ hero */
  const HERO_STAND_DISPLAY = 99;                 // matches the original on-screen standing height
  const heroScale = () => HERO_STAND_DISPLAY / ((window.BAILU_ATLAS.meta.hero || {}).stand_px || 210);
  const loco = { t: 0, was: false, lift: 0 };
  const CYCLE = { walk: 2.0, takeoff: 0.18, fly: 1.3, land: 0.2 };   // animation_plan.json move cycle
  function locomotion(p, dt) {
    if (p.moving && p.spd01 > 0.15) { loco.t += dt; loco.was = true; }
    else { loco.t = 0; loco.was = false; }
    const T = CYCLE.walk + CYCLE.takeoff + CYCLE.fly + CYCLE.land;
    const t = loco.t % T; let clip, u;
    if (t < CYCLE.walk) { clip = 'walk'; u = t / CYCLE.walk; }
    else if (t < CYCLE.walk + CYCLE.takeoff) { clip = 'takeoff'; u = (t - CYCLE.walk) / CYCLE.takeoff; }
    else if (t < CYCLE.walk + CYCLE.takeoff + CYCLE.fly) { clip = 'fly'; u = (t - CYCLE.walk - CYCLE.takeoff) / CYCLE.fly; }
    else { clip = 'land'; u = (t - CYCLE.walk - CYCLE.takeoff - CYCLE.fly) / CYCLE.land; }
    let liftT = 0;
    if (clip === 'takeoff') liftT = u * 20; else if (clip === 'fly') liftT = 20 + Math.sin(u * Math.PI * 4) * 3; else if (clip === 'land') liftT = (1 - u) * 20;
    loco.lift += (liftT - loco.lift) * Math.min(1, dt * 18);
    return { clip, u };
  }
  let lastNow = 0;
  /* Sword state machine (weapon_state_machine.json): HOVER_NORMAL, REMOTE_SLASH, RETURN_HOVER,
     DASH_SUMMON/RIGHT_HAND_CATCH/DASH_CUT/RELEASE (baked into the 8 dash frames -> separate sword hidden), DEFEAT. */
  const sword = { state: 'HOVER_NORMAL', x: 0, y: 0, a: -Math.PI / 2, t: 0, from: null, init: false };
  function hoverPose(p, side, now) {
    const b = Math.sin(now * 2.4) * 4;
    return { x: p.x + (side > 0 ? -30 : 30), y: p.y - 112 + b - loco.lift, a: -Math.PI / 2 + side * 0.22 + Math.sin(now * 1.7) * 0.06 };
  }
  function heroPose(p, now, dt, consts) {
    const side = Math.cos(p.facing) > 0 ? 1 : -1;
    const L = side > 0 ? 'hero_r' : 'hero';
    const sfx = side > 0 ? 'R' : '';
    let frame = null, swordHidden = false, swordPose = null;
    const hov = hoverPose(p, side, now);
    if (p.atkT > 0 && p.atkKind === 'R') {
      const total = consts.ATK_R_DUR + consts.SWORD_BACK_DUR, t = total - p.atkT;
      if (t < consts.ATK_R_DUR) {
        const i = Math.min(7, Math.floor(t / consts.ATK_R_DUR * 8));
        frame = pick(side > 0 && i >= 2 && i <= 5 ? [['hero_r', 'dashR' + i], ['hero', 'dash' + i]] : [['hero', 'dash' + i]]);
        swordHidden = true; sword.state = i < 2 ? 'DASH_SUMMON' : i < 3 ? 'RIGHT_HAND_CATCH' : i < 6 ? 'DASH_CUT' : 'RELEASE';
        sword.from = { x: p.x + side * 46, y: p.y - 60, a: p.facing };
      } else {
        const u = (t - consts.ATK_R_DUR) / consts.SWORD_BACK_DUR, e = 1 - Math.pow(1 - u, 3);
        const f = sword.from || hov; sword.state = 'RETURN_HOVER';
        swordPose = { x: f.x + (hov.x - f.x) * e, y: f.y + (hov.y - f.y) * e - Math.sin(u * Math.PI) * 30, a: f.a + (hov.a - f.a) * e + (1 - e) * side * 2 * Math.PI };
        frame = pick([['hero', 'idle' + (Math.floor(now * 4) % 4)]]);
      }
    } else if (p.atkT > 0) {
      const t = consts.ATK_L_DUR - p.atkT, u = Math.max(0, Math.min(1, t / consts.ATK_L_DUR));
      frame = pick([['hero', 'castR' + Math.min(3, Math.floor(u * 4))]]);
      sword.state = 'REMOTE_SLASH';
      /* curved swing: sword leaves hover, sweeps an arc across the facing direction, tip leading */
      const dir = p.atkDir || 1, sweep = 1.5, a0 = p.facing - dir * sweep / 2;
      const e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const th = a0 + dir * sweep * e, r = 62 + Math.sin(u * Math.PI) * 30;
      const arc = { x: p.x + Math.cos(th) * r, y: p.y - 40 + Math.sin(th) * r * .62, a: th + dir * 0.9 };
      const k = u < .18 ? u / .18 : u > .82 ? (1 - u) / .18 : 1;
      swordPose = { x: hov.x + (arc.x - hov.x) * k, y: hov.y + (arc.y - hov.y) * k, a: k > .5 ? arc.a : hov.a + (arc.a - hov.a) * k };
      sword.from = swordPose;
    } else if (p.hp <= 0) {
      frame = pick([['hero', 'defeat3']]); sword.state = 'DEFEAT';
      swordPose = { x: p.x + side * 40, y: p.y - 6, a: side > 0 ? 0.12 : Math.PI - 0.12 };
    } else {
      const m = (p.moving && p.spd01 > 0.15) ? locomotion(p, dt) : (locomotion(p, dt), null);
      if (m) {
        const n = m.clip === 'walk' ? Math.floor(loco.t * (3.5 + p.spd01 * 4)) % 4 : Math.min(3, Math.floor(m.u * 4)) % 4;
        const nn = m.clip === 'fly' ? Math.floor(loco.t * 8) % 4 : n;
        frame = pick([[L, m.clip + sfx + nn], ['hero', m.clip + nn]]);
      } else frame = pick([['hero', 'idle' + (Math.floor(now * 4) % 4)]]);
      if (sword.state === 'REMOTE_SLASH') { sword.state = 'RETURN_HOVER'; sword.t = 0; }
    }
    if (p.atkT <= 0 && p.hp > 0) {
      if (sword.state === 'RETURN_HOVER' && sword.from && sword.t < .18) {
        sword.t += dt; const e = Math.min(1, sword.t / .18); const f = sword.from;
        swordPose = { x: f.x + (hov.x - f.x) * e, y: f.y + (hov.y - f.y) * e, a: f.a + (hov.a - f.a) * e };
      } else { sword.state = 'HOVER_NORMAL'; swordPose = hov; }
    }
    if (!(p.atkT > 0)) loco.lift *= (p.moving ? 1 : Math.max(0, 1 - dt * 10));
    if (swordPose) Object.assign(sword, swordPose);
    return { frame, side, swordHidden, lift: loco.lift };
  }
  function drawSword(g, alpha) {
    const s = 0.23; g.save(); g.translate(sword.x, sword.y); g.rotate(sword.a + Math.PI / 2);
    g.globalAlpha *= alpha; blit(g, 'sword', 'sword', s); g.restore();
  }
  /* returns false when atlases are not ready so the original renderer keeps drawing */
  function drawHero(g, p, opts) {
    if (!ready()) return false;
    const now = performance.now() / 1000, dt = Math.min(.05, lastNow ? now - lastNow : .016); lastNow = now;
    const pose = heroPose(p, now, dt, opts);
    if (!pose.frame) return false;
    trackTip(now);
    const s = heroScale();
    /* ground shadow stays on the floor while flying (flight is visual only) */
    g.save(); g.translate(p.x, p.y + 4); g.fillStyle = 'rgba(0,0,0,.2)';
    const sh = 1 - Math.min(.45, pose.lift / 45);
    g.beginPath(); g.ellipse(0, 0, 24 * sh, 6 * sh, 0, 0, Math.PI * 2); g.fill(); g.restore();
    const swordBehind = !pose.swordHidden && sword.state === 'HOVER_NORMAL';
    if (swordBehind) drawSword(g, 1);
    g.save(); g.translate(p.x, p.y - pose.lift + (opts.bob || 0)); g.rotate(p.lean || 0);
    if (opts.invuln) g.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(performance.now() * 0.028));
    const c = blit(g, pose.frame[0], pose.frame[1], s);
    if (c && p.hitRedT > 0 && window.EgretCombatFeedback) {
      g.globalAlpha = .67 * Math.min(1, p.hitRedT / .045);
      g.drawImage(EgretCombatFeedback.redSprite(c), -c._anchor[0] * s, -c._anchor[1] * s, c.width * s, c.height * s);
    }
    g.restore();
    drawTrail(g, now);
    if (!pose.swordHidden && !swordBehind) drawSword(g, 1);
    return true;
  }
  /* dash afterimage: a translucent copy of a dash frame for the travel side (no flipping) */
  function drawAfterimage(g, a) {
    if (!ready()) return false;
    const right = a.flip, f = pick(right ? [['hero_r', 'dashR3'], ['hero', 'dash1']] : [['hero', 'dash3']]);
    if (!f) return false;
    g.save(); g.translate(a.x, a.y); g.globalAlpha = 0.35 * (a.t / a.dur); blit(g, f[0], f[1], heroScale()); g.restore(); return true;
  }

  /* ------------------------------------------------------------ enemies */
  const EN_STAND = ((window.BAILU_ATLAS.meta || {}).enemies || {}).stand_px || 170;
  const COLORS = ['blue', 'red', 'green', 'purple', 'yellow'];
  function enemyFrame(e, playerX) {
    if (e.faceR == null) e.faceR = playerX > e.x;
    if (playerX > e.x + 10) e.faceR = true; else if (playerX < e.x - 10) e.faceR = false;   // hysteresis: no flicker
    const col = e.key || COLORS[e.skin] || 'blue';
    let clip, i;
    if (e.hitRedT > 0 || e.knockT > 0) { clip = 'hurt'; i = Math.min(3, Math.floor((e.animT * 10) % 4)); }
    else if (e.state === 'walk') { clip = 'walk'; i = Math.floor((e.walkPhase || 0) * 4) % 4; }
    else if (e.state === 'charge') { clip = 'skill'; i = Math.floor(e.animT * 8) % 3; }
    else if (e.state === 'dash') { clip = 'skill'; i = 3 + Math.floor(e.animT * 12) % 3; }
    else { clip = 'skill'; i = 5 + Math.floor(e.animT * 10) % 3; }
    const R = e.faceR;
    return pick(R ? [['enemies_r', `${col}_${clip}R${i}`], ['enemies', `${col}_${clip}${i}`]] : [['enemies', `${col}_${clip}${i}`]]);
  }
  /* display size derived from the original sprite metrics (w = r*3.1, body = 1.256 w, feet 0.08 h below e.y) */
  const enemyScale = e => (e.r * 3.1 * 1.256) / EN_STAND;
  const enemyFeet = e => e.r * 3.1 * (300 / 215) * 0.08;
  function drawEnemy(g, e, playerX, alpha) {
    if (!ready()) return null;
    const f = enemyFrame(e, playerX); if (!f) return null;
    const s = enemyScale(e);
    g.save(); g.translate(0, enemyFeet(e)); g.globalAlpha = alpha;
    const c = blit(g, f[0], f[1], s);
    if (c && e.hitRedT > 0 && window.EgretCombatFeedback) {
      g.globalAlpha = alpha * .72 * Math.min(1, e.hitRedT / .045);
      g.drawImage(EgretCombatFeedback.redSprite(c), -c._anchor[0] * s, -c._anchor[1] * s, c.width * s, c.height * s);
    }
    g.restore();
    return { h: (c ? c._anchor[1] : EN_STAND) * s, w: e.r * 3.1 };
  }
  /* death fall (visual only): 4 fall frames then fade, at the kill position */
  const falls = [];
  function addFall(e, playerX) {
    if (!ready()) return;
    const col = e.key || COLORS[e.skin] || 'blue';
    falls.push({ x: e.x, y: e.y, col, R: playerX > e.x, s: enemyScale(e), feet: enemyFeet(e), t: 0 });
    if (falls.length > 24) falls.shift();
  }
  function drawFalls(g, dt) {
    for (let i = falls.length - 1; i >= 0; i--) {
      const f = falls[i]; f.t += dt; if (f.t > 1.1) { falls.splice(i, 1); continue; }
      const n = Math.min(3, Math.floor(f.t / .11));
      const p = pick(f.R ? [['enemies_r', `${f.col}_fallR${n}`], ['enemies', `${f.col}_fall${n}`]] : [['enemies', `${f.col}_fall${n}`]]);
      if (!p) continue;
      g.save(); g.translate(f.x, f.y + f.feet); g.globalAlpha = f.t < .7 ? 1 : Math.max(0, 1 - (f.t - .7) / .4);
      blit(g, p[0], p[1], f.s); g.restore();
    }
  }
  function clearFalls() { falls.length = 0; }

  /* ------------------------------------------------------------ feedback: ice-cyan sword trail, hit-stop, shake, glyph numbers */
  const reducedQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const prefs = { reduced: () => reducedQ.matches || localStorage.getItem('bailu_reduced_motion') === '1' };
  const trail = [];
  function trackTip(now) {
    const active = sword.state === 'REMOTE_SLASH' || (sword.state === 'RETURN_HOVER' && sword.t < .12);
    if (active) { const L = 62; trail.push({ x: sword.x + Math.cos(sword.a) * L, y: sword.y + Math.sin(sword.a) * L, bx: sword.x + Math.cos(sword.a) * 20, by: sword.y + Math.sin(sword.a) * 20, t: now }); }
    const keep = prefs.reduced() ? .08 : .16;
    while (trail.length && now - trail[0].t > keep) trail.shift();
  }
  function drawTrail(g, now) {
    if (trail.length < 3) return;
    const keep = prefs.reduced() ? .08 : .16;
    g.save();
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i], k = 1 - (now - b.t) / keep;
      if (k <= 0) continue;
      g.globalAlpha = .62 * k;
      g.fillStyle = k > .7 ? '#bdf3fb' : k > .35 ? '#5cc8e2' : '#2a8fb2';
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b.bx, b.by); g.lineTo(a.bx, a.by); g.closePath(); g.fill();
    }
    g.globalAlpha = .85; g.strokeStyle = '#effdff'; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath(); trail.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
    g.restore();
  }
  const fb = { holdUntil: 0, shakeT: 0, shakeA: 0, shakeDur: .12 };
  function onHit(isCrit) {
    if (prefs.reduced()) return;
    const now = performance.now();
    fb.holdUntil = Math.max(fb.holdUntil, now + (isCrit ? 55 : 38));
    fb.shakeA = Math.max(fb.shakeA * (fb.shakeT > 0 ? 1 : 0), isCrit ? 4 : 2); fb.shakeT = fb.shakeDur;
  }
  function onHurt() { if (prefs.reduced()) return; fb.shakeA = Math.max(fb.shakeA, 3); fb.shakeT = fb.shakeDur; }
  const holding = () => performance.now() < fb.holdUntil;
  let shakeLast = 0;
  function shakeOffset() {
    const now = performance.now() / 1000, dt = Math.min(.05, shakeLast ? now - shakeLast : 0); shakeLast = now;
    if (fb.shakeT <= 0) return [0, 0];
    fb.shakeT -= dt; const k = Math.max(0, fb.shakeT / fb.shakeDur) * fb.shakeA;
    return [Math.round(Math.sin(now * 91) * k), Math.round(Math.cos(now * 77) * k * .6)];
  }
  /* damage numbers composed from the glyph atlas using the real rounded value carried by floatText */
  const TAGS = { '蓝不够！': 'tag_low_mana', '最 后 一 击': 'tag_last_hit', 'BOSS 击 破': 'tag_boss_down' };
  const SEQ = { hit: .52, crit: .68, hurt: .56, heal: .62 };
  function classify(text) {
    let m;
    if (TAGS[text]) return { tag: TAGS[text] };
    if ((m = /^暴击 (\d+)$/.exec(text))) return { style: 'crit', s: m[1], tag: 'tag_critical' };
    if (/^\d+$/.test(text)) return { style: 'hit', s: text };
    if ((m = /^-(\d+)$/.exec(text))) return { style: 'hurt', s: '−' + m[1] };
    if ((m = /^\+(\d+)$/.exec(text))) return { style: 'heal', s: '+' + m[1] };
    return null;
  }
  function drawFloat(g, f) {
    if (!ok('glyphs')) return false;
    const c = f._c === undefined ? (f._c = classify(f.text)) : f._c;
    if (!c) return false;
    const age = 0.8 - f.t, life = c.style ? SEQ[c.style] : .8;
    const u = Math.min(1, age / life);
    const pop = prefs.reduced() ? 1 : (age < .09 ? 1.35 - age / .09 * .35 : 1);
    const alpha = u < .65 ? 1 : Math.max(0, 1 - (u - .65) / .35);
    if (alpha <= 0) return true;
    g.save(); g.translate(f.x, f.y - (prefs.reduced() ? 0 : u * 10)); g.globalAlpha = alpha;
    if (c.style) {
      const sc = (c.style === 'crit' ? .34 : .26) * pop;
      let w = 0; const fs = [];
      for (const ch of c.s) { const q = fr('glyphs', c.style + '_' + ch); if (q) { fs.push([ch, q]); w += q.adv; } }
      let x = -w * sc / 2;
      for (const [ch, q] of fs) { const cv = frameCanvas('glyphs', c.style + '_' + ch); if (cv) g.drawImage(cv, x, -q.a[1] * sc, cv.width * sc, cv.height * sc); x += q.adv * sc; }
      if (c.tag) { const cv = frameCanvas('glyphs', c.tag); if (cv) { const ts = .32; g.drawImage(cv, -cv.width * ts / 2, -86 * sc - cv.height * ts - 2, cv.width * ts, cv.height * ts); } }
    } else {
      const cv = frameCanvas('glyphs', c.tag); if (cv) { const ts = .4 * pop; g.drawImage(cv, -cv.width * ts / 2, -cv.height * ts / 2, cv.width * ts, cv.height * ts); }
    }
    g.restore(); return true;
  }
  return { onHit, onHurt, holding, shakeOffset, drawFloat, prefs, ready, drawHero, drawAfterimage, drawEnemy, addFall, drawFalls, clearFalls, frameCanvas, sword, imgs };
})();