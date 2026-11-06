// @ts-expect-error plain JS module from the UI
import { notices, wanted } from "../ui/notify.js";

const mage = (id: string, extra = {}) => ({ id, name: `Mage ${id}`, realmId: "r", lastText: "Done.\n\nHere's   the summary", ...extra });
const realm = () => "Arcanum";

test("settings let the right ravens through", () => {
  expect(wanted("all", "counsel")).toBe(true);
  expect(wanted("all", "arrive")).toBe(false);
  expect(wanted("seals", "counsel")).toBe(false);
  expect(wanted("seals", "seal")).toBe(true);
  expect(wanted("off", "seal")).toBe(false);
});

test("one notice per mage, tagged so a newer one replaces it", () => {
  const [c, s] = notices([{ kind: "counsel", s: mage("a") }, { kind: "seal", s: mage("b", { request: "Bash: rm -rf dist" }) }], realm);
  expect(c).toEqual({ id: "a", tag: "arcanum-a", title: "Mage a seeks counsel", body: "Arcanum · Done. Here's the summary" });
  expect(s.title).toBe("Mage b awaits your seal");
  expect(s.body).toBe("Arcanum · Bash: rm -rf dist");
});

test("a crowd becomes one summary", () => {
  const ev = ["a", "b", "c", "d"].map((id, i) => ({ kind: i ? "counsel" : "seal", s: mage(id) }));
  expect(notices(ev, realm)).toEqual([{ id: "a", tag: "arcanum-many", title: "4 mages need you", body: "1 await your seal · 3 seek counsel" }]);
});

test("long text is clipped", () => {
  const [n] = notices([{ kind: "counsel", s: mage("a", { lastText: "x".repeat(400) }) }], realm);
  expect(n.body.length).toBeLessThanOrEqual("Arcanum · ".length + 140);
  expect(n.body.endsWith("…")).toBe(true);
});
