import { parsePs, detectHost, hostTty } from "../src/procs";

const PS = ` 100     1 ??       Tue Nov  3 15:28:45 2026     /Applications/cmux.app/Contents/MacOS/cmux
 200   100 ttys011  Tue Nov  3 15:28:50 2026     /bin/zsh
 300   200 ttys011  Tue Nov  3 15:29:00 2026     claude
 400     1 ??       Tue Nov  3 15:00:00 2026     /Applications/Warp.app/Contents/MacOS/stable
 500   400 ttys023  Tue Nov  3 15:01:00 2026     claude`;

test("parses ps rows", () => {
  const t = parsePs(PS);
  expect(t.get(300)).toEqual({ ppid: 200, tty: "ttys011", lstart: "Tue Nov 3 15:29:00 2026", comm: "claude" });
  expect(t.get(100)?.tty).toBeUndefined();
  expect(t.size).toBe(5);
});

test("walks parents to find the host terminal", () => {
  const t = parsePs(PS);
  expect(detectHost(t, 300)).toBe("cmux");
  expect(detectHost(t, 500)).toBe("warp");
  expect(detectHost(t, 999)).toBe("unknown");
});

test("finds the terminal tab's own tty when a wrapper runs claude in an inner pty", () => {
  const t = parsePs(` 7428     1 ??       Tue Nov  3 09:00:00 2026     /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
77070  7428 ttys018  Tue Nov  3 09:00:01 2026     login
77071 77070 ttys018  Tue Nov  3 09:00:02 2026     zsh (kiro-cli-term)
77078 77071 ttys019  Tue Nov  3 09:00:03 2026     /bin/zsh
 4681 77078 ttys019  Tue Nov  3 09:00:04 2026     claude
 9000  7428 ttys030  Tue Nov  3 09:00:05 2026     login
 9001  9000 ttys030  Tue Nov  3 09:00:06 2026     claude`);
  expect(hostTty(t, 4681)).toBe("ttys018");   // wrapped: the tab is the outer pty
  expect(hostTty(t, 9001)).toBe("ttys030");   // plain: same tty all the way up
  expect(hostTty(t, 1234)).toBeUndefined();
});
