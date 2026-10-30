import { beforeEach, describe, expect, it, vi } from "vitest";

// The tests run in Node: a Map stands in for the browser's storage.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
});

describe("settings", () => {
  beforeEach(() => {
    vi.resetModules();
    store.clear();
  });

  it("start from the defaults and remember changes", async () => {
    const { mailFont, saveSettings, settings } = await import("./settings.svelte");
    expect(mailFont().name).toBe("Inter");
    expect(settings).toMatchObject({ markRead: true, loadImages: false, notify: true, sound: true, dockBadge: true });
    settings.mailFont = "garamond";
    settings.signatures.a1 = "Sam";
    saveSettings();
    vi.resetModules();
    const again = await import("./settings.svelte");
    expect(again.mailFont().name).toBe("EB Garamond");
    expect(again.settings.signatures).toEqual({ a1: "Sam" });
  });

  it("ignore stored values of the wrong kind, unknown fonts and unreadable storage", async () => {
    store.set("inboxed.settings", JSON.stringify({ mailFont: "comic-sans", markRead: "no", signatures: null, sound: false }));
    const { mailFont, settings } = await import("./settings.svelte");
    expect(mailFont().name).toBe("Inter");
    expect(settings.markRead).toBe(true);
    expect(settings.signatures).toEqual({});
    expect(settings.sound).toBe(false);
    vi.resetModules();
    store.set("inboxed.settings", "{oops");
    expect((await import("./settings.svelte")).settings.markRead).toBe(true);
  });

  it("keep compose defaults only when they're offered", async () => {
    const { composeStyle, settings } = await import("./settings.svelte");
    expect(composeStyle()).toEqual({ font: "", size: 11, color: "" });
    settings.composeFont = "Georgia, 'Times New Roman', serif";
    settings.composeSize = 14;
    settings.composeColor = "#0b5394";
    expect(composeStyle()).toEqual({ font: "Georgia, 'Times New Roman', serif", size: 14, color: "#0b5394" });
    vi.resetModules();
    store.set("inboxed.settings", JSON.stringify({ composeFont: "Papyrus", composeSize: 13, composeColor: "red; x: y" }));
    expect((await import("./settings.svelte")).composeStyle()).toEqual({ font: "", size: 11, color: "" });
  });
});
