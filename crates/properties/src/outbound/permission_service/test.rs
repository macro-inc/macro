use super::*;
use crate::domain::model::PropertyAccessReceiptExt;

#[test]
fn bulk_document_edit_receipts_reject_omitted_documents() {
    let ids = vec![
        Uuid::from_u128(1).to_string(),
        Uuid::from_u128(2).to_string(),
    ];
    let receipts = HashMap::from([(
        ids[0].clone(),
        access_receipt::<entity_access::domain::models::ViewAccessLevel>(
            EntityAccessAuth::Internal,
            &ids[0],
            AccessEntityType::Document,
            AccessLevel::Edit,
        )
        .unwrap(),
    )]);
    assert!(document_edit_receipts(&ids, receipts).is_err());
}

#[test]
fn bulk_document_edit_receipts_enforce_and_preserve_actual_permissions() {
    let id = Uuid::from_u128(1).to_string();
    let user = MacroUserIdStr::parse_from_str("macro|editor@example.com").unwrap();
    for level in [
        AccessLevel::View,
        AccessLevel::Comment,
        AccessLevel::Edit,
        AccessLevel::Owner,
    ] {
        let receipt = access_receipt::<entity_access::domain::models::ViewAccessLevel>(
            caller_auth(Some(&user)),
            &id,
            AccessEntityType::Document,
            level,
        )
        .unwrap();
        let result = document_edit_receipts(
            std::slice::from_ref(&id),
            HashMap::from([(id.clone(), receipt)]),
        );
        if matches!(level, AccessLevel::Edit | AccessLevel::Owner) {
            let receipts = result.unwrap();
            assert_eq!(receipts.len(), 1);
            assert_eq!(receipts[0].entity_id(), id);
            assert_eq!(receipts[0].entity_type(), AccessEntityType::Document);
            assert!(
                matches!(receipts[0].auth(), EntityAccessAuth::Authenticated(actual) if actual == &user)
            );
            assert_eq!(
                receipts[0].entity_permission(),
                &EntityPermission::AccessLevel {
                    access_level: level
                }
            );
        } else {
            assert!(result.is_err());
        }
    }
}

#[tokio::test]
async fn bulk_document_edit_receipts_propagate_access_service_failure_without_property_queries() {
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost:1/unused")
        .unwrap();
    let service = PermissionServiceImpl::new(
        db,
        Arc::new(entity_access::domain::ports::NoOpEntityAccessService),
    );
    let user = MacroUserIdStr::parse_from_str("macro|editor@example.com").unwrap();
    let result = service
        .mint_document_edit_receipts(&user, &[Uuid::from_u128(1)])
        .await;
    assert!(result.is_err());
    assert!(
        service
            .mint_document_edit_receipts(&user, &[])
            .await
            .unwrap()
            .is_empty()
    );
}
