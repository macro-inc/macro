//! Drive one leased runtime update without sharing credentials with CI.

use chrono::Duration;

use super::{ComputerOperator, internal};
use crate::domain::agent::ComputerAgents;
use crate::domain::lifecycle::Phase;
use crate::domain::moves::ComputerMoves;
use crate::domain::ports::{ComputerRepo, Fleets, Harnesses, OvercommitRepo, SetupNotices};
use crate::domain::runtime_update::{GuestRuntimeUpdate, RuntimeUpdateOutcome, RuntimeUpdates};
use crate::domain::service::{Clock, ComputerError};

/// The guest's systemd operation plus recovery fits inside this bound.
const ATTEMPT: std::time::Duration = std::time::Duration::from_secs(14 * 60 + 30);
const LEASE: Duration = Duration::minutes(15);

impl<Repo, Machines, Registry, Time, SetupNotifier>
    ComputerOperator<Repo, Machines, Registry, Time, SetupNotifier>
where
    Repo: ComputerRepo + ComputerAgents + OvercommitRepo + ComputerMoves + RuntimeUpdates,
    Machines: Fleets,
    Machines::Fleet: GuestRuntimeUpdate,
    Registry: Harnesses,
    Time: Clock,
    SetupNotifier: SetupNotices,
{
    /// Advance one manual request in development.
    #[tracing::instrument(name = "computer.runtime_update.pass", skip_all, err)]
    pub async fn advance_runtime_update(
        &self,
        environment: macro_env::Environment,
    ) -> Result<(), ComputerError> {
        if !matches!(environment, macro_env::Environment::Develop) {
            return Ok(());
        }
        let holder = uuid::Uuid::new_v4();
        let Some(request) = self
            .repo
            .claim_runtime_update(holder, LEASE)
            .await
            .map_err(internal)?
        else {
            return Ok(());
        };
        let remaining = (request.deadline - self.clock.now())
            .to_std()
            .unwrap_or_default();

        let outcome = if remaining < ATTEMPT {
            RuntimeUpdateOutcome::Expired
        } else if !request.bundle.valid()
            || self
                .repo
                .agent_of(request.computer)
                .await
                .map_err(internal)?
                .is_none()
        {
            RuntimeUpdateOutcome::Refused
        } else if let Some(computer) = self
            .repo
            .get(request.computer)
            .await
            .map_err(internal)?
            .and_then(|record| record.healthy().cloned())
            .filter(|computer| {
                matches!(computer.state.phase, Phase::Running) && computer.hibernated_at.is_none()
            })
        {
            let fleet = self.fleet_for(computer.host).await?;
            // A lost connection does not establish the outcome. The lease
            // holds the computer through recovery, then a retry is safe.
            tokio::time::timeout(
                ATTEMPT,
                fleet.update_guest_runtime(request.computer, &request.bundle),
            )
            .await
            .map_err(internal)?
            .map_err(internal)?
        } else {
            RuntimeUpdateOutcome::Refused
        };

        if self
            .repo
            .finish_runtime_update(holder, request.id, outcome)
            .await
            .map_err(internal)?
        {
            tracing::info!(request_id = %request.id, computer_id = %request.computer, outcome = outcome.as_ref(), "runtime update completed");
        }
        Ok(())
    }
}
