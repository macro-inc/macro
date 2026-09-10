use super::*;
use bots::domain::models::BotId;

use macro_user_id::cowlike::CowLike;
use serde_json::json;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@macro.com")
        .expect("valid user id")
        .into_owned()
}

fn identity() -> SessionIdentity {
    SessionIdentity {
        session_id: AgentSessionId::TEST_A,
        session_name: "Fix the flaky test".to_owned(),
        bot_id: BotId::TEST_A,
        bot_name: "Macro Coder".to_owned(),
        owner_id: owner(),
        origin: Some(ThreadOrigin {
            channel_id: Uuid::from_u128(1),
            thread_id: Uuid::from_u128(2),
            originating_message_id: Uuid::from_u128(3),
        }),
    }
}

fn action_id() -> AgentActionId {
    AgentActionId::mint()
}

fn one_of_each() -> Vec<AgentSessionLifecycleEvent> {
    vec![
        AgentSessionLifecycleEvent::Opened(SessionOpenedMetadata {
            identity: identity(),
            model: "claude".to_owned(),
            harness: "claude_code".to_owned(),
        }),
        AgentSessionLifecycleEvent::TurnStarted(TurnStartedMetadata {
            identity: identity(),
            turn: TurnId(0),
            action_id: action_id(),
            actor: Some(owner()),
            announcement_message_id: Some(Uuid::from_u128(4)),
        }),
        AgentSessionLifecycleEvent::TurnEnded(TurnEndedMetadata {
            identity: identity(),
            turn: TurnId(0),
            action_id: action_id(),
            actor: Some(owner()),
            announcement_message_id: Some(Uuid::from_u128(4)),
            stop_reason: "end_turn".to_owned(),
            queued_remaining: 0,
        }),
        AgentSessionLifecycleEvent::Settled(SessionSettledMetadata {
            identity: identity(),
            last_turn: Some(TurnSummary {
                turn: TurnId(0),
                action_id: action_id(),
                actor: Some(owner()),
                announcement_message_id: Some(Uuid::from_u128(4)),
                stop_reason: "end_turn".to_owned(),
                excerpt: Some("Done.".to_owned()),
            }),
        }),
        AgentSessionLifecycleEvent::WaitingForInput(WaitingForInputMetadata {
            identity: identity(),
            turn: TurnId(1),
            action_id: action_id(),
            announcement_message_id: None,
            question: "Which approach?".to_owned(),
        }),
        AgentSessionLifecycleEvent::InputReceived(InputReceivedMetadata {
            identity: identity(),
            turn: TurnId(1),
            action_id: action_id(),
        }),
        AgentSessionLifecycleEvent::Stopped(SessionStoppedMetadata {
            identity: identity(),
            reason: "transport closed".to_owned(),
            turn_in_flight: None,
        }),
        AgentSessionLifecycleEvent::Renamed(SessionRenamedMetadata {
            identity: identity(),
        }),
        AgentSessionLifecycleEvent::Deleted(SessionDeletedMetadata {
            identity: identity(),
        }),
    ]
}

#[test]
fn event_names_match_the_wire() {
    use strum::IntoEnumIterator as _;

    // Subscribers filter on these names, so the serde tag is the contract and
    // `AgentSessionLifecycleEventName` must agree with it variant for variant.
    let wire_names: Vec<String> = one_of_each()
        .into_iter()
        .map(|event| {
            serde_json::to_value(event).expect("serialize event")["event_type"].to_string()
        })
        .collect();
    let names: Vec<String> = AgentSessionLifecycleEventName::iter()
        .map(|name| serde_json::Value::String(name.to_string()).to_string())
        .collect();

    assert_eq!(names, wire_names);
}

#[test]
fn name_is_the_wire_name() {
    for event in one_of_each() {
        let value = serde_json::to_value(&event).expect("serialize event");
        assert_eq!(value["event_type"], json!(event.name()));
    }
}

#[test]
fn every_variant_round_trips() {
    for event in one_of_each() {
        let value = serde_json::to_value(&event).expect("serialize event");
        assert_eq!(
            value["metadata"]["identity"]["session_id"],
            json!(AgentSessionId::TEST_A)
        );
        let parsed: AgentSessionLifecycleEvent =
            serde_json::from_value(value).expect("deserialize event");
        assert_eq!(parsed, event);
    }
}

#[test]
fn macro_event_is_keyed_by_session_id() {
    let event = AgentSessionLifecycleMacroEvent::new(AgentSessionLifecycleEvent::Renamed(
        SessionRenamedMetadata {
            identity: identity(),
        },
    ));

    assert_eq!(event.key(), AgentSessionId::TEST_A.to_string());
    assert_eq!(event.event().schema_version, 1);
    assert_eq!(event.event().event.session_id(), AgentSessionId::TEST_A);
}
