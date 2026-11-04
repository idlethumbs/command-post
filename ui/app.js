/* Arcanum UI: live, read-only view of your Claude Code sessions. Data comes from the local daemon over SSE. */
import { BANNERS, BIOME, LANDMARKS, RANK, STATE, buildBackdrop, drawMage, makeLandmark, makeMage, renderSprite, tick, tint } from "./art.js";
import { createMap } from "./map.js";
import { burst, initFx, pulse, raven } from "./fx.js";
import { cue, setSound } from "./sound.js";

const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* Grimoire settings (per browser): sound is off unless you turn it on; motion follows macOS unless you choose */
const prefs = { sound: false, volume: 0.5, motion: "auto", summonFocus: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("arcanum.prefs") || "{}")); } catch {}
const osCalm = matchMedia("(prefers-reduced-motion: reduce)");
const motionOK = () => prefs.motion === "full" || (prefs.motion === "auto" && !osCalm.matches);
function applyPrefs() {
  document.documentElement.dataset.motion = motionOK() ? "full" : "calm";
  setSound(prefs.sound, prefs.volume);
  try { localStorage.setItem("arcanum.prefs", JSON.stringify(prefs)); } catch {}
}
applyPrefs(); osCalm.addEventListener?.("change", applyPrefs);
initFx(motionOK);
const needsYou = s => s.state === "counsel" || s.state === "seal";
const NEW_FOR = 15 * 60 * 1000;

let data = { realms: [], sessions: [] };
const ui = { view: "map", realm: null, session: null, filter: "all", charter: false };
let map = null;

/* unread: a request stays unread until you open that mage (per browser) */
let seen = {};
try { seen = JSON.parse(localStorage.getItem("arcanum.seen") || "{}"); } catch {}
const markSeen = s => { seen[s.id] = s.since; try { localStorage.setItem("arcanum.seen", JSON.stringify(seen)); } catch {} };
const isUnread = s => needsYou(s) && seen[s.id] !== s.since;

