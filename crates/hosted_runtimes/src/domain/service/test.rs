use macro_user_id::user_id::MacroUserIdStr;
use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::*;
use crate::domain::enrollment::{PersonaConfigKey, PersonaOsUser, PersonaService, SystemdUnitName};
use crate::domain::fakes::{FakeRepo, FixedClock, HOST, TEAM, now};
use crate::domain::lifecycle::{Billing as BillingState, ComputerState, PaymentOutcome, Power};
use crate::domain::models::{BillingInterval, SubscriptionItem};

mod comped;
mod purchase;
mod quarantine;
mod rollout;
mod sold_resources;

/// Records subscription updates; fails them when `decline` is set.
#[derive(Default)]
struct FakeBilling {
    quote_price: Option<crate::domain::models::StripePriceId>,
    not_sold: bool,
    no_subscription: bool,
    yearly: bool,
    decline: bool,
    provider_error: bool,
    charged: Mutex<HashSet<String>>,
    calls: Mutex<Vec<&'static str>>,
    updates: Mutex<
        Vec<(
            crate::domain::models::StripePriceId,
            Vec<SubscriptionItem>,
            String,
        )>,
    >,
    removals: Mutex<Vec<(crate::domain::models::StripePriceId, String)>>,
}

impl Billing for FakeBilling {
    fn sales_available(&self) -> bool {
        !self.not_sold
    }

    async fn quote(&self, _team_id: Uuid, size: ComputerSize) -> Result<Quote, BillingError> {
        self.calls.lock().unwrap().push("quote");
        if self.no_subscription {
            return Err(BillingError::NoSubscription);
        }
        Ok(Quote {
            size,
            price_id: self.quote_price.clone().unwrap_or_else(|| {
                crate::domain::models::StripePriceId::parse(&format!("price_{}", size.as_ref()))
                    .unwrap()
            }),
            amount: 2000
                * i64::from(match size {
                    ComputerSize::Standard => 1,
                    ComputerSize::Large => 2,
                    ComputerSize::Xl => 4,
                }),
            currency: "usd".to_owned(),
            interval: if self.yearly {
                BillingInterval::Year
            } else {
                BillingInterval::Month
            },
        })
    }

    async fn add_computer(
        &self,
        _team_id: Uuid,
        price_id: &crate::domain::models::StripePriceId,
        extra_items: &[SubscriptionItem],
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        self.calls.lock().unwrap().push("add_computer");
        if self.provider_error {
            return Err(BillingError::Provider(rootcause::report!(
                "billing timed out"
            )));
        }
        if self.decline {
            return Err(BillingError::PaymentFailed);
        }
        self.charged
            .lock()
            .unwrap()
            .insert(idempotency_key.to_owned());
        self.updates.lock().unwrap().push((
            price_id.clone(),
            extra_items.to_vec(),
            idempotency_key.to_owned(),
        ));
        Ok(())
    }

    async fn remove_computer(
        &self,
        _team_id: Uuid,
        price_id: &crate::domain::models::StripePriceId,
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        self.calls.lock().unwrap().push("remove_computer");
        self.removals
            .lock()
            .unwrap()
            .push((price_id.clone(), idempotency_key.to_owned()));
        Ok(())
    }

    async fn period_end(&self, _team_id: Uuid) -> Result<DateTime<Utc>, BillingError> {
        self.calls.lock().unwrap().push("period_end");
        Ok(now() + chrono::Duration::days(20))
    }
}

