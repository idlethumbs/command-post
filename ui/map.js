/* The world map: a fixed-size painted world under an RTS-style camera (drag to pan, wheel/pinch to zoom, fit by default). */
import { BAYER, buildTerrain, clamp, hash, makeLandmark, noise, off, REALM_R } from "./art.js";

const S = 3;                      // CSS px per world px at zoom 1: the painted-pixel size
const Z_MIN = 0.2, Z_MAX = 3;
const MARGIN = REALM_R * 2.3;     // sea around the outermost realms
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function createMap(wrap, { onOpen, onSelect, siteContent, motion = () => true }) {
  wrap.innerHTML = `<div class="world" id="world"></div><div class="flash" id="flash"></div>
    <div class="overlay zoombar" role="group" aria-label="Zoom">
      <button class="btn ghost" data-z="in" aria-label="Zoom in">+</button>
      <button class="btn ghost" data-z="out" aria-label="Zoom out">−</button>
      <button class="btn ghost" data-z="fit" title="Fit all realms (0)">Fit</button></div>`;
  const world = wrap.querySelector(".world"), flash = wrap.querySelector(".flash");
  let realms = [], geoKey = "", bounds = { x0: 0, y0: 0, W: 1, H: 1 };
  let cam = { tx: 0, ty: 0, z: 1 }, touched = false, sel = 0;
  try {
    const c = JSON.parse(sessionStorage.getItem("arcanum.cam.v2") || "null");
    if (c && [c.z, c.tx, c.ty].every(Number.isFinite) && c.z >= Z_MIN && c.z <= Z_MAX) { cam = c; touched = true; }
  } catch {}

  const live = () => wrap.isConnected && wrap.clientWidth > 0 && wrap.clientHeight > 0;
  const apply = () => {
    world.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.z})`;
    world.style.setProperty("--z", cam.z);
    wrap.dataset.zoom = cam.z < 0.3 ? "far" : cam.z < 0.5 ? "mid" : "near";
    if (live()) try { sessionStorage.setItem("arcanum.cam.v2", JSON.stringify(cam)); } catch {}
  };
  const toScreen = r => ({ x: (r.pos.x - bounds.x0) * S, y: (r.pos.y - bounds.y0) * S });

  function fit() {
    if (!realms.length || !live()) return;   // a detached or zero-sized map must never compute (and save) a camera
    const vw = wrap.clientWidth, vh = wrap.clientHeight, pad = REALM_R * S * 1.5;
    const xs = realms.map(r => toScreen(r).x), ys = realms.map(r => toScreen(r).y);
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad * 1.1, maxY = Math.max(...ys) + pad * 0.8;
    const z = clamp(Math.min(vw / (maxX - minX), vh / (maxY - minY)), Z_MIN, 1.4);
    cam = { z, tx: vw / 2 - (minX + maxX) / 2 * z, ty: vh / 2 - (minY + maxY) / 2 * z + 20 };
    apply();
  }
  function zoomAt(px, py, f) {
    const z = clamp(cam.z * f, Z_MIN, Z_MAX), wx = (px - cam.tx) / cam.z, wy = (py - cam.ty) / cam.z;
    cam = { z, tx: px - wx * z, ty: py - wy * z }; touched = true; apply();
  }

  /* pan: drag anywhere; a press that moves < 4px is still a click on whatever is under it */
  let drag = null, swallowClick = false;
  wrap.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest(".overlay")) return;
    drag = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty, moved: false, id: e.pointerId };
  });
  wrap.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; wrap.setPointerCapture(e.pointerId); wrap.classList.add("dragging"); }
    cam.tx = drag.tx + dx; cam.ty = drag.ty + dy; touched = true; apply();
  });
  const end = () => { if (drag?.moved) swallowClick = true; drag = null; wrap.classList.remove("dragging"); };
  wrap.addEventListener("pointerup", end); wrap.addEventListener("pointercancel", end);
  wrap.addEventListener("click", e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
  wrap.addEventListener("wheel", e => {
    e.preventDefault();
    const b = wrap.getBoundingClientRect();
    zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)));
  }, { passive: false });
  wrap.querySelector(".zoombar").addEventListener("click", e => {
    const z = e.target.closest("[data-z]")?.dataset.z; if (!z) return;
    if (z === "fit") { fit(); touched = false; return; }
    zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, z === "in" ? 1.35 : 1 / 1.35);
  });
  const ro = new ResizeObserver(() => { if (!wrap.isConnected) return ro.disconnect(); if (!touched) fit(); });
  ro.observe(wrap);

  function rebuildWorld() {
    const xs = realms.map(r => r.pos.x), ys = realms.map(r => r.pos.y);
    const x0 = Math.floor(Math.min(0, ...xs) - MARGIN), y0 = Math.floor(Math.min(0, ...ys) - MARGIN);
    const W = Math.max(300, Math.ceil(Math.max(0, ...xs) + MARGIN - x0)), H = Math.max(200, Math.ceil(Math.max(0, ...ys) + MARGIN - y0));
    bounds = { x0, y0, W, H };
    world.style.width = W * S + "px"; world.style.height = H * S + "px";
    world.querySelector("canvas.terrain")?.remove();
    const t = buildTerrain(realms, x0, y0, W, H);
    t.className = "terrain"; t.setAttribute("role", "img"); t.setAttribute("aria-label", "World map of your realms");
    world.prepend(t);
    buildAmbience(t, W, H);
  }

  /* ambience: wave glints on real sea pixels, and dithered cloud veils drifting east */
  let amb = null, glints = [], clouds = null, tick = 0, timer = null;
  function buildAmbience(terrain, W, H) {
    world.querySelector("canvas.ambience")?.remove();
    amb = off(W, H); amb.className = "ambience"; amb.setAttribute("aria-hidden", "true");
    world.insertBefore(amb, terrain.nextSibling);
    const px = terrain.getContext("2d").getImageData(0, 0, W, H).data;
    glints = [];
    for (let i = 0; i < W * H; i += 37) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      if (b > r + 50 && b > g + 8 && hash(i, 7) < 0.45) glints.push({ x: i % W, y: (i / W) | 0, ph: hash(i, 3) * 60, per: 40 + hash(i, 5) * 50 });
    }
    clouds = off(W, H);
    const cc = clouds.getContext("2d"), img = cc.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = noise(x + 900, y, 46) * 0.72 + noise(x, y + 500, 15) * 0.28;
      if (v > 0.64 + BAYER[(y & 3) * 4 + (x & 3)] * 0.1) { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 15; }
    }
    cc.putImageData(img, 0, 0);
    clearInterval(timer);
    timer = setInterval(drawAmbience, 110);
    drawAmbience();
  }
  function drawAmbience() {
    if (!wrap.isConnected) { clearInterval(timer); return; }
    if (!amb) return;
    const c = amb.getContext("2d"), W = amb.width, H = amb.height;
    c.clearRect(0, 0, W, H);
    if (!motion()) { c.drawImage(clouds, 0, 0); return; }
    tick++;
    const dx = Math.floor(tick * 0.12) % W;
    c.drawImage(clouds, dx, 0); c.drawImage(clouds, dx - W, 0);
    for (const g of glints) {
      const k = ((tick + g.ph) % g.per) / g.per;
      if (k > 0.12) continue;
      const a = Math.sin(k / 0.12 * Math.PI);
      c.fillStyle = `rgba(230,248,255,${(a * 0.85).toFixed(2)})`;
      c.fillRect(g.x - (a > 0.6 ? 1 : 0), g.y, a > 0.6 ? 3 : 1, 1);
    }
  }

  function renderSites(order) {
    world.querySelectorAll(".site").forEach(el => el.remove());
    order.forEach((r, i) => {
      const { x, y } = toScreen(r), c = siteContent(r);
      const b = document.createElement("button");
      b.className = "site" + (i === sel ? " sel" : "") + (c.needs ? " needs" : "");
      b.dataset.realm = r.id; b.style.left = x + "px"; b.style.top = y + "px";
      b.setAttribute("aria-label", c.label);
      b.appendChild(makeLandmark(r.landmark, r.banner, S));
      b.insertAdjacentHTML("beforeend", `<span class="tag">${c.fresh ? `<span class="new">NEW</span>` : ""}<span class="name">${esc(r.name)}</span><span class="pin">${c.pins}</span></span>`);
      b.onclick = () => onOpen(r.id);
      b.onfocus = () => { sel = i; mark(); onSelect?.(i); };
      world.appendChild(b);
    });
  }
  const mark = () => world.querySelectorAll(".site").forEach((el, i) => el.classList.toggle("sel", i === sel));

  return {
    /** `order` is the realms in selection order (waiting-first). Terrain is repainted only when realm geometry changes. */
    update(order) {
      const key = JSON.stringify(order.map(r => [r.id, r.pos, r.landmark]).sort());
      const firstPaint = !geoKey, grew = geoKey && key !== geoKey;
      realms = order;
      if (key !== geoKey) { geoKey = key; rebuildWorld(); }
      sel = Math.min(sel, Math.max(0, order.length - 1));
      renderSites(order);
      if ((firstPaint && !touched) || (grew && !touched)) fit(); else apply();
    },
    select(i) { sel = i; mark(); world.querySelectorAll(".site")[i]?.focus({ preventScroll: true }); },
    get selected() { return sel; },
    fit() { fit(); touched = false; },
    zoom(f) { zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, f); },
    /** Fast travel: glide the camera into the realm, flash, then hand over. */
    flyTo(realmId, done, reduced) {
      const r = realms.find(x => x.id === realmId);
      if (!r || reduced) return done();
      const p = toScreen(r), from = { ...cam }, z = Math.max(2.4, cam.z * 1.5), t0 = performance.now(), dur = 480;
      const to = { z, tx: wrap.clientWidth / 2 - p.x * z, ty: wrap.clientHeight / 2 - p.y * z };
      flash.classList.add("on");
      const step = now => {
        const k = Math.min(1, (now - t0) / dur), e = k * k * (3 - 2 * k);
        cam = { z: from.z + (to.z - from.z) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
        world.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.z})`;
        if (k < 1) requestAnimationFrame(step); else { cam = from; apply(); done(); }
      };
      requestAnimationFrame(step);
    },
  };
}
