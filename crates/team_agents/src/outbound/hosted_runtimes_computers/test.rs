use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, TimeZone, Utc};
use hosted_runtimes::domain::{
    lifecycle::{ComputerState, Context, EffectWorker, Event, HostId, Phase, transition},
    models::{
        BillingInterval, Computer, Host, HostRegistration, NewComputer, Quote, SubscriptionItem,
    },
    ports::{Billing, BillingError, ComputerRepo, DueTimer, PendingEffect, ReserveError},
    service::{Clock, ComputerService},
    size::ComputerSize,
};
use uuid::Uuid;

use super::HostedRuntimesComputers;
use crate::domain::{models as agent, ports::Computers};

const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_00aa);
const HOST: HostId = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0001);

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        now()
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake storage error")]
struct FakeError;

/// One host with `sold_units` of sold capacity; every computer awake fits.
#[derive(Default)]
struct FakeRepo {
    sold_units: u32,
    computers: Arc<Mutex<HashMap<Uuid, Computer>>>,
    effects: Mutex<Vec<PendingEffect>>,
    events: Mutex<Vec<(Uuid, Event)>>,
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

    async fn find_by_harness(&self, _harness_id: Uuid) -> Result<Option<Computer>, FakeError> {
        Ok(None)
    }

    async fn set_harness(&self, _computer_id: Uuid, _harness_id: Uuid) -> Result<(), FakeError> {
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
        Ok(vec![])
    }

    async fn coldest_frozen(&self, _host: HostId) -> Result<Option<Uuid>, FakeError> {
        Ok(None)
    }

