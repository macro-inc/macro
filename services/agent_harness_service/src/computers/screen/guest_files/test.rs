use std::future::Future;
use std::pin::Pin;

use chrono::Utc;
use computer_screen::domain::models::{Driver, SessionId};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::Notify;

use super::*;
use crate::computers::screen::tunnel::{GuestProgram, TunnelError};

const COMPUTER: ComputerId = ComputerId::new_from_uuid(uuid::Uuid::from_u128(0xC0));

/// A guest whose pause helper answers `freeze` and `thaw` as told, and
/// records the verbs it was asked; a freeze can be held until released.
struct FakeHelper {
    freeze_answer: &'static str,
    asked: Mutex<Vec<String>>,
    /// Told when a freeze starts; the freeze then waits for `hold_freeze`.
    freeze_started: Arc<Notify>,
    hold_freeze: Option<Arc<Notify>>,
}

impl FakeHelper {
    fn answering(freeze_answer: &'static str) -> Self {
        Self {
            freeze_answer,
            asked: Mutex::new(Vec::new()),
            freeze_started: Arc::new(Notify::new()),
            hold_freeze: None,
        }
    }

    fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

impl GuestExec for FakeHelper {
    fn exec<'a>(
        &'a self,
        _computer: ComputerId,
        argv: &'a [&'a str],
    ) -> Pin<Box<dyn Future<Output = Result<GuestProgram, TunnelError>> + Send + 'a>> {
        Box::pin(async move {
            let answer = if argv.get(2) == Some(&PAUSE_SCRIPT) {
                let verb = argv.get(4).copied().unwrap_or_default();
                self.asked.lock().unwrap().push(verb.to_owned());
                if verb == "freeze" {
                    self.freeze_started.notify_one();
                    if let Some(hold) = &self.hold_freeze {
                        hold.notified().await;
                    }
                    self.freeze_answer
                } else {
                    "running"
                }
            } else {
                ""
            };
            Ok(GuestProgram {
                stdin: Box::pin(tokio::io::sink()),
                stdout: Box::pin(std::io::Cursor::new(format!("{answer}\n").into_bytes())),
                exit: Box::pin(async { Ok(0) }),
            })
        })
    }
}

fn lease() -> Lease {
    Lease {
        computer_id: COMPUTER,
        session_id: SessionId::new(),
        driver: Driver {
            user_id: MacroUserIdStr::try_from("macro|alice@example.com".to_owned()).unwrap(),
            name: None,
        },
        agent_user_id: None,
        started_at: Utc::now(),
        expires_at: Utc::now(),
    }
}

/// The guest files over `helper`, with the shutdown that stops their
/// driver-file worker.
fn files(helper: &Arc<FakeHelper>, tasks: &TaskTracker) -> (GuestFiles, CancellationToken) {
    let exec: Arc<dyn GuestExec> = helper.clone();
    let shutdown = CancellationToken::new();
    (
        GuestFiles::new(Some(exec), tasks, shutdown.clone()),
        shutdown,
    )
}

/// Wait for every thaw `tasks` started, once the worker is told to stop.
async fn settle(tasks: &TaskTracker, shutdown: &CancellationToken) {
    shutdown.cancel();
    tasks.close();
    tasks.wait().await;
}

#[tokio::test]
async fn a_take_over_waits_for_the_agent_to_freeze() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    let tasks = TaskTracker::new();

    assert_eq!(files(&helper, &tasks).0.driving(&lease()).await, Ok(()));
    assert_eq!(helper.asked(), ["freeze"]);
}

#[tokio::test]
async fn an_agent_that_cannot_be_frozen_refuses_the_take_over() {
    for answer in ["failed", "running", "something else"] {
        let helper = Arc::new(FakeHelper::answering(answer));
        let tasks = TaskTracker::new();

        assert_eq!(
            files(&helper, &tasks).0.driving(&lease()).await,
            Err(AgentNotPaused),
            "{answer}"
        );
    }
}

#[tokio::test]
async fn a_computer_without_a_running_agent_has_nothing_to_freeze() {
    let helper = Arc::new(FakeHelper::answering("idle"));
    let tasks = TaskTracker::new();

    assert_eq!(files(&helper, &tasks).0.driving(&lease()).await, Ok(()));
}

#[tokio::test]
async fn a_hand_back_thaws_the_agent() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    let tasks = TaskTracker::new();
    let (files, shutdown) = files(&helper, &tasks);
    files.driving(&lease()).await.unwrap();

    files.released(COMPUTER).await;
    settle(&tasks, &shutdown).await;

    assert_eq!(helper.asked(), ["freeze", "thaw"]);
}

#[tokio::test]
async fn a_thaw_overtaken_by_a_new_take_over_leaves_the_agent_frozen() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    let tasks = TaskTracker::new();
    let (files, shutdown) = files(&helper, &tasks);

    // The hand-back's thaw is queued; a take-over freezes before it runs.
    files.released(COMPUTER).await;
    files.driving(&lease()).await.unwrap();
    settle(&tasks, &shutdown).await;

    assert_eq!(helper.asked(), ["freeze"]);
}

#[tokio::test]
async fn a_hand_back_during_a_freeze_thaws_after_it() {
    let hold = Arc::new(Notify::new());
    let helper = Arc::new(FakeHelper {
        hold_freeze: Some(Arc::clone(&hold)),
        ..FakeHelper::answering("frozen")
    });
    let tasks = TaskTracker::new();
    let (files, shutdown) = files(&helper, &tasks);

    let freezing = tokio::spawn({
        let files = files.clone();
        async move { files.driving(&lease()).await }
    });
    helper.freeze_started.notified().await;
    files.released(COMPUTER).await;
    hold.notify_one();
    freezing.await.unwrap().unwrap();
    settle(&tasks, &shutdown).await;

    assert_eq!(helper.asked(), ["freeze", "thaw"]);
}
