//! What phones send besides plain text, end to end: media with its shape,
//! replies to media, mentions and forwards, polls and votes, places,
//! contact cards, events, pins, calls, view-once media (kept like any
//! media), and group changes as system lines.

use std::sync::Mutex;

use external_chat::domain::effects::EffectsService;
use external_chat::domain::models::MediaPresentation;
use external_chat::domain::ports::{ChatEffect, ChatPublisher};
use external_chat::domain::rich::{
    Call, CallOutcome, ContactCard, Contacts, Event, Location, SystemAction,
};
use external_chat::domain::timeline::{
    ExternalChatMention, ExternalChatMessage, ExternalChatMessageKind, ExternalChatPersonRef,
    ExternalChatPoll, ExternalChatPollOption, ExternalChatRichContent, ExternalChatSystemLine,
};
use whatsapp_fake_server::GroupChange;
use whatsmeow::download::MediaType;
use whatsmeow::proto::wa_common::MessageKey;
use whatsmeow::proto::wa_e2e::{
    AudioMessage, CallLogMessage, ContactMessage, ContextInfo, EventMessage, ExtendedTextMessage,
    FutureProofMessage, ImageMessage, LocationMessage, Message, PinInChatMessage, StickerMessage,
    VideoMessage, call_log_message, pin_in_chat_message,
};

use super::*;

/// The timeline entry for WhatsApp message `source`, as Alice reads it.
async fn shown(world: &World, binding: &ChatRef, source: &str) -> ExternalChatMessage {
    let id = sqlx::query_scalar!(
        "SELECT id FROM external_chat_message WHERE chat_id = $1 AND source_id = $2",
        binding.id,
        source
    )
    .fetch_one(&world.pool)
    .await
    .unwrap();
    world
        .external
        .messages(
            &receipt::<ViewAccessLevel>(ALICE, binding.id),
            None,
            Some(100),
        )
        .await
        .unwrap()
        .messages
        .into_iter()
        .find(|message| message.id == id)
        .expect("the message is on the timeline")
}

