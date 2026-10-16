use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn check(pool: &Pool<Postgres>, document_id: &str, expected: DocumentTextOutcome) {
    let outcome = create_document_text(pool.clone(), document_id, "extracted text", 2)
        .await
        .unwrap();
    assert_eq!(outcome, expected, "{document_id}");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("document_text"))
)]
async fn text_for_a_deleted_document_is_reported_missing_instead_of_failing(pool: Pool<Postgres>) {
    check(&pool, "document-one", DocumentTextOutcome::Stored).await;
    check(
        &pool,
        "deleted-document",
        DocumentTextOutcome::DocumentMissing,
    )
    .await;
}
