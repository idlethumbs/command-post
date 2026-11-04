/* Arcanum art: everything is painted procedurally at low resolution, then upscaled with hard pixels. */
// Shared vocabulary. Keep in sync with src/realms.ts (LANDMARKS, BANNERS).
export const BANNERS = ["#ef5470", "#74e0f7", "#f2c14e", "#b884f0", "#7fd18a", "#ff9a3c", "#f0e4c4"];
export const LANDMARKS = {
  castle: { label: "Castle", biome: "meadow" }, tower: { label: "Tower", biome: "highland" }, grove: { label: "Grove", biome: "forest" },
  cavern: { label: "Cavern", biome: "crystal" }, volcano: { label: "Volcano", biome: "ash" }, pyramid: { label: "Pyramid", biome: "desert" },
  spire: { label: "Spire", biome: "snow" }, village: { label: "Village", biome: "meadow" },
};
export const RANK = {
  haiku: { title: "Apprentice", model: "Haiku" }, sonnet: { title: "Magician", model: "Sonnet" },
  opus: { title: "Sorcerer", model: "Opus" }, fable: { title: "Archmage", model: "Fable" },
};
export const STATE = {
  counsel: { label: "Seeks counsel", chip: "COUNSEL", cls: "counsel", glyph: "!", verb: "seeks counsel" },
  seal: { label: "Awaits your seal", chip: "SEAL?", cls: "seal", glyph: "?", verb: "awaits your seal" },
  cast: { label: "Casting", chip: "CASTING", cls: "cast", glyph: "✦", verb: "is casting" },
  rest: { label: "Meditating", chip: "RESTING", cls: "rest", glyph: "z", verb: "is meditating" },
};

/* ===================== colour + noise helpers ===================== */
export const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = a => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
export const shade = (h, t) => css(mix(hex(h), [0, 0, 0], t));
export const tint = (h, t) => css(mix(hex(h), [255, 255, 255], t));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - .5);
export function dramp(ramp, t, x, y, k = 1) { const n = ramp.length - 1; return ramp[clamp(Math.round(clamp(t, 0, 1) * n + BAYER[(y & 3) * 4 + (x & 3)] * k), 0, n)]; }
export function hash(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function noise(x, y, s) {
  const xi = Math.floor(x / s), yi = Math.floor(y / s), fx = x / s - xi, fy = y / s - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, y) => noise(x, y, 26) * .5 + noise(x + 17, y, 13) * .26 + noise(x, y + 31, 6) * .16 + noise(x + 5, y + 9, 3) * .08;
export const off = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export const lg = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); return g; };
export const rg = (c, x, y, r0, r1, stops) => { const g = c.createRadialGradient(x, y, r0, x, y, r1); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); return g; };
export const poly = (c, pts) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); };
export const ell = (c, x, y, rx, ry) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
export function star(c, x, y, s, col) { c.fillStyle = col; c.fillRect(x - s, y - .5, s * 2, 1); c.fillRect(x - .5, y - s, 1, s * 2); }

/* draw at native resolution, outline, then upscale with hard pixels: painted-VGA look */
export const INK = "#0f0c1e";
export function renderSprite(display, w, h, scale, draw) {
  const o = off(w, h); draw(o.getContext("2d"));
  const s = off(w + 2, h + 2), sc = s.getContext("2d");
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) sc.drawImage(o, dx, dy);
  sc.globalCompositeOperation = "source-in"; sc.fillStyle = "rgba(15,12,30,.9)"; sc.fillRect(0, 0, w + 2, h + 2);
  if (display.width !== (w + 2) * scale) { display.width = (w + 2) * scale; display.height = (h + 2) * scale; }
  const ctx = display.getContext("2d"); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, display.width, display.height);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(s, 0, 0, (w + 2) * scale, (h + 2) * scale); ctx.drawImage(o, scale, scale, w * scale, h * scale);
}