fn persona() -> Persona {
    Persona {
        name: "Ada".to_owned(),
        os_user: PersonaOsUser::parse("agent-ada").unwrap(),
        extra_service: PersonaService {
            unit_name: SystemdUnitName::parse("ada-brain").unwrap(),
            exec: "/usr/local/bin/brain --persona ada".to_owned(),
            env: BTreeMap::from([(
                PersonaConfigKey::parse("RUST_LOG").unwrap(),
                "info".to_owned(),
            )]),
        },
        config: BTreeMap::from([(
            PersonaConfigKey::parse("AGENT_ID").unwrap(),
            "agent-1".to_owned(),
        )]),
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
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: Some(persona()),
            extra_items: vec![SubscriptionItem {
                price_id: crate::domain::models::StripePriceId::parse("price_agent_seat").unwrap(),
                quantity: 1,
            }],
        })
        .await
        .unwrap();

    assert_eq!(
        *service.billing.updates.lock().unwrap(),
        vec![(
            crate::domain::models::StripePriceId::parse("price_standard").unwrap(),
            vec![SubscriptionItem {
                price_id: crate::domain::models::StripePriceId::parse("price_agent_seat").unwrap(),
                quantity: 1,
            }],
            format!("computer-add:{computer_id}"),
        )]
    );
    let stored = service
        .repo
        .get(computer_id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        stored.resources,
        crate::domain::size::ComputerResources {
            vcpus: crate::domain::size::Vcpus::new(4),
            memory_gib: crate::domain::size::MemoryGib::new(8),
            disk_gib: crate::domain::size::DiskGib::new(100),
        }
    );
    assert_eq!(stored.catalog_entry.as_str(), "standard@2026-11");
    assert_eq!(stored.price_id.unwrap().as_str(), "price_standard");
    let status = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(status.name.as_str(), "Ada");
    assert_eq!(status.persona_name.as_deref(), Some("Ada"));
    assert_eq!(
        status.status,
        crate::domain::models::ComputerStatusKind::SettingUp
    );
    assert_eq!(
        status.setup,
        Some(crate::domain::models::SetupProgress {
            step: crate::domain::models::SetupStep::Creating,
            position: 1,
            total: 4,
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
            generation: crate::domain::persona_credentials::EnrollmentGeneration::new(1),
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
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
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
    let computers = service.list(TEAM).await.unwrap();
    assert_eq!(computers.len(), 1);
    assert_eq!(
        computers[0].status,
        crate::domain::models::ComputerStatusKind::PaymentFailed
    );
    assert_eq!(
        service.repo.computers.lock().unwrap()[&computers[0].id]
            .state
            .phase,
        Phase::PaymentFailed
    );
    service.repo.effect_run_after.lock().unwrap().clear();
    assert_eq!(service.run_billing_effects().await.unwrap(), 0);
    assert_eq!(
        *service.billing.calls.lock().unwrap(),
        vec!["quote", "add_computer"]
    );
    assert!(service.billing.charged.lock().unwrap().is_empty());
    assert_eq!(computers[0].payment.unwrap(), PaymentOutcome::Unbilled);
    let released = service
        .release_now(TEAM, computers[0].id, "Build box")
        .await
        .unwrap();
    assert_eq!(
        released.status,
        crate::domain::models::ComputerStatusKind::Released
    );
    assert_eq!(released.payment.unwrap(), PaymentOutcome::Unbilled);
    assert_eq!(
        service
            .status(TEAM, released.id)
            .await
            .unwrap()
            .payment
            .unwrap(),
        PaymentOutcome::Unbilled
    );
    assert_eq!(service.run_billing_effects().await.unwrap(), 0);
    assert!(service.billing.removals.lock().unwrap().is_empty());
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
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
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
async fn persona_with_a_multiline_value_is_rejected_before_anything_is_held() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );
    let mut multiline = persona();
    multiline.config.insert(
        PersonaConfigKey::parse("AGENT_ID").unwrap(),
        "agent-1\nAGENT_ID=other".to_owned(),
    );

    let result = service
        .purchase(PurchaseRequest {
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: Some(multiline),
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
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
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
    assert_eq!(
        released.status,
        crate::domain::models::ComputerStatusKind::Released
    );
    assert_eq!(released.payment.unwrap(), PaymentOutcome::Paid);
    assert_eq!(
        service
            .status(TEAM, computer_id)
            .await
            .unwrap()
            .payment
            .unwrap(),
        PaymentOutcome::Paid
    );
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
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
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
    assert!(service.status(TEAM, computer_id).await.unwrap().powered_on);
}

#[tokio::test]
async fn webhook_count_below_ours_cancels_the_newest_computer() {
    let repo = FakeRepo {
        sold_units: 9,
        ..FakeRepo::default()
    };
    for (index, created_at) in [now() - chrono::Duration::days(3), now()]
        .into_iter()
        .enumerate()
    {
        let mut state = ComputerState::reserved(HOST, created_at);
        state.phase = Phase::Running { host: HOST };
        state.payment = PaymentOutcome::Paid;
        repo.computers.lock().unwrap().insert(
            ComputerId::new_from_uuid(Uuid::from_u128(index as u128 + 1)),
            Computer {
                id: ComputerId::new_from_uuid(Uuid::from_u128(index as u128 + 1)),
                team_id: TEAM,
                name: ComputerName::try_new(&format!("Computer {index}")).unwrap(),
                size: ComputerSize::Standard,
                resources: crate::domain::size::ComputerResources {
                    vcpus: crate::domain::size::Vcpus::new(4),
                    memory_gib: crate::domain::size::MemoryGib::new(8),
                    disk_gib: crate::domain::size::DiskGib::new(100),
                },
                catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                    "standard@2026-11".to_owned(),
                )
                .unwrap(),
                price_id: Some(
                    crate::domain::models::StripePriceId::parse("price_standard").unwrap(),
                ),
                state,
                harness_id: None,
                persona: None,
                created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
                created_at,
                enrolled_at: Some(created_at),
                enrollment_generation: Default::default(),
            },
        );
    }
    let service = ComputerService::new(repo, FakeBilling::default(), FixedClock);

    service
        .reconcile_billed_counts(
            TEAM,
            &[SubscriptionItem {
                price_id: crate::domain::models::StripePriceId::parse("price_standard").unwrap(),
                quantity: 1,
            }],
        )
        .await
        .unwrap();

    assert_eq!(
        *service.repo.events.lock().unwrap(),
        vec![(
            ComputerId::new_from_uuid(Uuid::from_u128(2)),
            Event::SubscriptionCanceled
        )]
    );
    let newest = service
        .repo
        .get(ComputerId::new_from_uuid(Uuid::from_u128(2)))
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(newest.state.power, Power::Off);
    assert!(matches!(
        newest.state.billing,
        BillingState::Canceled { .. }
    ));
}

#[tokio::test]
async fn retry_failed_computer_restarts_without_billing() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        Computer {
            id: computer_id,
            team_id: TEAM,
            name: ComputerName::try_new("Build box").unwrap(),
            size: ComputerSize::Standard,
            resources: crate::domain::size::ComputerResources {
                vcpus: crate::domain::size::Vcpus::new(4),
                memory_gib: crate::domain::size::MemoryGib::new(8),
                disk_gib: crate::domain::size::DiskGib::new(100),
            },
            catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                "standard@2026-11".to_owned(),
            )
            .unwrap(),
            price_id: Some(crate::domain::models::StripePriceId::parse("price_standard").unwrap()),
            state: ComputerState {
                phase: Phase::Failed { host: HOST },
                power: Power::On,
                billing: BillingState::Active,
                payment: PaymentOutcome::Paid,
                comp_reason: None,
                macrod_connected: false,
                macrod_misses: 0,
                recent_crashes: vec![],
                wake_requested: false,
                capacity_wait: None,
            },
            harness_id: None,
            persona: None,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            created_at: now(),
            enrolled_at: Some(now()),
            enrollment_generation: Default::default(),
        },
    );
    let service = ComputerService::new(repo, FakeBilling::default(), FixedClock);

    let result = service.retry(TEAM, computer_id).await;

    let status = result.unwrap();
    assert_eq!(status, service.status(TEAM, computer_id).await.unwrap());
    let computer = service
        .repo
        .get(computer_id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(computer.state.phase, Phase::Booting { host: HOST });
    assert_eq!(
        *service.repo.events.lock().unwrap(),
        vec![(computer_id, Event::OperatorRetry)]
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
        vec![
            Effect::Restart { host: HOST },
            Effect::ScheduleTimer {
                kind: crate::domain::lifecycle::TimerKind::MacrodMissing,
                at: now() + crate::domain::lifecycle::MACROD_GRACE,
            },
        ]
    );
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn retry_running_computer_is_rejected_without_applying_events() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        Computer {
            id: computer_id,
            team_id: TEAM,
            name: ComputerName::try_new("Build box").unwrap(),
            size: ComputerSize::Standard,
            resources: crate::domain::size::ComputerResources {
                vcpus: crate::domain::size::Vcpus::new(4),
                memory_gib: crate::domain::size::MemoryGib::new(8),
                disk_gib: crate::domain::size::DiskGib::new(100),
            },
            catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                "standard@2026-11".to_owned(),
            )
            .unwrap(),
            price_id: Some(crate::domain::models::StripePriceId::parse("price_standard").unwrap()),
            state: ComputerState {
                phase: Phase::Running { host: HOST },
                power: Power::On,
                billing: BillingState::Active,
                payment: PaymentOutcome::Paid,
                comp_reason: None,
                macrod_connected: false,
                macrod_misses: 0,
                recent_crashes: vec![],
                wake_requested: false,
                capacity_wait: None,
            },
            harness_id: None,
            persona: None,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            created_at: now(),
            enrolled_at: Some(now()),
            enrollment_generation: Default::default(),
        },
    );
    let service = ComputerService::new(repo, FakeBilling::default(), FixedClock);

    let result = service.retry(TEAM, computer_id).await;

    assert!(matches!(result, Err(ComputerError::NotFailed)));
    assert!(service.repo.events.lock().unwrap().is_empty());
    assert!(service.repo.effects.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn retry_another_teams_computer_is_not_found() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        Computer {
            id: computer_id,
            team_id: TEAM,
            name: ComputerName::try_new("Build box").unwrap(),
            size: ComputerSize::Standard,
            resources: crate::domain::size::ComputerResources {
                vcpus: crate::domain::size::Vcpus::new(4),
                memory_gib: crate::domain::size::MemoryGib::new(8),
                disk_gib: crate::domain::size::DiskGib::new(100),
            },
            catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                "standard@2026-11".to_owned(),
            )
            .unwrap(),
            price_id: Some(crate::domain::models::StripePriceId::parse("price_standard").unwrap()),
            state: ComputerState {
                phase: Phase::Failed { host: HOST },
                power: Power::On,
                billing: BillingState::Active,
                payment: PaymentOutcome::Paid,
                comp_reason: None,
                macrod_connected: false,
                macrod_misses: 0,
                recent_crashes: vec![],
                wake_requested: false,
                capacity_wait: None,
            },
            harness_id: None,
            persona: None,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            created_at: now(),
            enrolled_at: Some(now()),
            enrollment_generation: Default::default(),
        },
    );
    let service = ComputerService::new(repo, FakeBilling::default(), FixedClock);

    let result = service.retry(Uuid::from_u128(2), computer_id).await;

    assert!(matches!(result, Err(ComputerError::NotFound)));
    assert!(service.repo.events.lock().unwrap().is_empty());
    assert!(service.repo.effects.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn successful_charge_with_lost_write_is_confirmed_once_by_the_outbox() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            fail_next_apply: std::sync::atomic::AtomicBool::new(true),
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );
    let result = service
        .purchase(PurchaseRequest {
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Large,
            name: Some("Build box".to_owned()),
            persona: None,
            extra_items: vec![SubscriptionItem {
                price_id: crate::domain::models::StripePriceId::parse("price_seat").unwrap(),
                quantity: 1,
            }],
        })
        .await;
    assert!(matches!(result, Err(ComputerError::Internal(_))));
    let computer = service
        .repo
        .computers
        .lock()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .clone();
    assert_eq!(
        computer.state.phase,
        Phase::PendingPayment {
            host: HOST,
            since: now()
        }
    );
    assert_eq!(
        computer.status().setup.unwrap().step,
        crate::domain::models::SetupStep::Creating
    );
    assert_eq!(service.run_billing_effects().await.unwrap(), 0);
    service.repo.effect_run_after.lock().unwrap().clear();
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(
        service
            .repo
            .get(computer.id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .phase,
        Phase::Provisioning {
            host: HOST,
            start: true
        }
    );
    let expected = (
        crate::domain::models::StripePriceId::parse("price_large").unwrap(),
        vec![SubscriptionItem {
            price_id: crate::domain::models::StripePriceId::parse("price_seat").unwrap(),
            quantity: 1,
        }],
        format!("computer-add:{}", computer.id),
    );
    assert_eq!(
        *service.billing.updates.lock().unwrap(),
        vec![expected.clone(), expected]
    );
    assert_eq!(service.billing.charged.lock().unwrap().len(), 1);
    assert_eq!(service.run_billing_effects().await.unwrap(), 0);
}

