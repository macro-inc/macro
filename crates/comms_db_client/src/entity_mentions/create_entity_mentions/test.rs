use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::Pool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn records_mentions_against_their_source_document(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
    let mentions = vec![
        NewEntityMention {
            entity_type: "thread".to_string(),
            entity_id: "thread-7".to_string(),
        },
        NewEntityMention {
            entity_type: "document".to_string(),
            entity_id: "doc-9".to_string(),
        },
    ];

    let inserted = create_entity_mentions(
        &pool,
        "document",
        "task-1",
        Some("macro|owner@example.com"),
        &mentions,
    )
    .await?;
    assert_eq!(inserted, 2);

    let rows = sqlx::query!(
        r#"
        SELECT source_entity_type, source_entity_id, entity_type, entity_id, user_id
        FROM comms_entity_mentions
        ORDER BY entity_id
        "#,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].entity_type, "document");
    assert_eq!(rows[0].entity_id, "doc-9");
    assert_eq!(rows[1].entity_type, "thread");
    assert_eq!(rows[1].entity_id, "thread-7");
    for row in &rows {
        assert_eq!(row.source_entity_type, "document");
        assert_eq!(row.source_entity_id, "task-1");
        assert_eq!(row.user_id.as_deref(), Some("macro|owner@example.com"));
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recording_nothing_writes_nothing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
    let inserted = create_entity_mentions(&pool, "document", "task-1", None, &[]).await?;
    assert_eq!(inserted, 0);

    let count = sqlx::query_scalar!(r#"SELECT COUNT(*) FROM comms_entity_mentions"#)
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, Some(0));

    Ok(())
}
