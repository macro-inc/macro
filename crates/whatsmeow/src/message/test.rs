// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The receive path against the fake server, with the fake Signal
//! implementation: decrypting 1:1 and group messages, receipts, retry
//! receipts for undecryptable messages, and history sync notifications.

use std::io::Write as _;

use prost::Message as _;

use super::*;
use crate::client::test::{
    bytes, children, connect_paired, harness, jid, next_event, next_node, node, text,
};
use crate::store::{IdentityStore, SenderKeyStore};
use crate::testing::{
    attr_string, fake_direct_ciphertext, fake_group_ciphertext,
    fake_sender_key_distribution_message,
};

const OWN_JID: &str = "1234:5@s.whatsapp.net";
const OWN_LID: &str = "9876:5@lid";
const PEER: &str = "5550001@s.whatsapp.net";
const PEER_IDENTITY: [u8; 32] = [0x33; 32];

fn enc(kind: &str, ciphertext: Vec<u8>) -> Node {
    node(
        "enc",
        &[("v", text("2")), ("type", text(kind))],
        bytes(&ciphertext),
    )
}

fn text_message(body: &str) -> wa_e2e::Message {
    wa_e2e::Message {
        conversation: Some(body.to_owned()),
        ..Default::default()
    }
}

async fn next_message(events: &mut tokio::sync::mpsc::UnboundedReceiver<Event>) -> Message {
    loop {
        if let Event::Message(message) = next_event(events).await {
            return *message;
        }
    }
}

#[test]
fn padding_round_trips_and_rejects_bad_padding() {
    let padded = pad_message(b"hello".to_vec());
    assert!(padded.len() > 5 && padded.len() <= 20);
    assert_eq!(unpad_message(padded, 2).unwrap(), b"hello");
    assert_eq!(
        unpad_message(b"abc\x02\x01".to_vec(), 2).unwrap(),
        b"abc\x02"
    );
    assert_eq!(
        unpad_message(b"abc\x03\x02".to_vec(), 2).unwrap_err(),
        "plaintext doesn't have expected padding"
    );
    assert_eq!(
        unpad_message(Vec::new(), 2).unwrap_err(),
        "plaintext is empty"
    );
    assert_eq!(unpad_message(b"raw".to_vec(), 3).unwrap(), b"raw");
}

#[tokio::test(start_paused = true)]
async fn a_direct_message_is_decrypted_dispatched_and_receipted() {
    let mut harness = harness(Some((OWN_JID, OWN_LID)));
    let mut connection = connect_paired(&mut harness).await;
    let ciphertext = fake_direct_ciphertext(
        &PEER_IDENTITY,
        &pad_message(text_message("hello there").encode_to_vec()),
    );
    connection
        .send_node(&node(
            "message",
            &[
                ("from", jid(PEER)),
                ("id", text("MSG1")),
                ("t", text("1700000100")),
                ("type", text("text")),
                ("notify", text("Peer")),
            ],
            children(vec![enc("pkmsg", ciphertext)]),
        ))
        .await;

    let message = next_message(&mut harness.events).await;
    assert_eq!(message.info.id, "MSG1");
    assert_eq!(message.info.chat.to_string(), PEER);
    assert_eq!(message.info.sender.to_string(), PEER);
    assert!(!message.info.is_from_me);
    assert_eq!(message.info.push_name, "Peer");
    assert_eq!(
        message.message.unwrap().conversation.as_deref(),
        Some("hello there")
    );

    let receipt = next_node(&mut connection).await;
    assert_eq!(receipt.tag, "receipt");
    assert_eq!(attr_string(&receipt, "id"), "MSG1");
    assert_eq!(attr_string(&receipt, "to"), PEER);
    assert_eq!(attr_string(&receipt, "type"), "inactive");
    assert!(
        harness
            .store
            .is_trusted_identity("5550001:0", PEER_IDENTITY)
            .await
            .unwrap(),
        "decrypting the prekey message stored the sender's identity"
    );
}

