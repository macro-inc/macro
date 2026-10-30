// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//go:build rustport

package whatsmeow

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestGeneratePresence(t *testing.T) {
	values := vectors{}
	cli, logger := newCaptureClient(t)
	ctx := context.Background()
	jid := mustJID(t, "5555@s.whatsapp.net")
	requests := map[string]string{}
	requests["unavailable"] = captureNode(t, logger, func() { _ = cli.SendPresence(ctx, types.PresenceUnavailable) })
	requests["subscribe"] = captureNode(t, logger, func() { _ = cli.SubscribePresence(ctx, jid) })
	requests["composing_audio"] = captureNode(t, logger, func() {
		_ = cli.SendChatPresence(ctx, jid, types.ChatPresenceComposing, types.ChatPresenceMediaAudio)
	})
	requests["paused"] = captureNode(t, logger, func() {
		_ = cli.SendChatPresence(ctx, jid, types.ChatPresencePaused, types.ChatPresenceMediaAudio)
	})
	values["requests"] = requests
	writeVectors(t, "presence.json", values)
}
