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

func participantVector(participant types.GroupParticipant) map[string]any {
	var addRequest any
	if participant.AddRequest != nil {
		addRequest = map[string]any{
			"code":       participant.AddRequest.Code,
			"expiration": unixOrZero(participant.AddRequest.Expiration),
		}
	}
	return map[string]any{
		"jid":            jidString(participant.JID),
		"phone_number":   jidString(participant.PhoneNumber),
		"lid":            jidString(participant.LID),
		"is_admin":       participant.IsAdmin,
		"is_super_admin": participant.IsSuperAdmin,
		"display_name":   participant.DisplayName,
		"error":          participant.Error,
		"add_request":    addRequest,
	}
}

func groupInfoVector(group *types.GroupInfo) map[string]any {
	participants := make([]map[string]any, 0, len(group.Participants))
	for _, participant := range group.Participants {
		participants = append(participants, participantVector(participant))
	}
	return map[string]any{
		"jid":                              jidString(group.JID),
		"owner_jid":                        jidString(group.OwnerJID),
		"owner_pn":                         jidString(group.OwnerPN),
		"name":                             group.Name,
		"name_set_at":                      unixOrZero(group.NameSetAt),
		"name_set_by":                      jidString(group.NameSetBy),
		"name_set_by_pn":                   jidString(group.NameSetByPN),
		"topic":                            group.Topic,
		"topic_id":                         group.TopicID,
		"topic_set_at":                     unixOrZero(group.TopicSetAt),
		"topic_set_by":                     jidString(group.TopicSetBy),
		"topic_set_by_pn":                  jidString(group.TopicSetByPN),
		"topic_deleted":                    group.TopicDeleted,
		"is_locked":                        group.IsLocked,
		"is_announce":                      group.IsAnnounce,
		"announce_version_id":              group.AnnounceVersionID,
		"is_ephemeral":                     group.IsEphemeral,
		"disappearing_timer":               group.DisappearingTimer,
		"is_incognito":                     group.IsIncognito,
		"is_parent":                        group.IsParent,
		"default_membership_approval_mode": group.DefaultMembershipApprovalMode,
		"linked_parent_jid":                jidString(group.LinkedParentJID),
		"is_default_sub_group":             group.IsDefaultSubGroup,
		"is_join_approval_required":        group.IsJoinApprovalRequired,
		"addressing_mode":                  string(group.AddressingMode),
		"group_created":                    unixOrZero(group.GroupCreated),
		"creator_country_code":             group.CreatorCountryCode,
		"participant_version_id":           group.ParticipantVersionID,
		"participants":                     participants,
		"participant_count":                group.ParticipantCount,
		"member_add_mode":                  string(group.MemberAddMode),
		"suspended":                        group.Suspended,
	}
}

func linkChangeVector(change *types.GroupLinkChange) any {
	if change == nil {
		return nil
	}
	return map[string]any{
		"type":          string(change.Type),
		"unlink_reason": string(change.UnlinkReason),
		"group": map[string]any{
			"jid":                  jidString(change.Group.JID),
			"name":                 change.Group.Name,
			"name_set_at":          unixOrZero(change.Group.NameSetAt),
			"is_default_sub_group": change.Group.IsDefaultSubGroup,
		},
	}
}

