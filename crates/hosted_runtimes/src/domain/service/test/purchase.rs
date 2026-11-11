use super::*;
use crate::domain::models::{SetupProgress, SetupStep};

#[tokio::test]
async fn both_stripe_purchase_entry_points_provision_before_returning() {
    for team_purchase in [false, true] {
        let service = ComputerService::new(
            FakeRepo {
                sold_units: 8,
                ..FakeRepo::default()
            },
            FakeBilling::default(),
            FixedClock,
            StaticFleetAttachment(FleetAttachment::Attached),
        )
        .with_rollout(super::rollout::enabled_rollout());
        let request = PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            extra_items: vec![],
        };
        let id = if team_purchase {
            service.purchase_for_team(request).await.unwrap()
        } else {
            service.purchase(request).await.unwrap()
        };
        let computer = service
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap();
        assert_eq!(
            computer.state.phase,
            Phase::Provisioning {
                host: HOST,
                start: true
            }
        );
        assert_eq!(computer.state.payment, PaymentOutcome::Paid);
        assert_eq!(
            computer.status(0).setup,
            Some(SetupProgress {
                step: SetupStep::Creating,
                position: 1,
                total: 4,
            })
        );
        assert_eq!(
            service.repo.events.lock().unwrap().as_slice(),
            &[(id, Event::PaymentConfirmed)]
        );
        assert!(
            service
                .repo
                .effects
                .lock()
                .unwrap()
                .iter()
                .all(|pending| !matches!(pending.effect, Effect::ConfirmPayment { .. }))
        );
        let fleet = service
            .repo
            .lease_effects(
                EffectWorker::Fleet,
                10,
                now(),
                now() + chrono::Duration::minutes(1),
            )
            .await
            .unwrap();
        assert_eq!(fleet.len(), 1);
        assert!(matches!(fleet[0].effect, Effect::Create { .. }));
        assert_eq!(service.run_billing_effects().await.unwrap(), 0);
        assert_eq!(
            *service.billing.calls.lock().unwrap(),
            vec!["quote", "add_computer"]
        );
    }
}

#[tokio::test]
async fn comped_purchase_needs_no_post_reservation_payment_write() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 8,
            fail_next_apply: std::sync::atomic::AtomicBool::new(true),
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let id = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Comped {
                reason: "test credit".to_owned(),
            },
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    let computer = service
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        computer.state.phase,
        Phase::Provisioning {
            host: HOST,
            start: true
        }
    );
    assert_eq!(computer.state.payment, PaymentOutcome::Comped);
    assert_eq!(computer.state.comp_reason.as_deref(), Some("test credit"));
    assert!(service.repo.events.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
    assert!(
        service
            .repo
            .effects
            .lock()
            .unwrap()
            .iter()
            .all(|pending| !matches!(pending.effect, Effect::ConfirmPayment { .. }))
    );
}

#[tokio::test]
async fn unknown_payment_is_creating_while_delayed_recovery_stays_pending() {
    for lost_write in [false, true] {
        let service = ComputerService::new(
            FakeRepo {
                sold_units: 8,
                fail_next_apply: std::sync::atomic::AtomicBool::new(lost_write),
                ..FakeRepo::default()
            },
            FakeBilling {
                provider_error: !lost_write,
                ..FakeBilling::default()
            },
            FixedClock,
            StaticFleetAttachment(FleetAttachment::Attached),
        );
        assert!(
            service
                .purchase(PurchaseRequest {
                    billing: PurchaseBilling::Stripe,
                    team_id: TEAM,
                    created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned())
                        .unwrap(),
                    size: ComputerSize::Standard,
                    name: None,
                    extra_items: vec![],
                })
                .await
                .is_err()
        );
        let computer = service
            .repo
            .computers
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .clone();
        assert!(matches!(computer.state.phase, Phase::PendingPayment { .. }));
        let status = service.status(TEAM, computer.id).await.unwrap();
        assert_eq!(status.payment.unwrap(), PaymentOutcome::Pending);
        assert_eq!(
            status.setup,
            Some(SetupProgress {
                step: SetupStep::Creating,
                position: 1,
                total: 4
            })
        );
        let effects = service.repo.effects.lock().unwrap().clone();
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0].effect, Effect::ConfirmPayment { .. }));
        assert_eq!(
            service.repo.effect_run_after.lock().unwrap()[&effects[0].id],
            now() + crate::domain::lifecycle::PAYMENT_CONFIRM_DELAY
        );
        assert_eq!(service.run_billing_effects().await.unwrap(), 0);
        assert!(
            service
                .repo
                .lease_effects(
                    EffectWorker::Fleet,
                    10,
                    now(),
                    now() + chrono::Duration::minutes(1),
                )
                .await
                .unwrap()
                .is_empty()
        );
    }
}
