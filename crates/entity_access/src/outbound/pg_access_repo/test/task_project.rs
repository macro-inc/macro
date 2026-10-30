use super::super::PgAccessRepository;
use crate::domain::ports::AccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

/// Stores a task's Project property the way the properties service does: an
/// EntityReference array holding one `{entity_id, entity_type}`.
async fn set_project(
    pool: &PgPool,
    task_id: &str,
    reference_id: &str,
    reference_type: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES (
            $1,
            $2,
            'TASK',
            '00000001-0000-0000-0000-000000000014',
            jsonb_build_object(
                'type', 'EntityReference',
                'value', jsonb_build_array(jsonb_build_object(
                    'entity_id', $3::text,
                    'entity_type', $4::text
                ))
            )
        )
        "#,
        Uuid::new_v4(),
        task_id,
        reference_id,
        reference_type,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_the_project_a_task_names(pool: PgPool) -> anyhow::Result<()> {
    let project = Uuid::new_v4();
    set_project(&pool, "task", &project.to_string(), "INITIATIVE").await?;
    set_project(&pool, "malformed", "not-a-uuid", "INITIATIVE").await?;
    set_project(&pool, "other-reference", &project.to_string(), "DOCUMENT").await?;
    let repo = PgAccessRepository::new(pool);

    assert_eq!(repo.get_task_project("task").await?, Some(project));
    for document in ["no-project", "malformed", "other-reference"] {
        assert_eq!(repo.get_task_project(document).await?, None, "{document}");
    }
    Ok(())
}
