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
    );
    let id = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: Some("Unavailable computer".to_owned()),
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
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
        Err(ComputerError::BadRequest(_))
    ));
    assert!(service.repo.events.lock().unwrap().is_empty());
}