    async fn instances_expected(&self, _host: HostId) -> Result<Vec<Computer>, FakeError> {
        Ok(vec![])
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

    async fn register_host(&self, _registration: HostRegistration) -> Result<Host, FakeError> {
        Err(FakeError)
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

/// Records subscription updates; fails them when `decline` is set.
#[derive(Default)]
struct FakeBilling {
    decline: bool,
    provider_fails: bool,
    updates: Arc<Mutex<Vec<(ComputerSize, Vec<SubscriptionItem>, String)>>>,
    removals: Mutex<Vec<(ComputerSize, String)>>,
}

impl Billing for FakeBilling {
    async fn quote(&self, _team_id: Uuid, size: ComputerSize) -> Result<Quote, BillingError> {
        if self.provider_fails {
            return Err(BillingError::Provider(rootcause::report!(
                "billing is unreachable"
            )));
        }
        Ok(Quote {
            size,
            price_id: format!("price_{}", size.as_ref()),
            amount: 2000 * i64::from(size.units()),
            currency: "usd".to_owned(),
            interval: BillingInterval::Month,
        })
    }

    async fn add_computer(
        &self,
        _team_id: Uuid,
        size: ComputerSize,
        extra_items: &[SubscriptionItem],
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        if self.decline {
            return Err(BillingError::PaymentFailed);
        }
        self.updates
            .lock()
            .unwrap()
            .push((size, extra_items.to_vec(), idempotency_key.to_owned()));
        Ok(())
    }

    async fn remove_computer(
        &self,
        _team_id: Uuid,
        size: ComputerSize,
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        self.removals
            .lock()
            .unwrap()
            .push((size, idempotency_key.to_owned()));
        Ok(())
    }

    async fn period_end(&self, _team_id: Uuid) -> Result<DateTime<Utc>, BillingError> {
        Ok(now() + chrono::Duration::days(20))
    }
}

#[tokio::test]
async fn purchase_sends_the_persona_and_seat_through_one_billing_update() {
    let repo = FakeRepo {
        sold_units: 4,
        ..Default::default()
    };
    let computers = repo.computers.clone();
    let billing = FakeBilling::default();
    let updates = billing.updates.clone();
    let service =
        HostedRuntimesComputers::new(Arc::new(ComputerService::new(repo, billing, FixedClock)));
    let persona = agent::Persona {
        name: "Agent".to_string(),
        os_user: "agent".to_string(),
        extra_service: agent::PersonaService {
            unit_name: "brain@agent".to_string(),
            exec: "/opt/macro/brain run".to_string(),
            env: Default::default(),
        },
        config: std::collections::BTreeMap::from([(
            "MACRO_API_KEY".to_string(),
            "test-bootstrap".to_string(),
        )]),
    };
    let id = service
        .purchase(agent::ComputerPurchase {
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_string(),
            size: agent::ComputerSize::Large,
            name: Some("Agent".to_string()),
            persona: Some(persona.clone()),
            extra_items: vec![agent::SubscriptionItem {
                price_id: "price_seat".to_string(),
                quantity: 1,
            }],
        })
        .await
        .expect("purchase");
    let updates = updates.lock().unwrap();
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].0, ComputerSize::Large);
    assert_eq!(
        updates[0].1,
        vec![SubscriptionItem {
            price_id: "price_seat".to_string(),
            quantity: 1
        }]
    );
    drop(updates);
    let installed = computers
        .lock()
        .unwrap()
        .get(&id)
        .unwrap()
        .persona
        .clone()
        .unwrap();
    assert_eq!(installed.os_user, persona.os_user);
    assert_eq!(installed.config, persona.config);
    assert_eq!(installed.extra_service.exec, persona.extra_service.exec);
    assert_eq!(
        installed.extra_service.unit_name,
        persona.extra_service.unit_name
    );

    let quote = service
        .quote(TEAM, agent::ComputerSize::Large)
        .await
        .expect("quote");
    assert_eq!(quote.amount, 4000);
    assert_eq!(
        (quote.vcpus, quote.memory_gb, quote.disk_gb),
        (
            ComputerSize::Large.vcpus(),
            ComputerSize::Large.memory_gb(),
            ComputerSize::Large.disk_gb()
        )
    );
    assert_eq!(quote.interval, agent::BillingInterval::Month);
    let pending = service.status(TEAM, id).await.expect("status");
    assert_eq!(pending.status, agent::ComputerStatusKind::SettingUp);
    assert_eq!(pending.setup.unwrap().step, agent::SetupStep::Creating);
    assert!(matches!(
        service.status(Uuid::now_v7(), id).await,
        Err(agent::TeamAgentError::NotFound)
    ));

    {
        let mut rows = computers.lock().unwrap();
        let row = rows.get_mut(&id).unwrap();
        row.state.phase = Phase::Running { host: HOST };
        row.enrolled_at = Some(now());
    }
    assert_eq!(
        service.status(TEAM, id).await.expect("ready").status,
        agent::ComputerStatusKind::Ready
    );
    service.release(TEAM, id).await.expect("release");
    service.release(TEAM, id).await.expect("repeat release");
    service
        .release(TEAM, Uuid::now_v7())
        .await
        .expect("missing release");
}

#[tokio::test]
async fn declined_purchase_reports_unavailable_and_releases_reserved_capacity() {
    let repo = FakeRepo {
        sold_units: 4,
        ..Default::default()
    };
    let computers = repo.computers.clone();
    let service = HostedRuntimesComputers::new(Arc::new(ComputerService::new(
        repo,
        FakeBilling {
            decline: true,
            ..Default::default()
        },
        FixedClock,
    )));
    assert!(matches!(
        service
            .purchase(agent::ComputerPurchase {
                team_id: TEAM,
                created_by: "macro|admin@example.com".to_string(),
                size: agent::ComputerSize::Standard,
                name: None,
                persona: None,
                extra_items: vec![],
            })
            .await,
        Err(agent::TeamAgentError::ComputerUnavailable(_))
    ));
    assert!(
        computers
            .lock()
            .unwrap()
            .values()
            .all(|row| row.state.phase == Phase::Destroyed)
    );
}

#[tokio::test]
async fn billing_provider_failures_remain_upstream_errors() {
    let service = HostedRuntimesComputers::new(Arc::new(ComputerService::new(
        FakeRepo::default(),
        FakeBilling {
            provider_fails: true,
            ..Default::default()
        },
        FixedClock,
    )));
    assert!(matches!(
        service.quote(TEAM, agent::ComputerSize::Standard).await,
        Err(agent::TeamAgentError::ComputerProvider(_))
    ));
}
