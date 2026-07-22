//! Integration tests for document metadata fact queries.

use super::metadata_queries;
use document_sub_type::DocumentSubType;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn document_sub_types_resolve_mixed_batch(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let task_id = Uuid::from_u128(0xD001);
    let snippet_id = Uuid::from_u128(0xD002);
    let document_id = Uuid::from_u128(0xD003);
    let missing_id = Uuid::from_u128(0xD004);

    for (id, name) in [
        (task_id, "Task"),
        (snippet_id, "Snippet"),
        (document_id, "Document"),
    ] {
        sqlx::query!(
            r#"
            INSERT INTO "Document" (id, name, owner)
            VALUES ($1, $2, 'macro|user1@test.com')
            "#,
            id.to_string(),
            name,
        )
        .execute(&pool)
        .await?;
    }

    sqlx::query!(
        r#"
        INSERT INTO document_sub_type (document_id, sub_type)
        VALUES ($1, 'task'), ($2, 'snippet')
        "#,
        task_id.to_string(),
        snippet_id.to_string(),
    )
    .execute(&pool)
    .await?;

    let result = metadata_queries::get_document_sub_types(
        &pool,
        &[task_id, snippet_id, document_id, task_id, missing_id],
    )
    .await?;

    assert_eq!(result.len(), 2);
    assert_eq!(result.get(&task_id), Some(&DocumentSubType::Task));
    assert_eq!(result.get(&snippet_id), Some(&DocumentSubType::Snippet));
    assert!(!result.contains_key(&document_id));
    assert!(!result.contains_key(&missing_id));

    Ok(())
}