#[tokio::test(start_paused = true)]
async fn group_messages_need_the_sender_key_and_ask_for_a_retry_without_it() {
    let mut harness = harness(Some((OWN_JID, OWN_LID)));
    let mut connection = connect_paired(&mut harness).await;
    let group = "120363000000000001@g.us";

    // No sender key yet: the client sends a retry receipt and reports the
    // message as undecryptable.
    connection
        .send_node(&node(
            "message",
            &[
                ("from", jid(group)),
                ("participant", jid(PEER)),
                ("id", text("G1")),
                ("t", text("1700000200")),
                ("type", text("text")),
            ],
            children(vec![enc(
                "skmsg",
                fake_group_ciphertext(&pad_message(text_message("lost").encode_to_vec())),
            )]),
        ))
        .await;
    loop {
        if let Event::UndecryptableMessage(undecryptable) = next_event(&mut harness.events).await {
            assert_eq!(undecryptable.info.id, "G1");
            assert!(undecryptable.is_unavailable);
            break;
        }
    }
    let mut retry = next_node(&mut connection).await;
    if retry.tag == "ack" {
        retry = next_node(&mut connection).await;
    }
    assert_eq!(retry.tag, "receipt");
    assert_eq!(attr_string(&retry, "type"), "retry");
    assert_eq!(attr_string(&retry, "participant"), PEER);
    let retry_child = retry.get_child_by_tag(&["retry"]);
    assert_eq!(attr_string(retry_child, "count"), "1");
    assert_eq!(attr_string(retry_child, "id"), "G1");
    assert!(
        retry.get_optional_child_by_tag(&["keys"]).is_some(),
        "a missing sender key forces our identity into the first retry"
    );

    // The resend carries the sender key distribution message 1:1 and the
    // group ciphertext.
    let sender_key_name = SenderKeyName {
        group_id: group.to_owned(),
        sender: parse_jid(PEER).unwrap().signal_address(),
    };
    let skdm_message = wa_e2e::Message {
        sender_key_distribution_message: Some(wa_e2e::SenderKeyDistributionMessage {
            group_id: Some(group.to_owned()),
            axolotl_sender_key_distribution_message: Some(fake_sender_key_distribution_message(
                &sender_key_name,
            )),
        }),
        ..Default::default()
    };
    connection
        .send_node(&node(
            "message",
            &[
                ("from", jid(group)),
                ("participant", jid(PEER)),
                ("id", text("G1")),
                ("t", text("1700000200")),
                ("type", text("text")),
            ],
            children(vec![
                enc(
                    "pkmsg",
                    fake_direct_ciphertext(
                        &PEER_IDENTITY,
                        &pad_message(skdm_message.encode_to_vec()),
                    ),
                ),
                enc(
                    "skmsg",
                    fake_group_ciphertext(&pad_message(text_message("found").encode_to_vec())),
                ),
            ]),
        ))
        .await;
    let first = next_message(&mut harness.events).await;
    assert!(
        first
            .message
            .unwrap()
            .sender_key_distribution_message
            .is_some()
    );
    let second = next_message(&mut harness.events).await;
    assert_eq!(second.info.chat.to_string(), group);
    assert_eq!(second.info.sender.to_string(), PEER);
    assert!(second.info.is_group);
    assert_eq!(
        second.message.unwrap().conversation.as_deref(),
        Some("found")
    );
    assert!(
        harness
            .store
            .get_sender_key(group, "5550001:0")
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test(start_paused = true)]
async fn an_unparseable_message_is_nacked() {
    let mut harness = harness(Some((OWN_JID, OWN_LID)));
    let mut connection = connect_paired(&mut harness).await;
    connection
        .send_node(&node("message", &[("id", text("BAD"))], None))
        .await;
    let ack = next_node(&mut connection).await;
    assert_eq!(ack.tag, "ack");
    assert_eq!(attr_string(&ack, "error"), "487");
}

#[tokio::test(start_paused = true)]
async fn receipts_are_parsed_and_acked() {
    let mut harness = harness(Some((OWN_JID, OWN_LID)));
    let mut connection = connect_paired(&mut harness).await;
    connection
        .send_node(&node(
            "receipt",
            &[
                ("from", jid(PEER)),
                ("id", text("OUT1")),
                ("t", text("1700000300")),
                ("type", text("read")),
            ],
            children(vec![node(
                "list",
                &[],
                children(vec![node("item", &[("id", text("OUT2"))], None)]),
            )]),
        ))
        .await;
    loop {
        if let Event::Receipt(receipt) = next_event(&mut harness.events).await {
            assert_eq!(
                receipt.message_ids,
                vec!["OUT1".to_owned(), "OUT2".to_owned()]
            );
            assert_eq!(receipt.r#type, ReceiptType::Read);
            assert_eq!(receipt.source.chat.to_string(), PEER);
            break;
        }
    }
    let ack = next_node(&mut connection).await;
    assert_eq!(ack.tag, "ack");
    assert_eq!(attr_string(&ack, "class"), "receipt");
    assert_eq!(attr_string(&ack, "type"), "read");
    assert_eq!(attr_string(&ack, "id"), "OUT1");
}

#[tokio::test(start_paused = true)]
async fn a_history_sync_notification_from_the_phone_is_downloaded_and_dispatched() {
    let mut harness = harness(Some((OWN_JID, OWN_LID)));
    let mut connection = connect_paired(&mut harness).await;
    let history = wa_history_sync::HistorySync {
        sync_type: HistorySyncType::InitialBootstrap as i32,
        conversations: vec![wa_history_sync::Conversation {
            id: "120363000000000001@g.us".to_owned(),
            ..Default::default()
        }],
        phone_number_to_lid_mappings: vec![wa_history_sync::PhoneNumberToLidMapping {
            pn_jid: Some(PEER.to_owned()),
            lid_jid: Some("777@lid".to_owned()),
        }],
        ..Default::default()
    };
    let mut compressed =
        flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    compressed.write_all(&history.encode_to_vec()).unwrap();
    let notification = wa_e2e::Message {
        protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
            r#type: Some(wa_e2e::protocol_message::Type::HistorySyncNotification as i32),
            history_sync_notification: Some(wa_e2e::HistorySyncNotification {
                initial_hist_bootstrap_inline_payload: Some(compressed.finish().unwrap()),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    };
    let own_identity = harness.client.store.read().await.identity_key.public;
    connection
        .send_node(&node(
            "message",
            &[
                ("from", jid("1234:0@s.whatsapp.net")),
                ("id", text("HS1")),
                ("t", text("1700000400")),
                ("type", text("text")),
                ("category", text("peer")),
            ],
            children(vec![enc(
                "pkmsg",
                fake_direct_ciphertext(&own_identity, &pad_message(notification.encode_to_vec())),
            )]),
        ))
        .await;
    loop {
        if let Event::HistorySync(history_sync) = next_event(&mut harness.events).await {
            assert_eq!(history_sync.data.conversations.len(), 1);
            break;
        }
    }
    let mut receipt_types = Vec::new();
    while receipt_types.len() < 3 {
        let receipt = next_node(&mut connection).await;
        if receipt.tag == "receipt" {
            receipt_types.push(attr_string(&receipt, "type"));
        }
    }
    receipt_types.sort();
    assert_eq!(receipt_types, vec!["hist_sync", "peer_msg", "sender"]);
    let lid = harness
        .client
        .store
        .read()
        .await
        .lids
        .get_lid_for_pn(&parse_jid(PEER).unwrap())
        .await
        .unwrap();
    assert_eq!(lid.unwrap().to_string(), "777@lid");
}

#[tokio::test(start_paused = true)]
async fn message_sources_parse_like_go() {
    let harness = harness(Some((OWN_JID, OWN_LID)));
    let vectors = crate::vectors::Vectors::load("message.json");
    for case in vectors.value("sources").as_array().unwrap() {
        let data = hex::decode(case["node"].as_str().unwrap()).unwrap();
        let node = crate::binary::unmarshal(&crate::binary::unpack(&data).unwrap()).unwrap();
        let info = harness.client.parse_message_info(&node).await.unwrap();
        assert_eq!(info.chat.to_string(), case["chat"].as_str().unwrap());
        assert_eq!(info.sender.to_string(), case["sender"].as_str().unwrap());
        assert_eq!(info.is_from_me, case["from_me"].as_bool().unwrap());
        assert_eq!(info.is_group, case["group"].as_bool().unwrap());
        assert_eq!(
            info.addressing_mode.as_str(),
            case["addressing_mode"].as_str().unwrap()
        );
        assert_eq!(
            info.sender_alt.to_string(),
            case["sender_alt"].as_str().unwrap()
        );
        assert_eq!(
            info.recipient_alt.to_string(),
            case["recipient_alt"].as_str().unwrap()
        );
        assert_eq!(info.id, case["id"].as_str().unwrap());
        assert_eq!(
            info.timestamp.unwrap().timestamp(),
            case["t"].as_i64().unwrap()
        );
        assert_eq!(info.push_name, case["push_name"].as_str().unwrap());
        assert_eq!(info.r#type, case["type"].as_str().unwrap());
        assert_eq!(info.edit.as_str(), case["edit"].as_str().unwrap());
        assert_eq!(info.media_type, case["media_type"].as_str().unwrap());
    }
    assert_eq!(
        hex::decode(vectors.string("unpadded")).unwrap(),
        unpad_message(b"abc\x03\x03\x03".to_vec(), 2).unwrap()
    );
}
