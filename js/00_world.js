/* Phase 1 world layer: continuous 3840x1280 map, follow camera, walkable polygon + blockers,
   zone gates and wave spawn points. Pure helpers; the game loop calls them. No gameplay values change. */
window.BailuWorld = (() => {
  const VW = 1280, VH = 640;
  const cam = { x: 0, y: 0 };
  let L = null, waveIdx = 0, armed = false, img = null, imgLv = 0;
  const imgs = {};
  const inPoly = (x, y, p) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  function level(lv) { return (window.BAILU_MAPS || [])[lv - 1] || null; }
  function preload(lv) {
    const d = level(lv); if (!d || imgs[lv]) return imgs[lv];
    const i = new Image(); i.decoding = 'async'; i.src = d.art; imgs[lv] = i; return i;
  }
  function load(lv) {
    L = level(lv); waveIdx = 0; armed = false; img = L ? preload(lv) : null; imgLv = lv;
    if (L) preload(lv + 1);
    return L;
  }
  const active = () => !!L;
  const wave = () => (L && L.waves[Math.min(waveIdx, L.waves.length - 1)]) || null;
  /* x span the player may use: everything up to the end of the current wave's zone. */
  function maxX() { const w = wave(); return w ? L.zones[w.zone - 1][1] : 1e9; }
  function walkable(x, y, r = 0) {
    if (!L) return true;
    if (x > maxX()) return false;
    const pts = r ? [[x, y], [x - r, y], [x + r, y], [x, y - r * .5], [x, y + r * .5]] : [[x, y]];
    for (const [px, py] of pts) {
      if (!inPoly(px, py, L.poly)) return false;
      for (const b of L.blockers) if (inPoly(px, py, b)) return false;
    }
    return true;
  }
  /* Axis-separated slide so the body glides along walls instead of sticking. */
  function move(ox, oy, nx, ny, r = 0) {
    if (!L) return [nx, ny];
    if (walkable(nx, ny, r)) return [nx, ny];
    if (walkable(nx, oy, r)) return [nx, oy];
    if (walkable(ox, ny, r)) return [ox, ny];
    if (!walkable(ox, oy, r)) return nearest(ox, oy, r);
    return [ox, oy];
  }
  /* Last walkable point along a straight segment (dash targets, enemy lunges). */
  function along(ox, oy, nx, ny, r = 0) {
    if (!L || walkable(nx, ny, r)) return [nx, ny];
    let bx = ox, by = oy;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24, x = ox + (nx - ox) * t, y = oy + (ny - oy) * t;
      if (walkable(x, y, r)) { bx = x; by = y; } else break;
    }
    return [bx, by];
  }
  function laneY(x) {
    const ys = [], p = L.poly;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((xi <= x) !== (xj <= x)) ys.push(yi + (yj - yi) * (x - xi) / (xj - xi));
    }
    ys.sort((a, b) => a - b);
    return ys.length >= 2 ? [ys[0], ys[ys.length - 1]] : null;
  }
  function nearest(x, y, r = 0) {
    if (!L) return [x, y];
    const cx = Math.max(L.poly.reduce((a, q) => Math.min(a, q[0]), 1e9) + r + 2, Math.min(maxX() - r - 2, x));
    const ly = laneY(cx); if (!ly) return [x, y];
    let ny = Math.max(ly[0] + r + 2, Math.min(ly[1] - r - 2, y));
    for (let k = 0; k < 40 && !walkable(cx, ny, r); k++) ny += (k % 2 ? 1 : -1) * k * 6;
    return [cx, ny];
  }
  function startWave(n) { waveIdx = Math.max(0, n - 1); armed = false; }
  /* A wave only starts spawning once the hero passes its gate line. */
  function updateArm(px) { const w = wave(); if (w && !armed && px >= w.gate) armed = true; return armed; }
  const isArmed = () => !L || armed;
  function spawnPoint(r = 20) {
    const w = wave(); if (!w) return null;
    const [z0, z1] = L.zones[w.zone - 1];
    const edges = [];
    const right = cam.x + VW + 40 + Math.random() * 40, left = cam.x - 40 - Math.random() * 40;
    if (right < z1) edges.push(right);
    if (left > z0) edges.push(left);
    for (let k = 0; k < 6 && edges.length; k++) {
      const x = edges[Math.floor(Math.random() * edges.length)], ly = laneY(x);
      if (!ly) continue;
      const y = ly[0] + r + Math.random() * (ly[1] - ly[0] - 2 * r);
      if (walkable(x, y, r)) return [x, y];
    }
    for (let k = 0; k < 8; k++) {
      const c = w.spawn[Math.floor(Math.random() * w.spawn.length)];
      const x = c[0] + (Math.random() - .5) * 80, y = c[1] + (Math.random() - .5) * 60;
      if (walkable(x, y, r)) return [x, y];
    }
    return w.spawn[1].slice();
  }
  function follow(px, py, dt, snap) {
    if (!L) { cam.x = 0; cam.y = 0; return cam; }
    const [ww, wh] = L.world;
    const tx = Math.max(0, Math.min(ww - VW, px - VW * .45)), ty = Math.max(0, Math.min(wh - VH, py - VH * .55));
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    cam.x = Math.round(cam.x * 2) / 2; cam.y = Math.round(cam.y * 2) / 2;
    return cam;
  }
  /* Draw only the visible slice of the panorama; UV stays locked to world geometry. */
  function drawGround(g, night, cx = cam.x, cy = cam.y) {
    if (!L || !img || !img.complete || !img.naturalWidth) return false;
    const src = night ? nightTex(night) : img;
    const s = L.tex[0] / L.world[0];
    g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const m = 8, x0 = Math.max(0, cx - m), y0 = Math.max(0, cy - m), w = Math.min(L.world[0] - x0, VW + 2 * m), h = Math.min(L.world[1] - y0, VH + 2 * m);
    g.drawImage(src, x0 * s, y0 * s, w * s, h * s, x0, y0, w, h);
    g.restore(); return true;
  }
  const nightCache = new Map();
  function nightTex(fn) {
    if (nightCache.has(img)) return nightCache.get(img);
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0); const n = fn(c); nightCache.set(img, n); return n;
  }
  function gateHint() {
    const w = wave(); return w && !armed ? w.gate : null;
  }
  return { cam, VW, VH, load, active, level: () => L, wave, startWave, updateArm, isArmed, walkable, move, along, nearest,
    spawnPoint, follow, drawGround, gateHint, maxX, laneY, inPoly, waveIndex: () => waveIdx };
})();