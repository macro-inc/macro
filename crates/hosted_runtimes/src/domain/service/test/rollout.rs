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
async fn team_quote_refuses_flag_off_before_billing() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(disabled_rollout());
    assert!(matches!(
        service
            .quote_for_team(
                &MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
                TEAM,
                ComputerSize::Standard
            )
            .await,
        Err(ComputerError::RolloutDisabled)
    ));
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
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: Some("Build box".to_owned()),
            extra_items: vec![],
        })
        .await
        .unwrap();
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
        .phase = Phase::Failed { host: HOST };
    service.retry(TEAM, id).await.unwrap();
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
async fn internal_quote_and_purchase_remain_available_with_flag_off() {
    let (service, _) = existing_computer_with_flag_off().await;
    service
        .quote(TEAM, ComputerSize::Standard, &PurchaseBilling::Stripe)
        .await
        .unwrap();
}

#[tokio::test]
async fn webhook_reconcile_and_billing_workers_remain_available_with_flag_off() {
    let (service, id) = existing_computer_with_flag_off().await;
    service.reconcile_billed_counts(TEAM, &[]).await.unwrap();
    service.release_now(TEAM, id, "Build box").await.unwrap();
    service.run_billing_effects().await.unwrap();
}
