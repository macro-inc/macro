// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//go:build rustport

package whatsmeow

import (
	"encoding/hex"
	"testing"

	"google.golang.org/protobuf/proto"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

func vectorClient(t *testing.T) *Client {
	own := mustJID(t, "1234:5@s.whatsapp.net")
	return &Client{Store: &store.Device{ID: &own, LID: mustJID(t, "9876:5@lid")}}
}

type sourceVector struct {
	Node   string `json:"node"`
	Chat   string `json:"chat"`
	Sender string `json:"sender"`
	FromMe bool   `json:"from_me"`
	Group  bool   `json:"group"`
	Mode   string `json:"addressing_mode"`
	Alt    string `json:"sender_alt"`
	RecAlt string `json:"recipient_alt"`
	ID     string `json:"id"`
	TS     int64  `json:"t"`
	Push   string `json:"push_name"`
	Type   string `json:"type"`
	Edit   string `json:"edit"`
	Media  string `json:"media_type"`
}

func TestGenerateMessage(t *testing.T) {
	cli := vectorClient(t)
	nodes := []waBinary.Node{
		{Tag: "message", Attrs: waBinary.Attrs{
			"from": mustJID(t, "5550001@s.whatsapp.net"), "id": "A1", "t": "1700000000",
			"type": "text", "notify": "Peer", "sender_lid": mustJID(t, "777@lid"),
		}},
		{Tag: "message", Attrs: waBinary.Attrs{
			"from": mustJID(t, "120363000000000001@g.us"), "participant": mustJID(t, "777:3@lid"),
			"participant_pn": mustJID(t, "5550001@s.whatsapp.net"), "addressing_mode": "lid",
			"id": "A2", "t": "1700000001", "type": "media", "edit": "1",
		}, Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"mediatype": "image"}}}},
		{Tag: "message", Attrs: waBinary.Attrs{
			"from": mustJID(t, "1234:7@s.whatsapp.net"), "recipient": mustJID(t, "5550001@s.whatsapp.net"),
			"peer_recipient_lid": mustJID(t, "777@lid"), "id": "A3", "t": "1700000002", "type": "text",
		}},
		{Tag: "message", Attrs: waBinary.Attrs{
			"from": mustJID(t, "9876:2@lid"), "id": "A4", "t": "1700000003", "type": "text",
			"peer_recipient_pn": mustJID(t, "5550001@s.whatsapp.net"),
		}},
	}
	var sources []sourceVector
	for _, node := range nodes {
		info, err := cli.parseMessageInfo(&node)
		if err != nil {
			t.Fatal(err)
		}
		sources = append(sources, sourceVector{
			Node: marshalHex(t, node), Chat: info.Chat.String(), Sender: info.Sender.String(),
			FromMe: info.IsFromMe, Group: info.IsGroup, Mode: string(info.AddressingMode),
			Alt: info.SenderAlt.String(), RecAlt: info.RecipientAlt.String(), ID: info.ID,
			TS: info.Timestamp.Unix(), Push: info.PushName, Type: info.Type, Edit: string(info.Edit),
			Media: info.MediaType,
		})
	}

	type typeVector struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Media   string `json:"media_type"`
		Edit    string `json:"edit"`
		Plain   string `json:"plaintext"`
		DSM     string `json:"device_sent_plaintext"`
	}
	messages := []*waE2E.Message{
		{Conversation: proto.String("hi")},
		{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("pic")}},
		{AudioMessage: &waE2E.AudioMessage{PTT: proto.Bool(true)}},
		{VideoMessage: &waE2E.VideoMessage{GifPlayback: proto.Bool(true)}},
		{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("x"), Title: proto.String("t")}},
		{EphemeralMessage: &waE2E.FutureProofMessage{Message: &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{}}}},
		{ReactionMessage: &waE2E.ReactionMessage{Text: proto.String("")}},
		{PollUpdateMessage: &waE2E.PollUpdateMessage{}},
		cli.BuildRevoke(mustJID(t, "120363000000000001@g.us"), mustJID(t, "5550001@s.whatsapp.net"), "OLD"),
		cli.BuildRevoke(mustJID(t, "5550001@s.whatsapp.net"), types.EmptyJID, "OLD"),
		cli.BuildEdit(mustJID(t, "5550001@s.whatsapp.net"), "OLD", &waE2E.Message{Conversation: proto.String("new")}),
	}
	to := mustJID(t, "777@lid")
	var types_ []typeVector
	for _, msg := range messages {
		// BuildEdit stamps the current time; zero it for a stable vector.
		if msg.EditedMessage != nil {
			msg.EditedMessage.Message.ProtocolMessage.TimestampMS = proto.Int64(1700000000000)
		}
		raw, err := proto.Marshal(msg)
		if err != nil {
			t.Fatal(err)
		}
		plain, dsm, err := marshalMessage(to, msg)
		if err != nil {
			t.Fatal(err)
		}
		types_ = append(types_, typeVector{
			Message: hex.EncodeToString(raw), Type: getTypeFromMessage(msg),
			Media: getMediaTypeFromMessage(msg), Edit: string(getEditAttribute(msg)),
			Plain: hex.EncodeToString(plain), DSM: hex.EncodeToString(dsm),
		})
	}

	var hashes []map[string]any
	for _, list := range [][]string{
		{"5550001@s.whatsapp.net", "5550001:3@s.whatsapp.net"},
		{"777:1@lid", "777@lid", "1234:5@s.whatsapp.net"},
		{},
	} {
		var jids []types.JID
		for _, j := range list {
			jids = append(jids, mustJID(t, j))
		}
		hashes = append(hashes, map[string]any{"jids": list, "hash": participantListHashV2(jids)})
	}

	unpadded, err := unpadMessage([]byte("abc\x03\x03\x03"), 2)
	if err != nil {
		t.Fatal(err)
	}
	writeVectors(t, "message.json", vectors{
		"sources":         sources,
		"types":           types_,
		"hashes":          hashes,
		"unpadded":        hex.EncodeToString(unpadded),
		"unavailable_req": marshalProtoHex(t, cli.BuildUnavailableMessageRequest(mustJID(t, "120363000000000001@g.us"), mustJID(t, "777@lid"), "LOST")),
	})
}

func marshalProtoHex(t *testing.T, msg proto.Message) string {
	data, err := proto.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(data)
}
