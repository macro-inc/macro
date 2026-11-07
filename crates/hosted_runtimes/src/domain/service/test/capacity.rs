use super::*;

#[tokio::test]
async fn persona_purchase_rejects_full_awake_reservations_before_billing() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(rollout::enabled_rollout());
    service
        .repo
        .register_host(crate::domain::models::HostRegistration {
            name: "capacity-test".to_owned(),
            memory_gb: 24,
            reserve_gb: 0,
            oversell_factor: 3,
        })
        .await
        .unwrap();
    for (index, accepted) in [(1, true), (2, true), (3, true), (4, false)] {
        let result = service
            .purchase(PurchaseRequest {
                billing: PurchaseBilling::Comped {
                    reason: "capacity test".to_owned(),
                },
                team_id: TEAM,
                created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                size: ComputerSize::Standard,
                name: None,
                persona: Some(persona()),
                extra_items: vec![],
            })
            .await;
        assert_eq!(result.is_ok(), accepted, "purchase {index}");
    }
    let offers = service
        .offers(
            TEAM,
            MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(offers).unwrap()[0]["alwaysOnSoldOut"],
        true
    );
}

proptest::proptest! {
    #[test]
    fn persona_reservations_never_exceed_awake_capacity(
        purchases in proptest::collection::vec((proptest::bool::ANY, 0_u8..3), 0..24)
    ) {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let service = ComputerService::new(
                FakeRepo { sold_units: 9, ..FakeRepo::default() },
                FakeBilling::default(), FixedClock,
                StaticFleetAttachment(FleetAttachment::Attached),
            );
            service.repo.register_host(crate::domain::models::HostRegistration {
                name: "capacity-test".to_owned(), memory_gb: 24, reserve_gb: 0, oversell_factor: 3,
            }).await.unwrap();
            for (always_on, size) in purchases {
                let _ = service.purchase(PurchaseRequest {
                    billing: PurchaseBilling::Comped { reason: "capacity test".to_owned() },
                    team_id: TEAM,
                    created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                    size: match size { 0 => ComputerSize::Standard, 1 => ComputerSize::Large, _ => ComputerSize::Xl },
                    name: None, persona: always_on.then(persona), extra_items: vec![],
                }).await;
                let computers = service.repo.computers.lock().unwrap();
                let reserved: u32 = computers.values()
                    .filter(|c| c.persona.is_some() && c.state.holds_units())
                    .map(|c| c.resources.units()).sum();
                proptest::prop_assert!(reserved <= 3);
            }
            Ok(())
        })?;
    }
}
