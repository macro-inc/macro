use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::{
    TEST_DOCUMENT_OWNER_ID, document_email_rows, import_email_document_args,
    insert_email_attachments, pdf_share_permission, test_repo,
};
use crate::domain::models::{DocumentError, EmailImportRepoOutcome};
use crate::domain::ports::DocumentRepo;

async fn delete_attachment(pool: &Pool<Postgres>, attachment_id: uuid::Uuid) {
    sqlx::query("DELETE FROM email_attachments WHERE id = $1")
        .bind(attachment_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn documents_with_sha(pool: &Pool<Postgres>, sha: &str) -> i64 {
    sqlx::query_scalar(
        r#"SELECT COUNT(DISTINCT "documentId") FROM "DocumentInstance" WHERE sha = $1"#,
    )
    .bind(sha)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn import_of_deleted_attachment_is_not_found_and_creates_nothing(pool: Pool<Postgres>) {
    let repo = test_repo(pool.clone());
    let attachments = insert_email_attachments(&pool, 1).await;
    let sha = "1111111111111111111111111111111111111111111111111111111111111111";
    delete_attachment(&pool, attachments[0]).await;

    let result = repo
        .import_email_attachment_document(
            import_email_document_args(TEST_DOCUMENT_OWNER_ID, sha, attachments[0]),
            pdf_share_permission(),
        )
        .await;

    assert!(
        matches!(result, Err(DocumentError::EmailAttachmentNotFound)),
        "got {result:?}"
    );
    assert_eq!(documents_with_sha(&pool, sha).await, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn sha_reuse_of_deleted_attachment_is_not_found_and_keeps_existing_links(
    pool: Pool<Postgres>,
) {
    let repo = test_repo(pool.clone());
    let attachments = insert_email_attachments(&pool, 2).await;
    let sha = "2222222222222222222222222222222222222222222222222222222222222222";
    let EmailImportRepoOutcome::Created(document) = repo
        .import_email_attachment_document(
            import_email_document_args(TEST_DOCUMENT_OWNER_ID, sha, attachments[0]),
            pdf_share_permission(),
        )
        .await
        .unwrap()
    else {
        panic!("expected a new import");
    };
    delete_attachment(&pool, attachments[1]).await;

    let result = repo
        .import_email_attachment_document(
            import_email_document_args(TEST_DOCUMENT_OWNER_ID, sha, attachments[1]),
            pdf_share_permission(),
        )
        .await;

    assert!(
        matches!(result, Err(DocumentError::EmailAttachmentNotFound)),
        "got {result:?}"
    );
    assert_eq!(documents_with_sha(&pool, sha).await, 1);
    assert_eq!(
        document_email_rows(&pool, &document.document_id).await,
        vec![attachments[0]]
    );
}

/// The message delete commits while the import runs, as when a draft revision
/// is replaced mid-upload. Every interleaving ends the same way: a link insert
/// that reaches the attachment first waits on the delete's row lock, and one
/// that reaches it later finds the row gone.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn message_deleted_during_import_is_not_found_and_rolls_back(pool: Pool<Postgres>) {
    let repo = test_repo(pool.clone());
    let attachments = insert_email_attachments(&pool, 1).await;
    let sha = "3333333333333333333333333333333333333333333333333333333333333333";

    let mut delete = pool.begin().await.unwrap();
    sqlx::query(
        "DELETE FROM email_messages WHERE id = (SELECT message_id FROM email_attachments WHERE id = $1)",
    )
    .bind(attachments[0])
    .execute(&mut *delete)
    .await
    .unwrap();

    let import = tokio::spawn(async move {
        repo.import_email_attachment_document(
            import_email_document_args(TEST_DOCUMENT_OWNER_ID, sha, attachments[0]),
            pdf_share_permission(),
        )
        .await
    });

    delete.commit().await.unwrap();

    let result = import.await.unwrap();
    assert!(
        matches!(result, Err(DocumentError::EmailAttachmentNotFound)),
        "got {result:?}"
    );
    assert_eq!(documents_with_sha(&pool, sha).await, 0);
}
