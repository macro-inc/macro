use super::*;

use channel_sender::ChannelSender;
use channels::domain::models::ChannelType;
use chrono::Utc;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde_json::json;

fn message() -> ChannelMessagePostedMetadata {
    ChannelMessagePostedMetadata {
        channel_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
        thread_id: None,
        sender: ChannelSender::new_from_user(
            MacroUserIdStr::parse_from_str("macro|agent-trigger@macro.com")
                .expect("valid user id")
                .into_owned(),
        ),
        triggered_by: None,
        channel_type: ChannelType::Public,
        content: "hello".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    }
}

#[test]
fn serializes_a_new_top_level_mention() {
    let event = AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
        AgentBotMentionedEvent {
            bot_id: BotId::TEST_A,
            message: message(),
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
            message: message(),
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

#[test]
fn event_names_match_the_wire() {
    use strum::IntoEnumIterator as _;

    // Subscribers filter on these names, so the serde tag is the contract and
    // `AgentTriggerEventName` must agree with it variant for variant.
    let wire_names: Vec<String> = [
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
            AgentBotMentionedEvent {
                bot_id: BotId::TEST_A,
                message: message(),
            },
        )),
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
            ChannelEventMetadata {
                bot_id: BotId::TEST_A,
                session_id: AgentSessionId::TEST_A,
                message: message(),
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
