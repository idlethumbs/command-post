import { describeRequest, type HookStore } from "./hooks";
import type { Session } from "./types";

/** Fold what hooks and the status line reported into the snapshot. Without hooks this changes nothing. */
export function applyIntel(sessions: Session[], store: HookStore) {
  for (const s of sessions) {
    const i = store.intel.get(s.id), held = store.pending.get(s.id);
    if (i?.cmuxSurface) s.link = { cmuxSurface: i.cmuxSurface, cmuxWorkspace: i.cmuxWorkspace };
    if (held) {   // a permission request waiting for you in Arcanum: answerable whatever the terminal
      s.state = "seal"; s.since = held.at; s.seal = true; s.sealVia = "hook"; s.request = describeRequest(held.tool, held.input);
    } else if (s.state === "seal" && s.seal) s.sealVia = "keys";
    if (i?.turnEndedAt && (s.state === "counsel" || s.state === "rest") && i.turnEndedAt >= (i.promptAt ?? 0)) s.since = i.turnEndedAt;
    const st = i?.status;
    if (st?.pct !== undefined) {
      const window = st.window ?? s.mana?.window ?? 200_000;
      s.mana = { used: st.used ?? Math.round(window * st.pct / 100), window, pct: Math.min(100, Math.round(st.pct)), inferred: !st.window };
    }
    if (st?.costUsd !== undefined) s.costUsd = st.costUsd;
  }
}
