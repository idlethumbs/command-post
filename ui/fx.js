/* Spellwork: a full-screen overlay for particles and messenger ravens. It only runs while something is in flight. */
import { off } from "./art.js";

const S = 3;   // painted-pixel size, same as the map
let canvas, ctx, items = [], running = false, enabled = () => true;

export function initFx(isEnabled) {
  enabled = isEnabled;
  canvas = document.createElement("canvas");
  canvas.className = "fx"; canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  const size = () => { canvas.width = Math.ceil(innerWidth / S); canvas.height = Math.ceil(innerHeight / S); ctx.imageSmoothingEnabled = false; };
  size(); addEventListener("resize", size);
}

const centre = el => { const b = el.getBoundingClientRect(); return { x: (b.left + b.width / 2) / S, y: (b.top + b.height / 2) / S }; };

/** A burst of pixel sparkles: `kind` sets palette and motion. */
export function burst(el, kind = "word") {
  if (!enabled() || !el?.isConnected) return;
  const { x, y } = centre(el);
  const pal = { word: ["#74e0f7", "#ffffff", "#b884f0"], grant: ["#f2c14e", "#ffe9a8", "#ffffff"], refuse: ["#ef5470", "#8a3b4a", "#f0a0b0"], arrive: ["#ffffff", "#74e0f7", "#f2c14e"], alert: ["#ef5470", "#ffffff", "#f2c14e"] }[kind];
  const n = kind === "arrive" ? 36 : 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * .4, sp = (kind === "refuse" ? .35 : .7) + Math.random() * .9;
    items.push({ type: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === "refuse" ? .1 : .35), life: 0, max: 34 + Math.random() * 20, col: pal[i % pal.length], g: kind === "refuse" ? .01 : .025 });
  }
  if (kind === "arrive") items.push({ type: "ring", x, y, life: 0, max: 26, col: "#f2c14e" });
  start();
}

/** A ring that swells and fades: a realm calling for attention. */
export function pulse(el, col = "#ef5470") {
  if (!enabled() || !el?.isConnected) return;
  const { x, y } = centre(el);
  items.push({ type: "ring", x, y, life: 0, max: 36, col }); items.push({ type: "ring", x, y, life: -10, max: 36, col });
  start();
}

/* 9×7 raven, two wing frames */
const RAVEN = [
  ["....X....", "...XXX...", "XXXXXXXXX", ".XXXXXXX.", "...XXX...", "...X.X...", "........."],
  [".........", "...XXX...", "..XXXXX..", "XXXXXXXXX", "X..XXX..X", "...X.X...", "........."],
];
const ravenSprite = RAVEN.map(rows => {
  const c = off(9, 7), x = c.getContext("2d");
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === "X") { x.fillStyle = j === 1 && i === 5 ? "#f2c14e" : "#120f22"; x.fillRect(i, j, 1, 1); } }));
  return c;
});

/** A raven carrying word from one element to another, along an arc. */
export function raven(fromEl, toEl, done) {
  if (!enabled() || !fromEl?.isConnected || !toEl?.isConnected) return done?.();
  const a = centre(fromEl), b = centre(toEl);
  items.push({ type: "raven", a, b, c: { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 40 }, life: 0, max: 70, done });
  start();
}

function start() { if (!running) { running = true; requestAnimationFrame(step); } }

function step() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const p of items) {
    p.life++;
    if (p.life < 0) continue;
    const k = p.life / p.max;
    if (p.type === "spark") {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= .97;
      ctx.globalAlpha = 1 - k; ctx.fillStyle = p.col;
      const s = p.life % 6 < 3 ? 1 : 2;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    } else if (p.type === "ring") {
      ctx.globalAlpha = (1 - k) * .9; ctx.strokeStyle = p.col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(Math.round(p.x), Math.round(p.y), 3 + k * 16, 0, Math.PI * 2); ctx.stroke();
    } else if (p.type === "raven") {
      const t = k * k * (3 - 2 * k), u = 1 - t;
      const x = u * u * p.a.x + 2 * u * t * p.c.x + t * t * p.b.x, y = u * u * p.a.y + 2 * u * t * p.c.y + t * t * p.b.y + Math.sin(p.life * .5) * .8;
      ctx.globalAlpha = Math.min(1, (1 - k) * 4, p.life / 6);
      ctx.save(); ctx.translate(Math.round(x), Math.round(y)); if (p.b.x < p.a.x) ctx.scale(-1, 1);
      ctx.drawImage(ravenSprite[(p.life >> 2) % 2], -4, -3); ctx.restore();
      if (p.life === p.max) p.done?.();
    }
  }
  ctx.globalAlpha = 1;
  items = items.filter(p => p.life < p.max);
  if (items.length) requestAnimationFrame(step); else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
}
