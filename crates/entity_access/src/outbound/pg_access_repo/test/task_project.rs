use super::super::PgAccessRepository;
use crate::domain::ports::AccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@containment.com";

async fn insert_owner(pool: &PgPool) -> anyhow::Result<()> {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user_id,
        OWNER,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" ("id", "email", "macro_user_id") VALUES ($1, $1, $2)"#,
        OWNER,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_document(pool: &PgPool, id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO "Document" ("id", "name", "owner", "fileType") VALUES ($1, $1, $2, 'md')"#,
        id,
        OWNER,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Stores a task's Project property with `value` as its references.
async fn set_project_value(
    pool: &PgPool,
    task_id: &str,
    value: serde_json::Value,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES ($1, $2, 'TASK', '00000001-0000-0000-0000-000000000014',
                jsonb_build_object('type', 'EntityReference', 'value', $3::jsonb))
        "#,
        Uuid::new_v4(),
        task_id,
        value,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn reference(id: &str, entity_type: &str) -> serde_json::Value {
    serde_json::json!({ "entity_id": id, "entity_type": entity_type })
}

/// Attaches `document_id` to a message in `task_id`'s discussion and returns
/// the message id.
async fn attach(pool: &PgPool, task_id: &str, document_id: &str) -> anyhow::Result<Uuid> {
    let message = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO comms_messages (id, sender_id, content, parent_entity_type, parent_entity_id)
        VALUES ($1, $2, 'attachment', 'document', $3)"#,
        message,
        OWNER,
        task_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO comms_attachments (id, message_id, entity_type, entity_id)
        VALUES ($1, $2, 'document', $3)"#,
        Uuid::now_v7(),
        message,
        document_id,
    )
    .execute(pool)
    .await?;
    Ok(message)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_task_is_contained_by_the_project_it_names(pool: PgPool) -> anyhow::Result<()> {
    insert_owner(&pool).await?;
    let project = Uuid::new_v4();
    let id = project.to_string();
    for (task, value) in [
        ("task", serde_json::json!([reference(&id, "INITIATIVE")])),
        (
            "malformed-id",
            serde_json::json!([reference("not-a-uuid", "INITIATIVE")]),
        ),
        (
            "other-reference",
            serde_json::json!([reference(&id, "DOCUMENT")]),
        ),
        (
            "two-references",
            serde_json::json!([
                reference(&id, "INITIATIVE"),
                reference(&Uuid::new_v4().to_string(), "INITIATIVE")
            ]),
        ),
    ] {
        insert_document(&pool, task).await?;
        set_project_value(&pool, task, value).await?;
    }
    insert_document(&pool, "no-project").await?;
    let repo = PgAccessRepository::new(pool.clone());

    assert_eq!(repo.get_containing_projects("task").await?, [project]);
    for document in [
        "no-project",
        "malformed-id",
        "other-reference",
        "two-references",
        "missing",
    ] {
        assert!(
            repo.get_containing_projects(document).await?.is_empty(),
            "{document}"
        );
    }

    sqlx::query!(r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = 'task'"#)
        .execute(&pool)
        .await?;
    assert!(
        repo.get_containing_projects("task").await?.is_empty(),
        "a deleted task belongs to no project"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_file_in_a_task_discussion_is_contained_by_the_task_project(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_owner(&pool).await?;
    let project = Uuid::new_v4();
    insert_document(&pool, "task").await?;
    insert_document(&pool, "file").await?;
    set_project_value(
        &pool,
        "task",
        serde_json::json!([reference(&project.to_string(), "INITIATIVE")]),
    )
    .await?;
    let message = attach(&pool, "task", "file").await?;
    let repo = PgAccessRepository::new(pool.clone());

    assert_eq!(repo.get_containing_projects("file").await?, [project]);

    sqlx::query!(
        "UPDATE comms_messages SET deleted_at = now() WHERE id = $1",
        message
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.get_containing_projects("file").await?.is_empty(),
        "a deleted message no longer shares its file"
    );
    Ok(())
}
