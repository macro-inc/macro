//! Advisory files the harness keeps in the agent's home on its computer,
//! written over the fleet's exec as `macro`: whether a person drives the
//! screen (`state/screen-driver`, `human`) and the computer's harness id
//! (`state/harness-id`). The agent can read both but they decide nothing:
//! the hold on its brain is enforced here. The driver file never names the
//! person: who drives reaches the agent by name, in its runtime notices.

use std::sync::Arc;
use std::time::Duration;

use computer_screen::domain::models::Lease;
use computer_screen::domain::ports::DriverSignal;
use harness_id::HarnessId;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::ports::GUEST_USER;
use tokio::sync::mpsc;
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
/// Driver-file changes waiting for the guest; more are dropped (and
/// logged), never waited on.
const PENDING_WRITES: usize = 64;

/// Write `$2` and a newline to `$1` atomically, unless it already says
/// that. A guest without the agent's state directory (a computer that is
/// not an agent's) is left alone.
const WRITE_SCRIPT: &str = r#"dir=$(dirname "$1"); [ -d "$dir" ] || exit 0; [ "$(cat "$1" 2>/dev/null)" = "$2" ] && exit 0; printf '%s\n' "$2" > "$1.tmp" && mv -f "$1.tmp" "$1""#;
const REMOVE_SCRIPT: &str = r#"rm -f "$1""#;

fn path(file: &str) -> String {
    format!("{}/{STATE_DIRECTORY}/{file}", GUEST_USER.home)
}

/// One change to a computer's driver file.
#[derive(Debug, Clone, Copy)]
enum DriverChange {
    Driving(ComputerId),
    Released(ComputerId),
}

/// The driver file, kept by one tracked worker that writes the changes in
/// order, off the request path: a take-over, a hand-back or a held brain
/// request never waits on the guest.
#[derive(Clone)]
pub struct GuestFiles {
    changes: Option<mpsc::Sender<DriverChange>>,
}

impl GuestFiles {
    /// Write through `exec`, on a worker tracked by `tasks` that stops with
    /// `shutdown`; without a fleet nothing is written.
    pub fn new(
        exec: Option<Arc<dyn GuestExec>>,
        tasks: &TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        let Some(exec) = exec else {
            return Self { changes: None };
        };
        let (changes, mut pending) = mpsc::channel(PENDING_WRITES);
        tasks.spawn(async move {
            loop {
                let change = tokio::select! {
                    () = shutdown.cancelled() => return,
                    change = pending.recv() => change,
                };
                let Some(change) = change else {
                    return;
                };
                write_change(exec.as_ref(), change).await;
            }
        });
        Self {
            changes: Some(changes),
        }
    }

    fn queue(&self, change: DriverChange) {
        let Some(changes) = &self.changes else {
            return;
        };
        if let Err(error) = changes.try_send(change) {
            tracing::warn!(error = %error, "dropped a screen driver file change");
        }
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

impl DriverSignal for GuestFiles {
    async fn driving(&self, lease: &Lease) {
        self.queue(DriverChange::Driving(lease.computer_id));
    }

    async fn released(&self, computer: ComputerId) {
        self.queue(DriverChange::Released(computer));
    }
}
