use super::*;

proptest::proptest! {
    #[test]
    fn reservations_never_exceed_sold_capacity(
        purchases in proptest::collection::vec(0_u8..3, 0..24)
    ) {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let service = ComputerService::new(
                FakeRepo { sold_units: 9, ..FakeRepo::default() },
                FakeBilling::default(), FixedClock,
                StaticFleetAttachment(FleetAttachment::Attached),
            );
            for size in purchases {
                let _ = service.purchase(PurchaseRequest {
                    billing: PurchaseBilling::Comped { reason: "capacity test".to_owned() },
                    team_id: TEAM,
                    created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                    size: match size { 0 => ComputerSize::Standard, 1 => ComputerSize::Large, _ => ComputerSize::Xl },
                    name: None, extra_items: vec![],
                }).await;
                let computers = service.repo.computers.lock().unwrap();
                let reserved: u32 = computers.values()
                    .filter(|c| c.state.holds_units())
                    .map(|c| c.resources.units()).sum();
                proptest::prop_assert!(reserved <= 9);
            }
            Ok(())
        })?;
    }
}
