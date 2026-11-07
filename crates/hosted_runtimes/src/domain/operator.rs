//! The control plane: carries out fleet effects, fires timers, reconciles
//! the fleet with the rows, sleeps idle computers and turns macrod presence
//! into lifecycle events. Runs in agent_harness_service, next to the fleet.

use harness_id::HarnessId;

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};

use crate::domain::enrollment::{Enrollment, PersonaConfigKey};
use crate::domain::ids::{ComputerId, PairingId};
use crate::domain::lifecycle::{
    Effect, EffectWorker, Event, HostId, MACROD_GRACE, Phase, TimerKind,
};
use crate::domain::models::{Computer, ComputerRecord, EnrollmentDefaults};
use crate::domain::persona_credentials::{EnrollmentGeneration, PersonaCredentialError};
use crate::domain::ports::{
    ComputerRepo, Fleet, FleetEnrollment, FleetError, FleetInstance, Harnesses, InstanceStatus,
    PendingEffect, PersonaCredentialSource,
};
use crate::domain::service::{Clock, ComputerError};

#[cfg(test)]
mod test;

/// A session-only computer whose sessions have been quiet this long is frozen.
pub const IDLE_AFTER: Duration = Duration::minutes(10);
/// A fleet effect is retried this many times before the computer fails.
pub const MAX_EFFECT_ATTEMPTS: u32 = 5;
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

