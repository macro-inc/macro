use std::sync::Arc;
use std::sync::Mutex;

use ai_routines::AiRoutineTrigger;
use anyhow::Result;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use serde_json::{Value, json};

use super::KafkaRoutineExecutor;
use crate::domain::models::{
    ActionExecutionRecord, ActionKind, AlreadyRunningError, Schedule, ScheduledAction,
};
use crate::domain::ports::{ScheduledActionExecutor, ScheduledActionRepo};

#[derive(Default)]
struct RepoCalls {
    claimed: Vec<Uuid>,
    released: Vec<Uuid>,
    records: Vec<ActionExecutionRecord>,
    next_run_advanced: Vec<Uuid>,
    last_executed: Vec<Uuid>,
}

#[derive(Default)]
struct FakeRepository {
    calls: Mutex<RepoCalls>,
    claim_taken_elsewhere: bool,
}

impl FakeRepository {
    fn claim_taken_elsewhere() -> Self {
        Self {
            claim_taken_elsewhere: true,
            ..Self::default()
        }
    }

    fn calls(&self) -> std::sync::MutexGuard<'_, RepoCalls> {
        self.calls.lock().expect("repo lock poisoned")
    }
}

impl ScheduledActionRepo for FakeRepository {
    async fn create_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        Ok(action)
    }

    async fn get_actions(&self, _user_id: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        Ok(Vec::new())
    }

    async fn get_next_unclaimed_actions(&self, _limit: i64) -> Result<Vec<ScheduledAction>> {
        Ok(Vec::new())
    }

    async fn update_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        Ok(action)
    }

    async fn delete_action(
        &self,
        _id: &Uuid,
        _macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<()> {
        Ok(())
    }

    async fn claim_action(&self, id: &Uuid) -> Result<()> {
        if self.claim_taken_elsewhere {
            return Err(anyhow::Error::new(AlreadyRunningError { action_id: *id }));
        }
        self.calls().claimed.push(*id);
        Ok(())
    }

    async fn release_action(&self, id: &Uuid) -> Result<()> {
        self.calls().released.push(*id);
        Ok(())
    }

    async fn create_execution_record(&self, record: ActionExecutionRecord) -> Result<()> {
        self.calls().records.push(record);
        Ok(())
    }

    async fn get_execution_records(&self, _action_id: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        let mut records = self.calls().records.clone();
        records.sort_by(|left, right| right.start_time.cmp(&left.start_time));
        Ok(records)
    }

    async fn update_next_run_at(&self, id: &Uuid) -> Result<()> {
        self.calls().next_run_advanced.push(*id);
        Ok(())
    }

    async fn update_last_executed(&self, id: &Uuid, _executed_at: DateTime<Utc>) -> Result<()> {
        self.calls().last_executed.push(*id);
        Ok(())
    }
}

struct Published {
    topic: &'static str,
    key: String,
    payload: Value,
}

#[derive(Default)]
struct RecordingBroker {
    published: Mutex<Vec<Published>>,
}

impl RecordingBroker {
    fn published(&self) -> std::sync::MutexGuard<'_, Vec<Published>> {
        self.published.lock().expect("publish lock poisoned")
    }
}

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published().push(Published {
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
        Ok(tokio::spawn(async {
            Err(EventBrokerError::Publish("broker unavailable".to_owned()))
        }))
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|routine-owner@test.com")
        .expect("test owner should be valid")
}

fn due_action() -> ScheduledAction {
    let now = Utc::now();
    ScheduledAction {
        id: Some(generate_uuid_v7()),
        owner: owner(),
        name: "Morning digest".to_string(),
        schedule: Schedule::from_cron("0 * * * * *".to_string())
            .expect("test schedule should be valid"),
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        timezone: chrono_tz::UTC,
        task: json!({
            "model": "configured-model",
            "prompt": "You summarise the owner's inbox.",
            "user_prompt": "Summarise what arrived overnight.",
        }),
        claimed: None,
        next_run_at: now - ChronoDuration::seconds(1),
        enabled: true,
    }
}

fn executor<Broker>(
    repo: &Arc<FakeRepository>,
    broker: &Arc<Broker>,
    trigger: AiRoutineTrigger,
) -> KafkaRoutineExecutor<FakeRepository, Broker> {
    KafkaRoutineExecutor::new(Arc::clone(repo), Arc::clone(broker), trigger)
}

#[tokio::test]
async fn a_due_action_is_published_and_its_schedule_advanced() {
    let repo = Arc::new(FakeRepository::default());
    let broker = Arc::new(RecordingBroker::default());
    let action = due_action();
    let id = action.id.expect("test action should have an id");

    let execution = executor(&repo, &broker, AiRoutineTrigger::Schedule)
        .execute_action(action)
        .await
        .expect("a due action should dispatch");

    assert_eq!(execution.action_id, id);
    assert_eq!(execution.chat_id, None, "no chat is created any more");

    let published = broker.published();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.ai_routines");
    assert_eq!(event.key, id.to_string());
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["event_type"], "ai_routine.run_requested");
    let metadata = &event.payload["metadata"];
    assert_eq!(metadata["routine_id"], json!(id));
    assert_eq!(metadata["owner"], json!(owner()));
    assert_eq!(metadata["name"], "Morning digest");
    assert_eq!(metadata["model"], "configured-model");
    assert_eq!(metadata["prompt"], "You summarise the owner's inbox.");
    assert_eq!(metadata["user_prompt"], "Summarise what arrived overnight.");
    assert_eq!(metadata["trigger"], "schedule");
    let session_id = metadata["session_id"]
        .as_str()
        .expect("a firing names the session it opens");

    let calls = repo.calls();
    assert_eq!(calls.claimed, vec![id]);
    assert_eq!(calls.released, vec![id]);
    assert_eq!(calls.next_run_advanced, vec![id]);
    assert_eq!(calls.last_executed, vec![id]);
    assert_eq!(calls.records.len(), 1);
    let record = &calls.records[0];
    assert_eq!(record.action_id, id);
    assert!(record.is_success);
    assert_eq!(record.resource_id.as_deref(), Some(session_id));
    assert_eq!(record.result["status"], "dispatched");
    assert_eq!(record.result["event_id"], json!(event.payload["event_id"]));
}

