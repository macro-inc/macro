use super::*;

#[tokio::test]
async fn capacity_wait_is_visible_before_and_after_first_enrollment() {
    for (phase, enrolled) in [
        (Phase::Provisioning { start: false }, false),
        (Phase::Stopped, false),
        (Phase::Stopped, true),
    ] {
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
                    reason: "capacity test".to_owned(),
                },
                purchase_key: key("buy-dialog-1"),
                team_id: TEAM,
                created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                size: ComputerSize::Standard,
                name: None,
                extra_items: vec![],
            })
            .await
            .unwrap()
            .computer_id();
        {
            let mut computers = service.repo.computers.lock().unwrap();
            let computer = computers.get_mut(&id).unwrap();
            computer.state.phase = phase;
            computer.state.power_on_requested = true;
            computer.enrolled_at = enrolled.then(now);
        }
        let status = service.status(TEAM, id).await.unwrap();
        assert_eq!(
            serde_json::to_value(status.status).unwrap(),
            "waiting_for_capacity"
        );
        assert!(status.setup.is_none());
    }
}
