/* Arcanum UI: live, read-only view of your Claude Code sessions. Data comes from the local daemon over SSE. */
import { BANNERS, BIOME, LANDMARKS, RANK, STATE, buildBackdrop, drawMage, makeLandmark, makeMage, renderSprite, tick, tint } from "./art.js";
import { createMap } from "./map.js";

const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
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

/* tiny, safe markdown for the latest missive: paragraphs, bullets, headings, `code`, **bold** */
function missive(md) {
  if (!md) return "<p>No word yet.</p>";
  const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const out = []; let list = null;
  for (const block of md.replace(/```[\s\S]*?```/g, m => "`" + m.slice(3, -3).trim().split("\n").slice(-3).join(" ⏎ ") + "`").split(/\n{2,}/)) {
    for (const line of block.split("\n")) {
      const li = /^\s*(?:[-*]|\d+\.)\s+(.*)/.exec(line), h = /^#{1,6}\s+(.*)/.exec(line);
      if (li) { if (!list) { list = []; } list.push(`<li>${inline(li[1])}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
      if (h) out.push(`<h4>${inline(h[1])}</h4>`); else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
  }
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
  scry();
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
function renderMap() {
  ui.view = "map";
  const newest = data.sessions.filter(needsYou).sort((a, b) => b.since - a.since)[0];
  $("#view").innerHTML = data.realms.length ? `<div class="mapwrap" id="mapwrap"></div>` :
    `<div class="mapwrap"><div class="empty"><div><h2 style="font-family:var(--f-display);font-weight:400;font-size:40px;margin:0">No realms yet</h2><p>Start a Claude Code session in any project and its realm appears here.</p></div></div></div>`;
  if (!data.realms.length) { map = null; return renderSide(); }
  const wrap = $("#mapwrap");
  map = createMap(wrap, { onOpen: travel, siteContent });
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
function travel(rid, sid) { if (!map) return openRealm(rid, sid); map.flyTo(rid, () => openRealm(rid, sid), still); }
function goMap() { renderMap(); }

/* ---------------- realm view ---------------- */
function openRealm(rid, sid) {
  const t = troopsOf(rid).sort(byNeed);
  ui.view = "realm"; ui.realm = rid; ui.session = sid || t[0]?.id || null; ui.charter = false;
  renderRealm(true); $("#view").scrollTop = 0;
}
function renderRealm(entering) {
  const r = realmOf(ui.realm);
  if (!r) return goMap();
  const biome = LANDMARKS[r.landmark]?.biome ?? "meadow", B = BIOME[biome];
  const t = troopsOf(r.id).sort(byNeed);
  if (!t.some(s => s.id === ui.session)) ui.session = t[0]?.id ?? null;
  const cur = t.find(s => s.id === ui.session); if (cur) markSeen(cur);
  document.documentElement.style.setProperty("--portrait-bg", `linear-gradient(180deg, ${B.sky[0]}, ${B.sky[1]} 62%, ${B.ramp[3]} 62%, ${B.ramp[1]})`);
  $("#view").innerHTML = `<div class="realm${entering ? " in" : ""}">
    <div class="realm-top"><button class="btn ghost" id="back">◀ World map</button><h2 style="color:${tint(r.banner, .15)}">${esc(r.name)}</h2>
      <span class="meta">${r.lands.length || "no"} ${r.lands.length === 1 ? "land" : "lands"} · ${t.length} ${t.length === 1 ? "mage" : "mages"}</span>
      <div class="right"><span class="meta"><kbd>↑</kbd><kbd>↓</kbd> mage · <kbd>R</kbd> reply · <kbd>P</kbd> portal · <kbd>esc</kbd> map</span>
      ${r.id === "wilds" ? "" : `<button class="btn alt" id="editRealm" aria-expanded="${ui.charter}">${ui.charter ? "Close charter" : "Edit realm"}</button>`}</div></div>
    ${ui.charter ? `<section class="card charter" id="charter"></section>` : ""}
    <section class="scene" id="scene" aria-label="Mages in ${esc(r.name)}"><div class="troupe" id="troupe"></div></section>
    ${t.length ? `<div class="op"><section class="card circle" aria-label="Mages"><span class="lbl">Circle · ${t.length}</span><div id="circle"></div></section>
      <section class="card comms" id="comms" aria-live="polite"></section></div>`
      : `<section class="card comms"><p>No mages are in this realm right now. It stays on the map so you can find it again.</p></section>`}</div>`;
  $("#back").onclick = goMap;
  const ed = $("#editRealm"); if (ed) ed.onclick = () => { ui.charter = !ui.charter; renderRealm(); };
  const sc = $("#scene"), bd = buildBackdrop(Math.max(40, Math.round(sc.clientWidth / 3)), 100, biome);
  bd.className = "backdrop"; bd.setAttribute("aria-hidden", "true"); sc.prepend(bd);
  const lm = makeLandmark(r.landmark, r.banner, 3, 2); lm.className = "landmark"; sc.insertBefore(lm, $("#troupe"));
  for (const s of t) {
    const b = document.createElement("button"); b.className = "mage" + (s.id === ui.session ? " sel" : ""); b.dataset.session = s.id;
    b.appendChild(makeMage(s, 3, `${RANK[s.model].title} ${s.name}: ${STATE[s.state].label}`));
    b.insertAdjacentHTML("afterbegin", `<span class="bubble ${STATE[s.state].cls}">${STATE[s.state].glyph}</span>`);
    b.insertAdjacentHTML("beforeend", `<span class="name">${esc(s.name)}</span>`);
    b.onclick = () => { ui.session = s.id; renderRealm(); };
    $("#troupe").appendChild(b);
  }
  const ci = $("#circle");
  if (ci) for (const s of t) {
    const b = document.createElement("button"); b.className = "crow" + (s.id === ui.session ? " sel" : ""); b.dataset.session = s.id;
    b.innerHTML = `<span><span class="cs">${esc(s.name)}</span><span class="rk">${RANK[s.model].title} · ${ago(s.since)}</span></span><span class="chip ${STATE[s.state].cls}">${STATE[s.state].chip}</span>`;
    b.onclick = () => { ui.session = s.id; renderRealm(); };
    ci.appendChild(b);
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

function sealBlock(s) {
  if (!s.seal) return `<div class="orders"><span class="lbl">Asks for your seal</span><div class="req">A permission prompt is open in its terminal.</div>
    <div class="btns">${portalButton(s)}<span class="soon-note">${esc(s.where)} can't be sent keys, so answer it there.</span></div></div>`;
  return `<div class="orders"><span class="lbl">Asks for your seal</span><div class="req" id="sealReq">Reading the prompt…</div>
    <div class="btns"><button class="btn" data-seal="grant">Grant seal</button><button class="btn deny" data-seal="refuse">Refuse</button>${portalButton(s)}
    <span class="hint">Presses Yes or No in its prompt</span></div></div>`;
}
function wordBlock(s) {
  if (s.reply !== "type") return `<div class="orders"><span class="lbl">Send word</span>
    <div class="via">${esc(s.where)} can't be typed into from Arcanum. Open it to reply; sessions in cmux, Terminal or iTerm can be answered from here.</div>
    <div class="btns">${portalButton(s)}</div></div>`;
  const multi = s.host === "cmux";
  return `<form class="orders" id="orders"><label class="lbl" for="reply">Send word</label>
    <textarea id="reply" placeholder="${s.state === "cast" ? "It's casting. Your word waits until it finishes…" : "Type your reply…"}" ${multi ? "" : 'rows="2"'}></textarea>
    <div class="via">Typed into its ${esc(s.where)} prompt as if you were there.${multi ? "" : " One line only for now."} If you've left a half-typed draft there, Arcanum won't touch it.</div>
    <div class="btns"><button class="btn" type="submit">Send word</button>${portalButton(s)}
    <span class="hint"><kbd>⌘</kbd> + <kbd>⏎</kbd> send</span></div></form>`;
}
const drafts = {};   // unsent text per mage survives live re-renders
async function post(url, body) {
  try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, message: "The Arcanum daemon isn't answering." }; }
}
function wireComms(s) {
  const f = $("#orders");
  if (f) {
    const ta = $("#reply");
    ta.value = drafts[s.id] ?? "";
    ta.oninput = () => { drafts[s.id] = ta.value; };
    ta.onkeydown = e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async e => {
      e.preventDefault();
      const text = ta.value.trim(); if (!text) return toast("Write something first");
      const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
      const r = await post(`/api/sessions/${encodeURIComponent(s.id)}/send`, { text });
      toast(r.message ?? r.error);
      if (r.ok) { delete drafts[s.id]; ta.value = ""; }
      btn.disabled = false; btn.textContent = "Send word";
    };
  }
  document.querySelectorAll("[data-seal]").forEach(b => b.onclick = async () => {
    document.querySelectorAll("[data-seal]").forEach(x => x.disabled = true);
    const r = await post(`/api/sessions/${encodeURIComponent(s.id)}/seal`, { decision: b.dataset.seal });
    toast(r.message ?? r.error);
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
      <h3>${esc(s.name)}</h3>
      <dl><dt>RANK</dt><dd>${RANK[s.model].title} · ${esc(prettyModel(s.modelId) ?? RANK[s.model].model)}</dd>
      <dt>STATE</dt><dd><span class="chip ${st.cls}">${st.label.toUpperCase()}</span> for ${ago(s.since)}</dd>
      <dt>DWELLS IN</dt><dd>${esc(s.where)}</dd>
      <dt>FOLDER</dt><dd class="crumb">${esc(home(s.cwd))}${s.branch ? ` · ${esc(s.branch)}` : ""}</dd></dl></div></div>
    ${s.note ? `<div class="via">${esc(s.note)}</div>` : ""}
    ${s.title ? `<div class="soon-note">Quest: <b style="color:var(--parch)">${esc(s.title)}</b></div>` : ""}
    <div class="paper"><span class="lbl">The matter at hand</span><p>${esc(s.briefing)}</p></div>
    <div class="paper xmit${s.state === "cast" ? " casting" : ""}"><span class="lbl">Latest missive</span>${missive(s.lastText)}</div>
    ${s.state === "seal" ? sealBlock(s) : wordBlock(s)}`;
  $("#portrait").appendChild(makeMage(s, 3, `${RANK[s.model].title} ${s.name}`));
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
function onData(next) {
  const prevRealms = JSON.stringify(data.realms), prevSessions = JSON.stringify(data.sessions);
  data = next;
  const realmsChanged = JSON.stringify(data.realms) !== prevRealms, sessionsChanged = JSON.stringify(data.sessions) !== prevSessions;
  if (!realmsChanged && !sessionsChanged) return;
  if (ui.view === "map") {
    if (!map || !$("#mapwrap")) return renderMap();
    map.update(realmsOrdered()); renderLatest(data.sessions.filter(needsYou).sort((a, b) => b.since - a.since)[0]); renderSide();
  } else {
    // don't yank the charter out from under someone typing a name
    if (document.activeElement?.id === "rname") return renderSide();
    const typing = document.activeElement?.id === "reply";
    const sc = $("#view").scrollTop; renderRealm(); $("#view").scrollTop = sc;
    if (typing) { const t = $("#reply"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
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
if (!still) setInterval(() => { tick(); drawLogo(performance.now() / 260 | 0); }, 260);
setInterval(renderSide, 30000);

fetch("/api/state").then(r => r.json()).then(d => { data = d; renderMap(); }).catch(() => renderMap()).finally(connect);