const realmOf = id => data.realms.find(r => r.id === id);
const troopsOf = id => data.sessions.filter(s => s.realmId === id);
const byNeed = (a, b) => (needsYou(b) - needsYou(a)) || (b.since - a.since);
function ago(t) { const d = (Date.now() - t) / 60000; if (d < 1) return "now"; if (d < 60) return `${d | 0}m`; if (d < 1440) return `${(d / 60) | 0}h`; return `${(d / 1440) | 0}d`; }
const home = p => p.replace(/^\/Users\/[^/]+/, "~");
/* claude-opus-5-5 → Opus 5.5 · claude-haiku-4-5-20251001 → Haiku 4.5 */
const prettyModel = id => { const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id ?? ""); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}` : id; };

/* tiny, safe markdown for the latest missive: paragraphs, bullets, headings, tables, `code`, **bold** */
function missive(md) {
  if (!md) return "<p>No word yet.</p>";
  const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const out = []; let list = null, table = null;
  const flush = () => {
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    if (table) {
      const [head, ...body] = table;
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      table = null;
    }
  };
  const text = md.replace(/```[\s\S]*?```/g, m => "`" + m.slice(3, -3).trim().split("\n").slice(-3).join(" ⏎ ") + "`");
  for (const line of text.split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (list) flush();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;   // the |---|---| separator
      (table ??= []).push(cells(line)); continue;
    }
    if (table) flush();
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)/.exec(line), h = /^#{1,6}\s+(.*)/.exec(line);
    if (li) { (list ??= []).push(`<li>${inline(li[1])}</li>`); continue; }
    flush();
    if (h) out.push(`<h4>${inline(h[1])}</h4>`); else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join("");
}

/* ---------------- sidebar ---------------- */
function renderSide() {
  const L = data.sessions, n = k => L.filter(s => s.state === k).length;
  $("#sumline").textContent = `${data.realms.length} realms · ${L.length} mages · ${n("cast")} casting`;
  $("#awaitRow").innerHTML = `<span class="pill counsel">! ${n("counsel")} counsel</span><span class="pill seal">? ${n("seal")} seal</span>
    <button class="next" id="nextBtn" title="Next waiting mage (N)">Next ▸</button>`;
  $("#nextBtn").onclick = nextRequest;
  $("#navMap").setAttribute("aria-current", ui.view === "map" ? "page" : "false");
  const items = L.filter(s => ui.filter === "all" || needsYou(s)).sort((a, b) => b.since - a.since);
  $("#feed").innerHTML = items.map(s => {
    const r = realmOf(s.realmId), st = STATE[s.state];
    return `<li><button class="raven${isUnread(s) ? " unread" : ""}${s.state === "rest" ? " dim" : ""}" data-go="${esc(s.id)}">
      <span class="dot" style="background:${r?.banner ?? "#888"}"></span>
      <span class="who">${esc(s.name)} <small>· ${esc(r?.name)}</small></span>
      <span class="t"><span class="g ${st.cls}">${st.glyph}</span>${ago(s.since)}</span>
      <span class="msg">${esc(s.briefing)}</span></button></li>`;
  }).join("") || `<li class="via" style="padding:8px">No ravens. No Claude sessions are running.</li>`;
  scry(); renderGone();
}
document.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => {
  ui.filter = b.dataset.filter; document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderSide();
});
function scry() {
  const q = $("#scry").value.trim().toLowerCase();
  const hits = !q ? [] : data.sessions.filter(s => [s.name, s.title, s.briefing, realmOf(s.realmId)?.name, RANK[s.model].title, s.cwd].join(" ").toLowerCase().includes(q)).slice(0, 8);
  $("#results").innerHTML = hits.map(s => `<button class="raven" data-go="${esc(s.id)}"><span class="dot" style="background:${realmOf(s.realmId)?.banner}"></span>
    <span class="who">${esc(s.name)} <small>· ${esc(realmOf(s.realmId)?.name)}</small></span><span class="t"><span class="g ${STATE[s.state].cls}">${STATE[s.state].glyph}</span></span></button>`).join("")
    || (q ? `<span class="via">No mage answers to that.</span>` : "");
}
$("#scry").oninput = scry;
$("#navMap").onclick = () => { if (ui.view !== "map") goMap(); };
$("#navScry").onclick = () => { const b = $("#scryBox"); b.hidden = !b.hidden; if (!b.hidden) $("#scry").focus(); };

/* ---------------- world map ---------------- */
function realmsOrdered() {
  const t = (r, f) => Math.max(0, ...troopsOf(r.id).filter(f).map(s => s.since));
  return [...data.realms].sort((a, b) => (t(b, needsYou) - t(a, needsYou)) || (t(b, () => true) - t(a, () => true)) || a.name.localeCompare(b.name));
}
function siteContent(r) {
  const ts = troopsOf(r.id), n = k => ts.filter(s => s.state === k).length;
  const pins = [n("counsel") && `<i class="counsel">!${n("counsel")}</i>`, n("seal") && `<i class="seal">?${n("seal")}</i>`, n("cast") && `<i class="cast">✦${n("cast")}</i>`].filter(Boolean).join("");
  return { pins, needs: ts.some(needsYou), fresh: Date.now() - r.discoveredAt < NEW_FOR, label: `${r.name}: ${ts.length} mages, ${ts.filter(needsYou).length} waiting on you` };
}
function renderMap(fromRoute) {
  ui.view = "map";
  if (!fromRoute) setRoute(true);
  const newest = data.sessions.filter(needsYou).sort((a, b) => b.since - a.since)[0];
  $("#view").innerHTML = data.realms.length ? `<div class="mapwrap" id="mapwrap"></div>` :
    `<div class="mapwrap"><div class="empty"><div><h2 style="font-family:var(--f-display);font-weight:400;font-size:40px;margin:0">No realms yet</h2><p>Start a Claude Code session in any project and its realm appears here.</p></div></div></div>`;
  if (!data.realms.length) { map = null; return renderSide(); }
  const wrap = $("#mapwrap");
  map = createMap(wrap, { onOpen: travel, siteContent, motion: motionOK });
  wrap.insertAdjacentHTML("beforeend", `<div class="overlay title-scroll"><h2>The Known Realms</h2></div>
    <div id="latestSlot"></div>
    <div class="overlay legend"><span><span class="g counsel">!</span> seeks counsel</span><span><span class="g seal">?</span> awaits your seal</span><span><span class="g cast">✦</span> casting</span><span>drag to pan · scroll to zoom</span></div>
    <div class="overlay keys"><kbd>←</kbd><kbd>→</kbd> select · <kbd>⏎</kbd> travel · <kbd>N</kbd> next · <kbd>0</kbd> fit</div>`);
  renderLatest(newest);
  map.update(realmsOrdered());
  renderSide();
}
function renderLatest(s) {
  const slot = $("#latestSlot"); if (!slot) return;
  slot.innerHTML = s ? `<button class="overlay latest" data-go="${esc(s.id)}"><span class="g counsel">✉</span><span class="txt"><b>${esc(s.name)}</b> ${STATE[s.state].verb} · ${esc(s.briefing)}</span><span class="g rest">${ago(s.since)}</span></button>` : "";
}
function travel(rid, sid) {
  cue.travel();
  const arrive = () => { openRealm(rid, sid); requestAnimationFrame(() => burst(document.querySelector(".scene .landmark"), "arrive")); };
  if (!map) return arrive();
  map.flyTo(rid, arrive, !motionOK());
}
function goMap() { renderMap(); }

/* ---------------- realm view ---------------- */
function openRealm(rid, sid, fromRoute) {
  const t = troopsOf(rid).sort(byNeed);
  const entering = ui.view !== "realm" || ui.realm !== rid;
  ui.view = "realm"; ui.realm = rid; ui.session = sid || t[0]?.id || null; ui.charter = false;
  if (!fromRoute) setRoute(entering);
  renderRealm(true); $("#view").scrollTop = 0;
}
function renderRealm(entering) {
  const r = realmOf(ui.realm);
  if (!r) return goMap();
  const biome = LANDMARKS[r.landmark]?.biome ?? "meadow", B = BIOME[biome];
  const t = troopsOf(r.id).sort(byNeed);
  if (!t.some(s => s.id === ui.session)) ui.session = t[0]?.id ?? null;
  const cur = t.find(s => s.id === ui.session); if (cur) markSeen(cur);
  setRoute(false);
  document.documentElement.style.setProperty("--portrait-bg", `linear-gradient(180deg, ${B.sky[0]}, ${B.sky[1]} 62%, ${B.ramp[3]} 62%, ${B.ramp[1]})`);
  $("#view").innerHTML = `<div class="realm${entering ? " in" : ""}">
    <div class="realm-top"><button class="btn ghost" id="back">◀ World map</button><h2 style="color:${tint(r.banner, .15)}">${esc(r.name)}</h2>
      <span class="meta">${r.lands.length || "no"} ${r.lands.length === 1 ? "land" : "lands"} · ${t.length} ${t.length === 1 ? "mage" : "mages"}</span>
      <div class="right"><span class="meta"><kbd>↑</kbd><kbd>↓</kbd> mage · <kbd>R</kbd> reply · <kbd>P</kbd> portal · <kbd>esc</kbd> map</span>
      ${r.lands.length ? `<button class="btn" id="summonHere">✧ Summon a mage</button>` : ""}
      ${r.id === "wilds" ? "" : `<button class="btn alt" id="editRealm" aria-expanded="${ui.charter}">${ui.charter ? "Close charter" : "Edit realm"}</button>`}</div></div>
    ${ui.charter ? `<section class="card charter" id="charter"></section>` : ""}
    <section class="scene" id="scene" aria-label="Mages in ${esc(r.name)}"><div class="troupe" id="troupe"></div></section>
    ${t.length ? `<div class="op"><section class="card circle" aria-label="Mages"><span class="lbl">Circle · ${t.length}</span><div id="circle"></div></section>
      <section class="card comms" id="comms" aria-live="polite"></section></div>`
      : `<section class="card comms"><p>No mages are in this realm right now. It stays on the map so you can find it again.</p></section>`}</div>`;
  $("#back").onclick = goMap;
  const ed = $("#editRealm"); if (ed) ed.onclick = () => { ui.charter = !ui.charter; renderRealm(); };
  const sh = $("#summonHere"); if (sh) sh.onclick = () => summonDialog(r.id);
  const sc = $("#scene"), bd = buildBackdrop(Math.max(40, Math.round(sc.clientWidth / 3)), 100, biome);
  bd.className = "backdrop"; bd.setAttribute("aria-hidden", "true"); sc.prepend(bd);
  const lm = makeLandmark(r.landmark, r.banner, 2, 2); lm.className = "landmark"; sc.insertBefore(lm, $("#troupe"));
  for (const s of t) {
    const b = document.createElement("button"); b.className = "mage" + (s.id === ui.session ? " sel" : ""); b.dataset.session = s.id;
    b.appendChild(makeMage(s, 2, `${RANK[s.model].title} ${s.name}: ${STATE[s.state].label}`));
    b.insertAdjacentHTML("afterbegin", `<span class="bubble ${STATE[s.state].cls}">${STATE[s.state].glyph}</span>`);
    b.insertAdjacentHTML("beforeend", `<span class="name">${esc(s.name)}</span>`);
    b.onclick = () => { ui.session = s.id; renderRealm(); };
    $("#troupe").appendChild(b);
  }
  const ci = $("#circle");
  if (ci) for (const s of t) {
    const w = document.createElement("div"); w.className = "crowwrap";
    const b = document.createElement("button"); b.className = "crow" + (s.id === ui.session ? " sel" : ""); b.dataset.session = s.id;
    b.innerHTML = `<span><span class="cs">${esc(s.name)}</span><span class="rk">${RANK[s.model].title} · ${ago(s.since)}</span></span><span class="chip ${STATE[s.state].cls}">${STATE[s.state].chip}</span>`;
    b.onclick = () => { ui.session = s.id; renderRealm(); };
    w.appendChild(b);
    w.insertAdjacentHTML("beforeend", `<button class="x" data-dismiss="${esc(s.id)}" aria-label="Dismiss ${esc(s.name)}" title="Dismiss from Arcanum">×</button>`);
    ci.appendChild(w);
  }
  if (ui.charter) renderCharter(r);
  if (cur) renderComms(cur);
  renderSide();
}
function portalButton(s) {
  if (s.portal === "exact") return `<button class="btn alt" data-portal="${esc(s.id)}" title="Jump to its ${esc(s.where)} ${s.host === "bg" ? "job" : "pane"}">Open portal</button>`;
  if (s.portal === "app") return `<button class="btn alt" data-portal="${esc(s.id)}" title="${esc(s.where)} can't be told which tab, so this raises the window">Raise ${esc(s.where)}</button>`;
  return `<button class="btn alt" disabled title="Arcanum can't reach this terminal">No portal</button>`;
}
async function openPortal(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Opening…"; }
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/portal`, { method: "POST" });
    const j = await r.json();
    toast(j.message ?? j.error ?? "That didn't work");
  } catch { toast("The Arcanum daemon isn't answering."); }
  finally { if (btn?.isConnected) renderRealm(); }
}
document.addEventListener("click", e => { const b = e.target.closest("[data-portal]"); if (b) openPortal(b.dataset.portal, b); });

