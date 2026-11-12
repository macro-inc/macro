//! In-memory fakes of the ports, for domain tests.

use crate::domain::ids::ComputerId;
use bot_id::BotId;
use harness_id::HarnessId;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, TimeZone, Utc};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::domain::lifecycle::{
    Billing, BillingPolicy, Context, Effect, EffectWorker, Event, HostId, provision, transition,
};
use crate::domain::models::{
    Computer, ComputerDisplayMetadata, ComputerRecord, Host, HostRegistration, NewReservation,
    PurchaseKey, Reservation, Reserved, SanitizedReason,
};
use crate::domain::ports::{
    Applied, ComputerRepo, DueTimer, GuestProcess, PendingEffect, ReserveError,
};
use crate::domain::service::Clock;
use crate::domain::size::ComputerSize;

#[cfg(test)]
mod test;

pub const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_00aa);
pub const HOST: HostId = HostId::new(Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0001));

pub fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
}

/// 14 days of retention, 7 days of past-due grace.
pub fn policy() -> BillingPolicy {
    BillingPolicy::from_days(14, 7).unwrap()
}

pub struct FixedClock;

/// A clock tests move forward, shared with the service under test.
pub struct MovingClock(Mutex<DateTime<Utc>>);

impl MovingClock {
    /// Starting at [`now`].
    pub fn new() -> Arc<Self> {
        Arc::new(Self(Mutex::new(now())))
    }

    /// Move the clock forward.
    pub fn advance(&self, by: chrono::Duration) {
        *self.0.lock().unwrap() += by;
    }
}

impl Clock for Arc<MovingClock> {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap()
    }
}

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        now()
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake storage error")]
pub struct FakeError;

/// One host with `sold_units` of sold capacity; every computer awake fits.
#[derive(Default)]
pub struct FakeRepo {
    pub calls: AtomicUsize,
    pub sold_units: u32,
    pub reserve_calls: Mutex<usize>,
    pub reservations: Mutex<HashMap<ComputerId, Reservation>>,
    pub purchase_keys: Mutex<HashMap<PurchaseKey, ComputerId>>,
    pub heartbeats: Mutex<Vec<(HostId, DateTime<Utc>)>>,
    pub timers: Mutex<Vec<DueTimer>>,
    pub fail_next_apply: AtomicBool,
    pub enrollment_locks: Mutex<HashMap<ComputerId, Arc<tokio::sync::Mutex<()>>>>,
    pub billing_locks: Mutex<HashMap<ComputerId, Arc<tokio::sync::Mutex<()>>>>,
    pub effect_run_after: Mutex<HashMap<i64, DateTime<Utc>>>,
    pub computers: Mutex<HashMap<ComputerId, Computer>>,
    pub corrupt_ids: Mutex<Vec<ComputerId>>,
    pub effects: Mutex<Vec<PendingEffect>>,
    pub events: Mutex<Vec<(ComputerId, Event)>>,
    pub agent_counts: Mutex<HashMap<ComputerId, u32>>,
}

impl FakeRepo {
    fn record(&self, computer: Computer) -> ComputerRecord {
        if self.corrupt_ids.lock().unwrap().contains(&computer.id) {
            ComputerRecord::NeedsAttention {
                id: computer.id,
                team_id: computer.team_id,
                host_id: Some(computer.host),
                display: ComputerDisplayMetadata::from(&computer),
                reason: SanitizedReason::new("state must satisfy lifecycle field rules"),
            }
        } else {
            computer.into()
        }
    }

    fn live_units(&self) -> u32 {
        let computers: u32 = self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| computer.state.is_live())
            .map(|computer| computer.resources.units())
            .sum();
        let held: u32 = self
            .reservations
            .lock()
            .unwrap()
            .values()
            .map(|reservation| reservation.resources.units())
            .sum();
        computers + held
    }

    fn push_effects(&self, computer: &mut Computer, effects: Vec<Effect>, now: DateTime<Utc>) {
        let mut outbox = self.effects.lock().unwrap();
        for effect in effects {
            if let Effect::Create { generation, .. } = &effect {
                computer.enrollment_generation = *generation;
            }
            let id = outbox.iter().map(|pending| pending.id).max().unwrap_or(0) + 1;
            outbox.push(PendingEffect {
                id,
                computer_id: computer.id,
                effect,
                attempts: 0,
            });
            self.effect_run_after.lock().unwrap().insert(id, now);
        }
    }
}

