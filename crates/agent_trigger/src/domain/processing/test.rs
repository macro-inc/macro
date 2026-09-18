use std::sync::Mutex;

use ai_routines::{AiRoutineMacroEvent, AiRoutineRunRequested, AiRoutineTrigger};
use chrono::Utc;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde_json::{Value, json};

use super::*;

struct Published {
    topic: &'static str,
    key: String,
    payload: Value,
}

#[derive(Default)]
struct RecordingBroker {
    published: Mutex<Vec<Published>>,
}

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published
            .lock()
            .expect("publish lock poisoned")
            .push(Published {
                topic: event.topic(),
                key: event.key().to_owned(),
                payload: serde_json::to_value(event.event())?,
            });
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

struct FailingBroker;

impl MacroEventBroker for FailingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        Err(EventBrokerError::Publish("broker unavailable".to_owned()))
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("routine-owner@macro.com").expect("a valid user id")
}

fn run_request() -> AiRoutineMacroEvent {
    AiRoutineMacroEvent::run_requested(AiRoutineRunRequested {
        routine_id: Uuid::from_u128(7),
        owner: owner(),
        name: "Morning digest".to_owned(),
        model: "configured-model".to_owned(),
        session_id: Uuid::from_u128(8),
        prompt: "You summarise the owner's inbox.".to_owned(),
        user_prompt: "Summarise what arrived overnight.".to_owned(),
        requested_at: Utc::now(),
        trigger: AiRoutineTrigger::Manual,
    })
}

#[tokio::test]
async fn a_run_request_opens_exactly_one_routine_session() {
    let broker = RecordingBroker::default();

    process_routine_event(&broker, &run_request())
        .await
        .expect("routine run should publish");

    let published = broker.published.lock().expect("publish lock poisoned");
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.agent_sessions");
    assert_eq!(event.key, Uuid::from_u128(7).to_string());
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["event_type"], "agent_trigger.new");
    assert_eq!(event.payload["metadata"]["source"], "routine");
    assert_eq!(
        event.payload["metadata"]["routine_id"],
        json!(Uuid::from_u128(7))
    );
    assert_eq!(event.payload["metadata"]["owner"], json!(owner()));
    assert_eq!(
        event.payload["metadata"]["user_prompt"],
        "Summarise what arrived overnight."
    );
    assert_eq!(event.payload["metadata"]["trigger"], "manual");
    assert_eq!(
        event.payload["metadata"]["session_id"],
        json!(Uuid::from_u128(8))
    );
}

#[tokio::test]
async fn a_publish_failure_is_reported_to_the_consumer() {
    let error = process_routine_event(&FailingBroker, &run_request())
        .await
        .expect_err("a broker failure should surface");

    assert!(
        matches!(error, ProcessRoutineEventError::Publish(_)),
        "{error:?}"
    );
}
