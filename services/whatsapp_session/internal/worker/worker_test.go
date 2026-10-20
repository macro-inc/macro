package worker

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/json"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"macro.com/whatsapp-session/internal/journal"
	"macro.com/whatsapp-session/internal/protocol"
	"path/filepath"
	"testing"
	"time"
)

func TestPublicationBoundaryAndScopedRemoval(t *testing.T) {
	ctx := context.Background()
	store, err := journal.Open(ctx, filepath.Join(t.TempDir(), "protocol.db"), make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	scope := protocol.Scope{AccountID: "019a0000-0000-7000-8000-000000000002", Generation: 1, Epoch: 1}
	w, err := New(ctx, store, scope, "flow", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	own := types.NewJID("15550000000", types.DefaultUserServer)
	w.client.Store.ID = &own
	w.ready.Store(true)
	w.allowlistUntil.Store(time.Now().Add(time.Minute).UnixMilli())
	group := types.NewJID("120363001", types.GroupServer)
	other := types.NewJID("15559999999", types.DefaultUserServer)
	if err = store.Allow(ctx, group.String(), 1, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	info := protocol.GroupInfo{JID: group.String(), Participants: []protocol.Participant{{Identity: protocol.Identity{JID: own.String()}}}, ObservedAt: time.Now()}
	data, _ := json.Marshal(info)
	if _, err = store.DB.ExecContext(ctx, "UPDATE macro_allowlist SET metadata=?,observed_at=? WHERE group_jid=?", data, time.Now().UnixMilli(), group.String()); err != nil {
		t.Fatal(err)
	}
	message := &events.Message{Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: other, Sender: other, SenderAlt: types.NewJID("10000099", types.HiddenUserServer)}, ID: "private", Timestamp: time.Now()}, Message: &waE2E.Message{Conversation: proto.String("Never retained")}}
	if !w.event(message) {
		t.Fatal("unadopted chat should be dropped")
	}
	rows, err := store.Events(ctx)
	if err != nil || len(rows) != 0 {
		t.Fatalf("private chat retained: %d %v", len(rows), err)
	}
	message.Info.Chat = group
	message.Info.ID = "view-once"
	message.IsViewOnce = true
	if !w.event(message) {
		t.Fatal("view-once placeholder failed")
	}
	rows, err = store.Events(ctx)
	if err != nil || len(rows) != 1 {
		t.Fatal(err)
	}
	var envelope protocol.Envelope
	if json.Unmarshal(rows[0], &envelope) != nil {
		t.Fatal("bad envelope")
	}
	if envelope.Message.Text == "Never retained" || len(envelope.Message.Media) != 0 {
		t.Fatal("view-once content archived")
	}
	if !w.event(&events.GroupInfo{JID: group, Timestamp: time.Now(), Leave: []types.JID{own}}) {
		t.Fatal("self-removal required an inaccessible network roster")
	}
	if !w.ready.Load() {
		t.Fatal("one group removal disabled all account groups")
	}
	rows, err = store.Events(ctx)
	if err != nil || len(rows) != 2 {
		t.Fatalf("removal not durable: %d %v", len(rows), err)
	}
	found := false
	for _, row := range rows {
		if json.Unmarshal(row, &envelope) == nil && envelope.Type == "group_left" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing scoped revocation")
	}
	if _, err = w.Pair("another-owner-flow"); err != protocol.ErrForbidden {
		t.Fatal("pairing flow substitution accepted")
	}
	w.pair.State = "connected"
	if err = w.Confirm(ctx, "flow"); err != protocol.ErrForbidden {
		t.Fatal("completed pairing continuation replayed")
	}
}

func TestHistoryBackpressureResumesWithoutRejournaledPrefix(t *testing.T) {
	ctx := context.Background()
	store, err := journal.Open(ctx, filepath.Join(t.TempDir(), "history.db"), make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	scope := protocol.Scope{AccountID: "019a0000-0000-7000-8000-000000000002", Generation: 1, Epoch: 1}
	w, err := New(ctx, store, scope, "flow", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	own := types.NewJID("15550000000", types.DefaultUserServer)
	w.client.Store.ID = &own
	w.allowlistUntil.Store(time.Now().Add(time.Minute).UnixMilli())
	group := types.NewJID("120363002", types.GroupServer)
	if err = store.Allow(ctx, group.String(), 1, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	info := protocol.GroupInfo{JID: group.String(), Participants: []protocol.Participant{{Identity: protocol.Identity{JID: own.String()}}}, ObservedAt: time.Now()}
	metadata, _ := json.Marshal(info)
	if _, err = store.DB.ExecContext(ctx, "UPDATE macro_allowlist SET metadata=?,observed_at=? WHERE group_jid=?", metadata, time.Now().UnixMilli(), group.String()); err != nil {
		t.Fatal(err)
	}
	data := &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(), Conversations: []*waHistorySync.Conversation{{ID: proto.String(group.String()), Messages: []*waHistorySync.HistorySyncMsg{
		{Message: &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{ID: proto.String("history-one"), RemoteJID: proto.String(group.String()), Participant: proto.String("15550000001@s.whatsapp.net")}, MessageTimestamp: proto.Uint64(uint64(time.Now().Unix())), Message: &waE2E.Message{Conversation: proto.String("first")}}},
		{Message: &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{ID: proto.String("history-two"), RemoteJID: proto.String(group.String()), Participant: proto.String("15550000001@s.whatsapp.net")}, MessageTimestamp: proto.Uint64(uint64(time.Now().Unix())), Message: &waE2E.Message{Conversation: proto.String("second")}}},
	}}}}
	raw, err := proto.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	writer := zlib.NewWriter(&compressed)
	writer.Write(raw)
	writer.Close()
	notification := &waE2E.HistorySyncNotification{InitialHistBootstrapInlinePayload: compressed.Bytes()}
	event := &events.Message{Info: types.MessageInfo{ID: "history-notification", MessageSource: types.MessageSource{IsFromMe: true, Chat: own, Sender: own}}}
	if _, err = store.DB.ExecContext(ctx, "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4095) INSERT INTO macro_event(id,body,created_at) SELECT 'fixture-'||x,'{}',1 FROM n"); err != nil {
		t.Fatal(err)
	}
	if err = w.historyMessage(ctx, event, notification); err == nil {
		t.Fatal("full journal acknowledged history")
	}
	complete, _ := store.Seen(ctx, "history:history-notification")
	if complete {
		t.Fatal("partial history marked complete")
	}
	if _, err = store.DB.ExecContext(ctx, "DELETE FROM macro_event WHERE id LIKE 'fixture-%'"); err != nil {
		t.Fatal(err)
	}
	// A missing socket can reject only the receipt after the durable checkpoint.
	if err = w.historyMessage(ctx, event, notification); err != protocol.ErrUnavailable {
		t.Fatalf("history retry failed before receipt: %v", err)
	}
	complete, err = store.Seen(ctx, "history:history-notification")
	if err != nil || !complete {
		t.Fatal("history completion missing", err)
	}
	rows, err := store.Events(ctx)
	if err != nil || len(rows) != 2 {
		t.Fatalf("prefix duplicated: %d %v", len(rows), err)
	}
	var first protocol.Envelope
	if err = json.Unmarshal(rows[0], &first); err != nil {
		t.Fatal(err)
	}
	if err = store.Ack(ctx, first.EventID); err != nil {
		t.Fatal(err)
	}
	if err = w.history(ctx, data, ""); err != nil {
		t.Fatal(err)
	}
	rows, _ = store.Events(ctx)
	if len(rows) != 1 {
		t.Fatal("acknowledged prefix re-entered journal")
	}
	notification.InitialHistBootstrapInlinePayload = []byte("no longer downloadable")
	if err = w.historyMessage(ctx, event, notification); err != protocol.ErrUnavailable {
		t.Fatalf("completed history re-downloaded: %v", err)
	}
}
