use super::*;
use crate::domain::image::GuestImage;

#[tokio::test]
async fn an_image_update_needs_a_running_or_stopped_computer_and_a_new_image() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let id = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Comped {
                reason: "image test".to_owned(),
            },
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    let base = GuestImage::try_new("macro-box/2026-11-01").unwrap();
    let next = GuestImage::try_new("macro-box/2026-11-10").unwrap();

    // Still provisioning: nothing to rebuild yet.
    assert!(matches!(
        service.update_image(TEAM, id, next.clone()).await,
        Err(ComputerError::NotUpdatable)
    ));
    assert!(matches!(
        service.rollback_image(TEAM, id).await,
        Err(ComputerError::NoPreviousImage)
    ));

    {
        let mut computers = service.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.state.phase = Phase::Running { host: HOST };
        computer.image = Some(base.clone());
    }
    assert!(matches!(
        service.update_image(TEAM, id, base.clone()).await,
        Err(ComputerError::BadRequest(_))
    ));
    assert!(matches!(
        service
            .update_image(uuid::Uuid::nil(), id, next.clone())
            .await,
        Err(ComputerError::NotFound)
    ));

    let update = service.update_image(TEAM, id, next.clone()).await.unwrap();
    assert_eq!(
        update,
        ImageUpdate {
            image: next.clone(),
            previous_image: Some(base.clone()),
        }
    );
    let computer = service
        .repo
        .computers
        .lock()
        .unwrap()
        .get(&id)
        .unwrap()
        .clone();
    assert_eq!(
        computer.state.phase,
        Phase::Updating {
            host: HOST,
            start: true
        }
    );
    // A second request while the first one runs is refused, not queued.
    assert!(matches!(
        service.update_image(TEAM, id, next).await,
        Err(ComputerError::NotUpdatable)
    ));
}
