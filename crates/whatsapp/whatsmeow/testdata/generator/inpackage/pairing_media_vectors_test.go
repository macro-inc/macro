// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//go:build rustport

package whatsmeow

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"go.mau.fi/util/random"
	"golang.org/x/crypto/pbkdf2"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// TestGeneratePairingMedia records phone-number pairing, media retry,
// privacy settings and message secret vectors.
func TestGeneratePairingMedia(t *testing.T) {
	values := vectors{}

	// generateCompanionEphemeralKey: its randomness is recoverable from the
	// output (salt, IV, code), so Rust can recompute it.
	keyPair, ephemeralKey, code := generateCompanionEphemeralKey()
	values["companion_private"] = hex.EncodeToString(keyPair.Priv[:])
	values["companion_ephemeral_key"] = hex.EncodeToString(ephemeralKey)
	values["companion_linking_code"] = code
	linkingCode, err := linkingBase32.DecodeString(code)
	if err != nil {
		t.Fatal(err)
	}
	values["companion_linking_code_bytes"] = hex.EncodeToString(linkingCode)

	// handleCodePairNotification: the primary device wraps its ephemeral key
	// with the same code; the client answers with the key bundle.
	cli, logger := newCaptureClient(t)
	cli.Store.IdentityKey = fixedKeyPair(0x20)
	primaryEphemeral := fixedKeyPair(0x40)
	primaryIdentity := fixedKeyPair(0x60)
	_, wrappedPrimary, _ := func() (any, []byte, string) {
		salt := random.Bytes(32)
		iv := random.Bytes(16)
		key := ctrEncryptForVector(code, salt, iv, primaryEphemeral.Pub[:])
		return nil, append(append(salt, iv...), key...), ""
	}()
	cli.phoneLinkingCache.Store(&phoneLinkingCache{
		jid: mustJID(t, "15550001111@s.whatsapp.net"), keyPair: keyPair, linkingCode: code, pairingRef: "REF1",
	})
	notification := waBinary.Node{Tag: "notification", Content: []waBinary.Node{{
		Tag: "link_code_companion_reg",
		Content: []waBinary.Node{
			{Tag: "link_code_pairing_ref", Content: []byte("REF1")},
			{Tag: "link_code_pairing_wrapped_primary_ephemeral_pub", Content: wrappedPrimary},
			{Tag: "primary_identity_pub", Content: primaryIdentity.Pub[:]},
		},
	}}}
	values["code_pair_notification"] = marshalHex(t, notification)
	values["code_pair_finish"] = captureNode(t, logger, func() {
		_ = cli.handleCodePairNotification(context.Background(), &notification)
	})
	values["code_pair_adv_secret"] = hex.EncodeToString(cli.Store.AdvSecretKey)
	values["code_pair_identity_private"] = hex.EncodeToString(cli.Store.IdentityKey.Priv[:])
	values["code_pair_primary_identity"] = hex.EncodeToString(primaryIdentity.Pub[:])

	// Media retry receipts and notifications.
	mediaKey := fixedKeyPair(0x11).Pub[:]
	ciphertext, iv, err := encryptMediaRetryReceipt("MSGID1", mediaKey)
	if err != nil {
		t.Fatal(err)
	}
	values["media_key"] = hex.EncodeToString(mediaKey)
	values["media_retry_receipt_iv"] = hex.EncodeToString(iv)
	values["media_retry_receipt_ciphertext"] = hex.EncodeToString(ciphertext)
	retryNode := waBinary.Node{
		Tag:   "notification",
		Attrs: waBinary.Attrs{"id": "MSGID1", "t": "1700000000", "type": "mediaretry"},
		Content: []waBinary.Node{
			{Tag: "rmr", Attrs: waBinary.Attrs{"jid": mustJID(t, "120363000000000001@g.us"), "from_me": "false", "participant": mustJID(t, "777@lid")}},
			{Tag: "encrypt", Content: []waBinary.Node{
				{Tag: "enc_p", Content: ciphertext},
				{Tag: "enc_iv", Content: iv},
			}},
		},
	}
	values["media_retry_notification"] = marshalHex(t, retryNode)
	parsed, err := parseMediaRetryNotification(&retryNode)
	if err != nil {
		t.Fatal(err)
	}
	values["media_retry_chat"] = parsed.ChatID.String()
	values["media_retry_sender"] = parsed.SenderID.String()
	_, err = DecryptMediaRetryNotification(&events.MediaRetry{MessageID: "MSGID1", Error: &events.MediaRetryError{Code: 2}}, mediaKey)
	values["media_retry_error_2"] = err.Error()
	info := &types.MessageInfo{
		MessageSource: types.MessageSource{Chat: mustJID(t, "120363000000000001@g.us"), Sender: mustJID(t, "777@lid"), IsGroup: true},
		ID:            "MSGID1",
	}
	values["media_retry_send"] = captureNode(t, logger, func() {
		_ = cli.SendMediaRetryReceipt(context.Background(), info, mediaKey)
	})

	// Privacy settings.
	privacy := waBinary.Node{Tag: "privacy", Content: []waBinary.Node{
		{Tag: "category", Attrs: waBinary.Attrs{"name": "readreceipts", "value": "none"}},
		{Tag: "category", Attrs: waBinary.Attrs{"name": "last", "value": "contacts"}},
		{Tag: "category", Attrs: waBinary.Attrs{"name": "unknown", "value": "x"}},
	}}
	values["privacy_node"] = marshalHex(t, privacy)
	var settings types.PrivacySettings
	evt := cli.parsePrivacySettings(&privacy, &settings)
	values["privacy_read_receipts"] = string(settings.ReadReceipts)
	values["privacy_last_seen"] = string(settings.LastSeen)
	values["privacy_changed"] = []bool{evt.ReadReceiptsChanged, evt.LastSeenChanged, evt.GroupAddChanged}

	// Message secret keys.
	secret := fixedKeyPair(0x70).Pub[:]
	for _, useCase := range []MsgSecretType{EncSecretReaction, EncSecretPollVote, EncSecretMessageEdit} {
		key, additional := generateMsgSecretKey(useCase, mustJID(t, "9876:5@lid"), "ORIG1", mustJID(t, "777:2@lid"), secret)
		values["msg_secret_key_"+string(useCase)] = hex.EncodeToString(key)
		values["msg_secret_ad_"+string(useCase)] = hex.EncodeToString(additional)
	}
	values["msg_secret"] = hex.EncodeToString(secret)
	values["poll_option_hashes"] = hexList(HashPollOptions([]string{"yes", "no"}))

	writeVectors(t, "pairing_media.json", values)
}

func hexList(items [][]byte) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = hex.EncodeToString(item)
	}
	return out
}

// ctrEncryptForVector wraps a key the way the primary device does, playing
// the phone in the code pairing vector.
func ctrEncryptForVector(code string, salt, iv, data []byte) []byte {
	key := pbkdf2.Key([]byte(code), salt, 2<<16, 32, sha256.New)
	block, _ := aes.NewCipher(key)
	out := make([]byte, len(data))
	cipher.NewCTR(block, iv).XORKeyStream(out, data)
	return out
}