/* ===================== mages (38×54 native) ===================== */
export const SKIN = ["#fbe0b4", "#d9a06a"];
export const WOOD = "#7a5530", WOOD_HI = "#a8804e";
export const ROBES = {
  haiku:  { light: "#bfae8a", robe: "#8f7d5a", shade: "#584a33", gem: "#ffe9a8" },
  sonnet: { light: "#7d97f2", robe: "#3b5bdb", shade: "#20348a", gem: "#74e0f7", hat: true, band: "#f2c14e" },
  opus:   { light: "#ad80de", robe: "#6b3fa0", shade: "#3c1f63", gem: "#ff7be5", hat: true, stars: true, trim: "#f2c14e" },
  fable:  { light: "#ffffff", robe: "#dcd6ea", shade: "#968cb4", gem: "#7ff0ff", hat: true, beard: true, trim: "#7ff0ff" },
};
export function drawMage(c, model, st, f) {
  const r = ROBES[model], rest = st === "rest";
  c.translate(1, 4);
  c.fillStyle = "rgba(0,0,0,.34)"; ell(c, 18, 47, 11, 2.2); c.fill();
  const bob = rest ? 2 : st === "cast" ? 0 : (f % 2);
  c.translate(0, bob);
  const top = st === "counsel" ? (f % 2 ? 0 : 3) : rest ? 9 : 6;
  // robe
  const hem = rest ? 44 : 46;
  c.beginPath(); c.moveTo(13, 22); c.lineTo(23, 22); c.quadraticCurveTo(26, 32, 30, hem); c.quadraticCurveTo(18, hem + 3, 6, hem); c.quadraticCurveTo(10, 32, 13, 22); c.closePath();
  c.fillStyle = lg(c, 6, 0, 30, 0, [r.light, r.robe, r.shade]); c.fill();
  c.strokeStyle = r.shade; c.globalAlpha = .55; c.lineWidth = 1;
  c.beginPath(); c.moveTo(16, 27); c.quadraticCurveTo(14, 38, 13, hem); c.moveTo(22, 28); c.quadraticCurveTo(24, 38, 25, hem - 1); c.stroke(); c.globalAlpha = 1;
  if (r.trim) { c.strokeStyle = r.trim; c.lineWidth = 1.3; c.beginPath(); c.moveTo(18, 23); c.lineTo(18, hem + 1); c.stroke(); c.beginPath(); c.moveTo(7, hem - .5); c.quadraticCurveTo(18, hem + 2.5, 29, hem - .5); c.stroke(); }
  c.fillStyle = r.trim || r.shade; c.fillRect(11, 31, 14, 1.6);
  // left arm
  if (st === "seal") {
    c.fillStyle = lg(c, 4, 0, 14, 0, [r.robe, r.shade]); poly(c, [[13, 23], [5, 29], [8, 33], [15, 28]]); c.fill();
    c.fillStyle = "#f3e6c4"; c.fillRect(-1, 26, 7, 10); c.fillStyle = "#c9b48a"; c.fillRect(-1, 26, 7, 1.3); c.fillRect(-1, 34.7, 7, 1.3);
    c.fillStyle = "#8a6a3a"; c.fillRect(0, 29, 5, .7); c.fillRect(0, 31, 4, .7);
    c.fillStyle = "#c0392b"; ell(c, 2.5, 37, 1.8, 1.8); c.fill();
    c.fillStyle = rg(c, 7, 31, 0, 2, SKIN); ell(c, 7, 31.5, 1.7, 1.7); c.fill();
  } else if (!rest) {
    c.fillStyle = lg(c, 9, 0, 15, 0, [r.light, r.shade]); poly(c, [[13, 23], [9.5, 36], [14, 37], [15.5, 26]]); c.fill();
    c.fillStyle = rg(c, 11.5, 37.5, 0, 2, SKIN); ell(c, 11.8, 37.8, 1.8, 1.8); c.fill();
  } else { c.fillStyle = r.shade; ell(c, 18, 32, 5.5, 2.2); c.fill(); c.fillStyle = SKIN[1]; ell(c, 18, 31.5, 2, 1.2); c.fill(); }
  // hood (behind head)
  if (!r.hat) { c.fillStyle = lg(c, 11, 0, 25, 0, [r.light, r.robe, r.shade]); ell(c, 18, 15.5, 7.2, 7.8); c.fill(); }
  // head
  c.fillStyle = rg(c, 16, 14, .5, 6, SKIN); ell(c, 18, 16, 5, 5.2); c.fill();
  if (rest) { c.fillStyle = "#6a4630"; c.fillRect(15, 16.5, 2, .8); c.fillRect(19, 16.5, 2, .8); }
  else { c.fillStyle = INK; c.fillRect(15.4, 15.2, 1.3, 1.7); c.fillRect(19.3, 15.2, 1.3, 1.7); }
  c.fillStyle = "rgba(220,110,90,.35)"; ell(c, 14.8, 18.3, 1.2, .8); c.fill(); ell(c, 21.2, 18.3, 1.2, .8); c.fill();
  if (r.beard) {
    c.fillStyle = lg(c, 0, 17, 0, 34, ["#ffffff", "#cfcfe0"]);
    c.beginPath(); c.moveTo(13, 17); c.quadraticCurveTo(12.5, 27, 18, 34); c.quadraticCurveTo(23.5, 27, 23, 17); c.quadraticCurveTo(18, 21.5, 13, 17); c.fill();
    c.fillStyle = "#f2f2f8"; ell(c, 18, 19.2, 3.2, 1.1); c.fill();
  } else if (st === "counsel" && f % 2) { c.fillStyle = "#7a2e22"; ell(c, 18, 19.4, 1, .8); c.fill(); }
  // headwear
  if (!r.hat) { c.strokeStyle = r.shade; c.lineWidth = 1.4; c.beginPath(); c.arc(18, 16, 6.3, Math.PI * 1.02, Math.PI * 1.98); c.stroke(); }
  else {
    c.fillStyle = r.shade; ell(c, 18, 11.4, 9.6, 2.3); c.fill();
    c.beginPath(); c.moveTo(11, 11); c.quadraticCurveTo(15, 4, 20, 0); c.quadraticCurveTo(23, -2.5, 27, -1.5); c.quadraticCurveTo(23.5, 1.5, 22.5, 4.5); c.quadraticCurveTo(24, 8, 25, 11); c.closePath();
    c.fillStyle = lg(c, 11, 0, 25, 0, [r.light, r.robe, r.shade]); c.fill();
    if (r.band) { c.strokeStyle = r.band; c.lineWidth = 1.6; c.beginPath(); c.moveTo(11.5, 9.6); c.quadraticCurveTo(18, 11.2, 24.5, 9.6); c.stroke(); }
    if (r.stars) { star(c, 15.5, 7, 1.3, "#f2c14e"); star(c, 20, 3, 1, "#f2c14e"); star(c, 21.5, 8, .9, "#f2c14e"); }
    if (model === "fable") { c.strokeStyle = r.trim; c.lineWidth = 1; c.beginPath(); c.moveTo(11.5, 9.8); c.quadraticCurveTo(18, 11.3, 24.5, 9.8); c.stroke(); }
  }
  // staff + right arm
  if (model === "haiku") {
    c.fillStyle = lg(c, 21, 0, 28, 0, [r.robe, r.shade]); poly(c, [[22, 23], [27.5, 30.5], [25.5, 33], [21, 27.5]]); c.fill();
    const tipY = st === "counsel" ? (f % 2 ? 19 : 22) : rest ? 30 : 24;
    c.strokeStyle = WOOD; c.lineWidth = 1.3; c.beginPath(); c.moveTo(26.5, 32); c.lineTo(31, tipY); c.stroke();
    c.fillStyle = rg(c, 26.5, 32, 0, 2, SKIN); ell(c, 26.6, 32, 1.8, 1.8); c.fill();
    if (st === "cast") { c.globalCompositeOperation = "lighter"; c.fillStyle = rg(c, 31, tipY, 0, 6, ["rgba(255,233,168,.8)", "rgba(255,233,168,0)"]); ell(c, 31, tipY, 6, 6); c.fill(); c.globalCompositeOperation = "source-over"; }
    star(c, 31, tipY, st === "cast" && f % 2 ? 2 : 1.2, st === "cast" ? "#ffffff" : r.gem);
  } else {
    const hy = st === "counsel" ? top + 15 : rest ? 33 : 28;
    c.strokeStyle = WOOD; c.lineWidth = 2; c.beginPath(); c.moveTo(29, top); c.lineTo(29, 47); c.stroke();
    c.strokeStyle = WOOD_HI; c.lineWidth = .7; c.beginPath(); c.moveTo(28.4, top + 1); c.lineTo(28.4, 46); c.stroke();
    if (model === "fable") { c.strokeStyle = WOOD; c.lineWidth = 1.2; c.beginPath(); c.moveTo(29, top); c.lineTo(26.8, top - 3.5); c.moveTo(29, top); c.lineTo(31.2, top - 3.5); c.stroke(); }
    c.fillStyle = lg(c, 21, 0, 29, 0, [r.robe, r.shade]); poly(c, [[22, 23], [28.5, hy - 1.5], [28.5, hy + 2], [21, 28.5]]); c.fill();
    c.fillStyle = rg(c, 29, hy, 0, 2, SKIN); ell(c, 29, hy, 1.9, 1.9); c.fill();
    const gy = top - 2;
    if (st === "cast") {
      c.globalCompositeOperation = "lighter";
      c.fillStyle = rg(c, 29, gy, 0, 9, [r.gem + "cc", r.gem + "00"]); ell(c, 29, gy, 9, 9); c.fill();
      c.globalCompositeOperation = "source-over";
    }
    c.fillStyle = rg(c, 28.2, gy - .8, .2, 2.8, ["#ffffff", r.gem, shade(r.gem, .35)]); ell(c, 29, gy, 2.5, 2.5); c.fill();
    if (st === "cast") for (let i = 0; i < 3; i++) { const a = f * .9 + i * 2.1; star(c, 29 + Math.cos(a) * 6.5, gy + Math.sin(a) * 5, i ? 1 : 1.5, i % 2 ? "#ffffff" : r.gem); }
  }
}
export const anim = { frame: 0 };
export const sprites = new Set();
export function makeMage(s, scale, label) {
  const c = off(1, 1); c.setAttribute("role", "img"); c.setAttribute("aria-label", label);
  const phase = s.id.length % 2;
  const sp = { c, draw: fr => renderSprite(c, 38, 54, scale, ctx => drawMage(ctx, s.model, s.state, fr + phase)) };
  sprites.add(sp); sp.draw(anim.frame); return c;
}

