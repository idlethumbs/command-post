import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanText, gridText, parseScreen, replyCapability, sealCapability } from "../src/send";
import type { Session } from "../src/types";

const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n), "utf8");

test("an empty prompt is ready for input", () => {
  expect(parseScreen(fx("screen-idle.txt"))).toEqual({ kind: "input", draft: "" });
});

test("a half-typed draft is detected, across lines", () => {
  expect(parseScreen(fx("screen-draft.txt"))).toEqual({ kind: "input", draft: "Do not reply yet. Line one\nescaped: A" });
});

test("a permission dialog yields the request and the yes/no keys", () => {
  expect(parseScreen(fx("screen-permission.txt"))).toEqual({
    kind: "permission", request: "Bash command\ntouch arcanum-seal-test.txt\nCreate an empty file named arcanum-seal-test.txt", question: "Do you want to proceed?", yes: "1", no: "3",
  });
  expect(parseScreen(fx("screen-permission-2opt.txt"))).toMatchObject({ kind: "permission", yes: "1", no: "2", request: "Edit file\nsrc/app.ts" });
});

test("anything else is unknown", () => {
  expect(parseScreen("$ ls\nfoo bar\n").kind).toBe("unknown");
});

test("text is cleaned of control characters and capped", () => {
  expect(cleanText("hi\u0007 there\r\n\tok\u001b[31m")).toBe("hi there\n\tok[31m");
  expect(cleanText("x".repeat(9000))).toHaveLength(8000);
});

const s = (host: Session["host"]): Session => ({ id: "s", pid: 1, realmId: "r", name: "n", model: "opus", state: "counsel", since: 1, host, where: host, briefing: "", cwd: "/p" });
test("only typeable terminals can be replied to; only cmux and tmux can be granted a seal", () => {
  expect(["cmux", "terminal", "iterm", "tmux", "warp", "vscode", "bg"].map(h => replyCapability(s(h as Session["host"]), true)))
    .toEqual(["type", "type", "type", "type", "none", "none", "none"]);
  expect(replyCapability(s("cmux"), false)).toBe("none");
  expect(["cmux", "tmux", "terminal", "warp"].map(h => sealCapability(s(h as Session["host"]), true))).toEqual([true, true, false, false]);
});

test("cmux grid: faint suggestion text in the prompt is not a draft", () => {
  const grid = JSON.parse(fx("cmux-replay-ghost.json"));
  const { text, solid } = gridText(grid);
  expect(parseScreen(text)).toEqual({ kind: "input", draft: "ls -la" });   // what plain text sees
  expect(parseScreen(solid)).toEqual({ kind: "input", draft: "" });        // what Arcanum uses
});

test("cmux grid: a live permission dialog is recognised (regression: words were padded apart)", () => {
  const { text } = gridText(JSON.parse(fx("cmux-replay-permission.json")));
  expect(parseScreen(text)).toMatchObject({ kind: "permission", question: "Do you want to proceed?", yes: "1", no: "3" });
  expect(text).toContain("2. Yes, and always allow access to");
});
