use super::*;
use entity_access::domain::models::{AccessError, AccessLevel, Entity};
use std::sync::atomic::{AtomicUsize, Ordering};

fn receipt(key: &model_entity::Entity<'static>) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        Entity {
            entity_id: key.entity_id.to_string(),
            entity_type: key.entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn retains_only_authorized_property_targets() {
    let keys = [
        model_entity::EntityType::DatabaseRow.with_entity_string("allowed".into()),
        model_entity::EntityType::DatabaseRow.with_entity_string("denied".into()),
        model_entity::EntityType::Team.with_entity_string("unsupported".into()),
        model_entity::EntityType::Document.with_entity_string("document".into()),
    ];
    let calls = AtomicUsize::new(0);
    let receipts = load_view_receipts(&keys, |key| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move {
            if key.entity_id == "denied" {
                Err(AccessError::internal("denied"))
            } else {
                Ok(receipt(key))
            }
        }
    })
    .await;
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    let mut ids = receipts
        .iter()
        .map(|receipt| receipt.entity().entity_id.as_str())
        .collect::<Vec<_>>();
    ids.sort();
    assert_eq!(ids, ["allowed", "document"]);
}

#[tokio::test]
async fn authorizes_concurrently_with_a_bounded_number_of_checks() {
    let keys = (0..18)
        .map(|index| model_entity::EntityType::DatabaseRow.with_entity_string(index.to_string()))
        .collect::<Vec<_>>();
    let active = AtomicUsize::new(0);
    let maximum = AtomicUsize::new(0);
    let receipts = load_view_receipts(&keys, |key| async {
        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
        maximum.fetch_max(count, Ordering::SeqCst);
        tokio::task::yield_now().await;
        active.fetch_sub(1, Ordering::SeqCst);
        Ok(receipt(key))
    })
    .await;
    assert_eq!(receipts.len(), 18);
    assert_eq!(active.load(Ordering::SeqCst), 0);
    assert_eq!(maximum.load(Ordering::SeqCst), 16);
}
