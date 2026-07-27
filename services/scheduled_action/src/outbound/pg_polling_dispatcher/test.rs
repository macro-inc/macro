use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use anyhow::Result;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use serde_json::json;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use super::{PgPollingDispatcher, PgPollingDispatcherLifecycle};
use crate::domain::models::{
    ActionExecutionRecord, ActionKind, InProgressExecution, Schedule, ScheduledAction,
};
use crate::domain::ports::{
    ScheduledActionDispatcher, ScheduledActionExecutor, ScheduledActionRepo,
};

struct FakeRepository {
    candidates: Vec<ScheduledAction>,
    cancellation_token: Option<CancellationToken>,
    poll_started: Semaphore,
}

impl FakeRepository {
    fn returning(candidates: Vec<ScheduledAction>) -> Self {
        Self {
            candidates,
            cancellation_token: None,
            poll_started: Semaphore::new(0),
        }
    }

    fn cancelling_before_return(
        candidates: Vec<ScheduledAction>,
        cancellation_token: CancellationToken,
    ) -> Self {
        Self {
            candidates,
            cancellation_token: Some(cancellation_token),
            poll_started: Semaphore::new(0),
        }
    }

    async fn wait_for_poll(&self) {
        self.poll_started
            .acquire()
            .await
            .expect("poll semaphore should remain open")
            .forget();
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
        self.poll_started.add_permits(1);
        if let Some(cancellation_token) = &self.cancellation_token {
            cancellation_token.cancel();
        }
        Ok(self.candidates.clone())
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

    async fn claim_action(&self, _id: &Uuid) -> Result<()> {
        Ok(())
    }

    async fn release_action(&self, _id: &Uuid) -> Result<()> {
        Ok(())
    }

    async fn create_execution_record(&self, _record: ActionExecutionRecord) -> Result<()> {
        Ok(())
    }

    async fn get_execution_records(&self, _action_id: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        Ok(Vec::new())
    }

    async fn update_next_run_at(&self, _id: &Uuid) -> Result<()> {
        Ok(())
    }

    async fn update_last_executed(&self, _id: &Uuid, _executed_at: DateTime<Utc>) -> Result<()> {
        Ok(())
    }
}

struct RecordingExecutor {
    execution_count: Arc<AtomicUsize>,
}

impl ScheduledActionExecutor for RecordingExecutor {
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        self.execution_count.fetch_add(1, Ordering::SeqCst);
        Ok(InProgressExecution {
            action_id: action.id.expect("test action should have an id"),
            chat_id: None,
        })
    }
}

struct GatedExecutor {
    execution_count: Arc<AtomicUsize>,
    first_execution_started: Arc<Semaphore>,
    release_first_execution: Arc<Semaphore>,
    first_execution_finished: Arc<AtomicBool>,
}

impl ScheduledActionExecutor for GatedExecutor {
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        let execution_index = self.execution_count.fetch_add(1, Ordering::SeqCst);
        if execution_index == 0 {
            self.first_execution_started.add_permits(1);
            self.release_first_execution
                .acquire()
                .await
                .expect("execution semaphore should remain open")
                .forget();
            self.first_execution_finished.store(true, Ordering::SeqCst);
        }

        Ok(InProgressExecution {
            action_id: action.id.expect("test action should have an id"),
            chat_id: None,
        })
    }
}

fn due_action() -> ScheduledAction {
    let now = Utc::now();
    ScheduledAction {
        id: Some(generate_uuid_v7()),
        owner: MacroUserIdStr::parse_from_str("macro|polling-dispatcher@test.com")
            .expect("test owner should be valid"),
        name: "test action".to_string(),
        schedule: Schedule::from_cron("0 * * * * *".to_string())
            .expect("test schedule should be valid"),
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        timezone: chrono_tz::UTC,
        task: json!({}),
        claimed: None,
        next_run_at: now - ChronoDuration::seconds(1),
        enabled: true,
    }
}

fn lifecycle() -> (CancellationToken, TaskTracker, PgPollingDispatcherLifecycle) {
    let cancellation_token = CancellationToken::new();
    let tracker = TaskTracker::new();
    let lifecycle = PgPollingDispatcherLifecycle::new(cancellation_token.clone(), tracker.clone());
    (cancellation_token, tracker, lifecycle)
}

async fn wait_for_tracker(tracker: &TaskTracker) {
    tokio::time::timeout(Duration::from_secs(1), tracker.wait())
        .await
        .expect("dispatcher tasks should stop after cancellation");
}

#[tokio::test]
async fn cancellation_interrupts_polling_delay_and_dispatch_event_drain() {
    let repository = Arc::new(FakeRepository::returning(Vec::new()));
    let executor = RecordingExecutor {
        execution_count: Arc::new(AtomicUsize::new(0)),
    };
    let (cancellation_token, tracker, lifecycle) = lifecycle();
    let dispatcher =
        PgPollingDispatcher::new(Arc::clone(&repository), executor).with_lifecycle(lifecycle);

    let (_dispatch_tx, _execution_rx) = dispatcher.begin_dispatch_loop();
    repository.wait_for_poll().await;

    cancellation_token.cancel();
    tracker.close();
    wait_for_tracker(&tracker).await;
}

#[tokio::test]
async fn cancellation_during_repository_poll_prevents_candidate_execution() {
    let (cancellation_token, tracker, lifecycle) = lifecycle();
    let repository = Arc::new(FakeRepository::cancelling_before_return(
        vec![due_action()],
        cancellation_token.clone(),
    ));
    let execution_count = Arc::new(AtomicUsize::new(0));
    let executor = RecordingExecutor {
        execution_count: Arc::clone(&execution_count),
    };
    let dispatcher = PgPollingDispatcher::new(repository, executor).with_lifecycle(lifecycle);

    let (_dispatch_tx, _execution_rx) = dispatcher.begin_dispatch_loop();
    tracker.close();
    wait_for_tracker(&tracker).await;

    assert_eq!(execution_count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancellation_allows_started_execution_to_finish_without_starting_another() {
    let repository = Arc::new(FakeRepository::returning(vec![due_action(), due_action()]));
    let execution_count = Arc::new(AtomicUsize::new(0));
    let first_execution_started = Arc::new(Semaphore::new(0));
    let release_first_execution = Arc::new(Semaphore::new(0));
    let first_execution_finished = Arc::new(AtomicBool::new(false));
    let executor = GatedExecutor {
        execution_count: Arc::clone(&execution_count),
        first_execution_started: Arc::clone(&first_execution_started),
        release_first_execution: Arc::clone(&release_first_execution),
        first_execution_finished: Arc::clone(&first_execution_finished),
    };
    let (cancellation_token, tracker, lifecycle) = lifecycle();
    let dispatcher = PgPollingDispatcher::new(repository, executor).with_lifecycle(lifecycle);

    let (_dispatch_tx, _execution_rx) = dispatcher.begin_dispatch_loop();
    first_execution_started
        .acquire()
        .await
        .expect("execution semaphore should remain open")
        .forget();

    cancellation_token.cancel();
    tracker.close();
    let wait = tracker.wait();
    tokio::pin!(wait);
    tokio::select! {
        () = &mut wait => panic!("tracker should wait for the in-flight execution"),
        () = tokio::task::yield_now() => {}
    }

    release_first_execution.add_permits(1);
    wait.await;

    assert!(first_execution_finished.load(Ordering::SeqCst));
    assert_eq!(execution_count.load(Ordering::SeqCst), 1);
}
