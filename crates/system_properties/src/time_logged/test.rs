use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_task_without_a_total_reads_zero(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_eq!(read_task_time_logged(&pool, "task-without-time").await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_last_write_is_the_stored_number(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    write_task_time_logged(&mut tx, "task-with-time", 90).await?;
    write_task_time_logged(&mut tx, "task-with-time", 135).await?;
    tx.commit().await?;

    assert_eq!(read_task_time_logged(&pool, "task-with-time").await?, 135);
    let stored = sqlx::query_scalar!(
        r#"
        SELECT values AS "values!"
        FROM entity_properties
        WHERE entity_id = 'task-with-time' AND entity_type = 'TASK' AND property_definition_id = $1
        "#,
        SystemPropertyKey::TIME_LOGGED_UUID,
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        stored,
        vec![serde_json::json!({"type": "Number", "value": 135.0})]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rolled_back_write_leaves_nothing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    write_task_time_logged(&mut tx, "task-rolled-back", 45).await?;
    tx.rollback().await?;

    assert_eq!(read_task_time_logged(&pool, "task-rolled-back").await?, 0);
    Ok(())
}
