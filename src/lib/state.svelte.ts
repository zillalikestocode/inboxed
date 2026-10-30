import { api, EngineError, follow, send, upload } from "./engine";
import { addresses, forwardBody, replyTo, replyTrail, swapSignature, withSignature } from "./format";
import { deliver, notices, onTap, setBadge } from "./notify";
import { emailHtml, splitTrail, swapSignatureHtml, textToHtml, trailHtml, type Trail } from "./rich";
import { composeStyle, settings } from "./settings.svelte";
import { isFocused } from "./views";
import type { Account, AccountSettings, Contact, Draft, Mailbox, Message, NewMail, Thread, ThreadSummary } from "./types";

/** Mail data, as the engine last reported it. */
export const data = $state({
  accounts: [] as Account[],
  mailboxes: [] as Mailbox[],
  list: [] as ThreadSummary[], // the selected sidebar entry, narrowed by the search query
  thread: null as Thread | null, // the open conversation, with its messages
  contacts: [] as Contact[], // everyone in the mail, ranked by the engine: address suggestions and @mentions
});

/** What the user is looking at. */
export const ui = $state({
  accountId: "all", // "all" = unified view across accounts
  mailboxKey: "inbox", // a MailboxRole in the unified view, a mailbox id otherwise
  threadId: null as string | null,
  query: "",
  focus: "focused" as "focused" | "other", // an inbox's tab: conversations with the Focused domains, or the rest
  settingsTab: "Appearance", // the section Settings opens on
  composing: false,
  draft: { accountId: "", to: "", cc: "", bcc: "", subject: "", body: "", attachments: [] } as Draft,
  trail: null as Trail | null, // a reply's history: the draft's html and body end with it, the editor never holds it
  attaching: 0, // files still uploading for the open draft: Send waits for them
  composeError: "", // why the compose panel couldn't send or save; shown in the panel
  composeKey: 0, // a new message re-mounts the panel (focus, state)
  newMail: [] as NewMail[], // arrived since you last looked, newest first: the banner shows it
  preview: null as { messageId: string; index: number } | null, // the attachment shown in the preview sheet
  addingAccount: false,
  settingsOpen: false,
  error: "", // shown by the status bar in +page.svelte
  removingAccount: null as string | null, // the account the remove-account confirmation is asking about
});

/** Runs engine work. A failure becomes a message with a way out; it never throws. */
async function run(work: () => Promise<unknown>) {
  try {
    await work();
    ui.error = "";
  } catch (err) {
    console.error(err);
    ui.error = "Couldn't reach the mail engine. Try again, or restart Inboxed if it keeps happening.";
  }
}

let listRequest = 0;
async function loadList() {
  const n = ++listRequest;
  if (!ui.mailboxKey) return void (data.list = []); // a new account before its first sync has no folders yet
  const params = new URLSearchParams({ account: ui.accountId, key: ui.mailboxKey, q: ui.query });
  const list = await api<ThreadSummary[]>(`/threads?${params}`);
  if (n === listRequest) data.list = list; // a newer request (fast typing in search) wins
}

// A thread that's gone (its draft was sent, it was deleted on another device) closes rather than reporting an error.
async function loadThread() {
  const id = ui.threadId;
  let thread: Thread | null = null;
  if (id) {
    try {
      thread = await api<Thread>(`/threads/${encodeURIComponent(id)}`);
    } catch (err) {
      if (!(err instanceof EngineError && err.status === 404)) throw err;
    }
  }
  if (ui.threadId !== id) return;
  data.thread = thread;
  if (!thread) ui.threadId = null;
}

// After any change the engine is the source of truth, unread counts included.
let mailboxRequest = 0;
async function reload() {
  const n = ++mailboxRequest;
  const mailboxes = await api<Mailbox[]>("/mailboxes");
  if (n !== mailboxRequest) return; // reloads overlap (an action's and an event's); an older answer must not win
  data.mailboxes = mailboxes;
  // The selected folder may not exist yet (a new account's first sync) or any more (deleted on the server).
  if (ui.accountId !== "all" && !mailboxes.some((m) => m.id === ui.mailboxKey)) ui.mailboxKey = inboxOf(ui.accountId);
  await Promise.all([loadList(), loadThread()]);
  updateBadge();
}

