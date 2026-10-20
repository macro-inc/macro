package worker

import (
	"encoding/json"
	"go.mau.fi/whatsmeow/types"
	"io"
	"macro.com/whatsapp-session/internal/journal"
	"macro.com/whatsapp-session/internal/protocol"
	"net/http"
	"strings"
	"time"
)

// The pinned native authenticator emits unsigned client extensions. Accept this
// exact extra field at our boundary, but forward only WhatsApp's signed assertion.
type passkeyAssertion struct {
	types.WebAuthnResponse
	Extensions json.RawMessage `json:"extensions,omitempty"`
}

// Handler is served only over an owner-only Unix socket. The control process
// authenticates mTLS and routes the exact account/epoch to this process.
func (w *Worker) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(out http.ResponseWriter, r *http.Request) {
		reply(out, map[string]bool{"ready": w.ready.Load()}, nil)
	})
	mux.HandleFunc("GET /pair/{id}", func(out http.ResponseWriter, r *http.Request) { v, e := w.Pair(r.PathValue("id")); reply(out, v, e) })
	mux.HandleFunc("POST /pair/{id}/passkey", func(out http.ResponseWriter, r *http.Request) {
		var response passkeyAssertion
		if err := decode(out, r, &response); err != nil {
			return
		}
		reply(out, map[string]bool{"accepted": true}, w.Passkey(r.Context(), r.PathValue("id"), &response.WebAuthnResponse))
	})
	mux.HandleFunc("POST /pair/{id}/confirm", func(out http.ResponseWriter, r *http.Request) {
		reply(out, map[string]bool{"accepted": true}, w.Confirm(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("GET /groups", func(out http.ResponseWriter, r *http.Request) { v, e := w.Groups(r.Context()); reply(out, v, e) })
	mux.HandleFunc("POST /group", func(out http.ResponseWriter, r *http.Request) {
		var body struct {
			JID string `json:"jid"`
		}
		if err := decode(out, r, &body); err != nil {
			return
		}
		v, e := w.Group(r.Context(), body.JID)
		reply(out, v, e)
	})
	mux.HandleFunc("POST /allowlist", func(out http.ResponseWriter, r *http.Request) {
		var groups map[string]time.Time
		if err := decode(out, r, &groups); err != nil {
			return
		}
		err := w.journal.ReplaceAllowlist(r.Context(), w.scope.Generation, groups)
		if err == nil {
			w.allowlistUntil.Store(time.Now().Add(30 * time.Second).UnixMilli())
		}
		reply(out, map[string]bool{"updated": err == nil}, err)
	})
	mux.HandleFunc("POST /revoke", func(out http.ResponseWriter, r *http.Request) {
		var body struct {
			Group string `json:"groupJid"`
		}
		if err := decode(out, r, &body); err != nil {
			return
		}
		reply(out, map[string]bool{"revoked": true}, w.journal.Revoke(r.Context(), body.Group))
	})
	mux.HandleFunc("POST /commands/prepare", func(out http.ResponseWriter, r *http.Request) {
		var c protocol.Command
		if err := decode(out, r, &c); err != nil {
			return
		}
		v, e := w.Prepare(r.Context(), c)
		reply(out, v, e)
	})
	mux.HandleFunc("POST /commands/dispatch", func(out http.ResponseWriter, r *http.Request) {
		var c protocol.Command
		if err := decode(out, r, &c); err != nil {
			return
		}
		v, e := w.Dispatch(r.Context(), c)
		reply(out, v, e)
	})
	mux.HandleFunc("GET /commands/{id}", func(out http.ResponseWriter, r *http.Request) {
		v, e := w.journal.Result(r.Context(), r.PathValue("id"))
		reply(out, v, e)
	})
	mux.HandleFunc("GET /events", func(out http.ResponseWriter, r *http.Request) {
		v, e := w.journal.Events(r.Context())
		reply(out, v, e)
	})
	mux.HandleFunc("DELETE /events/{id}", func(out http.ResponseWriter, r *http.Request) {
		reply(out, map[string]bool{"acknowledged": true}, w.journal.Ack(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("PUT /media/{id}", func(out http.ResponseWriter, r *http.Request) {
		group := r.Header.Get("X-Group-Jid")
		allowed, e := w.journal.Allowed(r.Context(), group, w.scope.Generation, time.Now())
		if e != nil || !allowed {
			reply(out, nil, protocol.ErrForbidden)
			return
		}
		bytes, e := io.ReadAll(http.MaxBytesReader(out, r.Body, protocol.MaxMediaBytes))
		if e != nil {
			reply(out, nil, protocol.ErrInvalid)
			return
		}
		e = w.journal.PutMedia(r.Context(), r.PathValue("id"), group, "", "outgoing", nil, bytes)
		reply(out, map[string]bool{"stored": true}, e)
	})
	mux.HandleFunc("POST /media/{id}", func(out http.ResponseWriter, r *http.Request) {
		var body struct {
			Group string `json:"groupJid"`
		}
		if err := decode(out, r, &body); err != nil {
			return
		}
		bytes, e := w.Download(r.Context(), r.PathValue("id"), body.Group)
		if e != nil {
			reply(out, nil, e)
			return
		}
		out.Header().Set("Content-Type", "application/octet-stream")
		out.Header().Set("Cache-Control", "no-store")
		out.Write(bytes)
	})
	mux.HandleFunc("POST /logout", func(out http.ResponseWriter, r *http.Request) {
		reply(out, map[string]bool{"remoteUnlinkConfirmed": w.Logout(r.Context())}, nil)
	})
	mediaSlots := make(chan struct{}, 2)
	return http.HandlerFunc(func(out http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/media/") {
			select {
			case mediaSlots <- struct{}{}:
				defer func() { <-mediaSlots }()
			default:
				http.Error(out, "media_busy", http.StatusTooManyRequests)
				return
			}
		}
		out.Header().Set("Cache-Control", "no-store")
		out.Header().Set("Referrer-Policy", "no-referrer")
		mux.ServeHTTP(out, r)
	})
}
func decode(out http.ResponseWriter, r *http.Request, value any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(out, r.Body, protocol.MaxEventBytes))
	decoder.DisallowUnknownFields()
	err := decoder.Decode(value)
	if err != nil {
		reply(out, nil, protocol.ErrInvalid)
	}
	return err
}
func reply(out http.ResponseWriter, value any, err error) {
	out.Header().Set("Content-Type", "application/json")
	if err != nil {
		code := http.StatusServiceUnavailable
		if err == protocol.ErrInvalid {
			code = 400
		}
		if err == protocol.ErrForbidden {
			code = 403
		}
		if err == protocol.ErrConflict {
			code = 409
		}
		out.WriteHeader(code)
		json.NewEncoder(out).Encode(map[string]string{"error": journal.SafeError(err)})
		return
	}
	json.NewEncoder(out).Encode(value)
}
