//! Advisory files the harness keeps in the agent's home on its computer,
//! written over the fleet's exec as `macro`: who drives the screen
//! (`state/screen-driver`, `human:<user id>`) and the computer's harness id
//! (`state/harness-id`). The agent can read both but they decide nothing:
//! the hold on its brain is enforced here.

use std::sync::Arc;

use computer_screen::domain::models::Lease;
use computer_screen::domain::ports::DriverSignal;
use harness_id::HarnessId;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::ports::GUEST_USER;

use super::tunnel::GuestExec;

/// The agent's state directory, under its home.
const STATE_DIRECTORY: &str = "agent/state";
/// Who drives, while someone does.
const SCREEN_DRIVER_FILE: &str = "screen-driver";
/// The computer's harness id.
const HARNESS_ID_FILE: &str = "harness-id";

/// Write `$2` and a newline to `$1` atomically, unless it already says
/// that. A guest without the agent's state directory (a computer that is
/// not an agent's) is left alone.
const WRITE_SCRIPT: &str = r#"dir=$(dirname "$1"); [ -d "$dir" ] || exit 0; [ "$(cat "$1" 2>/dev/null)" = "$2" ] && exit 0; printf '%s\n' "$2" > "$1.tmp" && mv -f "$1.tmp" "$1""#;
const REMOVE_SCRIPT: &str = r#"rm -f "$1""#;

fn path(file: &str) -> String {
    format!("{}/{STATE_DIRECTORY}/{file}", GUEST_USER.home)
}

/// The guest files, over the fleet's exec; without a fleet nothing is
/// written.
#[derive(Clone)]
pub struct GuestFiles {
    exec: Option<Arc<dyn GuestExec>>,
}

impl GuestFiles {
    /// Write through `exec`.
    pub fn new(exec: Option<Arc<dyn GuestExec>>) -> Self {
        Self { exec }
    }

    /// Record the computer's harness id for the agent, if it changed.
    #[tracing::instrument(name = "computer.screen.harness_id_file", skip(self), fields(computer.id = %computer, harness.id = %harness))]
    pub async fn record_harness(&self, computer: ComputerId, harness: HarnessId) {
        self.run(
            computer,
            &[
                WRITE_SCRIPT,
                path(HARNESS_ID_FILE).as_str(),
                harness.to_string().as_str(),
            ],
        )
        .await;
    }

    /// Run `sh -c <script> sh <args…>`; a failure is logged.
    async fn run(&self, computer: ComputerId, script_and_args: &[&str]) {
        let Some(exec) = &self.exec else {
            return;
        };
        let Some((script, args)) = script_and_args.split_first() else {
            return;
        };
        let mut argv = vec!["sh", "-c", *script, "sh"];
        argv.extend_from_slice(args);

        let process = match exec.exec(computer, &argv).await {
            Ok(process) => process,
            Err(error) => {
                tracing::warn!(error = %error, "could not write a guest file");
                return;
            }
        };
        // Nothing to say on stdin; the exit code is the answer.
        drop(process.stdin);
        drop(process.stdout);
        match process.exit.await {
            Ok(0) => {}
            Ok(code) => tracing::warn!(code, "writing a guest file failed"),
            Err(error) => tracing::warn!(error = %error, "writing a guest file failed"),
        }
    }
}

impl DriverSignal for GuestFiles {
    #[tracing::instrument(name = "computer.screen.driver_file", skip_all, fields(computer.id = %lease.computer_id, screen.driver_file = "write"))]
    async fn driving(&self, lease: &Lease) {
        let contents = format!("human:{}", lease.driver.user_id);
        self.run(
            lease.computer_id,
            &[
                WRITE_SCRIPT,
                path(SCREEN_DRIVER_FILE).as_str(),
                contents.as_str(),
            ],
        )
        .await;
    }

    #[tracing::instrument(name = "computer.screen.driver_file", skip(self), fields(computer.id = %computer, screen.driver_file = "remove"))]
    async fn released(&self, computer: ComputerId) {
        self.run(
            computer,
            &[REMOVE_SCRIPT, path(SCREEN_DRIVER_FILE).as_str()],
        )
        .await;
    }
}
