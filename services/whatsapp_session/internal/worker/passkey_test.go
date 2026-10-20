package worker

import (
	"bytes"
	"macro.com/whatsapp-session/internal/protocol"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPinnedNativeAssertionExtensionsPreserveSignedBytes(t *testing.T) {
	// PublicKeyCredential at beeper/webauthn-rs@579f914 always emits extensions.
	payload := `{"id":"_wAB","rawId":"_wAB","type":"public-key","response":{"clientDataJSON":"e30","authenticatorData":"AAE","signature":"_wI","userHandle":"AQI"},"extensions":{"appid":false}}`
	request := httptest.NewRequest(http.MethodPost, "/pair/owned/passkey", strings.NewReader(payload))
	out := httptest.NewRecorder()
	var assertion passkeyAssertion
	if err := decode(out, request, &assertion); err != nil {
		t.Fatal("pinned native assertion rejected", err)
	}
	if !bytes.Equal(assertion.RawID, []byte{255, 0, 1}) || !bytes.Equal(assertion.Response.ClientDataJSON, []byte("{}")) || !bytes.Equal(assertion.Response.AuthenticatorData, []byte{0, 1}) || !bytes.Equal(assertion.Response.Signature, []byte{255, 2}) || assertion.Response.UserHandle == nil || !bytes.Equal(*assertion.Response.UserHandle, []byte{1, 2}) {
		t.Fatal("signed assertion bytes changed")
	}
	// The real worker route gets past decoding but refuses a completed/other flow,
	// before any authenticator or WhatsApp operation is attempted.
	worker := &Worker{pairID: "owned", pair: protocol.PairState{State: "connected", ExpiresAt: time.Now().Add(time.Minute)}}
	out = httptest.NewRecorder()
	worker.Handler().ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/pair/other/passkey", strings.NewReader(payload)))
	if out.Code != http.StatusForbidden {
		t.Fatalf("owner/state fence bypassed or decode failed: %d", out.Code)
	}
	unknown := strings.TrimSuffix(payload, "}") + `,"unexpected":true}`
	out = httptest.NewRecorder()
	worker.Handler().ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/pair/owned/passkey", strings.NewReader(unknown)))
	if out.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields became permissive: %d", out.Code)
	}
}