/// Each stored attachment of one WhatsApp message: mime, width, height,
/// duration and presentation.
async fn attachment_shapes(
    pool: &PgPool,
    binding: Uuid,
    source: &str,
) -> Vec<(
    Option<String>,
    Option<i32>,
    Option<i32>,
    Option<i32>,
    Option<String>,
)> {
    sqlx::query!(
        "SELECT mime, width, height, duration_seconds, presentation FROM external_chat_attachment
         WHERE chat_id = $1 AND source_id = $2 ORDER BY ordinal",
        binding,
        source
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.mime,
            row.width,
            row.height,
            row.duration_seconds,
            row.presentation,
        )
    })
    .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn media_keeps_its_shape_and_a_media_reply_keeps_its_quote(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    let (_, binding) = world.alice_adopted().await;

    let question = world
        .customer
        .send_text(&world.group, "which box?")
        .await
        .unwrap();
    assert_eq!(world.timeline(&binding, &question).await, ["which box?"]);

    // A photo that replies to the question.
    let photo = b"jpeg of the damaged box".repeat(40);
    let uploaded = world
        .customer
        .upload_media(&photo, MediaType::Image)
        .await
        .unwrap();
    let reply = world
        .customer
        .send_message(
            &world.group,
            Message {
                image_message: Some(Box::new(ImageMessage {
                    url: Some(uploaded.url),
                    direct_path: Some(uploaded.direct_path),
                    media_key: Some(uploaded.media_key),
                    file_enc_sha256: Some(uploaded.file_enc_sha256),
                    file_sha256: Some(uploaded.file_sha256),
                    file_length: Some(uploaded.file_length),
                    mimetype: Some("image/jpeg".to_owned()),
                    caption: Some("this one".to_owned()),
                    width: Some(1200),
                    height: Some(900),
                    context_info: Some(Box::new(ContextInfo {
                        stanza_id: Some(question.clone()),
                        participant: Some(world.customer.lid().to_string()),
                        quoted_message: Some(Box::new(Message {
                            conversation: Some("which box?".to_owned()),
                            ..Message::default()
                        })),
                        ..ContextInfo::default()
                    })),
                    ..ImageMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();

    let clip = b"mp4 of the unboxing".repeat(40);
    let uploaded = world
        .customer
        .upload_media(&clip, MediaType::Video)
        .await
        .unwrap();
    let video = world
        .customer
        .send_message(
            &world.group,
            Message {
                video_message: Some(Box::new(VideoMessage {
                    url: Some(uploaded.url),
                    direct_path: Some(uploaded.direct_path),
                    media_key: Some(uploaded.media_key),
                    file_enc_sha256: Some(uploaded.file_enc_sha256),
                    file_sha256: Some(uploaded.file_sha256),
                    file_length: Some(uploaded.file_length),
                    mimetype: Some("video/mp4".to_owned()),
                    width: Some(1280),
                    height: Some(720),
                    seconds: Some(12),
                    ..VideoMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();

    let loop_bytes = b"mp4 that loops".repeat(40);
    let uploaded = world
        .customer
        .upload_media(&loop_bytes, MediaType::Video)
        .await
        .unwrap();
    let gif = world
        .customer
        .send_message(
            &world.group,
            Message {
                video_message: Some(Box::new(VideoMessage {
                    url: Some(uploaded.url),
                    direct_path: Some(uploaded.direct_path),
                    media_key: Some(uploaded.media_key),
                    file_enc_sha256: Some(uploaded.file_enc_sha256),
                    file_sha256: Some(uploaded.file_sha256),
                    file_length: Some(uploaded.file_length),
                    mimetype: Some("video/mp4".to_owned()),
                    width: Some(480),
                    height: Some(270),
                    seconds: Some(3),
                    gif_playback: Some(true),
                    ..VideoMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();

    let sticker_bytes = b"webp sticker".repeat(40);
    let uploaded = world
        .customer
        .upload_media(&sticker_bytes, MediaType::Image)
        .await
        .unwrap();
    let sticker = world
        .customer
        .send_message(
            &world.group,
            Message {
                sticker_message: Some(Box::new(StickerMessage {
                    url: Some(uploaded.url),
                    direct_path: Some(uploaded.direct_path),
                    media_key: Some(uploaded.media_key),
                    file_enc_sha256: Some(uploaded.file_enc_sha256),
                    file_sha256: Some(uploaded.file_sha256),
                    file_length: Some(uploaded.file_length),
                    mimetype: Some("image/webp".to_owned()),
                    width: Some(512),
                    height: Some(512),
                    ..StickerMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();

    let voice_bytes = b"opus voice note".repeat(40);
    let uploaded = world
        .customer
        .upload_media(&voice_bytes, MediaType::Audio)
        .await
        .unwrap();
    let voice = world
        .customer
        .send_message(
            &world.group,
            Message {
                audio_message: Some(Box::new(AudioMessage {
                    url: Some(uploaded.url),
                    direct_path: Some(uploaded.direct_path),
                    media_key: Some(uploaded.media_key),
                    file_enc_sha256: Some(uploaded.file_enc_sha256),
                    file_sha256: Some(uploaded.file_sha256),
                    file_length: Some(uploaded.file_length),
                    mimetype: Some("audio/ogg; codecs=opus".to_owned()),
                    seconds: Some(7),
                    ptt: Some(true),
                    ..AudioMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();

    // View-once media is kept and shown like any media.
    let secret_bytes = b"jpeg seen once".repeat(40);
    let uploaded = world
        .customer
        .upload_media(&secret_bytes, MediaType::Image)
        .await
        .unwrap();
    let view_once = world
        .customer
        .send_message(
            &world.group,
            Message {
                view_once_message: Some(Box::new(FutureProofMessage {
                    message: Some(Box::new(Message {
                        image_message: Some(Box::new(ImageMessage {
                            url: Some(uploaded.url),
                            direct_path: Some(uploaded.direct_path),
                            media_key: Some(uploaded.media_key),
                            file_enc_sha256: Some(uploaded.file_enc_sha256),
                            file_sha256: Some(uploaded.file_sha256),
                            file_length: Some(uploaded.file_length),
                            mimetype: Some("image/jpeg".to_owned()),
                            caption: Some("look once".to_owned()),
                            view_once: Some(true),
                            ..ImageMessage::default()
                        })),
                        ..Message::default()
                    })),
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(world.timeline(&binding, &reply).await, ["this one"]);
    for source in [&video, &gif, &sticker, &voice] {
        assert_eq!(world.timeline(&binding, source).await, [""]);
    }
    assert_eq!(world.timeline(&binding, &view_once).await, ["look once"]);

    assert_eq!(
        attachment_shapes(&world.pool, binding.id, &reply).await,
        [(
            Some("image/jpeg".to_owned()),
            Some(1200),
            Some(900),
            None,
            None
        )]
    );
    assert_eq!(
        attachment_shapes(&world.pool, binding.id, &video).await,
        [(
            Some("video/mp4".to_owned()),
            Some(1280),
            Some(720),
            Some(12),
            None
        )]
    );
    assert_eq!(
        attachment_shapes(&world.pool, binding.id, &gif).await,
        [(
            Some("video/mp4".to_owned()),
            Some(480),
            Some(270),
            Some(3),
            Some("gif".to_owned())
        )]
    );
    assert_eq!(
        attachment_shapes(&world.pool, binding.id, &sticker).await,
        [(
            Some("image/webp".to_owned()),
            Some(512),
            Some(512),
            None,
            Some("sticker".to_owned())
        )]
    );
    assert_eq!(
        attachment_shapes(&world.pool, binding.id, &voice).await,
        [(
            Some("audio/ogg".to_owned()),
            None,
            None,
            Some(7),
            Some("voice_note".to_owned())
        )]
    );
    assert_eq!(
        attachment_shapes(&world.pool, binding.id, &view_once).await,
        [(Some("image/jpeg".to_owned()), None, None, None, None)]
    );
    let downloaded = wait_for_rows(&world.pool, TIMEOUT, || async {
        sqlx::query_scalar!(
            "SELECT b.bytes FROM external_chat_attachment a
             JOIN external_chat_media_blob b ON b.id = a.blob_id
             WHERE a.chat_id = $1 AND a.source_id = $2 AND a.state = 'downloaded'",
            binding.id,
            &view_once
        )
        .fetch_optional(&world.pool)
        .await
        .unwrap()
    })
    .await;
    assert_eq!(
        world
            .expect(downloaded, "the view-once image is downloaded for import")
            .await,
        secret_bytes
    );

    // The timeline shows the quote and the shapes.
    let question_shown = shown(&world, &binding, &question).await;
    let reply_shown = shown(&world, &binding, &reply).await;
    assert_eq!(reply_shown.reply_to, Some(question_shown.id));
    assert_eq!(reply_shown.attachments.len(), 1);
    assert_eq!(
        (
            reply_shown.attachments[0].width,
            reply_shown.attachments[0].height
        ),
        (Some(1200), Some(900))
    );
    let voice_shown = shown(&world, &binding, &voice).await;
    assert_eq!(voice_shown.attachments.len(), 1);
    assert_eq!(voice_shown.attachments[0].duration_seconds, Some(7));
    assert_eq!(
        voice_shown.attachments[0].presentation,
        Some(MediaPresentation::VoiceNote)
    );
    let sticker_shown = shown(&world, &binding, &sticker).await;
    assert_eq!(
        sticker_shown.attachments[0].presentation,
        Some(MediaPresentation::Sticker)
    );
    let gif_shown = shown(&world, &binding, &gif).await;
    assert_eq!(
        gif_shown.attachments[0].presentation,
        Some(MediaPresentation::Gif)
    );
    let view_once_shown = shown(&world, &binding, &view_once).await;
    assert!(view_once_shown.view_once);
    assert_eq!(view_once_shown.attachments.len(), 1);
    assert!(!reply_shown.view_once);

    replica.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn polls_places_cards_events_mentions_pins_and_calls_arrive_structured(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    let (_, binding) = world.alice_adopted().await;
    let customer_lid = world.customer.lid().to_string();

    let opener = world
        .customer
        .send_text(&world.group, "anyone free this week?")
        .await
        .unwrap();
    assert_eq!(
        world.timeline(&binding, &opener).await,
        ["anyone free this week?"]
    );

    // Bob forwards a note that mentions the customer.
    let mention_text = format!("@{} can you check this?", world.customer.lid().user);
    let forwarded = world
        .bob
        .send_message(
            &world.group,
            Message {
                extended_text_message: Some(Box::new(ExtendedTextMessage {
                    text: Some(mention_text.clone()),
                    context_info: Some(Box::new(ContextInfo {
                        mentioned_jid: vec![customer_lid.clone()],
                        is_forwarded: Some(true),
                        forwarding_score: Some(1),
                        ..ContextInfo::default()
                    })),
                    ..ExtendedTextMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(world.timeline(&binding, &forwarded).await, [mention_text]);
    let forwarded_shown = shown(&world, &binding, &forwarded).await;
    assert!(forwarded_shown.forwarded);
    assert_eq!(
        forwarded_shown.mentions,
        [ExternalChatMention {
            token: world.customer.lid().user,
            person: ExternalChatPersonRef {
                name: "Customer".to_owned(),
                user_id: None,
            },
        }]
    );

    // A poll, then Bob's vote, then Bob changing it.
    let poll = whatsmeow::msgsecret::build_poll_creation(
        "Which day?",
        &["Tuesday".to_owned(), "Wednesday".to_owned()],
        1,
    );
    let secret = poll
        .message_context_info
        .as_ref()
        .and_then(|context| context.message_secret.clone())
        .expect("a poll carries its message secret");
    let poll_id = world
        .customer
        .send_message(&world.group, poll)
        .await
        .unwrap();
    assert_eq!(world.timeline(&binding, &poll_id).await, [""]);
    let unvoted = shown(&world, &binding, &poll_id).await;
    assert_eq!(unvoted.kind, ExternalChatMessageKind::Message);
    assert_eq!(
        unvoted.rich,
        Some(ExternalChatRichContent::Poll(ExternalChatPoll {
            question: "Which day?".to_owned(),
            options: vec![
                ExternalChatPollOption {
                    name: "Tuesday".to_owned(),
                    votes: 0,
                    mine: false,
                    voters: vec![],
                },
                ExternalChatPollOption {
                    name: "Wednesday".to_owned(),
                    votes: 0,
                    mine: false,
                    voters: vec![],
                },
            ],
            selectable_count: 1,
            voters: 0,
        }))
    );

    world
        .bob
        .vote(
            &world.group,
            &poll_id,
            &world.customer.lid(),
            &secret,
            &["Tuesday"],
        )
        .await
        .unwrap();
    let bob = ExternalChatPersonRef {
        name: "Bob".to_owned(),
        user_id: None,
    };
    let voted = wait_for_rows(&world.pool, TIMEOUT, || async {
        let shown = shown(&world, &binding, &poll_id).await;
        let Some(ExternalChatRichContent::Poll(poll)) = shown.rich else {
            return None;
        };
        (poll.voters == 1).then_some(poll)
    })
    .await;
    let voted = world.expect(voted, "Bob's vote is tallied").await;
    assert_eq!(
        voted.options,
        [
            ExternalChatPollOption {
                name: "Tuesday".to_owned(),
                votes: 1,
                mine: false,
                voters: vec![bob.clone()],
            },
            ExternalChatPollOption {
                name: "Wednesday".to_owned(),
                votes: 0,
                mine: false,
                voters: vec![],
            },
        ]
    );

    world
        .bob
        .vote(
            &world.group,
            &poll_id,
            &world.customer.lid(),
            &secret,
            &["Wednesday"],
        )
        .await
        .unwrap();
    let moved = wait_for_rows(&world.pool, TIMEOUT, || async {
        let shown = shown(&world, &binding, &poll_id).await;
        let Some(ExternalChatRichContent::Poll(poll)) = shown.rich else {
            return None;
        };
        (poll.options[1].votes == 1).then_some(poll)
    })
    .await;
    let moved = world.expect(moved, "Bob's changed vote moves").await;
    assert_eq!(
        moved,
        ExternalChatPoll {
            question: "Which day?".to_owned(),
            options: vec![
                ExternalChatPollOption {
                    name: "Tuesday".to_owned(),
                    votes: 0,
                    mine: false,
                    voters: vec![],
                },
                ExternalChatPollOption {
                    name: "Wednesday".to_owned(),
                    votes: 1,
                    mine: false,
                    voters: vec![bob.clone()],
                },
            ],
            selectable_count: 1,
            voters: 1,
        }
    );
    let stored_votes =
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM external_chat_poll_vote"#)
            .fetch_one(&world.pool)
            .await
            .unwrap();
    assert_eq!(stored_votes, 1, "one current vote per voter");

    // A place, a contact card and an event.
    let place = world
        .customer
        .send_message(
            &world.group,
            Message {
                location_message: Some(Box::new(LocationMessage {
                    degrees_latitude: Some(52.52),
                    degrees_longitude: Some(13.405),
                    name: Some("Warehouse".to_owned()),
                    address: Some("Lagerstrasse 1, Berlin".to_owned()),
                    ..LocationMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();
    let card = world
        .customer
        .send_message(
            &world.group,
            Message {
                contact_message: Some(Box::new(ContactMessage {
                    display_name: Some("Support line".to_owned()),
                    vcard: Some(
                        "BEGIN:VCARD\nVERSION:3.0\nFN:Support line\nTEL;type=CELL;waid=15550100:+1 555 0100\nEND:VCARD"
                            .to_owned(),
                    ),
                    ..ContactMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();
    let event = world
        .customer
        .send_message(
            &world.group,
            Message {
                event_message: Some(Box::new(EventMessage {
                    name: Some("Pickup".to_owned()),
                    description: Some("Bring the label".to_owned()),
                    start_time: Some(1_798_790_400),
                    location: Some(Box::new(LocationMessage {
                        name: Some("Dock 4".to_owned()),
                        ..LocationMessage::default()
                    })),
                    ..EventMessage::default()
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();
    for source in [&place, &card, &event] {
        assert_eq!(world.timeline(&binding, source).await, [""]);
    }
    assert_eq!(
        shown(&world, &binding, &place).await.rich,
        Some(ExternalChatRichContent::Location(Location {
            latitude: 52.52,
            longitude: 13.405,
            name: Some("Warehouse".to_owned()),
            address: Some("Lagerstrasse 1, Berlin".to_owned()),
            url: None,
            live: false,
            comment: None,
        }))
    );
    assert_eq!(
        shown(&world, &binding, &card).await.rich,
        Some(ExternalChatRichContent::Contacts(Contacts {
            contacts: vec![ContactCard {
                name: "Support line".to_owned(),
                phones: vec!["+1 555 0100".to_owned()],
            }],
        }))
    );
    assert_eq!(
        shown(&world, &binding, &event).await.rich,
        Some(ExternalChatRichContent::Event(Event {
            name: "Pickup".to_owned(),
            description: Some("Bring the label".to_owned()),
            start_at: chrono::DateTime::from_timestamp(1_798_790_400, 0),
            end_at: None,
            location: Some("Dock 4".to_owned()),
            join_link: None,
            canceled: false,
        }))
    );

    // Bob pins the opener; the customer's missed video call is logged.
    let pin = world
        .bob
        .send_message(
            &world.group,
            Message {
                pin_in_chat_message: Some(PinInChatMessage {
                    key: Some(MessageKey {
                        remote_jid: Some(world.group.to_string()),
                        from_me: Some(false),
                        id: Some(opener.clone()),
                        participant: Some(customer_lid.clone()),
                    }),
                    r#type: Some(pin_in_chat_message::Type::PinForAll as i32),
                    sender_timestamp_ms: Some(chrono::Utc::now().timestamp_millis()),
                }),
                ..Message::default()
            },
        )
        .await
        .unwrap();
    let call = world
        .customer
        .send_message(
            &world.group,
            Message {
                call_log_messsage: Some(CallLogMessage {
                    is_video: Some(true),
                    call_outcome: Some(call_log_message::CallOutcome::Missed as i32),
                    ..CallLogMessage::default()
                }),
                ..Message::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(world.timeline(&binding, &pin).await, [""]);
    assert_eq!(world.timeline(&binding, &call).await, [""]);
    let opener_shown = shown(&world, &binding, &opener).await;
    let pin_shown = shown(&world, &binding, &pin).await;
    assert_eq!(pin_shown.kind, ExternalChatMessageKind::System);
    assert_eq!(pin_shown.reply_to, Some(opener_shown.id));
    assert_eq!(
        pin_shown.rich,
        Some(ExternalChatRichContent::System(ExternalChatSystemLine {
            action: SystemAction::MessagePinned,
            actor: Some(bob.clone()),
            participants: vec![],
            value: None,
            call: None,
        }))
    );
    let call_shown = shown(&world, &binding, &call).await;
    assert_eq!(call_shown.kind, ExternalChatMessageKind::System);
    assert_eq!(
        call_shown.rich,
        Some(ExternalChatRichContent::System(ExternalChatSystemLine {
            action: SystemAction::Call,
            actor: Some(ExternalChatPersonRef {
                name: "Customer".to_owned(),
                user_id: None,
            }),
            participants: vec![],
            value: None,
            call: Some(Call {
                video: true,
                outcome: CallOutcome::Missed,
                duration_seconds: None,
            }),
        }))
    );
    let kinds = sqlx::query!(
        "SELECT source_id, kind FROM external_chat_message WHERE chat_id = $1 AND source_id = ANY($2)",
        binding.id,
        &[pin.clone(), call.clone(), poll_id.clone()]
    )
    .fetch_all(&world.pool)
    .await
    .unwrap();
    assert_eq!(kinds.len(), 3, "each lands once");
    for row in kinds {
        let expected = if row.source_id == poll_id {
            "message"
        } else {
            "system"
        };
        assert_eq!(row.kind, expected, "{}", row.source_id);
    }

    // Alice mentions the customer from Macro.
    let text = format!("@{} on it", world.customer.lid().user);
    let send = world
        .external
        .send_reply(
            &receipt::<ViewAccessLevel>(ALICE, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: text.clone(),
                    mentions: vec![customer_lid.clone()],
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap()
        .id;
    let received = world
        .customer
        .wait_for_message(TIMEOUT, |message| message.text() == Some(text.as_str()))
        .await
        .expect("the customer's phone receives the mention");
    let context = received
        .message
        .extended_text_message
        .as_ref()
        .and_then(|extended| extended.context_info.as_deref())
        .expect("a mention travels as extended text with context");
    assert_eq!(context.mentioned_jid, [customer_lid]);
    world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;

    replica.drain(TIMEOUT).await.unwrap();
}

/// Records which messages the notification outbox publishes.
#[derive(Default)]
struct Published(Mutex<Vec<Uuid>>);

#[async_trait]
impl ChatPublisher for Published {
    async fn publish(&self, effect: &ChatEffect) -> ExternalChatResult<()> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(effect.message_id);
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn group_changes_land_once_as_system_lines_that_never_notify(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    world.pair(ALICE, &world.alice).await;
    world.pair(BOB, &world.bob).await;
    let binding = world.adopt(ALICE, &[BOB]).await;
    world.observe(BOB, &binding).await;
    let dana = world.whatsapp.add_user("15558880002", "Dana").await;

    let announce = world
        .customer
        .send_text(&world.group, "adding Dana from the warehouse")
        .await
        .unwrap();
    world
        .whatsapp
        .change_group(&world.group, Some(&world.customer), GroupChange::Add(&dana));
    let hello = dana.send_text(&world.group, "hi, Dana here").await.unwrap();
    world
        .whatsapp
        .change_group(&world.group, Some(&dana), GroupChange::Remove(&dana));
    world.whatsapp.change_group(
        &world.group,
        Some(&world.customer),
        GroupChange::Subject("Escalations, renamed".to_owned()),
    );
    let last = world
        .customer
        .send_text(&world.group, "Dana sorted it")
        .await
        .unwrap();
    for (source, text) in [
        (&announce, "adding Dana from the warehouse"),
        (&hello, "hi, Dana here"),
        (&last, "Dana sorted it"),
    ] {
        assert_eq!(world.timeline(&binding, source).await, [text]);
    }
    // Both accounts have seen everything up to the last message.
    let observed = wait_for_rows(&world.pool, TIMEOUT, || async {
        (observations(&world.pool, binding.id, &last).await == 2).then_some(())
    })
    .await;
    world
        .expect(observed, "both accounts observe the last message")
        .await;

    let lines = wait_for_rows(&world.pool, TIMEOUT, || async {
        let lines = sqlx::query!(
            r#"SELECT message_id AS "message_id!", source_id, rich->>'action' AS "action!" FROM external_chat_message
            WHERE chat_id = $1 AND kind = 'system' AND message_id IS NOT NULL ORDER BY source_at, rich->>'action'"#,
            binding.id
        )
        .fetch_all(&world.pool)
        .await
        .unwrap();
        (lines.len() >= 3).then_some(lines)
    })
    .await;
    let lines = world
        .expect(lines, "the three group changes become system lines")
        .await;
    let mut actions: Vec<&str> = lines.iter().map(|line| line.action.as_str()).collect();
    actions.sort_unstable();
    assert_eq!(
        actions,
        ["participants_added", "participants_left", "subject_changed"],
        "each change lands once though two accounts saw it: {:?}",
        lines
            .iter()
            .map(|line| (&line.action, &line.source_id))
            .collect::<Vec<_>>()
    );

    let page = world
        .external
        .messages(
            &receipt::<ViewAccessLevel>(ALICE, binding.id),
            None,
            Some(100),
        )
        .await
        .unwrap()
        .messages;
    let customer = ExternalChatPersonRef {
        name: "Customer".to_owned(),
        user_id: None,
    };
    let dana_ref = ExternalChatPersonRef {
        name: "Dana".to_owned(),
        user_id: None,
    };
    let system: Vec<ExternalChatSystemLine> = page
        .iter()
        .filter(|message| message.kind == ExternalChatMessageKind::System)
        .filter_map(|message| match &message.rich {
            Some(ExternalChatRichContent::System(line)) => Some(line.clone()),
            _ => None,
        })
        .collect();
    let line = |action: SystemAction| {
        system
            .iter()
            .find(|line| line.action == action)
            .cloned()
            .unwrap_or_else(|| panic!("a {action:?} line in {system:?}"))
    };
    assert_eq!(
        line(SystemAction::ParticipantsAdded),
        ExternalChatSystemLine {
            action: SystemAction::ParticipantsAdded,
            actor: Some(customer.clone()),
            participants: vec![dana_ref.clone()],
            value: None,
            call: None,
        }
    );
    assert_eq!(
        line(SystemAction::ParticipantsLeft),
        ExternalChatSystemLine {
            action: SystemAction::ParticipantsLeft,
            actor: Some(dana_ref.clone()),
            participants: vec![dana_ref.clone()],
            value: None,
            call: None,
        }
    );
    assert_eq!(
        line(SystemAction::SubjectChanged),
        ExternalChatSystemLine {
            action: SystemAction::SubjectChanged,
            actor: Some(customer.clone()),
            participants: vec![],
            value: Some("Escalations, renamed".to_owned()),
            call: None,
        }
    );

    // Only the three texts are unread, and only they notify.
    let summary = world
        .external
        .list(&person(ALICE))
        .await
        .unwrap()
        .into_iter()
        .find(|group| group.id == binding.id)
        .unwrap();
    assert_eq!(summary.unread_count, 3, "system lines are never unread");
    let published = Arc::new(Published::default());
    let effects = EffectsService::new(
        Arc::new(PgExternalChatRepository::new(world.pool.clone())),
        published.clone(),
    );
    while effects.publish_pending().await.unwrap() > 0 {}
    let mut notified = published
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    notified.sort_unstable();
    let texts = sqlx::query_scalar!(
        r#"SELECT message_id AS "message_id!" FROM external_chat_message
        WHERE chat_id = $1 AND source_id = ANY($2) ORDER BY message_id"#,
        binding.id,
        &[announce.clone(), hello.clone(), last.clone()]
    )
    .fetch_all(&world.pool)
    .await
    .unwrap();
    assert_eq!(notified, texts, "only the texts notify");
    for line in &lines {
        assert!(
            !notified.contains(&line.message_id),
            "{} notified",
            line.source_id
        );
    }

    replica.drain(TIMEOUT).await.unwrap();
}