/** The Dock badge: the inboxes' unread count, unless Settings turned it off. */
export const updateBadge = () =>
  setBadge(settings.dockBadge ? data.mailboxes.filter((m) => m.role === "inbox").reduce((sum, m) => sum + m.unread, 0) : 0);

async function refreshAll() {
  data.accounts = await api<Account[]>("/accounts");
  await reload();
}

let refreshing = false;
let missed = false;

// The first event reloads at once; a burst after it (a big import reports often) becomes at most one more reload a
// second, and reloads never overlap.
async function scheduleRefresh() {
  if (refreshing) {
    missed = true;
    return;
  }
  refreshing = true;
  do {
    missed = false;
    await run(refreshAll);
    await new Promise((r) => setTimeout(r, 1000));
  } while (missed);
  refreshing = false;
}

let following = false;

// Stays connected to the engine's change stream, reconnecting with backoff (1 s up to 30 s) after a drop, and
// reloading once on reconnect so nothing missed while away is lost.
async function followChanges() {
  if (following) return;
  following = true;
  onTap(openMail);
  let delay = 1000;
  for (;;) {
    const opened = Date.now();
    try {
      await follow(scheduleRefresh, newMail);
    } catch (err) {
      console.error(err);
    }
    if (Date.now() - opened > 30_000) delay = 1000; // it was up for a while: this is a new outage
    await new Promise((r) => setTimeout(r, delay));
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
    scheduleRefresh();
  }
}

// New mail: the banner always; when Inboxed isn't in front (or its window is closed), a notification per message from the
// domains chosen in Settings. In front, the banner is enough.
function newMail(batch: NewMail[]) {
  if (!batch.length) return;
  const here = document.hasFocus();
  // What you're reading right now needs no banner.
  const waiting = here ? batch.filter((m) => m.threadId !== ui.threadId) : batch;
  ui.newMail = [...waiting, ...ui.newMail].slice(0, 50);
  if (!here && settings.notify) for (const n of notices(batch, data.accounts, settings.notifyDomains)) deliver(n, settings.sound);
}

/** The banner's Open: the newest mail's conversation, in its account's inbox. The rest keeps waiting. */
export const openNewMail = () => (ui.newMail.length ? openMail(ui.newMail[0]) : Promise.resolve());

/** Opens new mail's conversation in its account's inbox (the banner, a notification's click). */
async function openMail(m: NewMail) {
  ui.newMail = ui.newMail.filter((x) => x.threadId !== m.threadId);
  if (!data.accounts.some((a) => a.id === m.accountId)) return; // removed meanwhile
  selectAccount(m.accountId);
  await openThread(m.threadId);
  // The inbox's tab that lists it, so it shows selected.
  if (data.thread?.id === m.threadId) ui.focus = isFocused(data.thread, settings.notifyDomains) ? "focused" : "other";
}

export const dismissNewMail = () => (ui.newMail = []);

/** First load; also the status bar's "Try again". Opens the live connection once. */
export const start = () => {
  followChanges();
  return run(refreshAll);
};

/** Adds an IMAP/SMTP account. Resolves to a message for the form when the engine refuses, or null when added. */
export async function addAccount(settings: AccountSettings): Promise<string | null> {
  try {
    await api("/accounts", { method: "POST", body: JSON.stringify(settings) });
  } catch (err) {
    if (err instanceof EngineError && err.status === 400) return err.message;
    console.error(err);
    return "Couldn't reach the mail engine. Try again, or restart Inboxed if it keeps happening.";
  }
  await start();
  return null;
}

