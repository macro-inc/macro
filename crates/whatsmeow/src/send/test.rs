// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Message type attributes, marshaling and participant hashes match
//! whatsmeow's (see `testdata/generator/inpackage/message_vectors_test.go`).

use super::*;
use crate::types::parse_jid;
use crate::vectors::Vectors;

#[test]
fn message_attributes_and_marshaling_match_go() {
    let vectors = Vectors::load("message.json");
    let to = parse_jid("777@lid").unwrap();
    let cases = vectors.value("types").as_array().unwrap();
    assert_eq!(cases.len(), 11);
    for case in cases {
        let raw = hex::decode(case["message"].as_str().unwrap()).unwrap();
        let message = wa_e2e::Message::decode(raw.as_slice()).unwrap();
        assert_eq!(message.encode_to_vec(), raw, "Rust encodes like Go");
        assert_eq!(
            get_type_from_message(&message),
            case["type"].as_str().unwrap()
        );
        assert_eq!(
            get_media_type_from_message(&message),
            case["media_type"].as_str().unwrap()
        );
        assert_eq!(
            get_edit_attribute(&message).as_str(),
            case["edit"].as_str().unwrap()
        );
        let (plaintext, device_sent) = marshal_message(&to, &message);
        assert_eq!(hex::encode(plaintext), case["plaintext"].as_str().unwrap());
        assert_eq!(
            hex::encode(device_sent.unwrap_or_default()),
            case["device_sent_plaintext"].as_str().unwrap()
        );
    }
}

