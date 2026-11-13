use super::*;
use crate::domain::rollout::{ComputerRollout, ENABLE_MACRO_COMPUTERS};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_user_id::user_id::MacroUserIdStr;

pub(super) fn enabled_rollout() -> ComputerRollout {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
        Ok(FlagSnapshot::new([(
            ENABLE_MACRO_COMPUTERS.into(),
            FlagValue::Boolean(true),
        )])),
    );
    ComputerRollout::new(flags)
}

fn disabled_rollout() -> ComputerRollout {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
        Ok(FlagSnapshot::new([(
            ENABLE_MACRO_COMPUTERS.into(),
            FlagValue::Boolean(false),
        )])),
    );
    ComputerRollout::new(flags)
}

#[tokio::test]
async fn purchase_for_team_refuses_flag_off_before_reserving_or_billing() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(disabled_rollout());
    let result = service
        .purchase_for_team(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            purchase_key: key("buy-dialog-1"),
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            extra_items: vec![],
        })
        .await;
    assert!(matches!(result, Err(ComputerError::RolloutDisabled)));
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn offers_refuse_flag_off_before_billing() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(disabled_rollout());
    assert!(matches!(
        service
            .offers(
                TEAM,
                MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap()
            )
            .await,
        Err(ComputerError::RolloutDisabled)
    ));
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

async fn existing_computer_with_flag_off() -> (
    ComputerService<FakeRepo, FakeBilling, FixedClock, StaticFleetAttachment>,
    ComputerId,
) {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(disabled_rollout());
    let id = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            purchase_key: key("buy-dialog-1"),
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: Some("Build box".to_owned()),
            extra_items: vec![],
        })
        .await
        .unwrap()
        .computer_id();
    (service, id)
}

#[tokio::test]
async fn list_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    assert_eq!(service.list(TEAM).await.unwrap()[0].id, id);
}

#[tokio::test]
async fn status_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    assert_eq!(service.status(TEAM, id).await.unwrap().id, id);
}

#[tokio::test]
async fn power_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    assert!(!service.set_power(TEAM, id, false).await.unwrap().powered_on);
}

#[tokio::test]
async fn cancel_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    assert!(service.cancel(TEAM, id).await.unwrap().cancels_at.is_some());
}

#[tokio::test]
async fn undo_cancel_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    service.cancel(TEAM, id).await.unwrap();
    assert!(
        service
            .undo_cancel(TEAM, id)
            .await
            .unwrap()
            .cancels_at
            .is_none()
    );
}

#[tokio::test]
async fn retry_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    service
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .state
        .phase = Phase::Crashed {
        restarts: 3,
        retry: None,
    };
    service.retry(TEAM, id).await.unwrap();
}

#[tokio::test]
async fn restore_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    {
        let mut computers = service.repo.computers.lock().unwrap();
        let state = &mut computers.get_mut(&id).unwrap().state;
        state.phase = Phase::Stopped;
        state.power = crate::domain::lifecycle::Power::Off;
        state.billing = crate::domain::lifecycle::Billing::EndsAt {
            at: now() - chrono::Duration::days(2),
        };
    }
    assert_eq!(
        service.restore(TEAM, id).await.unwrap().billing,
        Some(crate::domain::models::BillingStatus::Active)
    );
}

#[tokio::test]
async fn setup_complete_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    service.complete_setup(TEAM, id).await.unwrap();
    assert!(
        service.repo.computers.lock().unwrap()[&id]
            .setup_completed_at
            .is_some()
    );
}

#[tokio::test]
async fn release_remains_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    assert_eq!(
        service
            .release_now(TEAM, id, "Build box")
            .await
            .unwrap()
            .status,
        crate::domain::models::ComputerStatusKind::Released
    );
}

#[tokio::test]
async fn webhook_reconcile_and_billing_workers_remain_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    service
        .observe_subscription(
            TEAM,
            crate::domain::service::billing::SubscriptionObserved {
                status: crate::domain::service::billing::SubscriptionStatus::Active,
                items: vec![],
                current_period_end: now(),
                observed_at: now(),
            },
        )
        .await
        .unwrap();
    service.release_now(TEAM, id, "Build box").await.unwrap();
    service.run_billing_effects().await.unwrap();
}

#[tokio::test]
async fn undo_is_offered_until_the_paid_period_ends() {
    let (service, id) = existing_computer_with_flag_off().await;

    let canceled = service.cancel(TEAM, id).await.unwrap();
    assert!(canceled.can_undo_cancel);
    assert_eq!(
        canceled.cancels_at,
        Some(now() + chrono::Duration::days(20))
    );

    service
        .repo
        .apply(id, Event::BillingEnds, now() + chrono::Duration::days(20))
        .await
        .unwrap();
    let ended = service
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(ended.state.power, Power::Off);
}
