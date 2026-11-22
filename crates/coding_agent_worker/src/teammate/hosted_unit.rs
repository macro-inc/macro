//! The hosted backend of the lifecycle controller: on a Macro computer the
//! agent teammate runs in the hardened `macro-agent.service`, and macrod
//! starts and stops exactly that unit (and `macro-agent-apply.service`,
//! which installs a delivered `agent.env`) through `systemctl`, deciding
//! with `teammate_lifecycle`'s policy as the container backend does
//! (docs/design/teammate-runtime.md, *Lifecycle controller*, stage 4).
//!
//! - The unit says whether it is controlled: only one with `Restart=no`
//!   (the controller image's) is; an older image's unit restarts and counts
//!   on its own, and macrod leaves it alone.
//! - Before each start macrod writes `TEAMMATE_PREVIOUS_EXIT` to
//!   [`PREVIOUS_EXIT_FILE`], the unit's `EnvironmentFile`.
//! - `systemctl start --wait` starts the unit (or, already active, adopts
//!   it) and returns when it is inactive again; the exit is read from the
//!   unit's `ExecMainCode`/`ExecMainStatus`.
//! - A delivery installs the new `agent.env` (the apply unit is a oneshot:
//!   `start` returns once it is installed), then stops the agent as asked
//!   and starts it again.
//! - The policy's state is kept in a file, so a restarted macrod keeps its
//!   backoff and adopts an active unit instead of restarting it.

use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use nom::Parser as _;
use teammate_lifecycle::exit::{PREVIOUS_EXIT_VARIABLE, PreviousExit};
use teammate_lifecycle::runner::process::{self, Limits, ProcessError};
use teammate_lifecycle::supervisor::{Action, ExitEvent, PolicyState};
use tokio::sync::mpsc;
use tokio_util::task::AbortOnDropHandle;
use tracing::Instrument as _;

use super::supervisor::Clock;

#[cfg(test)]
mod test;

/// The agent's `EnvironmentFile`, written before each start.
pub const PREVIOUS_EXIT_FILE: &str = "/run/macro-agent/previous-exit";

/// How long a `systemctl` call other than the wait may take; a stop gets
/// the unit's own 90 s for the checkpoint on top.
const COMMAND_DEADLINE: Duration = Duration::from_secs(120);

/// A wait has no deadline: it lasts as long as the agent runs.
const WAIT_DEADLINE: Duration = Duration::from_secs(100 * 365 * 24 * 60 * 60);

/// The most `systemctl` output read.
const MAX_OUTPUT: usize = 64 * 1024;

/// The only units macrod manages; the polkit rule allows exactly these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Unit {
    /// The agent teammate.
    #[strum(serialize = "macro-agent.service")]
    Agent,
    /// Installs the delivered `agent.env` from macrod's inbox.
    #[strum(serialize = "macro-agent-apply.service")]
    Apply,
}

/// One `systemctl` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemctlCommand {
    /// Start the unit if it isn't active, then wait until it is inactive.
    StartAndWait(Unit),
    /// Start the unit; for a oneshot, until it has run.
    Start(Unit),
    /// Stop the unit (its `TimeoutStopSec` bounds the checkpoint).
    Stop(Unit),
    /// The properties [`UnitState`] reads.
    Show(Unit),
}

impl SystemctlCommand {
    /// The arguments after `systemctl`.
    pub fn arguments(self) -> Vec<&'static str> {
        match self {
            Self::StartAndWait(unit) => vec!["start", "--wait", unit.into()],
            Self::Start(unit) => vec!["start", unit.into()],
            Self::Stop(unit) => vec!["stop", unit.into()],
            Self::Show(unit) => vec![
                "show",
                "--property=ActiveState,Restart,ExecMainCode,ExecMainStatus",
                unit.into(),
            ],
        }
    }
}

/// A `systemctl` call that failed.
#[derive(Debug, thiserror::Error)]
#[error("systemctl {command:?}: {source}")]
pub struct SystemctlError {
    /// Which call.
    pub command: SystemctlCommand,
    /// How.
    #[source]
    pub source: ProcessError,
}

/// Runs `systemctl`.
pub trait Systemctl: Send + Sync + 'static {
    /// Run `command`; its stdout. A `StartAndWait` whose unit failed is
    /// not an error: its exit is read with `Show`.
    fn run(
        &self,
        command: SystemctlCommand,
    ) -> impl Future<Output = Result<String, SystemctlError>> + Send;
}

/// The system's `systemctl`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ProcessSystemctl;

