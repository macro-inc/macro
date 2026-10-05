use super::*;
use crate::domain::{models::DocumentViewMetadata, ports::metadata::DocumentMetadataService};

impl crate::domain::ports::metadata::TaskStatusPort for TestTaskPropertiesPort {
    async fn task_status(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Option<Vec<uuid::Uuid>>, DocumentError> {
        assert_eq!(receipt.entity().entity_id, "completed-task");
        assert!(matches!(receipt.auth(), EntityAccessAuth::Authenticated(_)));
        Ok(Some(vec![
            crate::domain::models::COMPLETED_STATUS_OPTION_ID,
        ]))
    }
}

#[tokio::test]
async fn task_completion_comes_from_the_receipt_scoped_status_port() {
    let mut repo = make_mock_repo();
    repo.expect_get_document_metadata().return_once(|_| {
        let mut document = make_test_metadata();
        document.document_id = "completed-task".into();
        document.sub_type = Some(DocumentSubType::Task);
        Box::pin(std::future::ready(Ok(document)))
    });
    repo.expect_get_document_view_metadata()
        .return_once(|_, _| {
            Box::pin(std::future::ready(Ok(DocumentViewMetadata {
                viewed_at: None,
            })))
        });
    let metadata = make_test_service(repo)
        .viewed_metadata(authenticated_receipt("completed-task"))
        .await
        .unwrap()
        .unwrap();
    assert!(metadata.is_completed);
}

#[tokio::test]
async fn a_view_receipt_loads_only_metadata_and_the_receipts_viewer_facts() {
    let mut repo = make_mock_repo();
    repo.expect_get_document_metadata()
        .withf(|id| id == "doc-1")
        .return_once(|_| Box::pin(std::future::ready(Ok(make_test_metadata()))));
    repo.expect_get_document_view_metadata()
        .withf(|id, user| id == "doc-1" && user == "macro|user@user.com")
        .return_once(|_, _| {
            Box::pin(std::future::ready(Ok(DocumentViewMetadata {
                viewed_at: Some(chrono::Utc::now()),
            })))
        });
    let service = make_test_service(repo);
    let metadata = service
        .viewed_metadata(authenticated_receipt("doc-1"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(metadata.document.document_name, "test_doc");
    assert!(metadata.view.viewed_at.is_some());
    assert!(!metadata.is_completed);
}

#[tokio::test]
async fn deleted_documents_do_not_load_viewer_facts() {
    let mut repo = make_mock_repo();
    repo.expect_get_document_metadata().return_once(|_| {
        let mut document = make_test_metadata();
        document.deleted_at = Some(chrono::Utc::now());
        Box::pin(std::future::ready(Ok(document)))
    });
    let service = make_test_service(repo);
    assert!(
        service
            .viewed_metadata(authenticated_receipt("doc-1"))
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn identityless_receipts_never_read_metadata() {
    let service = make_test_service(make_mock_repo());
    assert!(matches!(
        service.viewed_metadata(internal_receipt("doc-1")).await,
        Err(DocumentError::Unauthorized)
    ));
}

#[tokio::test]
async fn another_entitys_view_receipt_never_reads_document_metadata() {
    let service = make_test_service(make_mock_repo());
    let user = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();
    let receipt = EntityAccessReceipt::dangerously_assert_authenticated_user(
        user,
        "doc-1",
        EntityType::Project,
    );
    assert!(matches!(
        service.viewed_metadata(receipt).await,
        Err(DocumentError::BadRequest(_))
    ));
}

#[tokio::test]
async fn a_missing_document_is_unavailable_but_database_failures_remain_errors() {
    for (message, missing) in [
        (
            "no rows returned by a query that expected to return at least one row",
            true,
        ),
        ("database unavailable", false),
    ] {
        let mut repo = make_mock_repo();
        repo.expect_get_document_metadata()
            .return_once(move |_| Box::pin(std::future::ready(Err(anyhow!(message)))));
        let result = make_test_service(repo)
            .viewed_metadata(authenticated_receipt("doc-1"))
            .await;
        if missing {
            assert!(result.unwrap().is_none());
        } else {
            assert!(matches!(result, Err(DocumentError::Internal(_))));
        }
    }
}