/* ===================== landmarks (32×30 native, vector-painted) ===================== */
export function drawLandmark(c, kind, banner, f) {
  const B = banner, Bd = shade(banner, .38), Bl = tint(banner, .25);
  c.fillStyle = "rgba(0,0,0,.33)"; ell(c, 16, 27.5, 14, 2.6); c.fill();
  const stone = (x0, x1) => lg(c, x0, 0, x1, 0, ["#d6d2e0", "#a19db4", "#69657e"]);
  const smoke = (x, y) => { for (let i = 0; i < 3; i++) { const p = ((f + i * 3) % 9) / 9; c.fillStyle = `rgba(200,200,215,${.55 * (1 - p)})`; ell(c, x + Math.sin(p * 5 + i) * 1.5, y - p * 9, 1.4 + p * 2.2, 1.2 + p * 1.8); c.fill(); } };
  const glow = (x, y, r, col) => { c.globalCompositeOperation = "lighter"; c.fillStyle = rg(c, x, y, 0, r, [col, "rgba(0,0,0,0)"]); ell(c, x, y, r, r); c.fill(); c.globalCompositeOperation = "source-over"; };
  if (kind === "castle") {
    c.fillStyle = stone(6, 26); c.fillRect(6, 14, 20, 13);
    for (let x = 6; x < 26; x += 4) { c.fillStyle = stone(6, 26); c.fillRect(x, 12, 2.5, 2.5); }
    for (const tx of [3, 23]) { c.fillStyle = stone(tx, tx + 6); c.fillRect(tx, 9, 6, 18); c.fillStyle = lg(c, tx, 0, tx + 7, 0, [Bl, B, Bd]); poly(c, [[tx - .8, 9.5], [tx + 3, 1.5], [tx + 6.8, 9.5]]); c.fill(); c.fillStyle = "#ffd977"; c.fillRect(tx + 2.4, 13, 1.4, 2.2); }
    c.fillStyle = INK; c.beginPath(); c.moveTo(13, 27); c.lineTo(13, 21.5); c.quadraticCurveTo(16, 17.5, 19, 21.5); c.lineTo(19, 27); c.fill();
    c.strokeStyle = "#3a3348"; c.lineWidth = .8; c.beginPath(); c.moveTo(16, 4.5); c.lineTo(16, 12); c.stroke();
    const w = [0, 1, 0, -1][f % 4]; c.fillStyle = B; poly(c, [[16, 4.5], [21.5 + w, 5.6], [16.3, 7.8]]); c.fill();
    c.fillStyle = "rgba(255,255,255,.18)"; c.fillRect(6, 14, 1.2, 13);
  }
  if (kind === "tower") {
    c.fillStyle = stone(9, 23); c.fillRect(9, 23, 14, 4.5); c.fillStyle = stone(11, 21); c.fillRect(11, 8, 10, 16);
    c.strokeStyle = "rgba(60,55,80,.45)"; c.lineWidth = .6; for (let y = 11; y < 24; y += 3) { c.beginPath(); c.moveTo(11, y); c.lineTo(21, y); c.stroke(); }
    c.fillStyle = lg(c, 9, 0, 23, 0, [Bl, B, Bd]); poly(c, [[8.5, 8.5], [16, -1], [23.5, 8.5]]); c.fill();
    const lit = f % 4 !== 3; c.fillStyle = lit ? "#ffd977" : "#d4a640"; c.fillRect(15, 12, 2, 3.5); if (lit) glow(16, 13.8, 5, "rgba(255,210,110,.55)");
    c.fillStyle = INK; c.beginPath(); c.moveTo(14.5, 27); c.lineTo(14.5, 22.5); c.quadraticCurveTo(16, 20.5, 17.5, 22.5); c.lineTo(17.5, 27); c.fill();
    c.fillStyle = "#4f8a3e"; for (const [x, y] of [[11.5, 20], [12.2, 18], [20, 22], [19.6, 16]]) { ell(c, x, y, 1, .9); c.fill(); }
  }
  if (kind === "grove") {
    c.fillStyle = WOOD; c.fillRect(8, 17, 2, 9); c.fillRect(22, 16, 2, 10); c.fillRect(15, 13, 2, 12);
    for (const [x, y, r] of [[9, 14, 7], [23, 13, 7], [16, 9, 8.5]]) { c.fillStyle = rg(c, x - r * .35, y - r * .4, 1, r * 1.1, ["#8fd06a", "#3d8a3e", "#18452a"]); ell(c, x, y, r, r * .85); c.fill(); }
    c.fillStyle = stone(12, 20); c.fillRect(12.5, 22, 1.8, 5); c.fillRect(17.7, 22, 1.8, 5); c.fillRect(12, 21, 8, 1.6);
    const p = .5 + .5 * Math.sin(f * .8); glow(16, 24.3, 4 + p * 2, B + "aa"); c.fillStyle = Bl; ell(c, 16, 24.3, 1.3, 1.3); c.fill();
  }
  if (kind === "cavern") {
    c.beginPath(); c.moveTo(1, 27.5); c.quadraticCurveTo(4, 12, 12, 7); c.quadraticCurveTo(17, 3, 22, 7); c.quadraticCurveTo(29, 12, 31, 27.5); c.closePath();
    c.fillStyle = lg(c, 0, 3, 28, 27, ["#a597d6", "#5b4b8e", "#261d46"]); c.fill();
    c.fillStyle = INK; c.beginPath(); c.moveTo(10.5, 27.5); c.quadraticCurveTo(10.5, 18, 16, 17.5); c.quadraticCurveTo(21.5, 18, 21.5, 27.5); c.fill();
    const cr = (x, y, h, col) => { c.fillStyle = lg(c, x - 2, 0, x + 2, 0, ["#ffffff", col, shade(col, .4)]); poly(c, [[x - 1.6, y], [x, y - h], [x + 1.6, y]]); c.fill(); };
    cr(6, 24, 7, "#7ff0ff"); cr(8.3, 25, 4.5, "#ff7be5"); cr(25.5, 23, 8, "#7ff0ff"); cr(23.2, 24.5, 4.5, B); cr(17, 8.5, 5.5, B);
    if (f % 4 === 0) star(c, 25.5, 16, 1.6, "#ffffff"); if (f % 4 === 2) star(c, 6, 18, 1.4, "#ffffff");
  }
  if (kind === "volcano") {
    c.beginPath(); c.moveTo(0.5, 27.5); c.lineTo(11.5, 8); c.lineTo(20.5, 8); c.lineTo(31.5, 27.5); c.closePath();
    c.fillStyle = lg(c, 4, 6, 28, 26, ["#9a7060", "#5a3d36", "#24181a"]); c.fill();
    glow(16, 8, 7, "rgba(255,130,40,.6)"); c.fillStyle = "#ff8a2a"; ell(c, 16, 8, 4.2, 1.4); c.fill(); c.fillStyle = "#ffd36a"; ell(c, 16, 8, 2, .7); c.fill();
    c.strokeStyle = "#ff7a2a"; c.lineWidth = 1.3; c.beginPath(); c.moveTo(15, 9); c.quadraticCurveTo(13.5, 14, 14.5, 17); c.quadraticCurveTo(15.5, 21, 12.5, 25); c.stroke();
    smoke(17, 5); c.fillStyle = B; poly(c, [[25, 27.5], [27, 23.5], [29, 27.5]]); c.fill();
  }
  if (kind === "pyramid") {
    c.fillStyle = lg(c, 2, 0, 16, 0, ["#f6e2ac", "#e3c789"]); poly(c, [[16, 3], [1.5, 27.5], [16, 27.5]]); c.fill();
    c.fillStyle = lg(c, 16, 0, 30, 0, ["#c29d62", "#8e6c3c"]); poly(c, [[16, 3], [16, 27.5], [30.5, 27.5]]); c.fill();
    c.strokeStyle = "rgba(90,60,30,.35)"; c.lineWidth = .6; for (let y = 8; y < 27; y += 3.2) { const hw = (y - 3) * .59; c.beginPath(); c.moveTo(16 - hw, y); c.lineTo(16 + hw, y); c.stroke(); }
    c.fillStyle = lg(c, 13, 0, 19, 0, [Bl, B, Bd]); poly(c, [[16, 3], [13.6, 7.2], [18.4, 7.2]]); c.fill();
    c.fillStyle = INK; c.fillRect(14.6, 22, 2.8, 5.5); if (f % 4 === 1) star(c, 16, 3.5, 1.6, "#ffffff");
  }
  if (kind === "spire") {
    c.fillStyle = "#eef4fa"; ell(c, 16, 27, 13, 2.6); c.fill();
    const shard = (pts, x0, x1) => { c.fillStyle = lg(c, x0, 0, x1, 0, ["#ffffff", "#bfe2f6", "#6f9cc6"]); poly(c, pts); c.fill(); };
    shard([[8, 27.5], [9.5, 13], [13, 27.5]], 8, 13); shard([[24, 27.5], [22.5, 11], [19, 27.5]], 19, 24);
    shard([[12.2, 27.5], [12.4, 9], [16, -0.5], [19.6, 9], [19.8, 27.5]], 12, 20);
    c.fillStyle = "rgba(255,255,255,.85)"; c.fillRect(14.6, 4, .8, 18);
    c.fillStyle = B; c.globalAlpha = .55; c.fillRect(13, 22, 6, 1.4); c.globalAlpha = 1;
    if (f % 4 === 0) star(c, 16, 2, 1.8, "#ffffff"); if (f % 4 === 2) star(c, 22.5, 13, 1.4, "#ffffff");
  }
  if (kind === "village") {
    const hut = (x0, x1, base, ry) => {
      c.fillStyle = lg(c, x0, 0, x1, 0, ["#f0d2a6", "#c9a27a", "#8e6c4e"]); c.fillRect(x0, ry, x1 - x0, base - ry);
      c.fillStyle = lg(c, x0, 0, x1, 0, [Bl, B, Bd]); poly(c, [[x0 - 1.2, ry + .5], [(x0 + x1) / 2, ry - 7], [x1 + 1.2, ry + .5]]); c.fill();
      c.fillStyle = INK; c.fillRect((x0 + x1) / 2 - 1.2, base - 4.5, 2.4, 4.5);
      c.fillStyle = "#ffd977"; c.fillRect(x0 + 1.6, ry + 2.5, 2, 2);
    };
    c.fillStyle = "#6a5a4a"; c.fillRect(10.5, 7, 1.8, 5); smoke(11.4, 6);
    hut(3, 14, 27.5, 16); hut(18, 29, 27.5, 18);
    c.strokeStyle = "#8e6c4e"; c.lineWidth = .7; c.beginPath(); c.moveTo(1, 26.5); c.lineTo(31, 26.5); c.stroke();
    for (let x = 1; x < 32; x += 3) { c.beginPath(); c.moveTo(x, 25); c.lineTo(x, 27.5); c.stroke(); }
  }
}
export function makeLandmark(kind, banner, scale, geo = 1) {
  const c = off(1, 1); c.setAttribute("aria-hidden", "true");
  const sp = { c, draw: fr => renderSprite(c, 32 * geo, 30 * geo, scale, ctx => { ctx.scale(geo, geo); drawLandmark(ctx, kind, banner, fr); }) };
  sprites.add(sp); sp.draw(anim.frame); return c;
}
/** Redraw every live sprite; drop ones no longer in the document. */
export function tick() {
  anim.frame++;
  for (const sp of sprites) { if (!sp.c.isConnected) { sprites.delete(sp); continue; } sp.draw(anim.frame); }
}