function exchangeBlock(s) {
  const r = s.recent ?? [];
  if (!r.length) return "";
  return `<section class="exchange" aria-label="Recent exchange"><div class="lbl"><span>Recent exchange</span><span>newest last · click to expand</span></div>
    <ul class="exlist" id="exlist">${r.map(e => `<li class="${e.who}"><span class="who">${e.who === "you" ? "You" : "Mage"}</span>
      <span class="tx">${e.images ? `<span class="img">[${e.images} image${e.images > 1 ? "s" : ""}]</span>` : ""}${esc(e.text)}</span><span class="at">${ago(e.at)}</span></li>`).join("")}</ul></section>`;
}
function sealBlock(s) {
  if (s.unreachable) return unreachableNote(s);
  if (!s.seal) return `<div class="orders"><span class="lbl">Asks for your seal</span><div class="req">A permission prompt is open in its terminal.</div>
    <div class="btns">${portalButton(s)}<span class="soon-note">${esc(s.where)} can't be sent keys, so answer it there.</span></div></div>`;
  return `<div class="orders"><span class="lbl">Asks for your seal</span><div class="req" id="sealReq">Reading the prompt…</div>
    <div class="btns"><button class="btn" data-seal="grant">Grant seal</button><button class="btn deny" data-seal="refuse">Refuse</button>${portalButton(s)}
    <span class="hint">Presses Yes or No in its prompt</span></div></div>`;
}
const unreachableNote = s => `<div class="orders"><span class="lbl">Send word</span>
    <div class="via">Arcanum can't find ${esc(s.name)}'s ${esc(s.where)} ${s.host === "cmux" ? "pane" : "tab"} right now, so it won't type into it. If the window is still open, reply there; it reconnects here automatically when found.</div>
    <div class="btns">${portalButton(s)}</div></div>`;
