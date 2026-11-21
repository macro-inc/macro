//! Advisory files the harness keeps in the agent's home on its computer,
//! written over the fleet's exec as `macro`: whether a person drives the
//! screen (`state/screen-driver`, `human`) and the computer's harness id
//! (`state/harness-id`). The agent can read both but they decide nothing:
//! the hold on its brain is enforced here, and the agent is frozen while a
//! person drives: [`GuestFiles`] asks the guest's root-owned pause helper
//! (`nix/macro-box/_agent.nix`) to freeze its unit before a take-over
//! starts, and to thaw it after. The driver file never names the person:
//! who drives reaches the agent by name, in its runtime notices.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use computer_screen::domain::models::{AgentNotPaused, Lease};
use computer_screen::domain::ports::DriverSignal;
use futures::StreamExt as _;
use harness_id::HarnessId;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::ports::GUEST_USER;
use tokio::io::AsyncReadExt as _;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use super::tunnel::GuestExec;

/// The agent's state directory, under its home.
const STATE_DIRECTORY: &str = "agent/state";
/// Says a person drives, while one does.
const SCREEN_DRIVER_FILE: &str = "screen-driver";
/// What the driver file says.
const DRIVER_CONTENTS: &str = "human";
/// The computer's harness id.
const HARNESS_ID_FILE: &str = "harness-id";
/// How long one write may take before it is given up.
const WRITE_TIMEOUT: Duration = Duration::from_secs(15);
/// Driver files written at once, to different computers: a few
/// unreachable ones don't hold up the rest.
const CONCURRENT_WRITES: usize = 8;

/// Write `$2` and a newline to `$1` atomically, unless it already says
/// that. A guest without the agent's state directory (a computer that is
/// not an agent's) is left alone.
const WRITE_SCRIPT: &str = r#"dir=$(dirname "$1"); [ -d "$dir" ] || exit 0; [ "$(cat "$1" 2>/dev/null)" = "$2" ] && exit 0; printf '%s\n' "$2" > "$1.tmp" && mv -f "$1.tmp" "$1""#;
const REMOVE_SCRIPT: &str = r#"rm -f "$1""#;
/// Ask the pause helper to `$1` (freeze or thaw) the agent. A computer
/// with no helper says `idle` when it isn't an agent's (nothing to pause),
/// and `failed` when it is (an image from before the helper).
const PAUSE_SCRIPT: &str = r#"sock=/run/macro-agent-pause.sock; if [ -S "$sock" ]; then printf '%s\n' "$1" | socat -t 25 - "UNIX-CONNECT:$sock"; elif [ -d "$2" ]; then echo failed; else echo idle; fi"#;
/// How long a freeze or thaw may take: systemd freezes a cgroup within a
/// few seconds.
const PAUSE_TIMEOUT: Duration = Duration::from_secs(30);
/// Tries at a thaw before it is left to the next release.
const THAW_ATTEMPTS: u32 = 3;
/// The wait between them.
const THAW_RETRY_AFTER: Duration = Duration::from_secs(2);
/// The most a helper says.
const MAX_ANSWER_BYTES: u64 = 64;

/// Each computer's latest driver-file change not yet written.
#[derive(Default)]
struct PendingChanges {
    latest: Mutex<HashMap<ComputerId, DriverChange>>,
    arrived: tokio::sync::Notify,
}

/// What the agent on a computer should be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wanted {
    Frozen,
    Running,
}

/// One computer's pause: what it should be, and the lock its freezes and
/// thaws take one at a time, so a late thaw never undoes a newer freeze.
#[derive(Debug)]
struct Pause {
    wanted: Mutex<Wanted>,
    turn: tokio::sync::Mutex<()>,
}

fn path(file: &str) -> String {
    format!("{}/{STATE_DIRECTORY}/{file}", GUEST_USER.home)
}

/// One change to a computer's driver file.
#[derive(Debug, Clone, Copy)]
enum DriverChange {
    Driving(ComputerId),
    Released(ComputerId),
}

/// The driver file, kept by one tracked worker off the request path (a
/// take-over, a hand-back or a held brain request never waits on it): only
/// each computer's latest change is written, a few computers at a time.
#[derive(Clone)]
pub struct GuestFiles {
    changes: Option<Arc<PendingChanges>>,
    exec: Option<Arc<dyn GuestExec>>,
    pauses: Arc<Mutex<HashMap<ComputerId, Arc<Pause>>>>,
    tasks: TaskTracker,
}