/* ===================== terrain: realms are regions; land grows around each one ===================== */
export const BIOME = {
  meadow:   { ramp: ["#2e5e2a", "#3f7d32", "#5a9a3e", "#7db84f", "#a8d36a"], sky: ["#3d6fb0", "#f2c9a0"] },
  forest:   { ramp: ["#122d1a", "#1c4226", "#285c31", "#3a7a3f", "#58984f"], sky: ["#1f3a4a", "#d8c27a"] },
  highland: { ramp: ["#4a4632", "#666042", "#878156", "#a69e6c", "#c7be8c"], sky: ["#4a6a9a", "#e6dcc4"] },
  crystal:  { ramp: ["#251d46", "#3b3066", "#54458a", "#7362a8", "#9c8bcf"], sky: ["#140f34", "#7a5aa8"] },
  ash:      { ramp: ["#1e1516", "#342425", "#4c3530", "#68473e", "#87614e"], sky: ["#241010", "#c0582a"] },
  desert:   { ramp: ["#9a7a44", "#b8935a", "#d1ad6e", "#e3c789", "#f2dfa8"], sky: ["#b8603a", "#f8deaa"] },
  snow:     { ramp: ["#8292b0", "#a5b4cc", "#c6d2e3", "#e1e9f3", "#ffffff"], sky: ["#5e7aa2", "#eef3f8"] },
};
const SEA = ["#0d2246", "#14335f", "#1c4a7e", "#26649c", "#3584b6"].map(hex);
const SAND = ["#b59a5e", "#d2b679", "#e9d59d"].map(hex);
const FOAM = hex("#d8eef2");
export const REALM_R = 70; // world px; matches src/realms.ts R

