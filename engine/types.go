package main

// The API contract. Field names and shapes mirror src/lib/types.ts.

type Account struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	Provider string    `json:"provider"`
	Color    string    `json:"color"`
	Sync     *Progress `json:"sync,omitempty"` // set while the engine has imported this account since it started
}

type Mailbox struct {
	ID        string  `json:"id"`
	AccountID string  `json:"accountId"`
	Name      string  `json:"name"`
	Role      *string `json:"role"` // nil = user folder
	ParentID  *string `json:"parentId"`
	Unread    int     `json:"unread"`
}

type Address struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type Attachment struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Type   string `json:"type"`
	CID    string `json:"cid,omitempty"`    // Content-ID, how the HTML refers to an inline image
	Hash   string `json:"hash,omitempty"`   // the content's file under <data dir>/attachments
	Inline bool   `json:"inline,omitempty"` // shown in the HTML, so not listed as an attachment
}

type Message struct {
	ID          string       `json:"id"`
	ThreadID    string       `json:"threadId"`
	From        Address      `json:"from"`
	To          []Address    `json:"to"`
	Cc          []Address    `json:"cc"`
	Bcc         []Address    `json:"bcc,omitempty"` // a draft's only
	Date        string       `json:"date"`
	Body        string       `json:"body"`
	Attachments []Attachment `json:"attachments"`
	Subject     string       `json:"subject"`
	HTML        string       `json:"html,omitempty"` // shown in a sandboxed frame; inline images already data: URLs
	Draft       bool         `json:"draft"`          // in a Drafts folder: the compose panel can resume it
}

// Thread is a conversation. Lists leave Messages empty (a ThreadSummary in TypeScript); GET /threads/{id} fills it.
type Thread struct {
	ID             string    `json:"id"`
	AccountID      string    `json:"accountId"`
	MailboxIDs     []string  `json:"mailboxIds"`
	Subject        string    `json:"subject"`
	Snippet        string    `json:"snippet"`
	Participants   []Address `json:"participants"`
	Senders        []string  `json:"senders"` // who wrote its messages (lowercase addresses), the account aside
	LastDate       string    `json:"lastDate"`
	Unread         bool      `json:"unread"`
	Starred        bool      `json:"starred"`
	HasAttachments bool      `json:"hasAttachments"`
	Messages       []Message `json:"messages,omitempty"`
}

// Server is one side of a mail account: where to connect and how to secure the connection.
type Server struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Security string `json:"security"` // "tls" (implicit), "starttls", or "none" (this computer only)
}

// AccountSettings is what the add-account form sends. The password goes to the keychain and never comes back out.
type AccountSettings struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Username string `json:"username"` // empty means the email address
	Password string `json:"password,omitempty"`
	IMAP     Server `json:"imap"`
	SMTP     Server `json:"smtp"`
}

// Progress is an account's import as the UI shows it.
type Progress struct {
	State string `json:"state"` // "importing", "done" or "error"
	Done  int    `json:"done"`
	Total int    `json:"total"`
	Error string `json:"error,omitempty"`
}

// NewMail is a message that just arrived in an inbox, for a notification.
type NewMail struct {
	AccountID string `json:"accountId"`
	ThreadID  string `json:"threadId"`
	From      string `json:"from"`    // the sender's name, or address when there's none
	Address   string `json:"address"` // the sender's address, which the UI filters notifications by
	Subject   string `json:"subject"`
	Snippet   string `json:"snippet"`
}
