//! Advisory files the harness keeps in the agent's home on its computer,
//! written over the fleet's exec as `macro`: whether a person drives the
//! screen (`state/screen-driver`, `human`) and the computer's harness id
//! (`state/harness-id`). The agent can read both but they decide nothing:
//! the hold on its brain is enforced here, and the agent is frozen while a
//! person drives: [`GuestFiles`] asks the guest's root-owned pause helper
//! (`nix/macro-box/files/macro-agent-pause`) to freeze its unit for a drive
//! before the take-over starts, keeps it frozen on each renewal (the guest
//! thaws it on its own otherwise), and thaws it for that drive after; the
//! guest fences every request by drive, so a late thaw never undoes a newer
//! freeze. The driver file never names the person: who drives reaches the
//! agent by name, in its runtime notices.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use computer_screen::domain::models::{AgentNotPaused, DriveId, Lease, ThawFailed, Thawed};
use computer_screen::domain::ports::DriverSignal;
use futures::StreamExt as _;
use harness_id::HarnessId;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::ports::GUEST_USER;
use tokio::io::AsyncReadExt as _;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use super::tunnel::{ComputerPower, GuestExec, ScreenWaker, TunnelError};

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
/// Ask the pause helper to `$1` (freeze, keep or thaw) the agent for drive
/// `$2`. A computer with no helper says `idle` when it isn't an agent's
/// (nothing to pause), and `failed` when it is (an image from before it).
const PAUSE_SCRIPT: &str = r#"sock=/run/macro-agent-pause/sock; if [ -S "$sock" ]; then printf '%s %s\n' "$1" "$2" | socat -t 25 - "UNIX-CONNECT:$sock"; elif [ -d "$3" ]; then echo failed; else echo idle; fi"#;
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
    guest: Option<Guest>,
    tasks: TaskTracker,
}

/// How the harness reaches computers' guests, and whether they run.
#[derive(Clone)]
pub struct Guest {
    /// The fleet's exec, as `macro`.
    pub exec: Arc<dyn GuestExec>,
    /// Whether a computer runs: a sleeping one is never exec'd into.
    pub power: Arc<dyn ScreenWaker>,
}

impl GuestFiles {
    /// Reach guests through `guest`, on a worker tracked by `tasks` that
    /// stops with `shutdown`; without a fleet nothing is written or frozen.
    pub fn new(guest: Option<Guest>, tasks: &TaskTracker, shutdown: CancellationToken) -> Self {
        let Some(guest) = guest else {
            return Self {
                changes: None,
                guest: None,
                tasks: tasks.clone(),
            };
        };
        let writer = Arc::clone(&guest.exec);
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
            guest: Some(guest),
            tasks: tasks.clone(),
        }
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
    /// A newer drive froze the agent since; this one is done.
    Superseded,
    /// The computer isn't running.
    Asleep,
    /// It couldn't, or said something else.
    Failed,
}

