use std::str::FromStr;

use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use sqlx::PgPool;

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