function wordBlock(s) {
  if (s.unreachable) return unreachableNote(s);
  if (s.reply !== "type") return `<div class="orders"><span class="lbl">Send word</span>
    <div class="via">${esc(s.where)} can't be typed into from Arcanum. Open it to reply; sessions in cmux, Terminal or iTerm can be answered from here.</div>
    <div class="btns">${portalButton(s)}</div></div>`;
  const multi = s.host === "cmux";
  return `<form class="orders" id="orders"><label class="lbl" for="reply">Send word</label>
    <textarea id="reply" placeholder="${s.state === "cast" ? "It's casting. Your word waits until it finishes…" : multi ? "Type your reply. Paste or drop images too…" : "Type your reply…"}" ${multi ? "" : 'rows="2"'}></textarea>
    <div class="attach" id="attach"></div>
    <div class="via">Typed into its ${esc(s.where)} prompt as if you were there.${multi ? " Images arrive as attachments, like pasting into Claude." : " One line, no images, for now."} If you've left a half-typed draft there, Arcanum won't touch it.</div>
    <div class="btns"><button class="btn" type="submit">Send word</button>${portalButton(s)}
    <span class="hint"><kbd>⌘</kbd> + <kbd>⏎</kbd> send</span></div></form>`;
}
const drafts = {};   // unsent text per mage survives live re-renders
const pics = {};     // pasted images per mage: [{ id?, url, busy }]
function renderAttach(s) {
  const el = $("#attach"); if (!el) return;
  el.innerHTML = (pics[s.id] ?? []).map((p, i) => `<span class="thumb${p.busy ? " busy" : ""}"><img src="${p.url}" alt="Attached image ${i + 1}"><button type="button" data-unpic="${i}" aria-label="Remove image ${i + 1}">×</button></span>`).join("");
  el.querySelectorAll("[data-unpic]").forEach(b => b.onclick = () => { const [p] = pics[s.id].splice(Number(b.dataset.unpic), 1); URL.revokeObjectURL(p.url); renderAttach(s); });
}
async function addImages(s, files) {
  if (s.host !== "cmux") return toast("Images can only be sent to cmux sessions so far.");
  const list = (pics[s.id] ??= []);
  for (const f of files) {
    if (list.length >= 5) { toast("Up to 5 images per message."); break; }
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name || "That image"} is over 10 MB.`); continue; }
    const p = { url: URL.createObjectURL(f), busy: true }; list.push(p); renderAttach(s);
    try {
      const r = await fetch("/api/uploads", { method: "POST", headers: { "content-type": f.type || "application/octet-stream" }, body: f });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      p.id = j.id; p.busy = false;
    } catch (e) { list.splice(list.indexOf(p), 1); toast(e.message || "Couldn't attach that image."); }
    renderAttach(s);
  }
}
async function post(url, body) {
  try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, message: "The Arcanum daemon isn't answering." }; }
}
function wireComms(s) {
  const ex = $("#exlist");
  if (ex) { ex.scrollTop = ex.scrollHeight; ex.onclick = e => e.target.closest("li")?.classList.toggle("open"); }
  const f = $("#orders");
  if (f) {
    const ta = $("#reply");
    ta.value = drafts[s.id] ?? "";
    ta.oninput = () => { drafts[s.id] = ta.value; };
    renderAttach(s);
    const imagesIn = dt => [...(dt?.files ?? [])].filter(f => f.type.startsWith("image/"));
    ta.onpaste = e => { const f = imagesIn(e.clipboardData); if (f.length) { e.preventDefault(); addImages(s, f); } };
    f.ondragover = e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith("image/"))) { e.preventDefault(); f.classList.add("dropping"); } };
    f.ondragleave = () => f.classList.remove("dropping");
    f.ondrop = e => { f.classList.remove("dropping"); const fl = imagesIn(e.dataTransfer); if (fl.length) { e.preventDefault(); addImages(s, fl); } };
    ta.onkeydown = e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async e => {
      e.preventDefault();
      const text = ta.value.trim(), imgs = pics[s.id] ?? [];
      if (imgs.some(p => p.busy)) return toast("Still attaching images…");
      if (!text && !imgs.length) return toast("Write something first");
      const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
      const r = await post(`/api/sessions/${encodeURIComponent(s.id)}/send`, { text, images: imgs.map(p => p.id) });
      toast(r.message ?? r.error);
      if (r.ok) { burst(document.querySelector(`.mage[data-session="${CSS.escape(s.id)}"] canvas`), "word"); cue.word(); }
      if (r.ok) { delete drafts[s.id]; ta.value = ""; imgs.forEach(p => URL.revokeObjectURL(p.url)); delete pics[s.id]; renderAttach(s); }
      btn.disabled = false; btn.textContent = "Send word";
    };
  }
  document.querySelectorAll("[data-seal]").forEach(b => b.onclick = async () => {
    document.querySelectorAll("[data-seal]").forEach(x => x.disabled = true);
    const r = await post(`/api/sessions/${encodeURIComponent(s.id)}/seal`, { decision: b.dataset.seal });
    toast(r.message ?? r.error);
    if (r.ok) { const g = b.dataset.seal === "grant"; burst(document.querySelector(`.mage[data-session="${CSS.escape(s.id)}"] canvas`), g ? "grant" : "refuse"); g ? cue.grant() : cue.refuse(); }
    document.querySelectorAll("[data-seal]").forEach(x => x.disabled = false);
  });
  const req = $("#sealReq");
  if (req) fetch(`/api/sessions/${encodeURIComponent(s.id)}/seal`).then(r => r.json()).then(j => {
    if (!req.isConnected) return;
    req.textContent = j.request ? `${j.request}\n\n${j.question}` : "Couldn't read the prompt. Open the portal to see it.";
    req.style.whiteSpace = "pre-wrap";
  }).catch(() => {});
}

function renderComms(s) {
  const st = STATE[s.state];
  $("#comms").innerHTML = `<div class="dossier"><div class="portrait" id="portrait"></div><div>
      <h3>${esc(s.name)}<span class="actions"><button class="btn ghost small" data-dismiss="${esc(s.id)}">Dismiss</button></span></h3>
      <dl><dt>RANK</dt><dd>${RANK[s.model].title} · ${esc(prettyModel(s.modelId) ?? RANK[s.model].model)}</dd>
      <dt>STATE</dt><dd><span class="chip ${st.cls}">${st.label.toUpperCase()}</span> for ${ago(s.since)}</dd>
      <dt>DWELLS IN</dt><dd>${esc(s.where)}${s.unreachable ? ` <span class="chip rest" title="Its pane or tab couldn't be found">UNREACHABLE</span>` : ""}</dd>
      <dt>FOLDER</dt><dd class="crumb">${esc(home(s.cwd))}${s.branch ? ` · ${esc(s.branch)}` : ""}</dd></dl></div></div>
    ${s.note ? `<div class="via">${esc(s.note)}</div>` : ""}
    ${s.title ? `<div class="soon-note">Quest: <b style="color:var(--parch)">${esc(s.title)}</b></div>` : ""}
    <div class="paper brief"><span class="lbl">The matter at hand</span><p>${esc(s.briefing)}</p></div>
    <div class="paper xmit${s.state === "cast" ? " casting" : ""}"><span class="lbl">Latest missive</span>${missive(s.lastText)}</div>
    ${exchangeBlock(s)}
    ${s.state === "seal" ? sealBlock(s) : wordBlock(s)}`;
  $("#portrait").appendChild(makeMage(s, 1, `${RANK[s.model].title} ${s.name}`));
  wireComms(s);
}

/* ---------------- charter: edits go to ~/.arcanum/realms.json via the daemon ---------------- */
async function edit(url, method, body) {
  try {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "That didn't work");
    return j;
  } catch (e) { toast(e.message); return null; }
}
function renderCharter(r) {
  const others = data.realms.filter(x => x.id !== r.id && x.id !== "wilds"), el = $("#charter");
  el.innerHTML = `<h3>Realm charter</h3>
    <p class="via" style="margin:0">Arcanum picked this landmark and banner when it discovered the realm. Change them here. Edits are saved to <code>~/.arcanum/realms.json</code>.</p>
    <div class="grid">
      <div><label class="lbl" for="rname">Name</label><input type="text" id="rname" value="${esc(r.name)}" maxlength="60"></div>
      <div><span class="lbl">Banner</span><div class="choices">${BANNERS.map(c => `<button class="sw" data-banner="${c}" style="background:${c}" aria-label="Banner ${c}" aria-pressed="${c === r.banner}"></button>`).join("")}</div></div>
      <div style="grid-column:1/-1"><span class="lbl">Landmark</span><div class="choices" id="lmChoices"></div></div>
      <div><span class="lbl">Lands (folders and repos in this realm)</span><ul class="landlist">${r.lands.map(l => `<li>${esc(home(l))}</li>`).join("")}</ul>
        <label class="lbl" for="merge">Absorb another realm</label>
        <select id="merge"><option value="">Choose a realm…</option>${others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}</select></div>
    </div>`;
  for (const [k, v] of Object.entries(LANDMARKS)) {
    const b = document.createElement("button"); b.className = "choice"; b.setAttribute("aria-pressed", String(k === r.landmark));
    b.appendChild(makeLandmark(k, r.banner, 2)); b.insertAdjacentHTML("beforeend", `<span>${v.label}</span>`); $("#lmChoices").appendChild(b);
    b.onclick = () => edit(`/api/realms/${r.id}`, "PATCH", { landmark: k });
  }
  el.querySelectorAll("[data-banner]").forEach(b => b.onclick = () => edit(`/api/realms/${r.id}`, "PATCH", { banner: b.dataset.banner }));
  $("#rname").onchange = e => edit(`/api/realms/${r.id}`, "PATCH", { name: e.target.value });
  $("#merge").onchange = async e => {
    const o = realmOf(e.target.value); if (!o) return;
    if (await edit(`/api/realms/${r.id}/absorb`, "POST", { other: o.id })) toast(`${o.name} absorbed into ${r.name}`);
  };
}

/* ---------------- dialogs ---------------- */
const modal = $("#modal"), modalForm = $("#modalForm");
function openModal(html, wire) {
  modalForm.innerHTML = html;
  return new Promise(done => {
    modal.onclose = () => done(modal.returnValue === "ok" ? (wire?.collect?.() ?? true) : null);
    wire?.init?.();
    modal.showModal();
  });
}
async function dismissMage(id) {
  const s = data.sessions.find(x => x.id === id); if (!s) return;
  const ok = await openModal(`<h3 id="modalTitle">Dismiss ${esc(s.name)}?</h3>
    <p>It leaves Arcanum's map, realm and ravens for good. <b>The session itself is not closed</b>: it keeps running in ${esc(s.where)}.</p>
    <p>Changed your mind later? Restore it from <b>Dismissed mages</b> in the sidebar.</p>
    <div class="btns"><button class="btn alt" value="cancel">Keep it</button><button class="btn deny" value="ok" autofocus>Dismiss</button></div>`);
  if (!ok) return;
  const r = await post(`/api/sessions/${encodeURIComponent(id)}/dismiss`, {});
  toast(r.message ?? r.error);
}
document.addEventListener("click", e => { const b = e.target.closest("[data-dismiss]"); if (b) { e.stopPropagation(); dismissMage(b.dataset.dismiss); } });

const RANK_ORDER = ["haiku", "sonnet", "opus", "fable"];
async function summonDialog(realmId) {
  const realms = data.realms.filter(r => r.lands.length);
  if (!realms.length) return toast("No realm has a folder to summon into yet.");
  let rid = realms.some(r => r.id === realmId) ? realmId : realms[0].id, model = "sonnet";
  const landsOf = id => realms.find(r => r.id === id)?.lands ?? [];
  const landOptions = id => landsOf(id).map(l => `<option value="${esc(l)}">${esc(home(l))}</option>`).join("");
  const res = await openModal(`<h3 id="modalTitle">Summon a mage</h3>
    ${realmId && realms.some(r => r.id === realmId) ? `<p>A new Claude session in <b>${esc(realmOf(rid).name)}</b>, opened in a new cmux workspace.</p>`
      : `<label class="lbl" for="sumRealm">Realm</label><select id="sumRealm">${realms.map(r => `<option value="${esc(r.id)}"${r.id === rid ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select>`}
    <span class="lbl">Rank</span><div class="ranks" role="radiogroup" aria-label="Rank" id="sumRanks"></div>
    <div id="sumLandRow"${landsOf(rid).length > 1 ? "" : " hidden"}><label class="lbl" for="sumLand">Folder</label><select id="sumLand">${landOptions(rid)}</select></div>
    <label class="lbl" for="sumPrompt">First words <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
    <textarea id="sumPrompt" placeholder="What should it start on?"></textarea>
    <label class="check"><input type="checkbox" id="sumFocus"${prefs.summonFocus ? " checked" : ""}> Switch to it in cmux now <span style="color:var(--muted)">(otherwise it starts in the background)</span></label>
    <div class="btns"><button class="btn alt" value="cancel">Cancel</button><button class="btn" value="ok">Summon</button></div>`, {
    init() {
      const box = $("#sumRanks");
      for (const k of RANK_ORDER) {
        const b = document.createElement("button"); b.type = "button"; b.className = "rank"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(k === model));
        b.appendChild(makeMage({ id: "summon-" + k, model: k, state: "rest" }, 1, RANK[k].title));
        b.insertAdjacentHTML("beforeend", `<span>${RANK[k].title}</span><small>${RANK[k].model}</small>`);
        b.onclick = () => { model = k; box.querySelectorAll(".rank").forEach(x => x.setAttribute("aria-checked", String(x === b))); };
        box.appendChild(b);
      }
      const rs = $("#sumRealm");
      if (rs) rs.onchange = () => { rid = rs.value; $("#sumLand").innerHTML = landOptions(rid); $("#sumLandRow").hidden = landsOf(rid).length < 2; };
    },
    collect: () => { prefs.summonFocus = $("#sumFocus").checked; applyPrefs(); return { land: $("#sumLand").value, prompt: $("#sumPrompt").value, focus: prefs.summonFocus }; },
  });
  if (!res) return;
  const r = await post(`/api/realms/${encodeURIComponent(rid)}/summon`, { model, ...res });
  toast(r.message ?? r.error);
}
$("#navSummon").onclick = () => summonDialog(ui.view === "realm" ? ui.realm : null);

