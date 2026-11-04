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
  model?: string; aiTitle?: string; gitBranch?: string; lastHumanAt?: number;
  awaySummary?: { text: string; at: number };
  lastAssistantText?: { text: string; at: number };
}

export interface Realm {
  id: string; name: string; lands: string[]; landmark: string; banner: string;
  pos: { x: number; y: number }; discoveredAt: number;
}

export interface Session {
  id: string; pid: number; realmId: string; name: string; title?: string; model: Model; modelId?: string;
  state: MageState; since: number; host: Host; where: string; briefing: string; lastText?: string;
  waitingFor?: string; cwd: string; branch?: string;
  jobId?: string; tmux?: string; portal?: "exact" | "app" | "none"; note?: string;
  status?: string; reply?: "type" | "none"; seal?: boolean;
}

export interface Snapshot { generatedAt: number; realms: Realm[]; sessions: Session[] }
