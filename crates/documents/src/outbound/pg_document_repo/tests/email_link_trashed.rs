use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::super::create;
use super::{
    TEST_DOCUMENT_OWNER_ID, document_email_rows, import_email_document_args,
    insert_email_attachments, pdf_share_permission, test_repo,
};
use crate::domain::models::EmailImportRepoOutcome;
use crate::domain::ports::DocumentRepo;

/// The document a sha-reuse lookup found, moved to the Trash before the link
/// was written, as the released-attachment drain can do between the two.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn a_document_trashed_after_the_reuse_lookup_is_not_linked(pool: Pool<Postgres>) {
    let repo = test_repo(pool.clone());
    let attachments = insert_email_attachments(&pool, 3).await;
    let sha = "3333333333333333333333333333333333333333333333333333333333333333";
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

    let mut live = pool.begin().await.unwrap();
    let linked = create::link_live_document_email(&mut live, &document.document_id, attachments[1])
        .await
        .unwrap();
    live.commit().await.unwrap();
    assert!(linked);

    sqlx::query(r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = $1"#)
        .bind(&document.document_id)
        .execute(&pool)
        .await
        .unwrap();
    let mut trashed = pool.begin().await.unwrap();
    let linked =
        create::link_live_document_email(&mut trashed, &document.document_id, attachments[2])
            .await
            .unwrap();
    trashed.commit().await.unwrap();

    assert!(!linked);
    assert_eq!(document_email_rows(&pool, &document.document_id).await, {
        let mut kept = vec![attachments[0], attachments[1]];
        kept.sort();
        kept
    });
}
