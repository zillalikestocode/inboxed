import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mailbox, ThreadSummary } from "./types";

const calls = vi.hoisted(() => [] as { path: string; body?: unknown }[]);
vi.mock("./engine", () => {
  const api = async (path: string, init: RequestInit = {}) => {
    calls.push({ path, body: init.body ? JSON.parse(init.body as string) : undefined });
    return path.startsWith("/threads?") || path === "/mailboxes" ? [] : undefined;
  };
  return {
    api,
    send: (path: string, method: string, body: unknown) => api(path, { method, body: JSON.stringify(body) }),
    follow: () => new Promise<void>(() => {}),
    EngineError: Error,
  };
});

let s: typeof import("./state.svelte");
let m: typeof import("./menus");
beforeEach(async () => {
  vi.resetModules();
  calls.length = 0;
  s = await import("./state.svelte");
  m = await import("./menus");
  const box = (id: string, role: Mailbox["role"]): Mailbox => ({ id, accountId: "a1", name: id, role, parentId: null, unread: 0 });
  s.data.mailboxes = [box("a1-inbox", "inbox"), box("a1-archive", "archive"), box("a1-trash", "trash")];
});

const row = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: "t1", accountId: "a1", mailboxIds: ["a1-inbox"], subject: "Hi", snippet: "", participants: [], senders: [],
  lastDate: "2026-10-15T10:00:00.000Z", unread: true, starred: false, hasAttachments: false, ...over,
});
const labels = (entries: import("./menus").MenuEntry[]) => entries.map((e) => (e === "separator" ? "—" : e.text));
const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("threadMenu", () => {
  it("offers state-aware actions for an inbox thread", () => {
    expect(labels(m.threadMenu(row(), true))).toEqual([
      "Open", "—", "Reply", "Reply All", "Forward", "—", "Mark as Read", "Star", "—", "Archive", "Move to Trash",
    ]);
  });

  it("offers Move to Inbox instead of Archive once a thread is filed away", () => {
    expect(labels(m.threadMenu(row({ mailboxIds: ["a1-archive"], unread: false, starred: true })))).toEqual([
      "Reply", "Reply All", "Forward", "—", "Mark as Unread", "Unstar", "—", "Move to Inbox", "Move to Trash",
    ]);
  });

  it("menu actions reach the engine", async () => {
    const archive = m.threadMenu(row()).find((e) => e !== "separator" && e.text === "Archive");
    (archive as Exclude<import("./menus").MenuEntry, "separator">).action();
    await settle();
    expect(calls).toContainEqual({ path: "/threads/t1/move", body: { to: "archive" } });
  });
});

describe("runShortcut (non-mac: Ctrl is the command key)", () => {
  it("runs the matching command on the thread", async () => {
    expect(m.runShortcut(key("Backspace"), row())).toBe(true);
    await settle();
    expect(calls).toContainEqual({ path: "/threads/t1/move", body: { to: "trash" } });
  });

  it("ignores keys that aren't commands, and missing threads", () => {
    expect(m.runShortcut(key("u"), row())).toBe(false);
    expect(m.runShortcut(key("U", { ctrlKey: true, shiftKey: true }), undefined)).toBe(false);
  });
});

describe("accountMenu", () => {
  it("offers Mark All as Read and Remove Account…", () => {
    const entries = m.accountMenu("a1", "a1-inbox", 2);
    expect(labels(entries)).toEqual(["Mark All as Read", "—", "Remove Account…"]);
    (entries[2] as Exclude<import("./menus").MenuEntry, "separator">).action();
    expect(s.ui.removingAccount).toBe("a1");
  });
});
