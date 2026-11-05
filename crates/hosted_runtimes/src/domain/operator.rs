//! The control plane: carries out fleet effects, fires timers, reconciles
//! the fleet with the rows, sleeps idle computers and turns macrod presence
//! into lifecycle events. Runs in agent_harness_service, next to the fleet.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use crate::domain::enrollment::Enrollment;
use crate::domain::lifecycle::{Effect, EffectWorker, Event, HostId, Phase};
use crate::domain::models::{Computer, EnrollmentDefaults, Host};
use crate::domain::ports::{ComputerRepo, Fleet, Harnesses, InstanceStatus, PendingEffect};
use crate::domain::service::{Clock, ComputerError};

#[cfg(test)]
mod test;

/// A computer whose sessions have been quiet this long is frozen.
pub const IDLE_AFTER: Duration = Duration::minutes(10);
/// A fleet effect is retried this many times before the computer fails.
pub const MAX_EFFECT_ATTEMPTS: u32 = 5;
const EFFECT_BATCH: u32 = 16;
const TIMER_BATCH: u32 = 64;
/// How long a leased effect stays hidden from other workers.
const EFFECT_LEASE: Duration = Duration::minutes(10);

fn internal<Err: std::error::Error + Send + Sync + 'static>(error: Err) -> ComputerError {
    ComputerError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Whether a harness's agent sessions are quiet.
