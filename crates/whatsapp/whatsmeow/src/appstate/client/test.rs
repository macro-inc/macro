// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The app state client against the fake server, checked against
//! `testdata/appstate_client.json`, which whatsmeow's own client code wrote
//! (`testdata/generator/inpackage/appstate_client_vectors_test.go`).

use std::sync::Arc;

use chrono::DateTime;
use prost::Message as _;
use serde_json::{Value, json};

use super::*;
use crate::appstate::{Processor, WA_PATCH_REGULAR_HIGH, WA_PATCH_REGULAR_LOW, build_pin};
use crate::binary::AttributeValue;
use crate::client::test::{
    bytes, children, connect_paired, harness, harness_with, is_noise, jid, next_event, node, text,
};
use crate::proto::wa_e2e::{AppStateSyncKey as SharedKey, AppStateSyncKeyData};
use crate::proto::wa_server_sync::{SyncdPatch, SyncdVersion};
use crate::store::{
    AppStateStore, AppStateSyncKeyStore, ChatSettingsStore, ContactStore, MemoryStore,
};
use crate::testing::{ServerConnection, attr_string, is_iq};
use crate::vectors::Vectors;

const OWN_JID: (&str, &str) = ("1234:5@s.whatsapp.net", "9876:5@lid");

/// The next request, skipping keepalives and the client's acks.
async fn next_request(connection: &mut ServerConnection) -> Node {
    connection
        .recv_node_skipping(|node| is_noise(node) || node.tag == "ack")
        .await
        .expect("client sent a node")
}

/// The request with the ID Go's vector has. Nodes are compared decoded:
/// Go marshals attributes in its random map order.
fn with_vector_id(mut request: Node, vector: &Node) -> Node {
    request
        .attrs
        .insert("id".to_owned(), vector.attrs["id"].clone());
    request
}

fn server_sync(collection: &str, version: &str) -> Node {
    node(
        "notification",
        &[
            ("id", text("notification-1")),
            ("type", text("server_sync")),
            ("from", jid("s.whatsapp.net")),
        ],
        children(vec![node(
            "collection",
            &[("name", text(collection)), ("version", text(version))],
            None,
        )]),
    )
}

/// `<sync><collection><patches>…` with the patches as the server sends them.
fn patches_response(collection: &str, version: &str, patches: &[Vec<u8>]) -> Vec<Node> {
    vec![node(
        "sync",
        &[],
        children(vec![node(
            "collection",
            &[("name", text(collection)), ("version", text(version))],
            children(vec![node(
                "patches",
                &[],
                children(
                    patches
                        .iter()
                        .map(|patch| node("patch", &[], bytes(patch)))
                        .collect(),
                ),
            )]),
        )]),
    )]
}

async fn put_key(store: &MemoryStore, vectors: &Vectors, number: u8) {
    store
        .put_app_state_sync_key(
            &vectors.bytes(&format!("key_{number}_id")),
            AppStateSyncKey {
                data: vectors.bytes(&format!("key_{number}_data")),
                fingerprint: Vec::new(),
                timestamp: 0,
            },
        )
        .await
        .unwrap();
}

