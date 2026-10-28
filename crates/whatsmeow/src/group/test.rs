// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Group parsing and requests against whatsmeow's own output
//! (`testdata/group.json`, see `testdata/generator`), and the group calls
//! and `w:gp2` notifications against the fake server.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::*;
use crate::binary::AttributeValue;
use crate::client::test::{
    capture_request, children, connect_paired, harness, jid, next_event, next_node, node, text,
};
use crate::store::{ContactStore, LidStore};
use crate::testing::{attr_string, is_iq};
use crate::types::events::Event;
use crate::types::parse_jid;
use crate::vectors::Vectors;

const OWN: (&str, &str) = ("1234:5@s.whatsapp.net", "9876:5@lid");

fn unix(time: Option<DateTime<Utc>>) -> i64 {
    time.map_or(0, |time| time.timestamp())
}

fn jid_strings(jids: &[Jid]) -> Vec<String> {
    jids.iter().map(ToString::to_string).collect()
}

fn lid_pair_strings(pairs: &[LidMapping]) -> Value {
    json!(
        pairs
            .iter()
            .map(|pair| [pair.lid.to_string(), pair.pn.to_string()])
            .collect::<Vec<_>>()
    )
}

fn redacted_strings(entries: &[RedactedPhoneEntry]) -> Value {
    json!(
        entries
            .iter()
            .map(|entry| [entry.jid.to_string(), entry.redacted_phone.clone()])
            .collect::<Vec<_>>()
    )
}

fn participant_vector(participant: &GroupParticipant) -> Value {
    json!({
        "jid": participant.jid.to_string(),
        "phone_number": participant.phone_number.to_string(),
        "lid": participant.lid.to_string(),
        "is_admin": participant.is_admin,
        "is_super_admin": participant.is_super_admin,
        "display_name": participant.display_name,
        "error": participant.error,
        "add_request": participant.add_request.as_ref().map(|request| json!({
            "code": request.code,
            "expiration": unix(request.expiration),
        })),
    })
}

fn group_info_vector(group: &GroupInfo) -> Value {
    json!({
        "jid": group.jid.to_string(),
        "owner_jid": group.owner_jid.to_string(),
        "owner_pn": group.owner_pn.to_string(),
        "name": group.name.name,
        "name_set_at": unix(group.name.name_set_at),
        "name_set_by": group.name.name_set_by.to_string(),
        "name_set_by_pn": group.name.name_set_by_pn.to_string(),
        "topic": group.topic.topic,
        "topic_id": group.topic.topic_id,
        "topic_set_at": unix(group.topic.topic_set_at),
        "topic_set_by": group.topic.topic_set_by.to_string(),
        "topic_set_by_pn": group.topic.topic_set_by_pn.to_string(),
        "topic_deleted": group.topic.topic_deleted,
        "is_locked": group.locked.is_locked,
        "is_announce": group.announce.is_announce,
        "announce_version_id": group.announce.announce_version_id,
        "is_ephemeral": group.ephemeral.is_ephemeral,
        "disappearing_timer": group.ephemeral.disappearing_timer,
        "is_incognito": group.incognito.is_incognito,
        "is_parent": group.parent.is_parent,
        "default_membership_approval_mode": group.parent.default_membership_approval_mode,
        "linked_parent_jid": group.linked_parent.linked_parent_jid.to_string(),
        "is_default_sub_group": group.is_default_sub.is_default_sub_group,
        "is_join_approval_required": group.membership_approval_mode.is_join_approval_required,
        "addressing_mode": group.addressing_mode.as_str(),
        "group_created": unix(group.group_created),
        "creator_country_code": group.creator_country_code,
        "participant_version_id": group.participant_version_id,
        "participants": group.participants.iter().map(participant_vector).collect::<Vec<_>>(),
        "participant_count": group.participant_count,
        "member_add_mode": group.member_add_mode.as_str(),
        "suspended": group.suspended,
    })
}

fn link_change_vector(change: Option<&GroupLinkChange>) -> Value {
    match change {
        None => Value::Null,
        Some(change) => json!({
            "type": change.r#type.as_str(),
            "unlink_reason": change.unlink_reason.as_str(),
            "group": {
                "jid": change.group.jid.to_string(),
                "name": change.group.name.name,
                "name_set_at": unix(change.group.name.name_set_at),
                "is_default_sub_group": change.group.is_default_sub.is_default_sub_group,
            },
        }),
    }
}

