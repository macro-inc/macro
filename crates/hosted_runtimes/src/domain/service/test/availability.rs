use super::*;
use crate::domain::models::FleetAttachment;
use crate::domain::ports::StaticFleetAttachment;

#[tokio::test]
async fn detached_fleet_precedes_missing_rows_and_all_side_effects() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Detached),
    )
    .with_rollout(rollout::enabled_rollout());
    let id = ComputerId::new_from_uuid(Uuid::now_v7());
    assert!(matches!(
        service.status(TEAM, id).await,
        Err(ComputerError::FleetUnavailable(_))
    ));
    assert!(matches!(
        service
            .purchase(PurchaseRequest {
                billing: PurchaseBilling::Stripe,
                team_id: TEAM,
                created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
                size: ComputerSize::Standard,
                name: None,
                persona: None,
                extra_items: vec![],
            })
            .await,
        Err(ComputerError::FleetUnavailable(_))
    ));
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.repo.events.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn detached_catalog_needs_no_prices() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling {
            not_sold: true,
            ..FakeBilling::default()
        },
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Detached),
    );
    assert_eq!(service.catalog().len(), 3);
    assert!(service.size_spec(ComputerSize::Standard).is_ok());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn maintenance_can_read_and_release_with_detached_fleet() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct RecordingAttachment(AtomicUsize);
    impl crate::domain::ports::FleetAttachmentSource for RecordingAttachment {
        type Err = std::convert::Infallible;
        async fn attachment(&self, _now: DateTime<Utc>) -> Result<FleetAttachment, Self::Err> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(FleetAttachment::Detached)
        }
    }
    let repo = FakeRepo {
        sold_units: 9,
        ..FakeRepo::default()
    };
    let id = ComputerId::new_from_uuid(Uuid::now_v7());
    repo.reserve(
        NewComputer {
            id,
            team_id: TEAM,
            name: ComputerName::try_new("Build box").unwrap(),
            billing: PurchaseBilling::Stripe,
            extra_items: vec![],
            size: ComputerSize::Standard,
            resources: crate::domain::size::current_catalog()[0].resources,
            catalog_entry: crate::domain::size::current_catalog()[0].id.clone(),
            price_id: Some(crate::domain::models::StripePriceId::parse("price_standard").unwrap()),
            persona: Some(persona()),
            created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
        },
        now(),
    )
    .await
    .unwrap();
    repo.apply(id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
    let service = ComputerService::new(
        repo,
        FakeBilling::default(),
        FixedClock,
        RecordingAttachment(AtomicUsize::new(0)),
    );
    let roster = service
        .maintenance()
        .status_for_roster(TEAM, id)
        .await
        .unwrap();
    assert_eq!(roster.status.id, id);
    assert_eq!(roster.availability, FleetAttachment::Detached);
    let calls = service.attachment.0.load(Ordering::SeqCst);
    let released = service
        .maintenance()
        .request_release(TEAM, id)
        .await
        .unwrap();
    assert_eq!(
        released.status,
        crate::domain::models::ComputerStatusKind::Released
    );
    assert_eq!(service.attachment.0.load(Ordering::SeqCst), calls);
    assert!(
        service
            .repo
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(event_id, event)| *event_id == id && matches!(event, Event::ReleaseNow))
    );
    let effects = service.repo.effects.lock().unwrap();
    assert!(
        effects
            .iter()
            .any(|pending| matches!(pending.effect, Effect::RemoveBillingItem))
    );
    assert!(
        effects
            .iter()
            .any(|pending| matches!(pending.effect, Effect::Destroy { .. }))
    );
    assert!(
        effects
            .iter()
            .any(|pending| matches!(pending.effect, Effect::RevokeHarness { .. }))
    );
}
