// Package worker owns exactly one account's protocol session. It is never a
// publication authority and never resolves native workspace/channel identifiers.
package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"macro.com/whatsapp-session/internal/journal"
	"macro.com/whatsapp-session/internal/protocol"
	"macro.com/whatsapp-session/internal/telemetry"
)

var _ = whatsmeow.MacroDispatchSafetyVersion

type Worker struct {
	historyMu      sync.Mutex
	allowlistUntil atomic.Int64
	client         *whatsmeow.Client
	journal        *journal.Store
	scope          protocol.Scope
	ready          atomic.Bool
	closed         atomic.Bool
	send           sync.Mutex
	groupMu        sync.Mutex
	pairLock       sync.Mutex
	pair           protocol.PairState
	pairID         string
	ctx            context.Context
	cancel         context.CancelFunc
}

func New(ctx context.Context, store *journal.Store, scope protocol.Scope, pairingID string, expires time.Time) (*Worker, error) {
	container := sqlstore.NewWithDB(store.DB, "sqlite3", waLog.Noop)
	if err := container.Upgrade(ctx); err != nil {
		return nil, errors.New("protocol_store_migration_failed")
	}
	devices, err := container.GetAllDevices(ctx)
	if err != nil {
		return nil, protocol.ErrUnavailable
	}
	if len(devices) > 1 {
		return nil, errors.New("account_store_isolation_violation")
	}
	if len(devices) == 0 && pairingID == "" {
		return nil, errors.New("reconnect_required")
	}
	device := container.NewDevice()
	if len(devices) == 1 {
		device = devices[0]
	}
	workerCtx, cancel := context.WithCancel(ctx)
	w := &Worker{client: whatsmeow.NewClient(device, waLog.Noop), journal: store, scope: scope, pairID: pairingID, ctx: workerCtx, cancel: cancel, pair: protocol.PairState{State: "created", ExpiresAt: expires}}
	w.client.SynchronousAck = true
	w.client.ManualHistorySyncDownload = true
	w.client.DisableManualHistorySyncReceipt = true
	w.client.EnableDecryptedEventBuffer = true
	w.client.UseRetryMessageStore = true
	w.client.AutomaticMessageRerequestFromPhone = true
	w.client.PreRetryCallback = func(receipt *events.Receipt, id types.MessageID, _ int, _ *waE2E.Message) bool {
		if w.closed.Load() || !w.ready.Load() {
			return false
		}
		allowed, err := w.journal.Allowed(w.ctx, receipt.Chat.String(), w.scope.Generation, time.Now())
		if err != nil || !allowed {
			return false
		}
		info, err := w.Group(w.ctx, receipt.Chat.String())
		if err != nil {
			return false
		}
		sender := receipt.Sender.ToNonAD().String()
		for _, p := range info.Participants {
			if p.JID == sender || p.AlternateJID == sender {
				return true
			}
		}
		return false
	}
	w.client.AddEventHandlerWithSuccessStatus(w.event)
	return w, nil
}