impl Systemctl for ProcessSystemctl {
    async fn run(&self, command: SystemctlCommand) -> Result<String, SystemctlError> {
        let mut process = tokio::process::Command::new("systemctl");
        process.args(command.arguments());
        let deadline = match command {
            SystemctlCommand::StartAndWait(_) => WAIT_DEADLINE,
            SystemctlCommand::Start(_) | SystemctlCommand::Stop(_) | SystemctlCommand::Show(_) => {
                COMMAND_DEADLINE
            }
        };
        let limits = Limits {
            deadline,
            max_output: MAX_OUTPUT,
        };
        match process::run(process, limits).await {
            Ok(output) => Ok(String::from_utf8_lossy(&output).into_owned()),
            // The unit ended unsuccessfully: `Show` says how.
            Err(ProcessError::Failed { .. })
                if matches!(command, SystemctlCommand::StartAndWait(_)) =>
            {
                Ok(String::new())
            }
            Err(source) => Err(SystemctlError { command, source }),
        }
    }
}

/// What `Show` says about a unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnitState {
    /// Active, or on its way there or out (`activating`, `deactivating`,
    /// `reloading`).
    pub active: bool,
    /// `Restart=no`: the controller image's unit, which macrod controls.
    pub controlled: bool,
    /// The last run's exit: the code, or 128 + the signal that ended it;
    /// `None` when it never ran.
    pub last_exit: Option<u8>,
}

/// `ExecMainCode`: `CLD_EXITED`, `CLD_KILLED` and `CLD_DUMPED`.
const EXITED: u8 = 1;
const KILLED: u8 = 2;
const DUMPED: u8 = 3;

/// The `KEY=value` lines of `systemctl show`.
fn properties(text: &str) -> Vec<(&str, &str)> {
    text.lines()
        .filter_map(|line| {
            let mut property = (
                nom::bytes::complete::take_while1::<_, &str, nom::error::Error<&str>>(
                    |character: char| character.is_ascii_alphanumeric(),
                ),
                nom::bytes::complete::tag("="),
                nom::combinator::rest,
            );
            property
                .parse(line)
                .ok()
                .map(|(_, (key, _, value))| (key, value))
        })
        .collect()
}

impl UnitState {
    /// Read `systemctl show` output.
    pub fn parse(text: &str) -> Self {
        let properties = properties(text);
        let property = |key: &str| {
            properties
                .iter()
                .rev()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| *value)
        };
        let active = matches!(
            property("ActiveState"),
            Some("active" | "activating" | "deactivating" | "reloading")
        );
        let status = property("ExecMainStatus").and_then(|status| status.parse::<u8>().ok());
        let last_exit = match property("ExecMainCode").and_then(|code| code.parse::<u8>().ok()) {
            Some(EXITED) => status,
            Some(KILLED | DUMPED) => status.map(|signal| signal.saturating_add(128)),
            Some(_) | None => None,
        };
        Self {
            active,
            controlled: property("Restart") == Some("no"),
            last_exit,
        }
    }
}

/// Where the hosted backend keeps its files.
#[derive(Debug, Clone)]
pub struct HostedPaths {
    /// The policy's state, kept across macrod runs.
    pub policy: PathBuf,
    /// The unit's `EnvironmentFile` ([`PREVIOUS_EXIT_FILE`]).
    pub previous_exit: PathBuf,
}

/// The hosted agent's controller; dropping it stops controlling (the unit
/// keeps running and is adopted by the next macrod).
pub struct HostedAgent {
    deliveries: mpsc::UnboundedSender<()>,
    _task: AbortOnDropHandle<()>,
}

impl HostedAgent {
    /// Start controlling the agent's unit, if the unit is the controller
    /// image's.
    pub fn start(systemctl: impl Systemctl, paths: HostedPaths) -> Self {
        let (deliveries, received) = mpsc::unbounded_channel();
        Self {
            deliveries,
            _task: AbortOnDropHandle::new(tokio::spawn(control(systemctl, paths, received))),
        }
    }

    /// A new `agent.env` is in the inbox: install it and start the agent
    /// again on it.
    pub fn delivered(&self) {
        let _ = self.deliveries.send(());
    }
}

/// Run the policy over the unit until macrod ends.
async fn control(
    systemctl: impl Systemctl,
    paths: HostedPaths,
    mut deliveries: mpsc::UnboundedReceiver<()>,
) {
    let clock = Clock::new();
    let state = match systemctl.run(SystemctlCommand::Show(Unit::Agent)).await {
        Ok(text) => UnitState::parse(&text),
        Err(error) => {
            tracing::warn!(error = %error, "could not read the agent unit; not controlling it");
            return;
        }
    };
    if !state.controlled {
        tracing::info!("the agent unit restarts itself (an older image): macrod leaves it alone");
        return;
    }

    let mut policy = read_policy(&paths);
    let mut action = policy.resume(state.active, clock.now());
    keep_policy(&paths, &policy);
    loop {
        action = match action {
            Action::Start { after, .. } => {
                tokio::select! {
                    () = tokio::time::sleep(after) => run(&systemctl, &paths, &mut policy, &clock, &mut deliveries, true).await,
                    delivery = deliveries.recv() => match delivery {
                        Some(()) => deliver(&systemctl, &mut policy, &clock).await,
                        None => return,
                    },
                }
            }
            Action::Adopt => {
                tracing::info!("adopting the active agent unit");
                run(
                    &systemctl,
                    &paths,
                    &mut policy,
                    &clock,
                    &mut deliveries,
                    false,
                )
                .await
            }
            Action::Failed(_) | Action::Stopped | Action::Nothing => {
                match deliveries.recv().await {
                    Some(()) => deliver(&systemctl, &mut policy, &clock).await,
                    None => return,
                }
            }
        };
        keep_policy(&paths, &policy);
    }
}

