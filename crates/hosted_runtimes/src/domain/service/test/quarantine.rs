use super::*;
use crate::domain::models::ComputerStatusKind;

#[tokio::test]
async fn quarantine_is_visible_only_to_its_team_and_refuses_lifecycle_commands() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 8,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let id = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            purchase_key: key("buy-dialog-1"),
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: Some("Unavailable computer".to_owned()),
            extra_items: vec![],
        })
        .await
        .unwrap()
        .computer_id();
    service.repo.corrupt_ids.lock().unwrap().push(id);
    service.repo.events.lock().unwrap().clear();

    assert_eq!(
        service.status(TEAM, id).await.unwrap().status,
        ComputerStatusKind::NeedsAttention
    );
    assert_eq!(
        service.list(TEAM).await.unwrap()[0].status,
        ComputerStatusKind::NeedsAttention
    );
    assert!(matches!(
        service.status(Uuid::now_v7(), id).await,
        Err(ComputerError::NotFound)
    ));
    assert!(matches!(
        service.set_power(TEAM, id, true).await,
        Err(ComputerError::NeedsAttention)
    ));
    assert!(service.repo.events.lock().unwrap().is_empty());
}