fn group_change_vector(event: &GroupInfoEvent) -> Value {
    json!({
        "jid": event.jid.to_string(),
        "notify": event.notify,
        "sender": event.sender.as_ref().map(ToString::to_string),
        "sender_pn": event.sender_pn.as_ref().map(ToString::to_string),
        "timestamp": unix(event.timestamp),
        "name": event.name.as_ref().map(|name| json!({
            "name": name.name,
            "name_set_at": unix(name.name_set_at),
            "name_set_by": name.name_set_by.to_string(),
            "name_set_by_pn": name.name_set_by_pn.to_string(),
        })),
        "topic": event.topic.as_ref().map(|topic| json!({
            "topic": topic.topic,
            "topic_id": topic.topic_id,
            "topic_set_at": unix(topic.topic_set_at),
            "topic_set_by": topic.topic_set_by.to_string(),
            "topic_deleted": topic.topic_deleted,
        })),
        "locked": event.locked.as_ref().map(|locked| locked.is_locked),
        "announce": event.announce.as_ref().map(|announce| json!({
            "is_announce": announce.is_announce,
            "announce_version_id": announce.announce_version_id,
        })),
        "ephemeral": event.ephemeral.as_ref().map(|ephemeral| json!({
            "is_ephemeral": ephemeral.is_ephemeral,
            "disappearing_timer": ephemeral.disappearing_timer,
        })),
        "membership_approval_mode": event
            .membership_approval_mode
            .as_ref()
            .map(|mode| mode.is_join_approval_required),
        "delete": event.delete.as_ref().map(|delete| json!({
            "deleted": delete.deleted,
            "delete_reason": delete.delete_reason,
        })),
        "link": link_change_vector(event.link.as_ref()),
        "unlink": link_change_vector(event.unlink.as_ref()),
        "new_invite_link": event.new_invite_link,
        "prev_participant_version_id": event.prev_participant_version_id,
        "participant_version_id": event.participant_version_id,
        "join_reason": event.join_reason,
        "join": jid_strings(&event.join),
        "leave": jid_strings(&event.leave),
        "promote": jid_strings(&event.promote),
        "demote": jid_strings(&event.demote),
        "suspended": event.suspended,
        "unsuspended": event.unsuspended,
        "unknown_changes": event.unknown_changes.iter().map(|change| change.tag.clone()).collect::<Vec<_>>(),
    })
}

fn group_jid() -> Jid {
    parse_jid("120363001234567890@g.us").unwrap()
}

#[tokio::test]
async fn group_nodes_and_notifications_parse_like_go() {
    let vectors = Vectors::load("group.json");
    let harness = harness(Some(OWN));
    let client = &harness.client;

    let (parsed, result) = parse_group_node(&vectors.node("group_node"));
    result.unwrap();
    assert_eq!(group_info_vector(&parsed), *vectors.value("group_info"));
    let (lid_pairs, redacted_phones) = client.cache_group_info(&parsed, None).await;
    assert_eq!(
        lid_pair_strings(&lid_pairs),
        *vectors.value("group_lid_pairs")
    );
    assert_eq!(
        redacted_strings(&redacted_phones),
        *vectors.value("group_redacted_phones")
    );

    let (broken, result) = parse_group_node(&vectors.node("broken_group_node"));
    assert_eq!(
        group_info_vector(&broken),
        *vectors.value("broken_group_info")
    );
    assert_eq!(
        result.unwrap_err().to_string(),
        vectors.string("broken_group_error")
    );

    let Value::Array(changes) = vectors.value("group_changes") else {
        panic!("group_changes is a list");
    };
    for change in changes {
        let notification = node_from_hex(&change["node"]);
        let (event, lid_pairs, redacted_phones) = client
            .parse_group_notification(&notification)
            .await
            .unwrap();
        let GroupNotification::Change(event) = event else {
            panic!("expected a group change");
        };
        assert_eq!(group_change_vector(&event), change["event"]);
        assert_eq!(lid_pair_strings(&lid_pairs), change["lid_pairs"]);
        assert!(redacted_phones.is_empty());
    }
    let cached = client
        .group_cache
        .lock()
        .await
        .get(&group_jid())
        .cloned()
        .unwrap();
    assert_eq!(
        json!({
            "addressing_mode": cached.addressing_mode.as_str(),
            "community_announcement_group": cached.community_announcement_group,
            "read_only": cached.read_only,
            "members": jid_strings(&cached.members),
            "admins": jid_strings(&cached.admins),
        }),
        *vectors.value("cached_after_changes")
    );

    let (event, lid_pairs, redacted_phones) = client
        .parse_group_notification(&vectors.node("create_node"))
        .await
        .unwrap();
    let GroupNotification::Joined(joined) = event else {
        panic!("expected a joined group");
    };
    assert_eq!(
        json!({
            "reason": joined.reason,
            "type": joined.r#type,
            "create_key": joined.create_key,
            "sender": joined.sender.as_ref().map(ToString::to_string),
            "sender_pn": joined.sender_pn.as_ref().map(ToString::to_string),
            "notify": joined.notify,
            "group_info": group_info_vector(&joined.group_info),
        }),
        *vectors.value("joined_group")
    );
    assert_eq!(
        lid_pair_strings(&lid_pairs),
        *vectors.value("joined_lid_pairs")
    );
    assert_eq!(
        redacted_strings(&redacted_phones),
        *vectors.value("joined_redacted_phones")
    );

    let Value::Array(failures) = vectors.value("group_change_failures") else {
        panic!("group_change_failures is a list");
    };
    for failure in failures {
        let error = client
            .parse_group_notification(&node_from_hex(&failure["node"]))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), failure["error"]);
    }
}

