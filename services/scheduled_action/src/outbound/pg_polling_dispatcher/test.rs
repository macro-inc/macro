use std::collections::VecDeque;
use std::future::pending;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::Notify;

use super::*;
use crate::domain::models::{ActionExecutionRecord, ActionKind, Schedule, ScheduledAction};

struct TestRepo {
    responses: Mutex<VecDeque<Vec<ScheduledAction>>>,
    poll_count: AtomicUsize,
    polled: Notify,
}

impl TestRepo {
    fn new(responses: impl IntoIterator<Item = Vec<ScheduledAction>>) -> Self {
        Self {
            responses: Mutex::new(responses.into_iter().collect()),
            poll_count: AtomicUsize::new(0),
            polled: Notify::new(),
        }
    }

    async fn wait_for_polls(&self, expected: usize) {
        loop {
            let polled = self.polled.notified();
            if self.poll_count.load(Ordering::SeqCst) >= expected {
                return;
            }
            polled.await;
        }
    }
}

impl ScheduledActionRepo for TestRepo {
    async fn create_action(&self, _action: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn get_actions(&self, _user_id: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn get_next_unclaimed_actions(&self, _limit: i64) -> Result<Vec<ScheduledAction>> {
        self.poll_count.fetch_add(1, Ordering::SeqCst);
        self.polled.notify_waiters();
        Ok(self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_default())
    }

    async fn update_action(&self, _action: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn delete_action(
        &self,
        _id: &Uuid,
        _macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<()> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn claim_action(&self, _id: &Uuid) -> Result<()> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn release_action(&self, _id: &Uuid) -> Result<()> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn create_execution_record(&self, _record: ActionExecutionRecord) -> Result<()> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn get_execution_records(&self, _action_id: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn update_next_run_at(&self, _id: &Uuid) -> Result<()> {
        unimplemented!("not used by polling dispatcher tests")
    }

    async fn update_last_executed(
        &self,
        _id: &Uuid,
        _executed_at: chrono::DateTime<Utc>,
    ) -> Result<()> {
        unimplemented!("not used by polling dispatcher tests")
    }
}

struct NeverExecutor;

impl ScheduledActionExecutor for NeverExecutor {
    async fn execute_action(&self, _action: ScheduledAction) -> Result<InProgressExecution> {
        panic!("executor should not be called")
    }
}

struct BlockingExecutor {
    started: Arc<Notify>,
    cancelled: Arc<AtomicBool>,
}

impl ScheduledActionExecutor for BlockingExecutor {
    async fn execute_action(&self, _action: ScheduledAction) -> Result<InProgressExecution> {
        let _cancellation_guard = CancellationGuard(Arc::clone(&self.cancelled));
        self.started.notify_one();
        pending().await
    }
}

struct CancellationGuard(Arc<AtomicBool>);

impl Drop for CancellationGuard {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

struct PublishingExecutor {
    started: Arc<Notify>,
    publish_count: Arc<AtomicUsize>,
}

impl ScheduledActionExecutor for PublishingExecutor {
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        self.started.notify_one();
        tokio::time::sleep(Duration::from_secs(60)).await;
        self.publish_count.fetch_add(1, Ordering::SeqCst);

        Ok(InProgressExecution {
            action_id: action.id.expect("test action has an id"),
            chat_id: None,
        })
    }
}

#[tokio::test(start_paused = true)]
async fn managed_shutdown_stops_polling_and_event_draining() {
    let repo = Arc::new(TestRepo::new([Vec::new()]));
    let dispatcher = PgPollingDispatcher::new(Arc::clone(&repo), NeverExecutor);
    let (dispatch_sender, _execution_receiver, runtime) = dispatcher.begin_managed_dispatch_loop();

    repo.wait_for_polls(1).await;
    runtime.shutdown().await;

    assert!(
        dispatch_sender
            .send(DispatchEvent::Create(test_action()))
            .await
            .is_err(),
        "event receiver must be closed after its managed task stops"
    );

    tokio::time::advance(Duration::from_secs(90)).await;
    tokio::task::yield_now().await;
    assert_eq!(repo.poll_count.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn managed_shutdown_cancels_a_blocked_execution_within_its_bound() {
    let action = test_action();
    let repo = Arc::new(TestRepo::new([vec![action]]));
    let started = Arc::new(Notify::new());
    let cancelled = Arc::new(AtomicBool::new(false));
    let executor = BlockingExecutor {
        started: Arc::clone(&started),
        cancelled: Arc::clone(&cancelled),
    };
    let dispatcher = PgPollingDispatcher::new(repo, executor);
    let (_dispatch_sender, _execution_receiver, runtime) = dispatcher.begin_managed_dispatch_loop();

    started.notified().await;
    tokio::time::timeout(
        POLLING_DISPATCHER_SHUTDOWN_TIMEOUT + Duration::from_millis(1),
        runtime.shutdown(),
    )
    .await
    .expect("dispatcher shutdown must complete within its configured bound");

    assert!(cancelled.load(Ordering::SeqCst));
}

#[tokio::test(start_paused = true)]
async fn execution_cannot_publish_after_managed_runtime_completes() {
    let action = test_action();
    let repo = Arc::new(TestRepo::new([vec![action]]));
    let started = Arc::new(Notify::new());
    let publish_count = Arc::new(AtomicUsize::new(0));
    let executor = PublishingExecutor {
        started: Arc::clone(&started),
        publish_count: Arc::clone(&publish_count),
    };
    let dispatcher = PgPollingDispatcher::new(repo, executor);
    let (_dispatch_sender, _execution_receiver, runtime) = dispatcher.begin_managed_dispatch_loop();

    started.notified().await;
    runtime.shutdown().await;
    tokio::time::advance(Duration::from_secs(60)).await;
    tokio::task::yield_now().await;

    assert_eq!(publish_count.load(Ordering::SeqCst), 0);
}

fn test_action() -> ScheduledAction {
    let now = Utc::now();
    ScheduledAction {
        id: Some(Uuid::from_u128(1)),
        owner: MacroUserIdStr::parse_from_str("macro|scheduler-test@example.com").unwrap(),
        name: "test action".to_owned(),
        schedule: Schedule::from_cron("* * * * * *".to_owned()).unwrap(),
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        timezone: chrono_tz::UTC,
        task: serde_json::Value::Null,
        claimed: None,
        next_run_at: now - chrono::Duration::seconds(1),
        enabled: true,
    }
}