function renderGrim() {
  const box = $("#grimBox");
  box.innerHTML = `<div class="rowx"><span>Chiptune sounds</span><button class="switch" role="switch" id="gSound" aria-checked="${prefs.sound}" aria-label="Chiptune sounds"></button></div>
    <div class="rowx"${prefs.sound ? "" : " hidden"}><label for="gVol">Volume</label><input type="range" id="gVol" min="0.1" max="1" step="0.1" value="${prefs.volume}"></div>
    <div class="rowx"><label for="gMotion">Motion</label><select id="gMotion">
      <option value="auto"${prefs.motion === "auto" ? " selected" : ""}>Follow macOS</option><option value="full"${prefs.motion === "full" ? " selected" : ""}>Full spellwork</option><option value="calm"${prefs.motion === "calm" ? " selected" : ""}>Calm (no motion)</option></select></div>
    <button class="btn ghost small" id="gPreview" type="button">Preview a raven</button>`;
  $("#gPreview").onclick = () => {
    const here = ui.view === "realm" ? troopsOf(ui.realm) : data.sessions;
    const s = here.find(x => x.id === ui.session) ?? here[0];
    s ? playEvents([{ kind: "counsel", s }]) : toast("No mages to preview with.");
  };
  $("#gSound").onclick = () => { prefs.sound = !prefs.sound; applyPrefs(); renderGrim(); if (prefs.sound) cue.test(); };
  const vol = $("#gVol"); if (vol) vol.onchange = () => { prefs.volume = Number(vol.value); applyPrefs(); cue.test(); };
  $("#gMotion").onchange = e => { prefs.motion = e.target.value; applyPrefs(); };
}
$("#navGrim").onclick = () => { const b = $("#grimBox"); b.hidden = !b.hidden; if (!b.hidden) renderGrim(); };