/// Whether a harness's agent sessions are quiet.
pub trait SessionActivity: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// True when no turn is running on the harness and nothing happened in
    /// its sessions after `since`.
    fn is_idle_since(
        &self,
        harness_id: HarnessId,
        since: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Drives one host's computers. V1 runs one fleet (one host) per control plane.
pub struct ComputerOperator<Repo, Machines, Registry, Time, Credentials> {
    credentials: Credentials,
    repo: Repo,
    fleet: Machines,
    harnesses: Registry,
    clock: Time,
    defaults: EnrollmentDefaults,
    host: tokio::sync::Mutex<HostReadiness>,
}

#[derive(Default)]
struct HostReadiness {
    id: Option<HostId>,
    retry_at: Option<DateTime<Utc>>,
    failures: u32,
}

impl<Repo, Machines, Registry, Time, Credentials>
    ComputerOperator<Repo, Machines, Registry, Time, Credentials>
where
    Repo: ComputerRepo,
    Machines: Fleet,
    Registry: Harnesses,
    Time: Clock,
    Credentials: PersonaCredentialSource,
{
    /// Build the operator; unavailable host discovery is retried by its passes.
    #[tracing::instrument(skip_all, err)]
    pub async fn start(
        repo: Repo,
        fleet: Machines,
        harnesses: Registry,
        clock: Time,
        defaults: EnrollmentDefaults,
        credentials: Credentials,
    ) -> Result<Self, ComputerError> {
        let operator = Self {
            credentials,
            repo,
            fleet,
            harnesses,
            clock,
            defaults,
            host: tokio::sync::Mutex::new(HostReadiness::default()),
        };
        // Fleet connectivity is independent of the harness's other routes.
        // Keep the operator so its periodic passes can recover registration.
        let _ = operator.host_id().await;
        Ok(operator)
    }

    async fn host_id(&self) -> Result<HostId, ComputerError> {
        let mut readiness = self.host.lock().await;
        if let Some(id) = readiness.id {
            return Ok(id);
        }
        let now = self.clock.now();
        if readiness.retry_at.is_some_and(|at| now < at) {
            return Err(ComputerError::Internal(rootcause::report!(
                "computer host unhealthy; waiting to retry registration"
            )));
        }
        let registration = async {
            let registration = self.fleet.host().await.map_err(internal)?;
            self.repo
                .register_host(registration)
                .await
                .map_err(internal)
        }
        .await;
        match registration {
            Ok(host) => {
                self.repo
                    .postpone_macrod_timers(host.id, self.clock.now() + MACROD_GRACE)
                    .await
                    .map_err(internal)?;
                tracing::info!(host_id = %host.id, host = %host.name, healthy = true,
                    awake_units = host.awake_capacity_units, sold_units = host.sold_capacity_units,
                    "computer host registered");
                readiness.id = Some(host.id);
                readiness.retry_at = None;
                Ok(host.id)
            }
            Err(error) => {
                let retry_seconds = (10 * 2_i64.pow(readiness.failures.min(3))).min(60);
                readiness.failures = readiness.failures.saturating_add(1);
                readiness.retry_at = Some(self.clock.now() + Duration::seconds(retry_seconds));
                tracing::error!(error = ?error, healthy = false, retry_seconds,
                    "computer host unavailable; retrying registration");
                Err(error)
            }
        }
    }

    /// Carry out due fleet effects; returns how many ran.
    pub async fn run_fleet_effects(&self) -> Result<usize, ComputerError> {
        self.run_fleet_effects_until(std::future::pending()).await
    }

    /// Stop leasing on shutdown, drain the active effect, then return unfinished leases.
    /// Every effect in the batch shares a deadline measured before leasing, so
    /// queued effects and slow composite fleet calls cannot outlive their lease.
    #[tracing::instrument(skip_all, err)]
    pub async fn run_fleet_effects_until(
        &self,
        shutdown: impl Future<Output = ()> + Send,
    ) -> Result<usize, ComputerError> {
        let mut shutdown = std::pin::pin!(shutdown);
        tokio::select! {
            biased;
            () = &mut shutdown => return Ok(0),
            result = self.host_id() => { result?; }
        }
        let deadline = tokio::time::Instant::now() + EFFECT_DEADLINE;
        let now = self.clock.now();
        let lease_until = now + EFFECT_LEASE;
        // Never cancel a lease query: the database might commit it after its
        // future is dropped, leaving an untracked lease until expiry.
        let effects = self
            .repo
            .lease_effects(EffectWorker::Fleet, EFFECT_BATCH, now, lease_until)
            .await
            .map_err(internal)?;
        let ids: Vec<i64> = effects.iter().map(|effect| effect.id).collect();
        let mut count = 0;
        let mut outcome = Ok(());
        for pending in effects {
            tokio::select! {
                biased;
                () = &mut shutdown => break,
                () = std::future::ready(()) => {}
            }
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            let mut stopping = false;
            let result = {
                let work = async {
                    use tracing::Instrument;
                    let computer = self.computer(pending.computer_id).await?;
                    let span = tracing::info_span!("computer.fleet.work", computer_id = %pending.computer_id, team_id = %computer.team_id, size = computer.size.as_ref());
                    super::telemetry::attach(
                        &span,
                        computer.state.provision_traceparent.as_deref(),
                    );
                    self.run_one(pending).instrument(span).await
                };
                let mut running = std::pin::pin!(tokio::time::timeout_at(deadline, work));
                tokio::select! {
                    result = &mut running => Some(result),
                    () = &mut shutdown => {
                        stopping = true;
                        tracing::info!("draining computer effect");
                        tokio::time::timeout(EFFECT_DRAIN, &mut running).await.ok()
                    }
                }
            }; // Drop the effect future before making its lease available again.
            count += 1;
            match result {
                Some(Ok(Ok(()))) => {}
                Some(Ok(Err(error))) => {
                    outcome = Err(error);
                    break;
                }
                Some(Err(error)) => {
                    outcome = Err(internal(error));
                    break;
                }
                None => {
                    tracing::warn!("computer effect drain deadline reached; returning leases");
                    break;
                }
            }
            if stopping {
                break;
            }
        }
        self.repo
            .release_effects(&ids, lease_until, self.clock.now())
            .await
            .map_err(internal)?;
        outcome?;
        Ok(count)
    }

    #[tracing::instrument(
        skip(self, pending),
        fields(effect_id = pending.id, computer_id = %pending.computer_id, attempts = i64::from(pending.attempts), effect, team_id, size, otel.status_code),
        err
    )]
    async fn run_one(&self, pending: PendingEffect) -> Result<(), ComputerError> {
        let computer = self.computer(pending.computer_id).await?;
        super::telemetry::resume(computer.state.provision_traceparent.as_deref());
        tracing::Span::current().record("team_id", tracing::field::display(computer.team_id));
        tracing::Span::current().record("size", computer.size.as_ref());
        let phase = serde_json::to_value(&pending.effect).map_err(internal)?;
        let phase = phase
            .get("effect")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        tracing::Span::current().record("effect", phase);
        let result = tokio::time::timeout(
            FLEET_CALL_TIMEOUT,
            self.carry_out(pending.computer_id, &pending.effect),
        )
        .await
        .map_err(internal)
        .and_then(std::convert::identity);
        match result {
            Ok(follow_up) => {
                self.repo
                    .finish_effect(pending.id, follow_up, self.clock.now())
                    .await
                    .map_err(internal)?;
            }
            Err(error) if pending.attempts + 1 < MAX_EFFECT_ATTEMPTS => {
                super::telemetry::effect_failed(phase);
                tracing::warn!(error = ?error, "computer effect failed; retrying");
                let backoff = Duration::seconds(10 * 2_i64.pow(pending.attempts));
                self.repo
                    .retry_effect(pending.id, error.to_string(), self.clock.now() + backoff)
                    .await
                    .map_err(internal)?;
            }
            Err(error) => {
                super::telemetry::effect_failed(phase);
                tracing::error!(error = ?error, "computer effect failed for good");
                self.repo
                    .finish_effect(
                        pending.id,
                        Some(Event::EffectFailed {
                            reason: error.to_string(),
                        }),
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
        computer_id: ComputerId,
        effect: &Effect,
    ) -> Result<Option<Event>, ComputerError> {
        let registered_host = self.host_id().await?;
        if let Some(host) = effect_host(effect)
            && host != registered_host
        {
            return Err(ComputerError::BadRequest(format!(
                "effect for host {host} reached the operator of {}",
                registered_host
            )));
        }

        match effect {
            Effect::Create {
                start, generation, ..
            } => {
                // An expired effect lease may have been acquired by another replica.
                // The same guard also fences the harness claim transaction.
                let _guard = self
                    .repo
                    .lock_enrollment(computer_id)
                    .await
                    .map_err(internal)?;
                let computer = self.computer(computer_id).await?;
                if *generation < computer.enrollment_generation {
                    return Ok(None);
                }
                if computer.enrollment_generation != *generation {
                    return Err(ComputerError::BadRequest(
                        "invalid enrollment generation".to_owned(),
                    ));
                }
                let enrollment = CreateEnrollment {
                    harnesses: &self.harnesses,
                    credentials: &self.credentials,
                    defaults: &self.defaults,
                    computer: &computer,
                    generation: *generation,
                };
                let result = self
                    .fleet
                    .create(&computer, *generation, &enrollment, *start)
                    .await;
                fleet_completion(
                    result,
                    Some(if *start {
                        Event::InstanceStarted
                    } else {
                        Event::InstanceStopped
                    }),
                )
            }
            Effect::Start { .. } => fleet_completion(self.fleet.start(computer_id).await, None),
            Effect::Resume { .. } => fleet_completion(self.fleet.resume(computer_id).await, None),
            // Crash recovery must not reboot a guest whose start succeeded
            // before the previous worker lost its completion write.
            Effect::Restart { .. } => fleet_completion(self.fleet.start(computer_id).await, None),
            Effect::RestartMacrod { .. } => {
                let computer = self.computer(computer_id).await?;
                if computer.state.macrod_connected
                    || computer.state.macrod_misses < crate::domain::lifecycle::MAX_MACROD_MISSES
                    || !matches!(
                        computer.state.phase,
                        Phase::Booting { .. } | Phase::Running { .. }
                    )
                {
                    return Ok(None);
                }
                fleet_completion(self.fleet.restart_macrod(computer_id).await, None)
            }
            Effect::Freeze { .. } => fleet_completion(self.fleet.freeze(computer_id).await, None),
            Effect::Unfreeze { .. } => {
                fleet_completion(self.fleet.unfreeze(computer_id).await, None)
            }
            Effect::Suspend { .. } => fleet_completion(
                self.fleet.suspend(computer_id).await,
                Some(Event::SnapshotSaved),
            ),
            Effect::Stop { .. } => fleet_completion(
                self.fleet.stop(computer_id).await,
                Some(Event::InstanceStopped),
            ),
            Effect::Destroy { .. } => {
                self.fleet.destroy(computer_id).await.map_err(internal)?;
                Ok(None)
            }
            Effect::MakeRoom { host } => {
                if !self
                    .computer(computer_id)
                    .await?
                    .state
                    .waiting_for_capacity()
                {
                    return Ok(None);
                }
                let coldest = self.repo.coldest_frozen(*host).await.map_err(internal)?;
                match coldest {
                    Some(coldest) => {
                        tracing::info!(suspended = %coldest, "suspending the coldest computer to make room");
                        self.repo
                            .apply(coldest, Event::SuspendDue, self.clock.now())
                            .await
                            .map_err(internal)?;
                    }
                    None => {
                        return Ok(Some(Event::RoomUnavailable));
                    }
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
            Effect::ConfirmPayment { .. }
            | Effect::RemoveBillingItem
            | Effect::ScheduleTimer { .. } => Err(ComputerError::BadRequest(format!(
                "{effect:?} is not a fleet effect"
            ))),
        }
    }

    /// Fire due timers; returns how many fired.
    pub async fn fire_timers(&self) -> Result<usize, ComputerError> {
        self.host_id().await?;
        let now = self.clock.now();
        let due = self
            .repo
            .due_timers(now, TIMER_BATCH)
            .await
            .map_err(internal)?;
        let count = due.len();
        for timer in due {
            let computer_id = timer.computer_id;
            let instance_status = if timer.kind == TimerKind::MacrodMissing {
                self.fleet
                    .instances()
                    .await
                    .map_err(internal)?
                    .into_iter()
                    .find(|instance| {
                        instance.computer_id == computer_id
                            && &instance.control_plane_id == self.fleet.control_plane_id()
                    })
                    .map(|instance| instance.status)
            } else {
                None
            };
            self.repo
                .fire_timer(timer, instance_status, now)
                .await
                .inspect_err(|error| tracing::warn!(computer_id = %computer_id, error = ?error, "timer failed"))
                .ok();
        }
        Ok(count)
    }

    /// Compare the fleet with the rows: a missing or stopped instance of an
    /// awake computer is a crash; a missing cold or failed guest is recreated.
    /// Only owned orphans older than the grace period are removed.
    #[tracing::instrument(skip(self), err)]
    pub async fn reconcile(&self) -> Result<(), ComputerError> {
        let host = self.host_id().await?;
        let instances: HashMap<ComputerId, FleetInstance> = self
            .fleet
            .instances()
            .await
            .map_err(internal)?
            .into_iter()
            .filter(|instance| &instance.control_plane_id == self.fleet.control_plane_id())
            .map(|instance| (instance.computer_id, instance))
            .collect();
        let expected = self.repo.instances_expected(host).await.map_err(internal)?;

        for record in &expected {
            let Some(computer) = record.healthy() else {
                continue;
            };
            let observed = instances.get(&computer.id).map(|instance| instance.status);
            if observed.is_some() {
                match self.fleet.resources_match(computer).await {
                    Ok(true) => {}
                    Ok(false) => {
                        tracing::error!(computer_id = %computer.id, resources = ?computer.resources, reason = "resource limits drifted", "computer needs an operator")
                    }
                    Err(error) => {
                        tracing::warn!(computer_id = %computer.id, error = ?error, "could not check computer resource limits")
                    }
                }
            }
            let crashed = match computer.state.phase {
                Phase::Running { .. } | Phase::Booting { .. } => {
                    observed.is_none() || observed == Some(InstanceStatus::Stopped)
                }
                Phase::Frozen { .. } => observed.is_none(),
                _ => false,
            };
            let lost = observed.is_none()
                && matches!(
                    computer.state.phase,
                    Phase::Failed { .. } | Phase::Stopped { .. } | Phase::Suspended { .. }
                );
            if crashed || lost {
                tracing::warn!(computer_id = %computer.id, observed = ?observed, "computer instance drifted");
                self.repo
                    .apply(
                        computer.id,
                        if lost {
                            Event::InstanceLost
                        } else {
                            Event::VmCrashed
                        },
                        self.clock.now(),
                    )
                    .await
                    .map_err(internal)?;
            }
        }

        for (orphan, instance) in &instances {
            if instance
                .created_at
                .is_none_or(|at| at >= self.clock.now() - ORPHAN_GRACE)
            {
                continue;
            }
            let known = expected.iter().any(|computer| computer.id() == *orphan);
            if !known
                && self
                    .repo
                    .get(*orphan)
                    .await
                    .map_err(internal)?
                    .is_none_or(is_gone)
            {
                tracing::warn!(computer_id = %orphan, control_plane_id = self.fleet.control_plane_id().as_str(), "destroying an instance with no computer");
                self.fleet.destroy(*orphan).await.map_err(internal)?;
            }
        }
        Ok(())
    }

    /// Freeze running session-only computers quiet for [`IDLE_AFTER`].
    pub async fn sleep_idle<Activity: SessionActivity>(
        &self,
        activity: &Activity,
    ) -> Result<usize, ComputerError> {
        self.host_id().await?;
        let since = self.clock.now() - IDLE_AFTER;
        let mut frozen = 0;
        for record in self.repo.running().await.map_err(internal)? {
            let Some(computer) = record.healthy() else {
                continue;
            };
            if computer.persona.is_some() {
                continue;
            }
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
    async fn computer_of(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, ComputerError> {
        self.harnesses
            .computer_for(harness_id)
            .await
            .map_err(internal)
    }

    /// macrod connected on `harness_id`. Returns whether it is a computer's.
    #[tracing::instrument(skip(self), err)]
    pub async fn macrod_connected(&self, harness_id: HarnessId) -> Result<bool, ComputerError> {
        let Some(computer_id) = self.computer_of(harness_id).await? else {
            return Ok(false);
        };
        let computer = self.computer(computer_id).await?;
        super::telemetry::resume(computer.state.provision_traceparent.as_deref());
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
        if computer.enrolled_at.is_none() {
            super::telemetry::provisioned(
                (now - computer.created_at).num_milliseconds() as f64 / 1000.0,
            );
        }
        // The pairing is claimed, so the code is useless; remove it anyway.
        self.fleet
            .clear_enrollment(computer.id)
            .await
            .inspect_err(|error| tracing::warn!(computer_id = %computer.id, error = ?error, "could not clear enrollment"))
            .ok();
        Ok(true)
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

    /// A prompt is waiting for `harness_id`. Wakes its computer when it is
    /// asleep; returns whether the prompt must wait for macrod to connect.
    #[tracing::instrument(skip(self), err)]
    pub async fn prompt_arrived(&self, harness_id: HarnessId) -> Result<bool, ComputerError> {
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

    async fn computer(&self, computer_id: ComputerId) -> Result<Computer, ComputerError> {
        self.repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?
            .into_healthy()
            .map_err(|_| {
                ComputerError::BadRequest("computer needs attention; contact support".to_owned())
            })
    }
}

fn fleet_completion(
    result: Result<(), impl FleetError>,
    completion: Option<Event>,
) -> Result<Option<Event>, ComputerError> {
    match result {
        Ok(()) => Ok(completion),
        Err(error) if error.is_missing() => {
            tracing::warn!("computer instance lost; reprovisioning");
            Ok(Some(Event::InstanceLost))
        }
        Err(error) => Err(internal(error)),
    }
}

fn is_gone(record: ComputerRecord) -> bool {
    record
        .healthy()
        .is_some_and(|computer| computer.state.phase == Phase::Destroyed)
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
        | Effect::RestartMacrod { host }
        | Effect::Destroy { host }
        | Effect::MakeRoom { host } => Some(*host),
        Effect::ConfirmPayment { .. }
        | Effect::RemoveBillingItem
        | Effect::RevokeHarness
        | Effect::ScheduleTimer { .. }
        | Effect::PageOperator { .. } => None,
    }
}

struct CreateEnrollment<'a, Registry, Credentials> {
    harnesses: &'a Registry,
    credentials: &'a Credentials,
    defaults: &'a EnrollmentDefaults,
    computer: &'a Computer,
    generation: EnrollmentGeneration,
}

impl<Registry: Harnesses, Credentials: PersonaCredentialSource> FleetEnrollment
    for CreateEnrollment<'_, Registry, Credentials>
{
    async fn claimed(&self, pairing: PairingId) -> Result<bool, PersonaCredentialError> {
        self.harnesses
            .pairing_claimed(pairing)
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)
    }

    #[tracing::instrument(name = "computer.enrollment.issue", skip_all, fields(computer_id = %self.computer.id, generation = i64::from(self.generation.get())), err)]
    async fn issue(&self) -> Result<Enrollment, PersonaCredentialError> {
        // Retire the earlier claim secret first. If issuance loses its response,
        // the old guest must not claim with persona credentials now revoked.
        let pairing = self
            .harnesses
            .create_hosted_pairing(self.computer)
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        let persona_enrollment = self
            .credentials
            .issue(self.computer.id, self.generation)
            .await?;
        let persona = self
            .computer
            .persona
            .clone()
            .map(|mut persona| {
                if let Some(parent) = super::telemetry::traceparent() {
                    persona.config.insert(
                        PersonaConfigKey::parse("BRAIN_PROVISION_TRACEPARENT")?,
                        parent,
                    );
                }
                persona.config.insert(
                    PersonaConfigKey::parse("MACRO_COMPUTER_ID")?,
                    self.computer.id.to_string(),
                );
                persona.config.insert(
                    PersonaConfigKey::parse("MACRO_TEAM_ID")?,
                    self.computer.team_id.to_string(),
                );
                Ok::<_, PersonaCredentialError>(persona)
            })
            .transpose()?;
        Ok(Enrollment {
            computer_id: self.computer.id,
            generation: self.generation,
            pairing_id: pairing.pairing_id,
            device_secret: pairing.device_secret,
            name: self.computer.name.clone(),
            service_url_overrides: self.defaults.service_url_overrides.clone(),
            persona,
            persona_enrollment,
        })
    }
}
