use entity_access_db_utils::{
    AccessLevel, EntityAccessSourceType, EntityType, insert_entity_access_row,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::project::Project;
use sqlx::{Postgres, Transaction};

use crate::domain::models::CreateProjectArgs;

use super::share;

pub(super) async fn create_project(
    transaction: &mut Transaction<'_, Postgres>,
    args: &CreateProjectArgs,
) -> Result<Project, sqlx::Error> {
    let project = sqlx::query_as!(
        Project,
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
        args.user_id,
        args.parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    share::create_project_share_permission(transaction, &project.id, &args.share_permission)
        .await?;

    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        VALUES ($1, $2, 'project', NOW(), NOW())
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW()
        "#,
        args.user_id,
        project.id,
    )
    .execute(transaction.as_mut())
    .await?;

    let project_id = project
        .id
        .parse()
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    insert_entity_access_row(
        transaction,
        &project_id,
        EntityType::Project,
        &args.user_id,
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await?;

    entity_registry_db_utils::insert_entity(
        transaction,
        entity_registry_db_utils::NewEntityRecord::new(
            project_id,
            entity_registry_db_utils::RegisteredEntityType::Project,
            model_owner::Owner::User(
                MacroUserIdStr::try_from(args.user_id.clone())
                    .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            ),
        ),
    )
    .await
    .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;

    Ok(project)
}