fn node_from_hex(value: &Value) -> Node {
    let data = hex::decode(value.as_str().unwrap()).unwrap();
    crate::binary::unmarshal(&crate::binary::unpack(&data).unwrap()).unwrap()
}

#[tokio::test(start_paused = true)]
async fn group_requests_match_go() {
    let vectors = Vectors::load("group.json");
    let requests = vectors.value("requests");
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    // Leaked so the spawned calls can borrow them.
    let group: &'static Jid = Box::leak(Box::new(group_jid()));
    let parent: &'static Jid = Box::leak(Box::new(parse_jid("120363009999999999@g.us").unwrap()));
    let inviter: &'static Jid = Box::leak(Box::new(parse_jid("1111@s.whatsapp.net").unwrap()));
    let lid: &'static Jid = Box::leak(Box::new(parse_jid("5555@lid").unwrap()));
    let pn: &'static Jid = Box::leak(Box::new(parse_jid("3333@s.whatsapp.net").unwrap()));

    macro_rules! check {
        ($key:literal, |$client:ident| $call:expr) => {{
            let $client = Arc::clone(&harness.client);
            let request = capture_request(&mut connection, async move {
                let _ = $call;
            })
            .await;
            assert_eq!(request, node_from_hex(&requests[$key]), $key);
        }};
    }

    check!("get_joined_groups", |client| client
        .get_joined_groups()
        .await);
    check!("get_group_info", |client| client
        .get_group_info(group)
        .await);
    check!("create_group", |client| client
        .create_group(ReqCreateGroup {
            name: "Team".to_owned(),
            participants: vec![pn.clone(), parse_jid("5555:2@lid").unwrap()],
            ephemeral: GroupEphemeral {
                is_ephemeral: true,
                disappearing_timer: 604_800,
            },
            announce: GroupAnnounce {
                is_announce: true,
                ..GroupAnnounce::default()
            },
            locked: GroupLocked { is_locked: true },
            membership_approval_mode: GroupMembershipApprovalMode {
                is_join_approval_required: true,
            },
            member_add_mode: GroupMemberAddMode::Admin,
            linked_parent: GroupLinkedParent {
                linked_parent_jid: parent.clone(),
            },
            ..ReqCreateGroup::default()
        })
        .await);
    check!("create_community", |client| client
        .create_group(ReqCreateGroup {
            name: "Community".to_owned(),
            parent: GroupParent {
                is_parent: true,
                ..GroupParent::default()
            },
            ..ReqCreateGroup::default()
        })
        .await);
    check!("leave_group", |client| client.leave_group(group).await);
    check!("add_participants", |client| client
        .update_group_participants(group, &[lid.clone(), pn.clone()], ParticipantChange::Add)
        .await);
    check!("demote_participants", |client| client
        .update_group_participants(group, std::slice::from_ref(lid), ParticipantChange::Demote)
        .await);
    check!("get_request_participants", |client| client
        .get_group_request_participants(group)
        .await);
    check!("approve_request_participants", |client| client
        .update_group_request_participants(
            group,
            std::slice::from_ref(lid),
            ParticipantRequestChange::Approve
        )
        .await);
    check!("set_group_photo", |client| client
        .set_group_photo(group, Some(vec![0xff, 0xd8]))
        .await);
    check!("remove_group_photo", |client| client
        .set_group_photo(group, None)
        .await);
    check!("set_group_name", |client| client
        .set_group_name(group, "New name")
        .await);
    check!("set_group_topic", |client| client
        .set_group_topic(group, "prev1", "new1", "Topic")
        .await);
    check!("delete_group_topic", |client| client
        .set_group_topic(group, "prev1", "new2", "")
        .await);
    check!("set_group_locked", |client| client
        .set_group_locked(group, true)
        .await);
    check!("set_group_unlocked", |client| client
        .set_group_locked(group, false)
        .await);
    check!("set_group_announce", |client| client
        .set_group_announce(group, true)
        .await);
    check!("set_group_not_announce", |client| client
        .set_group_announce(group, false)
        .await);
    check!("reset_invite_link", |client| client
        .get_group_invite_link(group, true)
        .await);
    check!("get_invite_link", |client| client
        .get_group_invite_link(group, false)
        .await);
    check!("info_from_invite", |client| client
        .get_group_info_from_invite(group, inviter, "code1", 1_700_000_000)
        .await);
    check!("join_with_invite", |client| client
        .join_group_with_invite(group, inviter, "code1", 1_700_000_000)
        .await);
    check!("info_from_link", |client| client
        .get_group_info_from_link("https://chat.whatsapp.com/AbC?x=1")
        .await);
    check!("join_with_link", |client| client
        .join_group_with_link("AbC")
        .await);
    check!("join_approval_mode", |client| client
        .set_group_join_approval_mode(group, true)
        .await);
    check!("member_add_mode", |client| client
        .set_group_member_add_mode(group, GroupMemberAddMode::Admin)
        .await);
}

