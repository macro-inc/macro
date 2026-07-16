use std::str::FromStr;

use entity_access_db_utils::EntityType;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::{
    SharePermissionV2, UpdateSharePermissionRequestV2, access_level::AccessLevel,
};
use sqlx::{PgPool, Postgres, Transaction};

pub(super) async fn get_project_share_permission(
    pool: &PgPool,
    project_id: &str,
) -> Result<SharePermissionV2, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            permission.id,
            permission."isPublic" AS "is_public",
            permission."publicAccessLevel" AS "public_access_level?",
            project."userId" AS owner,
            COALESCE(
                json_agg(json_build_object(
                    'channel_id', channel."channel_id",
                    'access_level', channel."access_level"
                )) FILTER (WHERE channel."channel_id" IS NOT NULL),
                '[]'
            ) AS "channel_share_permissions?"
        FROM "ProjectPermission" project_permission
        JOIN "SharePermission" permission
            ON project_permission."sharePermissionId" = permission.id
        JOIN "Project" project ON project_permission."projectId" = project.id
        LEFT JOIN "ChannelSharePermission" channel
            ON channel."share_permission_id" = permission.id
        WHERE project_permission."projectId" = $1
        GROUP BY permission.id, project."userId"
        "#,
        project_id,
    )
    .fetch_one(pool)
    .await?;

    let channel_share_permissions = row
        .channel_share_permissions
        .map(serde_json::from_value::<Vec<ChannelSharePermission>>)
        .transpose()
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?
        .filter(|permissions| !permissions.is_empty());
    let public_access_level = row
        .public_access_level
        .map(|level| {
            AccessLevel::from_str(&level).map_err(|error| sqlx::Error::Decode(Box::new(error)))
        })
        .transpose()?;

    Ok(SharePermissionV2 {
        id: row.id,
        is_public: row.is_public,
        public_access_level,
        owner: row.owner,
        channel_share_permissions,
    })
}

pub(super) async fn create_project_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    permission: &SharePermissionV2,
) -> Result<(), sqlx::Error> {
    let row = sqlx::query!(
        r#"
        INSERT INTO "SharePermission" ("isPublic", "publicAccessLevel", "createdAt", "updatedAt")
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id
        "#,
        permission.is_public,
        permission
            .public_access_level
            .as_ref()
            .map(ToString::to_string),
    )
    .fetch_one(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId")
        VALUES ($1, $2)
        "#,
        project_id,
        row.id,
    )
    .execute(transaction.as_mut())
    .await?;

    for channel in permission.channel_share_permissions.iter().flatten() {
        sqlx::query!(
            r#"
            INSERT INTO "ChannelSharePermission" (share_permission_id, channel_id, access_level)
            VALUES ($1, $2, $3::text::"AccessLevel")
            "#,
            row.id,
            channel.channel_id,
            channel.access_level.to_string(),
        )
        .execute(transaction.as_mut())
        .await?;
    }
    Ok(())
}

pub(super) async fn edit_project_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    update: &UpdateSharePermissionRequestV2,
) -> Result<(), sqlx::Error> {
    let share_permission_id = sqlx::query_scalar!(
        r#"SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = $1"#,
        project_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    let clear_public_level = update.is_public == Some(false);
    let default_public_level =
        update.is_public == Some(true) && update.public_access_level.is_none();
    let update_public_level =
        clear_public_level || default_public_level || update.public_access_level.is_some();
    let public_access_level = if clear_public_level {
        None
    } else if default_public_level {
        Some("view".to_owned())
    } else {
        update.public_access_level.as_ref().map(ToString::to_string)
    };

    sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET
            "isPublic" = CASE WHEN $2 THEN $3 ELSE "isPublic" END,
            "publicAccessLevel" = CASE WHEN $4 THEN $5 ELSE "publicAccessLevel" END,
            "updatedAt" = NOW()
        WHERE id = $1
        "#,
        share_permission_id,
        update.is_public.is_some(),
        update.is_public,
        update_public_level,
        public_access_level,
    )
    .execute(transaction.as_mut())
    .await?;

    let Some(channel_updates) = update.channel_share_permissions.as_ref() else {
        return Ok(());
    };

    let entity_id = project_id
        .parse()
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    entity_access_db_utils::update_entity_access_channel_share_permissions(
        transaction,
        &entity_id,
        EntityType::Project,
        channel_updates,
    )
    .await?;

    for channel in channel_updates {
        match channel.operation {
            UpdateOperation::Add => {
                sqlx::query!(
                    r#"
                    INSERT INTO "ChannelSharePermission" (share_permission_id, channel_id, access_level)
                    VALUES ($1, $2, $3::text::"AccessLevel")
                    "#,
                    share_permission_id,
                    channel.channel_id,
                    channel.access_level.unwrap_or(AccessLevel::View).to_string(),
                )
                .execute(transaction.as_mut())
                .await?;
            }
            UpdateOperation::Remove => {
                sqlx::query!(
                    r#"
                    DELETE FROM "ChannelSharePermission"
                    WHERE share_permission_id = $1 AND channel_id = $2
                    "#,
                    share_permission_id,
                    channel.channel_id,
                )
                .execute(transaction.as_mut())
                .await?;
            }
            UpdateOperation::Replace => {
                sqlx::query!(
                    r#"
                    UPDATE "ChannelSharePermission"
                    SET access_level = $3::text::"AccessLevel"
                    WHERE share_permission_id = $1 AND channel_id = $2
                    "#,
                    share_permission_id,
                    channel.channel_id,
                    channel
                        .access_level
                        .unwrap_or(AccessLevel::View)
                        .to_string(),
                )
                .execute(transaction.as_mut())
                .await?;
            }
        }
    }
    Ok(())
}
