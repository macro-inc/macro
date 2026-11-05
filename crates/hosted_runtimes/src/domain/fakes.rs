//! In-memory fakes of the ports, for domain tests.

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use crate::domain::lifecycle::{
    ComputerState, Context, EffectWorker, Event, HostId, Phase, transition,
};
use crate::domain::models::{Computer, Host, HostRegistration, NewComputer};
use crate::domain::ports::{ComputerRepo, DueTimer, PendingEffect, ReserveError};
use crate::domain::service::Clock;
use crate::domain::size::ComputerSize;

pub const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_00aa);
pub const HOST: HostId = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0001);

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
    pub sold_units: u32,
    pub computers: Mutex<HashMap<Uuid, Computer>>,
    pub effects: Mutex<Vec<PendingEffect>>,
    pub events: Mutex<Vec<(Uuid, Event)>>,
}

impl ComputerRepo for FakeRepo {
    type Err = FakeError;

    async fn reserve(
        &self,
        computer: NewComputer,
        now: DateTime<Utc>,
    ) -> Result<Computer, ReserveError<FakeError>> {
        let mut computers = self.computers.lock().unwrap();
        let sold: u32 = computers
            .values()
            .filter(|existing| existing.state.phase != Phase::Destroyed)
            .map(|existing| existing.size.units())
            .sum();
        if sold + computer.size.units() > self.sold_units {
            return Err(ReserveError::SoldOut);
        }
        let reserved = Computer {
            id: computer.id,
            team_id: computer.team_id,
            name: computer.name,
            size: computer.size,
            state: ComputerState::reserved(HOST, now),
            harness_id: None,
            persona: computer.persona,
            created_by: computer.created_by,
            created_at: now,
            enrolled_at: None,
        };
        computers.insert(reserved.id, reserved.clone());
        Ok(reserved)
    }

    async fn apply(
        &self,
        computer_id: Uuid,
        event: Event,
        now: DateTime<Utc>,
    ) -> Result<Option<Computer>, FakeError> {
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
                now,
                host_has_room: true,
            },
        );
        computer.state = state;
        let mut outbox = self.effects.lock().unwrap();
        for effect in effects {
            let id = outbox.len() as i64 + 1;
            outbox.push(PendingEffect {
                id,
                computer_id,
                effect,
                attempts: 0,
            });
        }
        Ok(Some(computer.clone()))
    }

    async fn get(&self, computer_id: Uuid) -> Result<Option<Computer>, FakeError> {
        Ok(self.computers.lock().unwrap().get(&computer_id).cloned())
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<Computer>, FakeError> {
        let mut computers: Vec<Computer> = self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| computer.team_id == team_id)
            .filter(|computer| computer.state.phase != Phase::Destroyed)
            .cloned()
            .collect();
        computers.sort_by_key(|computer| computer.created_at);
        Ok(computers)
    }

    async fn find_by_harness(&self, harness_id: Uuid) -> Result<Option<Computer>, FakeError> {
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .find(|computer| computer.harness_id == Some(harness_id))
            .cloned())
    }

    async fn set_harness(&self, computer_id: Uuid, harness_id: Uuid) -> Result<(), FakeError> {
        if let Some(computer) = self.computers.lock().unwrap().get_mut(&computer_id) {
            computer.harness_id = Some(harness_id);
        }
        Ok(())
    }

    async fn mark_enrolled(
        &self,
        _computer_id: Uuid,
        _now: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        Ok(())
    }

    async fn running(&self) -> Result<Vec<Computer>, FakeError> {
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| matches!(computer.state.phase, Phase::Running { .. }))
            .cloned()
            .collect())
    }

    async fn coldest_frozen(&self, _host: HostId) -> Result<Option<Uuid>, FakeError> {
        Ok(None)
    }

    async fn instances_expected(&self, host: HostId) -> Result<Vec<Computer>, FakeError> {
        Ok(self
            .computers
            .lock()
            .unwrap()
            .values()
            .filter(|computer| computer.state.host() == Some(host))
            .filter(|computer| !matches!(computer.state.phase, Phase::Reserved { .. }))
            .cloned()
            .collect())
    }

    async fn lease_effects(
        &self,
        worker: EffectWorker,
        limit: u32,
        _now: DateTime<Utc>,
        _lease_until: DateTime<Utc>,
    ) -> Result<Vec<PendingEffect>, FakeError> {
        Ok(self
            .effects
            .lock()
            .unwrap()
            .iter()
            .filter(|pending| pending.effect.worker() == worker)
            .take(limit as usize)
            .cloned()
            .collect())
    }

    async fn complete_effect(&self, id: i64) -> Result<(), FakeError> {
        self.effects
            .lock()
            .unwrap()
            .retain(|pending| pending.id != id);
        Ok(())
    }

    async fn retry_effect(
        &self,
        id: i64,
        _error: String,
        _retry_at: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        for pending in self.effects.lock().unwrap().iter_mut() {
            if pending.id == id {
                pending.attempts += 1;
            }
        }
        Ok(())
    }

    async fn due_timers(
        &self,
        _now: DateTime<Utc>,
        _limit: u32,
    ) -> Result<Vec<DueTimer>, FakeError> {
        Ok(vec![])
    }

    async fn fire_timer(
        &self,
        _timer: DueTimer,
        _now: DateTime<Utc>,
    ) -> Result<Option<Computer>, FakeError> {
        Ok(None)
    }

    async fn register_host(&self, registration: HostRegistration) -> Result<Host, FakeError> {
        Ok(Host {
            id: HOST,
            awake_capacity_units: registration.awake_capacity_units(),
            sold_capacity_units: registration.sold_capacity_units(),
            name: registration.name,
        })
    }

    async fn sold_out_sizes(&self) -> Result<Vec<ComputerSize>, FakeError> {
        Ok(vec![])
    }

    async fn request_notify(
        &self,
        _team_id: Uuid,
        _user_id: String,
        _size: ComputerSize,
    ) -> Result<(), FakeError> {
        Ok(())
    }

    async fn notify_requests(
        &self,
        _team_id: Uuid,
        _user_id: String,
    ) -> Result<Vec<ComputerSize>, FakeError> {
        Ok(vec![])
    }
}