fn group_response(id: &str, participants: Vec<Node>) -> Node {
    node(
        "group",
        &[
            ("id", text(id)),
            ("subject", text("Team")),
            ("addressing_mode", text("lid")),
        ],
        children(participants),
    )
}

fn participant(attrs: &[(&str, AttributeValue)]) -> Node {
    node("participant", attrs, None)
}

#[tokio::test(start_paused = true)]
async fn joined_groups_are_parsed_cached_and_their_mappings_stored() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);
    let call = tokio::spawn(async move { client.get_joined_groups().await });

    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "w:g2"));
    assert_eq!(attr_string(&request, "type"), "get");
    assert_eq!(attr_string(&request, "to"), "g.us");
    let participating = request.get_child_by_tag(&["participating"]);
    let tags: Vec<&str> = participating
        .get_children()
        .iter()
        .map(|child| child.tag.as_str())
        .collect();
    assert_eq!(tags, ["participants", "description"]);

    connection
        .respond_iq(
            &request,
            vec![node(
                "groups",
                &[],
                children(vec![
                    group_response(
                        "111",
                        vec![
                            participant(&[
                                ("jid", jid("1111@lid")),
                                ("type", text("admin")),
                                ("phone_number", jid("1111@s.whatsapp.net")),
                            ]),
                            participant(&[
                                ("jid", jid("2222@lid")),
                                ("display_name", text("+1∙∙22")),
                            ]),
                        ],
                    ),
                    node("unexpected", &[], None),
                    group_response("222", vec![]),
                ]),
            )],
        )
        .await;
    let groups = call.await.unwrap().unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].jid.to_string(), "111@g.us");
    assert_eq!(groups[0].name.name, "Team");
    assert_eq!(groups[0].participants.len(), 2);
    assert!(groups[0].participants[0].is_admin);
    assert_eq!(
        groups[0].participants[0].phone_number.to_string(),
        "1111@s.whatsapp.net"
    );
    assert_eq!(groups[1].jid.to_string(), "222@g.us");

    assert_eq!(
        harness
            .store
            .get_pn_for_lid(&parse_jid("1111@lid").unwrap())
            .await
            .unwrap()
            .map(|pn| pn.to_string()),
        Some("1111@s.whatsapp.net".to_owned())
    );
    let contact = harness
        .store
        .get_contact(&parse_jid("2222@lid").unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(contact.redacted_phone, "+1∙∙22");
    let cache = harness.client.group_cache.lock().await;
    let cached = cache.get(&parse_jid("111@g.us").unwrap()).unwrap();
    assert_eq!(cached.addressing_mode, AddressingMode::Lid);
    assert_eq!(jid_strings(&cached.admins), ["1111@lid"]);
    assert_eq!(jid_strings(&cached.members), ["1111@lid", "2222@lid"]);
    assert!(cache.contains_key(&parse_jid("222@g.us").unwrap()));
}

