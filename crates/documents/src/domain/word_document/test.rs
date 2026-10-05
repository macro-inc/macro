use super::*;
use crate::domain::ports::editing::MockEditingWorkerService;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813c";
const SECRET: &str = "local-word-document-test-secret";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|words@macro.com".to_owned()).unwrap()
}

fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}

fn lookup(file_type: &str) -> MockWordDocumentLookup {
    let mut lookup = MockWordDocumentLookup::new();
    let file_type = file_type.to_owned();
    lookup
        .expect_file_type()
        .withf(|id| id == DOCUMENT)
        .times(1)
        .returning(move |_| {
            let file_type = file_type.clone();
            Box::pin(async move { Ok(Some(file_type)) })
        });
    lookup
}

fn response(content: &str) -> WordDocumentResponse {
    WordDocumentResponse {
        content: content.to_owned(),
    }
}

fn claims(token: &macro_sync_service_jwt::DocumentPermissionToken) -> serde_json::Value {
    macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap()
}

fn rename(paragraph: &str) -> WordDocumentOperation {
    WordDocumentOperation::ReplaceText {
        paragraph: paragraph.to_owned(),
        find: "two".to_owned(),
        replace: "three".to_owned(),
        occurrence: None,
    }
}

#[tokio::test]
async fn reads_mint_only_view_access_for_the_delegated_actor() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_word_document()
        .times(1)
        .returning(|id, token, request| {
            assert_eq!(id, DOCUMENT);
            assert!(matches!(
                request,
                WordDocumentRequest::Read {
                    start: Some(3),
                    count: None
                }
            ));
            let claims = claims(token);
            assert_eq!(claims["document_id"], DOCUMENT);
            assert_eq!(claims["access_level"], "view");
            assert_eq!(claims["user_id"], "macro|words@macro.com");
            assert_eq!(claims["actor"], "macro|ai@macro.com");
            Box::pin(async { Ok(response("Word document with 3 blocks.")) })
        });
    let service =
        WordDocumentService::new(Arc::new(lookup("docx")), Arc::new(worker), SECRET.into());
    let read = service
        .read(
            receipt(AccessLevel::View),
            &user(),
            "macro|ai@macro.com",
            Some(3),
            None,
        )
        .await
        .unwrap();
    assert_eq!(read.content, "Word document with 3 blocks.");
}

#[tokio::test]
async fn edits_mint_edit_access_and_forward_the_operations() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_word_document()
        .times(1)
        .returning(|_, token, request| {
            assert_eq!(claims(token)["access_level"], "edit");
            let WordDocumentRequest::Edit { operations } = request else {
                panic!("expected an edit");
            };
            assert_eq!(operations.len(), 2);
            Box::pin(async { Ok(response("Applied 2 operations.")) })
        });
    let service =
        WordDocumentService::new(Arc::new(lookup("docx")), Arc::new(worker), SECRET.into());
    let edited = service
        .edit(
            receipt(AccessLevel::Edit),
            &user(),
            "macro|ai@macro.com",
            vec![rename("a"), rename("b")],
        )
        .await
        .unwrap();
    assert_eq!(edited.content, "Applied 2 operations.");
}

#[tokio::test]
async fn other_file_types_never_reach_the_worker() {
    for file_type in ["md", "pdf", "spreadsheet"] {
        let mut worker = MockEditingWorkerService::new();
        worker.expect_word_document().never();
        let service =
            WordDocumentService::new(Arc::new(lookup(file_type)), Arc::new(worker), SECRET.into());
        let error = service
            .read(
                receipt(AccessLevel::View),
                &user(),
                "macro|ai@macro.com",
                None,
                None,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Word (.docx) documents only"));
    }
}

#[tokio::test]
async fn edits_need_between_one_and_fifty_operations() {
    for operations in [vec![], vec![rename("a"); MAX_OPERATIONS + 1]] {
        let mut worker = MockEditingWorkerService::new();
        worker.expect_word_document().never();
        let service = WordDocumentService::new(
            Arc::new(MockWordDocumentLookup::new()),
            Arc::new(worker),
            SECRET.into(),
        );
        let error = service
            .edit(
                receipt(AccessLevel::Edit),
                &user(),
                "macro|ai@macro.com",
                operations,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("between 1 and 50"));
    }
}

#[test]
fn operations_use_the_worker_wire_format() {
    let request = WordDocumentRequest::Edit {
        operations: vec![
            WordDocumentOperation::InsertParagraph {
                after: Some("p1".into()),
                before: None,
                text: "New".into(),
                style: None,
            },
            WordDocumentOperation::FormatText {
                paragraph: "p1".into(),
                find: None,
                occurrence: None,
                bold: Some(true),
                italic: None,
                underline: None,
                strikethrough: None,
            },
        ],
    };
    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        serde_json::json!({
            "action": "edit",
            "operations": [
                { "type": "insertParagraph", "after": "p1", "text": "New" },
                { "type": "formatText", "paragraph": "p1", "bold": true },
            ],
        })
    );
    assert_eq!(
        serde_json::to_value(WordDocumentRequest::Read {
            start: None,
            count: Some(5)
        })
        .unwrap(),
        serde_json::json!({ "action": "read", "count": 5 })
    );
}

#[test]
fn operations_reject_unknown_types_and_fields() {
    assert!(
        serde_json::from_value::<WordDocumentOperation>(serde_json::json!({
            "type": "runScript", "paragraph": "p1"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<WordDocumentOperation>(serde_json::json!({
            "type": "setText", "paragraph": "p1", "text": "x", "color": "red"
        }))
        .is_err()
    );
}
