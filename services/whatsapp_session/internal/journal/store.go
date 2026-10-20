// Package journal owns the encrypted per-account protocol and adapter store.
package journal

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"time"

	_ "github.com/mutecomm/go-sqlcipher/v4"
	"macro.com/whatsapp-session/internal/protocol"
)

const MaxPendingEvents = 4096
const MaxPendingBytes = 64 << 20
const MaxCommands = 128

type Store struct{ DB *sql.DB }

func Open(ctx context.Context, path string, key []byte) (*Store, error) {
	if len(key) != 32 {
		return nil, protocol.ErrInvalid
	}
	// SQLCipher encrypts every page, WAL and rollback journal. This is application
	// storage encryption using an account-bound KMS envelope key, not disk-only encryption.
	query := url.Values{"_pragma_key": {"x'" + hex.EncodeToString(key) + "'"}, "_pragma_cipher_page_size": {"4096"}, "_foreign_keys": {"on"}, "_journal_mode": {"WAL"}, "_synchronous": {"FULL"}, "_busy_timeout": {"5000"}}
	db, err := sql.Open("sqlite3", "file:"+path+"?"+query.Encode())
	if err != nil {
		return nil, protocol.ErrUnavailable
	}
	db.SetMaxOpenConns(1)
	var version string
	if err = db.QueryRowContext(ctx, "PRAGMA cipher_version").Scan(&version); err != nil || version == "" {
		db.Close()
		return nil, errors.New("encrypted_store_required")
	}
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, errors.New("store_open_failed")
	}
	if err = os.Chmod(path, 0600); err != nil {
		db.Close()
		return nil, err
	}
	_, err = db.ExecContext(ctx, schema)
	if err != nil {
		db.Close()
		return nil, errors.New("journal_migration_failed")
	}
	// No dispatch is repeatable after process death. Retained IDs/late evidence can settle it.
	if _, err = db.ExecContext(ctx, "UPDATE macro_command SET state='unknown' WHERE state='dispatching'"); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{DB: db}, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS macro_command (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL, source_id TEXT NOT NULL UNIQUE,
 group_jid TEXT NOT NULL, generation INTEGER NOT NULL, epoch INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, payload BLOB NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','dispatching','accepted','rejected','unknown')),
 error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS macro_history_cursor(id TEXT PRIMARY KEY,conversation INTEGER NOT NULL,message INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS macro_seen_event (id TEXT PRIMARY KEY,observed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS macro_event (
 id TEXT PRIMARY KEY, body BLOB NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS macro_allowlist (
 group_jid TEXT PRIMARY KEY, generation INTEGER NOT NULL, starts_at INTEGER NOT NULL,
 ends_at INTEGER, metadata BLOB, observed_at INTEGER
);
CREATE TABLE IF NOT EXISTS macro_media (
 id TEXT PRIMARY KEY, group_jid TEXT NOT NULL, source_id TEXT NOT NULL,
 kind TEXT NOT NULL, descriptor BLOB, bytes BLOB, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS macro_media_expiry ON macro_media(expires_at);
`

func (s *Store) Allow(ctx context.Context, group string, generation int64, start time.Time) error {
	if !protocol.Group(group) || generation < 1 {
		return protocol.ErrInvalid
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO macro_allowlist(group_jid,generation,starts_at) VALUES(?,?,?)
      ON CONFLICT(group_jid) DO UPDATE SET generation=excluded.generation,
      starts_at=CASE WHEN macro_allowlist.generation=excluded.generation AND macro_allowlist.ends_at IS NULL THEN min(macro_allowlist.starts_at,excluded.starts_at) ELSE excluded.starts_at END,ends_at=NULL`, group, generation, start.UnixMilli())
	return err
}
func (s *Store) Allowed(ctx context.Context, group string, generation int64, at time.Time) (bool, error) {
	if !protocol.Group(group) {
		return false, nil
	}
	var ok bool
	err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM macro_allowlist WHERE group_jid=? AND generation=? AND starts_at<=? AND ends_at IS NULL)`, group, generation, at.UnixMilli()).Scan(&ok)
	return ok, err
}
func (s *Store) Revoke(ctx context.Context, group string) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE macro_allowlist SET ends_at=? WHERE group_jid=?", time.Now().UnixMilli(), group)
	return err
}
func (s *Store) Append(ctx context.Context, event protocol.Envelope, acceptedSources ...string) error {
	body, err := json.Marshal(event)
	if err != nil || len(body) > protocol.MaxEventBytes {
		return protocol.ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM macro_event WHERE id=? UNION ALL SELECT 1 FROM macro_seen_event WHERE id=?)", event.EventID, event.EventID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	var count, size int
	if err = tx.QueryRowContext(ctx, "SELECT count(*),coalesce(sum(length(body)),0) FROM macro_event").Scan(&count, &size); err != nil {
		return err
	}
	if count >= MaxPendingEvents || size+len(body) > MaxPendingBytes {
		return errors.New("inbox_capacity")
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO macro_event(id,body,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING", event.EventID, body, time.Now().UnixMilli())
	if err != nil {
		return err
	}
	// Acceptance evidence and its inbound fact commit together, including the
	// crash window immediately before process retirement exports outcomes.
	if len(acceptedSources) > 256 {
		return protocol.ErrInvalid
	}
	for _, source := range acceptedSources {
		if _, err = tx.ExecContext(ctx, "UPDATE macro_command SET state='accepted' WHERE group_jid=? AND source_id=? AND state IN ('dispatching','unknown')", event.GroupJID, source); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) Events(ctx context.Context) ([]json.RawMessage, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT body FROM macro_event ORDER BY created_at,id LIMIT 32")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		result = append(result, b)
	}
	return result, rows.Err()
}
func (s *Store) Ack(ctx context.Context, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "INSERT INTO macro_seen_event(id,observed_at) SELECT id,? FROM macro_event WHERE id=? ON CONFLICT(id) DO NOTHING", time.Now().UnixMilli(), id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM macro_event WHERE id=?", id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Seen(ctx context.Context, id string) (bool, error) {
	var seen bool
	err := s.DB.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM macro_seen_event WHERE id=?)", id).Scan(&seen)
	return seen, err
}
func (s *Store) MarkSeen(ctx context.Context, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "INSERT INTO macro_seen_event(id,observed_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING", id, time.Now().UnixMilli()); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM macro_history_cursor WHERE id=?", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Prepare(ctx context.Context, c protocol.Command) (protocol.Result, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return protocol.Result{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return protocol.Result{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE macro_command SET state='rejected',error='expired_before_dispatch' WHERE state='prepared' AND expires_at<=?", time.Now().UnixMilli()); err != nil {
		return protocol.Result{}, err
	}
	var existing bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM macro_command WHERE id=?)", c.CommandID).Scan(&existing); err != nil {
		return protocol.Result{}, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM macro_command WHERE state IN ('prepared','dispatching')").Scan(&count); err != nil {
		return protocol.Result{}, err
	}
	if count >= MaxCommands && !existing {
		return protocol.Result{}, errors.New("command_capacity")
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO macro_command(id,digest,source_id,group_jid,generation,epoch,expires_at,payload,state,created_at) VALUES(?,?,?,?,?,?,?,?,'prepared',?) ON CONFLICT(id) DO NOTHING`, c.CommandID, c.Digest, c.SourceID, c.GroupJID, c.Generation, c.Epoch, c.ExpiresAt.UnixMilli(), payload, time.Now().UnixMilli())
	if err != nil {
		return protocol.Result{}, err
	}
	var digest, group string
	var generation, epoch, expiry int64
	r := protocol.Result{CommandID: c.CommandID}
	if err = tx.QueryRowContext(ctx, "SELECT digest,source_id,state,error,group_jid,generation,epoch,expires_at FROM macro_command WHERE id=?", c.CommandID).Scan(&digest, &r.SourceID, &r.State, &r.Error, &group, &generation, &epoch, &expiry); err != nil {
		return r, err
	}
	if digest != c.Digest || r.SourceID != c.SourceID || group != c.GroupJID || generation != c.Generation || epoch != c.Epoch || expiry != c.ExpiresAt.UnixMilli() {
		return r, protocol.ErrConflict
	}
	return r, tx.Commit()
}

// Begin changes state before the first external operation. Returning false means
// a duplicate request must return the retained outcome and must not send again.
func (s *Store) Begin(ctx context.Context, c protocol.Command) (bool, error) {
	r, err := s.DB.ExecContext(ctx, `UPDATE macro_command SET state='dispatching' WHERE id=? AND digest=? AND generation=? AND epoch=? AND expires_at>? AND state='prepared'`, c.CommandID, c.Digest, c.Generation, c.Epoch, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	n, err := r.RowsAffected()
	return n == 1, err
}
func (s *Store) Result(ctx context.Context, id string) (protocol.Result, error) {
	r := protocol.Result{CommandID: id}
	err := s.DB.QueryRowContext(ctx, "SELECT source_id,state,error FROM macro_command WHERE id=?", id).Scan(&r.SourceID, &r.State, &r.Error)
	return r, err
}
func (s *Store) Settle(ctx context.Context, id, state string) error {
	if state != "accepted" && state != "unknown" && state != "rejected" {
		return protocol.ErrInvalid
	}
	_, err := s.DB.ExecContext(ctx, "UPDATE macro_command SET state=? WHERE id=? AND state IN ('dispatching','unknown')", state, id)
	return err
}
func (s *Store) ObserveAccepted(ctx context.Context, group, source string) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE macro_command SET state='accepted' WHERE group_jid=? AND source_id=? AND state IN ('dispatching','unknown')", group, source)
	return err
}
func (s *Store) PutMedia(ctx context.Context, id, group, source, kind string, descriptor, bytes []byte) error {
	if len(bytes) > protocol.MaxMediaBytes || len(descriptor) > protocol.MaxEventBytes {
		return protocol.ErrInvalid
	}
	_, err := s.DB.ExecContext(ctx, "DELETE FROM macro_media WHERE expires_at<?", time.Now().UnixMilli())
	if err != nil {
		return err
	}
	var size int64
	if err = s.DB.QueryRowContext(ctx, "SELECT coalesce(sum(length(bytes)+coalesce(length(descriptor),0)),0) FROM macro_media").Scan(&size); err != nil {
		return err
	}
	if size+int64(len(bytes))+int64(len(descriptor)) > 256<<20 {
		return errors.New("media_capacity")
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO macro_media(id,group_jid,source_id,kind,descriptor,bytes,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, id, group, source, kind, descriptor, bytes, time.Now().Add(24*time.Hour).UnixMilli())
	return err
}
func (s *Store) Media(ctx context.Context, id, group string) (string, []byte, []byte, error) {
	var kind string
	var descriptor, bytes []byte
	err := s.DB.QueryRowContext(ctx, "SELECT kind,descriptor,bytes FROM macro_media WHERE id=? AND group_jid=? AND expires_at>?", id, group, time.Now().UnixMilli()).Scan(&kind, &descriptor, &bytes)
	return kind, descriptor, bytes, err
}
func (s *Store) DeleteMedia(ctx context.Context, group, source string) error {
	_, err := s.DB.ExecContext(ctx, "DELETE FROM macro_media WHERE group_jid=? AND source_id=?", group, source)
	return err
}

// Errors may contain secret DSNs or SQL values. Only this fixed category is exposed.
func SafeError(err error) string {
	if errors.Is(err, protocol.ErrConflict) {
		return "conflicting_request"
	}
	if errors.Is(err, protocol.ErrForbidden) {
		return "not_authorized"
	}
	return "temporarily_unavailable"
}

// OpenReadOnly never changes command state or opens a WhatsApp socket. It is used
// by the control service to recover original outcomes after a worker is retired.
func OpenReadOnly(ctx context.Context, path string, key []byte) (*Store, error) {
	if len(key) != 32 {
		return nil, protocol.ErrInvalid
	}
	query := url.Values{"mode": {"ro"}, "_pragma_key": {"x'" + hex.EncodeToString(key) + "'"}, "_pragma_cipher_page_size": {"4096"}, "_busy_timeout": {"5000"}}
	db, err := sql.Open("sqlite3", "file:"+path+"?"+query.Encode())
	if err != nil {
		return nil, protocol.ErrUnavailable
	}
	db.SetMaxOpenConns(1)
	var value int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM macro_command").Scan(&value); err != nil {
		db.Close()
		return nil, protocol.ErrUnavailable
	}
	return &Store{DB: db}, nil
}

// ReplaceAllowlist is a complete publication boundary, scoped across all adopted
// workspaces. Removing one workspace must not revoke another workspace's consent.
func (s *Store) ReplaceAllowlist(ctx context.Context, generation int64, groups map[string]time.Time) error {
	if len(groups) > 100 {
		return protocol.ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE macro_allowlist SET ends_at=? WHERE ends_at IS NULL", time.Now().UnixMilli()); err != nil {
		return err
	}
	for group, start := range groups {
		if !protocol.Group(group) {
			return protocol.ErrInvalid
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO macro_allowlist(group_jid,generation,starts_at) VALUES(?,?,?) ON CONFLICT(group_jid) DO UPDATE SET generation=excluded.generation,starts_at=excluded.starts_at,ends_at=NULL`, group, generation, start.UnixMilli())
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Outcomes is a bounded cursor read containing no message body, protocol key or
// media locator. The supervisor exports these before retiring a secret store.
func (s *Store) Outcomes(ctx context.Context, after string) ([]protocol.Result, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id,source_id,state,error FROM macro_command WHERE id>? ORDER BY id LIMIT 128", after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []protocol.Result{}
	for rows.Next() {
		var result protocol.Result
		if err = rows.Scan(&result.CommandID, &result.SourceID, &result.State, &result.Error); err != nil {
			return nil, err
		}
		if result.State == "dispatching" {
			result.State = "unknown"
		}
		results = append(results, result)
	}
	return results, rows.Err()
}

// Retain scalar command identity/outcome indefinitely for replay safety, but
// remove completed/uncertain payload copies after seven days and media after 24h.
func (s *Store) Prune(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE macro_command SET payload='{}' WHERE created_at<? AND state IN ('accepted','unknown','rejected') AND length(payload)>2", time.Now().Add(-7*24*time.Hour).UnixMilli())
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, "DELETE FROM macro_media WHERE expires_at<?", time.Now().UnixMilli())
	return err
}

// A small cursor never contains the history blob or unadopted chat identifiers.
func (s *Store) HistoryCursor(ctx context.Context, id string) (int, int, error) {
	var conversation, message int
	err := s.DB.QueryRowContext(ctx, "SELECT conversation,message FROM macro_history_cursor WHERE id=?", id).Scan(&conversation, &message)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, nil
	}
	return conversation, message, err
}
func (s *Store) AdvanceHistory(ctx context.Context, id string, conversation, message int) error {
	result, err := s.DB.ExecContext(ctx, "INSERT INTO macro_history_cursor(id,conversation,message) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM macro_history_cursor WHERE id=?) OR (SELECT count(*) FROM macro_history_cursor)<32 ON CONFLICT(id) DO UPDATE SET conversation=excluded.conversation,message=excluded.message WHERE (excluded.conversation,excluded.message)>(macro_history_cursor.conversation,macro_history_cursor.message)", id, conversation, message, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		var exists bool
		if err = s.DB.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM macro_history_cursor WHERE id=?)", id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return protocol.ErrUnavailable
		}
	}
	return nil
}