#[test]
fn participant_hashes_match_go() {
    let vectors = Vectors::load("message.json");
    for case in vectors.value("hashes").as_array().unwrap() {
        let jids: Vec<Jid> = case["jids"]
            .as_array()
            .map(|jids| {
                jids.iter()
                    .map(|jid| parse_jid(jid.as_str().unwrap()).unwrap())
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(
            participant_list_hash_v2(&jids),
            case["hash"].as_str().unwrap()
        );
    }
}

#[test]
fn builders_match_go() {
    let vectors = Vectors::load("message.json");
    let own = parse_jid("1234:5@s.whatsapp.net").unwrap();
    let own_lid = parse_jid("9876:5@lid").unwrap();
    let group = parse_jid("120363000000000001@g.us").unwrap();
    let sender = parse_jid("777@lid").unwrap();
    let request = wa_e2e::Message {
        protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
            r#type: Some(protocol_message::Type::PeerDataOperationRequestMessage as i32),
            peer_data_operation_request_message: Some(wa_e2e::PeerDataOperationRequestMessage {
                peer_data_operation_request_type: Some(
                    PeerDataOperationRequestType::PlaceholderMessageResend as i32,
                ),
                placeholder_message_resend_request: vec![
                    peer_data_operation_request_message::PlaceholderMessageResendRequest {
                        message_key: Some(build_message_key_with(
                            &own, &own_lid, &group, &sender, "LOST",
                        )),
                    },
                ],
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    };
    assert_eq!(
        hex::encode(request.encode_to_vec()),
        vectors.string("unavailable_req")
    );
}

#[test]
fn message_ids_look_like_whatsapp_web_ids() {
    let own = parse_jid("1234:5@s.whatsapp.net").unwrap();
    let id = generate_message_id_with(&own, 1_700_000_000, &[7; 16]);
    assert_eq!(id.len(), 4 + 18);
    assert!(id.starts_with(WEB_MESSAGE_ID_PREFIX));
    assert_eq!(id, id.to_uppercase());
}

mod fake_server {
    use std::sync::Arc;

    use crate::binary::{AttributeValue, Node, NodeContent};
    use crate::client::test::{
        bytes, children, connect_paired, harness, jid, next_event, next_node, node, text,
    };
    use crate::prekeys::pre_key_to_node;
    use crate::proto::wa_e2e;
    use crate::send::SendRequestExtra;
    use crate::testing::{ServerConnection, attr_string, is_iq};
    use crate::types::events::Event;
    use crate::types::{SERVER_JID, parse_jid};
    use crate::util::keys::{new_key_pair, new_pre_key};

    const OWN: (&str, &str) = ("1234:5@s.whatsapp.net", "9876:5@lid");
    const GROUP: &str = "120363001234567890@g.us";

    fn usync_devices(users: &[(&str, &[&str])]) -> Node {
        node(
            "usync",
            &[],
            children(vec![node(
                "list",
                &[],
                children(
                    users
                        .iter()
                        .map(|(user, devices)| {
                            node(
                                "user",
                                &[("jid", jid(user))],
                                children(vec![node(
                                    "devices",
                                    &[],
                                    children(vec![node(
                                        "device-list",
                                        &[],
                                        children(
                                            devices
                                                .iter()
                                                .map(|id| node("device", &[("id", text(id))], None))
                                                .collect(),
                                        ),
                                    )]),
                                )]),
                            )
                        })
                        .collect(),
                ),
            )]),
        )
    }

    fn bundle_user(device: &str) -> Node {
        let identity = new_key_pair();
        let mut signed = new_pre_key(1);
        signed.signature = Some([9; 64]);
        node(
            "user",
            &[("jid", jid(device))],
            children(vec![
                node("registration", &[], bytes(&7_u32.to_be_bytes())),
                node("type", &[], bytes(&[5])),
                node("identity", &[], bytes(&identity.public)),
                pre_key_to_node(&new_pre_key(42)),
                pre_key_to_node(&signed),
            ]),
        )
    }

    fn requested_users(request: &Node) -> Vec<String> {
        request
            .get_child_by_tag(&["key"])
            .get_children()
            .iter()
            .map(|user| attr_string(user, "jid"))
            .collect()
    }

    /// Answers group info, usync and prekey requests until the message node
    /// arrives, and returns it.
    async fn serve_until_message(
        connection: &mut ServerConnection,
        devices: &[(&str, &[&str])],
    ) -> Node {
        loop {
            let request = next_node(connection).await;
            if request.tag == "message" {
                return request;
            }
            if is_iq(&request, "w:g2") {
                connection
                    .respond_iq(
                        &request,
                        vec![node(
                            "group",
                            &[
                                ("id", text("120363001234567890")),
                                ("subject", text("Team")),
                                ("addressing_mode", text("lid")),
                            ],
                            children(vec![
                                node(
                                    "participant",
                                    &[("jid", jid("1111@lid")), ("type", text("admin"))],
                                    None,
                                ),
                                node("participant", &[("jid", jid("2222@lid"))], None),
                                node("participant", &[("jid", jid("9876@lid"))], None),
                            ]),
                        )],
                    )
                    .await;
            } else if is_iq(&request, "usync") {
                connection
                    .respond_iq(&request, vec![usync_devices(devices)])
                    .await;
            } else if is_iq(&request, "encrypt") {
                let users = requested_users(&request);
                connection
                    .respond_iq(
                        &request,
                        vec![node(
                            "list",
                            &[],
                            children(users.iter().map(|user| bundle_user(user)).collect()),
                        )],
                    )
                    .await;
            } else if request.tag == "iq" {
                connection.respond_iq(&request, vec![]).await;
            }
        }
    }

    fn ack_for(message: &Node) -> Node {
        let mut attrs = vec![
            ("class", text("message")),
            ("id", AttributeValue::String(attr_string(message, "id"))),
            ("t", text("1700000500")),
            ("from", AttributeValue::Jid(SERVER_JID.clone())),
        ];
        let phash = attr_string(message, "phash");
        if !phash.is_empty() {
            attrs.push(("phash", AttributeValue::String(phash)));
        }
        node("ack", &attrs, None)
    }

    fn enc_children(to: &Node) -> Vec<&Node> {
        to.get_children()
            .iter()
            .filter(|child| child.tag == "enc")
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn a_group_message_fans_out_to_every_device_with_the_sender_key() {
        let mut harness = harness(Some(OWN));
        let mut connection = connect_paired(&mut harness).await;
        let client = Arc::clone(&harness.client);
        let send = tokio::spawn(async move {
            client
                .send_message(
                    &parse_jid(GROUP).unwrap(),
                    wa_e2e::Message {
                        conversation: Some("hello group".to_owned()),
                        ..Default::default()
                    },
                    SendRequestExtra::default(),
                )
                .await
        });
        let message = serve_until_message(
            &mut connection,
            &[
                ("1111@lid", &["0"]),
                ("2222@lid", &["0", "3"]),
                ("9876@lid", &["0", "5"]),
            ],
        )
        .await;
        assert_eq!(attr_string(&message, "to"), GROUP);
        assert_eq!(attr_string(&message, "type"), "text");
        assert_eq!(attr_string(&message, "addressing_mode"), "lid");
        let participants = message.get_child_by_tag(&["participants"]);
        let mut recipients: Vec<String> = participants
            .get_children()
            .iter()
            .map(|to| attr_string(to, "jid"))
            .collect();
        recipients.sort();
        assert_eq!(
            recipients,
            ["1111@lid", "2222:3@lid", "2222@lid", "9876@lid"]
        );
        for to in participants.get_children() {
            let encs = enc_children(to);
            assert_eq!(encs.len(), 1);
            assert_eq!(attr_string(encs[0], "type"), "pkmsg");
        }
        assert!(
            message
                .get_optional_child_by_tag(&["device-identity"])
                .is_some()
        );
        let skmsg = message
            .get_children()
            .iter()
            .find(|child| child.tag == "enc")
            .expect("group ciphertext");
        assert_eq!(attr_string(skmsg, "type"), "skmsg");
        let Some(NodeContent::Bytes(ciphertext)) = &skmsg.content else {
            panic!("skmsg has bytes");
        };
        let padded = ciphertext
            .strip_prefix(b"FAKEG")
            .expect("fake group ciphertext");
        let plaintext = crate::message::unpad_message(padded.to_vec(), 2).unwrap();
        assert_eq!(
            wa_e2e::Message::decode_from(&plaintext)
                .conversation
                .as_deref(),
            Some("hello group")
        );
        assert!(attr_string(&message, "phash").starts_with("2:"));

        connection.send_node(&ack_for(&message)).await;
        let response = send.await.unwrap().unwrap();
        assert_eq!(response.chat.to_string(), GROUP);
        assert_eq!(response.sender.to_string(), OWN.1);
        assert_eq!(response.timestamp.unwrap().timestamp(), 1_700_000_500);

        // The sessions now exist, so a second send needs no prekeys.
        let client = Arc::clone(&harness.client);
        let send = tokio::spawn(async move {
            client
                .send_message(
                    &parse_jid(GROUP).unwrap(),
                    wa_e2e::Message {
                        conversation: Some("again".to_owned()),
                        ..Default::default()
                    },
                    SendRequestExtra::default(),
                )
                .await
        });
        let message = next_node(&mut connection).await;
        assert_eq!(message.tag, "message", "group info and devices are cached");
        connection.send_node(&ack_for(&message)).await;
        send.await.unwrap().unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn a_direct_message_goes_to_the_lid_and_our_other_devices() {
        let mut harness = harness(Some(OWN));
        harness
            .client
            .store_lid_pn_mapping(
                &parse_jid("777@lid").unwrap(),
                &parse_jid("5550001@s.whatsapp.net").unwrap(),
            )
            .await;
        let mut connection = connect_paired(&mut harness).await;
        let client = Arc::clone(&harness.client);
        let send = tokio::spawn(async move {
            client
                .send_message(
                    &parse_jid("5550001@s.whatsapp.net").unwrap(),
                    wa_e2e::Message {
                        conversation: Some("hi".to_owned()),
                        ..Default::default()
                    },
                    SendRequestExtra {
                        id: "3EB0FIXED".to_owned(),
                        ..SendRequestExtra::default()
                    },
                )
                .await
        });
        let message = serve_until_message(
            &mut connection,
            &[("777@lid", &["0"]), ("9876@lid", &["0", "5", "7"])],
        )
        .await;
        assert_eq!(attr_string(&message, "id"), "3EB0FIXED");
        assert_eq!(attr_string(&message, "to"), "777@lid");
        assert_eq!(
            attr_string(&message, "peer_recipient_pn"),
            "5550001@s.whatsapp.net"
        );
        let mut recipients: Vec<String> = message
            .get_child_by_tag(&["participants"])
            .get_children()
            .iter()
            .map(|to| attr_string(to, "jid"))
            .collect();
        recipients.sort();
        assert_eq!(recipients, ["777@lid", "9876:7@lid", "9876@lid"]);
        connection.send_node(&ack_for(&message)).await;
        let response = send.await.unwrap().unwrap();
        assert_eq!(response.id, "3EB0FIXED");
        assert_eq!(response.chat.to_string(), "777@lid");
    }

    #[tokio::test(start_paused = true)]
    async fn a_retry_receipt_resends_the_message_to_that_device() {
        let mut harness = harness(Some(OWN));
        harness
            .client
            .store_lid_pn_mapping(
                &parse_jid("777@lid").unwrap(),
                &parse_jid("5550001@s.whatsapp.net").unwrap(),
            )
            .await;
        let mut connection = connect_paired(&mut harness).await;
        let client = Arc::clone(&harness.client);
        let send = tokio::spawn(async move {
            client
                .send_message(
                    &parse_jid("777@lid").unwrap(),
                    wa_e2e::Message {
                        conversation: Some("retry me".to_owned()),
                        ..Default::default()
                    },
                    SendRequestExtra {
                        id: "3EB0RETRY".to_owned(),
                        ..SendRequestExtra::default()
                    },
                )
                .await
        });
        let message = serve_until_message(
            &mut connection,
            &[("777@lid", &["0"]), ("9876@lid", &["0", "5"])],
        )
        .await;
        connection.send_node(&ack_for(&message)).await;
        send.await.unwrap().unwrap();

        connection
            .send_node(&node(
                "receipt",
                &[
                    ("from", jid("777@lid")),
                    ("id", text("3EB0RETRY")),
                    ("t", text("1700000600")),
                    ("type", text("retry")),
                ],
                children(vec![
                    node(
                        "retry",
                        &[
                            ("id", text("3EB0RETRY")),
                            ("t", text("1700000500")),
                            ("count", text("1")),
                            ("v", text("1")),
                        ],
                        None,
                    ),
                    node("registration", &[], bytes(&7_u32.to_be_bytes())),
                ]),
            ))
            .await;
        let mut resend = None;
        let mut acked = false;
        while resend.is_none() || !acked {
            let next = next_node(&mut connection).await;
            match next.tag.as_str() {
                "message" => resend = Some(next),
                "ack" => {
                    assert_eq!(attr_string(&next, "class"), "receipt");
                    acked = true;
                }
                _ => {}
            }
        }
        let resend = resend.unwrap();
        assert_eq!(attr_string(&resend, "id"), "3EB0RETRY");
        assert_eq!(attr_string(&resend, "to"), "777@lid");
        assert_eq!(attr_string(&resend, "device_fanout"), "false");
        let enc = resend.get_child_by_tag(&["enc"]);
        assert_eq!(attr_string(enc, "count"), "1");
        loop {
            if let Event::Receipt(receipt) = next_event(&mut harness.events).await {
                assert_eq!(receipt.message_ids, ["3EB0RETRY"]);
                break;
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_send_without_disconnect_retry_fails_instead_of_resending() {
        let mut harness = harness(Some(OWN));
        let mut connection = connect_paired(&mut harness).await;
        let client = Arc::clone(&harness.client);
        let send = tokio::spawn(async move {
            client
                .send_message(
                    &parse_jid("777@lid").unwrap(),
                    wa_e2e::Message {
                        conversation: Some("once".to_owned()),
                        ..Default::default()
                    },
                    SendRequestExtra {
                        no_disconnect_retry: true,
                        ..SendRequestExtra::default()
                    },
                )
                .await
        });
        let _message = serve_until_message(
            &mut connection,
            &[("777@lid", &["0"]), ("9876@lid", &["0", "5"])],
        )
        .await;
        connection.close().await;
        let error = send.await.unwrap().unwrap_err();
        assert!(
            matches!(error, crate::errors::ClientError::Disconnected(_)),
            "{error}"
        );
        loop {
            if let Event::Disconnected(_) = next_event(&mut harness.events).await {
                break;
            }
        }
    }

    trait DecodeFrom {
        fn decode_from(data: &[u8]) -> Self;
    }

    impl DecodeFrom for wa_e2e::Message {
        fn decode_from(data: &[u8]) -> Self {
            prost::Message::decode(data).unwrap()
        }
    }
}
