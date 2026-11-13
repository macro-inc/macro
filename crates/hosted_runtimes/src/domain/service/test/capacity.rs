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
            for (index, size) in purchases.into_iter().enumerate() {
                let _ = service.purchase(PurchaseRequest {
                    billing: PurchaseBilling::Comped { reason: "capacity test".to_owned() },
                    purchase_key: key(&format!("buy-dialog-{index}")),
                    team_id: TEAM,
                    created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                    size: match size { 0 => ComputerSize::Standard, 1 => ComputerSize::Large, _ => ComputerSize::Xl },
                    name: None, extra_items: vec![],
                }).await;
                let computers = service.repo.computers.lock().unwrap();
                let reserved: u32 = computers.values()
                    .filter(|c| c.state.is_live())
                    .map(|c| c.resources.units()).sum();
                proptest::prop_assert!(reserved <= 9);
            }
            Ok(())
        })?;
    }
}

#[tokio::test]
async fn sizes_too_large_to_ever_wake_are_not_offered_or_sold() {
    // 3 awake units, sold 3x: an XL (4 units) fits the sold capacity but
    // could never be powered on.
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            awake_units: Some(3),
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(rollout::enabled_rollout());

    let offers = service
        .offers(
            TEAM,
            MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        offers
            .iter()
            .map(|offer| (offer.size, offer.sold_out))
            .collect::<Vec<_>>(),
        vec![
            (ComputerSize::Standard, false),
            (ComputerSize::Large, false)
        ]
    );

    let xl = service
        .purchase(PurchaseRequest {
            size: ComputerSize::Xl,
            ..standard_purchase("buy-dialog-xl")
        })
        .await;
    assert!(matches!(xl, Err(ComputerError::SoldOut(ComputerSize::Xl))));
    assert!(service.repo.reservations.lock().unwrap().is_empty());
    assert!(service.billing.adds.lock().unwrap().is_empty());
}

#[tokio::test]
async fn offers_list_runnable_sizes_and_mark_unsellable_ones_sold_out() {
    use ComputerSize::{Large, Standard, Xl};
    // (awake units, sold units) → offered sizes with whether each is sold out.
    let cases = [
        (
            (4, 12),
            vec![(Standard, false), (Large, false), (Xl, false)],
        ),
        ((3, 9), vec![(Standard, false), (Large, false)]),
        ((3, 1), vec![(Standard, false), (Large, true)]),
        ((1, 3), vec![(Standard, false)]),
        ((4, 0), vec![(Standard, true), (Large, true), (Xl, true)]),
        ((0, 0), vec![]),
    ];
    for ((awake_units, sold_units), expected) in cases {
        let service = ComputerService::new(
            FakeRepo {
                sold_units,
                awake_units: Some(awake_units),
                ..FakeRepo::default()
            },
            FakeBilling::default(),
            FixedClock,
            StaticFleetAttachment(FleetAttachment::Attached),
        )
        .with_rollout(rollout::enabled_rollout());
        let offers = service
            .offers(
                TEAM,
                MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            offers
                .iter()
                .map(|offer| (offer.size, offer.sold_out))
                .collect::<Vec<_>>(),
            expected,
            "awake {awake_units}, sold {sold_units}"
        );
    }
}