export const removeAccount = (id: string) =>
  run(async () => {
    ui.newMail = ui.newMail.filter((m) => m.accountId !== id);
    await api(`/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (ui.accountId === id) selectAccount("all");
    else if (data.thread?.accountId === id) ui.threadId = null; // its mail is gone, so its open thread closes too
    await refreshAll();
  });

/** Renames an account: the rail, Settings and the From name on its mail. Shown at once; empty means its address. */
export function renameAccount(id: string, name: string) {
  const a = data.accounts.find((x) => x.id === id);
  const next = name.trim() || a?.email || "";
  if (!a || a.name === next) return Promise.resolve();
  a.name = next;
  return run(async () => {
    await send(`/accounts/${encodeURIComponent(id)}`, "PATCH", { name: next });
    await refreshAll();
  });
}

export const syncNow = (id: string) =>
  run(async () => {
    await api(`/accounts/${encodeURIComponent(id)}/sync`, { method: "POST" });
    await refreshAll();
  });

/** Reloads the list for the current view and query (+page.svelte runs this whenever they change). */
export const showList = () => run(loadList);

export function selectAccount(id: string) {
  ui.accountId = id;
  ui.mailboxKey = inboxOf(id);
  ui.threadId = null;
}

const inboxOf = (accountId: string) =>
  accountId === "all" ? "inbox" : (data.mailboxes.find((m) => m.accountId === accountId && m.role === "inbox")?.id ?? "");

export function selectMailbox(key: string) {
  ui.mailboxKey = key;
  ui.threadId = null;
}

// Flips the flags here first so the unread dot and the star respond instantly, then saves and reloads. If saving
// fails the flip is undone, so the screen never shows a change the engine doesn't have.
async function setFlags(id: string, flags: { unread?: boolean; starred?: boolean }) {
  const touched = [...data.list, data.thread].filter((t) => t?.id === id) as ThreadSummary[];
  const before = touched.map((t) => ({ unread: t.unread, starred: t.starred }));
  touched.forEach((t) => Object.assign(t, flags));
  try {
    await send(`/threads/${encodeURIComponent(id)}`, "PATCH", flags);
  } catch (err) {
    touched.forEach((t, i) => Object.assign(t, before[i]));
    throw err;
  }
  await reload();
}

export function openThread(id: string) {
  ui.threadId = id;
  ui.newMail = ui.newMail.filter((m) => m.threadId !== id); // read now: no banner for it
  return run(async () => {
    await loadThread();
    if (settings.markRead && data.thread?.id === id && data.thread.unread) await setFlags(id, { unread: false });
  });
}

export const setUnread = (id: string, unread: boolean) => run(() => setFlags(id, { unread }));

export function toggleStar(id: string) {
  const t = data.list.find((t) => t.id === id) ?? (data.thread?.id === id ? data.thread : undefined);
  return run(() => setFlags(id, { starred: !t?.starred }));
}

export const markAllRead = (accountId: string, key: string) =>
  run(async () => {
    await send("/read-all", "POST", { account: accountId, key });
    await reload();
  });

function move(id: string, to: "archive" | "trash" | "inbox") {
  return run(async () => {
    await send(`/threads/${encodeURIComponent(id)}/move`, "POST", { to });
    if (to !== "inbox" && ui.threadId === id) ui.threadId = null;
    await reload();
  });
}

export const archive = (id: string) => move(id, "archive");
export const trash = (id: string) => move(id, "trash");
export const moveToInbox = (id: string) => move(id, "inbox");

/** Accounts that can send: IMAP ones (demo accounts can't). */
export const senders = () => data.accounts.filter((a) => a.provider === "imap");

let pristine = ""; // the draft as the panel opened, so closing an untouched one saves nothing

/**
 * Opens the panel on a new message; a reply brings the history it answers (trail), which follows what's written in
 * both versions of the draft. One already open is saved first; if it can't be, it stays as it was and this resolves to
 * false.
 */
export async function compose(draft: Partial<Draft> = {}, trail: Trail | null = null): Promise<boolean> {
  if (ui.composing && (await closeCompose())) return false;
  const from = senders().find((a) => a.id === ui.accountId) ?? senders()[0];
  ui.draft = { accountId: from?.id ?? "", to: "", cc: "", bcc: "", subject: "", body: "", attachments: [], ...draft };
  // A saved draft already has its signature, and its trail (when it's a reply) at the end.
  if (!draft.draftId) ui.draft.body = withSignature(ui.draft.body, settings.signatures[ui.draft.accountId] ?? "");
  ui.trail = trail ?? splitTrail(ui.draft.html ?? "", ui.draft.body);
  if (trail) {
    ui.draft.html = textToHtml(ui.draft.body) + trail.html;
    ui.draft.body += trail.text;
  } else {
    ui.draft.html ||= textToHtml(ui.draft.body);
    // Saved with nothing above the trail, the body came back starting with its rule (splitTrail).
    if (ui.trail && !ui.draft.body.endsWith(ui.trail.text)) ui.draft.body = ui.trail.text;
  }
  pristine = JSON.stringify(ui.draft);
  ui.composeError = "";
  api<Contact[]>("/contacts").then(
    (c) => (data.contacts = c),
    (err) => console.error("contacts", err), // suggestions are a help; typing still works without them
  );
  ui.composeKey++; // always a fresh panel (focus, busy state), even when reopened while the last one closes
  ui.composing = true;
  return true;
}

/** The panel's From changed: the signature follows (above a reply's trail). html is the editor's, trail included. An
 *  untouched message stays untouched (closing it saves nothing). */
export function changeSender(accountId: string, html = ui.draft.html ?? "") {
  const untouched = JSON.stringify(ui.draft) === pristine;
  const sig = (id: string) => settings.signatures[id] ?? "";
  const tail = ui.trail?.text ?? "";
  const written = tail && ui.draft.body.endsWith(tail) ? ui.draft.body.slice(0, -tail.length) : ui.draft.body;
  ui.draft.body = swapSignature(written, sig(ui.draft.accountId), sig(accountId)) + tail;
  ui.draft.html = swapSignatureHtml(html, sig(ui.draft.accountId), sig(accountId), ui.trail?.html);
  ui.draft.accountId = accountId;
  if (untouched) pristine = JSON.stringify(ui.draft);
}

// Why the panel couldn't send or save, for the panel to show: the engine's words for a refusal, else what to do.
function failure(err: unknown): string {
  if (err instanceof EngineError && err.status === 400) return (ui.composeError = err.message);
  if (err instanceof EngineError && err.status === 404) return (ui.composeError = "That account was removed. Choose another one.");
  console.error(err);
  return (ui.composeError = "Couldn't reach the mail engine. Try again, or restart Inboxed if it keeps happening.");
}

// What the engine gets: the editor's HTML made ready for mail apps, in the style Settings chose for new mail.
const outgoing = (d: Draft): Draft => ({ ...d, html: d.html ? emailHtml(d.html, composeStyle()) : "" });

/** Sends the open draft. Resolves to null once sent (the panel closes), else to the reason, with the panel open. */
export async function sendDraft(): Promise<string | null> {
  try {
    await send("/send", "POST", outgoing(ui.draft));
  } catch (err) {
    return failure(err);
  }
  ui.composing = false;
  await run(reload);
  return null;
}

/** Closes the panel, saving the draft first if anything was typed. If it can't be saved, the panel stays open. */
export async function closeCompose(): Promise<string | null> {
  await uploads; // files still uploading go into the saved draft
  const d = ui.draft;
  const typed = d.to || d.cc || d.bcc || d.subject || d.body.trim() || d.attachments.length;
  if (typed && JSON.stringify(d) !== pristine) {
    if (!d.accountId) return (ui.composeError = "Add an account to save this draft, or discard it.");
    try {
      await send("/drafts", "PUT", outgoing(d));
    } catch (err) {
      return failure(err);
    }
    await run(reload);
  }
  ui.composing = false;
  return null;
}

/** Closes the panel and deletes the draft it was resumed from, if any. */
export function discardDraft() {
  const id = ui.draft.draftId;
  ui.composing = false;
  if (!id) return Promise.resolve();
  return run(async () => {
    await api(`/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
    await reload();
  });
}

