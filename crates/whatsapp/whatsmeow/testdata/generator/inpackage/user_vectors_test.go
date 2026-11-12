// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//go:build rustport

package whatsmeow

import (
	"context"
	"testing"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func TestGenerateUsers(t *testing.T) {
	values := vectors{}
	cli, logger := newCaptureClient(t)
	ctx := context.Background()

	pnUser := mustJID(t, "5555@s.whatsapp.net")
	lidUser := mustJID(t, "6666@lid")
	deviceList := func(devices ...waBinary.Node) waBinary.Node {
		return waBinary.Node{Tag: "devices", Content: []waBinary.Node{{
			Tag:     "device-list",
			Content: devices,
		}}}
	}
	device := func(attrs waBinary.Attrs) waBinary.Node {
		return waBinary.Node{Tag: "device", Attrs: attrs}
	}
	cases := []struct {
		user types.JID
		node waBinary.Node
	}{
		{pnUser, deviceList(
			device(waBinary.Attrs{"id": "0"}),
			device(waBinary.Attrs{"id": "3", "key-index": "2"}),
			device(waBinary.Attrs{"id": "99", "is_hosted": "true"}),
			waBinary.Node{Tag: "key-index-list", Attrs: waBinary.Attrs{"id": "7"}},
			device(waBinary.Attrs{"key-index": "1"}),
			device(waBinary.Attrs{"id": "70000"}),
		)},
		{lidUser, deviceList(
			device(waBinary.Attrs{"id": "0"}),
			device(waBinary.Attrs{"id": "12", "is_hosted": "true"}),
		)},
		{pnUser, waBinary.Node{Tag: "devices"}},
		{pnUser, waBinary.Node{Tag: "not-devices", Content: []waBinary.Node{{Tag: "device-list", Content: []waBinary.Node{device(waBinary.Attrs{"id": "1"})}}}}},
	}
	deviceLists := make([]map[string]any, 0, len(cases))
	for _, deviceCase := range cases {
		devices := parseDeviceList(deviceCase.user, deviceCase.node)
		deviceLists = append(deviceLists, map[string]any{
			"user":    deviceCase.user.String(),
			"node":    marshalHex(t, deviceCase.node),
			"devices": jidStrings(devices),
			"hash":    participantListHashV2(devices),
		})
	}
	values["device_lists"] = deviceLists

	blocklistNode := waBinary.Node{
		Tag:   "list",
		Attrs: waBinary.Attrs{"dhash": "1700000000", "addressing_mode": "lid"},
		Content: []waBinary.Node{
			{Tag: "item", Attrs: waBinary.Attrs{"jid": lidUser, "pn_jid": pnUser, "active": "true"}},
			{Tag: "item", Attrs: waBinary.Attrs{"jid": mustJID(t, "7777@lid")}},
			{Tag: "item", Attrs: waBinary.Attrs{"action": "block"}},
		},
	}
	values["blocklist_node"] = marshalHex(t, blocklistNode)
	blocklist, mappings := cli.parseBlocklist(&blocklistNode)
	items := make([]map[string]any, 0, len(blocklist.Items))
	for _, item := range blocklist.Items {
		items = append(items, map[string]any{
			"lid":    item.LID.String(),
			"pn":     item.PN.String(),
			"active": item.Active,
		})
	}
	values["blocklist"] = map[string]any{
		"d_hash":          blocklist.DHash,
		"addressing_mode": string(blocklist.AddressingMode),
		"items":           items,
	}
	values["blocklist_lid_pairs"] = lidPairStrings(mappings)

	requests := map[string]string{}
	requests["get_user_devices"] = captureNode(t, logger, func() {
		_, _ = cli.GetUserDevices(ctx, []types.JID{pnUser, mustJID(t, "6666:3@lid")})
	})
	requests["is_on_whatsapp"] = captureNode(t, logger, func() { _, _ = cli.IsOnWhatsApp(ctx, []string{"+15551234567"}) })
	requests["get_user_info"] = captureNode(t, logger, func() { _, _ = cli.GetUserInfo(ctx, []types.JID{pnUser, lidUser}) })
	requests["profile_picture_preview"] = captureNode(t, logger, func() {
		_, _ = cli.GetProfilePictureInfo(ctx, pnUser, &GetProfilePictureParams{Preview: true, ExistingID: "old"})
	})
	requests["profile_picture_full"] = captureNode(t, logger, func() {
		_, _ = cli.GetProfilePictureInfo(ctx, pnUser, &GetProfilePictureParams{
			CommonGID:  mustJID(t, "120363001234567890@g.us"),
			InviteCode: "inv",
			PersonaID:  "persona",
		})
	})
	requests["profile_picture_community"] = captureNode(t, logger, func() {
		_, _ = cli.GetProfilePictureInfo(ctx, mustJID(t, "120363009999999999@g.us"), &GetProfilePictureParams{IsCommunity: true})
	})
	requests["get_blocklist"] = captureNode(t, logger, func() { _, _ = cli.GetBlocklist(ctx, "") })
	requests["get_blocklist_with_hash"] = captureNode(t, logger, func() { _, _ = cli.GetBlocklist(ctx, "hash1") })
	requests["block_lid"] = captureNode(t, logger, func() {
		_, _ = cli.UpdateBlocklist(ctx, lidUser, events.BlocklistChangeActionBlock, "hash1")
	})
	requests["unblock_lid"] = captureNode(t, logger, func() {
		_, _ = cli.UpdateBlocklist(ctx, lidUser, events.BlocklistChangeActionUnblock, "")
	})
	values["requests"] = requests

	writeVectors(t, "user.json", values)
}
