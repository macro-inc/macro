use model::project::Project;
use sqlx::{Postgres, Transaction};

use crate::domain::models::EditProjectArgs;

use super::share;

pub(super) async fn edit_project(
    transaction: &mut Transaction<'_, Postgres>,
    args: &EditProjectArgs,
) -> Result<Project, sqlx::Error> {
    // Separate flags make all three parent states compile checked: unchanged,
    // set to an ID, and explicitly cleared to NULL.
    let project = sqlx::query_as!(
        Project,
        r#"
        UPDATE "Project"
        SET
            name = CASE WHEN $2 THEN $3 ELSE name END,
            "parentId" = CASE WHEN $4 THEN $5 ELSE "parentId" END,
            "updatedAt" = NOW()
        WHERE id = $1
        RETURNING
            id,
            name,
            "userId" AS user_id,
            "parentId" AS parent_id,
            "createdAt"::timestamptz AS created_at,
            "updatedAt"::timestamptz AS updated_at,
            "deletedAt"::timestamptz AS deleted_at
        "#,
        args.project_id,
        args.name.is_some(),
        args.name,
        args.update_parent,
        args.parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    if let Some(permission) = args.share_permission.as_ref() {
        share::edit_project_share_permission(transaction, &args.project_id, permission).await?;
    }
    Ok(project)
}

pub(super) async fn is_project_recursively_nested(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    parent_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        WITH RECURSIVE descendants AS (
            SELECT id FROM "Project" WHERE "parentId" = $1 AND "deletedAt" IS NULL
            UNION ALL
            SELECT child.id
            FROM "Project" child
            JOIN descendants parent ON child."parentId" = parent.id
            WHERE child."deletedAt" IS NULL
        )
        SELECT ($1 = $2) OR EXISTS(SELECT 1 FROM descendants WHERE id = $2) AS "exists!"
        "#,
        project_id,
        parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await
}
