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
    let event = AgentSessionTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
        AgentBotMentionedEvent {
            bot_id: BotId::TEST_A,
            message: message(),
        },
    ));

    let value = serde_json::to_value(event).expect("serialize event");

    assert_eq!(value["event_type"], "agent_session.new");
    assert_eq!(value["metadata"]["source"], "top_level_mentioned");
    assert_eq!(value["metadata"]["bot_id"], json!(BotId::TEST_A));
}

#[test]
fn serializes_an_existing_channel_event() {
    let event = AgentSessionTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
        ChannelEventMetadata {
            bot_id: BotId::TEST_A,
            session_id: AgentSessionId::TEST_A,
            kind: ChannelKind::DedicatedChannel,
            message: message(),
        },
    ));

    let value = serde_json::to_value(event).expect("serialize event");

    assert_eq!(value["event_type"], "agent_session.existing");
    assert_eq!(value["metadata"]["source"], "channel");
    assert_eq!(
        value["metadata"]["session_id"],
        json!(AgentSessionId::TEST_A)
    );
}
