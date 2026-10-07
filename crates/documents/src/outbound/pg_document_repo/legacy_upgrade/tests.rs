use entity_registry::{EntityRegistryResult, OwnerGrantPolicy};
use entity_registry_db_utils::OwnedEntityRegistrar;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_owner::Owner;
use sqlx::{Pool, Postgres};

use super::*;
use crate::domain::content::{DocumentContentLocation, DocumentContentState};

/// `txt` document with one instance in the fixture.
const DOCUMENT_ID: &str = "d0000000-0000-0000-0000-000000000001";

#[derive(Clone)]
struct NoBots;

impl BotFacts for NoBots {
    async fn sponsor(&self, _bot: bot_id::BotId) -> EntityRegistryResult<Option<Owner>> {
        Ok(None)
    }
}

fn repo(pool: Pool<Postgres>) -> PgDocumentRepo<NoBots> {
    PgDocumentRepo::new(
        pool,
        OwnedEntityRegistrar::new(OwnerGrantPolicy::new(NoBots)),
    )
}

async fn set_file_type(pool: &Pool<Postgres>, file_type: &str) {
    sqlx::query!(
        r#"UPDATE "Document" SET "fileType" = $2 WHERE id = $1"#,
        DOCUMENT_ID,
        file_type,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn file_type(pool: &Pool<Postgres>) -> Option<String> {
    sqlx::query_scalar!(
        r#"SELECT "fileType" FROM "Document" WHERE id = $1"#,
        DOCUMENT_ID
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn new_instance_becomes_the_latest_version(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    let (before, _) = repo
        .get_latest_document_version_id(DOCUMENT_ID)
        .await
        .unwrap();

    let version_id = repo
        .create_document_instance(DOCUMENT_ID, "upgraded-sha")
        .await
        .unwrap();

    assert_ne!(version_id, before);
    let (latest, _) = repo
        .get_latest_document_version_id(DOCUMENT_ID)
        .await
        .unwrap();
    assert_eq!(latest, version_id);
    let sha = sqlx::query_scalar!(
        r#"SELECT sha FROM "DocumentInstance" WHERE id = $1"#,
        version_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(sha, "upgraded-sha");

    repo.delete_document_instance(version_id).await.unwrap();
    let (restored, _) = repo
        .get_latest_document_version_id(DOCUMENT_ID)
        .await
        .unwrap();
    assert_eq!(restored, before);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn bom_can_be_created_and_removed(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());

    let bom_id = repo.create_document_bom(DOCUMENT_ID).await.unwrap();
    let count = || async {
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM "DocumentBom" WHERE id = $1 AND "documentId" = $2"#,
            bom_id,
            DOCUMENT_ID,
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(count().await, 1);

    repo.delete_document_bom(bom_id).await.unwrap();
    assert_eq!(count().await, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn swap_only_changes_the_expected_type(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    set_file_type(&pool, "ppt").await;

    assert!(
        !repo
            .swap_document_file_type(DOCUMENT_ID, FileType::Doc, FileType::Docx)
            .await
            .unwrap()
    );
    assert_eq!(file_type(&pool).await.as_deref(), Some("ppt"));

    assert!(
        repo.swap_document_file_type(DOCUMENT_ID, FileType::Ppt, FileType::Pptx)
            .await
            .unwrap()
    );
    assert_eq!(file_type(&pool).await.as_deref(), Some("pptx"));

    // A second swap from the old type loses.
    assert!(
        !repo
            .swap_document_file_type(DOCUMENT_ID, FileType::Ppt, FileType::Pptx)
            .await
            .unwrap()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn swap_matches_uppercase_stored_types(pool: Pool<Postgres>) {
    let repo = repo(pool.clone());
    set_file_type(&pool, "XLS").await;

    assert!(
        repo.swap_document_file_type(DOCUMENT_ID, FileType::Xls, FileType::Xlsx)
            .await
            .unwrap()
    );
    assert_eq!(file_type(&pool).await.as_deref(), Some("xlsx"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn swap_on_a_missing_document_reports_no_change(pool: Pool<Postgres>) {
    let repo = repo(pool);

    assert!(
        !repo
            .swap_document_file_type(
                "d0000000-0000-0000-0000-00000000ffff",
                FileType::Doc,
                FileType::Docx
            )
            .await
            .unwrap()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn content_is_persisted(pool: Pool<Postgres>) {
    let repo = repo(pool);

    LegacyOfficeUpgradeRepoPort::set_document_content(
        &repo,
        DOCUMENT_ID,
        DocumentContent::pending_at(DocumentContentLocation::ConvertedPdf),
    )
    .await
    .unwrap();

    let content = repo
        .get_persisted_document_content(DOCUMENT_ID)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(content.state, DocumentContentState::Pending);
    assert_eq!(
        content.location,
        Some(DocumentContentLocation::ConvertedPdf)
    );
}
