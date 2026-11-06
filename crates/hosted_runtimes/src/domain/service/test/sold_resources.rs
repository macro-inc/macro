use super::*;
use macro_user_id::user_id::MacroUserIdStr;

#[tokio::test]
async fn catalog_changes_only_apply_to_new_purchases() {
    use crate::domain::size::{
        CatalogEntry, CatalogEntryId, ComputerResources, DiskGib, MemoryGib, Vcpus,
    };
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 20,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );
    let first = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    let service = service.with_catalog(vec![CatalogEntry {
        id: CatalogEntryId::try_new("standard@2026-12".to_owned()).unwrap(),
        size: ComputerSize::Standard,
        resources: ComputerResources {
            vcpus: Vcpus::new(6),
            memory_gib: MemoryGib::new(12),
            disk_gib: DiskGib::new(150),
        },
    }]);
    let second = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    let old = service.repo.get(first).await.unwrap().unwrap();
    assert_eq!(old.catalog_entry.as_str(), "standard@2026-11");
    assert_eq!(
        old.resources,
        ComputerResources {
            vcpus: Vcpus::new(4),
            memory_gib: MemoryGib::new(8),
            disk_gib: DiskGib::new(100)
        }
    );
    assert_eq!(old.resources.units(), 1);
    let new = service.repo.get(second).await.unwrap().unwrap();
    assert_eq!(new.catalog_entry.as_str(), "standard@2026-12");
    assert_eq!(
        new.resources,
        ComputerResources {
            vcpus: Vcpus::new(6),
            memory_gib: MemoryGib::new(12),
            disk_gib: DiskGib::new(150)
        }
    );
    assert_eq!(new.resources.units(), 2);
}

#[tokio::test]
async fn price_rotation_does_not_cancel_an_existing_paid_computer() {
    let mut service = ComputerService::new(
        FakeRepo {
            sold_units: 20,
            ..FakeRepo::default()
        },
        FakeBilling {
            quote_price: Some(crate::domain::models::StripePriceId::parse("price_old").unwrap()),
            ..FakeBilling::default()
        },
        FixedClock,
    );
    let old = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    service.billing.quote_price =
        Some(crate::domain::models::StripePriceId::parse("price_new").unwrap());
    let new = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    service
        .reconcile_billed_counts(
            TEAM,
            &[SubscriptionItem {
                price_id: crate::domain::models::StripePriceId::parse("price_old").unwrap(),
                quantity: 1,
            }],
        )
        .await
        .unwrap();
    assert!(service.repo.get(old).await.unwrap().unwrap().is_billed());
    assert!(!service.repo.get(new).await.unwrap().unwrap().is_billed());
    assert_eq!(
        service
            .repo
            .get(old)
            .await
            .unwrap()
            .unwrap()
            .price_id
            .unwrap()
            .as_str(),
        "price_old"
    );
    service
        .release_now(TEAM, old, "Macro computer")
        .await
        .unwrap();
    service.run_billing_effects().await.unwrap();
    assert!(
        service
            .billing
            .removals
            .lock()
            .unwrap()
            .iter()
            .any(|(price, _)| price.as_str() == "price_old")
    );
}

#[test]
fn catalog_accessors_return_the_composed_catalog_without_billing() {
    use crate::domain::size::{
        CatalogEntry, CatalogEntryId, ComputerResources, DiskGib, MemoryGib, Vcpus,
    };
    let entry = CatalogEntry {
        id: CatalogEntryId::try_new("standard@custom".to_owned()).unwrap(),
        size: ComputerSize::Standard,
        resources: ComputerResources {
            vcpus: Vcpus::new(6),
            memory_gib: MemoryGib::new(12),
            disk_gib: DiskGib::new(150),
        },
    };
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling {
            not_sold: true,
            no_subscription: true,
            ..FakeBilling::default()
        },
        FixedClock,
    )
    .with_catalog(vec![entry.clone()]);

    assert_eq!(service.catalog(), std::slice::from_ref(&entry));
    assert_eq!(service.size_spec(ComputerSize::Standard).unwrap(), &entry);
    assert!(matches!(
        service.size_spec(ComputerSize::Large),
        Err(ComputerError::BadRequest(_))
    ));
    assert!(service.billing.calls.lock().unwrap().is_empty());
}