#[tokio::test]
async fn provider_error_stays_pending_and_confirmation_keeps_retrying() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            provider_error: true,
            ..FakeBilling::default()
        },
        FixedClock,
    );
    let result = service
        .purchase(PurchaseRequest {
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await;
    assert!(matches!(
        result,
        Err(ComputerError::Billing(BillingError::Provider(_)))
    ));
    let id = *service
        .repo
        .computers
        .lock()
        .unwrap()
        .keys()
        .next()
        .unwrap();
    service.repo.effects.lock().unwrap()[0].attempts = 1000;
    service.repo.effect_run_after.lock().unwrap().clear();
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(
        service
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .phase,
        Phase::PendingPayment {
            host: HOST,
            since: now()
        }
    );
    assert_eq!(service.repo.effects.lock().unwrap()[0].attempts, 1001);
    let effect_id = service.repo.effects.lock().unwrap()[0].id;
    assert_eq!(
        service.repo.effect_run_after.lock().unwrap()[&effect_id],
        now() + chrono::Duration::hours(1)
    );
    assert_eq!(
        *service.billing.calls.lock().unwrap(),
        vec!["quote", "add_computer", "add_computer"]
    );
}

#[tokio::test]
async fn already_confirmed_purchase_completes_confirmation_without_billing_again() {
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
            billing: crate::domain::models::PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    service
        .repo
        .effects
        .lock()
        .unwrap()
        .push(crate::domain::ports::PendingEffect {
            id: 100,
            computer_id,
            effect: Effect::ConfirmPayment {
                extra_items: vec![],
            },
            attempts: 0,
        });
    service.repo.effect_run_after.lock().unwrap().clear();
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(
        *service.billing.calls.lock().unwrap(),
        vec!["quote", "add_computer"]
    );
}

#[tokio::test]
async fn confirmation_records_a_definite_refusal_without_removing_billing() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 1,
            ..FakeRepo::default()
        },
        FakeBilling {
            decline: true,
            ..FakeBilling::default()
        },
        FixedClock,
    );
    let id = ComputerId::new_from_uuid(Uuid::from_u128(17));
    service
        .repo
        .reserve(
            NewComputer {
                billing: crate::domain::models::PurchaseBilling::Stripe,
                id,
                team_id: TEAM,
                name: ComputerName::try_new("Build box").unwrap(),
                size: ComputerSize::Standard,
                resources: crate::domain::size::ComputerResources {
                    vcpus: crate::domain::size::Vcpus::new(4),
                    memory_gib: crate::domain::size::MemoryGib::new(8),
                    disk_gib: crate::domain::size::DiskGib::new(100),
                },
                catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                    "standard@2026-11".to_owned(),
                )
                .unwrap(),
                price_id: Some(
                    crate::domain::models::StripePriceId::parse("price_standard").unwrap(),
                ),
                persona: None,
                created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
                extra_items: vec![],
            },
            now(),
        )
        .await
        .unwrap();
    service.repo.effect_run_after.lock().unwrap().clear();
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(
        service
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .phase,
        Phase::PaymentFailed
    );
    assert!(service.repo.effects.lock().unwrap().is_empty());
    assert_eq!(*service.billing.calls.lock().unwrap(), vec!["add_computer"]);
    assert!(service.billing.charged.lock().unwrap().is_empty());
    assert!(service.billing.removals.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disabled_sales_reject_purchase_before_reserving_capacity() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling {
            not_sold: true,
            ..FakeBilling::default()
        },
        FixedClock,
    );
    let result = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await;
    assert!(matches!(
        result,
        Err(ComputerError::Billing(BillingError::NotAvailable))
    ));
    assert!(service.repo.list_for_team(TEAM).await.unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

mod capacity;

mod waiting;

mod availability;
