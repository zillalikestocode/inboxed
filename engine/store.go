package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid request")
)

// isoDate sorts as text in time order and parses in JavaScript.
const isoDate = "2006-01-02T15:04:05.000Z"

// Applied in order, once each; PRAGMA user_version records how many ran. Never edit a shipped entry, append a new one.
var migrations = []string{
	`CREATE TABLE accounts (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		email TEXT NOT NULL,
		provider TEXT NOT NULL,
		color TEXT NOT NULL,
		position INTEGER NOT NULL
	);
	CREATE TABLE mailboxes (
		id TEXT PRIMARY KEY,
		account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		role TEXT,
		parent_id TEXT REFERENCES mailboxes(id) ON DELETE CASCADE,
		position INTEGER NOT NULL
	);
	CREATE TABLE threads (
		doc INTEGER PRIMARY KEY, -- stable integer key; the search index row shares it
		id TEXT NOT NULL UNIQUE,
		account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		subject TEXT NOT NULL,
		unread INTEGER NOT NULL DEFAULT 0,
		starred INTEGER NOT NULL DEFAULT 0,
		snippet TEXT NOT NULL,
		participants TEXT NOT NULL,
		last_date TEXT NOT NULL,
		has_attachments INTEGER NOT NULL
	);
	CREATE INDEX threads_last_date ON threads(last_date);
	CREATE TABLE thread_mailboxes (
		thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
		PRIMARY KEY (thread_id, mailbox_id)
	);
	CREATE INDEX thread_mailboxes_mailbox ON thread_mailboxes(mailbox_id);
	CREATE TABLE messages (
		id TEXT PRIMARY KEY,
		thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		sender TEXT NOT NULL,
		recipients TEXT NOT NULL,
		cc TEXT NOT NULL,
		date TEXT NOT NULL,
		body TEXT NOT NULL,
		attachments TEXT NOT NULL
	);
	CREATE INDEX messages_thread ON messages(thread_id, date);
	-- rowid = threads.doc, so replacing or removing a thread's search row is a key lookup, not a scan.
	CREATE VIRTUAL TABLE search USING fts5(subject, people, body);
	CREATE TRIGGER threads_search_cleanup AFTER DELETE ON threads BEGIN
		DELETE FROM search WHERE rowid = old.doc;
	END;`,
	`ALTER TABLE accounts ADD COLUMN username TEXT NOT NULL DEFAULT '';
	ALTER TABLE accounts ADD COLUMN imap TEXT NOT NULL DEFAULT '{}';
	ALTER TABLE accounts ADD COLUMN smtp TEXT NOT NULL DEFAULT '{}';
	ALTER TABLE mailboxes ADD COLUMN path TEXT; -- the server's name for the folder; NULL for local entries like Starred
	ALTER TABLE mailboxes ADD COLUMN uid_validity INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE messages ADD COLUMN header_id TEXT NOT NULL DEFAULT '';
	ALTER TABLE messages ADD COLUMN subject TEXT NOT NULL DEFAULT '';
	-- Where each message lives on the server. Importing skips anything already here, which makes it resumable.
	CREATE TABLE message_locations (
		mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
		uid INTEGER NOT NULL,
		message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		PRIMARY KEY (mailbox_id, uid)
	);`,
	// Deleting messages (removing an account) cascades through message_locations by message_id.
	`CREATE INDEX message_locations_message ON message_locations(message_id);`,
	`ALTER TABLE message_locations ADD COLUMN seen INTEGER NOT NULL DEFAULT 1;
	ALTER TABLE message_locations ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
	-- The folder's last STATUS (uidvalidity/messages/uidnext/unseen). Unchanged means there's nothing to sync there.
	ALTER TABLE mailboxes ADD COLUMN status TEXT NOT NULL DEFAULT '';
	-- Local actions on IMAP accounts waiting to reach the server, oldest first.
	CREATE TABLE pending_changes (
		id INTEGER PRIMARY KEY,
		account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		thread_id TEXT NOT NULL, -- no foreign key: the thread may be gone by the time the change is sent
		kind TEXT NOT NULL,      -- 'seen', 'flagged' or 'move'
		value TEXT NOT NULL,     -- '1'/'0', or archive|trash|inbox
		attempts INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX pending_changes_thread ON pending_changes(thread_id);`,
	// The folder's HIGHESTMODSEQ when last synced (CONDSTORE servers): flag changes since then are all that's fetched.
	`ALTER TABLE mailboxes ADD COLUMN modseq INTEGER NOT NULL DEFAULT 0;`,
	`ALTER TABLE messages ADD COLUMN html TEXT NOT NULL DEFAULT '';
	-- What each message refers to ('<account>/<Message-ID>'), so a message can find its thread from either side.
	CREATE TABLE message_refs (
		ref TEXT NOT NULL,
		message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		PRIMARY KEY (ref, message_id)
	);
	CREATE INDEX message_refs_message ON message_refs(message_id);
	-- Mail imported before this lacks HTML, attachment content and references: forget it, so sync imports it again.
	DELETE FROM pending_changes WHERE account_id IN (SELECT id FROM accounts WHERE provider = 'imap');
	DELETE FROM threads WHERE account_id IN (SELECT id FROM accounts WHERE provider = 'imap');
	UPDATE mailboxes SET status = '', modseq = 0 WHERE path IS NOT NULL;`,
	// A draft's Bcc, so resuming it keeps them. Sent mail never names them.
	`ALTER TABLE messages ADD COLUMN bcc TEXT NOT NULL DEFAULT '[]';`,
}