#[tokio::test]
async fn a_manual_run_is_stamped_as_such() {
    let repo = Arc::new(FakeRepository::default());
    let broker = Arc::new(RecordingBroker::default());

    executor(&repo, &broker, AiRoutineTrigger::Manual)
        .execute_action(due_action())
        .await
        .expect("a manual run should dispatch");

    assert_eq!(
        broker.published()[0].payload["metadata"]["trigger"],
        "manual"
    );
}

#[tokio::test]
async fn a_failed_publish_is_recorded_and_the_claim_released() {
    let repo = Arc::new(FakeRepository::default());
    let broker = Arc::new(FailingBroker);
    let action = due_action();
    let id = action.id.expect("test action should have an id");

    let error = executor(&repo, &broker, AiRoutineTrigger::Schedule)
        .execute_action(action)
        .await
        .expect_err("a broker failure should surface");

    assert!(
        error.to_string().contains("broker unavailable"),
        "{error:?}"
    );
    let calls = repo.calls();
    assert_eq!(calls.claimed, vec![id]);
    assert_eq!(
        calls.released,
        vec![id],
        "the claim must not outlive the attempt"
    );
    assert_eq!(
        calls.next_run_advanced,
        vec![id],
        "a failed firing is still consumed"
    );
    assert_eq!(calls.records.len(), 1);
    let record = &calls.records[0];
    assert!(!record.is_success);
    assert_eq!(record.resource_id, None);
    assert_eq!(record.result["status"], "dispatch_failed");
    assert!(
        record.result["error"]
            .as_str()
            .unwrap_or_default()
            .contains("broker unavailable")
    );
}

#[tokio::test]
async fn an_action_claimed_elsewhere_is_not_published() {
    let repo = Arc::new(FakeRepository::default());
    let broker = Arc::new(RecordingBroker::default());
    let mut action = due_action();
    action.claimed = Some(Utc::now());

    let error = executor(&repo, &broker, AiRoutineTrigger::Schedule)
        .execute_action(action)
        .await
        .expect_err("a fresh claim elsewhere should reject the run");

    assert!(
        error.downcast_ref::<AlreadyRunningError>().is_some(),
        "{error:?}"
    );
    assert!(broker.published().is_empty());
    assert!(repo.calls().claimed.is_empty());
}

#[tokio::test]
async fn a_claim_race_lost_in_the_database_is_not_published() {
    let repo = Arc::new(FakeRepository::claim_taken_elsewhere());
    let broker = Arc::new(RecordingBroker::default());

    let error = executor(&repo, &broker, AiRoutineTrigger::Schedule)
        .execute_action(due_action())
        .await
        .expect_err("losing the claim should reject the run");

    assert!(
        error.downcast_ref::<AlreadyRunningError>().is_some(),
        "{error:?}"
    );
    assert!(broker.published().is_empty());
    assert!(repo.calls().records.is_empty());
}

#[tokio::test]
async fn a_malformed_task_is_rejected_before_the_claim() {
    let repo = Arc::new(FakeRepository::default());
    let broker = Arc::new(RecordingBroker::default());
    let mut action = due_action();
    action.task = json!({});

    executor(&repo, &broker, AiRoutineTrigger::Schedule)
        .execute_action(action)
        .await
        .expect_err("a task without prompts cannot be dispatched");

    assert!(broker.published().is_empty());
    let calls = repo.calls();
    assert!(
        calls.claimed.is_empty(),
        "nothing should be claimed for a task that cannot run"
    );
    assert!(calls.records.is_empty());
}

#[tokio::test]
async fn a_second_attempt_at_the_same_due_slot_does_not_publish_again() {
    let repo = Arc::new(FakeRepository::default());
    let broker = Arc::new(RecordingBroker::default());
    let action = due_action();

    executor(&repo, &broker, AiRoutineTrigger::Schedule)
        .execute_action(action.clone())
        .await
        .expect("the first attempt should dispatch");
    executor(&repo, &broker, AiRoutineTrigger::Schedule)
        .execute_action(action)
        .await
        .expect("the retry should finish bookkeeping");

    assert_eq!(
        broker.published().len(),
        1,
        "the same due slot must not open a second session"
    );
    let calls = repo.calls();
    assert_eq!(calls.next_run_advanced.len(), 2);
    assert_eq!(calls.records.len(), 1);
}
