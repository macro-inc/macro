use super::*;
use entity_access::domain::models::{Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;

fn receipt(entity_type: EntityType) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from("macro|docx-test@example.com".to_owned()).unwrap(),
        Entity {
            entity_type,
            entity_id: "document-id".to_owned(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn early_open_waits_without_exporting_then_succeeds_after_extraction() {
    let mut store = MockDocxExportStore::new();
    let mut sequence = mockall::Sequence::new();
    store
        .expect_parts()
        .withf(|id| id == "document-id")
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    store
        .expect_parts()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_| {
            Box::pin(async {
                Ok(vec![BomPart {
                    id: "part-id".into(),
                    path: "word/document.xml".into(),
                    sha: "content-sha".into(),
                }])
            })
        });
    store
        .expect_export_parts()
        .withf(|id, parts| {
            id == "document-id" && parts.len() == 1 && parts[0].path == "word/document.xml"
        })
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_, _| Box::pin(async { Ok("https://download/complete.docx".into()) }));

    assert_eq!(
        export_docx(&store, receipt(EntityType::Document))
            .await
            .unwrap(),
        DocxExport::Processing
    );
    assert_eq!(
        export_docx(&store, receipt(EntityType::Document))
            .await
            .unwrap(),
        DocxExport::Ready("https://download/complete.docx".into())
    );
}

#[tokio::test]
async fn database_failure_is_not_reported_as_processing() {
    let mut store = MockDocxExportStore::new();
    store
        .expect_parts()
        .times(1)
        .returning(|_| Box::pin(async { Err(std::io::Error::other("database unavailable")) }));
    store.expect_export_parts().never();
    assert!(matches!(
        export_docx(&store, receipt(EntityType::Document)).await,
        Err(DocumentError::Internal(_))
    ));
}

#[tokio::test]
async fn unrelated_entity_receipt_cannot_export_a_document() {
    let store = MockDocxExportStore::new();
    assert!(matches!(
        export_docx(&store, receipt(EntityType::Project)).await,
        Err(DocumentError::Unauthorized)
    ));
}
