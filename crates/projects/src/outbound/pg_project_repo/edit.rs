use model::project::Project;
use rootcause::prelude::*;
use share_permission_db_utils::team_share::{TeamShareError, acquire_guard, apply};
use sqlx::{Postgres, Transaction};

use crate::domain::models::{EditProjectArgs, ProjectEditError};

use super::share;

pub(super) async fn edit_project(
    transaction: &mut Transaction<'_, Postgres>,
    args: &EditProjectArgs,
) -> Result<Project, Report<ProjectEditError>> {
    acquire_guard(transaction)
        .await
        .context(ProjectEditError::Infrastructure)?;
    let deleted = sqlx::query_scalar!(
        r#"SELECT "deletedAt" IS NOT NULL AS "deleted!" FROM "Project" WHERE id = $1"#,
        args.project_id,
    )
    .fetch_optional(transaction.as_mut())
    .await
    .context(ProjectEditError::Infrastructure)?
    .ok_or_else(|| report!(ProjectEditError::NotFound))?;
    if deleted {
        return Err(report!(ProjectEditError::Deleted));
    }
    if args.update_parent
        && let Some(parent_id) = args.parent_id.as_deref()
    {
        if is_project_recursively_nested(transaction, &args.project_id, parent_id)
            .await
            .context(ProjectEditError::Infrastructure)?
        {
            return Err(report!(ProjectEditError::RecursiveNesting));
        }
        if !parent_is_active(transaction, parent_id)
            .await
            .context(ProjectEditError::Infrastructure)?
        {
            return Err(report!(ProjectEditError::InvalidParent));
        }
    }

    // A command is entity-bound and must correspond exactly to the supplied field.
    let requested = args
        .share_permission
        .as_ref()
        .and_then(|update| update.team_share_access_level);
    match (&args.team_share, requested) {
        (None, None) => {}
        (Some(command), Some(level))
            if command.expected().entity.entity_id == args.project_id
                && command.expected().entity.entity_type == model_entity::EntityType::Project
                && command.target().map(|grant| grant.level.into()) == level =>
        {
            apply(transaction, command).await.map_err(|error| {
                let context = match error.current_context() {
                    TeamShareError::NotFound => ProjectEditError::NotFound,
                    TeamShareError::ChangedFacts => ProjectEditError::ChangedFacts,
                    TeamShareError::UntrackedGrant => ProjectEditError::UntrackedGrant,
                    _ => ProjectEditError::Infrastructure,
                };
                error.context(context)
            })?;
        }
        _ => return Err(report!(ProjectEditError::InvalidCommand)),
    }

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
    .await
    .context(ProjectEditError::Infrastructure)?;

    if let Some(permission) = args.share_permission.as_ref() {
        share::edit_project_share_permission(transaction, &args.project_id, permission)
            .await
            .context(ProjectEditError::Infrastructure)?;
    }
    // Only topology changes reconcile ancestors. Omitted parent fields are not moves.
    if args.update_parent {
        share::synchronize_project(transaction, &project.id)
            .await
            .context(ProjectEditError::Infrastructure)?;
    }
    Ok(project)
}

pub(super) async fn parent_is_active(
    transaction: &mut Transaction<'_, Postgres>,
    parent_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM "Project" WHERE id = $1 AND "deletedAt" IS NULL) AS "active!""#,
        parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await
}

pub(super) async fn is_project_recursively_nested(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    parent_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        WITH RECURSIVE descendants AS (
            SELECT id FROM "Project" WHERE "parentId" = $1
            UNION
            SELECT child.id
            FROM "Project" child
            JOIN descendants parent ON child."parentId" = parent.id
        )
        SELECT ($1 = $2) OR EXISTS(SELECT 1 FROM descendants WHERE id = $2) AS "exists!"
        "#,
        project_id,
        parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await
}
