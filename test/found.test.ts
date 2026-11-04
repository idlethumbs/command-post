import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { found, slugOf } from "../src/found";
import { emptyConfig } from "../src/realms";

const env = (projects: string) => ({ gitRoot: (c: string) => existsSync(path.join(c, ".git")) ? c : null, isWilds: (d: string) => d === projects });

test("founding with a new folder creates it under projects, optionally as a repo", () => {
  const projects = mkdtempSync(path.join(tmpdir(), "projects-")), cfg = emptyConfig();
  const r = found(cfg, { name: "Q4 Planning!", create: true, git: true }, env(projects), projects);
  expect(r.realm).toMatchObject({ id: "q4-planning", name: "Q4 Planning!", lands: [path.join(projects, "q4-planning")] });
  expect(r.created && r.git).toBe(true);
  expect(existsSync(path.join(projects, "q4-planning", ".git"))).toBe(true);
  expect(() => found(cfg, { name: "Q4 Planning", create: true }, env(projects), projects)).toThrow(/already exists/);
});

test("founding on an existing folder validates before touching anything", () => {
  const projects = mkdtempSync(path.join(tmpdir(), "projects-")), notes = path.join(projects, "notes"), cfg = emptyConfig();
  mkdirSync(notes);
  expect(found(cfg, { name: "Notes", folder: notes }, env(projects), projects).realm.lands).toEqual([notes]);
  expect(() => found(cfg, { name: "All", folder: projects }, env(projects), projects)).toThrow(/holds many projects/);
  expect(() => found(cfg, { name: "Ghost", folder: path.join(projects, "nope") }, env(projects), projects)).toThrow(/isn't a folder/);
  expect(() => found(emptyConfig(), { name: "", create: true }, env(projects), projects)).toThrow(/name/);
  expect(existsSync(path.join(projects, "-"))).toBe(false);
});

test("slugs", () => { expect(slugOf("Q4 Planning!")).toBe("q4-planning"); expect(slugOf("Café Ops")).toBe("cafe-ops"); });