/// Ask `computer`'s pause helper to `verb` the agent for `drive`.
async fn ask_pause(
    exec: &dyn GuestExec,
    computer: ComputerId,
    verb: &str,
    drive: &DriveId,
) -> PauseAnswer {
    let state = path("");
    let argv = [
        "sh",
        "-c",
        PAUSE_SCRIPT,
        "sh",
        verb,
        drive.as_str(),
        state.trim_end_matches('/'),
    ];
    let asked = tokio::time::timeout(PAUSE_TIMEOUT, async {
        let mut process = match exec.exec(computer, &argv).await {
            Ok(process) => process,
            Err(TunnelError::ComputerOff) => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        drop(process.stdin);
        let mut answer = String::new();
        (&mut process.stdout)
            .take(MAX_ANSWER_BYTES)
            .read_to_string(&mut answer)
            .await
            .map_err(|error| error.to_string())?;
        drop(process.stdout);
        let code = process.exit.await?;
        Ok::<_, String>(Some((code, answer)))
    })
    .await;
    let answer = match asked {
        Ok(Ok(None)) => PauseAnswer::Asleep,
        Ok(Ok(Some((0, answer)))) => match answer.trim() {
            "frozen" => PauseAnswer::Frozen,
            "running" => PauseAnswer::Running,
            "idle" => PauseAnswer::Idle,
            "superseded" => PauseAnswer::Superseded,
            _ => PauseAnswer::Failed,
        },
        Ok(Ok(Some((code, _)))) => {
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

impl Guest {
    /// Thaw `computer`'s agent for `drive`, unless the computer sleeps.
    async fn thaw(&self, computer: ComputerId, drive: &DriveId) -> Result<Thawed, ThawFailed> {
        match self.power.power(computer).await {
            Ok(ComputerPower::Running) => {}
            Ok(ComputerPower::NotRunning) => return Err(ThawFailed::NotRunning),
            Err(error) => {
                tracing::warn!(error = %error, "could not tell whether the computer runs");
                return Err(ThawFailed::Failed);
            }
        }
        let span = tracing::info_span!("computer.screen.thaw", computer.id = %computer, screen.pause = tracing::field::Empty);
        match ask_pause(self.exec.as_ref(), computer, "thaw", drive)
            .instrument(span)
            .await
        {
            PauseAnswer::Running | PauseAnswer::Idle => Ok(Thawed::Running),
            PauseAnswer::Superseded => Ok(Thawed::Superseded),
            PauseAnswer::Asleep => Err(ThawFailed::NotRunning),
            PauseAnswer::Frozen | PauseAnswer::Failed => Err(ThawFailed::Failed),
        }
    }
}

impl DriverSignal for GuestFiles {
    async fn driving(&self, lease: &Lease) -> Result<(), AgentNotPaused> {
        let computer = lease.computer_id;
        let Some(guest) = &self.guest else {
            return Ok(());
        };
        let span = tracing::info_span!("computer.screen.freeze", computer.id = %computer, screen.pause = tracing::field::Empty);
        match ask_pause(guest.exec.as_ref(), computer, "freeze", &lease.drive_id())
            .instrument(span)
            .await
        {
            PauseAnswer::Frozen | PauseAnswer::Idle => {
                self.queue(DriverChange::Driving(computer));
                Ok(())
            }
            PauseAnswer::Running
            | PauseAnswer::Superseded
            | PauseAnswer::Asleep
            | PauseAnswer::Failed => Err(AgentNotPaused),
        }
    }

    async fn renewed(&self, lease: &Lease) {
        let Some(guest) = &self.guest else {
            return;
        };
        let (exec, computer, drive) =
            (Arc::clone(&guest.exec), lease.computer_id, lease.drive_id());
        let span = tracing::info_span!("computer.screen.keep_frozen", computer.id = %computer, screen.pause = tracing::field::Empty);
        self.tasks.spawn(
            async move {
                ask_pause(exec.as_ref(), computer, "keep", &drive).await;
            }
            .instrument(span),
        );
    }

    async fn released(&self, computer: ComputerId, drive: DriveId) {
        let Some(guest) = self.guest.clone() else {
            return;
        };
        // Tried a few times here; `ScreenService::reap` retries until the
        // guest answers, and the guest's own timer thaws it regardless.
        self.tasks.spawn(
            async move {
                for attempt in 0..THAW_ATTEMPTS {
                    if attempt > 0 {
                        tokio::time::sleep(THAW_RETRY_AFTER).await;
                    }
                    match guest.thaw(computer, &drive).await {
                        Ok(_) | Err(ThawFailed::NotRunning) => return,
                        Err(ThawFailed::Failed) => {}
                    }
                }
                tracing::warn!(computer.id = %computer, "the agent is still frozen after a hand-back; reaping retries");
            }
            .in_current_span(),
        );
        self.queue(DriverChange::Released(computer));
    }

    async fn thaw(&self, computer: ComputerId, drive: &DriveId) -> Result<Thawed, ThawFailed> {
        match &self.guest {
            Some(guest) => guest.thaw(computer, drive).await,
            None => Ok(Thawed::Running),
        }
    }
}

#[cfg(test)]
mod test;
