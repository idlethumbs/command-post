import { existsSync, statSync } from "node:fs";
import type { Step } from "./portal";
import type { Model, Realm } from "./types";

const TITLES: Record<Model, string> = { haiku: "Apprentice", sonnet: "Magician", opus: "Sorcerer", fable: "Archmage" };
export interface SummonReq { model: Model; land: string; prompt?: string; focus: boolean }

/** POSIX single-quote: the only character that needs care inside '…' is ' itself. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A new session in one of the realm's folders, in a fresh cmux workspace. `cmux --command` runs through a shell, hence the quoting. */
export function planSummon(r: Realm, q: SummonReq, cmux?: { bin: string; app: string }): { steps: Step[]; message: string } | { error: string } {
  if (!r.lands.length) return { error: `${r.name} has no lands to summon into.` };
  if (!(q.model in TITLES)) return { error: "Pick a rank: Apprentice, Magician, Sorcerer or Archmage." };
  if (!r.lands.includes(q.land)) return { error: `That folder isn't one of ${r.name}'s lands.` };
  if (!existsSync(q.land) || !statSync(q.land).isDirectory()) return { error: "That folder no longer exists." };
  if (!cmux) return { error: "Summoning needs cmux, and Arcanum couldn't find it." };
  const prompt = (q.prompt ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 4000);
  const command = `claude --model ${q.model}${prompt ? " " + shellQuote(prompt) : ""}`;
  const steps: Step[] = [{ cmd: cmux.bin, args: ["new-workspace", "--name", `${r.name} · ${TITLES[q.model]}`.slice(0, 60), "--cwd", q.land, "--command", command, "--focus", String(q.focus)] }];
  if (q.focus) steps.push({ cmd: "open", args: ["-a", cmux.app] });
  return { steps, message: `Summoning ${/^[AEIOU]/.test(TITLES[q.model]) ? "an" : "a"} ${TITLES[q.model]} into ${r.name}…` };
}
