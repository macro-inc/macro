//! Drive one leased runtime update without sharing credentials with CI.

use chrono::Duration;

use super::{ComputerOperator, internal};
use crate::domain::agent::ComputerAgents;
use crate::domain::lifecycle::Phase;
use crate::domain::models::ComputerRecord;
use crate::domain::moves::ComputerMoves;
use crate::domain::ports::{ComputerRepo, Fleets, Harnesses, OvercommitRepo, SetupNotices};
use crate::domain::runtime_update::{GuestRuntimeUpdate, RuntimeUpdateOutcome, RuntimeUpdates};
use crate::domain::service::{Clock, ComputerError};

/// The guest's systemd operation plus recovery fits inside this bound.
const ATTEMPT: std::time::Duration = std::time::Duration::from_secs(20 * 60);
const LEASE: Duration = Duration::minutes(21);

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
        let hosts = self.driven_hosts().await?;
        if hosts.is_empty() {
            return Ok(());
        }
        let holder = uuid::Uuid::new_v4();
        // Start before the claim so even query latency consumes the attempt.
        let attempt_deadline = tokio::time::Instant::now() + ATTEMPT;
        let Some(request) = self
            .repo
            .claim_runtime_update(holder, LEASE, &hosts)
            .await
            .map_err(internal)?
        else {
            return Ok(());
        };
        let remaining = (request.deadline - self.clock.now())
            .to_std()
            .unwrap_or_default();

        let Some(record) = self.repo.get(request.computer).await.map_err(internal)? else {
            // The computer's deletion also deletes the request.
            return Ok(());
        };
        let running = record.healthy().filter(|computer| {
            matches!(computer.state.phase, Phase::Running) && computer.hibernated_at.is_none()
        });
        let eligible = remaining >= ATTEMPT
            && request.bundle.valid()
            && self
                .repo
                .agent_of(request.computer)
                .await
                .map_err(internal)?
                .is_some();
        let outcome = if let Some(computer) = running.filter(|_| eligible) {
            let fleet = self.fleet_for(computer.host).await?;
            if attempt_deadline.saturating_duration_since(tokio::time::Instant::now())
                < ATTEMPT - std::time::Duration::from_secs(60)
                || request.deadline - self.clock.now() < Duration::minutes(20)
            {
                return Ok(());
            }
            // A lost connection does not establish the outcome. The lease
            // holds the computer through recovery, then a retry is safe.
            tokio::time::timeout_at(
                attempt_deadline,
                fleet.update_guest_runtime(request.computer, &request.bundle),
            )
            .await
            .map_err(internal)?
            .map_err(internal)?
        } else {
            if request.attempted {
                // The deadline stops new attempts. Let guest recovery finish
                // before releasing anything except the image recovery path.
                let settled = tokio::time::timeout_at(
                    attempt_deadline
                        .min(tokio::time::Instant::now() + std::time::Duration::from_secs(30)),
                    async {
                        let host = match record {
                            ComputerRecord::Healthy(computer) => Some(computer.host),
                            ComputerRecord::NeedsAttention { host_id, .. } => host_id,
                        }
                        .ok_or_else(|| {
                            ComputerError::Internal(rootcause::report!(
                                "cannot verify runtime update settlement without a host"
                            ))
                        })?;
                        let fleet = self.fleet_for(host).await?;
                        fleet
                            .runtime_update_settled(request.computer)
                            .await
                            .map_err(internal)
                    },
                )
                .await
                .map_err(internal)
                .and_then(|result| result);
                if let Err(error) = settled {
                    if self.clock.now() < request.deadline {
                        return Err(error);
                    }
                    if self
                        .repo
                        .defer_runtime_update_settlement(holder, request.id)
                        .await
                        .map_err(internal)?
                    {
                        tracing::warn!(request_id = %request.id, computer_id = %request.computer, "runtime update requires operator image recovery");
                    }
                    return Ok(());
                }
            }
            if remaining < ATTEMPT {
                RuntimeUpdateOutcome::Expired
            } else {
                RuntimeUpdateOutcome::Refused
            }
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
