//! SQL operations for editing document metadata and share permissions.

use model_entity::EntityType;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use sqlx::{Postgres, Transaction};

/// Update document metadata (name, projectId, fileType, updatedAt).
///
/// `file_type`: None = no change, Some(None) = set to NULL, Some(Some(ft)) = set to ft.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub(super) async fn update_document_metadata(
    transaction: &mut Transaction<'_, Postgres>,
    document_id: &str,
    document_name: Option<&str>,
    project_id: Option<&str>,
    file_type: Option<Option<String>>,
) -> Result<(), sqlx::Error> {
    let mut query = "UPDATE \"Document\" SET ".to_string();
    let mut parameters: Vec<Option<&str>> = Vec::new();
    let mut set_parts = Vec::new();

    if let Some(name) = document_name {
        set_parts.push(format!("\"name\" = ${}", parameters.len() + 2));
        parameters.push(Some(name));
    }

    if let Some(project_id) = project_id {
        set_parts.push(format!("\"projectId\" = ${}", parameters.len() + 2));
        if project_id.is_empty() {
            parameters.push(None);
        } else {
            parameters.push(Some(project_id));
        }
    }

    if let Some(ref ft_update) = file_type {
        set_parts.push(format!("\"fileType\" = ${}", parameters.len() + 2));
        parameters.push(ft_update.as_deref());
    }

    query += &set_parts.join(", ");

    if !set_parts.is_empty() {
        query += ", ";
    }

    query += "\"updatedAt\" = NOW() WHERE id = $1";

    let mut query = sqlx::query(&query);
    query = query.bind(document_id);

    for param in parameters {
        query = query.bind(param);
    }

    query.execute(transaction.as_mut()).await?;
    Ok(())
}

/// Update share permissions for a document.
///
/// Looks up the document's share permission ID, then updates the SharePermission
/// and ChannelSharePermission tables.
pub(super) async fn update_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    document_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> Result<(), sqlx::Error> {
    // Look up the share permission ID for this document
    let share_permission_id = sqlx::query_scalar!(
        r#"
        SELECT dp."sharePermissionId" as "share_permission_id!"
        FROM "DocumentPermission" dp
        WHERE dp."documentId" = $1
        "#,
        document_id
    )
    .fetch_one(transaction.as_mut())
    .await?;

    // Build dynamic update for SharePermission
    update_share_permission_row(transaction, &share_permission_id, share_permission).await?;

    // Handle channel share permission changes
    if let Some(channel_perms) = &share_permission.channel_share_permissions {
        update_channel_share_permissions(transaction, &share_permission_id, channel_perms).await?;

        entity_access_db_utils::update_entity_access_channel_share_permissions(
            transaction,
            &macro_uuid::string_to_uuid(document_id).unwrap(),
            EntityType::Document,
            channel_perms,
        )
        .await?;
    }

    Ok(())
}

/// Update the SharePermission row (isPublic, publicAccessLevel).
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
    // We'll track which params are bool vs string to bind in order
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
        // param_idx += 1; (not needed, last usage)
        str_params.push(Some(public_access_level.to_string()));
        param_order.push(ParamType::Str(str_params.len() - 1));
    }

    if set_parts.is_empty() {
        // Nothing to update on the SharePermission row, but still update timestamp
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

/// Update channel share permissions (add/replace/remove)
async fn update_channel_share_permissions(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_perms: &[models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission],
) -> Result<(), sqlx::Error> {
    // Collect upserts (Add/Replace) and removals
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

    // Remove channel share permissions
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

    // Upsert channel share permissions
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