function renderGone() {
  const g = data.dismissed ?? [];
  $("#goneCount").textContent = String(g.length);
  $("#goneList").innerHTML = g.map(d => `<li><span>${esc(d.name)}<small>${esc(realmOf(d.realmId)?.name ?? d.realmId)} · ${d.alive ? "still running" : "ended"} · dismissed ${ago(d.at) === "now" ? "just now" : ago(d.at) + " ago"}</small></span>
    <button class="btn ghost small" data-restore="${esc(d.id)}">Restore</button></li>`).join("") || `<li><small>No one has been dismissed.</small></li>`;
}
$("#navGone").onclick = () => { $("#goneBox").hidden = !$("#goneBox").hidden; renderGone(); };
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-restore]"); if (!b) return;
  const r = await post(`/api/sessions/${encodeURIComponent(b.dataset.restore)}/restore`, {}); toast(r.message ?? r.error);
});

/* ---------------- routing: the URL remembers where you are, so a refresh keeps you there ---------------- */
function setRoute(push) {
  const h = ui.view === "realm" ? `#/realm/${encodeURIComponent(ui.realm)}${ui.session ? "/" + encodeURIComponent(ui.session) : ""}` : "#/";
  if (location.hash !== h) history[push ? "pushState" : "replaceState"](null, "", h);
}
function route() {
  const m = /^#\/realm\/([^/]+)(?:\/([^/]+))?$/.exec(location.hash);
  const rid = m && decodeURIComponent(m[1]), sid = m?.[2] && decodeURIComponent(m[2]);
  if (rid && realmOf(rid)) openRealm(rid, sid && data.sessions.some(s => s.id === sid) ? sid : undefined, true);
  else renderMap(true);
}
addEventListener("popstate", route);

