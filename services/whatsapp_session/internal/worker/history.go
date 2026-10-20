package worker

import (
	"context"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"macro.com/whatsapp-session/internal/protocol"
	"time"
)

// The manual upstream path keeps the decrypted notification and withholds its
// ordinary/peer/history receipts until this Message callback succeeds.
func (w *Worker) historyMessage(ctx context.Context, event *events.Message, notification *waE2E.HistorySyncNotification) error {
	if !event.Info.IsFromMe || !w.own(event.Info.Sender.ToNonAD().String()) {
		return nil
	}
	if !w.historyMu.TryLock() {
		return protocol.ErrUnavailable
	}
	defer w.historyMu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	checkpoint := "history:" + event.Info.ID
	complete, err := w.journal.Seen(ctx, checkpoint)
	if err != nil {
		return err
	}
	if !complete {
		data := notification.GetInitialHistBootstrapInlinePayload()
		if data == nil {
			file := &boundedFile{}
			if err = w.client.DownloadToFile(ctx, notification, file); err != nil {
				return protocol.ErrUnavailable
			}
			data = file.data
		}
		if len(data) > protocol.MaxMediaBytes {
			return protocol.ErrInvalid
		}
		history, err := w.client.ParseHistorySync(ctx, data, true, 64<<20)
		if err != nil {
			return protocol.ErrInvalid
		}
		if err = w.history(ctx, history, checkpoint); err != nil {
			return err
		}
		if err = w.journal.MarkSeen(ctx, checkpoint); err != nil {
			return err
		}
	}
	if err = w.client.SendProtocolMessageReceipt(ctx, event.Info.ID, types.ReceiptTypeHistorySync); err != nil {
		return protocol.ErrUnavailable
	}
	if event.Info.Category == "peer" {
		if err = w.client.SendProtocolMessageReceipt(ctx, event.Info.ID, types.ReceiptTypePeerMsg); err != nil {
			return protocol.ErrUnavailable
		}
	}
	// Deletion is best-effort only after native-normalized facts and the completion
	// checkpoint are durable; a lost receipt can retry without the deleted blob.
	if notification.GetDirectPath() != "" {
		_ = w.client.DeleteMedia(ctx, whatsmeow.MediaHistory, notification.GetDirectPath(), notification.GetFileEncSHA256(), notification.GetEncHandle())
	}
	return nil
}
func (w *Worker) history(ctx context.Context, data *waHistorySync.HistorySync, checkpoint string) error {
	conversationIndex, messageIndex := 0, 0
	if checkpoint != "" {
		var err error
		conversationIndex, messageIndex, err = w.journal.HistoryCursor(ctx, checkpoint)
		if err != nil {
			return err
		}
	}
	for ci, conversation := range data.GetConversations() {
		if ci < conversationIndex {
			continue
		}
		jid, parseErr := types.ParseJID(conversation.GetID())
		allowed := false
		if parseErr == nil && protocol.Group(jid.String()) {
			var err error
			allowed, err = w.journal.Allowed(ctx, jid.String(), w.scope.Generation, time.Now())
			if err != nil {
				return err
			}
		}
		if allowed {
			for mi, item := range conversation.GetMessages() {
				if ci == conversationIndex && mi < messageIndex {
					continue
				}
				if err := ctx.Err(); err != nil {
					return err
				}
				message, err := w.client.ParseWebMessage(jid, item.GetMessage())
				if err == nil {
					if err = w.message(ctx, message, true); err != nil {
						return err
					}
				}
				// Advance only after durable append/drop. A crash before this small write
				// replays at most one item; its stable queued/acknowledged ID deduplicates it.
				if checkpoint != "" {
					if err = w.journal.AdvanceHistory(ctx, checkpoint, ci, mi+1); err != nil {
						return err
					}
				}
			}
		}
		if checkpoint != "" {
			if err := w.journal.AdvanceHistory(ctx, checkpoint, ci+1, 0); err != nil {
				return err
			}
		}
	}
	return nil
}
