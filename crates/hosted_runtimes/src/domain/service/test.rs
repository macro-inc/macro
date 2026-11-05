use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use super::*;
use crate::domain::enrollment::PersonaService;
use crate::domain::lifecycle::{
    Billing as BillingState, ComputerState, Context, EffectWorker, HostId, Power, transition,
};
use crate::domain::models::{BillingInterval, Host, HostRegistration, SubscriptionItem};
use crate::domain::ports::{DueTimer, PendingEffect};

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
    computers: Mutex<HashMap<Uuid, Computer>>,
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
        self.events.lock().unwrap().push((computer_id, event.clone()));
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

    async fn mark_enrolled(&self, _computer_id: Uuid, _now: DateTime<Utc>) -> Result<(), FakeError> {
        Ok(())
    }

    async fn idle_running(&self, _before: DateTime<Utc>) -> Result<Vec<Uuid>, FakeError> {
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
        self.effects.lock().unwrap().retain(|pending| pending.id != id);
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

    async fn take_due_timers(&self, _now: DateTime<Utc>, _limit: u32) -> Result<Vec<DueTimer>, FakeError> {
        Ok(vec![])
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

    async fn notify_requests(&self, _team_id: Uuid, _user_id: String) -> Result<Vec<ComputerSize>, FakeError> {
        Ok(vec![])
    }
}

/// Records subscription updates; fails them when `decline` is set.
#[derive(Default)]
struct FakeBilling {
    decline: bool,
    updates: Mutex<Vec<(ComputerSize, Vec<SubscriptionItem>, String)>>,
    removals: Mutex<Vec<(ComputerSize, String)>>,
}

impl Billing for FakeBilling {
    async fn quote(&self, _team_id: Uuid, size: ComputerSize) -> Result<Quote, BillingError> {
        Ok(Quote {
            size,
            price_id: format!("price_{}", size.as_str()),
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

fn persona() -> Persona {
    Persona {
        name: "Ada".to_owned(),
        os_user: "ada".to_owned(),
        extra_service: PersonaService {
            unit_name: "ada-brain".to_owned(),
            exec: "/usr/local/bin/brain --persona ada".to_owned(),
            env: BTreeMap::from([("RUST_LOG".to_owned(), "info".to_owned())]),
        },
        config: BTreeMap::from([("AGENT_ID".to_owned(), "agent-1".to_owned())]),
    }
}

#[tokio::test]
async fn purchase_bills_the_computer_and_the_seat_in_one_update_then_provisions() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );

    let computer_id = service
        .purchase(PurchaseRequest {
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: None,
            persona: Some(persona()),
            extra_items: vec![SubscriptionItem {
                price_id: "price_agent_seat".to_owned(),
                quantity: 1,
            }],
        })
        .await
        .unwrap();

    assert_eq!(
        *service.billing.updates.lock().unwrap(),
        vec![(
            ComputerSize::Standard,
            vec![SubscriptionItem {
                price_id: "price_agent_seat".to_owned(),
                quantity: 1,
            }],
            format!("computer-add:{computer_id}"),
        )]
    );
    let status = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(status.name, "Ada");
    assert_eq!(status.persona_name.as_deref(), Some("Ada"));
    assert_eq!(status.status, crate::domain::models::ComputerStatusKind::SettingUp);
    assert_eq!(
        status.setup,
        Some(crate::domain::models::SetupProgress {
            step: crate::domain::models::SetupStep::Creating,
            position: 2,
            total: 5,
        })
    );
    assert_eq!(
        service
            .repo
            .effects
            .lock()
            .unwrap()
            .iter()
            .map(|pending| pending.effect.clone())
            .collect::<Vec<_>>(),
        vec![Effect::Create {
            host: HOST,
            start: true,
        }]
    );
}

#[tokio::test]
async fn declined_payment_drops_the_reservation() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            decline: true,
            ..FakeBilling::default()
        },
        FixedClock,
    );

    let result = service
        .purchase(PurchaseRequest {
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Large,
            name: Some("Build box".to_owned()),
            persona: None,
            extra_items: vec![],
        })
        .await;

    assert!(matches!(
        result,
        Err(ComputerError::Billing(BillingError::PaymentFailed))
    ));
    assert_eq!(service.list(TEAM).await.unwrap(), vec![]);
    assert!(service.repo.effects.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sold_out_size_is_not_billed() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 3,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );

    let result = service
        .purchase(PurchaseRequest {
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Xl,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await;

    assert!(matches!(result, Err(ComputerError::SoldOut)));
    assert!(service.billing.updates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn persona_with_a_reserved_user_is_rejected_before_anything_is_held() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );
    let mut root = persona();
    root.os_user = "root".to_owned();

    let result = service
        .purchase(PurchaseRequest {
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: None,
            persona: Some(root),
            extra_items: vec![],
        })
        .await;

    assert!(matches!(result, Err(ComputerError::BadRequest(_))));
    assert!(service.repo.computers.lock().unwrap().is_empty());
}

#[tokio::test]
async fn release_now_needs_the_name_and_removes_the_item_once() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );
    let computer_id = service
        .purchase(PurchaseRequest {
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: Some("Build box".to_owned()),
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();

    let wrong = service.release_now(TEAM, computer_id, "build").await;
    assert!(matches!(wrong, Err(ComputerError::ConfirmationMismatch)));

    let released = service
        .release_now(TEAM, computer_id, "Build box")
        .await
        .unwrap();
    assert_eq!(released.status, crate::domain::models::ComputerStatusKind::Released);
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(service.run_billing_effects().await.unwrap(), 0);
    assert_eq!(
        service.billing.removals.lock().unwrap().len(),
        1,
        "one removal for one release"
    );
}

#[tokio::test]
async fn other_teams_cannot_see_or_change_a_computer() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );
    let computer_id = service
        .purchase(PurchaseRequest {
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    let other_team = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_00bb);

    assert!(matches!(
        service.status(other_team, computer_id).await,
        Err(ComputerError::NotFound)
    ));
    assert!(matches!(
        service.set_power(other_team, computer_id, false).await,
        Err(ComputerError::NotFound)
    ));
    assert_eq!(
        service.status(TEAM, computer_id).await.unwrap().powered_on,
        true
    );
}

#[tokio::test]
async fn webhook_count_below_ours_cancels_the_newest_computer() {
    let repo = FakeRepo {
        sold_units: 9,
        ..FakeRepo::default()
    };
    for (index, created_at) in [now() - chrono::Duration::days(3), now()].into_iter().enumerate() {
        let mut state = ComputerState::reserved(HOST, created_at);
        state.phase = Phase::Running { host: HOST };
        repo.computers.lock().unwrap().insert(
            Uuid::from_u128(index as u128 + 1),
            Computer {
                id: Uuid::from_u128(index as u128 + 1),
                team_id: TEAM,
                name: format!("Computer {index}"),
                size: ComputerSize::Standard,
                state,
                harness_id: None,
                persona: None,
                created_by: "macro|admin@example.com".to_owned(),
                created_at,
                enrolled_at: Some(created_at),
            },
        );
    }
    let service = ComputerService::new(repo, FakeBilling::default(), FixedClock);

    service
        .reconcile_billed_count(TEAM, ComputerSize::Standard, 1)
        .await
        .unwrap();

    assert_eq!(
        *service.repo.events.lock().unwrap(),
        vec![(Uuid::from_u128(2), Event::SubscriptionCanceled)]
    );
    let newest = service.repo.get(Uuid::from_u128(2)).await.unwrap().unwrap();
    assert_eq!(newest.state.power, Power::Off);
    assert!(matches!(newest.state.billing, BillingState::Canceled { .. }));
}