/** Resumes a saved draft. It stays a reply when the conversation has other messages. */
export async function editDraft(m: Message) {
  const thread = data.thread?.id === m.threadId ? data.thread : null;
  const reply = thread?.messages.some((x) => !x.draft && x.id !== m.id);
  const opened = await compose({
    accountId: thread?.accountId ?? m.id.split("/")[0],
    to: addresses(m.to),
    cc: addresses(m.cc),
    bcc: addresses(m.bcc ?? []),
    subject: m.subject,
    body: m.body,
    html: m.html,
    threadId: reply ? m.threadId : undefined,
    draftId: m.id,
    attachments: m.attachments.filter((a) => !a.inline && a.hash), // a saved draft keeps its files
  });
}

// The message a reply or forward is about: the newest that isn't a draft of mine.
const lastSent = (t: Thread) => t.messages.findLast((m) => !m.draft) ?? t.messages[t.messages.length - 1];

const prefixed = (prefix: string, subject: string) =>
  subject.toLowerCase().startsWith(prefix.toLowerCase()) ? subject : `${prefix} ${subject}`;
const fullThread = async (id: string) => (data.thread?.id === id ? data.thread : api<Thread>(`/threads/${encodeURIComponent(id)}`));

const me = (t: Thread) => data.accounts.find((a) => a.id === t.accountId)?.email ?? "";

