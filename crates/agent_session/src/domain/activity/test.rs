use ::activity::Action;
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::events::{
    InputReceivedMetadata, SessionDeletedMetadata, SessionIdentity, SessionOpenedMetadata,
    SessionRenamedMetadata, SessionSettledMetadata, SessionStoppedMetadata, TurnEndedMetadata,
    TurnStartedMetadata, WaitingForInputMetadata,
};
use crate::domain::model::{AgentSessionId, TurnId};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: AgentSessionLifecycleEvent) -> Event<AgentSessionLifecycleEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

fn identity() -> SessionIdentity {
    SessionIdentity {
        session_id: AgentSessionId::TEST_A,
        session_name: "Fix the flaky test".to_owned(),
        bot_id: BotId::TEST_A,
        bot_name: "Macro Coder".to_owned(),
        owner_id: user("macro|owner@macro.com"),
        origin: None,
    }
}

fn session_id() -> String {
    AgentSessionId::TEST_A.to_string()
}

fn single_activity(ingest: Ingest) -> Activity {
    match ingest {
        Ingest::Insert(mut activities) => {
            assert_eq!(activities.len(), 1);
            activities.pop().unwrap()
        }
        other => panic!("expected a single activity, got {other:?}"),
    }
}

#[test]
fn opened_maps_to_created_on_the_owner() {
    let event = envelope(AgentSessionLifecycleEvent::Opened(SessionOpenedMetadata {
        identity: identity(),
        model: "claude".to_owned(),
        harness: "claude_code".to_owned(),
    }));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Created);
    assert_eq!(activity.entity_type, EntityType::AgentSession);
    assert_eq!(activity.entity_id, session_id());
    assert_eq!(activity.subject_id, "macro|owner@macro.com");
    assert_eq!(activity.actor.as_ref(), "macro|owner@macro.com");
}

#[test]
fn user_prompt_maps_to_messaged() {
    let event = envelope(AgentSessionLifecycleEvent::TurnStarted(
        TurnStartedMetadata {
            identity: identity(),
            turn: TurnId(0),
            action_id: agent_runtime_protocol::domain::action::AgentActionId::mint(),
            actor: Some(user("macro|teo@macro.com")),
            announcement_message_id: None,
        },
    ));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Messaged);
    assert_eq!(activity.entity_type, EntityType::AgentSession);
    assert_eq!(activity.subject_id, "macro|teo@macro.com");
}

#[test]
fn actorless_prompt_is_dropped() {
    let event = envelope(AgentSessionLifecycleEvent::TurnStarted(
        TurnStartedMetadata {
            identity: identity(),
            turn: TurnId(0),
            action_id: agent_runtime_protocol::domain::action::AgentActionId::mint(),
            actor: None,
            announcement_message_id: None,
        },
    ));
    assert_eq!(event.event.ingest(event.event_id), Ingest::Ignore);
}

#[test]
fn renamed_maps_to_edited() {
    let event = envelope(AgentSessionLifecycleEvent::Renamed(
        SessionRenamedMetadata {
            identity: identity(),
        },
    ));
    assert_eq!(
        single_activity(event.event.ingest(event.event_id)).action,
        Action::Edited
    );
}

#[test]
fn deleted_purges_the_session() {
    let event = envelope(AgentSessionLifecycleEvent::Deleted(
        SessionDeletedMetadata {
            identity: identity(),
        },
    ));
    assert_eq!(
        event.event.ingest(event.event_id),
        Ingest::Purge(vec![(EntityType::AgentSession, session_id())])
    );
}

#[test]
fn runtime_consequences_are_dropped() {
    let identity = identity();
    let action_id = agent_runtime_protocol::domain::action::AgentActionId::mint();
    let ignored = [
        AgentSessionLifecycleEvent::TurnEnded(TurnEndedMetadata {
            identity: identity.clone(),
            turn: TurnId(0),
            action_id: action_id.clone(),
            actor: Some(user("macro|owner@macro.com")),
            announcement_message_id: None,
            stop_reason: "end_turn".to_owned(),
            queued_remaining: 0,
        }),
        AgentSessionLifecycleEvent::Settled(SessionSettledMetadata {
            identity: identity.clone(),
            last_turn: None,
        }),
        AgentSessionLifecycleEvent::WaitingForInput(WaitingForInputMetadata {
            identity: identity.clone(),
            turn: TurnId(1),
            action_id: action_id.clone(),
            announcement_message_id: None,
            question: "Which approach?".to_owned(),
        }),
        AgentSessionLifecycleEvent::InputReceived(InputReceivedMetadata {
            identity: identity.clone(),
            turn: TurnId(1),
            action_id,
        }),
        AgentSessionLifecycleEvent::Stopped(SessionStoppedMetadata {
            identity,
            reason: "transport closed".to_owned(),
            turn_in_flight: None,
        }),
    ];

    for event in ignored {
        let envelope = envelope(event);
        assert_eq!(envelope.event.ingest(envelope.event_id), Ingest::Ignore);
    }
}
