use crate::Parameters;
use model_entity::EntityType;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use sqlx::{Postgres, Transaction};

use super::channel_permission::edit::edit_channel_share_permission;

#[tracing::instrument(skip(transaction))]
pub async fn edit_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &uuid::Uuid,
    entity_type: EntityType,
    share_permission_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    let mut query = "UPDATE \"SharePermission\" SET ".to_string();
    let mut parameters: Vec<Parameters> = Vec::new();
    let mut set_parts = Vec::new();

    let mut ignore_public_access_level = false;
    if let Some(is_public) = share_permission.is_public {
        set_parts.push("\"isPublic\" = $".to_string() + &(set_parts.len() + 2).to_string());
        parameters.push(Parameters::Bool(is_public));

        // is_public was set to true but public access level was not provided.
        // we need to set the public access level to view
        if is_public && share_permission.public_access_level.is_none() {
            tracing::warn!(
                "is_public was set to true but public access level was not provided, setting to view"
            );
            set_parts
                .push("\"publicAccessLevel\" = $".to_string() + &(set_parts.len() + 2).to_string());
            parameters.push(Parameters::String("view".to_string()));
        }

        // if is_public is set to false, we need to set the public access level to none.
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
        parameters.push(Parameters::String(public_access_level.to_string()));
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
            Parameters::BigNumber(number) => {
                query = query.bind(number);
            }
            Parameters::String(string) => {
                query = query.bind(string);
            }
            Parameters::Bool(bool) => {
                query = query.bind(bool);
            }
            Parameters::SmallNumber(number) => {
                query = query.bind(number);
            }
        }
    }

    query.execute(transaction.as_mut()).await?;

    if let Some(channel_share_permissions) = share_permission.channel_share_permissions.as_ref() {
        edit_channel_share_permission(transaction, share_permission_id, channel_share_permissions)
            .await?;

        entity_access_db_utils::update_entity_access_channel_share_permissions(
            transaction,
            entity_id,
            entity_type,
            channel_share_permissions,
        )
        .await?;
    }

    Ok(())
}

#[tracing::instrument(skip(transaction))]
pub async fn edit_thread_permission(
    transaction: &mut Transaction<'_, Postgres>,
    thread_id: &uuid::Uuid,
    share_permission_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    edit_share_permission(
        transaction,
        thread_id,
        EntityType::EmailThread,
        share_permission_id,
        share_permission,
    )
    .await
}

#[tracing::instrument(skip(transaction))]
pub async fn edit_project_permission(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    let share_id: String = sqlx::query!(
        r#"
        SELECT
            pp."sharePermissionId" as share_permission_id
        FROM "ProjectPermission" pp
        WHERE pp."projectId" = $1
        "#,
        project_id
    )
    .map(|row| row.share_permission_id)
    .fetch_one(transaction.as_mut())
    .await?;

    edit_share_permission(
        transaction,
        &macro_uuid::string_to_uuid(project_id).unwrap(),
        EntityType::Project,
        &share_id,
        share_permission,
    )
    .await
}