impl GuestFiles {
    /// Write through `exec`, on a worker tracked by `tasks` that stops with
    /// `shutdown`; without a fleet nothing is written.
    pub fn new(
        exec: Option<Arc<dyn GuestExec>>,
        tasks: &TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        let pauses = Arc::default();
        let Some(exec) = exec else {
            return Self {
                changes: None,
                exec: None,
                pauses,
                tasks: tasks.clone(),
            };
        };
        let writer = Arc::clone(&exec);
        let changes = Arc::new(PendingChanges::default());
        let pending = Arc::clone(&changes);
        tasks.spawn(async move {
            loop {
                tokio::select! {
                    () = shutdown.cancelled() => return,
                    () = pending.arrived.notified() => {}
                }
                let batch: Vec<DriverChange> = pending
                    .latest
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .drain()
                    .map(|(_, change)| change)
                    .collect();
                futures::stream::iter(batch)
                    .for_each_concurrent(CONCURRENT_WRITES, |change| {
                        write_change(writer.as_ref(), change)
                    })
                    .await;
            }
        });
        Self {
            changes: Some(changes),
            exec: Some(exec),
            pauses,
            tasks: tasks.clone(),
        }
    }

    fn pause(&self, computer: ComputerId) -> Arc<Pause> {
        let mut pauses = self
            .pauses
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Arc::clone(pauses.entry(computer).or_insert_with(|| {
            Arc::new(Pause {
                wanted: Mutex::new(Wanted::Running),
                turn: tokio::sync::Mutex::new(()),
            })
        }))
    }

    fn queue(&self, change: DriverChange) {
        let Some(changes) = &self.changes else {
            return;
        };
        let computer = match change {
            DriverChange::Driving(computer) | DriverChange::Released(computer) => computer,
        };
        changes
            .latest
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(computer, change);
        changes.arrived.notify_one();
    }
}

/// One write, in its own span.
async fn write_change(exec: &dyn GuestExec, change: DriverChange) {
    match change {
        DriverChange::Driving(computer) => {
            let span = tracing::info_span!("computer.screen.driver_file", computer.id = %computer, screen.driver_file = "write");
            run(
                exec,
                computer,
                &[
                    WRITE_SCRIPT,
                    path(SCREEN_DRIVER_FILE).as_str(),
                    DRIVER_CONTENTS,
                ],
            )
            .instrument(span)
            .await;
        }
        DriverChange::Released(computer) => {
            let span = tracing::info_span!("computer.screen.driver_file", computer.id = %computer, screen.driver_file = "remove");
            run(
                exec,
                computer,
                &[REMOVE_SCRIPT, path(SCREEN_DRIVER_FILE).as_str()],
            )
            .instrument(span)
            .await;
        }
    }
}

/// Record the computer's harness id for the agent, if it changed.
#[tracing::instrument(name = "computer.screen.harness_id_file", skip(exec), fields(computer.id = %computer, harness.id = %harness))]
pub async fn record_harness(exec: &dyn GuestExec, computer: ComputerId, harness: HarnessId) {
    run(
        exec,
        computer,
        &[
            WRITE_SCRIPT,
            path(HARNESS_ID_FILE).as_str(),
            harness.to_string().as_str(),
        ],
    )
    .await;
}

/// Run `sh -c <script> sh <args…>` for at most [`WRITE_TIMEOUT`]; a failure
/// is logged.
async fn run(exec: &dyn GuestExec, computer: ComputerId, script_and_args: &[&str]) {
    let Some((script, args)) = script_and_args.split_first() else {
        return;
    };
    let mut argv = vec!["sh", "-c", *script, "sh"];
    argv.extend_from_slice(args);

    let written = tokio::time::timeout(WRITE_TIMEOUT, async {
        let process = exec
            .exec(computer, &argv)
            .await
            .map_err(|error| error.to_string())?;
        // Nothing to say on stdin; the exit code is the answer.
        drop(process.stdin);
        drop(process.stdout);
        process.exit.await
    })
    .await;
    match written {
        Ok(Ok(0)) => {}
        Ok(Ok(code)) => tracing::warn!(code, "writing a guest file failed"),
        Ok(Err(error)) => tracing::warn!(error = %error, "writing a guest file failed"),
        Err(_) => tracing::warn!("writing a guest file timed out"),
    }
}

