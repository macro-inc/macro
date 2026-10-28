use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::ShaReferences;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn released_shas_are_queued_once(pool: PgPool) {
    let references = ShaReferences::new(pool.clone());

    references
        .release_shas(vec!["a".to_string(), "b".to_string(), "a".to_string()])
        .await
        .unwrap();
    references
        .release_shas(vec!["a".to_string()])
        .await
        .unwrap();
    references.release_shas(Vec::new()).await.unwrap();

    let queued: Vec<String> = sqlx::query_scalar("SELECT sha FROM sha_cleanup_queue ORDER BY sha")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(queued, vec!["a".to_string(), "b".to_string()]);
}
