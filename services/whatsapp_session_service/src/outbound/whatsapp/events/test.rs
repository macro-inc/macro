use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;
use whatsapp_linked::domain::events::{InboundKind, MessageKind, Target};
use whatsmeow::Event;
use whatsmeow::proto::wa_common::MessageKey;
use whatsmeow::proto::wa_e2e;
use whatsmeow::proto::wa_e2e::protocol_message;
use whatsmeow::types::events::{Message, Receipt};
use whatsmeow::types::{MessageInfo, MessageSource};

use super::{LocatorMediaType, Mapped, MediaLocator, map_event};
use crate::domain::ports::SessionEvent;

const ACCOUNT: Uuid = Uuid::from_u128(7);

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 21, 12, 0, 0).unwrap()
}

fn group_message(id: &str, message: wa_e2e::Message) -> Event {
    Event::Message(Box::new(Message {
        info: MessageInfo {
            source: MessageSource {
                chat: "120363000000000001@g.us".parse().unwrap(),
                sender: "15550001111:3@s.whatsapp.net".parse().unwrap(),
                sender_alt: "987654321@lid".parse().unwrap(),
                is_group: true,
                ..MessageSource::default()
            },
            id: id.to_owned(),
            push_name: "Ada".to_owned(),
            timestamp: Some(Utc.with_ymd_and_hms(2026, 10, 21, 11, 59, 0).unwrap()),
            ..MessageInfo::default()
        },
        message: Some(message),
        ..Message::default()
    }))
}

/// Tests keep the locator readable; the adapter seals it with the account key.
fn plain_locator(locator: &MediaLocator) -> Option<Vec<u8>> {
    serde_json::to_vec(locator).ok()
}

fn inbound(event: Option<Mapped>) -> whatsapp_linked::domain::events::InboundEvent {
    match event {
        Some(Mapped::Inbound(event)) => *event,
        other => panic!("expected an inbound event, got {other:?}"),
    }
}

#[test]
fn a_group_text_becomes_a_message_from_its_author_with_a_stable_id() {
    let event = group_message(
        "3EB0AAAA",
        wa_e2e::Message {
            conversation: Some("hello".to_owned()),
            ..Default::default()
        },
    );

    let first = inbound(map_event(ACCOUNT, &event, now(), &plain_locator));
    let again = inbound(map_event(ACCOUNT, &event, now(), &plain_locator));

    assert_eq!(
        first.event_id, again.event_id,
        "redelivery keeps the event id"
    );
    assert_eq!(first.group_jid, "120363000000000001@g.us");
    let InboundKind::Message(message) = first.kind else {
        panic!("expected a message");
    };
    assert_eq!(message.source_id, "3EB0AAAA");
    assert_eq!(message.sender.jid, "15550001111@s.whatsapp.net");
    assert_eq!(
        message.sender.alternate_jid.as_deref(),
        Some("987654321@lid")
    );
    assert_eq!(message.sender.display_name.as_deref(), Some("Ada"));
    assert_eq!(message.kind, MessageKind::Text);
    assert_eq!(message.text, "hello");
    assert_eq!(message.target, None);
}

#[test]
fn a_quote_reaction_edit_and_delete_point_at_their_target() {
    let quote = inbound(map_event(
        ACCOUNT,
        &group_message(
            "3EB0B",
            wa_e2e::Message {
                extended_text_message: Some(Box::new(wa_e2e::ExtendedTextMessage {
                    text: Some("agreed".to_owned()),
                    context_info: Some(Box::new(wa_e2e::ContextInfo {
                        stanza_id: Some("3EB0A".to_owned()),
                        participant: Some("15552223333@s.whatsapp.net".to_owned()),
                        ..Default::default()
                    })),
                    ..Default::default()
                })),
                ..Default::default()
            },
        ),
        now(),
        &plain_locator,
    ));
    let reaction = inbound(map_event(
        ACCOUNT,
        &group_message(
            "3EB0C",
            wa_e2e::Message {
                reaction_message: Some(wa_e2e::ReactionMessage {
                    key: Some(MessageKey {
                        from_me: Some(true),
                        id: Some("3EB0B".to_owned()),
                        ..Default::default()
                    }),
                    text: Some("👍".to_owned()),
                    sender_timestamp_ms: Some(42),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ),
        now(),
        &plain_locator,
    ));
    let edit = inbound(map_event(
        ACCOUNT,
        &group_message(
            "3EB0D",
            wa_e2e::Message {
                protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
                    key: Some(MessageKey {
                        id: Some("3EB0B".to_owned()),
                        ..Default::default()
                    }),
                    r#type: Some(protocol_message::Type::MessageEdit as i32),
                    edited_message: Some(Box::new(wa_e2e::Message {
                        conversation: Some("agreed!".to_owned()),
                        ..Default::default()
                    })),
                    timestamp_ms: Some(1_000),
                    ..Default::default()
                })),
                ..Default::default()
            },
        ),
        now(),
        &plain_locator,
    ));
    let delete = inbound(map_event(
        ACCOUNT,
        &group_message(
            "3EB0E",
            wa_e2e::Message {
                protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
                    key: Some(MessageKey {
                        id: Some("3EB0B".to_owned()),
                        ..Default::default()
                    }),
                    r#type: Some(protocol_message::Type::Revoke as i32),
                    ..Default::default()
                })),
                ..Default::default()
            },
        ),
        now(),
        &plain_locator,
    ));

    let own_message = Target {
        source_id: "3EB0B".to_owned(),
        sender_jid: "15550001111@s.whatsapp.net".to_owned(),
    };
    let [quote, reaction, edit, delete] =
        [quote, reaction, edit, delete].map(|event| match event.kind {
            InboundKind::Message(message) => message,
            other => panic!("expected a message, got {other:?}"),
        });
    assert_eq!(quote.kind, MessageKind::Text);
    assert_eq!(
        quote.target,
        Some(Target {
            source_id: "3EB0A".to_owned(),
            sender_jid: "15552223333@s.whatsapp.net".to_owned(),
        })
    );
    assert_eq!(reaction.kind, MessageKind::Reaction);
    assert_eq!(reaction.text, "👍");
    assert_eq!(reaction.target.as_ref(), Some(&own_message));
    assert_eq!(edit.kind, MessageKind::Edit);
    assert_eq!(edit.text, "agreed!");
    assert_eq!(edit.revision, 1_000);
    assert_eq!(edit.target.as_ref(), Some(&own_message));
    assert_eq!(delete.kind, MessageKind::Delete);
    assert_eq!(delete.target.as_ref(), Some(&own_message));
}

