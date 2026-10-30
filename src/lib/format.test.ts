import { describe, expect, it } from "vitest";
import { addresses, dateGroup, forwardBody, formatDate, formatSize, replyTo, replyTrail, swapSignature, withSignature } from "./format";
import type { Message } from "./types";

// Thursday 15 October 2026, 14:00 local time.
const now = new Date(2026, 9, 15, 14, 0);
const at = (y: number, month: number, d: number, h = 0, min = 0) => new Date(y, month, d, h, min).toISOString();
// ICU puts a narrow no-break space before AM/PM; normalize so the assertion is readable.
const fmt = (iso: string) => formatDate(iso, now, "en-US").replace(/\s/g, " ");

describe("formatDate", () => {
  it("shows the time for today", () => expect(fmt(at(2026, 9, 15, 9, 41))).toBe("9:41 AM"));
  it("says Yesterday", () => expect(fmt(at(2026, 9, 14, 23, 0))).toBe("Yesterday"));
  it("shows the weekday within the last week", () => expect(fmt(at(2026, 9, 12, 10, 0))).toBe("Monday"));
  it("shows month and day after a week", () => expect(fmt(at(2026, 9, 8, 10, 0))).toBe("Oct 8"));
  it("shows month and day earlier this year", () => expect(fmt(at(2026, 2, 3))).toBe("Mar 3"));
  it("adds the year for earlier years", () => expect(fmt(at(2025, 11, 24))).toBe("Dec 24, 2025"));
});

describe("dateGroup", () => {
  // Labels only: the key is checked separately.
  const group = (iso: string, at = now) => {
    const { big, small, name } = dateGroup(iso, at, "en-US");
    return [big, small, name];
  };
  it("today shows the day number over Today", () => {
    expect(group(at(2026, 9, 15, 0, 1))).toEqual(["15", "Today", "Today"]);
  });
  it("mail dated in the future (a wrong clock) or undated (still importing) counts as today", () => {
    expect(group(at(2026, 9, 16, 9, 0))).toEqual(["15", "Today", "Today"]);
    expect(group("")).toEqual(["15", "Today", "Today"]);
  });
  it("yesterday, then the weekday for the rest of the last seven days", () => {
    expect(group(at(2026, 9, 14, 23, 59))).toEqual(["14", "Yesterday", "Yesterday"]);
    expect(group(at(2026, 9, 9, 8, 0))).toEqual(["9", "Fri", "Friday, October 9"]);
  });
  it("then the month, with its year when that isn't this year", () => {
    expect(group(at(2026, 9, 8, 12, 0))).toEqual(["Oct", "", "October"]);
    expect(group(at(2026, 8, 30))).toEqual(["Sep", "", "September"]);
    expect(group(at(2025, 11, 24))).toEqual(["Dec", "2025", "December 2025"]);
  });
  it("one key per day, then per month", () => {
    const key = (iso: string) => dateGroup(iso, now, "en-US").key;
    expect(key(at(2026, 9, 14, 1))).toBe(key(at(2026, 9, 14, 23)));
    expect(key(at(2026, 9, 14))).not.toBe(key(at(2026, 9, 13)));
    expect(key(at(2026, 8, 2))).toBe(key(at(2026, 8, 29)));
    expect(key(at(2026, 8, 2))).not.toBe(key(at(2025, 8, 2)));
    expect(dateGroup(at(2026, 9, 9), now).day).toBe(true);
    expect(dateGroup(at(2026, 9, 8), now).day).toBe(false);
  });
});

describe("formatSize", () => {
  it("bytes", () => expect(formatSize(500)).toBe("500 B"));
  it("kilobytes", () => expect(formatSize(1536)).toBe("2 KB"));
  it("megabytes", () => expect(formatSize(2_400_000)).toBe("2.3 MB"));
});

const original: Message = {
  id: "acc/d1@x", threadId: "acc/d1@x", subject: "Dinner plans", draft: false, attachments: [], cc: [],
  from: { name: "Maya Chen", email: "maya@example.com" }, to: [{ name: "You", email: "you@example.com" }],
  date: "2026-10-15T12:00:00.000Z", body: "Are you free?\n\nSaturday works.",
};

