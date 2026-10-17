use std::sync::Arc;

use agent_harness::domain::ports::HarnessPresence;
use harness_id::HarnessId;
use sqlx::PgPool;
use sqlx::types::Uuid;

use super::PgHarnessPresence;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn each_connect_records_the_operators_latest_report(pool: PgPool) {
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'laptop', 'macro|operator@example.com', 'macro|operator@example.com')
        "#,
        harness_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let presence = Arc::new(PgHarnessPresence::new(pool.clone()));

    for report in [Some(true), Some(false), None] {
        Arc::clone(&presence)
            .connected(HarnessId::new_from_uuid(harness_id), report)
            .await;
        let stored = sqlx::query_scalar!(
            r#"SELECT operator_allows_bypass FROM harnesses WHERE id = $1"#,
            harness_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored, report);
    }
}