/* ---------------- navigation ---------------- */
function nextRequest() {
  const q = data.sessions.filter(needsYou).sort((a, b) => b.since - a.since);
  if (!q.length) return toast("No one is waiting on you");
  const i = ui.view === "realm" ? (q.findIndex(s => s.id === ui.session) + 1) % q.length : 0;
  ui.view === "map" ? travel(q[i].realmId, q[i].id) : openRealm(q[i].realmId, q[i].id);
}
function goSession(id) { const s = data.sessions.find(x => x.id === id); if (!s) return; ui.view === "map" ? travel(s.realmId, s.id) : openRealm(s.realmId, s.id); }
let tt; function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, 2600); }

document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) goSession(g.dataset.go); });
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#scryBox").hidden = false; $("#scry").focus(); return; }
  if (e.target.matches("textarea, input, select")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n" || e.key === "N") return nextRequest();
  if (ui.view === "map" && map) {
    const n = data.realms.length, mv = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (mv !== undefined && n) { e.preventDefault(); map.select((map.selected + mv + n) % n); }
    if (e.key === "0") map.fit();
    if (e.key === "+" || e.key === "=") map.zoom(1.35);
    if (e.key === "-") map.zoom(1 / 1.35);
  } else if (ui.view === "realm") {
    if (e.key === "Escape") return goMap();
    if (e.key === "r" || e.key === "R") { const t = $("#reply"); if (t) { e.preventDefault(); t.focus(); } return; }
    if (e.key === "p" || e.key === "P") { const b = document.querySelector("[data-portal]"); if (b) openPortal(b.dataset.portal, b); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); const ids = [...document.querySelectorAll(".crow")].map(b => b.dataset.session);
      const i = ids.indexOf(ui.session) + (e.key === "ArrowDown" ? 1 : -1);
      if (ids[i]) { ui.session = ids[i]; renderRealm(); document.querySelector(".crow.sel")?.focus(); }
    }
  }
});