describe("replyTrail", () => {
  it("is Outlook's: a rule, the answered message's headers, then its text as it was", () => {
    const cc = [{ name: "Ada", email: "ada@x" }, { name: "", email: "bo@x" }];
    const t = replyTrail({ ...original, cc }, "en-US").replace(/\s(?=[AP]M)/g, " ");
    expect(t).toBe(
      [
        "",
        "",
        "_".repeat(32),
        "From: Maya Chen <maya@example.com>",
        `Date: ${new Date(original.date).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }).replace(/\s(?=[AP]M)/g, " ")}`,
        "To: You <you@example.com>",
        "Cc: Ada <ada@x>; bo@x",
        "Subject: Dinner plans",
        "",
        "Are you free?",
        "",
        "Saturday works.",
      ].join("\n"),
    );
    expect(replyTrail(original, "en-US")).not.toContain("Cc:");
  });
});

describe("forwardBody", () => {
  it("carries the original's headers, then its text", () => {
    const f = forwardBody(original, "Dinner plans", "en-US");
    expect(f).toContain("---------- Forwarded message ----------");
    expect(f).toContain("From: Maya Chen <maya@example.com>");
    expect(f).toContain("Subject: Dinner plans");
    expect(f).toContain("To: You <you@example.com>");
    expect(f.endsWith("Are you free?\n\nSaturday works.")).toBe(true);
  });
});

describe("addresses", () => {
  it("keeps names, quoted only when a comma or the like could split an address", () => {
    expect(addresses([{ name: "Chen, Maya", email: "maya@x" }, { name: "sam@x", email: "sam@x" }, { name: "", email: "lee@x" }])).toBe(
      '"Chen, Maya" <maya@x>, sam@x, lee@x',
    );
    expect(addresses([{ name: "Maya Chen", email: "maya@x" }, { name: "Seán O'Brien-Núñez Jr.", email: "sean@x" }])).toBe(
      "Maya Chen <maya@x>, Seán O'Brien-Núñez Jr. <sean@x>",
    );
    expect(addresses([{ name: 'Maya "M" Chen', email: "maya@x" }, { name: "Sam (work)", email: "sam@x" }])).toBe(
      '"Maya \\"M\\" Chen" <maya@x>, "Sam (work)" <sam@x>',
    );
  });
});

describe("replyTo", () => {
  const maya = { name: "Maya Chen", email: "maya@example.com" };
  const you = { name: "You", email: "you@example.com" };
  const dan = { name: "Daniel Okafor", email: "dan@example.com" };
  const priya = { name: "Priya Nair", email: "priya@example.com" };
  const m = { ...original, from: maya, to: [you, dan], cc: [priya, { ...you, email: "YOU@example.com" }] };

  it("Reply answers the sender", () => {
    expect(replyTo(m, "you@example.com", false)).toEqual({ to: [maya], cc: [] });
  });

  it("Reply All keeps everyone where they were: the sender and To in To, Cc in Cc, never me", () => {
    expect(replyTo(m, "you@example.com", true)).toEqual({ to: [maya, dan], cc: [priya] });
  });

  it("answering my own message goes to the people it went to", () => {
    const mine = { ...m, from: you, to: [maya], cc: [priya] };
    expect(replyTo(mine, "you@example.com", false)).toEqual({ to: [maya], cc: [] });
    expect(replyTo(mine, "you@example.com", true)).toEqual({ to: [maya], cc: [priya] });
  });

  it("someone in both To and Cc is asked once", () => {
    expect(replyTo({ ...m, cc: [dan, priya] }, "you@example.com", true)).toEqual({ to: [maya, dan], cc: [priya] });
  });
});

describe("signatures", () => {
  it("go after what's written, or above a reply's quote", () => {
    expect(withSignature("", "Sam")).toBe("\n\n-- \nSam");
    expect(withSignature("Hi", " Sam \n")).toBe("Hi\n\n-- \nSam");
    expect(withSignature("\n\nOn Monday, Maya wrote:\n> Hi", "Sam")).toBe("\n\n-- \nSam\n\nOn Monday, Maya wrote:\n> Hi");
    expect(withSignature("Hi", "  ")).toBe("Hi");
  });

  it("swap with the sender, leaving an edited one alone", () => {
    expect(swapSignature("Hi\n\n-- \nSam", "Sam", "Samuel")).toBe("Hi\n\n-- \nSamuel");
    expect(swapSignature("Hi\n\n-- \nSam", "Sam", "")).toBe("Hi");
    expect(swapSignature("Hi", "", "Sam")).toBe("Hi\n\n-- \nSam");
    expect(swapSignature("Hi\n\n-- \nSam (edited)", "Sam (old)", "New")).toBe("Hi\n\n-- \nSam (edited)");
  });
});