#[test]
fn media_becomes_a_placeholder_and_direct_chats_are_ignored() {
    let media = inbound(map_event(
        ACCOUNT,
        &group_message(
            "3EB0F",
            wa_e2e::Message {
                image_message: Some(Box::default()),
                ..Default::default()
            },
        ),
        now(),
        &plain_locator,
    ));
    let InboundKind::Message(media) = media.kind else {
        panic!("expected a message");
    };
    assert_eq!(media.kind, MessageKind::Unsupported);

    let direct = Event::Message(Box::new(Message {
        info: MessageInfo {
            source: MessageSource {
                chat: "15552223333@s.whatsapp.net".parse().unwrap(),
                sender: "15552223333@s.whatsapp.net".parse().unwrap(),
                ..MessageSource::default()
            },
            id: "3EB0G".to_owned(),
            ..MessageInfo::default()
        },
        message: Some(wa_e2e::Message {
            conversation: Some("private".to_owned()),
            ..Default::default()
        }),
        ..Message::default()
    }));
    assert!(map_event(ACCOUNT, &direct, now(), &plain_locator).is_none());
}

#[test]
fn a_group_read_receipt_names_the_participant_and_messages() {
    let event = Event::Receipt(Receipt {
        source: MessageSource {
            chat: "120363000000000001@g.us".parse().unwrap(),
            sender: "15552223333:1@s.whatsapp.net".parse().unwrap(),
            is_group: true,
            ..MessageSource::default()
        },
        message_ids: vec!["3EB0A".to_owned(), "3EB0B".to_owned()],
        r#type: whatsmeow::types::ReceiptType::Read,
        ..Receipt::default()
    });

    let InboundKind::Receipt(receipt) =
        inbound(map_event(ACCOUNT, &event, now(), &plain_locator)).kind
    else {
        panic!("expected a receipt");
    };
    assert_eq!(receipt.participant_jid, "15552223333@s.whatsapp.net");
    assert_eq!(receipt.source_ids, vec!["3EB0A", "3EB0B"]);
    assert_eq!(receipt.state, "read");
}

#[test]
fn a_sender_key_distribution_alone_is_not_a_message() {
    let keys_only = group_message(
        "3EB0SAME",
        wa_e2e::Message {
            sender_key_distribution_message: Some(wa_e2e::SenderKeyDistributionMessage {
                group_id: Some("120363000000000001@g.us".to_owned()),
                axolotl_sender_key_distribution_message: Some(vec![1, 2, 3]),
            }),
            message_context_info: Some(wa_e2e::MessageContextInfo::default()),
            ..Default::default()
        },
    );
    let content = group_message(
        "3EB0SAME",
        wa_e2e::Message {
            conversation: Some("first message".to_owned()),
            sender_key_distribution_message: Some(wa_e2e::SenderKeyDistributionMessage::default()),
            ..Default::default()
        },
    );

    assert!(map_event(ACCOUNT, &keys_only, now(), &plain_locator).is_none());
    let InboundKind::Message(message) =
        inbound(map_event(ACCOUNT, &content, now(), &plain_locator)).kind
    else {
        panic!("expected a message");
    };
    assert_eq!(message.kind, MessageKind::Text);
    assert_eq!(message.text, "first message");
}

