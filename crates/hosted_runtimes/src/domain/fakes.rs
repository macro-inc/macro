//! In-memory fakes of the ports, for domain tests.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ids::ComputerId;
use harness_id::HarnessId;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use crate::domain::lifecycle::{
    ComputerState, Context, Effect, EffectWorker, Event, HostId, Phase, transition,
};
use crate::domain::models::{
    Computer, ComputerDisplayMetadata, ComputerRecord, Host, HostRegistration, NewComputer,
    SanitizedReason,
};
use crate::domain::ports::{ComputerRepo, DueTimer, PendingEffect, ReserveError};
use crate::domain::service::Clock;
use crate::domain::size::ComputerSize;

pub const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_00aa);
pub const HOST: HostId = HostId::new(Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0001));

pub fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
}

pub struct FixedClock;

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
    pub reservations: Mutex<usize>,
    pub notify_writes: Mutex<usize>,
    pub heartbeats: Mutex<Vec<(HostId, DateTime<Utc>)>>,
    pub timers: Mutex<Vec<DueTimer>>,
    pub fail_next_apply: AtomicBool,
    pub enrollment_locks: Mutex<HashMap<ComputerId, Arc<tokio::sync::Mutex<()>>>>,
    pub payment_locks: Mutex<HashMap<ComputerId, Arc<tokio::sync::Mutex<()>>>>,
    pub effect_run_after: Mutex<HashMap<i64, DateTime<Utc>>>,
    pub computers: Mutex<HashMap<ComputerId, Computer>>,
    pub corrupt_ids: Mutex<Vec<ComputerId>>,
    pub effects: Mutex<Vec<PendingEffect>>,
    pub events: Mutex<Vec<(ComputerId, Event)>>,
}

impl FakeRepo {
    fn record(&self, computer: Computer) -> ComputerRecord {
        if self.corrupt_ids.lock().unwrap().contains(&computer.id) {
            ComputerRecord::NeedsAttention {
                id: computer.id,
                team_id: computer.team_id,
                host_id: computer.state.host(),
                display: ComputerDisplayMetadata::from(&computer),
                reason: SanitizedReason::new("state must satisfy lifecycle field rules"),
            }
        } else {
            computer.into()
        }
    }
}

impl ComputerRepo for FakeRepo {
    type Err = FakeError;
    type PaymentGuard = tokio::sync::OwnedMutexGuard<()>;
    type EnrollmentGuard = tokio::sync::OwnedMutexGuard<()>;

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

    async fn lock_payment(&self, computer_id: ComputerId) -> Result<Self::PaymentGuard, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let lock = self
            .payment_locks
            .lock()
            .unwrap()
            .entry(computer_id)
            .or_default()
            .clone();
        Ok(lock.lock_owned().await)
    }

    async fn reserve(
        &self,
        computer: NewComputer,
        now: DateTime<Utc>,
    ) -> Result<Computer, ReserveError<FakeError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.reservations.lock().unwrap() += 1;
        let mut computers = self.computers.lock().unwrap();
        let sold: u32 = computers
            .values()
            .filter(|existing| existing.state.holds_units())
            .map(|existing| existing.resources.units())
            .sum();
        if sold + computer.resources.units() > self.sold_units {
            return Err(ReserveError::SoldOut);
        }
        let mut state = ComputerState::reserved(HOST, now);
        if let crate::domain::models::PurchaseBilling::Comped { reason } = &computer.billing {
            state.comp_reason = Some(reason.clone());
        }
        let mut reserved = Computer {
            id: computer.id,
            team_id: computer.team_id,
            name: computer.name,
            size: computer.size,
            resources: computer.resources,
            catalog_entry: computer.catalog_entry,
            price_id: computer.price_id,
            state,
            harness_id: None,
            created_by: computer.created_by,
            created_at: now,
            enrolled_at: None,
            enrollment_generation: Default::default(),
        };
        let (effects, run_after) = match computer.billing {
            crate::domain::models::PurchaseBilling::Comped { reason } => {
                let (state, effects) = transition(
                    &reserved.state,
                    &Event::Comped { reason },
                    Context {
                        now,
                        host_has_room: true,
                        enrollment_generation: reserved.enrollment_generation,
                    },
                );
                reserved.state = state;
                (effects, now)
            }
            crate::domain::models::PurchaseBilling::Stripe => (
                vec![Effect::ConfirmPayment {
                    extra_items: computer.extra_items,
                }],
                now + crate::domain::lifecycle::PAYMENT_CONFIRM_DELAY,
            ),
        };
        let mut outbox = self.effects.lock().unwrap();
        for effect in effects {
            if let Effect::Create { generation, .. } = &effect {
                reserved.enrollment_generation = *generation;
            }
            let id = outbox.iter().map(|effect| effect.id).max().unwrap_or(0) + 1;
            outbox.push(PendingEffect {
                id,
                computer_id: reserved.id,
                effect,
                attempts: 0,
            });
            self.effect_run_after.lock().unwrap().insert(id, run_after);
        }
        computers.insert(reserved.id, reserved.clone());
        Ok(reserved)
    }

    async fn apply(
        &self,
        computer_id: ComputerId,
        event: Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, FakeError> {
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
        let (state, effects) = transition(
            &computer.state,
            &event,
            Context {
                enrollment_generation: computer.enrollment_generation,
                now,
                host_has_room: true,
            },
        );
        computer.state = state;
        let mut outbox = self.effects.lock().unwrap();
        if !matches!(computer.state.phase, Phase::PendingPayment { .. }) {
            outbox.retain(|pending| {
                pending.computer_id != computer_id
                    || !matches!(pending.effect, Effect::ConfirmPayment { .. })
            });
        }
        for effect in effects {
            if let Effect::Create { generation, .. } = &effect {
                computer.enrollment_generation = *generation;
            }
            let id = outbox.iter().map(|pending| pending.id).max().unwrap_or(0) + 1;
            outbox.push(PendingEffect {
                id,
                computer_id,
                effect,
                attempts: 0,
            });
            self.effect_run_after.lock().unwrap().insert(id, now);
        }
        Ok(Some(computer.clone()))
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
            .filter(|computer| {
                computer.team_id == team_id && computer.state.phase != Phase::Destroyed
            })
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

    async fn running(&self) -> Result<Vec<ComputerRecord>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| matches!(computer.state.phase, Phase::Running { .. }))
            .cloned()
            .map(|computer| self.record(computer))
            .collect())
    }

    async fn coldest_frozen(&self, _host: HostId) -> Result<Option<ComputerId>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(None)
    }

    async fn instances_expected(&self, host: HostId) -> Result<Vec<ComputerRecord>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| computer.state.host() == Some(host))
            .filter(|computer| !matches!(computer.state.phase, Phase::PendingPayment { .. }))
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
        self.apply(timer.computer_id, timer.kind.event(instance_status), now)
            .await
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
    ) -> Result<Vec<ComputerSize>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let computers = self.computers.lock().unwrap();
        let sold: u32 = computers
            .values()
            .filter(|c| c.state.holds_units())
            .map(|c| c.resources.units())
            .sum();
        Ok(catalog
            .iter()
            .filter(|entry| entry.resources.units() > self.sold_units.saturating_sub(sold))
            .map(|entry| entry.size)
            .collect())
    }

    async fn request_notify(
        &self,
        _team_id: Uuid,
        _user_id: MacroUserIdStr<'static>,
        _size: ComputerSize,
    ) -> Result<(), FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.notify_writes.lock().unwrap() += 1;
        Ok(())
    }

    async fn notify_requests(
        &self,
        _team_id: Uuid,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ComputerSize>, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(vec![])
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
