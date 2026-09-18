use super::*;

use channel_sender::ChannelSender;
use chrono::Utc;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;

fn sender() -> ChannelSender<'static> {
    ChannelSender::new_from_user(
        MacroUserIdStr::parse_from_str("macro|agent-trigger@macro.com")
            .expect("valid user id")
            .into_owned(),
    )
}

fn channel_message() -> ChannelMessagePostedMetadata {
    ChannelMessagePostedMetadata {
        channel_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
        thread_id: None,
        sender: sender(),
        triggered_by: None,
        channel_type: ChannelType::Private,
        content: "hello".to_owned(),
        mentions: vec![],
        attachments: vec![ChannelEventAttachment {
            attachment_id: Uuid::from_u128(9),
            entity_type: "document".to_owned(),
            entity_id: "doc".to_owned(),
            created_at: Utc::now(),
        }],
        created_at: Utc::now(),
    }
}

fn posted(parent: MessageParent, thread_id: Option<Uuid>) -> MessagePostedMetadata {
    MessagePostedMetadata {
        parent,
        message_id: Uuid::from_u128(2),
        thread_id,
        root_id: thread_id.unwrap_or(Uuid::from_u128(2)),
        sender: sender(),
        triggered_by: None,
        content: "hello".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    }
}

fn document() -> MessageParent {
    MessageParent::parse("document", "doc-1").unwrap()
}

#[test]
fn serializes_a_new_top_level_mention() {
    let event = AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
        AgentBotMentionedEvent {
            bot_id: BotId::TEST_A,
            message: channel_message(),
        },
    ));

    let value = serde_json::to_value(event).expect("serialize event");

    assert_eq!(value["event_type"], "agent_trigger.new");
    assert_eq!(value["metadata"]["source"], "top_level_mentioned");
    assert_eq!(value["metadata"]["bot_id"], json!(BotId::TEST_A));
}

#[test]
fn serializes_an_existing_channel_event() {
    let event = AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
        ChannelEventMetadata {
            bot_id: BotId::TEST_A,
            session_id: AgentSessionId::TEST_A,
            kind: ThreadMessageKind::MentionThread,
            message: channel_message(),
        },
    ));

    let value = serde_json::to_value(event).expect("serialize event");

    assert_eq!(value["event_type"], "agent_trigger.existing");
    assert_eq!(value["metadata"]["source"], "channel");
    assert_eq!(
        value["metadata"]["session_id"],
        json!(AgentSessionId::TEST_A)
    );
}

/// The channel-only variants are the first schema version's wire shape; a
/// consumer built against it must keep decoding what the trigger publishes
/// for channel parents, so the topic never bumps its version for them.
#[test]
fn channel_events_keep_the_first_schema_versions_shape() {
    assert_eq!(AgentTriggerTopicEvent::SCHEMA_VERSION, 1);
    let event = AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
        ChannelEventMetadata {
            bot_id: BotId::TEST_A,
            session_id: AgentSessionId::TEST_A,
            kind: ThreadMessageKind::MentionThread,
            message: channel_message(),
        },
    ));
    let value = serde_json::to_value(&event).expect("serialize event");
    let message = &value["metadata"]["message"];
    assert_eq!(message["channel_id"], json!(Uuid::from_u128(1)));
    assert_eq!(message["channel_type"], "private");
    assert!(
        message.get("parent").is_none(),
        "the channel shape names no parent"
    );
    assert!(message.get("root_id").is_none());

    let decoded: AgentTriggerTopicEvent = serde_json::from_value(value).expect("decode");
    assert_eq!(decoded, event);
}

#[test]
fn parent_aware_events_name_their_parent_and_are_new_variants() {
    let event =
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Thread(ThreadEventMetadata {
            bot_id: BotId::TEST_A,
            session_id: AgentSessionId::TEST_A,
            kind: ThreadMessageKind::MentionThread,
            message: posted(document(), None),
        }));
    let value = serde_json::to_value(&event).expect("serialize event");
    assert_eq!(value["metadata"]["source"], "thread");
    assert_eq!(value["metadata"]["message"]["parent"]["type"], "document");

    let opened =
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::Mentioned(AgentMentionedEvent {
            bot_id: BotId::TEST_A,
            message: posted(document(), None),
        }));
    let value = serde_json::to_value(&opened).expect("serialize event");
    assert_eq!(value["metadata"]["source"], "mentioned");
}

/// Consumers read both shapes through one view: the channel shape converts
/// to a channel parent, the parent-aware shape passes through.
#[test]
fn accessors_present_both_shapes_as_parent_aware_messages() {
    let from_channel = NewAgentSessionEvent::TopLevelMentioned(AgentBotMentionedEvent {
        bot_id: BotId::TEST_A,
        message: channel_message(),
    })
    .mention()
    .expect("a recognised shape");
    assert_eq!(from_channel.bot_id, BotId::TEST_A);
    assert_eq!(
        from_channel.message.parent,
        MessageParent::Channel(Uuid::from_u128(1))
    );
    assert_eq!(from_channel.message.root_id, Uuid::from_u128(2));
    assert_eq!(
        from_channel.message.attachments[0].attachment_id,
        Uuid::from_u128(9)
    );

    let from_document = ExistingAgentSessionEvent::Thread(ThreadEventMetadata {
        bot_id: BotId::TEST_B,
        session_id: AgentSessionId::TEST_B,
        kind: ThreadMessageKind::Inferred,
        message: posted(document(), Some(Uuid::from_u128(7))),
    })
    .session_message()
    .expect("a recognised shape");
    assert_eq!(from_document.session_id, AgentSessionId::TEST_B);
    assert_eq!(from_document.kind, ThreadMessageKind::Inferred);
    assert_eq!(from_document.message.parent, document());

    let topic = AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
        ChannelEventMetadata {
            bot_id: BotId::TEST_A,
            session_id: AgentSessionId::TEST_A,
            kind: ThreadMessageKind::ExplicitReply,
            message: channel_message(),
        },
    ));
    assert_eq!(topic.bot_id(), Some(BotId::TEST_A));
}