/// What the pause helper said.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PauseAnswer {
    /// The agent is frozen.
    Frozen,
    /// The agent is running.
    Running,
    /// No agent runs there, so nothing was frozen.
    Idle,
    /// It couldn't, or said something else.
    Failed,
}

/// Ask `computer`'s pause helper to `verb` the agent.
async fn ask_pause(exec: &dyn GuestExec, computer: ComputerId, verb: &str) -> PauseAnswer {
    let state = path("");
    let argv = [
        "sh",
        "-c",
        PAUSE_SCRIPT,
        "sh",
        verb,
        state.trim_end_matches('/'),
    ];
    let asked = tokio::time::timeout(PAUSE_TIMEOUT, async {
        let mut process = exec
            .exec(computer, &argv)
            .await
            .map_err(|error| error.to_string())?;
        drop(process.stdin);
        let mut answer = String::new();
        (&mut process.stdout)
            .take(MAX_ANSWER_BYTES)
            .read_to_string(&mut answer)
            .await
            .map_err(|error| error.to_string())?;
        drop(process.stdout);
        let code = process.exit.await?;
        Ok::<_, String>((code, answer))
    })
    .await;
    let answer = match asked {
        Ok(Ok((0, answer))) => match answer.trim() {
            "frozen" => PauseAnswer::Frozen,
            "running" => PauseAnswer::Running,
            "idle" => PauseAnswer::Idle,
            _ => PauseAnswer::Failed,
        },
        Ok(Ok((code, _))) => {
            tracing::warn!(code, "the agent's pause helper failed");
            PauseAnswer::Failed
        }
        Ok(Err(error)) => {
            tracing::warn!(error = %error, "the agent's pause helper failed");
            PauseAnswer::Failed
        }
        Err(_) => {
            tracing::warn!("the agent's pause helper timed out");
            PauseAnswer::Failed
        }
    };
    tracing::Span::current().record("screen.pause", tracing::field::debug(answer));
    answer
}

/// Thaw `computer`'s agent while it should run, a few times if it must.
async fn thaw(exec: Arc<dyn GuestExec>, computer: ComputerId, pause: Arc<Pause>) {
    for attempt in 0..THAW_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(THAW_RETRY_AFTER).await;
        }
        let _turn = pause.turn.lock().await;
        if *pause
            .wanted
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            != Wanted::Running
        {
            return;
        }
        let span = tracing::info_span!("computer.screen.thaw", computer.id = %computer, screen.attempt = attempt, screen.pause = tracing::field::Empty);
        let answer = ask_pause(exec.as_ref(), computer, "thaw")
            .instrument(span)
            .await;
        if matches!(answer, PauseAnswer::Running | PauseAnswer::Idle) {
            return;
        }
    }
    tracing::warn!(computer.id = %computer, "the agent stayed frozen after a hand-back");
}

impl DriverSignal for GuestFiles {
    async fn driving(&self, lease: &Lease) -> Result<(), AgentNotPaused> {
        let computer = lease.computer_id;
        let Some(exec) = &self.exec else {
            return Ok(());
        };
        let pause = self.pause(computer);
        *pause
            .wanted
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Wanted::Frozen;
        let answer = {
            let _turn = pause.turn.lock().await;
            let span = tracing::info_span!("computer.screen.freeze", computer.id = %computer, screen.pause = tracing::field::Empty);
            ask_pause(exec.as_ref(), computer, "freeze")
                .instrument(span)
                .await
        };
        match answer {
            PauseAnswer::Frozen | PauseAnswer::Idle => {
                self.queue(DriverChange::Driving(computer));
                Ok(())
            }
            PauseAnswer::Running | PauseAnswer::Failed => Err(AgentNotPaused),
        }
    }

    async fn released(&self, computer: ComputerId) {
        let Some(exec) = &self.exec else {
            return;
        };
        let pause = self.pause(computer);
        *pause
            .wanted
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Wanted::Running;
        self.tasks
            .spawn(thaw(Arc::clone(exec), computer, pause).in_current_span());
        self.queue(DriverChange::Released(computer));
    }
}

#[cfg(test)]
mod test;
