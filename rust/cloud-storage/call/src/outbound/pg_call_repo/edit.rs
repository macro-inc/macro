//! SQL operations for editing call-record share permissions.

use entity_access_db_utils::{AccessLevel, EntityAccessSourceType};
use model_entity::EntityType;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

/// Update share permissions for a call record.
///
/// Looks up the call's share permission ID from either the active `calls`
/// table or the archived `call_records` table (both carry `share_permission_id`),
/// then updates the `SharePermission` and `ChannelSharePermission` tables.
pub(super) async fn update_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    call_id: &Uuid,
    share_permission: &UpdateSharePermissionRequestV2,
) -> Result<(), sqlx::Error> {
    let share_permission_id = sqlx::query_scalar!(
        r#"
        SELECT share_permission_id as "share_permission_id!"
        FROM (
            SELECT share_permission_id FROM calls WHERE id = $1
            UNION ALL
            SELECT share_permission_id FROM call_records WHERE id = $1
        ) t
        LIMIT 1
        "#,
        call_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    update_share_permission_row(transaction, &share_permission_id, share_permission).await?;

    if let Some(channel_perms) = &share_permission.channel_share_permissions {
        update_channel_share_permissions(transaction, &share_permission_id, channel_perms).await?;

        entity_access_db_utils::update_entity_access_channel_share_permissions(
            transaction,
            call_id,
            EntityType::Call,
            channel_perms,
        )
        .await?;
    }

    Ok(())
}

/// Grant or revoke the call creator's team's View access on the call.
///
/// The team is resolved from the call's `created_by` in either the active
/// `calls` table or the archived `call_records` table — not from the acting
/// user. If the creator has no team, this is a no-op. Also keeps the
/// `calls.share_with_team` flag in sync when the call is still active so
/// `archive_call` reflects the latest choice.
pub(super) async fn set_share_with_team(
    transaction: &mut Transaction<'_, Postgres>,
    call_id: &Uuid,
    share: bool,
) -> Result<(), sqlx::Error> {
    let created_by: String = sqlx::query_scalar!(
        r#"
        SELECT created_by as "created_by!"
        FROM (
            SELECT created_by FROM calls WHERE id = $1
            UNION ALL
            SELECT created_by FROM call_records WHERE id = $1
        ) t
        LIMIT 1
        "#,
        call_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"UPDATE calls SET share_with_team = $2 WHERE id = $1"#,
        call_id,
        share,
    )
    .execute(transaction.as_mut())
    .await?;

    let team_id: Option<Uuid> = sqlx::query_scalar!(
        r#"
        SELECT team_id
        FROM team_user
        WHERE user_id = $1
        LIMIT 1
        "#,
        &created_by,
    )
    .fetch_optional(transaction.as_mut())
    .await?;

    let Some(team_id) = team_id else {
        return Ok(());
    };

    if share {
        sqlx::query!(
            r#"
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
            "#,
            call_id,
            EntityType::Call.as_ref(),
            &team_id.to_string(),
            EntityAccessSourceType::Team as _,
            AccessLevel::View as _,
        )
        .execute(transaction.as_mut())
        .await?;
    } else {
        sqlx::query!(
            r#"
            DELETE FROM entity_access
            WHERE entity_id = $1
              AND entity_type = $2
              AND source_id = $3
              AND source_type = $4
              AND granted_from_project_id IS NULL
            "#,
            call_id,
            EntityType::Call.as_ref(),
            &team_id.to_string(),
            EntityAccessSourceType::Team as _,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    Ok(())
}

/// Update the SharePermission row (isPublic, publicAccessLevel).
async fn update_share_permission_row(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> Result<(), sqlx::Error> {
    let mut set_parts = Vec::new();
    let mut str_params: Vec<Option<String>> = Vec::new();
    let mut bool_params: Vec<bool> = Vec::new();

    // Track parameter indices (starting at 2 since $1 is the share_permission_id)
    let mut param_idx = 2u32;
    enum ParamType {
        Bool(usize),
        Str(usize),
    }
    let mut param_order: Vec<ParamType> = Vec::new();

    let mut ignore_public_access_level = false;
    if let Some(is_public) = share_permission.is_public {
        set_parts.push(format!("\"isPublic\" = ${param_idx}"));
        param_idx += 1;
        bool_params.push(is_public);
        param_order.push(ParamType::Bool(bool_params.len() - 1));

        if is_public && share_permission.public_access_level.is_none() {
            set_parts.push(format!("\"publicAccessLevel\" = ${param_idx}"));
            param_idx += 1;
            str_params.push(Some("view".to_string()));
            param_order.push(ParamType::Str(str_params.len() - 1));
        }

        if !is_public {
            ignore_public_access_level = true;
            set_parts.push("\"publicAccessLevel\" = NULL".to_string());
        }
    }

    if let Some(public_access_level) = share_permission.public_access_level
        && !ignore_public_access_level
    {
        set_parts.push(format!("\"publicAccessLevel\" = ${param_idx}"));
        str_params.push(Some(public_access_level.to_string()));
        param_order.push(ParamType::Str(str_params.len() - 1));
    }

    if set_parts.is_empty() {
        sqlx::query(r#"UPDATE "SharePermission" SET "updatedAt" = NOW() WHERE id = $1"#)
            .bind(share_permission_id)
            .execute(transaction.as_mut())
            .await?;
        return Ok(());
    }

    let query_str = format!(
        r#"UPDATE "SharePermission" SET {}, "updatedAt" = NOW() WHERE id = $1"#,
        set_parts.join(", ")
    );

    let mut query = sqlx::query(&query_str);
    query = query.bind(share_permission_id.to_string());

    for param_type in &param_order {
        match param_type {
            ParamType::Bool(idx) => {
                query = query.bind(bool_params[*idx]);
            }
            ParamType::Str(idx) => {
                query = query.bind(str_params[*idx].clone());
            }
        }
    }

    query.execute(transaction.as_mut()).await?;
    Ok(())
}

/// Update channel share permissions (add/replace/remove).
async fn update_channel_share_permissions(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_perms: &[models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission],
) -> Result<(), sqlx::Error> {
    let mut upsert_channel_ids = Vec::new();
    let mut upsert_access_levels = Vec::new();
    let mut remove_channel_ids = Vec::new();

    for perm in channel_perms {
        match perm.operation {
            UpdateOperation::Add | UpdateOperation::Replace => {
                upsert_channel_ids.push(perm.channel_id.clone());
                upsert_access_levels.push(
                    perm.access_level
                        .unwrap_or(
                            models_permissions::share_permission::access_level::AccessLevel::View,
                        )
                        .to_string(),
                );
            }
            UpdateOperation::Remove => {
                remove_channel_ids.push(perm.channel_id.clone());
            }
        }
    }

    if !remove_channel_ids.is_empty() {
        sqlx::query!(
            r#"
            DELETE FROM "ChannelSharePermission"
            WHERE "share_permission_id" = $1
            AND "channel_id" = ANY($2)
            "#,
            share_permission_id,
            &remove_channel_ids,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    if !upsert_channel_ids.is_empty() {
        sqlx::query!(
            r#"
            INSERT INTO "ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
            SELECT $1, channel_id, access_level::"AccessLevel"
            FROM UNNEST($2::text[], $3::text[]) AS t(channel_id, access_level)
            ON CONFLICT ("share_permission_id", "channel_id")
            DO UPDATE SET "access_level" = EXCLUDED."access_level"
            "#,
            share_permission_id,
            &upsert_channel_ids,
            &upsert_access_levels,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    Ok(())
}
