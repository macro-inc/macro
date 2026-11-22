use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

use chrono::Utc;
use computer_screen::domain::models::{Driver, SessionId};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::computers::screen::tunnel::{GuestProgram, TunnelError, Woken};

const COMPUTER: ComputerId = ComputerId::new_from_uuid(uuid::Uuid::from_u128(0xC0));

/// A guest whose pause helper answers each verb as told, and records the
/// `verb drive` requests it got.
struct FakeHelper {
    answers: Mutex<HashMap<&'static str, &'static str>>,
    asked: Mutex<Vec<String>>,
}

impl FakeHelper {
    /// Freezes answer `freeze`, everything else what the helper says when it
    /// works.
    fn answering(freeze: &'static str) -> Self {
        Self {
            answers: Mutex::new(HashMap::from([
                ("freeze", freeze),
                ("keep", "frozen"),
                ("thaw", "running"),
            ])),
            asked: Mutex::new(Vec::new()),
        }
    }

    fn answer(&self, verb: &'static str, answer: &'static str) {
        self.answers.lock().unwrap().insert(verb, answer);
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
                let drive = argv.get(5).copied().unwrap_or_default();
                self.asked.lock().unwrap().push(format!("{verb} {drive}"));
                self.answers
                    .lock()
                    .unwrap()
                    .get(verb)
                    .copied()
                    .unwrap_or("refused")
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

/// Whether the computer runs, as set.
struct Power(Mutex<ComputerPower>);

impl ScreenWaker for Power {
    fn wake(
        &self,
        _harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = Result<Woken, TunnelError>> + Send + '_>> {
        Box::pin(async { Ok(Woken::Up) })
    }

    fn power(
        &self,
        _computer: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<ComputerPower, TunnelError>> + Send + '_>> {
        let power = *self.0.lock().unwrap();
        Box::pin(async move { Ok(power) })
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

/// The guest files over `helper` on a computer whose power `power` says,
/// with the shutdown that stops their worker.
fn files(
    helper: &Arc<FakeHelper>,
    power: &Arc<Power>,
    tasks: &TaskTracker,
) -> (GuestFiles, CancellationToken) {
    let shutdown = CancellationToken::new();
    let guest = Guest {
        exec: helper.clone(),
        power: power.clone(),
    };
    (
        GuestFiles::new(Some(guest), tasks, shutdown.clone()),
        shutdown,
    )
}

fn running() -> Arc<Power> {
    Arc::new(Power(Mutex::new(ComputerPower::Running)))
}

/// Wait for every task `tasks` started, once the worker is told to stop.
async fn settle(tasks: &TaskTracker, shutdown: &CancellationToken) {
    shutdown.cancel();
    tasks.close();
    tasks.wait().await;
}

#[tokio::test]
async fn a_take_over_freezes_the_agent_for_its_drive() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    let tasks = TaskTracker::new();
    let lease = lease();

    let (files, _) = files(&helper, &running(), &tasks);

    assert_eq!(files.driving(&lease).await, Ok(()));
    assert_eq!(
        helper.asked(),
        [format!("freeze {}", lease.drive_id().as_str())]
    );
}

#[tokio::test]
async fn an_agent_that_cannot_be_frozen_refuses_the_take_over() {
    for answer in ["failed", "running", "superseded", "something else"] {
        let helper = Arc::new(FakeHelper::answering(answer));
        let tasks = TaskTracker::new();
        let (files, _) = files(&helper, &running(), &tasks);

        assert_eq!(
            files.driving(&lease()).await,
            Err(AgentNotPaused),
            "{answer}"
        );
    }
}

#[tokio::test]
async fn a_computer_without_a_running_agent_has_nothing_to_freeze() {
    let helper = Arc::new(FakeHelper::answering("idle"));
    let tasks = TaskTracker::new();
    let (files, _) = files(&helper, &running(), &tasks);

    assert_eq!(files.driving(&lease()).await, Ok(()));
}

#[tokio::test]
async fn a_renewal_keeps_the_drive_frozen_in_the_guest() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    let tasks = TaskTracker::new();
    let (files, shutdown) = files(&helper, &running(), &tasks);
    let lease = lease();
    files.driving(&lease).await.unwrap();

    files.renewed(&lease).await;
    settle(&tasks, &shutdown).await;

    let drive = lease.drive_id();
    assert_eq!(
        helper.asked(),
        [
            format!("freeze {}", drive.as_str()),
            format!("keep {}", drive.as_str())
        ]
    );
}

#[tokio::test]
async fn a_hand_back_thaws_the_agent_for_its_drive() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    let tasks = TaskTracker::new();
    let (files, shutdown) = files(&helper, &running(), &tasks);
    let lease = lease();
    files.driving(&lease).await.unwrap();

    files.released(COMPUTER, lease.drive_id()).await;
    settle(&tasks, &shutdown).await;

    let drive = lease.drive_id();
    assert_eq!(
        helper.asked(),
        [
            format!("freeze {}", drive.as_str()),
            format!("thaw {}", drive.as_str())
        ]
    );
}

#[tokio::test]
async fn a_thaw_a_newer_drive_superseded_is_done() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    helper.answer("thaw", "superseded");
    let tasks = TaskTracker::new();
    let (files, _) = files(&helper, &running(), &tasks);

    assert_eq!(
        files.thaw(COMPUTER, &lease().drive_id()).await,
        Ok(Thawed::Superseded)
    );
}

#[tokio::test]
async fn a_sleeping_computer_is_never_execd_into_and_its_thaw_stays_owed() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    let tasks = TaskTracker::new();
    let power = Arc::new(Power(Mutex::new(ComputerPower::NotRunning)));
    let (files, _) = files(&helper, &power, &tasks);
    let drive = lease().drive_id();

    assert_eq!(
        files.thaw(COMPUTER, &drive).await,
        Err(ThawFailed::NotRunning)
    );
    assert!(helper.asked().is_empty());

    *power.0.lock().unwrap() = ComputerPower::Running;
    assert_eq!(files.thaw(COMPUTER, &drive).await, Ok(Thawed::Running));
}

#[tokio::test]
async fn a_thaw_the_guest_refuses_is_a_failure() {
    let helper = Arc::new(FakeHelper::answering("frozen"));
    helper.answer("thaw", "failed");
    let tasks = TaskTracker::new();
    let (files, _) = files(&helper, &running(), &tasks);

    assert_eq!(
        files.thaw(COMPUTER, &lease().drive_id()).await,
        Err(ThawFailed::Failed)
    );
}
