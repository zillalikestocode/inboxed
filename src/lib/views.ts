import type { Mailbox, MailboxRole, ThreadSummary } from "./types";

export const ROLES: { role: NonNullable<MailboxRole>; label: string }[] = [
  { role: "inbox", label: "Inbox" },
  { role: "starred", label: "Starred" },
  { role: "drafts", label: "Drafts" },
  { role: "sent", label: "Sent" },
  { role: "archive", label: "Archive" },
  { role: "spam", label: "Spam" },
  { role: "trash", label: "Trash" },
];

/**
 * Sidebar entries. For one account: its mailboxes. For the unified view ("all"):
 * one entry per role present in any account, keyed by role, with unread summed.
 */
export function visibleMailboxes(all: Mailbox[], accountId: string): Mailbox[] {
  if (accountId !== "all") return all.filter((m) => m.accountId === accountId);
  return ROLES.filter(({ role }) => all.some((m) => m.role === role)).map(({ role, label }) => ({
    id: role,
    accountId: "all",
    name: label,
    role,
    parentId: null,
    unread: all.filter((m) => m.role === role).reduce((sum, m) => sum + m.unread, 0),
  }));
}

/** Whether an address is from one of the domains the person listed in Settings (any space, comma or line between them;
 *  a subdomain counts). Nothing listed: every address. */
export function fromDomain(address: string, domains: string): boolean {
  const list = domains.toLowerCase().split(/[\s,;]+/).map((d) => d.replace(/^.*@|^\*?\./, "")).filter(Boolean);
  const host = address.toLowerCase().split("@").pop() ?? "";
  return !list.length || list.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Focused, in an inbox: conversations with mail from the listed domains (the senders that notify). The rest is Other;
 *  with nothing listed, everything is Focused. */
export const isFocused = (t: Pick<ThreadSummary, "senders">, domains: string) =>
  !domains.trim() || t.senders.some((email) => fromDomain(email, domains));

/** Whether a sidebar entry is an inbox (the unified one, or an account's): those split into Focused and Other. */
export const isInbox = (all: Mailbox[], accountId: string, key: string) =>
  accountId === "all" ? key === "inbox" : all.some((m) => m.id === key && m.role === "inbox");