pub trait SessionActivity: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;

    /// True when no turn is running on the harness and nothing happened in
    /// its sessions after `since`.
    fn is_idle_since(
        &self,
        harness_id: Uuid,
        since: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Drives one host's computers. V1 runs one fleet (one host) per control plane.
pub struct ComputerOperator<Repo, Machines, Registry, Time> {
    repo: Repo,
    fleet: Machines,
    harnesses: Registry,
    clock: Time,
    defaults: EnrollmentDefaults,
    host: HostId,
}

impl<Repo, Machines, Registry, Time> ComputerOperator<Repo, Machines, Registry, Time>
where
    Repo: ComputerRepo,
    Machines: Fleet,
    Registry: Harnesses,
    Time: Clock,
{
    /// Register the fleet's host (refreshing its capacity) and build the operator.
    #[tracing::instrument(skip_all, err)]
    pub async fn start(
        repo: Repo,
        fleet: Machines,
        harnesses: Registry,
        clock: Time,
        defaults: EnrollmentDefaults,
    ) -> Result<Self, ComputerError> {
        let registration = fleet.host().await.map_err(internal)?;
        let host: Host = repo.register_host(registration).await.map_err(internal)?;
        tracing::info!(
            host_id = %host.id,
            host = %host.name,
            awake_units = host.awake_capacity_units,
            sold_units = host.sold_capacity_units,
            "computer host registered"
        );

        Ok(Self {
            repo,
            fleet,
            harnesses,
            clock,
            defaults,
            host: host.id,
        })
    }

    /// Carry out due fleet effects; returns how many ran.
    #[tracing::instrument(skip(self), err)]
    pub async fn run_fleet_effects(&self) -> Result<usize, ComputerError> {
        let now = self.clock.now();
        let effects = self
            .repo
            .lease_effects(EffectWorker::Fleet, EFFECT_BATCH, now, now + EFFECT_LEASE)
            .await
            .map_err(internal)?;
        let count = effects.len();

        for pending in effects {
            self.run_one(pending).await?;
        }
        Ok(count)
    }

    #[tracing::instrument(
        skip(self, pending),
        fields(effect_id = pending.id, computer_id = %pending.computer_id, attempts = pending.attempts),
        err
    )]
    async fn run_one(&self, pending: PendingEffect) -> Result<(), ComputerError> {
        match self.carry_out(pending.computer_id, &pending.effect).await {
            Ok(follow_up) => {
                self.repo
                    .complete_effect(pending.id)
                    .await
                    .map_err(internal)?;
                if let Some(event) = follow_up {
                    self.repo
                        .apply(pending.computer_id, event, self.clock.now())
                        .await
                        .map_err(internal)?;
                }
            }
            Err(error) if pending.attempts + 1 < MAX_EFFECT_ATTEMPTS => {
                tracing::warn!(error = ?error, "computer effect failed; retrying");
                let backoff = Duration::seconds(10 * 2_i64.pow(pending.attempts));
                self.repo
                    .retry_effect(pending.id, error.to_string(), self.clock.now() + backoff)
                    .await
                    .map_err(internal)?;
            }
            Err(error) => {
                tracing::error!(error = ?error, "computer effect failed for good");
                self.repo
                    .complete_effect(pending.id)
                    .await
                    .map_err(internal)?;
                self.repo
                    .apply(
                        pending.computer_id,
                        Event::EffectFailed {
                            reason: error.to_string(),
                        },
                        self.clock.now(),
                    )
                    .await
                    .map_err(internal)?;
            }
        }
        Ok(())
    }

    /// Do one effect; returns the event that reports its completion, if any.
    async fn carry_out(
        &self,
        computer_id: Uuid,
        effect: &Effect,
    ) -> Result<Option<Event>, ComputerError> {
        if let Some(host) = effect_host(effect)
            && host != self.host
        {
            return Err(ComputerError::BadRequest(format!(
                "effect for host {host} reached the operator of {}",
                self.host
            )));
        }

        match effect {
            Effect::Create { start, .. } => {
                let computer = self.computer(computer_id).await?;
                let pairing = self
                    .harnesses
                    .create_hosted_pairing(&computer)
                    .await
                    .map_err(internal)?;
                let enrollment = Enrollment {
                    computer_id,
                    pairing_id: pairing.pairing_id,
                    device_secret: pairing.device_secret,
                    name: computer.name.clone(),
                    service_url_overrides: self.defaults.service_url_overrides.clone(),
                    persona: computer.persona.clone(),
                };
                self.fleet
                    .create(&computer, &enrollment, *start)
                    .await
                    .map_err(internal)?;
                Ok(Some(if *start {
                    Event::InstanceStarted
                } else {
                    Event::InstanceStopped
                }))
            }
            Effect::Start { .. } => {
                self.fleet.start(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::Resume { .. } => {
                self.fleet.resume(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::Restart { .. } => {
                self.fleet.restart(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::Freeze { .. } => {
                self.fleet.freeze(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::Unfreeze { .. } => {
                self.fleet.unfreeze(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::Suspend { .. } => {
                self.fleet.suspend(computer_id).await.map_err(internal)?;
                Ok(Some(Event::SnapshotSaved))
            }
            Effect::Stop { .. } => {
                self.fleet.stop(computer_id).await.map_err(internal)?;
                Ok(Some(Event::InstanceStopped))
            }
            Effect::Destroy { .. } => {
                self.fleet.destroy(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::MakeRoom { host } => {
                let coldest = self.repo.coldest_frozen(*host).await.map_err(internal)?;
                match coldest {
                    Some(coldest) => {
                        tracing::info!(suspended = %coldest, "suspending the coldest computer to make room");
                        self.repo
                            .apply(coldest, Event::SuspendDue, self.clock.now())
                            .await
                            .map_err(internal)?;
                    }
                    None => tracing::warn!(host_id = %host, "host is full and nothing is frozen"),
                }
                Ok(None)
            }
            Effect::RevokeHarness => {
                self.harnesses.revoke(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::PageOperator { reason } => {
                // Alerting keys on this event; see the crate's AGENTS.md.
                tracing::error!(computer_id = %computer_id, reason = %reason, "computer needs an operator");
                Ok(None)
            }
            Effect::RemoveBillingItem | Effect::ScheduleTimer { .. } => Err(
                ComputerError::BadRequest(format!("{effect:?} is not a fleet effect")),
            ),
        }
    }

    /// Fire due timers; returns how many fired.
    #[tracing::instrument(skip(self), err)]
    pub async fn fire_timers(&self) -> Result<usize, ComputerError> {
        let now = self.clock.now();
        let due = self
            .repo
            .due_timers(now, TIMER_BATCH)
            .await
            .map_err(internal)?;
        let count = due.len();
        for timer in due {
            let computer_id = timer.computer_id;
            self.repo
                .fire_timer(timer, now)
                .await
                .inspect_err(|error| tracing::warn!(computer_id = %computer_id, error = ?error, "timer failed"))
                .ok();
        }
        Ok(count)
    }

    /// Compare the fleet with the rows: a missing or stopped instance of an
    /// awake computer is a crash, and an instance without a computer is removed.
    #[tracing::instrument(skip(self), err)]
    pub async fn reconcile(&self) -> Result<(), ComputerError> {
        let instances: HashMap<Uuid, InstanceStatus> = self
            .fleet
            .instances()
            .await
            .map_err(internal)?
            .into_iter()
            .collect();
        let expected = self
            .repo
            .instances_expected(self.host)
            .await
            .map_err(internal)?;

        for computer in &expected {
            let observed = instances.get(&computer.id).copied();
            let crashed = match computer.state.phase {
                Phase::Running { .. } | Phase::Booting { .. } => {
                    observed.is_none() || observed == Some(InstanceStatus::Stopped)
                }
                Phase::Frozen { .. } => observed.is_none(),
                _ => false,
            };
            if crashed {
                tracing::warn!(computer_id = %computer.id, observed = ?observed, "computer instance drifted");
                self.repo
                    .apply(computer.id, Event::VmCrashed, self.clock.now())
                    .await
                    .map_err(internal)?;
            }
        }

        for orphan in instances.keys() {
            let known = expected.iter().any(|computer| computer.id == *orphan);
            if !known
                && self
                    .repo
                    .get(*orphan)
                    .await
                    .map_err(internal)?
                    .is_none_or(is_gone)
            {
                tracing::warn!(computer_id = %orphan, "destroying an instance with no computer");
                self.fleet.destroy(*orphan).await.map_err(internal)?;
            }
        }
        Ok(())
    }

    /// Freeze running computers whose sessions have been quiet for [`IDLE_AFTER`].
    #[tracing::instrument(skip(self, activity), err)]
    pub async fn sleep_idle<Activity: SessionActivity>(
        &self,
        activity: &Activity,
    ) -> Result<usize, ComputerError> {
        let since = self.clock.now() - IDLE_AFTER;
        let mut frozen = 0;
        for computer in self.repo.running().await.map_err(internal)? {
            let Some(harness_id) = computer.harness_id else {
                continue;
            };
            let idle = activity
                .is_idle_since(harness_id, since)
                .await
                .map_err(internal)?;
            if idle {
                self.repo
                    .apply(computer.id, Event::SessionsIdle, self.clock.now())
                    .await
                    .map_err(internal)?;
                frozen += 1;
            }
        }
        Ok(frozen)
    }

    /// The computer `harness_id` runs on, if any.
    async fn computer_of(&self, harness_id: Uuid) -> Result<Option<Uuid>, ComputerError> {
        self.harnesses
            .computer_for(harness_id)
            .await
            .map_err(internal)
    }

    /// macrod connected on `harness_id`. Returns whether it is a computer's.
    #[tracing::instrument(skip(self), err)]
    pub async fn macrod_connected(&self, harness_id: Uuid) -> Result<bool, ComputerError> {
        let Some(computer_id) = self.computer_of(harness_id).await? else {
            return Ok(false);
        };
        let computer = self.computer(computer_id).await?;
        let now = self.clock.now();
        self.repo
            .set_harness(computer.id, harness_id)
            .await
            .map_err(internal)?;
        self.repo
            .mark_enrolled(computer.id, now)
            .await
            .map_err(internal)?;
        self.repo
            .apply(computer.id, Event::MacrodConnected, now)
            .await
            .map_err(internal)?;
        // The pairing is claimed, so the code is useless; remove it anyway.
        self.fleet
            .clear_enrollment(computer.id)
            .await
            .inspect_err(|error| tracing::warn!(computer_id = %computer.id, error = ?error, "could not clear enrollment"))
            .ok();
        Ok(true)
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn macrod_disconnected(&self, harness_id: Uuid) -> Result<(), ComputerError> {
        if let Some(computer_id) = self.computer_of(harness_id).await? {
            self.repo
                .apply(computer_id, Event::MacrodDisconnected, self.clock.now())
                .await
                .map_err(internal)?;
        }
        Ok(())
    }

    /// A prompt is waiting for `harness_id`. Wakes its computer when it is
    /// asleep; returns whether the prompt must wait for macrod to connect.
    #[tracing::instrument(skip(self), err)]
    pub async fn prompt_arrived(&self, harness_id: Uuid) -> Result<bool, ComputerError> {
        let Some(computer_id) = self.computer_of(harness_id).await? else {
            return Ok(false);
        };
        let computer = self
            .repo
            .apply(computer_id, Event::PromptArrived, self.clock.now())
            .await
            .map_err(internal)?;
        Ok(computer.is_some_and(|computer| !matches!(computer.state.phase, Phase::Running { .. })))
    }

    async fn computer(&self, computer_id: Uuid) -> Result<Computer, ComputerError> {
        self.repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)
    }
}

fn is_gone(computer: Computer) -> bool {
    computer.state.phase == Phase::Destroyed
}

fn effect_host(effect: &Effect) -> Option<HostId> {
    match effect {
        Effect::Create { host, .. }
        | Effect::Start { host }
        | Effect::Freeze { host }
        | Effect::Unfreeze { host }
        | Effect::Suspend { host }
        | Effect::Resume { host }
        | Effect::Stop { host }
        | Effect::Restart { host }
        | Effect::Destroy { host }
        | Effect::MakeRoom { host } => Some(*host),
        Effect::RemoveBillingItem
        | Effect::RevokeHarness
        | Effect::ScheduleTimer { .. }
        | Effect::PageOperator { .. } => None,
    }
}
