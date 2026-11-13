use super::*;
use crate::domain::service::billing::{ObservedItem, SubscriptionObserved, SubscriptionStatus};
use macro_user_id::user_id::MacroUserIdStr;
use std::str::FromStr;

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
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let first = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
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
    service.run_billing_effects().await.unwrap();
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
            purchase_key: key("buy-dialog-2"),
            team_id: TEAM,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            size: ComputerSize::Standard,
            name: None,
            extra_items: vec![],
        })
        .await
        .unwrap()
        .computer_id();
    let old = service
        .repo
        .get(first)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
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
    let new = service
        .repo
        .get(second)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
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
            quote_price: Some(stripe::PriceId::from_str("price_old").unwrap()),
            ..FakeBilling::default()
        },
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let old = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
        .computer_id();
    service.run_billing_effects().await.unwrap();
    service.billing.quote_price = Some(stripe::PriceId::from_str("price_new").unwrap());
    let new = service
        .purchase(standard_purchase("buy-dialog-2"))
        .await
        .unwrap()
        .computer_id();
    service.run_billing_effects().await.unwrap();
    let items: Vec<ObservedItem> = service
        .billing
        .items
        .lock()
        .unwrap()
        .iter()
        .map(|(subscription_item, computer_id)| ObservedItem {
            subscription_item: subscription_item.clone(),
            computer_id: Some(*computer_id),
        })
        .collect();
    service
        .observe_subscription(
            TEAM,
            SubscriptionObserved {
                status: SubscriptionStatus::Active,
                items,
                current_period_end: now() + chrono::Duration::days(20),
                observed_at: now(),
            },
        )
        .await
        .unwrap();
    for id in [old, new] {
        assert!(matches!(
            service
                .repo
                .get(id)
                .await
                .unwrap()
                .unwrap()
                .into_healthy()
                .unwrap()
                .state
                .billing,
            BillingState::Active { .. }
        ));
    }
    assert_eq!(
        service
            .repo
            .get(old)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .funding,
        Funding::Stripe {
            price_id: stripe::PriceId::from_str("price_old").unwrap()
        }
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
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_catalog(vec![entry.clone()]);

    assert_eq!(service.catalog(), std::slice::from_ref(&entry));
    assert_eq!(service.size_spec(ComputerSize::Standard).unwrap(), &entry);
    assert!(matches!(
        service.size_spec(ComputerSize::Large),
        Err(ComputerError::SizeNotOffered)
    ));
    assert!(service.billing.calls.lock().unwrap().is_empty());
}
