import { hooksInstalled, STATUS_MARK, withHooks, withoutHooks, withoutStatusRelay, withStatusRelay } from "../src/install";

const mine = { model: "opus[1m]", hooks: { SessionStart: [{ hooks: [{ type: "command", command: "my-thing" }] }] }, statusLine: { type: "command", command: "x" } };

test("adding hooks leaves everything else exactly as it was, and is idempotent", () => {
  const once = withHooks(mine), twice = withHooks(once);
  expect(twice).toEqual(once);
  expect(once.model).toBe("opus[1m]");
  expect(once.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: "my-thing" }] }, { hooks: [{ type: "command", command: "~/.arcanum/bin/hook SessionStart", timeout: 5 }] }]);
  expect(once.hooks.PermissionRequest[0].hooks[0]).toEqual({ type: "command", command: "~/.arcanum/bin/hook PermissionRequest", timeout: 120 });
  expect(hooksInstalled(once)).toBe(true);
  expect(hooksInstalled(mine)).toBe(false);
});

test("removing hooks restores the original settings", () => {
  expect(withoutHooks(withHooks(mine))).toEqual(mine);
  expect(withoutHooks(withHooks({ model: "x" }))).toEqual({ model: "x" });
});

test("the status line gets one marked line after read, and loses it again", () => {
  const script = "#!/bin/bash\n# status\n\nread -r json_input\n\necho hi\n";
  const added = withStatusRelay(script)!;
  expect(added.split("\n")[4]).toContain(STATUS_MARK);
  expect(withStatusRelay(added)).toBe(added);
  expect(withoutStatusRelay(added)).toBe(script);
  expect(withStatusRelay("#!/bin/bash\necho no input\n")).toBeUndefined();
});
