use std::str::FromStr;

use entity_access_db_utils::EntityType;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2, access_level::AccessLevel,
};
use sqlx::{PgPool, Postgres, Transaction};

fn link_share_access_level_or_default(link_share_access_level: Option<AccessLevel>) -> AccessLevel {
    link_share_access_level.unwrap_or_else(|| {
        tracing::warn!(
            "link_share was enabled but link share access level was not provided, setting to view"
        );
        AccessLevel::View
    })
}

pub(super) fn normalize_link_share_access_level(
    link_share: Option<LinkShare>,
    link_share_access_level: Option<AccessLevel>,
) -> Option<AccessLevel> {
    link_share.map(|_| link_share_access_level_or_default(link_share_access_level))
}

pub(super) async fn get_project_share_permission(
    pool: &PgPool,
    project_id: &str,
) -> Result<SharePermissionV2, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            permission.id,
            permission."linkShare" AS "link_share?",
            permission."linkShareAccessLevel" AS "link_share_access_level?: AccessLevel",
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
    let link_share = row
        .link_share
        .map(|value| {
            LinkShare::from_str(&value).map_err(|error| sqlx::Error::Decode(Box::new(error)))
        })
        .transpose()?;
    Ok(SharePermissionV2 {
        id: row.id,
        link_share,
        link_share_access_level: row.link_share_access_level,
        owner: row.owner,
        channel_share_permissions,
    })
}

pub(super) async fn create_project_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    permission: &SharePermissionV2,
) -> Result<(), sqlx::Error> {
    let link_share = permission.link_share;
    let link_share_access_level =
        normalize_link_share_access_level(link_share, permission.link_share_access_level);
    let link_share = link_share.map(|value| value.to_string());

    let row = sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            "linkShare",
            "linkShareAccessLevel",
            "createdAt",
            "updatedAt"
        )
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id
        "#,
        link_share,
        link_share_access_level as _,
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

    let update_link_share = update.link_share.is_some();
    let link_share = update.link_share.flatten();
    let (update_link_share_access_level, link_share_access_level) = match update.link_share {
        Some(Some(_)) => (
            true,
            Some(link_share_access_level_or_default(
                update.link_share_access_level.flatten(),
            )),
        ),
        Some(None) => (true, None),
        None => (
            update.link_share_access_level.is_some(),
            update.link_share_access_level.flatten(),
        ),
    };
    let link_share = link_share.map(|value| value.to_string());

    sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET
            "linkShare" = CASE WHEN $2 THEN $3 ELSE "linkShare" END,
            "linkShareAccessLevel" = CASE
                WHEN $2 AND $3 IS NULL THEN NULL
                WHEN $2 THEN COALESCE($5::"AccessLevel", 'view')
                WHEN $4 AND "linkShare" IS NOT NULL THEN COALESCE($5::"AccessLevel", 'view')
                WHEN $4 THEN NULL
                ELSE "linkShareAccessLevel"
            END,
            "updatedAt" = NOW()
        WHERE id = $1
        "#,
        share_permission_id,
        update_link_share,
        link_share,
        update_link_share_access_level,
        link_share_access_level as _,
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