/** Whether Reply All would reach anyone Reply doesn't: more than one other person on the message it answers. */
export function canReplyAll(t: Thread) {
  const { to, cc } = replyTo(lastSent(t), me(t), true);
  return to.length + cc.length > 1;
}

export const reply = (id: string, all = false) =>
  run(async () => {
    const thread = await fullThread(id);
    const last = lastSent(thread);
    const { to, cc } = replyTo(last, me(thread), all);
    const answered = { ...last, subject: last.subject || thread.subject };
    await compose(
      { accountId: thread.accountId, threadId: thread.id, to: addresses(to), cc: addresses(cc), subject: prefixed("Re:", thread.subject) },
      { html: trailHtml(answered, composeStyle()), text: replyTrail(answered) },
    );
  });

export const forward = (id: string) =>
  run(async () => {
    const thread = await fullThread(id);
    const last = lastSent(thread);
    await compose({
      accountId: thread.accountId,
      subject: prefixed("Fwd:", thread.subject),
      body: forwardBody(last, thread.subject),
      attachments: last.attachments.filter((a) => !a.inline && a.hash), // signature logos stay behind with the HTML
    });
  });

/** The most a message's attachments can add up to: what most providers accept. */
export const MAX_ATTACHMENTS = 25 * 1024 ** 2;

let uploads: Promise<unknown> = Promise.resolve(); // what closing waits for
let uploadingBytes = 0;

/** Attaches files to the open draft: stored in the engine, then named by hash. Over the limit, nothing is attached. */
export function attachFiles(files: File[]): Promise<void> {
  const job = attach(files);
  uploads = Promise.all([uploads, job]);
  return job;
}

async function attach(files: File[]) {
  if (!ui.composing || !files.length) return;
  const total = [...ui.draft.attachments, ...files].reduce((sum, f) => sum + f.size, uploadingBytes);
  if (total > MAX_ATTACHMENTS) {
    ui.composeError = `Attachments can add up to 25 MB; these come to ${(total / 1024 ** 2).toFixed(1)} MB.`;
    return;
  }
  const draft = ui.draft;
  ui.attaching += files.length;
  for (const f of files) {
    uploadingBytes += f.size;
    try {
      const hash = await upload(f);
      if (ui.composing && ui.draft === draft) draft.attachments.push({ name: f.name, size: f.size, type: f.type || undefined, hash });
    } catch (err) {
      failure(err);
    } finally {
      uploadingBytes -= f.size;
      ui.attaching--;
    }
  }
}

export const detach = (index: number) => void ui.draft.attachments.splice(index, 1);

/** Shows an attachment in the preview sheet. */
export const previewAttachment = (messageId: string, index: number) => void (ui.preview = { messageId, index });

/** Saves an attachment to Downloads and shows it in the file manager (the engine does both). */
export async function openAttachment(messageId: string, index: number) {
  try {
    await api(`/messages/${encodeURIComponent(messageId)}/attachments/${index}/open`, { method: "POST" });
    ui.error = "";
  } catch (err) {
    console.error(err);
    ui.error =
      err instanceof EngineError && err.status === 404
        ? "Inboxed doesn't have this attachment's content."
        : "Couldn't reach the mail engine. Try again, or restart Inboxed if it keeps happening.";
  }
}
