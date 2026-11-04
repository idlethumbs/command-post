export type Model = "haiku" | "sonnet" | "opus" | "fable";
export type MageState = "counsel" | "seal" | "cast" | "rest";
export type Host = "cmux" | "warp" | "iterm" | "tmux" | "ghostty" | "terminal" | "vscode" | "bg" | "unknown";

export interface ProcInfo { ppid: number; tty?: string; lstart: string; comm: string }
export type ProcTable = Map<number, ProcInfo>;

export interface RegistryEntry {
  pid: number; sessionId: string; cwd: string; kind: string; entrypoint: string; name: string;
  status: string; waitingFor?: string; statusUpdatedAt: number; procStart: string; parkedJobId?: string; version?: string;
  jobId?: string; tmux?: string;
}

export interface TranscriptSummary {
  model?: string; aiTitle?: string; gitBranch?: string; lastHumanAt?: number; cwd?: string; entrypoint?: string;
  awaySummary?: { text: string; at: number };
  lastAssistantText?: { text: string; at: number };
  recent?: Exchange[];
}
/** One message in the conversation, as you'd see it: your words or the mage's reply (tool chatter left out). */
export interface Exchange { who: "you" | "mage"; text: string; at: number; images?: number }

export interface Realm {
  id: string; name: string; lands: string[]; landmark: string; banner: string;
  pos: { x: number; y: number }; discoveredAt: number;
}

export interface Session {
  id: string; pid: number; realmId: string; name: string; title?: string; model: Model; modelId?: string;
  state: MageState; since: number; host: Host; where: string; briefing: string; lastText?: string;
  waitingFor?: string; cwd: string; branch?: string;
  jobId?: string; tmux?: string; portal?: "exact" | "app" | "none"; note?: string;
  recent?: Exchange[];
  status?: string; reply?: "type" | "none"; seal?: boolean; unreachable?: boolean; promote?: boolean;
}

export interface DismissedMage { id: string; name: string; realmId: string; at: number; alive: boolean }
/** A session whose process has ended but whose conversation can be resumed. */
export interface DepartedMage { id: string; realmId: string; name: string; title?: string; model: Model; modelId?: string; endedAt: number;
  cwd: string; branch?: string; briefing: string; lastText?: string; recent?: Exchange[]; promote?: boolean }
export interface Snapshot { generatedAt: number; realms: Realm[]; sessions: Session[]; dismissed?: DismissedMage[]; departed?: DepartedMage[] }
