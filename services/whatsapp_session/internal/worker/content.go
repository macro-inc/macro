package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"macro.com/whatsapp-session/internal/protocol"
)

func (w *Worker) message(ctx context.Context, event *events.Message, history bool) error {
	group := event.Info.Chat.String()
	allowed, err := w.journal.Allowed(ctx, group, w.scope.Generation, event.Info.Timestamp)
	if err != nil {
		return err
	}
	if !allowed {
		return nil
	} // before any journal, media or log
	if time.Now().UnixMilli() > w.allowlistUntil.Load() {
		return protocol.ErrUnavailable
	}
	var cached []byte
	var observed int64
	err = w.journal.DB.QueryRowContext(ctx, "SELECT coalesce(metadata,'null'),coalesce(observed_at,0) FROM macro_allowlist WHERE group_jid=?", group).Scan(&cached, &observed)
	if err != nil {
		return err
	}
	var info protocol.GroupInfo
	if json.Unmarshal(cached, &info) != nil || info.JID != group || observed < time.Now().Add(-45*time.Second).UnixMilli() {
		info, err = w.Group(ctx, group)
		if err != nil {
			return err
		}
		envelope := w.Envelope("group", group, info.ObservedAt)
		envelope.Group = &info
		if err = w.journal.Append(ctx, envelope); err != nil {
			return err
		}
	}
	if info.Disappearing || info.Community {
		return nil
	}
	member := false
	for _, p := range info.Participants {
		if w.own(p.JID) || w.own(p.AlternateJID) {
			member = true
			break
		}
	}
	if !member {
		return nil
	}
	sender := event.Info.Sender.ToNonAD().String()
	alternate := event.Info.SenderAlt.ToNonAD().String()
	if !protocol.Person(sender) {
		return nil
	}
	if !protocol.Person(alternate) && w.client.Store.LIDs != nil {
		var mapped types.JID
		var err error
		if event.Info.Sender.Server == types.HiddenUserServer {
			mapped, err = w.client.Store.LIDs.GetPNForLID(ctx, event.Info.Sender.ToNonAD())
		} else {
			mapped, err = w.client.Store.LIDs.GetLIDForPN(ctx, event.Info.Sender.ToNonAD())
		}
		alternate = ""
		if err == nil && protocol.Person(mapped.String()) {
			alternate = mapped.String()
		}
	}
	m := event.Message
	normalized := &protocol.Message{SourceID: event.Info.ID, Sender: protocol.Identity{JID: sender, AlternateJID: alternate, DisplayName: bounded(event.Info.PushName, 512)}, History: history, Kind: "text", Media: []protocol.Media{}}
	var descriptor proto.Message
	var media protocol.Media
	if event.IsViewOnce || event.IsViewOnceV2 || event.IsViewOnceV2Extension || event.IsEphemeral {
		normalized.Kind = "unsupported"
		normalized.Text = "This disappearing or view-once message is available in WhatsApp."
	} else if p := m.GetProtocolMessage(); p != nil && p.GetType() == waE2E.ProtocolMessage_REVOKE {
		normalized.Kind = "delete"
		normalized.Target = &protocol.Target{SourceID: p.GetKey().GetID(), SenderJID: p.GetKey().GetParticipant()}
		if normalized.Target.SenderJID == "" {
			normalized.Target.SenderJID = sender
		}
		if normalized.Target.SenderJID != sender && normalized.Target.SenderJID != alternate {
			return nil
		}
		normalized.Revision = event.Info.Timestamp.UnixMilli()
		if err = w.journal.DeleteMedia(ctx, group, normalized.Target.SourceID); err != nil {
			return err
		}
	} else if p := m.GetProtocolMessage(); p != nil && p.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
		normalized.Kind = "edit"
		normalized.Target = &protocol.Target{SourceID: p.GetKey().GetID(), SenderJID: sender}
		normalized.Text = messageText(p.GetEditedMessage())
		normalized.Revision = p.GetTimestampMS()
	} else if r := m.GetReactionMessage(); r != nil {
		normalized.Kind = "reaction"
		normalized.Text = r.GetText()
		normalized.Revision = r.GetSenderTimestampMS()
		normalized.Target = &protocol.Target{SourceID: r.GetKey().GetID(), SenderJID: r.GetKey().GetParticipant()}
		if normalized.Target.SenderJID == "" && r.GetKey().GetFromMe() {
			normalized.Target.SenderJID = w.client.Store.ID.ToNonAD().String()
		}
		if !protocol.Person(normalized.Target.SenderJID) {
			return nil
		}
	} else {
		normalized.Text = messageText(m)
		var contextInfo *waE2E.ContextInfo
		switch {
		case m.GetImageMessage() != nil:
			p := m.GetImageMessage()
			descriptor = p
			media = protocol.Media{Kind: "image", MIME: p.GetMimetype(), Size: p.GetFileLength(), SHA256: hex.EncodeToString(p.GetFileSHA256()), Filename: "WhatsApp image"}
			contextInfo = p.GetContextInfo()
		case m.GetAudioMessage() != nil:
			p := m.GetAudioMessage()
			descriptor = p
			media = protocol.Media{Kind: "audio", MIME: p.GetMimetype(), Size: p.GetFileLength(), SHA256: hex.EncodeToString(p.GetFileSHA256()), Filename: "WhatsApp audio"}
			contextInfo = p.GetContextInfo()
		case m.GetVideoMessage() != nil:
			p := m.GetVideoMessage()
			descriptor = p
			media = protocol.Media{Kind: "video", MIME: p.GetMimetype(), Size: p.GetFileLength(), SHA256: hex.EncodeToString(p.GetFileSHA256()), Filename: "WhatsApp video"}
			contextInfo = p.GetContextInfo()
		case m.GetDocumentMessage() != nil:
			p := m.GetDocumentMessage()
			descriptor = p
			media = protocol.Media{Kind: "document", MIME: p.GetMimetype(), Size: p.GetFileLength(), SHA256: hex.EncodeToString(p.GetFileSHA256()), Filename: bounded(filepath.Base(p.GetFileName()), 255)}
			contextInfo = p.GetContextInfo()
		default:
			contextInfo = m.GetExtendedTextMessage().GetContextInfo()
			if normalized.Text == "" {
				normalized.Kind = "unsupported"
				normalized.Text = "This message is available in WhatsApp."
			}
		}
		if contextInfo.GetExpiration() > 0 {
			descriptor = nil
			normalized.Kind = "unsupported"
			normalized.Text = "This disappearing message is available in WhatsApp."
		}
		if descriptor != nil {
			if media.Size == 0 || media.Size > protocol.MaxMediaBytes || !supportedMedia(media.Kind, media.MIME) {
				normalized.Text += "\nAttachment unavailable in Macro."
			} else {
				digest := sha256.Sum256([]byte(group + "\x00" + sender + "\x00" + event.Info.ID + "\x00" + media.SHA256))
				media.ID = hex.EncodeToString(digest[:])
				serialized, err := proto.Marshal(descriptor)
				if err != nil {
					return err
				}
				if err = w.journal.PutMedia(ctx, media.ID, group, event.Info.ID, media.Kind, serialized, nil); err != nil {
					return err
				}
				normalized.Media = append(normalized.Media, media)
			}
		}
		if contextInfo.GetStanzaID() != "" && protocol.Person(contextInfo.GetParticipant()) {
			normalized.Target = &protocol.Target{SourceID: contextInfo.GetStanzaID(), SenderJID: contextInfo.GetParticipant()}
		}
	}
	normalized.Text = bounded(normalized.Text, protocol.MaxTextBytes)
	envelope := w.Envelope("message", group, event.Info.Timestamp)
	canonicalSender := sender
	if strings.HasSuffix(alternate, "@s.whatsapp.net") {
		canonicalSender = alternate
	}
	envelope.EventID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(group+"\x00"+canonicalSender+"\x00"+normalized.SourceID+"\x00"+normalized.Kind+"\x00"+strconv.FormatInt(normalized.Revision, 10))).String()
	envelope.Message = normalized
	// IsFromMe is observer-relative. Only verified account identity may settle
	// an own-account intent; it never chooses a native author or global direction.
	if w.own(sender) || w.own(alternate) {
		return w.journal.Append(ctx, envelope, event.Info.ID)
	}
	return w.journal.Append(ctx, envelope)
}
func bounded(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	return strings.ToValidUTF8(s, "")
}
func messageText(m *waE2E.Message) string {
	switch {
	case m.GetConversation() != "":
		return m.GetConversation()
	case m.GetExtendedTextMessage() != nil:
		return m.GetExtendedTextMessage().GetText()
	case m.GetImageMessage() != nil:
		return m.GetImageMessage().GetCaption()
	case m.GetVideoMessage() != nil:
		return m.GetVideoMessage().GetCaption()
	case m.GetDocumentMessage() != nil:
		return m.GetDocumentMessage().GetCaption()
	}
	return ""
}
func supportedMedia(kind, mime string) bool {
	switch kind {
	case "image":
		return mime == "image/jpeg" || mime == "image/png" || mime == "image/webp"
	case "audio":
		return mime == "audio/ogg; codecs=opus" || mime == "audio/ogg" || mime == "audio/mpeg" || mime == "audio/mp4" || mime == "audio/aac"
	case "video":
		return mime == "video/mp4"
	case "document":
		return mime == "application/pdf" || mime == "text/plain"
	}
	return false
}
func (w *Worker) outgoing(ctx context.Context, c protocol.Command) (*waE2E.Message, error) {
	chat, _ := types.ParseJID(c.GroupJID)
	var contextInfo *waE2E.ContextInfo
	if c.Content.Target != nil {
		contextInfo = &waE2E.ContextInfo{StanzaID: proto.String(c.Content.Target.SourceID), Participant: proto.String(c.Content.Target.SenderJID), QuotedMessage: &waE2E.Message{Conversation: proto.String("Quoted message")}}
	}
	switch c.Content.Kind {
	case "text":
		return &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String(c.Content.Text), ContextInfo: contextInfo}}, nil
	case "reaction", "edit", "delete":
		if c.Content.Target == nil {
			return nil, protocol.ErrInvalid
		}
		sender, err := types.ParseJID(c.Content.Target.SenderJID)
		if err != nil {
			return nil, protocol.ErrInvalid
		}
		switch c.Content.Kind {
		case "reaction":
			message := w.client.BuildReaction(chat, sender, c.Content.Target.SourceID, c.Content.Text)
			message.ReactionMessage.SenderTimestampMS = proto.Int64(c.ExpiresAt.Add(-10 * time.Minute).UnixMilli())
			return message, nil
		case "edit":
			if !w.own(c.Content.Target.SenderJID) {
				return nil, protocol.ErrForbidden
			}
			return w.client.BuildEdit(chat, c.Content.Target.SourceID, &waE2E.Message{Conversation: proto.String(c.Content.Text)}), nil
		case "delete":
			if !w.own(c.Content.Target.SenderJID) {
				return nil, protocol.ErrForbidden
			}
			return w.client.BuildRevoke(chat, sender, c.Content.Target.SourceID), nil
		}
	}
	if !supportedMedia(c.Content.Kind, c.Content.MIME) {
		return nil, protocol.ErrInvalid
	}
	_, _, bytes, err := w.journal.Media(ctx, c.Content.MediaID, c.GroupJID)
	if err != nil {
		return nil, protocol.ErrUnavailable
	}
	if len(bytes) == 0 || len(bytes) > protocol.MaxMediaBytes {
		return nil, protocol.ErrInvalid
	}
	mediaType := whatsmeow.MediaDocument
	switch c.Content.Kind {
	case "image":
		mediaType = whatsmeow.MediaImage
	case "audio":
		mediaType = whatsmeow.MediaAudio
	case "video":
		mediaType = whatsmeow.MediaVideo
	}
	upload, err := w.client.Upload(ctx, bytes, mediaType)
	if err != nil {
		return nil, protocol.ErrUnavailable
	}
	switch c.Content.Kind {
	case "image":
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{URL: &upload.URL, DirectPath: &upload.DirectPath, MediaKey: upload.MediaKey, FileSHA256: upload.FileSHA256, FileEncSHA256: upload.FileEncSHA256, FileLength: &upload.FileLength, Mimetype: &c.Content.MIME, Caption: &c.Content.Text, ContextInfo: contextInfo}}, nil
	case "audio":
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{URL: &upload.URL, DirectPath: &upload.DirectPath, MediaKey: upload.MediaKey, FileSHA256: upload.FileSHA256, FileEncSHA256: upload.FileEncSHA256, FileLength: &upload.FileLength, Mimetype: &c.Content.MIME, PTT: &c.Content.Voice, ContextInfo: contextInfo}}, nil
	case "video":
		return &waE2E.Message{VideoMessage: &waE2E.VideoMessage{URL: &upload.URL, DirectPath: &upload.DirectPath, MediaKey: upload.MediaKey, FileSHA256: upload.FileSHA256, FileEncSHA256: upload.FileEncSHA256, FileLength: &upload.FileLength, Mimetype: &c.Content.MIME, Caption: &c.Content.Text, ContextInfo: contextInfo}}, nil
	default:
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{URL: &upload.URL, DirectPath: &upload.DirectPath, MediaKey: upload.MediaKey, FileSHA256: upload.FileSHA256, FileEncSHA256: upload.FileEncSHA256, FileLength: &upload.FileLength, Mimetype: &c.Content.MIME, Caption: &c.Content.Text, FileName: &c.Content.Filename, ContextInfo: contextInfo}}, nil
	}
}
func (w *Worker) Download(ctx context.Context, id, group string) ([]byte, error) {
	allowed, err := w.journal.Allowed(ctx, group, w.scope.Generation, time.Now())
	if err != nil || !allowed {
		return nil, protocol.ErrForbidden
	}
	kind, descriptor, bytes, err := w.journal.Media(ctx, id, group)
	if err != nil {
		return nil, protocol.ErrUnavailable
	}
	if len(bytes) > 0 {
		return bytes, nil
	}
	var message interface {
		whatsmeow.DownloadableMessage
		proto.Message
	}
	switch kind {
	case "image":
		message = &waE2E.ImageMessage{}
	case "audio":
		message = &waE2E.AudioMessage{}
	case "video":
		message = &waE2E.VideoMessage{}
	case "document":
		message = &waE2E.DocumentMessage{}
	default:
		return nil, protocol.ErrInvalid
	}
	if err = proto.Unmarshal(descriptor, message); err != nil {
		return nil, protocol.ErrInvalid
	}
	file := &boundedFile{}
	if err = w.client.DownloadToFile(ctx, message, file); err != nil {
		return nil, errors.New("media_unavailable")
	}
	return file.data, nil
}
