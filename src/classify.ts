import type { MageState, Model, RegistryEntry, TranscriptSummary } from "./types";

const ASKS = /\b(shall i|should i|do you want|would you like|which (one|option)|let me know|your call|ok(ay)? to proceed|awaiting (your )?(input|decision|approval|feedback))\b/i;

export const asksSomething = (text: string) => {
  const t = text.trim();
  return t.endsWith("?") || ASKS.test(t.slice(-300));
};

export function classify(e: RegistryEntry, t: TranscriptSummary): { state: MageState; since: number } {
  const since = e.statusUpdatedAt;
  if (e.status === "busy" || e.status === "shell") return { state: "cast", since };
  if (e.status === "waiting") return { state: e.waitingFor === "permission prompt" ? "seal" : "counsel", since };
  const last = t.lastAssistantText;
  const afterYou = last && (t.lastHumanAt === undefined || last.at >= t.lastHumanAt);
  return { state: last && afterYou && asksSomething(last.text) ? "counsel" : "rest", since };
}

export function modelOf(id: string | undefined): Model {
  for (const m of ["haiku", "sonnet", "opus", "fable"] as const) if (id?.includes(m)) return m;
  return "opus"; // the user's default model is opus[1m]
}