/* ---------------- live data ---------------- */
/* what changed since the last update, worth a raven: a mage starting to ask for you, or a new mage arriving */
let prevStates = null;
function eventsFrom(next) {
  const was = prevStates, now = new Map(next.sessions.map(s => [s.id, s.state]));
  prevStates = now;
  if (!was) return [];
  const ev = [];
  for (const s of next.sessions) {
    const before = was.get(s.id);
    if (needsYou(s) && before !== s.state && !(before && needsYou({ state: before }))) ev.push({ kind: s.state, s });
    else if (before === undefined) ev.push({ kind: "arrive", s });
  }
  return ev;
}
function playEvents(ev) {
  for (const e of ev.slice(0, 4)) {
    const site = document.querySelector(`.site[data-realm="${CSS.escape(e.s.realmId)}"]`);
    const mage = document.querySelector(`.mage[data-session="${CSS.escape(e.s.id)}"] canvas`);
    const from = mage ?? site?.querySelector("canvas") ?? document.querySelector(".realm-top h2");
    if (e.kind === "arrive") { burst(from, "arrive"); continue; }
    e.kind === "seal" ? cue.seal() : cue.counsel();
    if (site) { pulse(site.querySelector("canvas"), e.kind === "seal" ? "#f2c14e" : "#ef5470"); site.classList.add("called"); setTimeout(() => site.classList.remove("called"), 1500); }
    if (mage) { mage.closest(".mage").classList.add("alerted"); burst(mage, "alert"); }
    const to = document.querySelector(`#feed [data-go="${CSS.escape(e.s.id)}"]`);
    raven(from, to, () => { to?.classList.add("arrived"); setTimeout(() => to?.classList.remove("arrived"), 1300); });
  }
}

function onData(next) {
  const prevRealms = JSON.stringify(data.realms), prevSessions = JSON.stringify(data.sessions);
  const ev = eventsFrom(next);
  data = next;
  const realmsChanged = JSON.stringify(data.realms) !== prevRealms, sessionsChanged = JSON.stringify(data.sessions) !== prevSessions;
  renderGone();
  if (!realmsChanged && !sessionsChanged) return;
  if (modal.open) return renderSide();   // don't rebuild the view under an open dialog
  if (ui.view === "map") {
    if (!map || !$("#mapwrap")) { renderMap(true); return playEvents(ev); }
    map.update(realmsOrdered()); renderLatest(data.sessions.filter(needsYou).sort((a, b) => b.since - a.since)[0]); renderSide();
    playEvents(ev);
  } else {
    // don't yank the charter out from under someone typing a name
    if (document.activeElement?.id === "rname") return renderSide();
    const typing = document.activeElement?.id === "reply";
    const sc = $("#view").scrollTop; renderRealm(); $("#view").scrollTop = sc;
    if (typing) { const t = $("#reply"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
    playEvents(ev);
  }
}
function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = e => { $("#live").classList.remove("off"); $("#live").textContent = "LIVE · READ-ONLY"; onData(JSON.parse(e.data)); };
  es.onerror = () => { $("#live").classList.add("off"); $("#live").textContent = "DAEMON NOT RUNNING · RETRYING"; };
}

/* animation clock + relative times */
const logo = $("#logoSprite"); const drawLogo = fr => renderSprite(logo, 38, 54, 1.25, c => drawMage(c, "fable", "cast", fr));
drawLogo(0);
setInterval(() => { if (motionOK()) { tick(); drawLogo(performance.now() / 260 | 0); } }, 260);
setInterval(renderSide, 30000);

fetch("/api/state").then(r => r.json()).then(d => { data = d; eventsFrom(d); route(); }).catch(() => renderMap(true)).finally(connect);