func groupChangeVector(evt *events.GroupInfo) map[string]any {
	values := map[string]any{
		"jid":                         jidString(evt.JID),
		"notify":                      evt.Notify,
		"sender":                      optionalJIDString(evt.Sender),
		"sender_pn":                   optionalJIDString(evt.SenderPN),
		"timestamp":                   unixOrZero(evt.Timestamp),
		"name":                        nil,
		"topic":                       nil,
		"locked":                      nil,
		"announce":                    nil,
		"ephemeral":                   nil,
		"membership_approval_mode":    nil,
		"delete":                      nil,
		"link":                        linkChangeVector(evt.Link),
		"unlink":                      linkChangeVector(evt.Unlink),
		"new_invite_link":             nil,
		"prev_participant_version_id": evt.PrevParticipantVersionID,
		"participant_version_id":      evt.ParticipantVersionID,
		"join_reason":                 evt.JoinReason,
		"join":                        jidStrings(evt.Join),
		"leave":                       jidStrings(evt.Leave),
		"promote":                     jidStrings(evt.Promote),
		"demote":                      jidStrings(evt.Demote),
		"suspended":                   evt.Suspended,
		"unsuspended":                 evt.Unsuspended,
	}
	if evt.Name != nil {
		values["name"] = map[string]any{
			"name":           evt.Name.Name,
			"name_set_at":    unixOrZero(evt.Name.NameSetAt),
			"name_set_by":    jidString(evt.Name.NameSetBy),
			"name_set_by_pn": jidString(evt.Name.NameSetByPN),
		}
	}
	if evt.Topic != nil {
		values["topic"] = map[string]any{
			"topic":         evt.Topic.Topic,
			"topic_id":      evt.Topic.TopicID,
			"topic_set_at":  unixOrZero(evt.Topic.TopicSetAt),
			"topic_set_by":  jidString(evt.Topic.TopicSetBy),
			"topic_deleted": evt.Topic.TopicDeleted,
		}
	}
	if evt.Locked != nil {
		values["locked"] = evt.Locked.IsLocked
	}
	if evt.Announce != nil {
		values["announce"] = map[string]any{
			"is_announce":         evt.Announce.IsAnnounce,
			"announce_version_id": evt.Announce.AnnounceVersionID,
		}
	}
	if evt.Ephemeral != nil {
		values["ephemeral"] = map[string]any{
			"is_ephemeral":       evt.Ephemeral.IsEphemeral,
			"disappearing_timer": evt.Ephemeral.DisappearingTimer,
		}
	}
	if evt.MembershipApprovalMode != nil {
		values["membership_approval_mode"] = evt.MembershipApprovalMode.IsJoinApprovalRequired
	}
	if evt.Delete != nil {
		values["delete"] = map[string]any{
			"deleted":       evt.Delete.Deleted,
			"delete_reason": evt.Delete.DeleteReason,
		}
	}
	if evt.NewInviteLink != nil {
		values["new_invite_link"] = *evt.NewInviteLink
	}
	unknown := make([]string, 0, len(evt.UnknownChanges))
	for _, change := range evt.UnknownChanges {
		unknown = append(unknown, change.Tag)
	}
	values["unknown_changes"] = unknown
	return values
}

