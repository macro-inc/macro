//! Edit share permissions for a chat.

use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{Postgres, Transaction};

/// Helper enum for dynamic query parameter binding.
enum Parameter {
    /// A string value.
    String(String),
    /// A boolean value.
    Bool(bool),
}

/// Edit a chat's share permission by looking up its `SharePermission` row.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn edit_chat_permission(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
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
    .await?;

    edit_share_permission(tx, &share_id, share_permission).await
}

/// Update a `SharePermission` row and its channel share permissions.
#[tracing::instrument(err, skip(tx))]
async fn edit_share_permission(
    tx: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    let mut query = "UPDATE \"SharePermission\" SET ".to_string();
    let mut parameters: Vec<Parameter> = Vec::new();
    let mut set_parts = Vec::new();

    let mut ignore_public_access_level = false;
    if let Some(is_public) = share_permission.is_public {
        set_parts.push("\"isPublic\" = $".to_string() + &(set_parts.len() + 2).to_string());
        parameters.push(Parameter::Bool(is_public));

        if is_public && share_permission.public_access_level.is_none() {
            tracing::warn!(
                "is_public was set to true but public access level was not provided, setting to view"
            );
            set_parts
                .push("\"publicAccessLevel\" = $".to_string() + &(set_parts.len() + 2).to_string());
            parameters.push(Parameter::String("view".to_string()));
        }

        if !is_public {
            ignore_public_access_level = true;
            set_parts.push("\"publicAccessLevel\" = NULL".to_string());
        }
    }

    if let Some(public_access_level) = share_permission.public_access_level
        && !ignore_public_access_level
    {
        set_parts
            .push("\"publicAccessLevel\" = $".to_string() + &(set_parts.len() + 2).to_string());
        parameters.push(Parameter::String(public_access_level.to_string()));
    }

    query += &set_parts.join(", ");
    if !set_parts.is_empty() {
        query += ", ";
    }

    query += "\"updatedAt\" = NOW() WHERE id = $1";

    let mut query = sqlx::query(&query);
    query = query.bind(share_permission_id.to_string());

    for param in parameters {
        match param {
            Parameter::String(s) => {
                query = query.bind(s);
            }
            Parameter::Bool(b) => {
                query = query.bind(b);
            }
        }
    }

    query.execute(tx.as_mut()).await?;

    if let Some(channel_share_permissions) = share_permission.channel_share_permissions.as_ref() {
        edit_channel_share_permissions(tx, share_permission_id, channel_share_permissions).await?;
    }

    Ok(())
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