func (w *Worker) Start() error {
	go func() {
		tick := time.NewTicker(15 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-w.ctx.Done():
				return
			case <-tick.C:
				_ = w.journal.Prune(w.ctx)
				if w.ready.Load() && time.Now().UnixMilli() < w.allowlistUntil.Load() {
					_ = w.refreshAdopted(w.ctx)
				}
			}
		}
	}()

	w.pairLock.Lock()
	pairDeadline := w.pair.ExpiresAt
	w.pairLock.Unlock()
	if w.pairID != "" {
		go func() {
			timer := time.NewTimer(time.Until(pairDeadline))
			defer timer.Stop()
			select {
			case <-w.ctx.Done():
				return
			case <-timer.C:
				w.pairLock.Lock()
				connected := w.pair.State == "connected"
				if !connected {
					w.pair = protocol.PairState{State: "expired", ExpiresAt: w.pair.ExpiresAt}
				}
				w.pairLock.Unlock()
				if !connected {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					_ = w.client.Logout(ctx)
					cancel()
					w.Close()
				}
			}
		}()
	}

	if w.client.Store.ID == nil {
		qr, err := w.client.GetQRChannel(w.ctx)
		if err != nil {
			return protocol.ErrUnavailable
		}
		go func() {
			for {
				select {
				case <-w.ctx.Done():
					return
				case item, ok := <-qr:
					if !ok {
						return
					}
					w.pairLock.Lock()
					if time.Now().Before(w.pair.ExpiresAt) && item.Event == "code" {
						w.pair.State = "displayed"
						w.pair.QR = item.Code
					}
					w.pairLock.Unlock()
				}
			}
		}()
	}
	if err := w.client.ConnectContext(w.ctx); err != nil {
		return protocol.ErrUnavailable
	}
	return nil
}
func (w *Worker) Close() {
	if w.closed.CompareAndSwap(false, true) {
		w.ready.Store(false)
		w.cancel()
		w.client.Disconnect()
	}
}
func (w *Worker) Scope() protocol.Scope { return w.scope }
func (w *Worker) Pair(id string) (protocol.PairState, error) {
	w.pairLock.Lock()
	defer w.pairLock.Unlock()
	if id == "" || id != w.pairID {
		return protocol.PairState{}, protocol.ErrForbidden
	}
	if w.pair.State != "connected" && time.Now().After(w.pair.ExpiresAt) {
		w.pair = protocol.PairState{State: "expired", ExpiresAt: w.pair.ExpiresAt}
		w.Close()
	}
	return w.pair, nil
}
func (w *Worker) Passkey(ctx context.Context, id string, response *types.WebAuthnResponse) error {
	w.pairLock.Lock()
	defer w.pairLock.Unlock()
	if id != w.pairID || w.pair.State != "passkey" || !time.Now().Before(w.pair.ExpiresAt) {
		return protocol.ErrForbidden
	}
	if err := w.client.SendPasskeyResponse(ctx, response); err != nil {
		return protocol.ErrUnavailable
	}
	w.pair.State = "connecting"
	w.pair.Challenge = nil
	return nil
}
func (w *Worker) Confirm(ctx context.Context, id string) error {
	w.pairLock.Lock()
	defer w.pairLock.Unlock()
	if id != w.pairID || w.pair.State != "confirmation" || !time.Now().Before(w.pair.ExpiresAt) {
		return protocol.ErrForbidden
	}
	if err := w.client.SendPasskeyConfirmation(ctx); err != nil {
		return protocol.ErrUnavailable
	}
	w.pair.Code = ""
	w.pair.State = "connecting"
	return nil
}
func (w *Worker) Logout(ctx context.Context) bool {
	w.ready.Store(false)
	err := w.client.Logout(ctx)
	w.Close()
	return err == nil
}
func (w *Worker) Envelope(kind, group string, at time.Time) protocol.Envelope {
	id, err := uuid.NewV7()
	if err != nil {
		return protocol.Envelope{}
	}
	return protocol.Envelope{SchemaVersion: protocol.Version, EventID: id.String(), Scope: w.scope, GroupJID: group, SourceAt: at, ObservedAt: time.Now().UTC(), Type: kind}
}
func (w *Worker) event(raw any) bool {
	ctx, span := telemetry.Start(w.ctx, "whatsapp.protocol_event", w.scope.AccountID, "")
	defer span.End()
	switch event := raw.(type) {
	case *events.Connected:
		if _, err := w.journal.DB.ExecContext(ctx, "UPDATE macro_allowlist SET observed_at=NULL"); err != nil {
			return false
		}
		w.pairLock.Lock()
		expired := w.pairID != "" && w.pair.State != "connected" && time.Now().After(w.pair.ExpiresAt)
		w.pairLock.Unlock()
		if expired {
			w.ready.Store(false)
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				_ = w.client.Logout(ctx)
				cancel()
				w.Close()
			}()
			return true
		}
		// Connectivity and per-group reconciliation have separate lifetimes.
		// A failed roster fetch must not disable unrelated groups forever.
		w.ready.Store(true)
		_ = w.refreshAdopted(ctx)
		w.pairLock.Lock()
		w.pair = protocol.PairState{State: "connected", IdentityJID: w.client.Store.ID.ToNonAD().String(), ExpiresAt: w.pair.ExpiresAt}
		w.pairLock.Unlock()
		return w.journal.Append(ctx, w.Envelope("connected", "", time.Now())) == nil
	case *events.Disconnected:
		w.ready.Store(false)
		return w.journal.Append(ctx, w.Envelope("offline", "", time.Now())) == nil
	case *events.LoggedOut:
		w.ready.Store(false)
		w.closed.Store(true)
		return w.journal.Append(ctx, w.Envelope("logged_out", "", time.Now())) == nil
	case *events.PairPasskeyRequest:
		w.pairLock.Lock()
		defer w.pairLock.Unlock()
		if time.Now().After(w.pair.ExpiresAt) {
			return false
		}
		if event.PublicKey.RelyingPartID != "whatsapp.com" && event.PublicKey.RelyingPartID != "web.whatsapp.com" {
			w.pair.State = "error"
			return true
		}
		challenge, err := json.Marshal(event.PublicKey)
		if err != nil {
			return false
		}
		w.pair.State = "passkey"
		w.pair.QR = ""
		w.pair.Challenge = challenge
		return true
	case *events.PairPasskeyConfirmation:
		w.pairLock.Lock()
		defer w.pairLock.Unlock()
		w.pair.State = "confirmation"
		w.pair.Code = event.Code
		w.pair.Challenge = nil
		return true
	case *events.PairPasskeyError:
		w.pairLock.Lock()
		w.pair.State = "error"
		w.pair.Challenge = nil
		w.pairLock.Unlock()
		return true
	case *events.Message:
		if notification := event.Message.GetProtocolMessage().GetHistorySyncNotification(); notification != nil {
			return w.historyMessage(ctx, event, notification) == nil
		}
		return w.message(ctx, event, false) == nil
	case *events.HistorySync:
		return w.history(ctx, event.Data, "") == nil
	case *events.GroupInfo:
		allowed, err := w.journal.Allowed(ctx, event.JID.String(), w.scope.Generation, time.Now())
		if err != nil {
			return false
		}
		if !allowed {
			return true
		}
		for _, left := range event.Leave {
			if w.own(left.ToNonAD().String()) {
				w.groupMu.Lock()
				revoked := w.Envelope("group_left", event.JID.String(), event.Timestamp)
				err := w.journal.Append(ctx, revoked)
				if err == nil {
					_, err = w.journal.DB.ExecContext(ctx, "UPDATE macro_allowlist SET observed_at=NULL WHERE group_jid=?", event.JID.String())
				}
				w.groupMu.Unlock()
				return err == nil
			}
		}
		// Refresh the full roster; do not rely on the upstream participant delta
		// parser dropping earlier PN/LID mappings in multi-child notifications.
		info, err := w.Group(ctx, event.JID.String())
		if err != nil {
			return false
		}
		envelope := w.Envelope("group", info.JID, info.ObservedAt)
		envelope.Group = &info
		return w.journal.Append(ctx, envelope) == nil
	case *events.Receipt:
		allowed, err := w.journal.Allowed(ctx, event.Chat.String(), w.scope.Generation, time.Now())
		if err != nil {
			return false
		}
		if !allowed {
			return true
		}
		envelope := w.Envelope("receipt", event.Chat.String(), event.Timestamp)
		state := string(event.Type)
		if event.Type == types.ReceiptTypeDelivered {
			state = "delivered"
		}
		envelope.Receipt = &protocol.Receipt{SourceIDs: event.MessageIDs, ParticipantJID: event.Sender.ToNonAD().String(), State: state}
		if event.Type == types.ReceiptTypeDelivered || event.Type == types.ReceiptTypeRead || event.Type == types.ReceiptTypePlayed {
			return w.journal.Append(ctx, envelope, event.MessageIDs...) == nil
		}
		return w.journal.Append(ctx, envelope) == nil
	}
	return true
}
func (w *Worker) refreshAdopted(ctx context.Context) error {
	rows, err := w.journal.DB.QueryContext(ctx, "SELECT group_jid FROM macro_allowlist WHERE generation=? AND ends_at IS NULL AND (observed_at IS NULL OR observed_at<?)", w.scope.Generation, time.Now().Add(-45*time.Second).UnixMilli())
	if err != nil {
		return err
	}
	groups := []string{}
	for rows.Next() {
		var group string
		if err = rows.Scan(&group); err != nil {
			rows.Close()
			return err
		}
		groups = append(groups, group)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var failure error
	for _, group := range groups {
		info, err := w.Group(ctx, group)
		if err != nil {
			failure = err
			continue
		}
		event := w.Envelope("group", group, info.ObservedAt)
		event.Group = &info
		if err = w.journal.Append(ctx, event); err != nil {
			return err
		}
	}
	return failure
}
func (w *Worker) Group(ctx context.Context, group string) (protocol.GroupInfo, error) {
	if !protocol.Group(group) {
		return protocol.GroupInfo{}, protocol.ErrInvalid
	}
	jid, err := types.ParseJID(group)
	if err != nil {
		return protocol.GroupInfo{}, protocol.ErrInvalid
	}
	w.groupMu.Lock()
	defer w.groupMu.Unlock()
	observed := time.Now().UTC()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	info, err := w.client.GetGroupInfo(ctx, jid)
	if err != nil {
		return protocol.GroupInfo{}, protocol.ErrUnavailable
	}
	normalized := normalizeGroup(info, observed)
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return protocol.GroupInfo{}, protocol.ErrUnavailable
	}
	if _, err = w.journal.DB.ExecContext(ctx, "UPDATE macro_allowlist SET metadata=?,observed_at=? WHERE group_jid=? AND generation=? AND ends_at IS NULL", encoded, normalized.ObservedAt.UnixMilli(), group, w.scope.Generation); err != nil {
		return protocol.GroupInfo{}, protocol.ErrUnavailable
	}
	return normalized, nil
}
func normalizeGroup(g *types.GroupInfo, now time.Time) protocol.GroupInfo {
	info := protocol.GroupInfo{JID: g.JID.String(), Name: g.Name, Announce: g.IsAnnounce, Disappearing: g.IsEphemeral, Community: g.IsParent || g.IsDefaultSubGroup, Version: now.UnixMicro(), ObservedAt: now, Participants: []protocol.Participant{}}
	for _, p := range g.Participants {
		jid := p.JID.ToNonAD().String()
		alternate := p.PhoneNumber.ToNonAD().String()
		if alternate == jid {
			alternate = p.LID.ToNonAD().String()
		}
		if !protocol.Person(alternate) {
			alternate = ""
		}
		if protocol.Person(jid) {
			info.Participants = append(info.Participants, protocol.Participant{Identity: protocol.Identity{JID: jid, AlternateJID: alternate}, Admin: p.IsAdmin || p.IsSuperAdmin})
		}
	}
	return info
}
func (w *Worker) Groups(ctx context.Context) ([]protocol.GroupInfo, error) {
	observed := time.Now().UTC()
	groups, err := w.client.GetJoinedGroups(ctx)
	if err != nil {
		return nil, protocol.ErrUnavailable
	}
	result := []protocol.GroupInfo{}
	for _, g := range groups {
		info := normalizeGroup(g, observed)
		if !info.Community && !info.Disappearing {
			result = append(result, info)
		}
	}
	return result, nil
}
func (w *Worker) own(jid string) bool {
	return (w.client.Store.ID != nil && w.client.Store.ID.ToNonAD().String() == jid) || w.client.Store.LID.ToNonAD().String() == jid
}
func (w *Worker) eligible(ctx context.Context, group string) error {
	if !w.ready.Load() || w.closed.Load() || time.Now().UnixMilli() > w.allowlistUntil.Load() {
		return protocol.ErrUnavailable
	}
	allowed, err := w.journal.Allowed(ctx, group, w.scope.Generation, time.Now())
	if err != nil || !allowed {
		return protocol.ErrForbidden
	}
	info, err := w.Group(ctx, group)
	if err != nil {
		return err
	}
	if info.Community || info.Disappearing {
		return protocol.ErrForbidden
	}
	for _, p := range info.Participants {
		if w.own(p.JID) || w.own(p.AlternateJID) {
			if info.Announce && !p.Admin {
				return protocol.ErrForbidden
			}
			return nil
		}
	}
	return protocol.ErrForbidden
}
func (w *Worker) Prepare(ctx context.Context, c protocol.Command) (protocol.Result, error) {
	if c.SourceID == "" {
		c.SourceID = w.client.GenerateMessageID()
	}
	if err := c.Validate(w.scope); err != nil {
		return protocol.Result{}, err
	}
	content, err := json.Marshal(c.Content)
	if err != nil {
		return protocol.Result{}, err
	}
	if len(c.Content.Raw) > 0 {
		content = c.Content.Raw
	}
	digest := sha256.Sum256(content)
	if hex.EncodeToString(digest[:]) != c.Digest {
		return protocol.Result{}, protocol.ErrConflict
	}
	// Stable command lookup precedes new eligibility: accepted/unknown commands
	// remain queryable after logout and never acquire fresh dispatch authority.
	old, err := w.journal.Result(ctx, c.CommandID)
	if err == nil {
		c.SourceID = old.SourceID
		return w.journal.Prepare(ctx, c)
	}
	if err = w.eligible(ctx, c.GroupJID); err != nil {
		return protocol.Result{}, err
	}
	if !time.Now().Before(c.ExpiresAt) {
		return protocol.Result{}, protocol.ErrForbidden
	}
	return w.journal.Prepare(ctx, c)
}
func (w *Worker) Dispatch(ctx context.Context, c protocol.Command) (protocol.Result, error) {
	ctx, span := telemetry.Start(ctx, "whatsapp.dispatch", w.scope.AccountID, c.CommandID)
	defer span.End()
	w.send.Lock()
	defer w.send.Unlock()
	if err := c.Validate(w.scope); err != nil {
		return protocol.Result{}, err
	}
	old, err := w.journal.Result(ctx, c.CommandID)
	if err != nil {
		return old, protocol.ErrForbidden
	}
	if old.State != "prepared" {
		return old, nil
	}
	// Compare immutable bytes and generations, then refresh membership immediately
	// before the one durable dispatch transition.
	if _, err = w.journal.Prepare(ctx, c); err != nil {
		return old, err
	}
	if err = w.eligible(ctx, c.GroupJID); err != nil {
		return old, err
	}
	message, err := w.outgoing(ctx, c)
	if err != nil {
		return old, err
	}
	if err = w.eligible(ctx, c.GroupJID); err != nil {
		return old, err
	}
	began, err := w.journal.Begin(ctx, c)
	if err != nil {
		return old, err
	}
	if !began {
		return w.journal.Result(ctx, c.CommandID)
	}
	jid, _ := types.ParseJID(c.GroupJID)
	_, sendErr := w.client.SendMessage(ctx, jid, message, whatsmeow.SendRequestExtra{ID: c.SourceID, NoDisconnectRetry: true, CheckPermissions: true, Timeout: 45 * time.Second})
	state := "accepted"
	if sendErr != nil {
		state = "unknown"
	}
	// A request cancellation must not prevent outcome persistence. The process
	// ownership context still cancels this on actual retirement/control-store loss.
	saveCtx, cancel := context.WithTimeout(w.ctx, 5*time.Second)
	defer cancel()
	if err = w.journal.Settle(saveCtx, c.CommandID, state); err != nil {
		return protocol.Result{}, protocol.ErrUnavailable
	}
	telemetry.Event(ctx, "send."+state, w.scope.AccountID, c.CommandID, 1)
	return w.journal.Result(saveCtx, c.CommandID)
}

// Done closes when this session is retired independently of HTTP clients.
func (w *Worker) Done() <-chan struct{} { return w.ctx.Done() }
