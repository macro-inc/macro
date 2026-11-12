use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_write_that_can_be_neither_queued_nor_undone_fails_the_request(pool: PgPool) {
    pool.close().await;

    let error = PgMessageLabels(pool)
        .revert_unsent(
            Uuid::now_v7(),
            &[Uuid::now_v7()],
            &[Uuid::now_v7()],
            Uuid::now_v7(),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, MessageLabelPersistenceError::Database(_)));
}