impl ComputerRepo for FakeRepo {
    type Err = FakeError;
    type EnrollmentGuard = tokio::sync::OwnedMutexGuard<()>;
    type BillingGuard = tokio::sync::OwnedMutexGuard<()>;

    fn policy(&self) -> BillingPolicy {
        policy()
    }

    async fn lock_billing(&self, computer_id: ComputerId) -> Result<Self::BillingGuard, FakeError> {
        let lock = self
            .billing_locks
            .lock()
            .unwrap()
            .entry(computer_id)
            .or_default()
            .clone();
        Ok(lock.lock_owned().await)
    }

    async fn lock_enrollment(
        &self,
        computer_id: ComputerId,
    ) -> Result<Self::EnrollmentGuard, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let lock = self
            .enrollment_locks
            .lock()
            .unwrap()
            .entry(computer_id)
            .or_default()
            .clone();
        Ok(lock.lock_owned().await)
    }

    async fn reserve(
        &self,
        reservation: NewReservation,
        now: DateTime<Utc>,
        expires_at: DateTime<Utc>,
    ) -> Result<Reserved, ReserveError<FakeError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.reserve_calls.lock().unwrap() += 1;
        if let Some(id) = self
            .purchase_keys
            .lock()
            .unwrap()
            .get(&reservation.purchase_key)
        {
            if let Some(computer) = self.computers.lock().unwrap().get(id) {
                return Ok(Reserved::Purchased(Box::new(self.record(computer.clone()))));
            }
            if let Some(pending) = self.reservations.lock().unwrap().get(id) {
                return Ok(Reserved::Pending(pending.clone()));
            }
        }
        if self.live_units() + reservation.resources.units() > self.sold_units {
            return Err(ReserveError::SoldOut);
        }
        let held = Reservation {
            id: reservation.id,
            team_id: reservation.team_id,
            host: HOST,
            purchase_key: reservation.purchase_key,
            name: reservation.name,
            size: reservation.size,
            resources: reservation.resources,
            catalog_entry: reservation.catalog_entry,
            funding: reservation.funding,
            created_by: reservation.created_by,
            extra_items: reservation.extra_items,
            provision_traceparent: reservation.provision_traceparent,
            expires_at,
            created_at: now,
            agent: reservation.agent,
        };
        self.purchase_keys
            .lock()
            .unwrap()
            .insert(held.purchase_key.clone(), held.id);
        self.reservations
            .lock()
            .unwrap()
            .insert(held.id, held.clone());
        Ok(Reserved::New(held))
    }

    async fn convert_reservation(
        &self,
        reservation_id: ComputerId,
        billing: Billing,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let Some(reservation) = self.reservations.lock().unwrap().remove(&reservation_id) else {
            return Ok(None);
        };
        let (mut state, effects) = provision(
            billing,
            crate::domain::setup::SetupTimeline::started(reservation.created_at),
            reservation.provision_traceparent.clone(),
            Context {
                host: reservation.host,
                enrollment_generation: Default::default(),
                now,
                host_has_room: true,
                policy: policy(),
            },
        );
        let phase = state.phase.clone();
        if let Some(setup) = state.setup.as_mut() {
            setup.advance(&phase, false, false, now);
        }
        let mut computer = Computer {
            id: reservation.id,
            team_id: reservation.team_id,
            name: reservation.name,
            size: reservation.size,
            resources: reservation.resources,
            catalog_entry: reservation.catalog_entry,
            funding: reservation.funding,
            host: reservation.host,
            state,
            harness_id: None,
            created_by: reservation.created_by,
            created_at: reservation.created_at,
            enrolled_at: None,
            setup_completed_at: None,
            default_agent_id: None,
            image: None,
            enrollment_generation: Default::default(),
        };
        self.push_effects(&mut computer, effects, now);
        self.computers
            .lock()
            .unwrap()
            .insert(computer.id, computer.clone());
        Ok(Some(computer))
    }

    async fn delete_reservation(&self, reservation_id: ComputerId) -> Result<bool, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .reservations
            .lock()
            .unwrap()
            .remove(&reservation_id)
            .is_some())
    }

    async fn reservation(
        &self,
        reservation_id: ComputerId,
    ) -> Result<Option<Reservation>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .reservations
            .lock()
            .unwrap()
            .get(&reservation_id)
            .cloned())
    }

    async fn team_reservations(&self, team_id: Uuid) -> Result<Vec<Reservation>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut held: Vec<Reservation> = self
            .reservations
            .lock()
            .unwrap()
            .values()
            .filter(|reservation| reservation.team_id == team_id)
            .cloned()
            .collect();
        held.sort_by_key(|reservation| reservation.created_at);
        Ok(held)
    }

    async fn reservations_created_before(
        &self,
        created_before: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<Reservation>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut held: Vec<Reservation> = self
            .reservations
            .lock()
            .unwrap()
            .values()
            .filter(|reservation| reservation.created_at <= created_before)
            .cloned()
            .collect();
        held.sort_by_key(|reservation| reservation.created_at);
        held.truncate(limit as usize);
        Ok(held)
    }

    async fn apply(
        &self,
        computer_id: ComputerId,
        event: Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Applied>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_next_apply.swap(false, Ordering::SeqCst) {
            return Err(FakeError);
        }
        self.events
            .lock()
            .unwrap()
            .push((computer_id, event.clone()));
        let mut computers = self.computers.lock().unwrap();
        let Some(computer) = computers.get_mut(&computer_id) else {
            return Ok(None);
        };
        let transitioned = transition(
            &computer.state,
            &event,
            Context {
                host: computer.host,
                enrollment_generation: computer.enrollment_generation,
                now,
                host_has_room: true,
                policy: policy(),
            },
        );
        let (state, effects) = match transitioned {
            Ok(next) => next,
            Err(rejected) => return Ok(Some(Applied::Rejected(rejected))),
        };
        computer.state = state;
        self.push_effects(computer, effects, now);
        Ok(Some(Applied::Changed(Box::new(computer.clone()))))
    }

    async fn get(&self, computer_id: ComputerId) -> Result<Option<ComputerRecord>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .computers
            .lock()
            .unwrap()
            .get(&computer_id)
            .map(|computer| self.record(computer.clone())))
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<ComputerRecord>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut computers: Vec<Computer> = self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| computer.team_id == team_id && computer.state.is_live())
            .cloned()
            .collect();
        computers.sort_by_key(|computer| computer.created_at);
        Ok(computers
            .into_iter()
            .map(|computer| self.record(computer))
            .collect())
    }

    async fn find_by_harness(&self, harness_id: HarnessId) -> Result<Option<Computer>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .find(|computer| computer.harness_id == Some(harness_id))
            .cloned())
    }

    async fn awake_computers(&self) -> Result<Vec<(HarnessId, ComputerId)>, FakeError> {
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| computer.state.is_awake())
            .filter_map(|computer| Some((computer.harness_id?, computer.id)))
            .collect())
    }

    async fn set_harness(
        &self,
        computer_id: ComputerId,
        harness_id: HarnessId,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(computer) = self.computers.lock().unwrap().get_mut(&computer_id) {
            computer.harness_id = Some(harness_id);
        }
        Ok(())
    }

    async fn mark_enrolled(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(computer) = self.computers.lock().unwrap().get_mut(&computer_id) {
            computer.enrolled_at.get_or_insert(now);
        }
        Ok(())
    }

    async fn agent_counts(
        &self,
        computer_ids: &[ComputerId],
    ) -> Result<HashMap<ComputerId, u32>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let counts = self.agent_counts.lock().unwrap();
        Ok(computer_ids
            .iter()
            .filter_map(|id| counts.get(id).map(|count| (*id, *count)))
            .collect())
    }

    async fn record_image(
        &self,
        computer_id: ComputerId,
        image: &crate::domain::image::GuestImage,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(computer) = self.computers.lock().unwrap().get_mut(&computer_id) {
            computer.image = Some(image.clone());
        }
        Ok(())
    }

    async fn set_default_agent(
        &self,
        computer_id: ComputerId,
        agent_id: BotId,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(computer) = self.computers.lock().unwrap().get_mut(&computer_id) {
            computer.default_agent_id = Some(agent_id);
        }
        Ok(())
    }

    async fn complete_setup(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<Option<ComputerRecord>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let computer = self
            .computers
            .lock()
            .unwrap()
            .get_mut(&computer_id)
            .map(|computer| {
                computer.setup_completed_at.get_or_insert(now);
                computer.clone()
            });
        Ok(computer.map(|computer| self.record(computer)))
    }

    async fn instances_expected(&self, host: HostId) -> Result<Vec<ComputerRecord>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| computer.host == host && computer.state.is_live())
            .cloned()
            .map(|computer| self.record(computer))
            .collect())
    }

    async fn lease_effects(
        &self,
        worker: EffectWorker,
        limit: u32,
        now: DateTime<Utc>,
        lease_until: DateTime<Utc>,
    ) -> Result<Vec<PendingEffect>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let effects = self.effects.lock().unwrap();
        let mut due = self.effect_run_after.lock().unwrap();
        let selected: Vec<PendingEffect> = effects
            .iter()
            .filter(|pending| pending.effect.worker() == worker)
            .filter(|pending| due.get(&pending.id).is_none_or(|at| *at <= now))
            .filter(|pending| {
                !effects.iter().any(|earlier| {
                    earlier.id < pending.id
                        && earlier.computer_id == pending.computer_id
                        && earlier.effect.worker() == worker
                })
            })
            .take(limit as usize)
            .cloned()
            .collect();
        for pending in &selected {
            due.insert(pending.id, lease_until);
        }
        Ok(selected)
    }

    async fn release_effects(
        &self,
        ids: &[i64],
        lease_until: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let effects = self.effects.lock().unwrap();
        let mut due = self.effect_run_after.lock().unwrap();
        for id in ids {
            if effects
                .iter()
                .any(|pending| pending.id == *id && pending.effect.worker() == EffectWorker::Fleet)
                && due.get(id) == Some(&lease_until)
            {
                due.insert(*id, now);
            }
        }
        Ok(())
    }

    async fn complete_effect(&self, id: i64) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.effect_run_after.lock().unwrap().remove(&id);
        self.effects
            .lock()
            .unwrap()
            .retain(|pending| pending.id != id);
        Ok(())
    }

    async fn finish_effect(
        &self,
        id: i64,
        completion: Option<Event>,
        now: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let computer_id = self
            .effects
            .lock()
            .unwrap()
            .iter()
            .find(|pending| pending.id == id)
            .map(|pending| pending.computer_id);
        if let Some(computer_id) = computer_id
            && let Some(event) = completion
        {
            self.apply(computer_id, event, now).await?;
        }
        self.complete_effect(id).await
    }

    async fn retry_effect(
        &self,
        id: i64,
        _error: String,
        retry_at: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.effect_run_after.lock().unwrap().insert(id, retry_at);
        for pending in self.effects.lock().unwrap().iter_mut() {
            if pending.id == id {
                pending.attempts += 1;
            }
        }
        Ok(())
    }

    async fn due_timers(&self, now: DateTime<Utc>, limit: u32) -> Result<Vec<DueTimer>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .timers
            .lock()
            .unwrap()
            .iter()
            .filter(|timer| timer.fire_at <= now)
            .take(limit as usize)
            .cloned()
            .collect())
    }

    async fn fire_timer(
        &self,
        timer: DueTimer,
        instance_status: Option<crate::domain::ports::InstanceStatus>,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.timers
            .lock()
            .unwrap()
            .retain(|pending| *pending != timer);
        Ok(
            match self
                .apply(timer.computer_id, timer.kind.event(instance_status), now)
                .await?
            {
                Some(Applied::Changed(computer)) => Some(*computer),
                Some(Applied::Rejected(_)) | None => None,
            },
        )
    }

    async fn postpone_macrod_timers(
        &self,
        _host: HostId,
        _deadline: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn register_host(&self, registration: HostRegistration) -> Result<Host, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Host {
            id: HOST,
            awake_capacity_units: registration.awake_capacity_units(),
            sold_capacity_units: registration.sold_capacity_units(),
            name: registration.name,
        })
    }

    async fn heartbeat_host(&self, host: HostId, now: DateTime<Utc>) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.heartbeats.lock().unwrap().push((host, now));
        Ok(())
    }

    async fn sold_out_sizes(
        &self,
        catalog: &[crate::domain::size::CatalogEntry],
        _now: DateTime<Utc>,
    ) -> Result<Vec<ComputerSize>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let sold = self.live_units();
        Ok(catalog
            .iter()
            .filter(|entry| entry.resources.units() > self.sold_units.saturating_sub(sold))
            .map(|entry| entry.size)
            .collect())
    }
}