type Store struct {
	db    *sql.DB
	files string // attachment content, one file per distinct content: <data dir>/attachments/<sha256>
}

func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	// ponytail: one connection serializes all access; plenty for one user. Pool readers if Phase 4 sync contends.
	db.SetMaxOpenConns(1)
	s := &Store{db: db, files: filepath.Join(filepath.Dir(path), "attachments")}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error { return s.migrateTo(len(migrations)) }

// migrateTo applies migrations up to n (tests stop early to build an older database).
func (s *Store) migrateTo(n int) error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > len(migrations) {
		return fmt.Errorf("database schema %d is newer than this engine understands (%d); update Inboxed", version, len(migrations))
	}
	for i := version; i < n; i++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// PutThread writes a thread with its messages and mailboxes, replacing any earlier version. It recomputes the
// summary fields lists read (snippet, participants, last date), so listing never loads messages.
func (s *Store) PutThread(t Thread) error {
	if len(t.Messages) == 0 {
		return fmt.Errorf("%w: thread %s has no messages", ErrInvalid, t.ID)
	}
	var me string
	if err := s.db.QueryRow(`SELECT email FROM accounts WHERE id = ?`, t.AccountID).Scan(&me); err != nil {
		return fmt.Errorf("account %s: %w", t.AccountID, err)
	}
	last := t.Messages[len(t.Messages)-1]
	attached := false
	for _, m := range t.Messages {
		attached = attached || len(m.Attachments) > 0
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var doc int64
	if err := tx.QueryRow(`
		INSERT INTO threads (id, account_id, subject, unread, starred, snippet, participants, last_date, has_attachments)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, unread = excluded.unread, starred = excluded.starred,
			snippet = excluded.snippet, participants = excluded.participants, last_date = excluded.last_date,
			has_attachments = excluded.has_attachments
		RETURNING doc`,
		t.ID, t.AccountID, t.Subject, t.Unread, t.Starred, snippet(last.Body),
		toJSON(participants(t.Messages, me)), last.Date, attached).Scan(&doc); err != nil {
		return err
	}
	for _, q := range []string{
		`DELETE FROM thread_mailboxes WHERE thread_id = ?`,
		`DELETE FROM messages WHERE thread_id = ?`,
	} {
		if _, err := tx.Exec(q, t.ID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM search WHERE rowid = ?`, doc); err != nil {
		return err
	}
	for _, m := range t.MailboxIDs {
		if _, err := tx.Exec(`INSERT INTO thread_mailboxes (thread_id, mailbox_id) VALUES (?, ?)`, t.ID, m); err != nil {
			return fmt.Errorf("thread %s in mailbox %s: %w", t.ID, m, err)
		}
	}
	var people, bodies []string
	for _, m := range t.Messages {
		if _, err := tx.Exec(`
			INSERT INTO messages (id, thread_id, sender, recipients, cc, date, body, attachments)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			m.ID, t.ID, toJSON(m.From), toJSON(orEmpty(m.To)), toJSON(orEmpty(m.Cc)), m.Date, m.Body,
			toJSON(orEmpty(m.Attachments))); err != nil {
			return err
		}
		for _, a := range append([]Address{m.From}, m.To...) {
			people = append(people, a.Name, a.Email)
		}
		bodies = append(bodies, m.Body)
	}
	if _, err := tx.Exec(`INSERT INTO search (rowid, subject, people, body) VALUES (?, ?, ?, ?)`,
		doc, t.Subject, strings.Join(people, " "), strings.Join(bodies, "\n")); err != nil {
		return err
	}
	return tx.Commit()
}

// participants is everyone in the thread except the account owner, in order of first appearance.
func participants(msgs []Message, me string) []Address {
	seen := map[string]bool{me: true}
	out := []Address{}
	for _, m := range msgs {
		for _, a := range append([]Address{m.From}, m.To...) {
			if !seen[a.Email] {
				seen[a.Email] = true
				out = append(out, a)
			}
		}
	}
	return out
}

const summaryColumns = `t.id, t.account_id, t.subject, t.snippet, t.participants, t.last_date, t.unread, t.starred,
	t.has_attachments, (SELECT json_group_array(mailbox_id) FROM thread_mailboxes WHERE thread_id = t.id),
	(SELECT json_group_array(DISTINCT lower(json_extract(m.sender, '$.email'))) FROM messages m WHERE m.thread_id = t.id
		AND lower(json_extract(m.sender, '$.email')) != (SELECT lower(email) FROM accounts WHERE id = t.account_id))`

func scanSummary(row interface{ Scan(...any) error }) (Thread, error) {
	var t Thread
	var people, boxes, senders string
	if err := row.Scan(&t.ID, &t.AccountID, &t.Subject, &t.Snippet, &people, &t.LastDate, &t.Unread, &t.Starred,
		&t.HasAttachments, &boxes, &senders); err != nil {
		return t, err
	}
	if err := json.Unmarshal([]byte(people), &t.Participants); err != nil {
		return t, err
	}
	if err := json.Unmarshal([]byte(senders), &t.Senders); err != nil {
		return t, err
	}
	return t, json.Unmarshal([]byte(boxes), &t.MailboxIDs)
}

// Thread returns one conversation with its messages, oldest first.
func (s *Store) Thread(id string) (Thread, error) {
	t, err := scanSummary(s.db.QueryRow(`SELECT `+summaryColumns+` FROM threads t WHERE t.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return t, ErrNotFound
	} else if err != nil {
		return t, err
	}
	rows, err := s.db.Query(`SELECT id, sender, recipients, cc, date, body, attachments, subject, html, bcc,
		EXISTS (SELECT 1 FROM message_locations ml JOIN mailboxes mb ON mb.id = ml.mailbox_id
			WHERE ml.message_id = messages.id AND mb.role = 'drafts')
		FROM messages WHERE thread_id = ? ORDER BY date`, id)
	if err != nil {
		return t, err
	}
	defer rows.Close()
	budget := int64(maxInlineThread)
	for rows.Next() {
		m := Message{ThreadID: id}
		var from, to, cc, attachments, bcc string
		if err := rows.Scan(&m.ID, &from, &to, &cc, &m.Date, &m.Body, &attachments, &m.Subject, &m.HTML, &bcc, &m.Draft); err != nil {
			return t, err
		}
		for _, f := range []struct {
			src string
			dst any
		}{{from, &m.From}, {to, &m.To}, {cc, &m.Cc}, {bcc, &m.Bcc}, {attachments, &m.Attachments}} {
			if err := json.Unmarshal([]byte(f.src), f.dst); err != nil {
				return t, err
			}
		}
		m.HTML = s.inlineImages(m.HTML, m.Attachments, &budget)
		t.Messages = append(t.Messages, m)
	}
	return t, rows.Err()
}

func toJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // only plain structs and slices reach here
	}
	return string(b)
}

// orEmpty keeps lists as [] in JSON, never null.
func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func (s *Store) Accounts() ([]Account, error) {
	rows, err := s.db.Query(`SELECT id, name, email, provider, color FROM accounts ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Account{}
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Name, &a.Email, &a.Provider, &a.Color); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Mailboxes lists every mailbox with its unread count. Starred counts unread starred threads, since starred is a flag.
func (s *Store) Mailboxes() ([]Mailbox, error) {
	rows, err := s.db.Query(`
		SELECT m.id, m.account_id, m.name, m.role, m.parent_id,
			CASE WHEN m.role = 'starred'
				THEN (SELECT COUNT(*) FROM threads t WHERE t.account_id = m.account_id AND t.starred AND t.unread
					AND ` + notTrashed + `)
				ELSE (SELECT COUNT(*) FROM thread_mailboxes tm JOIN threads t ON t.id = tm.thread_id
					WHERE tm.mailbox_id = m.id AND t.unread)
			END
		FROM mailboxes m ORDER BY m.position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Mailbox{}
	for rows.Next() {
		var m Mailbox
		var role, parent sql.NullString
		if err := rows.Scan(&m.ID, &m.AccountID, &m.Name, &role, &parent, &m.Unread); err != nil {
			return nil, err
		}
		if role.Valid {
			m.Role = &role.String
		}
		if parent.Valid {
			m.ParentID = &parent.String
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// notTrashed keeps trashed threads out of flag-based views like Starred.
const notTrashed = `NOT EXISTS (SELECT 1 FROM thread_mailboxes tm JOIN mailboxes m ON m.id = tm.mailbox_id
	WHERE tm.thread_id = t.id AND m.role = 'trash')`

// filter turns a sidebar entry into a WHERE clause over threads t. accountID "all" is the unified view, where key
// is a role; otherwise key is one of that account's mailbox ids. Starred is a flag, not a folder.
func (s *Store) filter(accountID, key string) (string, []any, error) {
	role := key
	if accountID != "all" {
		var r sql.NullString
		err := s.db.QueryRow(`SELECT role FROM mailboxes WHERE id = ? AND account_id = ?`, key, accountID).Scan(&r)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil, ErrNotFound
		} else if err != nil {
			return "", nil, err
		}
		role = r.String
	}
	switch {
	case role == "starred" && accountID == "all":
		return `t.starred AND ` + notTrashed, nil, nil
	case role == "starred":
		return `t.starred AND t.account_id = ? AND ` + notTrashed, []any{accountID}, nil
	case accountID == "all":
		return `t.id IN (SELECT tm.thread_id FROM thread_mailboxes tm JOIN mailboxes m ON m.id = tm.mailbox_id
			WHERE m.role = ?)`, []any{key}, nil
	default:
		return `t.id IN (SELECT thread_id FROM thread_mailboxes WHERE mailbox_id = ?)`, []any{key}, nil
	}
}

// Threads lists a sidebar entry newest first, narrowed by a search query, without messages.
func (s *Store) Threads(accountID, key, query string) ([]Thread, error) {
	where, args, err := s.filter(accountID, key)
	if err != nil {
		return nil, err
	}
	if q := ftsQuery(query); q != "" {
		where += ` AND t.doc IN (SELECT rowid FROM search WHERE search MATCH ?)`
		args = append(args, q)
	}
	rows, err := s.db.Query(`SELECT `+summaryColumns+` FROM threads t WHERE `+where+` ORDER BY t.last_date DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Thread{}
	for rows.Next() {
		t, err := scanSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ftsQuery turns what someone typed into an FTS5 query: every word must match as a prefix. Each word is quoted, so
// FTS syntax in the input (", *, OR, -, NEAR) is searched for literally and can't break or widen the query.
func ftsQuery(input string) string {
	var terms []string
	for _, w := range strings.Fields(input) {
		terms = append(terms, `"`+strings.ReplaceAll(w, `"`, `""`)+`"*`)
	}
	return strings.Join(terms, " ")
}

// SetFlags changes read and star state. A nil argument leaves that flag as it is. On IMAP accounts the change is
// also queued for the server.
func (s *Store) SetFlags(id string, unread, starred *bool) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE threads SET unread = COALESCE(?, unread), starred = COALESCE(?, starred) WHERE id = ?`,
		unread, starred, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if unread != nil {
		if err := queueChange(tx, id, "seen", flagValue(!*unread)); err != nil {
			return err
		}
	}
	if starred != nil {
		if err := queueChange(tx, id, "flagged", flagValue(*starred)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Move files a thread: "archive" takes it out of the inbox, "trash" out of everything, "inbox" undoes both.
// User folders are kept, except by trash.
func (s *Store) Move(id, to string) error {
	leave, ok := map[string]string{
		"archive": `role = 'inbox'`,
		"trash":   `1`,
		"inbox":   `role IN ('archive', 'trash')`,
	}[to]
	if !ok {
		return fmt.Errorf("%w: can't move to %q", ErrInvalid, to)
	}
	var account string
	err := s.db.QueryRow(`SELECT account_id FROM threads WHERE id = ?`, id).Scan(&account)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	var target string
	err = s.db.QueryRow(`SELECT id FROM mailboxes WHERE account_id = ? AND role = ? ORDER BY position LIMIT 1`, account, to).Scan(&target)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: account %s has no %s mailbox", ErrInvalid, account, to)
	} else if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM thread_mailboxes WHERE thread_id = ?
		AND mailbox_id IN (SELECT id FROM mailboxes WHERE `+leave+`)`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO thread_mailboxes (thread_id, mailbox_id) VALUES (?, ?)`, id, target); err != nil {
		return err
	}
	if err := queueChange(tx, id, "move", to); err != nil {
		return err
	}
	return tx.Commit()
}

// MarkAllRead marks every thread in a sidebar entry as read (same convention as Threads); on IMAP accounts the
// change is queued for the server.
func (s *Store) MarkAllRead(accountID, key string) error {
	where, args, err := s.filter(accountID, key)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO pending_changes (account_id, thread_id, kind, value)
		SELECT t.account_id, t.id, 'seen', '1' FROM threads t JOIN accounts a ON a.id = t.account_id
		WHERE t.unread AND a.provider = 'imap' AND `+where, args...); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE threads SET unread = 0 WHERE id IN (SELECT t.id FROM threads t WHERE `+where+`)`, args...); err != nil {
		return err
	}
	return tx.Commit()
}

const (
	maxInline       = 5 << 20  // bigger inline images stay cid: links rather than swell a thread's response
	maxInlineThread = 20 << 20 // and a thread's images together stop here
)

// inlineImages points the HTML's cid: references at data: URLs of the stored images, so the sandboxed frame (which
// loads nothing from anywhere) can show them. Longer Content-IDs go first, so "a@x" never rewrites part of "a@x2".
func (s *Store) inlineImages(html string, attachments []Attachment, budget *int64) string {
	sorted := slices.Clone(attachments)
	slices.SortFunc(sorted, func(a, b Attachment) int { return len(b.CID) - len(a.CID) })
	for _, a := range sorted {
		if a.CID == "" || a.Size > maxInline || a.Size > *budget || !strings.Contains(html, "cid:"+a.CID) {
			continue
		}
		if data, err := s.File(a.Hash); err == nil {
			*budget -= a.Size
			html = strings.ReplaceAll(html, "cid:"+a.CID, "data:"+a.Type+";base64,"+base64.StdEncoding.EncodeToString(data))
		}
	}
	return html
}
