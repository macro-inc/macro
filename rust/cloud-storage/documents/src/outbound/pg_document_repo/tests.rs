use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use crate::domain::ports::DocumentRepo;
use crate::outbound::pg_document_repo::PgDocumentRepo;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_document_metadata(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    // Document exists
    let metadata = repo.get_document_metadata("document-one").await.unwrap();
    assert_eq!(metadata.document_id, "document-one");
    assert_eq!(metadata.document_name, "test_document_name");
    assert_eq!(metadata.owner.as_ref(), "macro|user@user.com");
    assert_eq!(metadata.document_version_id, 1);
    assert_eq!(metadata.file_type, Some("txt".to_string()));

    // Document does not exist
    let result = repo.get_document_metadata("nonexistent").await;
    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_basic_document(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let basic = repo.get_basic_document("document-one").await.unwrap();
    assert_eq!(basic.document_id, "document-one");
    assert_eq!(basic.document_name, "test_document_name");
    assert_eq!(basic.owner.as_ref(), "macro|user@user.com");
    assert_eq!(basic.file_type, Some("txt".to_string()));

    // Not found
    let result = repo.get_basic_document("nonexistent").await;
    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_soft_delete_document(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.soft_delete_document("document-one").await.unwrap();

    // Verify deleted_at is set
    let row = sqlx::query!(
        r#"SELECT "deletedAt"::timestamptz as deleted_at FROM "Document" WHERE id = $1"#,
        "document-one"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(row.deleted_at.is_some());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_latest_document_version_id(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let (version_id, _uploaded) = repo
        .get_latest_document_version_id("document-one")
        .await
        .unwrap();
    assert_eq!(version_id, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_document_version_id(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let (version_id, _uploaded) = repo.get_document_version_id("document-one").await.unwrap();
    assert_eq!(version_id, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_user_view_location(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    // No view location exists
    let location = repo
        .get_user_view_location("macro|user@user.com", "document-one")
        .await
        .unwrap();
    assert!(location.is_none());
}