/**
 * Paint the world. One terrain pixel = one world px. `x0,y0` is the world coordinate of the top-left pixel.
 * Realms are bucketed on a grid so each pixel only looks at nearby realms: dozens of realms stay fast.
 */
export function buildTerrain(realms, x0, y0, W, H) {
  const img = new ImageData(W, H), d = img.data, rad = REALM_R * 1.15, cell = rad * 3;
  const R = realms.map(r => ({ r, x: r.pos.x - x0, y: r.pos.y - y0, ramp: BIOME[LANDMARKS[r.landmark]?.biome ?? "meadow"].ramp.map(hex), biome: LANDMARKS[r.landmark]?.biome ?? "meadow" }));
  const grid = new Map();
  for (const q of R) { const k = `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(q); }
  const near = (x, y) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell), out = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const g = grid.get(`${cx + i},${cy + j}`); if (g) out.push(...g); } return out; };
  const field = (x, y, qs) => { let l = 0; for (const q of qs) { const dx = x - q.x, dy = (y - q.y) * 1.15; l = Math.max(l, Math.exp(-(dx * dx + dy * dy) / (rad * rad))); } return l + (fbm(x + x0, y + y0) - .5) * .75; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const qs = near(x, y), f = qs.length ? field(x, y, qs) : (fbm(x + x0, y + y0) - .5) * .75;
    const gx = x + x0, gy = y + y0; let c;
    if (f < .40) {
      c = dramp(SEA, 1 - clamp((.40 - f) / .34, 0, 1), gx, gy, 1.2);
      if (f > .375 && BAYER[(gy & 3) * 4 + (gx & 3)] > -.1) c = mix(c, FOAM, .7);
      else if (hash(gx, gy) < .004) c = mix(c, [255, 255, 255], .45);
    } else if (f < .445) c = dramp(SAND, (f - .40) / .045, gx, gy);
    else {
      const wx = (noise(gx + 300, gy, 16) - .5) * rad * .5, wy = (noise(gx, gy + 300, 16) - .5) * rad * .5;
      let d1 = 1e9, d2 = 1e9, b = qs[0];
      for (const q of qs) { const dd = Math.hypot(x + wx - q.x, (y + wy - q.y) * 1.15); if (dd < d1) { d2 = d1; d1 = dd; b = q; } else if (dd < d2) d2 = dd; }
      const light = clamp(.5 + (field(x - 1, y - 1, qs) - f) * 10 + (noise(gx, gy, 4) - .5) * .35, 0, 1);
      c = dramp(b.ramp, light * .7 + clamp((f - .445) * 1.6, 0, 1) * .3, gx, gy);
      if (b.biome === "forest" && noise(gx + 7, gy + 3, 2.5) > .58) c = mix(c, [8, 24, 12], .4);
      if (b.biome === "meadow" && hash(gx, gy) < .006) c = [240, 222, 130];
      if (b.biome === "crystal" && hash(gx, gy) < .009) c = [150, 240, 255];
      if (b.biome === "ash" && Math.abs(noise(gx, gy, 8) - .5) < .012) c = [255, 120, 40];
      if (b.biome === "highland" && hash(gx, gy) < .02) c = mix(c, [40, 36, 28], .5);
      if (d2 - d1 < 1.3) c = mix(c, [18, 14, 32], .38);
    }
    const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  const cv = off(W, H); cv.getContext("2d").putImageData(img, 0, 0); return cv;
}

/* realm scene backdrop: sky, two hill layers, dithered ground (native height 100) */
export function buildBackdrop(W, H, biome) {
  const B = BIOME[biome], ramp = B.ramp.map(hex), s0 = hex(B.sky[0]), s1 = hex(B.sky[1]);
  const img = new ImageData(W, H), d = img.data, sky = [s0, mix(s0, s1, .33), mix(s0, s1, .66), s1];
  for (let x = 0; x < W; x++) {
    const far = H * .42 + (noise(x, 0, 30) - .5) * H * .28 + (noise(x, 5, 9) - .5) * H * .06;
    const near = H * .6 + (noise(x + 90, 0, 18) - .5) * H * .16;
    for (let y = 0; y < H; y++) {
      let c;
      if (y < far) c = dramp(sky, y / (H * .62), x, y, 1.1);
      else if (y < near) c = mix(dramp(ramp.slice(1, 4), noise(x, y, 6), x, y), s1, .45);
      else if (y < H * .7) c = dramp(ramp.slice(1, 4), .4 + (noise(x, y, 5) - .5) * .8, x, y);
      else c = dramp(ramp, .85 - (y - H * .7) / (H * .3) * .55 + (noise(x, y, 4) - .5) * .4, x, y);
      if (biome === "forest" && y >= near - 6 && y < near && noise(x, y, 2) > .45) c = ramp[0];
      if ((biome === "crystal" || biome === "snow") && y < far && hash(x, y) < .004) c = [255, 255, 255];
      const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  const cv = off(W, H); cv.getContext("2d").putImageData(img, 0, 0); return cv;
}