/// Start the unit (unless adopting it) and wait for its end. A delivery
/// meanwhile installs the new environment and stops the agent as asked.
async fn run(
    systemctl: &impl Systemctl,
    paths: &HostedPaths,
    policy: &mut PolicyState,
    clock: &Clock,
    deliveries: &mut mpsc::UnboundedReceiver<()>,
    start: bool,
) -> Action {
    let span = tracing::info_span!(
        "teammate.start",
        backend = "hosted_unit",
        previous_exit = tracing::field::Empty,
    );
    if start {
        let previous = policy.started(clock.now());
        span.record("previous_exit", tracing::field::display(previous));
        keep_policy(paths, policy);
        if let Err(error) = write_previous_exit(&paths.previous_exit, previous) {
            // The unit refuses to start without it: backed off like a crash.
            tracing::warn!(error = %error, "could not write the agent's previous exit");
        }
    }
    let waited = systemctl
        .run(SystemctlCommand::StartAndWait(Unit::Agent))
        .instrument(span);
    let mut waited = std::pin::pin!(waited);
    let mut requested = false;
    let ended = loop {
        tokio::select! {
            ended = &mut waited => break ended,
            delivery = deliveries.recv(), if !requested => {
                if delivery.is_none() {
                    return Action::Nothing;
                }
                if apply(systemctl).await {
                    requested = true;
                    if let Err(error) = systemctl.run(SystemctlCommand::Stop(Unit::Agent)).await {
                        tracing::warn!(error = %error, "could not stop the agent for its new environment");
                    }
                }
            }
        }
    };
    if let Err(error) = &ended {
        tracing::warn!(error = %error, "lost the agent unit");
    }
    let code = match systemctl.run(SystemctlCommand::Show(Unit::Agent)).await {
        Ok(text) => UnitState::parse(&text).last_exit,
        Err(_) => None,
    };
    tracing::info!(exit = ?code, requested, "the agent unit ended");
    let action = policy.exited(ExitEvent { code, requested }, clock.now());
    if requested {
        // Stopped for its new environment: started again at once.
        return policy.redelivered(clock.now());
    }
    action
}

/// Install the delivered environment, then start again from wherever the
/// policy is (a failed or stopped agent too).
async fn deliver(systemctl: &impl Systemctl, policy: &mut PolicyState, clock: &Clock) -> Action {
    if !apply(systemctl).await {
        return policy.resume(false, clock.now());
    }
    policy.redelivered(clock.now())
}

/// Run the apply unit; whether it installed the environment.
async fn apply(systemctl: &impl Systemctl) -> bool {
    let span = tracing::info_span!("teammate.apply", backend = "hosted_unit");
    match systemctl
        .run(SystemctlCommand::Start(Unit::Apply))
        .instrument(span)
        .await
    {
        Ok(_) => true,
        Err(error) => {
            tracing::warn!(error = %error, "could not install the agent's new environment");
            false
        }
    }
}

fn write_previous_exit(path: &std::path::Path, previous: PreviousExit) -> std::io::Result<()> {
    let partial = path.with_extension("partial");
    std::fs::write(&partial, format!("{PREVIOUS_EXIT_VARIABLE}={previous}\n"))?;
    std::fs::rename(&partial, path)
}

/// The kept policy; a missing or unreadable one starts fresh (an unknown
/// last exit, which counts nothing twice).
fn read_policy(paths: &HostedPaths) -> PolicyState {
    std::fs::read(&paths.policy)
        .ok()
        .and_then(|contents| serde_json::from_slice(&contents).ok())
        .unwrap_or_default()
}

fn keep_policy(paths: &HostedPaths, policy: &PolicyState) {
    let kept = serde_json::to_vec(policy)
        .map_err(std::io::Error::other)
        .and_then(|contents| {
            let partial = paths.policy.with_extension("partial");
            std::fs::write(&partial, contents)?;
            std::fs::rename(&partial, &paths.policy)
        });
    if let Err(error) = kept {
        tracing::warn!(error = %error, "could not keep the agent's lifecycle");
    }
}
