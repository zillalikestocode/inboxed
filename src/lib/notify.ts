import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Account, NewMail } from "./types";
import { fromDomain } from "./views";

const inTauri = () => "__TAURI_INTERNALS__" in window;

/** One notification for a pass's new mail: who and what for one message, how many and from whom for several. */
export function summarize(batch: NewMail[], accounts: Account[]): { title: string; body: string } {
  const first = batch[0];
  const account = accounts.length > 1 ? accounts.find((a) => a.id === first.accountId)?.name : undefined;
  const named = (title: string) => (account ? `${title} · ${account}` : title);
  if (batch.length === 1) return { title: named(first.from), body: [first.subject, first.snippet].filter(Boolean).join("\n") };
  const senders = [...new Set(batch.map((m) => m.from))];
  const body =
    senders.length === 1
      ? senders[0]
      : senders.length === 2
        ? `${senders[0]} and ${senders[1]}`
        : `${senders[0]}, ${senders[1]} and ${senders.length - 2} more`;
  return { title: named(`${batch.length} new messages`), body };
}

/** Whether new mail comes from one of the domains the person listed (fromDomain). Nothing listed: every sender. */
export const fromDomains = (m: NewMail, domains: string) => fromDomain(m.address, domains);

const EACH = 10; // a pass's first ten messages get a notification each; the rest share one

export type Notice = { title: string; body: string; mail?: NewMail };

/** The notifications for a pass's new mail, from the senders the person chose: one per message, then one for the rest. */
export function notices(batch: NewMail[], accounts: Account[], domains: string): Notice[] {
  const wanted = batch.filter((m) => fromDomains(m, domains));
  const rest = wanted.slice(EACH);
  return [
    ...wanted.slice(0, EACH).map((m) => ({ ...summarize([m], accounts), mail: m })),
    ...(rest.length ? [summarize(rest, accounts)] : []),
  ];
}

let tapped: ((m: NewMail) => void) | undefined;

/** A click on a notification brings Inboxed forward, its window too when it was closed, and opens that message. Set once,
 *  at startup. */
export function onTap(open: (m: NewMail) => void) {
  tapped = open;
  if (!inTauri()) return;
  onAction((e) => {
    if (e.actionId !== "tap") return;
    const w = getCurrentWindow();
    w.show().then(() => w.unminimize()).then(() => w.setFocus()).catch(console.error);
    const m = e.notification?.extra?.mail as NewMail | undefined;
    if (m) open(m);
  }).catch(console.error);
}

let allowed: Promise<boolean> | undefined; // asked once, at the first new mail rather than at launch

/** Shows a native notification, with sound unless asked not to. A refusal or failure is logged: the banner and badge
 *  still work. */
export async function deliver(n: Notice, sound = true) {
  try {
    if (inTauri()) {
      allowed ??= (async () => (await isPermissionGranted()) || (await requestPermission()) === "granted")();
      if (await allowed) sendNotification({ title: n.title, body: n.body, sound: sound ? "Ping" : undefined, extra: { mail: n.mail } });
    } else if ("Notification" in window) {
      allowed ??= (async () => Notification.permission === "granted" || (await Notification.requestPermission()) === "granted")();
      if (await allowed)
        new Notification(n.title, { body: n.body, silent: !sound }).onclick = () => {
          window.focus();
          if (n.mail) tapped?.(n.mail);
        };
    }
  } catch (err) {
    allowed = undefined;
    console.error(err);
  }
}

/** The Dock badge: unread mail in the inboxes; 0 clears it. Only the app has a Dock icon. */
export function setBadge(count: number) {
  if (inTauri()) getCurrentWindow().setBadgeCount(count || undefined).catch(console.error);
}
