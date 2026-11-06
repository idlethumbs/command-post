/* macOS notifications for ravens, sent from the Arcanum window while it isn't focused.
   They need an open Arcanum window (even in the background): nothing runs at login. */
const ICON = "/ui/arcanum-icon.png";
const VERB = { counsel: "seeks counsel", seal: "awaits your seal" };
const clip = (t, n) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** Which ravens a setting lets through: "off", "seals" or "all". */
export const wanted = (level, kind) => level === "all" ? kind === "counsel" || kind === "seal" : level === "seals" ? kind === "seal" : false;

/** The notifications for one update: one per mage (its tag replaces an older one), or one summary for a crowd. */
export function notices(events, realmName, max = 3) {
  if (!events.length) return [];
  if (events.length > max) {
    const seals = events.filter(e => e.kind === "seal").length;
    return [{ id: events[0].s.id, tag: "arcanum-many", title: `${events.length} mages need you`,
      body: seals ? `${seals} await your seal · ${events.length - seals} seek counsel` : events.map(e => e.s.name).slice(0, 4).join(", ") }];
  }
  return events.map(({ kind, s }) => ({
    id: s.id, tag: `arcanum-${s.id}`, title: `${s.name} ${VERB[kind]}`,
    body: [realmName(s.realmId), clip(kind === "seal" ? s.request || s.waitingFor || "Wants permission" : s.lastText || s.briefing, 140)].filter(Boolean).join(" · "),
  }));
}

export const permission = () => typeof Notification === "undefined" ? "unsupported" : Notification.permission;
export async function ask() { return permission() === "default" ? Notification.requestPermission() : permission(); }

/** Shows notices unless Arcanum is focused; clicking one brings the window forward and opens the mage. */
export function notify(list, open, preview = false) {
  if (permission() !== "granted" || (document.hasFocus() && !preview)) return;
  for (const n of list) {
    const note = new Notification(n.title, { body: n.body, tag: n.tag, renotify: true, icon: ICON });
    note.onclick = () => { window.focus(); open(n.id); note.close(); };
  }
}
