// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//go:build rustport

package whatsmeow

import (
	"encoding/binary"
	"encoding/hex"
	"testing"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/util/keys"
)

func TestGeneratePreKeys(t *testing.T) {
	values := vectors{}
	preKey := &keys.PreKey{KeyPair: *fixedKeyPair(0x30), KeyID: 0x010203}
	values["pre_key_node"] = marshalHex(t, preKeyToNode(preKey))
	var signature [64]byte
	for i := range signature {
		signature[i] = 0x77
	}
	signedPreKey := &keys.PreKey{KeyPair: *fixedKeyPair(0x50), KeyID: 1, Signature: &signature}
	values["signed_pre_key_node"] = marshalHex(t, preKeyToNode(signedPreKey))

	var registration [4]byte
	binary.BigEndian.PutUint32(registration[:], 0x0a0b0c0d)
	identity := fixedKeyPair(0x10).Pub[:]
	oneTime := &keys.PreKey{KeyPair: *fixedKeyPair(0x60), KeyID: 42}
	user := waBinary.Node{
		Tag:   "user",
		Attrs: waBinary.Attrs{"jid": mustJID(t, "1234:7@s.whatsapp.net")},
		Content: []waBinary.Node{
			{Tag: "registration", Content: registration[:]},
			{Tag: "type", Content: []byte{5}},
			{Tag: "identity", Content: identity},
			preKeyToNode(oneTime),
			preKeyToNode(signedPreKey),
		},
	}
	values["bundle_user_node"] = marshalHex(t, user)
	bundle, err := nodeToPreKeyBundle(7, user)
	if err != nil {
		t.Fatal(err)
	}
	values["bundle_registration_id"] = bundle.RegistrationID()
	values["bundle_pre_key_id"] = bundle.PreKeyID().Value
	preKeyPublic := bundle.PreKey().PublicKey()
	values["bundle_pre_key_public"] = hex.EncodeToString(preKeyPublic[:])
	values["bundle_signed_pre_key_id"] = bundle.SignedPreKeyID()
	signedPublic := bundle.SignedPreKey().PublicKey()
	values["bundle_signed_pre_key_public"] = hex.EncodeToString(signedPublic[:])
	bundleSignature := bundle.SignedPreKeySignature()
	values["bundle_signed_pre_key_signature"] = hex.EncodeToString(bundleSignature[:])
	identityPublic := bundle.IdentityKey().PublicKey().PublicKey()
	values["bundle_identity_key"] = hex.EncodeToString(identityPublic[:])

	withoutPreKey := waBinary.Node{
		Tag:   "user",
		Attrs: user.Attrs,
		Content: []waBinary.Node{
			{Tag: "registration", Content: registration[:]},
			{Tag: "keys", Content: []waBinary.Node{
				{Tag: "identity", Content: identity},
				preKeyToNode(signedPreKey),
			}},
		},
	}
	values["bundle_without_pre_key_node"] = marshalHex(t, withoutPreKey)
	if bundle, err = nodeToPreKeyBundle(7, withoutPreKey); err != nil || bundle.PreKeyID() != nil && !bundle.PreKeyID().IsEmpty {
		t.Fatalf("expected a bundle without prekey: %v", err)
	}

	errorNode := waBinary.Node{
		Tag:   "user",
		Attrs: user.Attrs,
		Content: []waBinary.Node{
			{Tag: "error", Attrs: waBinary.Attrs{"code": "404", "text": "item-not-found"}},
		},
	}
	values["bundle_error_node"] = marshalHex(t, errorNode)
	_, err = nodeToPreKeyBundle(7, errorNode)
	values["bundle_error_message"] = err.Error()
	writeVectors(t, "prekeys.json", values)
}
