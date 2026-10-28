use entity_registry::BotFacts;
use entity_registry_db_utils::{OwnedEntityRegistrar, RegisteredEntityType};
use model::project::Project;
use sqlx::{Postgres, Transaction};

use crate::domain::models::CreateProjectArgs;

use super::share;

pub(super) async fn create_project<B: BotFacts>(
    transaction: &mut Transaction<'_, Postgres>,
    registrar: &OwnedEntityRegistrar<B>,
    args: &CreateProjectArgs,
) -> Result<Project, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        INSERT INTO "Project" (name, "userId", "parentId", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING
            id,
            name,
            "userId" AS user_id,
            "parentId" AS parent_id,
            "createdAt"::timestamptz AS created_at,
            "updatedAt"::timestamptz AS updated_at,
            "deletedAt"::timestamptz AS deleted_at
        "#,
        args.name,
        args.owner.principal_id(),
        args.parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;
    let project = super::map_project(
        row.id,
        row.name,
        row.user_id,
        row.parent_id,
        row.created_at,
        row.updated_at,
        row.deleted_at,
    )?;

    share::create_project_share_permission(transaction, &project.id, &args.share_permission)
        .await?;

    if let Some(user) = args.owner.as_user() {
        sqlx::query!(
            r#"
            INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
            VALUES ($1, $2, 'project', NOW(), NOW())
            ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
            SET "updatedAt" = NOW()
            "#,
            user.as_ref(),
            project.id,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    super::register_owned(
        transaction,
        registrar,
        &project.id,
        RegisteredEntityType::Project,
        args.owner.clone(),
    )
    .await?;

    Ok(project)
}