/// A comped, powered-on computer state in `phase`, for fixtures.
pub fn state(phase: crate::domain::lifecycle::Phase) -> crate::domain::lifecycle::ComputerState {
    crate::domain::lifecycle::ComputerState {
        provision_traceparent: None,
        setup: None,
        phase,
        billing: Billing::Comped {
            reason: "fixture".to_owned(),
        },
        billing_changed_at: now(),
        power: crate::domain::lifecycle::Power::On,
        macrod_connected: false,
        macrod_misses: 0,
        recent_crashes: vec![],
        power_on_requested: false,
        capacity_wait: None,
        retried_by_team: false,
    }
}

/// The deployment fixtures enroll into.
pub fn deployment() -> crate::domain::enrollment::Deployment {
    crate::domain::enrollment::Deployment {
        agent_harness_url: "http://10.210.0.1:8080".parse().unwrap(),
        document_storage_url: "http://10.210.0.1:8081".parse().unwrap(),
        app_url: "http://10.210.0.1:3000".parse().unwrap(),
        egress_url: "http://10.210.0.1:41027".parse().unwrap(),
    }
}

/// Resolves [`deployment`] every time.
pub struct FixedDeployment;

impl crate::domain::enrollment::DeploymentSource for FixedDeployment {
    fn deployment(
        &self,
    ) -> Result<
        crate::domain::enrollment::Deployment,
        crate::domain::enrollment::DeploymentUnavailable,
    > {
        Ok(deployment())
    }
}

/// A guest program for a fake [`crate::domain::ports::Fleet::exec`]: it reads
/// its stdin to the end, then writes the stdout `script` makes of it and exits
/// with `script`'s code.
pub fn scripted_process<Err: Send + 'static>(
    script: impl FnOnce(Vec<u8>) -> (Vec<u8>, i32) + Send + 'static,
) -> GuestProcess<Err> {
    let (stdin, mut program_stdin) = tokio::io::duplex(64 * 1024);
    let (mut program_stdout, stdout) = tokio::io::duplex(64 * 1024);
    let program = tokio::spawn(async move {
        let mut input = Vec::new();
        program_stdin.read_to_end(&mut input).await.unwrap();
        let (output, exit_code) = script(input);
        program_stdout.write_all(&output).await.unwrap();
        exit_code
    });

    GuestProcess {
        stdin: Box::pin(stdin),
        stdout: Box::pin(stdout),
        exit: Box::pin(async move { Ok(program.await.unwrap()) }),
    }
}
