use crate::Parameters;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use sqlx::{Postgres, Transaction};

use super::channel_permission::edit::edit_channel_share_permission;

#[tracing::instrument(skip(transaction))]
pub async fn edit_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
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
    }

    Ok(())
}

#[tracing::instrument(skip(transaction))]
pub async fn edit_document_permission(
    transaction: &mut Transaction<'_, Postgres>,
    document_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    let share_id: String = sqlx::query!(
        r#"
        SELECT
            dp."sharePermissionId" as share_permission_id
        FROM "DocumentPermission" dp
        WHERE dp."documentId" = $1
        "#,
        document_id
    )
    .map(|row| row.share_permission_id)
    .fetch_one(transaction.as_mut())
    .await?;

    edit_share_permission(transaction, &share_id, share_permission).await
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

    edit_share_permission(transaction, &share_id, share_permission).await
}

#[tracing::instrument(skip(transaction))]
pub async fn edit_chat_permission(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    let share_id: String = sqlx::query!(
        r#"
        SELECT
            cp."sharePermissionId" as share_permission_id
        FROM "ChatPermission" cp
        WHERE cp."chatId" = $1
        "#,
        chat_id
    )
    .map(|row| row.share_permission_id)
    .fetch_one(transaction.as_mut())
    .await?;

    edit_share_permission(transaction, &share_id, share_permission).await
}

#[tracing::instrument(skip(transaction))]
pub async fn edit_thread_permission(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission: &UpdateSharePermissionRequestV2,
    share_permission_id: &str,
) -> anyhow::Result<()> {
    // at this time the share permission of a thread can't be updated. threads cannot be public.
    // only the channel share permissions within can be modified.

    if let Some(channel_share_permissions) = &share_permission.channel_share_permissions {
        edit_channel_share_permission(transaction, share_permission_id, channel_share_permissions)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use models_permissions::share_permission::channel_share_permission::{
        ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
    };

    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_permissions")))]
    async fn test_edit_document_permission(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        let share_permission = UpdateSharePermissionRequestV2 {
            is_public: None,
            public_access_level: Some(AccessLevel::Edit),
            channel_share_permissions: None,
        };

        edit_document_permission(&mut transaction, "document-one", &share_permission).await?;

        let result = sqlx::query!(
            r#"
            SELECT
                sp.id as id,
                sp."isPublic" as is_public,
                sp."publicAccessLevel" as "public_access_level?"
            FROM
            "SharePermission" sp
            WHERE
                sp.id = $1
            "#,
            "sp-1"
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert!(result.is_public);
        assert_eq!(result.public_access_level, Some("edit".to_string()));

        let share_permission = UpdateSharePermissionRequestV2 {
            is_public: Some(false),
            public_access_level: None,
            channel_share_permissions: None,
        };
        edit_document_permission(&mut transaction, "document-one", &share_permission).await?;
        let result = sqlx::query!(
            r#"
            SELECT
                sp.id as id,
                sp."isPublic" as is_public,
                sp."publicAccessLevel" as "public_access_level?"
            FROM
            "SharePermission" sp
            WHERE
                sp.id = $1
            "#,
            "sp-1"
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert!(!result.is_public);
        assert!(result.public_access_level.is_none());

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_permissions")))]
    async fn test_edit_document_permission_document_channel_updates(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        let share_permission = UpdateSharePermissionRequestV2 {
            is_public: None,
            public_access_level: None,
            channel_share_permissions: Some(vec![
                // Add new
                UpdateChannelSharePermission {
                    channel_id: "channel-three".to_string(),
                    access_level: Some(AccessLevel::Edit),
                    operation: UpdateOperation::Add,
                },
                // Replace existing
                UpdateChannelSharePermission {
                    channel_id: "channel-one".to_string(),
                    access_level: Some(AccessLevel::Owner),
                    operation: UpdateOperation::Replace,
                },
                // Remove existing
                UpdateChannelSharePermission {
                    channel_id: "channel-two".to_string(),
                    access_level: None,
                    operation: UpdateOperation::Remove,
                },
            ]),
        };
        edit_document_permission(&mut transaction, "document-one", &share_permission).await?;
        transaction.commit().await?;

        let channel_share_permissions: Vec<ChannelSharePermission> = sqlx::query_as!(
            ChannelSharePermission,
            r#"
            SELECT
                csp."channel_id",
                csp."access_level" as "access_level:AccessLevel"
            FROM
            "ChannelSharePermission" csp
            WHERE
                csp."share_permission_id" = $1
            ORDER BY
                csp."channel_id"
            "#,
            "sp-1"
        )
        .fetch_all(&pool)
        .await?;

        assert_eq!(channel_share_permissions.len(), 2);
        assert_eq!(
            channel_share_permissions[0].channel_id,
            "channel-one".to_string()
        );
        assert_eq!(
            channel_share_permissions[0].access_level,
            AccessLevel::Owner
        );
        assert_eq!(
            channel_share_permissions[1].channel_id,
            "channel-three".to_string()
        );
        assert_eq!(channel_share_permissions[1].access_level, AccessLevel::Edit);

        Ok(())
    }
}
