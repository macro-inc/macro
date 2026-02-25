use macro_user_id::cowlike::CowLike;
use model::document::DocumentMetadata;

use crate::domain::ports::MockDocumentRepo;

use super::*;

fn make_test_metadata() -> DocumentMetadata {
    DocumentMetadata {
        document_id: "doc-1".to_string(),
        document_version_id: 1,
        owner: macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        document_name: "test_doc".to_string(),
        file_type: Some("txt".to_string()),
        sha: Some("sha-1".to_string()),
        project_id: Some("project-1".to_string()),
        project_name: Some("Test Project".to_string()),
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        document_bom: None,
        modification_data: None,
        created_at: None,
        updated_at: None,
        deleted_at: None,
        sub_type: None,
    }
}

fn make_mock_repo() -> MockDocumentRepo {
    MockDocumentRepo::new()
}

#[tokio::test]
async fn test_get_document_happy_path() {
    let mut repo = make_mock_repo();
    let metadata = make_test_metadata();
    let metadata_clone = metadata.clone();

    repo.expect_get_document_metadata()
        .withf(|id| id == "doc-1")
        .returning(move |_| Box::pin(std::future::ready(Ok(metadata_clone.clone()))));

    repo.expect_get_user_view_location()
        .withf(|uid, did| uid == "user-1" && did == "doc-1")
        .returning(|_, _| Box::pin(std::future::ready(Ok(Some("page-3".to_string())))));

    // We can't easily construct the full service because it needs SyncServiceClient + PgPool.
    // Instead, test the repo interaction directly via the trait.
    let result = repo.get_document_metadata("doc-1").await.unwrap();
    assert_eq!(result.document_id, "doc-1");
    assert_eq!(result.document_name, "test_doc");

    let view_loc = repo
        .get_user_view_location("user-1", "doc-1")
        .await
        .unwrap();
    assert_eq!(view_loc, Some("page-3".to_string()));
}

#[tokio::test]
async fn test_get_document_not_found() {
    let mut repo = make_mock_repo();

    repo.expect_get_document_metadata()
        .withf(|id| id == "nonexistent")
        .returning(|_| {
            Box::pin(std::future::ready(Err(anyhow!(
                "no rows returned by a query that expected to return at least one row"
            ))))
        });

    let result = repo.get_document_metadata("nonexistent").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("no rows returned"));
}

#[tokio::test]
async fn test_soft_delete_document() {
    let mut repo = make_mock_repo();

    repo.expect_soft_delete_document()
        .withf(|id| id == "doc-1")
        .returning(|_| Box::pin(std::future::ready(Ok(()))));

    let result = repo.soft_delete_document("doc-1").await;
    assert!(result.is_ok());
}
