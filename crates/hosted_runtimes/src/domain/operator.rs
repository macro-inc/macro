//! The control plane: carries out fleet effects, fires timers, reconciles
//! the fleet with the rows and turns macrod presence into lifecycle events. Runs in agent_harness_service, next to the fleet.

use harness_id::HarnessId;

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};

use crate::domain::claude_sign_in::{self, ClaudeSignInNotices, ClaudeSignInPass, ClaudeSignIns};
use crate::domain::enrollment::{Enrollment, EnrollmentGeneration, EnrollmentIssueError};
use crate::domain::ids::{ComputerId, PairingId};
use crate::domain::lifecycle::{
    Backoff, Effect, EffectWorker, Event, Failure, HostId, MACROD_GRACE, Phase, TimerKind, backoff,
};
use crate::domain::models::HostRecord;
use crate::domain::models::{Computer, ComputerRecord};
use crate::domain::ports::{
    ComputerRepo, DefaultAgent, Fleet, FleetEnrollment, FleetError, FleetHandle, FleetInstance,
    Fleets, Harnesses, HostScope, InstanceStatus, PendingEffect, SetupNotice, SetupNotices,
};
use crate::domain::service::{Clock, ComputerError};

mod effects;
mod hosts;
mod moves;
mod relief;
#[cfg(test)]
mod test;

pub use relief::{DispatchWake, Wake};

/// A fleet effect is retried this many times before the computer fails.
pub const MAX_EFFECT_ATTEMPTS: u32 = 5;
/// Retries of a failed fleet effect: 10 s doubling to 10 min.
pub const FLEET_EFFECT_BACKOFF: Backoff = Backoff {
    first: std::time::Duration::from_secs(10),
    max: std::time::Duration::from_secs(10 * 60),
};
/// Retries of host registration: 10 s doubling to 1 min.
pub const HOST_REGISTRATION_BACKOFF: Backoff = Backoff {
    first: std::time::Duration::from_secs(10),
    max: std::time::Duration::from_secs(60),
};
/// How soon a fleet effect of a computer held by a move is tried again.
pub const MOVE_HOLD_RETRY: Duration = Duration::seconds(10);
/// Minimum guest age before orphan deletion, to avoid racing creation.
pub const ORPHAN_GRACE: Duration = Duration::minutes(10);
const EFFECT_BATCH: u32 = 16;
const TIMER_BATCH: u32 = 64;
/// How long a leased effect stays hidden from other workers.
const EFFECT_LEASE: Duration = Duration::minutes(10);
/// Includes lease acquisition, fleet I/O and persistence; less than the lease.
const EFFECT_DEADLINE: std::time::Duration = std::time::Duration::from_secs(8 * 60);
/// Bound composite fleet calls below both the batch deadline and the lease.
const FLEET_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(7 * 60);
/// Shutdown waits for the active effect before cancelling it and returning its lease.
const EFFECT_DRAIN: std::time::Duration = std::time::Duration::from_secs(30);

fn internal<Err: std::error::Error + Send + Sync + 'static>(error: Err) -> ComputerError {
    ComputerError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Drives every host's computers through [`Fleets`]: each host row it
/// drives (every Firecracker host), or the local home host its environment
/// configures, which registers itself.
pub struct ComputerOperator<Repo, Machines, Registry, Time, SetupNotifier> {
    repo: Repo,
    fleet: Machines,
    harnesses: Registry,
    notices: SetupNotifier,
    clock: Time,
    deployment: std::sync::Arc<dyn crate::domain::enrollment::DeploymentSource>,
    host: tokio::sync::Mutex<HostReadiness>,
    relief: relief::Relief,
}

#[derive(Default)]
struct HostReadiness {
    id: Option<HostId>,
    retry_at: Option<DateTime<Utc>>,
    failures: u8,
}

impl<Repo, Machines, Registry, Time, SetupNotifier>
    ComputerOperator<Repo, Machines, Registry, Time, SetupNotifier>