#[tokio::test(start_paused = true)]
async fn group_info_is_fetched_once_for_the_cache_and_errors_are_mapped() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    let group = group_jid();

    let client = Arc::clone(&harness.client);
    let lookup = group.clone();
    let first = tokio::spawn(async move { client.get_cached_group_data(&lookup).await });
    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "w:g2"));
    assert_eq!(attr_string(&request, "to"), group.to_string());
    assert_eq!(
        attr_string(request.get_child_by_tag(&["query"]), "request"),
        "interactive"
    );
    connection
        .respond_iq(
            &request,
            vec![{
                let mut group_node = group_response(
                    "120363001234567890",
                    vec![
                        participant(&[("jid", jid("1111@lid")), ("type", text("superadmin"))]),
                        participant(&[("jid", jid("2222@lid"))]),
                    ],
                );
                if let Some(NodeContent::Nodes(nodes)) = &mut group_node.content {
                    nodes.push(node("announcement", &[], None));
                }
                group_node
            }],
        )
        .await;
    let cached = first.await.unwrap().unwrap();
    assert!(cached.read_only);
    assert_eq!(jid_strings(&cached.admins), ["1111@lid"]);

    // The second lookup is served from the cache.
    assert_eq!(
        harness.client.get_cached_group_data(&group).await.unwrap(),
        cached
    );
    let nothing = tokio::time::timeout(Duration::from_secs(5), next_node(&mut connection)).await;
    assert!(nothing.is_err(), "a cached lookup sends nothing");

    let client = Arc::clone(&harness.client);
    let lookup = group.clone();
    let missing = tokio::spawn(async move { client.get_group_info(&lookup).await });
    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "w:g2"));
    connection
        .respond_iq_error(&request, 404, "item-not-found")
        .await;
    let error = missing.await.unwrap().unwrap_err();
    assert_eq!(error.to_string(), "that group does not exist");
    assert!(error.is(&ClientError::GroupNotFound));
    assert!(error.is(&ClientError::iq_status(IqError::NOT_FOUND)));
}

async fn next_group_event(harness: &mut crate::client::test::Harness) -> Event {
    loop {
        let event = next_event(&mut harness.events).await;
        if matches!(event, Event::GroupInfo(_) | Event::JoinedGroup(_)) {
            return event;
        }
    }
}