func TestGenerateGroups(t *testing.T) {
	values := vectors{}
	cli, logger := newCaptureClient(t)
	ctx := context.Background()
	group := mustJID(t, "120363001234567890@g.us")
	parent := mustJID(t, "120363009999999999@g.us")

	groupNode := waBinary.Node{
		Tag: "group",
		Attrs: waBinary.Attrs{
			"id":                   "120363001234567890",
			"creator":              mustJID(t, "1111@lid"),
			"creator_pn":           mustJID(t, "1111@s.whatsapp.net"),
			"subject":              "Team",
			"s_t":                  "1700000001",
			"s_o":                  mustJID(t, "2222@lid"),
			"s_o_pn":               mustJID(t, "2222@s.whatsapp.net"),
			"creation":             "1700000000",
			"creator_country_code": "US",
			"a_v_id":               "av1",
			"p_v_id":               "pv1",
			"size":                 "4",
			"addressing_mode":      "lid",
		},
		Content: []waBinary.Node{
			{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "1111@lid"), "type": "superadmin", "phone_number": mustJID(t, "1111@s.whatsapp.net")}},
			{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "2222@lid"), "type": "admin", "display_name": "+1∙∙∙∙∙∙∙∙22"}},
			{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "3333@s.whatsapp.net"), "lid": mustJID(t, "3333@lid")}},
			{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "4444@s.whatsapp.net"), "error": "403"}, Content: []waBinary.Node{
				{Tag: "add_request", Attrs: waBinary.Attrs{"code": "abc", "expiration": "1700100000"}},
			}},
			{Tag: "description", Attrs: waBinary.Attrs{"id": "topic1", "participant": mustJID(t, "2222@lid"), "participant_pn": mustJID(t, "2222@s.whatsapp.net"), "t": "1700000002"}, Content: []waBinary.Node{
				{Tag: "body", Content: []byte("Hello")},
			}},
			{Tag: "announcement"},
			{Tag: "locked"},
			{Tag: "ephemeral", Attrs: waBinary.Attrs{"expiration": "86400"}},
			{Tag: "member_add_mode", Content: []byte("admin_add")},
			{Tag: "linked_parent", Attrs: waBinary.Attrs{"jid": parent}},
			{Tag: "default_sub_group"},
			{Tag: "parent", Attrs: waBinary.Attrs{"default_membership_approval_mode": "request_required"}},
			{Tag: "incognito"},
			{Tag: "membership_approval_mode"},
			{Tag: "suspended"},
			{Tag: "mystery"},
		},
	}
	values["group_node"] = marshalHex(t, groupNode)
	parsed, err := cli.parseGroupNode(&groupNode)
	if err != nil {
		t.Fatal(err)
	}
	values["group_info"] = groupInfoVector(parsed)
	lidPairs, redactedPhones := cli.cacheGroupInfo(parsed, true)
	values["group_lid_pairs"] = lidPairStrings(lidPairs)
	redacted := make([][2]string, 0, len(redactedPhones))
	for _, entry := range redactedPhones {
		redacted = append(redacted, [2]string{entry.JID.String(), entry.RedactedPhone})
	}
	values["group_redacted_phones"] = redacted

	brokenGroup := waBinary.Node{Tag: "group", Attrs: waBinary.Attrs{"subject": "No ID"}}
	values["broken_group_node"] = marshalHex(t, brokenGroup)
	brokenInfo, err := cli.parseGroupNode(&brokenGroup)
	values["broken_group_info"] = groupInfoVector(brokenInfo)
	values["broken_group_error"] = err.Error()

	notificationAttrs := func(extra waBinary.Attrs) waBinary.Attrs {
		attrs := waBinary.Attrs{
			"from":           group,
			"type":           "w:gp2",
			"id":             "notif",
			"t":              "1700000100",
			"participant":    mustJID(t, "1111@lid"),
			"participant_pn": mustJID(t, "1111@s.whatsapp.net"),
			"notify":         "Owner",
		}
		for key, value := range extra {
			if value == nil {
				delete(attrs, key)
			} else {
				attrs[key] = value
			}
		}
		return attrs
	}
	notifications := []waBinary.Node{
		{Tag: "notification", Attrs: notificationAttrs(nil), Content: []waBinary.Node{
			{Tag: "add", Attrs: waBinary.Attrs{"reason": "invite", "prev_v_id": "1", "v_id": "2"}, Content: []waBinary.Node{
				{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "5555@lid"), "phone_number": mustJID(t, "5555@s.whatsapp.net")}},
				{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "6666@s.whatsapp.net"), "lid": mustJID(t, "6666@lid")}},
				{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "1111@lid")}},
			}},
		}},
		{Tag: "notification", Attrs: notificationAttrs(nil), Content: []waBinary.Node{
			{Tag: "remove", Attrs: waBinary.Attrs{"v_id": "3"}, Content: []waBinary.Node{
				{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "1111@lid")}},
			}},
			{Tag: "promote", Content: []waBinary.Node{
				{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "5555@lid")}},
				{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "2222@lid")}},
			}},
		}},
		{Tag: "notification", Attrs: notificationAttrs(nil), Content: []waBinary.Node{
			{Tag: "demote", Content: []waBinary.Node{
				{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "2222@lid"), "phone_number": mustJID(t, "2222@s.whatsapp.net")}},
			}},
			{Tag: "subject", Attrs: waBinary.Attrs{"subject": "Renamed", "s_t": "1700000101", "s_o": mustJID(t, "1111@lid"), "s_o_pn": mustJID(t, "1111@s.whatsapp.net")}},
			{Tag: "description", Attrs: waBinary.Attrs{"id": "topic2"}, Content: []waBinary.Node{{Tag: "body", Content: []byte("New topic")}}},
			{Tag: "announcement", Attrs: waBinary.Attrs{"v_id": "a2"}},
			{Tag: "invite", Attrs: waBinary.Attrs{"code": "XyZ"}},
			{Tag: "ephemeral", Attrs: waBinary.Attrs{"expiration": "604800"}},
			{Tag: "locked"},
			{Tag: "membership_approval_mode"},
			{Tag: "suspended"},
			{Tag: "mystery"},
		}},
		{Tag: "notification", Attrs: notificationAttrs(waBinary.Attrs{"participant_pn": nil}), Content: []waBinary.Node{
			{Tag: "not_announcement", Attrs: waBinary.Attrs{"v_id": "a3"}},
			{Tag: "not_ephemeral"},
			{Tag: "unlocked"},
			{Tag: "delete", Attrs: waBinary.Attrs{"reason": "admin"}},
			{Tag: "description", Attrs: waBinary.Attrs{"id": "topic3"}, Content: []waBinary.Node{{Tag: "delete"}}},
			{Tag: "unsuspended"},
			{Tag: "link", Attrs: waBinary.Attrs{"link_type": "parent_group"}, Content: []waBinary.Node{
				{Tag: "group", Attrs: waBinary.Attrs{"jid": parent, "subject": "Community", "s_t": "1700000003"}, Content: []waBinary.Node{{Tag: "default_sub_group"}}},
			}},
			{Tag: "unlink", Attrs: waBinary.Attrs{"unlink_type": "sub_group", "unlink_reason": "delete_parent"}, Content: []waBinary.Node{
				{Tag: "group", Attrs: waBinary.Attrs{"id": "120363008888888888"}},
			}},
		}},
	}
	changes := make([]map[string]any, 0, len(notifications))
	for _, notification := range notifications {
		evt, lidPairs, redactedPhones, err := cli.parseGroupNotification(&notification)
		if err != nil {
			t.Fatal(err)
		}
		if len(redactedPhones) != 0 {
			t.Fatal("unexpected redacted phones in a group change")
		}
		changes = append(changes, map[string]any{
			"node":      marshalHex(t, notification),
			"event":     groupChangeVector(evt.(*events.GroupInfo)),
			"lid_pairs": lidPairStrings(lidPairs),
		})
	}
	values["group_changes"] = changes
	cached := cli.groupCache[group]
	values["cached_after_changes"] = map[string]any{
		"addressing_mode":              string(cached.AddressingMode),
		"community_announcement_group": cached.CommunityAnnouncementGroup,
		"read_only":                    cached.ReadOnly,
		"members":                      jidStrings(cached.Members),
		"admins":                       jidStrings(cached.Admins),
	}

	createNode := waBinary.Node{
		Tag:   "notification",
		Attrs: notificationAttrs(waBinary.Attrs{"from": mustJID(t, "120363007777777777@g.us"), "addressing_mode": "lid"}),
		Content: []waBinary.Node{{
			Tag:   "create",
			Attrs: waBinary.Attrs{"reason": "invite", "key": "ck1", "type": "new"},
			Content: []waBinary.Node{{
				Tag:   "group",
				Attrs: waBinary.Attrs{"id": "120363007777777777", "subject": "Fresh", "creation": "1700000050"},
				Content: []waBinary.Node{
					{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "1111@lid"), "type": "superadmin", "phone_number": mustJID(t, "1111@s.whatsapp.net"), "display_name": "+1∙∙11"}},
					{Tag: "participant", Attrs: waBinary.Attrs{"jid": mustJID(t, "9876@lid")}},
				},
			}},
		}},
	}
	values["create_node"] = marshalHex(t, createNode)
	evt, lidPairs, redactedPhones, err := cli.parseGroupNotification(&createNode)
	if err != nil {
		t.Fatal(err)
	}
	joined := evt.(*events.JoinedGroup)
	values["joined_group"] = map[string]any{
		"reason":     joined.Reason,
		"type":       joined.Type,
		"create_key": joined.CreateKey,
		"sender":     optionalJIDString(joined.Sender),
		"sender_pn":  optionalJIDString(joined.SenderPN),
		"notify":     joined.Notify,
		"group_info": groupInfoVector(&joined.GroupInfo),
	}
	values["joined_lid_pairs"] = lidPairStrings(lidPairs)
	redacted = make([][2]string, 0, len(redactedPhones))
	for _, entry := range redactedPhones {
		redacted = append(redacted, [2]string{entry.JID.String(), entry.RedactedPhone})
	}
	values["joined_redacted_phones"] = redacted

	failures := []waBinary.Node{
		{Tag: "notification", Attrs: waBinary.Attrs{"from": group}},
		{Tag: "notification", Attrs: notificationAttrs(nil), Content: []waBinary.Node{{Tag: "subject", Attrs: waBinary.Attrs{"s_t": "1"}}}},
		{Tag: "notification", Attrs: notificationAttrs(nil), Content: []waBinary.Node{{Tag: "link", Attrs: waBinary.Attrs{"link_type": "sub_group"}}}},
		{Tag: "notification", Attrs: notificationAttrs(nil), Content: []waBinary.Node{{Tag: "create"}}},
	}
	failureVectors := make([]map[string]any, 0, len(failures))
	for _, failure := range failures {
		_, _, _, err := cli.parseGroupNotification(&failure)
		if err == nil {
			t.Fatal("expected an error")
		}
		failureVectors = append(failureVectors, map[string]any{
			"node":  marshalHex(t, failure),
			"error": err.Error(),
		})
	}
	values["group_change_failures"] = failureVectors

	inviter := mustJID(t, "1111@s.whatsapp.net")
	requests := map[string]string{}
	requests["get_joined_groups"] = captureNode(t, logger, func() { _, _ = cli.GetJoinedGroups(ctx) })
	requests["get_group_info"] = captureNode(t, logger, func() { _, _ = cli.GetGroupInfo(ctx, group) })
	requests["create_group"] = captureNode(t, logger, func() {
		req := ReqCreateGroup{
			Name:          "Team",
			Participants:  []types.JID{mustJID(t, "3333@s.whatsapp.net"), mustJID(t, "5555:2@lid")},
			MemberAddMode: types.GroupMemberAddModeAdmin,
		}
		req.IsLocked = true
		req.IsAnnounce = true
		req.IsEphemeral = true
		req.DisappearingTimer = 604800
		req.IsJoinApprovalRequired = true
		req.LinkedParentJID = parent
		_, _ = cli.CreateGroup(ctx, req)
	})
	requests["create_community"] = captureNode(t, logger, func() {
		req := ReqCreateGroup{Name: "Community"}
		req.IsParent = true
		_, _ = cli.CreateGroup(ctx, req)
	})
	requests["leave_group"] = captureNode(t, logger, func() { _ = cli.LeaveGroup(ctx, group) })
	requests["add_participants"] = captureNode(t, logger, func() {
		_, _ = cli.UpdateGroupParticipants(ctx, group, []types.JID{mustJID(t, "5555@lid"), mustJID(t, "3333@s.whatsapp.net")}, ParticipantChangeAdd)
	})
	requests["demote_participants"] = captureNode(t, logger, func() {
		_, _ = cli.UpdateGroupParticipants(ctx, group, []types.JID{mustJID(t, "5555@lid")}, ParticipantChangeDemote)
	})
	requests["get_request_participants"] = captureNode(t, logger, func() { _, _ = cli.GetGroupRequestParticipants(ctx, group) })
	requests["approve_request_participants"] = captureNode(t, logger, func() {
		_, _ = cli.UpdateGroupRequestParticipants(ctx, group, []types.JID{mustJID(t, "5555@lid")}, ParticipantChangeApprove)
	})
	requests["set_group_photo"] = captureNode(t, logger, func() { _, _ = cli.SetGroupPhoto(ctx, group, []byte{0xff, 0xd8}) })
	requests["remove_group_photo"] = captureNode(t, logger, func() { _, _ = cli.SetGroupPhoto(ctx, group, nil) })
	requests["set_group_name"] = captureNode(t, logger, func() { _ = cli.SetGroupName(ctx, group, "New name") })
	requests["set_group_topic"] = captureNode(t, logger, func() { _ = cli.SetGroupTopic(ctx, group, "prev1", "new1", "Topic") })
	requests["delete_group_topic"] = captureNode(t, logger, func() { _ = cli.SetGroupTopic(ctx, group, "prev1", "new2", "") })
	requests["set_group_locked"] = captureNode(t, logger, func() { _ = cli.SetGroupLocked(ctx, group, true) })
	requests["set_group_unlocked"] = captureNode(t, logger, func() { _ = cli.SetGroupLocked(ctx, group, false) })
	requests["set_group_announce"] = captureNode(t, logger, func() { _ = cli.SetGroupAnnounce(ctx, group, true) })
	requests["set_group_not_announce"] = captureNode(t, logger, func() { _ = cli.SetGroupAnnounce(ctx, group, false) })
	requests["reset_invite_link"] = captureNode(t, logger, func() { _, _ = cli.GetGroupInviteLink(ctx, group, true) })
	requests["get_invite_link"] = captureNode(t, logger, func() { _, _ = cli.GetGroupInviteLink(ctx, group, false) })
	requests["info_from_invite"] = captureNode(t, logger, func() { _, _ = cli.GetGroupInfoFromInvite(ctx, group, inviter, "code1", 1700000000) })
	requests["join_with_invite"] = captureNode(t, logger, func() { _ = cli.JoinGroupWithInvite(ctx, group, inviter, "code1", 1700000000) })
	requests["info_from_link"] = captureNode(t, logger, func() { _, _ = cli.GetGroupInfoFromLink(ctx, "https://chat.whatsapp.com/AbC?x=1") })
	requests["join_with_link"] = captureNode(t, logger, func() { _, _ = cli.JoinGroupWithLink(ctx, "AbC") })
	requests["join_approval_mode"] = captureNode(t, logger, func() { _ = cli.SetGroupJoinApprovalMode(ctx, group, true) })
	requests["member_add_mode"] = captureNode(t, logger, func() { _ = cli.SetGroupMemberAddMode(ctx, group, types.GroupMemberAddModeAdmin) })
	values["requests"] = requests

	writeVectors(t, "group.json", values)
}