where
    Repo: ComputerRepo
        + crate::domain::agent::ComputerAgents
        + crate::domain::ports::OvercommitRepo
        + crate::domain::moves::ComputerMoves,
    Machines: Fleets,
    Registry: Harnesses,
    Time: Clock,
    SetupNotifier: SetupNotices,
{
    /// Build the operator; unavailable host discovery is retried by its passes.
    #[tracing::instrument(skip_all, err)]
    pub async fn start(
        repo: Repo,
        fleet: Machines,
        harnesses: Registry,
        notices: SetupNotifier,
        clock: Time,
        deployment: std::sync::Arc<dyn crate::domain::enrollment::DeploymentSource>,
    ) -> Result<Self, ComputerError> {
        let operator = Self {
            repo,
            fleet,
            harnesses,
            notices,
            clock,
            deployment,
            host: tokio::sync::Mutex::new(HostReadiness::default()),
            relief: relief::Relief::default(),
        };
        // Fleet connectivity is independent of the harness's other routes.
        // Keep the operator so its periodic passes can recover registration.
        let _ = operator.home_host().await;
        Ok(operator)
    }

    /// Fire due timers; returns how many fired.
    pub async fn fire_timers(&self) -> Result<usize, ComputerError> {
        let hosts = self.driven_hosts().await?;
        let now = self.clock.now();
        let due = self
            .repo
            .due_timers(HostScope::Only(hosts), now, TIMER_BATCH)
            .await
            .map_err(internal)?;
        let count = due.len();
        for timer in due {
            let computer_id = timer.computer_id;
            let computer = self
                .repo
                .get(computer_id)
                .await
                .ok()
                .flatten()
                .and_then(|record| record.into_healthy().ok());
            let instance_status = match (&computer, timer.kind) {
                (Some(computer), TimerKind::MacrodMissing) => {
                    let fleet = self.fleet_for(computer.host).await?;
                    fleet
                        .instances()
                        .await
                        .map_err(internal)?
                        .into_iter()
                        .find(|instance| {
                            instance.computer_id == computer_id
                                && &instance.control_plane_id == fleet.control_plane_id()
                        })
                        .map(|instance| instance.status)
                }
                _ => None,
            };
            use tracing::Instrument;
            let span = tracing::info_span!("computer.timer", computer_id = %computer_id, kind = timer.kind.as_ref());
            if let Some(computer) = &computer {
                super::telemetry::adopt(&span, &computer.state);
            }
            self.repo
                .fire_timer(timer, instance_status, now)
                .instrument(span)
                .await
                .inspect_err(|error| tracing::warn!(computer_id = %computer_id, error = ?error, "timer failed"))
                .ok();
        }
        Ok(count)
    }

    /// Tell signers and team admins about Claude sign-ins running out; see
    /// [`claude_sign_in`](crate::domain::claude_sign_in).
    pub async fn notify_claude_sign_ins<SignIns, Notices>(
        &self,
        sign_ins: &SignIns,
        notices: &Notices,
    ) -> Result<ClaudeSignInPass, ComputerError>
    where
        SignIns: ClaudeSignIns,
        Notices: ClaudeSignInNotices,
    {
        claude_sign_in::notify_due(self.clock.now(), sign_ins, notices)
            .await
            .map_err(internal)
    }

    /// Every awake computer that has a harness, as `(harness, computer)`:
    /// the ones whose Claude sign-in state the control plane refreshes.
    pub async fn awake_computers(&self) -> Result<Vec<(HarnessId, ComputerId)>, ComputerError> {
        self.repo.awake_computers().await.map_err(internal)
    }

    /// The computer `harness_id` runs on, if any.
    async fn computer_of(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, ComputerError> {
        self.harnesses
            .computer_for(harness_id)
            .await
            .map_err(internal)
    }

    /// Whether the team finished the guided setup of the computer `harness_id`
    /// runs on; `None` when it is not a computer's.
    pub async fn setup_completed(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<bool>, ComputerError> {
        let Some(computer_id) = self.computer_of(harness_id).await? else {
            return Ok(None);
        };
        Ok(Some(
            self.computer(computer_id)
                .await?
                .setup_completed_at
                .is_some(),
        ))
    }

    /// macrod connected on `harness_id`, able to take an agent teammate or
    /// not: whether it is a computer's, and whether connecting bound the
    /// computer's first agent to it.
    #[tracing::instrument(skip(self), err)]
    pub async fn macrod_connected(
        &self,
        harness_id: HarnessId,
        applies_agent: bool,
    ) -> Result<MacrodConnected, ComputerError> {
        self.relief.macrod_connected(harness_id);
        let Some(computer_id) = self.computer_of(harness_id).await? else {
            return Ok(MacrodConnected::NotAComputer);
        };
        let computer = self.computer(computer_id).await?;
        use tracing::Instrument;
        let span = tracing::info_span!("computer.macrod.connected", computer_id = %computer.id, team_id = %computer.team_id, first = computer.enrolled_at.is_none());
        super::telemetry::adopt(&span, &computer.state);
        self.record_macrod_connected(harness_id, computer, applies_agent)
            .instrument(span)
            .await
    }

    async fn record_macrod_connected(
        &self,
        harness_id: HarnessId,
        computer: Computer,
        applies_agent: bool,
    ) -> Result<MacrodConnected, ComputerError> {
        let now = self.clock.now();
        let event = if applies_agent {
            Event::MacrodConnected
        } else {
            if computer.state.awaiting_agent
                && !crate::domain::lifecycle::gave_up(&computer.state.phase)
            {
                tracing::error!(
                    computer_id = %computer.id,
                    "computer macrod cannot take an agent teammate"
                );
            }
            Event::MacrodConnectedWithoutAgentHandOff
        };
        self.repo
            .set_harness(computer.id, harness_id)
            .await
            .map_err(internal)?;
        self.repo
            .mark_enrolled(computer.id, now)
            .await
            .map_err(internal)?;
        self.repo
            .apply(computer.id, event, now)
            .await
            .map_err(internal)?;
        let mut connected = MacrodConnected::Computer;
        if computer.enrolled_at.is_none() {
            super::telemetry::provisioned(
                (now - computer.created_at).num_milliseconds() as f64 / 1000.0,
            );
            // A convenience: the span records a failure, and setup carries on.
            // An agent teammate's computer is the agent's; it gets no coding agent.
            if let Ok(Some(DefaultAgent::Created { .. })) = self
                .create_default_agent_unless_teammate(&computer, harness_id)
                .await
            {
                connected = MacrodConnected::AgentBound;
            }
        }
        // The pairing is claimed, so the code is useless; remove it anyway.
        let fleet = self.fleet_for(computer.host).await?;
        fleet
            .clear_enrollment(computer.id)
            .await
            .inspect_err(|error| tracing::warn!(computer_id = %computer.id, error = ?error, "could not clear enrollment"))
            .ok();
        Ok(connected)
    }

    /// Give the team its first agent on a computer that just became ready.
    /// Only the first connection asks, so an agent the team deleted or moved
    /// is never recreated.
    #[tracing::instrument(
        name = "computer.default_agent",
        skip_all,
        fields(computer_id = %computer.id, team_id = %computer.team_id, harness_id = %harness_id, outcome = tracing::field::Empty),
        err
    )]
    /// The default coding agent, on computers bought without an agent teammate.
    async fn create_default_agent_unless_teammate(
        &self,
        computer: &Computer,
        harness_id: HarnessId,
    ) -> Result<Option<DefaultAgent>, ComputerError> {
        if self
            .repo
            .agent_of(computer.id)
            .await
            .map_err(internal)?
            .is_some()
        {
            tracing::info!(computer_id = %computer.id, "an agent teammate's computer gets no default coding agent");
            return Ok(None);
        }
        self.create_default_agent(computer, harness_id)
            .await
            .map(Some)
    }

    async fn create_default_agent(
        &self,
        computer: &Computer,
        harness_id: HarnessId,
    ) -> Result<DefaultAgent, ComputerError> {
        let outcome = self
            .harnesses
            .create_default_agent(computer, harness_id)
            .await
            .map_err(internal)?;
        if let DefaultAgent::Created { agent_id } = outcome {
            self.repo
                .set_default_agent(computer.id, agent_id)
                .await
                .map_err(internal)?;
        }
        let name: &'static str = outcome.into();
        tracing::Span::current().record("outcome", name);
        Ok(outcome)
    }

    /// Record a lost macrod connection for the guest harness.
    #[tracing::instrument(skip(self), err)]
    pub async fn macrod_disconnected(&self, harness_id: HarnessId) -> Result<(), ComputerError> {
        if let Some(computer_id) = self.computer_of(harness_id).await? {
            self.repo
                .apply(computer_id, Event::MacrodDisconnected, self.clock.now())
                .await
                .map_err(internal)?;
        }
        Ok(())
    }

    async fn computer(&self, computer_id: ComputerId) -> Result<Computer, ComputerError> {
        self.repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?
            .into_healthy()
            .map_err(|_| ComputerError::NeedsAttention)
    }
}

/// What macrod connecting on a harness did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacrodConnected {
    /// The harness is not a computer's.
    NotAComputer,
    /// A computer's macrod connected; the agents bound to it are unchanged.
    Computer,
    /// A computer's macrod connected and its first agent was bound to it.
    AgentBound,
}

impl MacrodConnected {
    /// Whether the harness is a computer's.
    #[must_use]
    pub fn is_computer(self) -> bool {
        !matches!(self, Self::NotAComputer)
    }
}
