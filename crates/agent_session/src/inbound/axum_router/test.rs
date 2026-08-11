//! The wire contract of the folded-messages endpoint.
//!
//! A channel renders by joining placeholder rows onto these messages by
//! composite id, and a live viewer overlays `agent_session_message` websocket
//! events onto this snapshot by the same id plus the frame counter. These
//! tests pin the parts of the serialized shape those joins depend on.

use super::*;
use crate::domain::model::SessionBot;
use agent_fold::domain::fold::fold;
use agent_fold::testing::{TURN, parse_log_as, test_session};
use bots::domain::models::BotId;

fn response() -> serde_json::Value {
    let entries = parse_log_as(test_session(), TURN);
    let log_length = entries.len() as u64;
    let response = AgentChannelMessagesResponse::from(ChannelFoldedMessages {
        agent_session_id: test_session(),
        bot: SessionBot {
            id: BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0xb07)),
            name: "Test Agent".to_owned(),
            avatar_url: None,
        },
        log_length,
        messages: fold(entries),
    });
    serde_json::to_value(&response).expect("the response serializes")
}

/// Every message carries the session-prefixed composite id its placeholder
/// row stores - the join the whole rendering path hangs on.
#[test]
fn messages_are_keyed_by_the_composite_id() {
    let value = response();
    let messages = value["messages"].as_array().expect("messages serialize");
    assert!(!messages.is_empty(), "the fixture folds to messages");

    let prefix = format!("{}:", test_session().as_uuid());
    for message in messages {
        let id = message["agentSessionMessageId"]
            .as_str()
            .expect("the composite id is a string");
        assert!(id.starts_with(&prefix), "got {id}");
        assert!(message["parts"].is_array(), "got {message}");
    }
}

/// The snapshot names the counter live events are aligned against.
#[test]
fn the_snapshot_reports_how_many_frames_it_folded() {
    let value = response();
    let expected = parse_log_as(test_session(), TURN).len() as u64;
    assert_eq!(value["logLength"], serde_json::json!(expected));
    assert_eq!(
        value["agentSessionId"],
        serde_json::json!(test_session().as_uuid())
    );
    assert_eq!(value["bot"]["name"], "Test Agent");
}

/// A channel with no session is an ordinary empty answer: no session id, no
/// bot key at all (omitted rather than null), nothing folded.
#[test]
fn a_channel_without_a_session_answers_empty() {
    let value =
        serde_json::to_value(AgentChannelMessagesResponse::none()).expect("the answer serializes");

    assert!(value.get("agentSessionId").is_none(), "got {value}");
    assert!(value.get("bot").is_none(), "got {value}");
    assert_eq!(value["logLength"], 0);
    assert_eq!(value["messages"], serde_json::json!([]));
}