#[test]
fn an_image_becomes_an_attachment_with_its_caption_and_locator() {
    let event = group_message(
        "3EB0IMG",
        wa_e2e::Message {
            image_message: Some(Box::new(wa_e2e::ImageMessage {
                direct_path: Some("/v/t62/abc".to_owned()),
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(1234),
                mimetype: Some("image/jpeg".to_owned()),
                caption: Some("look".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        },
    );

    let InboundKind::Message(message) =
        inbound(map_event(ACCOUNT, &event, now(), &plain_locator)).kind
    else {
        panic!("expected a message");
    };
    assert_eq!(message.kind, MessageKind::Text);
    assert_eq!(message.text, "look");
    assert_eq!(message.media.len(), 1);
    let media = &message.media[0];
    assert_eq!(media.mime, "image/jpeg");
    assert_eq!(media.filename, "image.jpeg");
    assert_eq!(media.size, 1234);
    assert_eq!(media.sha256, [3; 32]);
    let locator: MediaLocator = serde_json::from_slice(&media.locator).unwrap();
    assert_eq!(
        locator,
        MediaLocator {
            direct_path: "/v/t62/abc".to_owned(),
            media_key: vec![1; 32],
            file_enc_sha256: vec![2; 32],
            file_sha256: vec![3; 32],
            media_type: LocatorMediaType::Image,
        }
    );
}

#[test]
fn an_attachment_that_cannot_be_sealed_becomes_a_placeholder() {
    let event = group_message(
        "3EB0DOC",
        wa_e2e::Message {
            document_message: Some(Box::new(wa_e2e::DocumentMessage {
                direct_path: Some("/v/t62/doc".to_owned()),
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(10),
                mimetype: Some("application/pdf".to_owned()),
                file_name: Some("plan.pdf".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        },
    );

    let InboundKind::Message(message) = inbound(map_event(ACCOUNT, &event, now(), &|_| None)).kind
    else {
        panic!("expected a message");
    };
    assert_eq!(message.kind, MessageKind::Unsupported);
    assert!(message.media.is_empty());
}

#[test]
fn passkey_requests_carry_the_challenge_and_handoff_confirmations_their_code() {
    let request =
        Event::PairPasskeyRequest(Box::new(whatsmeow::types::events::PairPasskeyRequest {
            public_key: whatsmeow::types::WebAuthnPublicKey {
                relying_party_id: "whatsapp.com".to_owned(),
                ..Default::default()
            },
        }));
    let Some(Mapped::Session(SessionEvent::PasskeyRequested { challenge })) =
        map_event(ACCOUNT, &request, now(), &plain_locator)
    else {
        panic!("expected a passkey request");
    };
    assert_eq!(challenge["rpId"], "whatsapp.com");

    let shown = Event::PairPasskeyConfirmation(whatsmeow::types::events::PairPasskeyConfirmation {
        code: "123456".to_owned(),
        skip_handoff_ux: false,
    });
    assert!(matches!(
        map_event(ACCOUNT, &shown, now(), &plain_locator),
        Some(Mapped::Session(SessionEvent::PasskeyConfirmation { code })) if code == "123456"
    ));
    let automatic =
        Event::PairPasskeyConfirmation(whatsmeow::types::events::PairPasskeyConfirmation {
            code: "123456".to_owned(),
            skip_handoff_ux: true,
        });
    assert!(map_event(ACCOUNT, &automatic, now(), &plain_locator).is_none());
}

#[test]
fn joining_carries_the_group_and_info_changes_name_only_the_group() {
    let group: whatsmeow::types::Jid = "120363000000000001@g.us".parse().unwrap();
    let joined = Event::JoinedGroup(Box::new(whatsmeow::types::events::JoinedGroup {
        reason: String::new(),
        r#type: String::new(),
        create_key: String::new(),
        sender: None,
        sender_pn: None,
        notify: String::new(),
        group_info: whatsmeow::types::GroupInfo {
            jid: group.clone(),
            name: whatsmeow::types::GroupName {
                name: "Launch".to_owned(),
                ..Default::default()
            },
            ..Default::default()
        },
    }));
    match map_event(ACCOUNT, &joined, now(), &plain_locator) {
        Some(Mapped::Session(SessionEvent::GroupChanged {
            group_jid,
            info: Some(info),
        })) => {
            assert_eq!(group_jid, "120363000000000001@g.us");
            assert_eq!(info.name, "Launch");
            assert_eq!(info.observed_at, now());
        }
        other => panic!("expected a joined group, got {other:?}"),
    }
    let renamed = Event::GroupInfo(Box::new(whatsmeow::types::events::GroupInfo {
        jid: group,
        ..Default::default()
    }));
    match map_event(ACCOUNT, &renamed, now(), &plain_locator) {
        Some(Mapped::Session(SessionEvent::GroupChanged {
            group_jid,
            info: None,
        })) => assert_eq!(group_jid, "120363000000000001@g.us"),
        other => panic!("expected a group change, got {other:?}"),
    }
}
