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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties"))
)]
async fn a_live_task_lists_in_the_one_project_its_property_names(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let project = Uuid::from_u128(0xF001);
    let other = Uuid::from_u128(0xF002);
    let listed = Uuid::from_u128(0xE001).to_string();
    let deleted = Uuid::from_u128(0xE002).to_string();
    let two_projects = Uuid::from_u128(0xE003).to_string();
    let no_project = Uuid::from_u128(0xE004).to_string();
    for (task, projects) in [
        (&listed, vec![project]),
        (&deleted, vec![project]),
        (&two_projects, vec![project, other]),
        (&no_project, vec![]),
    ] {
        sqlx::query!(
            r#"INSERT INTO "Document" (id, name, owner) SELECT $1, 'Task', id FROM "User" ORDER BY id LIMIT 1"#,
            task,
        )
        .execute(&pool)
        .await?;
        if projects.is_empty() {
            continue;
        }
        let references = projects
            .iter()
            .map(|id| serde_json::json!({ "entity_id": id.to_string(), "entity_type": "INITIATIVE" }))
            .collect::<Vec<_>>();
        sqlx::query!(
            r#"
            INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
            VALUES (gen_random_uuid(), $1, 'TASK', $2, jsonb_build_object('type', 'EntityReference', 'value', $3::jsonb))
            "#,
            task,
            system_properties::SystemPropertyKey::PROJECT_UUID,
            serde_json::Value::Array(references),
        )
        .execute(&pool)
        .await?;
    }
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = $1"#,
        deleted
    )
    .execute(&pool)
    .await?;

    let result = metadata_queries::task_listing_projects(
        &pool,
        &[listed.clone(), deleted, two_projects, no_project],
    )
    .await?;

    assert_eq!(
        result,
        [(listed, project)].into_iter().collect(),
        "a deleted task, a task naming two projects and a task with none list nowhere"
    );
    Ok(())
}
