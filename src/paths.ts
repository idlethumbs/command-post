import os from "node:os";
import path from "node:path";

export const CLAUDE_DIR = process.env.ARCANUM_CLAUDE_DIR ?? path.join(os.homedir(), ".claude");
export const ARCANUM_DIR = process.env.ARCANUM_DIR ?? path.join(os.homedir(), ".arcanum");
export const PORT = Number(process.env.ARCANUM_PORT ?? 7337);