/// An event in the shape the Go generator writes.
fn event_vector(event: &Event) -> Value {
    fn action(message: Option<&impl prost::Message>) -> String {
        message
            .map(|message| hex::encode(message.encode_to_vec()))
            .unwrap_or_default()
    }
    match event {
        Event::AppState(event) => json!({
            "type": "AppState",
            "index": event.index,
            "action": action(event.sync_action_value.as_ref()),
        }),
        Event::Contact(event) => json!({
            "type": "Contact", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::Mute(event) => json!({
            "type": "Mute", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::Pin(event) => json!({
            "type": "Pin", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::Archive(event) => json!({
            "type": "Archive", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::MarkChatAsRead(event) => json!({
            "type": "MarkChatAsRead", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::ClearChat(event) => json!({
            "type": "ClearChat", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
            "delete_media": event.delete_media,
        }),
        Event::DeleteChat(event) => json!({
            "type": "DeleteChat", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
            "delete_media": event.delete_media,
        }),
        Event::Star(event) => json!({
            "type": "Star", "jid": event.chat_jid.to_string(),
            "sender_jid": event.sender_jid.to_string(), "is_from_me": event.is_from_me,
            "message_id": event.message_id, "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::DeleteForMe(event) => json!({
            "type": "DeleteForMe", "jid": event.chat_jid.to_string(),
            "sender_jid": event.sender_jid.to_string(), "is_from_me": event.is_from_me,
            "message_id": event.message_id, "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::PushNameSetting(event) => json!({
            "type": "PushNameSetting", "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::UnarchiveChatsSetting(event) => json!({
            "type": "UnarchiveChatsSetting", "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::UserStatusMute(event) => json!({
            "type": "UserStatusMute", "jid": event.jid.to_string(),
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::LabelEdit(event) => json!({
            "type": "LabelEdit", "label_id": event.label_id,
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::LabelAssociationChat(event) => json!({
            "type": "LabelAssociationChat", "jid": event.jid.to_string(),
            "label_id": event.label_id, "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        Event::LabelAssociationMessage(event) => json!({
            "type": "LabelAssociationMessage", "jid": event.jid.to_string(),
            "label_id": event.label_id, "message_id": event.message_id,
            "timestamp": event.timestamp.timestamp_millis(),
            "action": action(event.action.as_ref()), "from_full_sync": event.from_full_sync,
        }),
        other => panic!("unexpected event {other:?}"),
    }
}

async fn next_events(
    events: &mut tokio::sync::mpsc::UnboundedReceiver<Event>,
    count: usize,
) -> Vec<Value> {
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        out.push(event_vector(&next_event(events).await));
    }
    out
}

#[tokio::test(start_paused = true)]
async fn server_sync_full_sync_then_incremental_sync() {
    let vectors = Vectors::load("appstate_client.json");
    let mut harness = harness_with(Some(OWN_JID), |config| {
        config.emit_app_state_events_on_full_sync = true;
    });
    put_key(&harness.store, &vectors, 1).await;
    let mut connection = connect_paired(&mut harness).await;

    // Version 0: a full sync asking for a snapshot.
    connection
        .send_node(&server_sync("regular_high", "1"))
        .await;
    let request = next_request(&mut connection).await;
    let expected = vectors.node("fetch_snapshot_iq");
    assert_eq!(with_vector_id(request.clone(), &expected), expected);
    connection
        .respond_iq(
            &request,
            patches_response(
                "regular_high",
                "1",
                &[vectors.bytes("regular_high_v1_patch")],
            ),
        )
        .await;
    let expected_events = vectors.value("regular_high_v1_events").as_array().unwrap();
    let events = next_events(&mut harness.events, expected_events.len()).await;
    assert_eq!(&events, expected_events);
    let Event::AppStateSyncComplete(complete) = next_event(&mut harness.events).await else {
        panic!("expected AppStateSyncComplete");
    };
    assert_eq!(
        complete,
        AppStateSyncComplete {
            name: WA_PATCH_REGULAR_HIGH,
            version: 1,
            recovery: false,
        }
    );

    let chat = parse_jid("1111@s.whatsapp.net").unwrap();
    let group = parse_jid("120363000000000001@g.us").unwrap();
    let chat_settings = harness
        .store
        .get_chat_settings(&chat)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        chat_settings.muted_until,
        DateTime::from_timestamp_millis(1_700_003_600_000)
    );
    assert!(chat_settings.archived);
    assert!(!chat_settings.pinned);
    assert!(
        harness
            .store
            .get_chat_settings(&group)
            .await
            .unwrap()
            .unwrap()
            .pinned
    );
    let contact = harness
        .store
        .get_contact(&parse_jid("3333@s.whatsapp.net").unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (contact.first_name.as_str(), contact.full_name.as_str()),
        ("Contact", "Contact Full")
    );
    assert_eq!(harness.client.store.read().await.push_name, "New Name");
    assert_eq!(
        harness
            .store
            .get_app_state_version("regular_high")
            .await
            .unwrap()
            .0,
        1
    );

    // The next notification fetches from the stored version.
    connection
        .send_node(&server_sync("regular_high", "2"))
        .await;
    let request = next_request(&mut connection).await;
    let expected = vectors.node("fetch_version_iq");
    assert_eq!(with_vector_id(request.clone(), &expected), expected);
    connection
        .respond_iq(
            &request,
            patches_response(
                "regular_high",
                "2",
                &[vectors.bytes("regular_high_v2_patch")],
            ),
        )
        .await;
    let expected_events = vectors.value("regular_high_v2_events").as_array().unwrap();
    let events = next_events(&mut harness.events, expected_events.len()).await;
    assert_eq!(&events, expected_events);
    let chat_settings = harness
        .store
        .get_chat_settings(&chat)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(chat_settings.muted_until, None);
    assert!(!chat_settings.pinned);
    assert_eq!(
        harness
            .store
            .get_app_state_version("regular_high")
            .await
            .unwrap()
            .0,
        2
    );
}

#[tokio::test(start_paused = true)]
async fn full_sync_of_contacts_without_events_stores_them_in_bulk() {
    let vectors = Vectors::load("appstate_client.json");
    let mut harness = harness(Some(OWN_JID));
    put_key(&harness.store, &vectors, 1).await;
    let mut connection = connect_paired(&mut harness).await;

    connection
        .send_node(&server_sync("critical_unblock_low", "1"))
        .await;
    let request = next_request(&mut connection).await;
    assert!(is_iq(&request, "w:sync:app:state"));
    connection
        .respond_iq(
            &request,
            patches_response(
                "critical_unblock_low",
                "1",
                &[vectors.bytes("critical_unblock_low_v1_patch")],
            ),
        )
        .await;
    // Only the completion is dispatched on a full sync by default.
    let Event::AppStateSyncComplete(complete) = next_event(&mut harness.events).await else {
        panic!("expected AppStateSyncComplete");
    };
    assert_eq!(complete.version, 1);
    let contact = harness
        .store
        .get_contact(&parse_jid("3333@s.whatsapp.net").unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (contact.first_name.as_str(), contact.full_name.as_str()),
        ("Contact", "Contact Full")
    );
    // The other mutations still update the store.
    let chat = parse_jid("1111@s.whatsapp.net").unwrap();
    assert!(
        harness
            .store
            .get_chat_settings(&chat)
            .await
            .unwrap()
            .unwrap()
            .pinned
    );
}

#[tokio::test(start_paused = true)]
async fn failed_full_sync_fetch_dispatches_sync_error() {
    let mut harness = harness(Some(OWN_JID));
    let mut connection = connect_paired(&mut harness).await;

    connection.send_node(&server_sync("regular", "1")).await;
    let request = next_request(&mut connection).await;
    connection
        .respond_iq_error(&request, 500, "internal-server-error")
        .await;
    let Event::AppStateSyncError(error) = next_event(&mut harness.events).await else {
        panic!("expected AppStateSyncError");
    };
    assert_eq!(error.name.as_str(), "regular");
    assert!(error.full_sync);
    assert_eq!(
        error.error.to_string(),
        "info query returned status 500: internal-server-error"
    );
}

#[tokio::test(start_paused = true)]
async fn missing_key_is_requested_and_key_share_resyncs() {
    let vectors = Vectors::load("appstate_client.json");
    let mut harness = harness(Some(OWN_JID));
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);

    let patch = vectors.bytes("regular_low_v1_patch_key_2");
    let regular_low = WA_PATCH_REGULAR_LOW;
    let fetch = client.fetch_app_state(&regular_low, false, false);
    let respond = async {
        let request = next_request(&mut connection).await;
        connection
            .respond_iq(
                &request,
                patches_response("regular_low", "1", std::slice::from_ref(&patch)),
            )
            .await;
    };
    let (result, ()) = tokio::join!(fetch, respond);
    let error = result.unwrap_err();
    let ClientError::Wrapped { source, .. } = &error else {
        panic!("expected a wrapped decode error, got {error}");
    };
    let ClientError::AppStateDecode(decode) = source.as_ref() else {
        panic!("expected a decode error, got {source}");
    };
    assert_eq!(decode.sentinel(), Some(AppStateError::KeyNotFound));

    // The background request and this one race; either records the request.
    let list = PatchList {
        name: WA_PATCH_REGULAR_LOW,
        has_more_patches: false,
        patches: vec![SyncdPatch::decode(patch.as_slice()).unwrap()],
        snapshot: None,
    };
    client.request_missing_app_state_keys(&list).await;
    let requested = lock(&client.app_state_key_requests)
        .get("00000002")
        .copied();
    assert!(requested.is_some());
    // Within a day, the key isn't requested again.
    client.request_missing_app_state_keys(&list).await;
    assert_eq!(
        lock(&client.app_state_key_requests)
            .get("00000002")
            .copied(),
        requested
    );

    // The phone shares the key: every collection is fetched again.
    let share = AppStateSyncKeyShare {
        keys: vec![SharedKey {
            key_id: Some(AppStateSyncKeyId {
                key_id: Some(vectors.bytes("key_2_id")),
            }),
            key_data: Some(AppStateSyncKeyData {
                key_data: Some(vectors.bytes("key_2_data")),
                fingerprint: None,
                timestamp: Some(1_700_000_000),
            }),
        }],
    };
    let respond = async {
        let mut names = Vec::new();
        for _ in 0..ALL_PATCH_NAMES.len() {
            let request = next_request(&mut connection).await;
            let name = attr_string(request.get_child_by_tag(&["sync", "collection"]), "name");
            let patches = if name == "regular_low" {
                vec![patch.clone()]
            } else {
                Vec::new()
            };
            connection
                .respond_iq(&request, patches_response(&name, "1", &patches))
                .await;
            names.push(name);
        }
        names
    };
    let ((), names) = tokio::join!(client.handle_app_state_sync_key_share(&share), respond);
    assert_eq!(
        names,
        [
            "critical_block",
            "critical_unblock_low",
            "regular_high",
            "regular",
            "regular_low"
        ]
    );
    let stored = harness
        .store
        .get_app_state_sync_key(&vectors.bytes("key_2_id"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.data, vectors.bytes("key_2_data"));
    assert_eq!(stored.timestamp, 1_700_000_000);
    let chat = parse_jid("1111@s.whatsapp.net").unwrap();
    assert!(
        harness
            .store
            .get_chat_settings(&chat)
            .await
            .unwrap()
            .unwrap()
            .archived
    );
}

#[test]
fn key_request_message_lists_the_key_ids() {
    let message = build_app_state_key_request(&[vec![0, 0, 0, 2], vec![0, 0, 0, 3]]);
    let protocol = message.protocol_message.unwrap();
    assert_eq!(
        protocol.r#type,
        Some(protocol_message::Type::AppStateSyncKeyRequest as i32)
    );
    assert_eq!(
        protocol.app_state_sync_key_request.unwrap().key_i_ds,
        [
            AppStateSyncKeyId {
                key_id: Some(vec![0, 0, 0, 2])
            },
            AppStateSyncKeyId {
                key_id: Some(vec![0, 0, 0, 3])
            },
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn send_app_state_sends_a_valid_patch_and_resyncs() {
    let vectors = Vectors::load("appstate_client.json");
    let mut harness = harness(Some(OWN_JID));
    put_key(&harness.store, &vectors, 1).await;
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);
    let chat = parse_jid("1111@s.whatsapp.net").unwrap();

    let server = async {
        let request = next_request(&mut connection).await;
        let patch = request.get_child_by_tag(&["sync", "collection", "patch"]);
        let Some(NodeContent::Bytes(patch)) = patch.content.clone() else {
            panic!("the request has no patch");
        };
        let mut without_patch = request.clone();
        let Some(NodeContent::Nodes(sync)) = &mut without_patch.content else {
            panic!("the request has no sync node");
        };
        let Some(NodeContent::Nodes(collection)) = &mut sync[0].content else {
            panic!("the request has no collection node");
        };
        let Some(NodeContent::Nodes(patch_node)) = &mut collection[0].content else {
            panic!("the request has no patch node");
        };
        patch_node[0].content = None;
        let expected = vectors.node("send_app_state_iq_without_patch");
        assert_eq!(with_vector_id(without_patch, &expected), expected);

        // The server assigns version 1; a processor with the same key
        // verifies and decodes it.
        let mut patch = SyncdPatch::decode(patch.as_slice()).unwrap();
        patch.version = Some(SyncdVersion { version: Some(1) });
        let verifier_store = Arc::new(MemoryStore::default());
        put_key(&verifier_store, &vectors, 1).await;
        let verifier = Processor::new(&verifier_store.new_device(&crate::testing::FakeSignatures));
        let list = PatchList {
            name: WA_PATCH_REGULAR_LOW,
            has_more_patches: false,
            patches: vec![patch.clone()],
            snapshot: None,
        };
        let (mutations, state) = verifier
            .decode_patches(&list, HashState::default(), true)
            .await
            .unwrap();
        assert_eq!(state.version, 1);
        assert_eq!(mutations.len(), 1);
        assert_eq!(mutations[0].index, ["pin_v1", "1111@s.whatsapp.net"]);
        assert_eq!(
            mutations[0]
                .action
                .as_ref()
                .and_then(|action| action.pin_action.as_ref())
                .and_then(|action| action.pinned),
            Some(true)
        );
        connection
            .respond_iq(
                &request,
                vec![node(
                    "sync",
                    &[],
                    children(vec![node(
                        "collection",
                        &[("name", text("regular_low")), ("version", text("1"))],
                        None,
                    )]),
                )],
            )
            .await;

        // The client resyncs; the server returns the patch it stored.
        let request = next_request(&mut connection).await;
        assert_eq!(
            request.get_child_by_tag(&["sync", "collection"]).attrs["return_snapshot"],
            AttributeValue::String("true".to_owned())
        );
        connection
            .respond_iq(
                &request,
                patches_response("regular_low", "1", &[patch.encode_to_vec()]),
            )
            .await;
    };
    let (result, ()) = tokio::join!(client.send_app_state(build_pin(&chat, true)), server);
    result.unwrap();
    let Event::AppStateSyncComplete(complete) = next_event(&mut harness.events).await else {
        panic!("expected AppStateSyncComplete");
    };
    assert_eq!(complete.version, 1);
    assert!(
        harness
            .store
            .get_chat_settings(&chat)
            .await
            .unwrap()
            .unwrap()
            .pinned
    );
}

#[tokio::test(start_paused = true)]
async fn send_app_state_applies_a_conflict_and_retries() {
    let vectors = Vectors::load("appstate_client.json");
    let mut harness = harness(Some(OWN_JID));
    put_key(&harness.store, &vectors, 1).await;
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);
    let chat = parse_jid("1111@s.whatsapp.net").unwrap();
    let group = parse_jid("120363000000000001@g.us").unwrap();

    // Another device pinned the group first: version 1 on the server.
    let other_store = Arc::new(MemoryStore::default());
    put_key(&other_store, &vectors, 1).await;
    let other = Processor::new(&other_store.new_device(&crate::testing::FakeSignatures));
    let mut conflict = SyncdPatch::decode(
        other
            .encode_patch(
                &vectors.bytes("key_1_id"),
                HashState::default(),
                build_pin(&group, true),
            )
            .await
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    conflict.version = Some(SyncdVersion { version: Some(1) });

    let collection_version =
        |request: &Node| attr_string(request.get_child_by_tag(&["sync", "collection"]), "version");
    let server = async {
        let request = next_request(&mut connection).await;
        assert_eq!(collection_version(&request), "0");
        connection
            .respond_iq(
                &request,
                vec![node(
                    "sync",
                    &[],
                    children(vec![node(
                        "collection",
                        &[
                            ("name", text("regular_low")),
                            ("type", text("error")),
                            ("version", text("1")),
                        ],
                        children(vec![
                            node(
                                "error",
                                &[("code", text("409")), ("text", text("conflict"))],
                                None,
                            ),
                            node(
                                "patches",
                                &[],
                                children(vec![node(
                                    "patch",
                                    &[],
                                    bytes(&conflict.encode_to_vec()),
                                )]),
                            ),
                        ]),
                    )]),
                )],
            )
            .await;

        // The retry builds on the conflicting patch.
        let request = next_request(&mut connection).await;
        assert_eq!(collection_version(&request), "1");
        let Some(NodeContent::Bytes(patch)) = request
            .get_child_by_tag(&["sync", "collection", "patch"])
            .content
            .clone()
        else {
            panic!("the retry has no patch");
        };
        let mut patch = SyncdPatch::decode(patch.as_slice()).unwrap();
        patch.version = Some(SyncdVersion { version: Some(2) });
        connection
            .respond_iq(
                &request,
                vec![node(
                    "sync",
                    &[],
                    children(vec![node(
                        "collection",
                        &[("name", text("regular_low")), ("version", text("2"))],
                        None,
                    )]),
                )],
            )
            .await;

        let request = next_request(&mut connection).await;
        assert_eq!(collection_version(&request), "1");
        connection
            .respond_iq(
                &request,
                patches_response("regular_low", "2", &[patch.encode_to_vec()]),
            )
            .await;
    };
    let (result, ()) = tokio::join!(client.send_app_state(build_pin(&chat, true)), server);
    result.unwrap();
    assert!(
        harness
            .store
            .get_chat_settings(&chat)
            .await
            .unwrap()
            .unwrap()
            .pinned
    );
    assert!(
        harness
            .store
            .get_chat_settings(&group)
            .await
            .unwrap()
            .unwrap()
            .pinned
    );
    assert_eq!(
        harness
            .store
            .get_app_state_version("regular_low")
            .await
            .unwrap()
            .0,
        2
    );
}

#[tokio::test(start_paused = true)]
async fn mark_not_dirty_matches_whatsmeow() {
    let vectors = Vectors::load("appstate_client.json");
    let mut harness = harness(Some(OWN_JID));
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);

    let server = async {
        let request = next_request(&mut connection).await;
        let expected = vectors.node("mark_not_dirty_iq");
        assert_eq!(with_vector_id(request.clone(), &expected), expected);
        connection.respond_iq(&request, vec![]).await;
    };
    let timestamp = DateTime::from_timestamp(1_700_000_000, 0).unwrap();
    let (result, ()) = tokio::join!(client.mark_not_dirty("groups", timestamp), server);
    result.unwrap();
}

#[test]
fn recovery_request_matches_whatsmeow() {
    let vectors = Vectors::load("appstate_client.json");
    let mut message = build_app_state_recovery_request(&WA_PATCH_REGULAR_HIGH);
    message
        .protocol_message
        .as_mut()
        .and_then(|protocol| protocol.peer_data_operation_request_message.as_mut())
        .and_then(|request| request.syncd_collection_fatal_recovery_request.as_mut())
        .unwrap()
        .timestamp = Some(1_700_000_000);
    assert_eq!(message.encode_to_vec(), vectors.bytes("recovery_request"));
}

#[test]
fn filter_contacts_splits_contact_mutations() {
    let contact = |index: &[&str]| Mutation {
        key_id: Vec::new(),
        operation: SyncdOperation::Set as i32,
        action: Some(crate::proto::wa_sync_action::SyncActionValue {
            contact_action: Some(crate::proto::wa_sync_action::ContactAction {
                full_name: Some("Full".to_owned()),
                first_name: Some("First".to_owned()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        version: 2,
        index: index.iter().map(|part| (*part).to_owned()).collect(),
        index_mac: Vec::new(),
        value_mac: Vec::new(),
        patch_version: 1,
    };
    let (rest, contacts) = filter_contacts(vec![
        contact(&["contact", "3333@s.whatsapp.net"]),
        contact(&["contact"]),
        contact(&["pin_v1", "1111@s.whatsapp.net"]),
    ]);
    assert_eq!(
        contacts,
        [ContactEntry {
            jid: parse_jid("3333@s.whatsapp.net").unwrap(),
            first_name: "First".to_owned(),
            full_name: "Full".to_owned(),
        }]
    );
    assert_eq!(rest.len(), 2);
}
