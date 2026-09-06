//! Edit share permissions for a chat.

use crate::domain::models::{ChatErr, Result};
use model_entity::EntityType;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::{
    UpdateSharePermissionRequestV2, access_level::AccessLevel,
};
use sqlx::{Postgres, Transaction};

use super::super::to_chat_err;

/// Edit a chat's share permission by looking up its `SharePermission` row.
///
/// Updates the `SharePermission` columns, then mirrors any channel and team
/// share changes into `entity_access` within the same transaction.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn edit_chat_permission(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> Result<()> {
    let share_id: String = sqlx::query!(
        r#"
        SELECT cp."sharePermissionId" as share_permission_id
        FROM "ChatPermission" cp
        WHERE cp."chatId" = $1
        "#,
        chat_id,
    )
    .map(|row| row.share_permission_id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| to_chat_err(e.into()))?;

    update_share_permission_row(tx, &share_id, share_permission)
        .await
        .map_err(to_chat_err)?;

    if share_permission.channel_share_permissions.is_none()
        && !share_permission.changes_team_share()
    {
        return Ok(());
    }

    let chat_uuid = macro_uuid::string_to_uuid(chat_id)
        .map_err(|e| ChatErr::Unknown(e.context("chat id is not a uuid")))?;

    if let Some(channel_share_permissions) = share_permission.channel_share_permissions.as_ref() {
        edit_channel_share_permissions(tx, &share_id, channel_share_permissions)
            .await
            .map_err(to_chat_err)?;

        entity_access_db_utils::update_entity_access_channel_share_permissions(
            tx,
            &chat_uuid,
            EntityType::Chat,
            channel_share_permissions,
        )
        .await
        .map_err(|e| ChatErr::Unknown(e.into()))?;
    }

    if share_permission.changes_team_share() {
        sync_team_share(
            tx,
            chat_id,
            &chat_uuid,
            share_permission.team_share_access_level.flatten(),
        )
        .await?;
    }

    Ok(())
}

/// Update the `SharePermission` row's link-share and team-share columns.
///
/// Every double-option field is applied with a `CASE WHEN <changed>` so a single
/// static query leaves omitted fields untouched.
#[tracing::instrument(err, skip(tx))]
async fn update_share_permission_row(
    tx: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    let update_link_share = share_permission.link_share.is_some();
    let link_share = share_permission.link_share.flatten();
    let (update_link_share_access_level, link_share_access_level) =
        match share_permission.link_share {
            Some(Some(_)) => {
                let access_level = share_permission
                    .link_share_access_level
                    .flatten()
                    .unwrap_or_else(|| {
                        tracing::warn!(
                            "link sharing was enabled without an access level, defaulting to view"
                        );
                        AccessLevel::View
                    });
                (true, Some(access_level))
            }
            Some(None) => (true, None),
            None => (
                share_permission.link_share_access_level.is_some(),
                share_permission.link_share_access_level.flatten(),
            ),
        };

    let link_share = link_share.map(|value| value.to_string());

    let update_team_share = share_permission.changes_team_share();
    let team_share_access_level = share_permission.team_share_access_level.flatten();

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
            "teamShareAccessLevel" = CASE
                WHEN $6 THEN $7::"AccessLevel"
                ELSE "teamShareAccessLevel"
            END,
            "updatedAt" = NOW()
        WHERE id = $1
        "#,
        share_permission_id,
        update_link_share,
        link_share,
        update_link_share_access_level,
        link_share_access_level as _,
        update_team_share,
        team_share_access_level as _,
    )
    .execute(tx.as_mut())
    .await?;

    Ok(())
}

/// Mirror the chat's team share into `entity_access` for the owner's team.
///
/// `Some(level)` grants the team `level` (inserting or updating its row);
/// `None` revokes the grant. Granting requires the chat owner to be on a team
/// and fails with [`ChatErr::BadRequest`] otherwise; revoking without a team is
/// a no-op because nothing could have been granted.
#[tracing::instrument(err, skip(tx))]
async fn sync_team_share(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    chat_uuid: &macro_uuid::Uuid,
    access_level: Option<AccessLevel>,
) -> Result<()> {
    let owner = sqlx::query_scalar!(r#"SELECT "userId" FROM "Chat" WHERE id = $1"#, chat_id)
        .fetch_one(tx.as_mut())
        .await
        .map_err(|e| to_chat_err(e.into()))?;

    let team_id = share_permission_db_utils::get_user_team_id(tx.as_mut(), &owner)
        .await
        .map_err(|e| ChatErr::Unknown(e.into()))?;

    match (team_id, access_level) {
        (Some(team_id), access_level) => entity_access_db_utils::set_team_entity_access(
            tx,
            chat_uuid,
            EntityType::Chat,
            &team_id,
            access_level,
        )
        .await
        .map_err(|e| ChatErr::Unknown(e.into())),
        (None, Some(_)) => Err(ChatErr::BadRequest(
            "the chat owner is not in a team".to_string(),
        )),
        (None, None) => Ok(()),
    }
}

/// Process channel share permission add/replace/remove operations.
#[tracing::instrument(err, skip(tx))]
async fn edit_channel_share_permissions(
    tx: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_share_permissions: &[UpdateChannelSharePermission],
) -> anyhow::Result<()> {
    let to_upsert: Vec<ChannelSharePermission> = channel_share_permissions
        .iter()
        .filter_map(|csp| match csp.operation {
            UpdateOperation::Add | UpdateOperation::Replace => Some(csp.into()),
            _ => None,
        })
        .collect();

    let to_remove: Vec<String> = channel_share_permissions
        .iter()
        .filter_map(|csp| match csp.operation {
            UpdateOperation::Remove => Some(csp.channel_id.clone()),
            _ => None,
        })
        .collect();

    if !to_remove.is_empty() {
        sqlx::query!(
            r#"
            DELETE FROM "ChannelSharePermission"
            WHERE "share_permission_id" = $1
            AND "channel_id" = ANY($2)
            "#,
            share_permission_id,
            &to_remove,
        )
        .execute(tx.as_mut())
        .await?;
    }

    if !to_upsert.is_empty() {
        let channel_ids: Vec<String> = to_upsert.iter().map(|csp| csp.channel_id.clone()).collect();
        let access_levels: Vec<String> = to_upsert
            .iter()
            .map(|csp| csp.access_level.to_string())
            .collect();

        sqlx::query!(
            r#"
            INSERT INTO "ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
            SELECT $1, channel_id, access_level::"AccessLevel"
            FROM UNNEST($2::text[], $3::text[]) AS t(channel_id, access_level)
            ON CONFLICT ("share_permission_id", "channel_id")
            DO UPDATE SET "access_level" = EXCLUDED."access_level"
            "#,
            share_permission_id,
            &channel_ids,
            &access_levels,
        )
        .execute(tx.as_mut())
        .await?;
    }

    Ok(())
}
