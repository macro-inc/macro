use crate::{history::upsert_user_history, share_permission};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::project::Project;
use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn create_project_v2(
    db: Pool<Postgres>,
    user_id: MacroUserIdStr<'_>,
    project_name: &str,
    parent_id: Option<String>,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<Project> {
    let mut transaction = db.begin().await?;
    let project = sqlx::query_as!(
        Project,
        r#"
        INSERT INTO "Project" ("name", "userId", "parentId", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, name, "userId"::text as user_id, "createdAt"::timestamptz as created_at, "deletedAt"::timestamptz as deleted_at,
        "updatedAt"::timestamptz as updated_at, "parentId" as parent_id
        "#,
        project_name,
        user_id.as_ref(),
        parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    // Create share permission
    share_permission::create::create_project_permission(
        &mut transaction,
        &project.id,
        share_permission,
    )
    .await?;

    upsert_user_history(&mut transaction, user_id.copied(), &project.id, "project").await?;

    // SAFETY: this is a UUID
    let project_id = macro_uuid::string_to_uuid(&project.id).unwrap();

    entity_access_db_utils::insert_entity_access_row(
        &mut transaction,
        &project_id,
        entity_access_db_utils::EntityType::Project,
        user_id.as_ref(),
        entity_access_db_utils::EntityAccessSourceType::User,
        entity_access_db_utils::AccessLevel::Owner,
    )
    .await?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "error committing transaction");
        anyhow::Error::from(e)
    })?;

    Ok(project)
}
