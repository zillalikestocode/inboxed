import { TRAIL_RULE } from "./quote";
import type { Address, Message } from "./types";

/** Mail-list style date: time today, "Yesterday", weekday this week, then a date. */
export function formatDate(iso: string, now = new Date(), locale?: string): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return d.toLocaleDateString(locale, { weekday: "long" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

/** Where a message list files a date: one group per day for the last seven days (big: the day number, small: Today,
 *  Yesterday or the weekday), then one per month (big: the month, small: its year when that isn't this year).
 *  name is the group's full name, for screen readers; day says whether the group is a single day. */
export function dateGroup(
  iso: string,
  now = new Date(),
  locale?: string,
): { key: string; day: boolean; big: string; small: string; name: string } {
  let d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d > now) d = now; // undated (still importing) or a sender's wrong clock
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const daysAgo = Math.round((day(now).getTime() - day(d).getTime()) / 86_400_000); // round: DST days aren't 24h
  if (daysAgo < 7) {
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const big = String(d.getDate());
    if (daysAgo === 0) return { key, day: true, big, small: "Today", name: "Today" };
    if (daysAgo === 1) return { key, day: true, big, small: "Yesterday", name: "Yesterday" };
    return {
      key,
      day: true,
      big,
      small: d.toLocaleDateString(locale, { weekday: "short" }),
      name: d.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" }),
    };
  }
  const thisYear = d.getFullYear() === now.getFullYear();
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    day: false,
    big: d.toLocaleDateString(locale, { month: "short" }),
    small: thisYear ? "" : String(d.getFullYear()),
    name: d.toLocaleDateString(locale, thisYear ? { month: "long" } : { month: "long", year: "numeric" }),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const fullDate = (iso: string, locale?: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
const person = (a: Address) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email);

/** A reply trail's date, as Outlook writes it: "Thursday, October 8, 2026 at 9:34 AM". */
export const trailDate = (iso: string, locale?: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: "full", timeStyle: "short" });

/** What a reply ends with, as Outlook writes it: a rule, the answered message's From, Date, To, Cc and Subject, then its
 *  text as it was (not "> " quoted). Starts with the blank line that separates it from what's written above. */
export function replyTrail(m: Message, locale?: string): string {
  const people = (list: Address[]) => list.map(person).join("; ");
  return [
    "",
    "",
    TRAIL_RULE,
    `From: ${person(m.from)}`,
    `Date: ${trailDate(m.date, locale)}`,
    `To: ${people(m.to)}`,
    ...(m.cc.length ? [`Cc: ${people(m.cc)}`] : []),
    `Subject: ${m.subject}`,
    "",
    m.body,
  ].join("\n");
}

/** Where a signature goes in a new message: after what's already written, or above a reply's or forward's quote
 *  (those start with room to type). The "-- " line lets mail apps recognize it. */
export function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return body;
  return body.startsWith("\n") ? `\n\n-- \n${sig}${body}` : `${body}\n\n-- \n${sig}`;
}

/** A message whose sender changed: the old account's signature becomes the new one's (or goes, or is added). */
export function swapSignature(body: string, from: string, to: string): string {
  const old = from.trim() && `\n\n-- \n${from.trim()}`;
  if (old && body.includes(old)) return body.replace(old, to.trim() ? `\n\n-- \n${to.trim()}` : "");
  return old ? body : withSignature(body, to);
}

/** What a forward starts with: room to type, the original's headers, then its text. */
export function forwardBody(m: Message, subject: string, locale?: string): string {
  return [
    "\n\n---------- Forwarded message ----------",
    `From: ${person(m.from)}`,
    `Date: ${fullDate(m.date, locale)}`,
    `Subject: ${subject}`,
    `To: ${m.to.map(person).join(", ")}`,
    "",
    m.body,
  ].join("\n");
}

/** Addresses as the To and Cc fields take them. A name is quoted only when it has to be (a comma in it would split
 *  the address); the engine reads plain names, accents and apostrophes included. */
export function addresses(list: Address[]): string {
  const named = (name: string) => (/["(),:;<>@[\\\]]/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : name);
  return list.map((a) => (a.name && a.name !== a.email ? `${named(a.name)} <${a.email}>` : a.email)).join(", ");
}

/** Who a reply goes to. Reply: the sender, or, answering my own message, the people it went to. Reply All also keeps
 *  everyone else where they were: To in To, Cc in Cc. Never me, and nobody twice. */
export function replyTo(m: Message, me: string, all: boolean): { to: Address[]; cc: Address[] } {
  const seen = new Set([me.toLowerCase()]);
  const fresh = (list: Address[]) =>
    list.filter((a) => !seen.has(a.email.toLowerCase()) && !!seen.add(a.email.toLowerCase()));
  const mine = m.from.email.toLowerCase() === me.toLowerCase();
  const to = fresh(mine ? m.to : all ? [m.from, ...m.to] : [m.from]);
  return { to, cc: all ? fresh(m.cc) : [] };
}
