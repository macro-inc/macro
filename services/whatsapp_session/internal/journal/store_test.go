package journal

import (
	"bytes"
	"context"
	"crypto/rand"
	"macro.com/whatsapp-session/internal/protocol"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConcurrentCommandDispatchAndRestartNeverResends(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "account.db")
	store, err := Open(ctx, path, key)
	if err != nil {
		t.Fatal(err)
	}
	c := protocol.Command{SchemaVersion: 1, CommandID: "019a0000-0000-7000-8000-000000000001", SourceID: "RETAINED_SOURCE", GroupJID: "123-456@g.us", Scope: protocol.Scope{AccountID: "019a0000-0000-7000-8000-000000000002", Generation: 1, Epoch: 4}, ExpiresAt: time.Now().Add(time.Minute), Digest: "approved", Content: protocol.Content{Kind: "text", Text: "private fixture"}}
	var dispatched atomic.Int32
	var group sync.WaitGroup
	for range 7 {
		group.Go(func() {
			if _, err := store.Prepare(ctx, c); err != nil {
				t.Error(err)
				return
			}
			first, err := store.Begin(ctx, c)
			if err != nil {
				t.Error(err)
				return
			}
			if first {
				dispatched.Add(1)
			}
		})
	}
	group.Wait()
	if dispatched.Load() != 1 {
		t.Fatalf("dispatches=%d", dispatched.Load())
	}
	store.DB.Close()
	store, err = Open(ctx, path, key)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	result, err := store.Result(ctx, c.CommandID)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "unknown" {
		t.Fatalf("state=%s", result.State)
	}
	if first, err := store.Begin(ctx, c); err != nil || first {
		t.Fatalf("restart dispatch=%v err=%v", first, err)
	}
	if err = store.ObserveAccepted(ctx, c.GroupJID, c.SourceID); err != nil {
		t.Fatal(err)
	}
	result, err = store.Result(ctx, c.CommandID)
	if err != nil || result.State != "accepted" {
		t.Fatalf("late echo did not settle: %+v %v", result, err)
	}
	changed := c
	changed.Generation = 2
	if _, err = store.Prepare(ctx, changed); err != protocol.ErrConflict {
		t.Fatalf("generation substitution: %v", err)
	}
	changed = c
	changed.GroupJID = "888@g.us"
	if _, err = store.Prepare(ctx, changed); err != protocol.ErrConflict {
		t.Fatalf("destination substitution: %v", err)
	}
	changed = c
	changed.ExpiresAt = c.ExpiresAt.Add(time.Minute)
	if _, err = store.Prepare(ctx, changed); err != protocol.ErrConflict {
		t.Fatalf("deadline extension: %v", err)
	}
}
func TestEncryptedPagesAndWrongAccountKey(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	rand.Read(key)
	path := filepath.Join(t.TempDir(), "account.db")
	store, err := Open(ctx, path, key)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.DB.ExecContext(ctx, "INSERT INTO macro_event VALUES('event',?,0)", []byte("NEVER_PLAINTEXT_SESSION_SECRET"))
	if err != nil {
		t.Fatal(err)
	}
	store.DB.Close()
	bytesOnDisk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.HasPrefix(bytesOnDisk, []byte("SQLite format")) || bytes.Contains(bytesOnDisk, []byte("NEVER_PLAINTEXT")) {
		t.Fatal("plaintext protocol database")
	}
	wrong := make([]byte, 32)
	rand.Read(wrong)
	if opened, err := Open(ctx, path, wrong); err == nil {
		opened.DB.Close()
		t.Fatal("another account key opened store")
	}
}
func TestAdoptionBoundaryAndRevocation(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	rand.Read(key)
	store, err := Open(ctx, filepath.Join(t.TempDir(), "account.db"), key)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	start := time.Now()
	if err = store.Allow(ctx, "123@g.us", 1, start); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		group      string
		generation int64
		at         time.Time
		want       bool
	}{{"123@g.us", 1, start.Add(time.Second), true}, {"123@g.us", 1, start.Add(-time.Second), false}, {"123@g.us", 2, start.Add(time.Second), false}, {"456@g.us", 1, start.Add(time.Second), false}, {"123@s.whatsapp.net", 1, start.Add(time.Second), false}} {
		got, err := store.Allowed(ctx, check.group, check.generation, check.at)
		if err != nil || got != check.want {
			t.Fatalf("boundary %+v got=%v err=%v", check, got, err)
		}
	}
	if err = store.Revoke(ctx, "123@g.us"); err != nil {
		t.Fatal(err)
	}
	if ok, err := store.Allowed(ctx, "123@g.us", 1, start.Add(time.Second)); err != nil || ok {
		t.Fatal("revoked consent retained")
	}
}

func TestReceiptEvidenceCommitsWithInboxAndSurvivesPayloadRetention(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "account.db"), make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	c := protocol.Command{SchemaVersion: 1, CommandID: "019a0000-0000-7000-8000-000000000033", SourceID: "RECEIPT_PROOF", GroupJID: "123-456@g.us", Scope: protocol.Scope{AccountID: "019a0000-0000-7000-8000-000000000002", Generation: 1, Epoch: 1}, ExpiresAt: time.Now().Add(time.Minute), Digest: "approved", Content: protocol.Content{Kind: "text", Text: "private payload"}}
	if _, err = store.Prepare(ctx, c); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Begin(ctx, c); err != nil {
		t.Fatal(err)
	}
	e := protocol.Envelope{SchemaVersion: 1, EventID: "019a0000-0000-7000-8000-000000000034", Scope: c.Scope, GroupJID: c.GroupJID, Type: "receipt", ObservedAt: time.Now(), SourceAt: time.Now(), Receipt: &protocol.Receipt{SourceIDs: []string{c.SourceID}, ParticipantJID: "15550000001@s.whatsapp.net", State: "delivered"}}
	if err = store.Append(ctx, e, c.SourceID); err != nil {
		t.Fatal(err)
	}
	r, err := store.Result(ctx, c.CommandID)
	if err != nil || r.State != "accepted" {
		t.Fatalf("receipt lost: %+v %v", r, err)
	}
	if _, err = store.DB.ExecContext(ctx, "UPDATE macro_command SET created_at=? WHERE id=?", time.Now().Add(-8*24*time.Hour).UnixMilli(), c.CommandID); err != nil {
		t.Fatal(err)
	}
	if err = store.Prune(ctx); err != nil {
		t.Fatal(err)
	}
	var payload string
	if err = store.DB.QueryRowContext(ctx, "SELECT payload FROM macro_command WHERE id=?", c.CommandID).Scan(&payload); err != nil || payload != "{}" {
		t.Fatal("payload retained", err)
	}
	if r, err = store.Prepare(ctx, c); err != nil || r.State != "accepted" {
		t.Fatal("retention reopened command", err)
	}
}
