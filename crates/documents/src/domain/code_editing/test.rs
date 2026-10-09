use super::*;
use crate::domain::ports::editing::MockEditingWorkerService;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use serde_json::json;

const ID: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813c";
const SECRET: &str = "local-code-editing-test-secret";
fn user() -> MacroUserIdStr<'static> {
    "macro|code@example.com".to_owned().try_into().unwrap()
}
fn receipt<T: RequiredPermission>(level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: ID.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .unwrap()
}
fn lookup(kind: &str) -> MockCodeDocumentLookup {
    let mut lookup = MockCodeDocumentLookup::new();
    let kind = kind.to_owned();
    lookup
        .expect_file_type()
        .withf(|id| id == ID)
        .times(1)
        .returning(move |_| {
            let kind = kind.clone();
            Box::pin(async move { Ok(Some(kind)) })
        });
    lookup
}

#[tokio::test]
async fn view_and_edit_tokens_are_scoped_to_document_user_and_actor() {
    for edit in [false, true] {
        let mut worker = MockEditingWorkerService::new();
        worker
            .expect_code_document()
            .times(1)
            .returning(move |id, token, request| {
                assert_eq!(id, ID);
                let claims: Value = macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
                assert_eq!(claims["document_id"], ID);
                assert_eq!(claims["user_id"], user().to_string());
                assert_eq!(claims["actor"], "macro|ai@macro.com");
                assert_eq!(claims["access_level"], if edit { "edit" } else { "view" });
                assert_eq!(matches!(request, CodeDocumentRequest::Edit { .. }), edit);
                Box::pin(async move {
                    Ok(if edit {
                        CodeDocumentResponse::Update(DocumentUpdate {
                            document_id: ID.into(),
                            revision: "r2".into(),
                            applied: true,
                        })
                    } else {
                        CodeDocumentResponse::State(DocumentState {
                            document_id: ID.into(),
                            revision: "r1".into(),
                            xml: "<doc/>".into(),
                            state: json!({}),
                            node_ids: vec![],
                        })
                    })
                })
            });
        let service =
            CodeEditingService::new(Arc::new(lookup("md")), Arc::new(worker), SECRET.into());
        if edit {
            service
                .apply(
                    receipt(AccessLevel::Edit),
                    &user(),
                    "macro|ai@macro.com",
                    "r1".into(),
                    vec![json!({"kind":"removeNode","node":"n1"})],
                )
                .await
                .unwrap();
        } else {
            service
                .read(receipt(AccessLevel::View), &user(), "macro|ai@macro.com")
                .await
                .unwrap();
        }
    }
}

#[tokio::test]
async fn unsupported_formats_and_invalid_batches_do_not_reach_worker() {
    let service = CodeEditingService::new(
        Arc::new(lookup("docx")),
        Arc::new(MockEditingWorkerService::new()),
        SECRET.into(),
    );
    assert!(
        service
            .read(receipt(AccessLevel::View), &user(), "actor")
            .await
            .unwrap_err()
            .to_string()
            .contains("markdown")
    );
    let service = CodeEditingService::new(
        Arc::new(MockCodeDocumentLookup::new()),
        Arc::new(MockEditingWorkerService::new()),
        SECRET.into(),
    );
    for (revision, operations) in [
        ("", vec![json!({})]),
        ("r1", vec![]),
        ("r1", vec![json!({}); 201]),
        ("r1", vec![json!({"text":"x".repeat(192*1024)})]),
    ] {
        assert!(
            service
                .apply(
                    receipt(AccessLevel::Edit),
                    &user(),
                    "actor",
                    revision.into(),
                    operations
                )
                .await
                .is_err()
        );
    }
}
