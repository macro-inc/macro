package supervisor

import (
	"context"
	"errors"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"macro.com/whatsapp-session/internal/journal"
	"macro.com/whatsapp-session/internal/protocol"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type testKeys struct{ fail atomic.Bool }

func (k *testKeys) GenerateDataKey(context.Context, *kms.GenerateDataKeyInput, ...func(*kms.Options)) (*kms.GenerateDataKeyOutput, error) {
	return nil, errors.New("unexpected generation")
}
func (k *testKeys) Decrypt(context.Context, *kms.DecryptInput, ...func(*kms.Options)) (*kms.DecryptOutput, error) {
	if k.fail.Load() {
		return nil, errors.New("controlled outage")
	}
	return &kms.DecryptOutput{Plaintext: make([]byte, 32)}, nil
}
func TestPhysicalRetirementAndRecoverySurviveKeyOutage(t *testing.T) {
	for _, outage := range []bool{true, false} {
		name := "later-offline-disconnect"
		if outage {
			name = "key-outage"
		}
		t.Run(name, func(t *testing.T) {
			url := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
			if url == "" {
				t.Skip("requires isolated migrated MacroDB")
			}
			ctx := context.Background()
			pool, err := pgxpool.New(ctx, url)
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			account := uuid.NewString()
			owner := "macro|" + account + "@fixture.test"
			if _, err = pool.Exec(ctx, "INSERT INTO whatsapp_linked_account(id,user_id,state,store_ref) VALUES($1,$2,'connected',$3)", account, owner, uuid.NewString()); err != nil {
				t.Fatal(err)
			}
			defer func() {
				pool.Exec(ctx, "DELETE FROM whatsapp_transport_outcome WHERE account_id=$1", account)
				pool.Exec(ctx, "DELETE FROM whatsapp_linked_account WHERE id=$1", account)
			}()
			dir := t.TempDir()
			exe := filepath.Join(dir, "worker-fixture")
			if err = os.WriteFile(exe, []byte("#!/bin/sh\nexec /bin/sleep 600\n"), 0700); err != nil {
				t.Fatal(err)
			}
			keys := &testKeys{}
			s := New(ctx, pool, Config{Executable: exe, Directory: dir, Keys: keys})
			defer s.Close()
			scope, err := s.Start(ctx, account, Start{UserID: owner, Generation: 1, ExpiresAt: time.Now().Add(time.Minute)})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(ctx, "UPDATE whatsapp_session_owner SET lease_until=now()-interval '1 hour' WHERE account_id=$1", account); err != nil {
				t.Fatal(err)
			}
			competitor := New(ctx, pool, s.config)
			defer competitor.Close()
			if _, err = competitor.Start(ctx, account, Start{UserID: owner, Generation: 1}); err == nil {
				t.Fatal("expired lease stole live writer")
			}
			storeDir := filepath.Join(dir, account, "1")
			if err = os.MkdirAll(storeDir, 0700); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(storeDir, "store-key.kms"), []byte("encrypted-test-key"), 0600); err != nil {
				t.Fatal(err)
			}
			store, err := journal.Open(ctx, filepath.Join(storeDir, "protocol.db"), make([]byte, 32))
			if err != nil {
				t.Fatal(err)
			}
			command := protocol.Command{SchemaVersion: 1, CommandID: uuid.NewString(), SourceID: "accepted-before-crash", Scope: scope, GroupJID: "120363001@g.us", ExpiresAt: time.Now().Add(time.Minute), Digest: "fixture", Content: protocol.Content{Kind: "text", Text: "private"}}
			if _, err = store.Prepare(ctx, command); err != nil {
				t.Fatal(err)
			}
			if _, err = store.Begin(ctx, command); err != nil {
				t.Fatal(err)
			}
			if err = store.Settle(ctx, command.CommandID, "accepted"); err != nil {
				t.Fatal(err)
			}
			store.DB.Close()
			keys.fail.Store(outage)
			s.Close() // blocks through kill + Wait + durable retirement, before pool close.
			var state string
			if err = pool.QueryRow(ctx, "SELECT state FROM whatsapp_session_owner WHERE account_id=$1", account).Scan(&state); err != nil || state != "terminated" {
				t.Fatalf("not durably retired: %s %v", state, err)
			}
			if _, err = os.Stat(filepath.Join(storeDir, "retirement.json")); err != nil {
				t.Fatal("lost retry marker", err)
			}
			if _, err = pool.Exec(ctx, "UPDATE whatsapp_linked_account SET state='disconnected',authorization_generation=2 WHERE id=$1", account); err != nil {
				t.Fatal(err)
			}
			keys.fail.Store(false)
			if err = s.retryRetirements(ctx, account); err != nil {
				t.Fatal(err)
			}
			result, err := s.outcome(ctx, account, 1, command.CommandID)
			if err != nil || result.State != "accepted" {
				t.Fatalf("lost accepted result: %+v %v", result, err)
			}
			if _, err = os.Stat(filepath.Join(storeDir, "store-key.kms")); !os.IsNotExist(err) {
				t.Fatal("retired live keys were not erased")
			}
			result, err = s.outcome(ctx, account, 1, command.CommandID)
			if err != nil || result.SourceID != command.SourceID {
				t.Fatal("secret-free lookup failed", err)
			}

		})
	}
}