/// A decision on a channel parent takes the channel-only shape, carrying the
/// channel's type; one on a document takes the parent-aware shape.
#[test]
fn decisions_take_the_wire_shape_their_parent_needs() {
    let channel = MessageParent::Channel(Uuid::from_u128(1));
    let opened = AgentSessionMacroEvent::from_decision(
        TriggerDecision::Open {
            bot_id: BotId::TEST_A,
            message: posted(channel.clone(), None),
        },
        Some(ChannelType::Team),
    )
    .expect("a channel type was supplied");
    assert_eq!(opened.key(), BotId::TEST_A.to_string());
    let AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) =
        &opened.event().event
    else {
        panic!("a channel mention takes the channel-only shape: {opened:?}");
    };
    assert_eq!(mentioned.message.channel_id, Uuid::from_u128(1));
    assert_eq!(mentioned.message.channel_type, ChannelType::Team);
    assert_eq!(mentioned.message.thread_id, None);

    let followed = AgentSessionMacroEvent::from_decision(
        TriggerDecision::Existing {
            bot_id: BotId::TEST_A,
            session_id: AgentSessionId::TEST_A,
            kind: ThreadMessageKind::Inferred,
            message: posted(channel.clone(), Some(Uuid::from_u128(7))),
        },
        Some(ChannelType::Public),
    )
    .expect("a channel type was supplied");
    let AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) =
        &followed.event().event
    else {
        panic!("a channel follow-up takes the channel-only shape: {followed:?}");
    };
    assert_eq!(metadata.kind, ThreadMessageKind::Inferred);
    assert_eq!(metadata.message.thread_id, Some(Uuid::from_u128(7)));

    let document_opened = AgentSessionMacroEvent::from_decision(
        TriggerDecision::Open {
            bot_id: BotId::TEST_B,
            message: posted(document(), None),
        },
        None,
    )
    .expect("documents need no channel type");
    assert!(matches!(
        &document_opened.event().event,
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::Mentioned(mentioned))
            if mentioned.message.parent == document()
    ));
    let document_followed = AgentSessionMacroEvent::from_decision(
        TriggerDecision::Existing {
            bot_id: BotId::TEST_B,
            session_id: AgentSessionId::TEST_B,
            kind: ThreadMessageKind::ExplicitReply,
            message: posted(document(), Some(Uuid::from_u128(7))),
        },
        Some(ChannelType::Public),
    )
    .expect("a stray channel type is ignored for documents");
    assert!(matches!(
        &document_followed.event().event,
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Thread(metadata))
            if metadata.session_id == AgentSessionId::TEST_B
    ));

    assert_eq!(
        AgentSessionMacroEvent::from_decision(
            TriggerDecision::Open {
                bot_id: BotId::TEST_A,
                message: posted(channel, None),
            },
            None,
        )
        .unwrap_err(),
        MissingChannelType {
            channel_id: Uuid::from_u128(1)
        }
    );
}

#[test]
fn channel_shape_round_trips_through_the_parent_aware_post() {
    let original = channel_message();
    let parent_aware = posted_from_channel_event(&original);
    assert_eq!(parent_aware.root_id, original.message_id);
    let back = channel_event_from_posted(&parent_aware, Uuid::from_u128(1), ChannelType::Private);
    assert_eq!(back, original);
}

#[test]
fn event_names_match_the_wire() {
    use strum::IntoEnumIterator as _;

    // Subscribers filter on these names, so the serde tag is the contract and
    // `AgentTriggerEventName` must agree with it variant for variant.
    let wire_names: Vec<String> = [
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
            AgentBotMentionedEvent {
                bot_id: BotId::TEST_A,
                message: channel_message(),
            },
        )),
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
            ChannelEventMetadata {
                bot_id: BotId::TEST_A,
                session_id: AgentSessionId::TEST_A,
                kind: ThreadMessageKind::MentionThread,
                message: channel_message(),
            },
        )),
    ]
    .into_iter()
    .map(|event| serde_json::to_value(event).expect("serialize event")["event_type"].to_string())
    .collect();
    let names: Vec<String> = AgentTriggerEventName::iter()
        .map(|name| serde_json::Value::String(name.to_string()).to_string())
        .collect();

    assert_eq!(names, wire_names);
}

#[test]
fn channel_kinds_round_trip_in_snake_case() {
    for (kind, wire) in [
        (ThreadMessageKind::MentionThread, "mention_thread"),
        (ThreadMessageKind::ExplicitReply, "explicit_reply"),
        (ThreadMessageKind::Inferred, "inferred"),
    ] {
        let value = serde_json::to_value(kind).expect("serialize kind");
        assert_eq!(value, json!(wire));
        let parsed: ThreadMessageKind = serde_json::from_value(value).expect("deserialize kind");
        assert_eq!(parsed, kind);
    }
}
