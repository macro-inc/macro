use chrono::{DateTime, TimeZone, Utc};
use external_chat::domain::models::MediaPresentation;
use external_chat::domain::rich::{
    Call, CallOutcome, PollVote, RichContent, SystemAction, SystemLine,
};
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    InboundKind, Message as InboundMessage, MessageKind, ReceiptState, Target,
};
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

fn inbound(mapped: Vec<Mapped>) -> whatsapp_linked::domain::events::InboundEvent {
    match <[Mapped; 1]>::try_from(mapped) {
        Ok([Mapped::Inbound(event)]) => *event,
        other => panic!("expected one inbound event, got {other:?}"),
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
fn media_becomes_a_placeholder_and_status_updates_are_ignored() {
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

    let status = Event::Message(Box::new(Message {
        info: MessageInfo {
            source: MessageSource {
                chat: "status@broadcast".parse().unwrap(),
                sender: "15552223333@s.whatsapp.net".parse().unwrap(),
                ..MessageSource::default()
            },
            id: "3EB0G".to_owned(),
            ..MessageInfo::default()
        },
        message: Some(wa_e2e::Message {
            conversation: Some("my status".to_owned()),
            ..Default::default()
        }),
        ..Message::default()
    }));
    assert!(map_event(ACCOUNT, &status, now(), &plain_locator).is_empty());
}

fn direct_message(source: MessageSource, text: &str) -> Event {
    Event::Message(Box::new(Message {
        info: MessageInfo {
            source,
            id: "3EB0DM".to_owned(),
            timestamp: Some(Utc.with_ymd_and_hms(2026, 10, 21, 11, 59, 0).unwrap()),
            ..MessageInfo::default()
        },
        message: Some(wa_e2e::Message {
            conversation: Some(text.to_owned()),
            ..Default::default()
        }),
        ..Message::default()
    }))
}

#[test]
fn a_direct_chat_goes_by_the_persons_number_with_their_lid_alongside() {
    // WhatsApp addresses the chat by LID and names the number alongside.
    let by_lid = inbound(map_event(
        ACCOUNT,
        &direct_message(
            MessageSource {
                chat: "987654321@lid".parse().unwrap(),
                sender: "987654321@lid".parse().unwrap(),
                sender_alt: "15552223333@s.whatsapp.net".parse().unwrap(),
                ..MessageSource::default()
            },
            "hi",
        ),
        now(),
        &plain_locator,
    ));
    assert_eq!(
        (
            by_lid.group_jid.as_str(),
            by_lid.chat_alternate_jid.as_deref()
        ),
        ("15552223333@s.whatsapp.net", Some("987654321@lid"))
    );
    // Our own message from the phone names the recipient's other address.
    let own = inbound(map_event(
        ACCOUNT,
        &direct_message(
            MessageSource {
                chat: "15552223333@s.whatsapp.net".parse().unwrap(),
                sender: "15550000001@s.whatsapp.net".parse().unwrap(),
                recipient_alt: "987654321@lid".parse().unwrap(),
                is_from_me: true,
                ..MessageSource::default()
            },
            "on it",
        ),
        now(),
        &plain_locator,
    ));
    assert_eq!(
        (own.group_jid.as_str(), own.chat_alternate_jid.as_deref()),
        ("15552223333@s.whatsapp.net", Some("987654321@lid"))
    );
    let InboundKind::Message(message) = own.kind else {
        panic!("expected a message");
    };
    assert!(message.from_me);
    // Without the other address, the chat stays as addressed.
    let bare = inbound(map_event(
        ACCOUNT,
        &direct_message(
            MessageSource {
                chat: "987654321@lid".parse().unwrap(),
                sender: "987654321@lid".parse().unwrap(),
                ..MessageSource::default()
            },
            "hello",
        ),
        now(),
        &plain_locator,
    ));
    assert_eq!(
        (bare.group_jid.as_str(), bare.chat_alternate_jid),
        ("987654321@lid", None)
    );
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
    assert_eq!(receipt.state, ReceiptState::Read);
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

    assert!(map_event(ACCOUNT, &keys_only, now(), &plain_locator).is_empty());
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
        map_event(ACCOUNT, &request, now(), &plain_locator).pop()
    else {
        panic!("expected a passkey request");
    };
    assert_eq!(challenge["rpId"], "whatsapp.com");

    let shown = Event::PairPasskeyConfirmation(whatsmeow::types::events::PairPasskeyConfirmation {
        code: "123456".to_owned(),
        skip_handoff_ux: false,
    });
    assert!(matches!(
        map_event(ACCOUNT, &shown, now(), &plain_locator).pop(),
        Some(Mapped::Session(SessionEvent::PasskeyConfirmation { code })) if code == "123456"
    ));
    let automatic =
        Event::PairPasskeyConfirmation(whatsmeow::types::events::PairPasskeyConfirmation {
            code: "123456".to_owned(),
            skip_handoff_ux: true,
        });
    assert!(map_event(ACCOUNT, &automatic, now(), &plain_locator).is_empty());
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
    match map_event(ACCOUNT, &joined, now(), &plain_locator).pop() {
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
    match map_event(ACCOUNT, &renamed, now(), &plain_locator).pop() {
        Some(Mapped::Session(SessionEvent::GroupChanged {
            group_jid,
            info: None,
        })) => assert_eq!(group_jid, "120363000000000001@g.us"),
        other => panic!("expected a group change, got {other:?}"),
    }
}

fn lid_message(id: &str, sender: &str, from_me: bool) -> Event {
    Event::Message(Box::new(Message {
        info: MessageInfo {
            source: MessageSource {
                chat: "120363000000000001@g.us".parse().unwrap(),
                sender: sender.parse().unwrap(),
                is_from_me: from_me,
                is_group: true,
                ..MessageSource::default()
            },
            id: id.to_owned(),
            push_name: "Wolf".to_owned(),
            timestamp: Some(Utc.with_ymd_and_hms(2026, 10, 21, 11, 59, 0).unwrap()),
            ..MessageInfo::default()
        },
        message: Some(wa_e2e::Message {
            conversation: Some("Hi there".to_owned()),
            ..Default::default()
        }),
        ..Message::default()
    }))
}

fn sender_of(event: &whatsapp_linked::domain::events::InboundEvent) -> (&str, Option<&str>, bool) {
    let InboundKind::Message(message) = &event.kind else {
        panic!("expected a message");
    };
    (
        message.sender.jid.as_str(),
        message.sender.alternate_jid.as_deref(),
        message.from_me,
    )
}

#[tokio::test]
async fn a_message_from_me_addressed_by_lid_carries_the_from_me_flag_and_own_pair() {
    let lids = whatsmeow::store::MemoryStore::default();
    whatsmeow::store::LidStore::put_lid_mapping(
        &lids,
        &"53949570789492@lid".parse().unwrap(),
        &"12127679653@s.whatsapp.net".parse().unwrap(),
    )
    .await
    .unwrap();
    let mut event = inbound(map_event(
        ACCOUNT,
        &lid_message("3EB0F001", "53949570789492:12@lid", true),
        now(),
        &plain_locator,
    ));

    super::complete_sender(&lids, &mut event).await.unwrap();

    assert_eq!(
        sender_of(&event),
        (
            "53949570789492@lid",
            Some("12127679653@s.whatsapp.net"),
            true
        )
    );
}

#[tokio::test]
async fn another_member_addressed_only_by_lid_is_paired_from_the_lid_store() {
    let lids = whatsmeow::store::MemoryStore::default();
    whatsmeow::store::LidStore::put_lid_mapping(
        &lids,
        &"987654321@lid".parse().unwrap(),
        &"15550001111@s.whatsapp.net".parse().unwrap(),
    )
    .await
    .unwrap();
    let mut known = inbound(map_event(
        ACCOUNT,
        &lid_message("3EB0F002", "987654321@lid", false),
        now(),
        &plain_locator,
    ));
    let mut unknown = inbound(map_event(
        ACCOUNT,
        &lid_message("3EB0F003", "111222333@lid", false),
        now(),
        &plain_locator,
    ));

    super::complete_sender(&lids, &mut known).await.unwrap();
    super::complete_sender(&lids, &mut unknown).await.unwrap();

    assert_eq!(
        sender_of(&known),
        ("987654321@lid", Some("15550001111@s.whatsapp.net"), false)
    );
    assert_eq!(sender_of(&unknown), ("111222333@lid", None, false));
}

#[test]
fn a_live_message_moves_its_chat_up_with_the_message_as_anchor() {
    let Event::Message(message) = group_message(
        "3EB0C001",
        wa_e2e::Message {
            conversation: Some("hello".to_owned()),
            ..Default::default()
        },
    ) else {
        unreachable!()
    };

    let chat = super::message_chat(&message).expect("a chat update");

    assert_eq!(chat.jid, "120363000000000001@g.us");
    assert_eq!(
        chat.kind,
        external_chat::domain::models::ExternalChatKind::Group
    );
    assert_eq!(chat.name, None, "groups are named by their roster");
    assert!(chat.create);
    let anchor = chat.anchor.expect("an anchor");
    assert_eq!(
        (
            anchor.id.as_str(),
            anchor.from_me,
            anchor.sender_jid.as_deref()
        ),
        ("3EB0C001", false, Some("15550001111@s.whatsapp.net"))
    );
}

fn quoting(stanza: &str) -> Option<Box<wa_e2e::ContextInfo>> {
    Some(Box::new(wa_e2e::ContextInfo {
        stanza_id: Some(stanza.to_owned()),
        participant: Some("15550002222@s.whatsapp.net".to_owned()),
        ..Default::default()
    }))
}

fn media_message(event: &Event) -> whatsapp_linked::domain::events::Message {
    let InboundKind::Message(message) =
        inbound(map_event(ACCOUNT, event, now(), &plain_locator)).kind
    else {
        panic!("expected a message");
    };
    message
}

#[test]
fn a_reply_that_carries_media_keeps_its_quote() {
    let event = group_message(
        "3EB0REPLYIMG",
        wa_e2e::Message {
            image_message: Some(Box::new(wa_e2e::ImageMessage {
                direct_path: Some("/v/t62/reply".to_owned()),
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(10),
                mimetype: Some("image/jpeg".to_owned()),
                context_info: quoting("3EB0ORIGINAL"),
                ..Default::default()
            })),
            ..Default::default()
        },
    );

    let message = media_message(&event);

    assert_eq!(message.media.len(), 1);
    assert_eq!(
        message.target,
        Some(Target {
            source_id: "3EB0ORIGINAL".to_owned(),
            sender_jid: "15550002222@s.whatsapp.net".to_owned(),
        })
    );
}

#[test]
fn images_and_videos_carry_their_size_and_length() {
    let image = media_message(&group_message(
        "3EB0DIMS",
        wa_e2e::Message {
            image_message: Some(Box::new(wa_e2e::ImageMessage {
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(10),
                mimetype: Some("image/jpeg".to_owned()),
                width: Some(1080),
                height: Some(1920),
                ..Default::default()
            })),
            ..Default::default()
        },
    ));
    let video = media_message(&group_message(
        "3EB0VIDEO",
        wa_e2e::Message {
            video_message: Some(Box::new(wa_e2e::VideoMessage {
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(10),
                mimetype: Some("video/mp4".to_owned()),
                width: Some(640),
                height: Some(360),
                seconds: Some(42),
                ..Default::default()
            })),
            ..Default::default()
        },
    ));

    let image = &image.media[0];
    assert_eq!((image.width, image.height), (Some(1080), Some(1920)));
    assert_eq!(image.duration_seconds, None);
    assert_eq!(image.presentation, None);
    let video = &video.media[0];
    assert_eq!((video.width, video.height), (Some(640), Some(360)));
    assert_eq!(video.duration_seconds, Some(42));
    assert_eq!(video.presentation, None);
}

#[test]
fn stickers_gifs_and_voice_notes_say_how_whatsapp_shows_them() {
    let sticker = media_message(&group_message(
        "3EB0STICKER",
        wa_e2e::Message {
            sticker_message: Some(Box::new(wa_e2e::StickerMessage {
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(10),
                mimetype: Some("image/webp".to_owned()),
                width: Some(512),
                height: Some(512),
                is_animated: Some(true),
                ..Default::default()
            })),
            ..Default::default()
        },
    ));
    let gif = media_message(&group_message(
        "3EB0GIF",
        wa_e2e::Message {
            video_message: Some(Box::new(wa_e2e::VideoMessage {
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(10),
                mimetype: Some("video/mp4".to_owned()),
                gif_playback: Some(true),
                seconds: Some(3),
                ..Default::default()
            })),
            ..Default::default()
        },
    ));
    let voice = media_message(&group_message(
        "3EB0PTT",
        wa_e2e::Message {
            audio_message: Some(Box::new(wa_e2e::AudioMessage {
                media_key: Some(vec![1; 32]),
                file_enc_sha256: Some(vec![2; 32]),
                file_sha256: Some(vec![3; 32]),
                file_length: Some(10),
                mimetype: Some("audio/ogg; codecs=opus".to_owned()),
                ptt: Some(true),
                seconds: Some(7),
                ..Default::default()
            })),
            ..Default::default()
        },
    ));

    assert_eq!(sticker.text, "");
    let sticker = &sticker.media[0];
    assert_eq!(sticker.presentation, Some(MediaPresentation::Sticker));
    assert_eq!(sticker.mime, "image/webp");
    assert_eq!(sticker.filename, "sticker.webp");
    assert_eq!((sticker.width, sticker.height), (Some(512), Some(512)));
    let gif = &gif.media[0];
    assert_eq!(gif.presentation, Some(MediaPresentation::Gif));
    let voice = &voice.media[0];
    assert_eq!(voice.presentation, Some(MediaPresentation::VoiceNote));
    assert_eq!(voice.mime, "audio/ogg");
    assert_eq!(voice.duration_seconds, Some(7));
}

fn rich_message(id: &str, message: wa_e2e::Message) -> whatsapp_linked::domain::events::Message {
    let InboundKind::Message(message) = inbound(map_event(
        ACCOUNT,
        &group_message(id, message),
        now(),
        &plain_locator,
    ))
    .kind
    else {
        panic!("expected a message");
    };
    message
}

#[test]
fn a_mention_and_forwarding_carry_through_from_the_context() {
    let message = rich_message(
        "3EB0MENTION",
        wa_e2e::Message {
            extended_text_message: Some(Box::new(wa_e2e::ExtendedTextMessage {
                text: Some("hi @15550002222".to_owned()),
                context_info: Some(Box::new(wa_e2e::ContextInfo {
                    mentioned_jid: vec!["15550002222@s.whatsapp.net".to_owned()],
                    is_forwarded: Some(true),
                    ..Default::default()
                })),
                ..Default::default()
            })),
            ..Default::default()
        },
    );

    assert_eq!(message.kind, MessageKind::Text);
    assert_eq!(message.mentions, vec!["15550002222@s.whatsapp.net"]);
    assert!(message.forwarded);
    assert_eq!(message.target, None);
}

#[test]
fn polls_locations_contacts_and_events_become_rich_messages() {
    let poll = rich_message(
        "3EB0POLL",
        wa_e2e::Message {
            poll_creation_message_v3: Some(Box::new(wa_e2e::PollCreationMessage {
                name: Some("Lunch?".to_owned()),
                options: vec![
                    wa_e2e::poll_creation_message::Option {
                        option_name: Some("Pizza".to_owned()),
                        ..Default::default()
                    },
                    wa_e2e::poll_creation_message::Option {
                        option_name: Some("Sushi".to_owned()),
                        ..Default::default()
                    },
                ],
                selectable_options_count: Some(1),
                ..Default::default()
            })),
            ..Default::default()
        },
    );
    let place = rich_message(
        "3EB0PLACE",
        wa_e2e::Message {
            location_message: Some(Box::new(wa_e2e::LocationMessage {
                degrees_latitude: Some(40.7),
                degrees_longitude: Some(-74.0),
                name: Some("Office".to_owned()),
                address: Some("1 Main St".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        },
    );
    let card = rich_message(
        "3EB0CARD",
        wa_e2e::Message {
            contact_message: Some(Box::new(wa_e2e::ContactMessage {
                display_name: Some("Ada".to_owned()),
                vcard: Some(
                    "BEGIN:VCARD\nFN:Ada Lovelace\nTEL;waid=15550001111:+1 555 000 1111\nEND:VCARD"
                        .to_owned(),
                ),
                ..Default::default()
            })),
            ..Default::default()
        },
    );
    let event = rich_message(
        "3EB0EVENT",
        wa_e2e::Message {
            event_message: Some(Box::new(wa_e2e::EventMessage {
                name: Some("Launch party".to_owned()),
                start_time: Some(1_793_000_000),
                join_link: Some("https://call.whatsapp.com/x".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        },
    );

    assert_eq!(poll.kind, MessageKind::Rich);
    let Some(RichContent::Poll(poll)) = poll.rich else {
        panic!("expected a poll");
    };
    assert_eq!(poll.question, "Lunch?");
    assert_eq!(poll.selectable_count, 1);
    assert_eq!(
        poll.options
            .iter()
            .map(|option| option.name.as_str())
            .collect::<Vec<_>>(),
        ["Pizza", "Sushi"]
    );
    use sha2::Digest;
    let pizza: String = sha2::Sha256::digest(b"Pizza")
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(
        poll.options[0].hash, pizza,
        "votes name options by this hash"
    );
    let Some(RichContent::Location(place)) = place.rich else {
        panic!("expected a location");
    };
    assert_eq!((place.latitude, place.longitude), (40.7, -74.0));
    assert_eq!(place.name.as_deref(), Some("Office"));
    assert!(!place.live);
    let Some(RichContent::Contacts(cards)) = card.rich else {
        panic!("expected contacts");
    };
    assert_eq!(cards.contacts[0].name, "Ada");
    assert_eq!(cards.contacts[0].phones, vec!["+1 555 000 1111"]);
    let Some(RichContent::Event(event)) = event.rich else {
        panic!("expected an event");
    };
    assert_eq!(event.name, "Launch party");
    assert_eq!(event.start_at.map(|at| at.timestamp()), Some(1_793_000_000));
    assert_eq!(
        event.join_link.as_deref(),
        Some("https://call.whatsapp.com/x")
    );
}

#[test]
fn pins_and_call_logs_become_system_lines() {
    let pin = rich_message(
        "3EB0PIN",
        wa_e2e::Message {
            pin_in_chat_message: Some(wa_e2e::PinInChatMessage {
                key: Some(MessageKey {
                    id: Some("3EB0PINNED".to_owned()),
                    participant: Some("15550002222@s.whatsapp.net".to_owned()),
                    ..Default::default()
                }),
                r#type: Some(wa_e2e::pin_in_chat_message::Type::PinForAll as i32),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    let call = rich_message(
        "3EB0CALL",
        wa_e2e::Message {
            call_log_messsage: Some(wa_e2e::CallLogMessage {
                is_video: Some(true),
                call_outcome: Some(wa_e2e::call_log_message::CallOutcome::Missed as i32),
                ..Default::default()
            }),
            ..Default::default()
        },
    );

    assert_eq!(pin.kind, MessageKind::System);
    assert_eq!(
        pin.target,
        Some(Target {
            source_id: "3EB0PINNED".to_owned(),
            sender_jid: "15550002222@s.whatsapp.net".to_owned(),
        })
    );
    let Some(RichContent::System(line)) = pin.rich else {
        panic!("expected a system line");
    };
    assert_eq!(line.action, SystemAction::MessagePinned);
    assert_eq!(call.kind, MessageKind::System);
    let Some(RichContent::System(line)) = call.rich else {
        panic!("expected a system line");
    };
    assert_eq!(line.action, SystemAction::Call);
    assert_eq!(
        line.call,
        Some(Call {
            video: true,
            outcome: CallOutcome::Missed,
            duration_seconds: None,
        })
    );
}

#[test]
fn view_once_media_is_kept_like_any_media_and_marked() {
    let image = |view_once_flag: Option<bool>| wa_e2e::Message {
        image_message: Some(Box::new(wa_e2e::ImageMessage {
            direct_path: Some("/v/once".to_owned()),
            media_key: Some(vec![1; 32]),
            file_enc_sha256: Some(vec![2; 32]),
            file_sha256: Some(vec![3; 32]),
            file_length: Some(10),
            mimetype: Some("image/jpeg".to_owned()),
            caption: Some("just once".to_owned()),
            view_once: view_once_flag,
            ..Default::default()
        })),
        ..Default::default()
    };
    // Unwrapped from a view-once wrapper by the port.
    let mut wrapped = group_message("3EB0ONCE", image(None));
    if let Event::Message(message) = &mut wrapped {
        message.is_view_once = true;
    }
    // Flagged on the media itself.
    let flagged = group_message("3EB0ONCE2", image(Some(true)));

    for event in [wrapped, flagged] {
        let message = media_message(&event);
        assert_eq!(message.kind, MessageKind::Text);
        assert_eq!(message.text, "just once");
        assert_eq!(message.media.len(), 1, "the image is imported");
        assert!(message.view_once);
    }
    assert!(!media_message(&group_message("3EB0PLAIN", image(None))).view_once);
}

#[test]
fn a_poll_vote_targets_its_poll_with_the_chosen_option_hashes() {
    let event = group_message(
        "3EB0VOTE",
        wa_e2e::Message {
            poll_update_message: Some(wa_e2e::PollUpdateMessage {
                poll_creation_message_key: Some(MessageKey {
                    id: Some("3EB0POLL".to_owned()),
                    participant: Some("15550002222@s.whatsapp.net".to_owned()),
                    ..Default::default()
                }),
                sender_timestamp_ms: Some(1_000),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    let Event::Message(message) = &event else {
        unreachable!()
    };

    assert!(
        map_event(ACCOUNT, &event, now(), &plain_locator).is_empty(),
        "an encrypted vote is mapped once decrypted"
    );
    let vote = super::map_poll_vote(ACCOUNT, message, &[vec![0xab, 0x01]], now()).unwrap();
    let InboundKind::Message(vote) = vote.kind else {
        panic!("expected a message");
    };
    assert_eq!(vote.kind, MessageKind::PollVote);
    assert_eq!(vote.revision, 1_000);
    assert_eq!(
        vote.target,
        Some(Target {
            source_id: "3EB0POLL".to_owned(),
            sender_jid: "15550002222@s.whatsapp.net".to_owned(),
        })
    );
    assert_eq!(
        vote.rich,
        Some(RichContent::PollVote(PollVote {
            selected: vec!["ab01".to_owned()],
        }))
    );
}

#[test]
fn group_notifications_become_system_lines_by_who_did_them() {
    let group: whatsmeow::types::Jid = "120363000000000001@g.us".parse().unwrap();
    let ana: whatsmeow::types::Jid = "15550001111@s.whatsapp.net".parse().unwrap();
    let ben: whatsmeow::types::Jid = "15550002222@s.whatsapp.net".parse().unwrap();
    let change = Event::GroupInfo(Box::new(whatsmeow::types::events::GroupInfo {
        jid: group.clone(),
        sender: Some(ana.clone()),
        timestamp: Some(now()),
        name: Some(whatsmeow::types::GroupName {
            name: "Launch".to_owned(),
            ..Default::default()
        }),
        join: vec![ben.clone()],
        ..Default::default()
    }));
    let left = Event::GroupInfo(Box::new(whatsmeow::types::events::GroupInfo {
        jid: group.clone(),
        sender: Some(ben.clone()),
        timestamp: Some(now()),
        leave: vec![ben.clone()],
        ..Default::default()
    }));

    let mapped = map_event(ACCOUNT, &change, now(), &plain_locator);
    let again = map_event(ACCOUNT, &change, now(), &plain_locator);

    assert!(matches!(
        mapped.first(),
        Some(Mapped::Session(SessionEvent::GroupChanged {
            info: None,
            ..
        }))
    ));
    let lines: Vec<(String, String, SystemLine)> = mapped
        .into_iter()
        .filter_map(|mapped| match mapped {
            Mapped::Inbound(event) => match event.kind {
                InboundKind::Message(InboundMessage {
                    source_id,
                    sender,
                    kind: MessageKind::System,
                    rich: Some(RichContent::System(line)),
                    ..
                }) => Some((source_id, sender.jid, line)),
                _ => None,
            },
            Mapped::Session(_) => None,
        })
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].1, "15550001111@s.whatsapp.net");
    assert_eq!(lines[0].2.action, SystemAction::SubjectChanged);
    assert_eq!(lines[0].2.value.as_deref(), Some("Launch"));
    assert_eq!(lines[1].2.action, SystemAction::ParticipantsAdded);
    assert_eq!(lines[1].2.participants, vec!["15550002222@s.whatsapp.net"]);
    assert_ne!(lines[0].0, lines[1].0, "each line has its own id");
    let again_ids: Vec<String> = again
        .into_iter()
        .filter_map(|mapped| match mapped {
            Mapped::Inbound(event) => match event.kind {
                InboundKind::Message(message) => Some(message.source_id),
                _ => None,
            },
            Mapped::Session(_) => None,
        })
        .collect();
    assert_eq!(again_ids, vec![lines[0].0.clone(), lines[1].0.clone()]);
    let other_account: Vec<String> = map_event(Uuid::from_u128(8), &change, now(), &plain_locator)
        .into_iter()
        .filter_map(|mapped| match mapped {
            Mapped::Inbound(event) => match event.kind {
                InboundKind::Message(message) => Some(message.source_id),
                _ => None,
            },
            Mapped::Session(_) => None,
        })
        .collect();
    assert_eq!(
        other_account, again_ids,
        "every account that sees the change names it the same"
    );
    let left = map_event(ACCOUNT, &left, now(), &plain_locator);
    let Some(Mapped::Inbound(event)) = left.last() else {
        panic!("expected a system line");
    };
    let InboundKind::Message(InboundMessage {
        rich: Some(RichContent::System(line)),
        ..
    }) = &event.kind
    else {
        panic!("expected a system line");
    };
    assert_eq!(line.action, SystemAction::ParticipantsLeft);
}

#[test]
fn history_stub_messages_become_system_lines() {
    let event = Message {
        info: MessageInfo {
            source: MessageSource {
                chat: "120363000000000001@g.us".parse().unwrap(),
                sender: "15550001111@s.whatsapp.net".parse().unwrap(),
                is_group: true,
                ..MessageSource::default()
            },
            id: "3EB0STUB".to_owned(),
            timestamp: Some(now()),
            ..MessageInfo::default()
        },
        message: None,
        source_web_msg: Some(whatsmeow::proto::wa_web::WebMessageInfo {
            message_stub_type: Some(
                whatsmeow::proto::wa_web::web_message_info::StubType::GroupParticipantAdd as i32,
            ),
            message_stub_parameters: vec!["15550002222@s.whatsapp.net".to_owned()],
            ..Default::default()
        }),
        ..Message::default()
    };

    let mapped = super::map_history_message(ACCOUNT, &event, now(), &plain_locator).unwrap();

    let InboundKind::Message(message) = mapped.kind else {
        panic!("expected a message");
    };
    assert!(message.history);
    assert_eq!(message.kind, MessageKind::System);
    assert_eq!(message.source_id, "3EB0STUB");
    let Some(RichContent::System(line)) = message.rich else {
        panic!("expected a system line");
    };
    assert_eq!(line.action, SystemAction::ParticipantsAdded);
    assert_eq!(line.participants, vec!["15550002222@s.whatsapp.net"]);
}

/// A LID store that cannot be read.
struct BrokenLids;

#[async_trait::async_trait]
impl whatsmeow::store::LidStore for BrokenLids {
    async fn put_many_lid_mappings(
        &self,
        _mappings: &[whatsmeow::store::LidMapping],
    ) -> Result<(), whatsmeow::store::StoreError> {
        Err(whatsmeow::store::StoreError::StoreIsNil)
    }

    async fn put_lid_mapping(
        &self,
        _lid: &whatsmeow::types::Jid,
        _jid: &whatsmeow::types::Jid,
    ) -> Result<(), whatsmeow::store::StoreError> {
        Err(whatsmeow::store::StoreError::StoreIsNil)
    }

    async fn get_pn_for_lid(
        &self,
        _lid: &whatsmeow::types::Jid,
    ) -> Result<Option<whatsmeow::types::Jid>, whatsmeow::store::StoreError> {
        Err(whatsmeow::store::StoreError::StoreIsNil)
    }

    async fn get_lid_for_pn(
        &self,
        _pn: &whatsmeow::types::Jid,
    ) -> Result<Option<whatsmeow::types::Jid>, whatsmeow::store::StoreError> {
        Err(whatsmeow::store::StoreError::StoreIsNil)
    }

    async fn get_many_lids_for_pns(
        &self,
        _pns: &[whatsmeow::types::Jid],
    ) -> Result<
        std::collections::HashMap<whatsmeow::types::Jid, whatsmeow::types::Jid>,
        whatsmeow::store::StoreError,
    > {
        Err(whatsmeow::store::StoreError::StoreIsNil)
    }
}

/// Without the other address the gate could drop a message of an added
/// direct chat as unadopted, so a store failure must reach the caller, which
/// leaves the message unacknowledged for WhatsApp to redeliver.
#[tokio::test]
async fn a_lid_store_failure_is_reported_instead_of_completing_nothing() {
    let mut event = inbound(map_event(
        ACCOUNT,
        &lid_message("3EB0F004", "987654321@lid", false),
        now(),
        &plain_locator,
    ));

    assert!(
        super::complete_addresses(&BrokenLids, &mut event)
            .await
            .is_err()
    );
    assert!(
        super::complete_sender(&BrokenLids, &mut event)
            .await
            .is_err()
    );
}

mod contacts;
