export type Provider = "gmail" | "outlook" | "yahoo" | "imap";

export type Account = {
  id: string;
  name: string;
  email: string;
  provider: Provider;
  color: string; // identity color for the rail avatar and list dots
  sync?: ImportProgress;
};

export type MailboxRole = "inbox" | "starred" | "drafts" | "sent" | "archive" | "spam" | "trash" | null;

export type Mailbox = {
  id: string;
  accountId: string;
  name: string;
  role: MailboxRole; // null = user folder
  parentId: string | null;
  unread: number;
};

export type Address = { name: string; email: string };

export type Message = {
  id: string;
  threadId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc?: Address[]; // a draft's only
  date: string; // ISO 8601, UTC
  body: string; // plain text; HTML rendering arrives in Phase 6
  attachments: Attachment[];
  subject: string;
  html?: string; // shown in a sandboxed frame (HtmlBody); body is its text reduction
  draft: boolean; // in a Drafts folder: "Edit draft" resumes it in the compose panel
};

export type Attachment = {
  name: string;
  size: number;
  type?: string;
  inline?: boolean; // shown inside the HTML, so not listed
  hash?: string; // the content as the engine stores it: how a draft names the files it carries
};

/** Someone in the mail, as address fields and @mentions suggest them (the engine ranks them). */
export type Contact = { name: string; email: string };

/** A row in a list: everything but the messages. */
export type ThreadSummary = {
  id: string;
  accountId: string;
  mailboxIds: string[];
  subject: string;
  snippet: string;
  participants: Address[]; // everyone except the account owner
  senders: string[]; // who wrote its messages (lowercase addresses), the account owner aside
  lastDate: string;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
};

/** An open conversation. */
export type Thread = ThreadSummary & { messages: Message[] }; // oldest first

/** An account's mail import, as the engine reports it while running. */
export type ImportProgress = { state: "importing" | "done" | "error"; done: number; total: number; error?: string };

export type Server = { host: string; port: number; security: "tls" | "starttls" };

/** What the add-account form sends. */
export type AccountSettings = {
  name: string;
  email: string;
  username: string; // empty means the email address
  password: string;
  imap: Server;
  smtp: Server;
};

/** A message being written. threadId makes it a reply; draftId is the saved draft it replaces. */
export type Draft = {
  accountId: string;
  to: string; // as typed: comma-separated, "Name <email>" allowed; the engine parses and checks it
  cc: string;
  bcc: string;
  subject: string;
  body: string; // the plain-text version
  html?: string; // the formatted message, as the editor holds it (emailHtml makes what's sent)
  threadId?: string;
  draftId?: string;
  attachments: Attachment[]; // uploads, a forward's files, a resumed draft's own: all named by hash
};

/** A message that just arrived in an inbox (the engine's "mail" event). */
export type NewMail = { accountId: string; threadId: string; from: string; address: string; subject: string; snippet: string };