#[tokio::test(start_paused = true)]
async fn group_notifications_emit_events_and_update_the_participant_cache() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    let group = group_jid();
    harness
        .client
        .cache_group_info(
            &GroupInfo {
                jid: group.clone(),
                participants: vec![
                    GroupParticipant {
                        jid: parse_jid("1111@lid").unwrap(),
                        is_admin: true,
                        ..GroupParticipant::default()
                    },
                    GroupParticipant {
                        jid: parse_jid("2222@lid").unwrap(),
                        ..GroupParticipant::default()
                    },
                ],
                ..GroupInfo::default()
            },
            None,
        )
        .await;

    connection
        .send_node(&node(
            "notification",
            &[
                ("id", text("n1")),
                ("type", text("w:gp2")),
                ("from", AttributeValue::Jid(group.clone())),
                ("t", text("1700000100")),
                ("participant", jid("1111@lid")),
            ],
            children(vec![
                node(
                    "add",
                    &[("v_id", text("2"))],
                    children(vec![participant(&[
                        ("jid", jid("3333@lid")),
                        ("phone_number", jid("3333@s.whatsapp.net")),
                    ])]),
                ),
                node(
                    "remove",
                    &[],
                    children(vec![participant(&[("jid", jid("1111@lid"))])]),
                ),
                node(
                    "promote",
                    &[("v_id", text("4"))],
                    children(vec![participant(&[("jid", jid("2222@lid"))])]),
                ),
            ]),
        ))
        .await;
    let Event::GroupInfo(event) = next_group_event(&mut harness).await else {
        panic!("expected a group change");
    };
    assert_eq!(event.jid, group);
    assert_eq!(jid_strings(&event.join), ["3333@lid"]);
    assert_eq!(jid_strings(&event.leave), ["1111@lid"]);
    assert_eq!(jid_strings(&event.promote), ["2222@lid"]);
    // Each participant change overwrites the versions, as in Go.
    assert_eq!(event.participant_version_id, "4");
    let ack = next_node(&mut connection).await;
    assert_eq!(ack.tag, "ack");
    assert_eq!(attr_string(&ack, "class"), "notification");
    assert_eq!(attr_string(&ack, "id"), "n1");

    let cached = harness
        .client
        .group_cache
        .lock()
        .await
        .get(&group)
        .cloned()
        .unwrap();
    // Removal swaps the last member in (Go's `FastDeleteItem`).
    assert_eq!(jid_strings(&cached.members), ["3333@lid", "2222@lid"]);
    assert_eq!(jid_strings(&cached.admins), ["2222@lid"]);
    // The last participant list's mappings are stored (the promote has
    // none, so the add's are dropped, as in Go).
    assert_eq!(
        harness
            .store
            .get_pn_for_lid(&parse_jid("3333@lid").unwrap())
            .await
            .unwrap(),
        None
    );

    connection
        .send_node(&node(
            "notification",
            &[
                ("id", text("n2")),
                ("type", text("w:gp2")),
                ("from", jid("120363007777777777@g.us")),
                ("t", text("1700000200")),
                ("participant", jid("1111@lid")),
            ],
            children(vec![node(
                "create",
                &[("type", text("new"))],
                children(vec![node(
                    "group",
                    &[
                        ("id", text("120363007777777777")),
                        ("subject", text("Fresh")),
                    ],
                    children(vec![participant(&[
                        ("jid", jid("1111@lid")),
                        ("phone_number", jid("1111@s.whatsapp.net")),
                    ])]),
                )]),
            )]),
        ))
        .await;
    let Event::JoinedGroup(joined) = next_group_event(&mut harness).await else {
        panic!("expected a joined group");
    };
    assert_eq!(joined.r#type, "new");
    assert_eq!(joined.group_info.name.name, "Fresh");
    assert_eq!(
        joined.sender.as_ref().map(ToString::to_string),
        Some("1111@lid".to_owned())
    );
    assert!(
        harness
            .client
            .group_cache
            .lock()
            .await
            .contains_key(&parse_jid("120363007777777777@g.us").unwrap())
    );
    assert_eq!(
        harness
            .store
            .get_pn_for_lid(&parse_jid("1111@lid").unwrap())
            .await
            .unwrap()
            .map(|pn| pn.to_string()),
        Some("1111@s.whatsapp.net".to_owned())
    );
}

#[tokio::test(start_paused = true)]
async fn a_failing_handler_leaves_the_group_notification_unacked() {
    let mut harness = crate::client::test::harness_with(Some(OWN), |config| {
        config.synchronous_ack = true;
    });
    harness
        .client
        .add_event_handler(Arc::new(RejectGroupEvents));
    let mut connection = connect_paired(&mut harness).await;
    connection
        .send_node(&node(
            "notification",
            &[
                ("id", text("n3")),
                ("type", text("w:gp2")),
                ("from", AttributeValue::Jid(group_jid())),
                ("t", text("1700000100")),
            ],
            children(vec![node("locked", &[], None)]),
        ))
        .await;
    assert!(matches!(
        next_group_event(&mut harness).await,
        Event::GroupInfo(_)
    ));
    let next = tokio::time::timeout(Duration::from_secs(5), next_node(&mut connection)).await;
    assert!(next.is_err(), "the notification isn't acked");
}

struct RejectGroupEvents;

#[async_trait::async_trait]
impl crate::client::EventHandler for RejectGroupEvents {
    async fn handle(&self, event: &Event) -> bool {
        !matches!(event, Event::GroupInfo(_))
    }
}
