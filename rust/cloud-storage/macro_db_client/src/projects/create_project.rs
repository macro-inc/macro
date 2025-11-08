use crate::{history::upsert_user_history, share_permission};
use model::project::Project;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn create_project_v2(
    db: Pool<Postgres>,
    user_id: &str,
    project_name: &str,
    parent_id: Option<String>,
    share_permission: &models_permissions::share_permission::SharePermissionV2,
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
        user_id,
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

    upsert_user_history(&mut transaction, user_id, &project.id, "project").await?;

    crate::item_access::insert::insert_user_item_access(
        &mut transaction,
        user_id,
        &project.id,
        "project",
        AccessLevel::Owner,
        None,
    )
    .await?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "error committing transaction");
        anyhow::Error::from(e)
    })?;

    Ok(project)
}
