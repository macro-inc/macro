// Package protocol contains versioned, bounded RPC data. No protobuf or session key
// crosses this boundary. JIDs are typed protocol identities, not display names.
package protocol

import (
	"encoding/json"
	"errors"
	"regexp"
	"time"
)

const Version = 1
const MaxEventBytes = 1 << 20
const MaxMediaBytes = 32 << 20
const MaxTextBytes = 16 << 10

var ErrInvalid = errors.New("invalid_request")
var ErrConflict = errors.New("conflicting_request")
var ErrUnavailable = errors.New("session_unavailable")
var ErrForbidden = errors.New("not_authorized")
var groupPattern = regexp.MustCompile(`^[0-9-]+@g\.us$`)
var personPattern = regexp.MustCompile(`^[0-9]+@(s\.whatsapp\.net|lid)$`)

func Group(jid string) bool  { return len(jid) <= 256 && groupPattern.MatchString(jid) }
func Person(jid string) bool { return len(jid) <= 256 && personPattern.MatchString(jid) }

type Scope struct {
	AccountID  string `json:"accountId"`
	Generation int64  `json:"authorizationGeneration"`
	Epoch      int64  `json:"ownerEpoch"`
}
type Envelope struct {
	SchemaVersion int    `json:"schemaVersion"`
	EventID       string `json:"eventId"`
	Scope
	GroupJID   string     `json:"groupJid,omitempty"`
	SourceAt   time.Time  `json:"sourceAt"`
	ObservedAt time.Time  `json:"observedAt"`
	Type       string     `json:"type"`
	Message    *Message   `json:"message,omitempty"`
	Group      *GroupInfo `json:"group,omitempty"`
	Receipt    *Receipt   `json:"receipt,omitempty"`
}
type Identity struct {
	JID          string `json:"jid"`
	AlternateJID string `json:"alternateJid,omitempty"`
	DisplayName  string `json:"displayName,omitempty"`
}
type Message struct {
	SourceID string   `json:"sourceId"`
	Sender   Identity `json:"sender"`
	Text     string   `json:"text"`
	Kind     string   `json:"kind"`
	History  bool     `json:"history"`
	Revision int64    `json:"revision"`
	Target   *Target  `json:"target,omitempty"`
	Media    []Media  `json:"media"`
}
type Target struct {
	SourceID  string `json:"sourceId"`
	SenderJID string `json:"senderJid"`
}
type Media struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	MIME     string `json:"mime"`
	Filename string `json:"filename"`
	Size     uint64 `json:"size"`
	SHA256   string `json:"sha256"`
}
type Receipt struct {
	SourceIDs      []string `json:"sourceIds"`
	ParticipantJID string   `json:"participantJid"`
	State          string   `json:"state"`
}
type GroupInfo struct {
	JID          string        `json:"jid"`
	Name         string        `json:"name"`
	Participants []Participant `json:"participants"`
	Announce     bool          `json:"announce"`
	Disappearing bool          `json:"disappearing"`
	Community    bool          `json:"community"`
	Version      int64         `json:"version"`
	ObservedAt   time.Time     `json:"observedAt"`
}
type Participant struct {
	Identity
	Admin bool `json:"admin"`
}
type Command struct {
	SchemaVersion int    `json:"schemaVersion"`
	CommandID     string `json:"commandId"`
	Scope
	GroupJID  string    `json:"groupJid"`
	SourceID  string    `json:"sourceId"`
	ExpiresAt time.Time `json:"expiresAt"`
	Digest    string    `json:"digest"`
	Content   Content   `json:"content"`
}
type Content struct {
	Raw      json.RawMessage `json:"-"`
	Kind     string          `json:"kind"`
	Text     string          `json:"text"`
	Target   *Target         `json:"target,omitempty"`
	MediaID  string          `json:"mediaId,omitempty"`
	MIME     string          `json:"mime,omitempty"`
	Filename string          `json:"filename,omitempty"`
	Voice    bool            `json:"voice,omitempty"`
}
type Result struct {
	CommandID string `json:"commandId"`
	SourceID  string `json:"sourceId"`
	State     string `json:"state"`
	Error     string `json:"error,omitempty"`
}

// PairState is deliberately never logged or persisted outside the encrypted worker
// store. QR/challenge bytes expire with the initiating transaction.
type PairState struct {
	State       string          `json:"state"`
	QR          string          `json:"qr,omitempty"`
	Code        string          `json:"code,omitempty"`
	Challenge   json.RawMessage `json:"challenge,omitempty"`
	IdentityJID string          `json:"identityJid,omitempty"`
	ExpiresAt   time.Time       `json:"expiresAt"`
}

func (c Command) Validate(scope Scope) error {
	if c.SchemaVersion != Version || c.Scope != scope || !Group(c.GroupJID) || len(c.CommandID) != 36 || len(c.SourceID) == 0 || len(c.SourceID) > 256 || len(c.Digest) != 64 || len(c.Content.Text) > MaxTextBytes {
		return ErrInvalid
	}
	switch c.Content.Kind {
	case "text", "image", "audio", "video", "document", "reaction", "edit", "delete":
	default:
		return ErrInvalid
	}
	if c.Content.Target != nil && (!Person(c.Content.Target.SenderJID) || len(c.Content.Target.SourceID) == 0 || len(c.Content.Target.SourceID) > 256) {
		return ErrInvalid
	}
	return nil
}

// Preserve the exact approved JSON bytes for the cross-runtime digest. Re-encoding
// would change Unicode/HTML escaping between Rust and Go.
func (c *Content) UnmarshalJSON(data []byte) error {
	type plain Content
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*c = Content(value)
	c.Raw = append([]byte(nil), data...)
	return nil
}
