import { parsePs, detectHost } from "../src/procs";

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
