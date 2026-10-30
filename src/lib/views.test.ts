import { describe, expect, it } from "vitest";
import type { Mailbox, ThreadSummary } from "./types";
import { fromDomain, isFocused, isInbox, visibleMailboxes } from "./views";

const mb = (id: string, accountId: string, role: Mailbox["role"], unread = 0): Mailbox => ({
  id, accountId, name: id, role, parentId: null, unread,
});


const boxes = [
  mb("a1-inbox", "a1", "inbox", 2),
  mb("a1-receipts", "a1", null),
  mb("a2-inbox", "a2", "inbox", 3),
  mb("a2-sent", "a2", "sent"),
];


describe("visibleMailboxes", () => {
  it("returns an account's own mailboxes", () => {
    expect(visibleMailboxes(boxes, "a1").map((m) => m.id)).toEqual(["a1-inbox", "a1-receipts"]);
  });

  it("merges roles across accounts in the unified view and sums unread", () => {
    expect(visibleMailboxes(boxes, "all")).toEqual([
      { id: "inbox", accountId: "all", name: "Inbox", role: "inbox", parentId: null, unread: 5 },
      { id: "sent", accountId: "all", name: "Sent", role: "sent", parentId: null, unread: 0 },
    ]);
  });
});

describe("fromDomain", () => {
  const domains = "northwind.studio, @halden.shop\n*.nordlys.hotels";
  it("matches listed domains and their subdomains, any case", () => {
    expect(fromDomain("maya@northwind.studio", domains)).toBe(true);
    expect(fromDomain("MAYA@mail.Northwind.studio", domains)).toBe(true);
    expect(fromDomain("orders@eu.halden.shop", domains)).toBe(true);
    expect(fromDomain("ingrid@nordlys.hotels", domains)).toBe(true);
    expect(fromDomain("sam@notnorthwind.studio", domains)).toBe(false);
  });
  it("matches everyone when nothing is listed", () => expect(fromDomain("x@y.z", " \n")).toBe(true));
});

describe("isFocused", () => {
  const t = (...senders: string[]) => ({ senders }) as unknown as ThreadSummary;
  it("is a conversation with mail from a listed domain", () => {
    expect(isFocused(t("news@shop.example", "maya@northwind.studio"), "northwind.studio")).toBe(true);
    expect(isFocused(t("news@shop.example"), "northwind.studio")).toBe(false);
    expect(isFocused(t(), "northwind.studio")).toBe(false); // only my own messages
  });
  it("is everything when no domain is listed", () => expect(isFocused(t("news@shop.example"), "")).toBe(true));
});

describe("isInbox", () => {
  it("is the unified inbox or an account's inbox folder", () => {
    expect(isInbox(boxes, "all", "inbox")).toBe(true);
    expect(isInbox(boxes, "all", "sent")).toBe(false);
    expect(isInbox(boxes, "a1", "a1-inbox")).toBe(true);
    expect(isInbox(boxes, "a1", "a1-receipts")).toBe(false);
  });
});
