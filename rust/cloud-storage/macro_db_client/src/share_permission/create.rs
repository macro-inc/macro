use super::channel_permission::create::create_channel_share_permissions;
use model::thread::EmailThreadPermission;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Creates a new share permission
#[tracing::instrument(skip(transaction))]
pub async fn create_share_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<SharePermissionV2> {
    let result = sqlx::query!(
        r#"
            INSERT INTO "SharePermission" ("isPublic", "publicAccessLevel", "createdAt", "updatedAt")
            VALUES ($1, $2, NOW(), NOW())
            RETURNING id, "isPublic" as is_public, "publicAccessLevel" as public_access_level;
        "#,
        share_permission.is_public,
        share_permission.public_access_level.as_ref().map(|s| s.to_string()),
    )
    .fetch_one(transaction.as_mut())
    .await?;

    if let Some(channel_share_permissions) = share_permission.channel_share_permissions.as_ref() {
        create_channel_share_permissions(transaction, &result.id, channel_share_permissions)
            .await?;
    }

    let public_access_level: Option<AccessLevel> = result
        .public_access_level
        .map(|s| AccessLevel::from_str(&s).unwrap());

    Ok(SharePermissionV2 {
        id: result.id,
        is_public: result.is_public,
        public_access_level,
        owner: "".to_string(), // don't care about owner
        channel_share_permissions: share_permission.channel_share_permissions.clone(),
    })
}

/// Creates a new share permission and attaches it to the document
#[tracing::instrument(skip(transaction))]
pub async fn create_document_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &str,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<SharePermissionV2> {
    let updated_share_permission = create_share_permission(transaction, share_permission).await?;

    sqlx::query!(
        r#"
            INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId")
            VALUES ($1, $2)
        "#,
        document_id,
        updated_share_permission.id,
    )
    .execute(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, document_id=?document_id, "unable to create document permission");
        err
    })?;

    Ok(updated_share_permission)
}

/// Creates a new share permission and attaches it to the project
#[tracing::instrument(skip(transaction))]
pub async fn create_project_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: &str,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<SharePermissionV2> {
    let updated_share_permission = create_share_permission(transaction, share_permission).await?;

    sqlx::query!(
        r#"
            INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId")
            VALUES ($1, $2)
        "#,
        project_id,
        updated_share_permission.id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(updated_share_permission)
}

/// Creates a new share permission and attaches it to the chat
#[tracing::instrument(skip(transaction))]
pub async fn create_chat_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    chat_id: &str,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<SharePermissionV2> {
    let updated_share_permission = create_share_permission(transaction, share_permission).await?;

    sqlx::query!(
        r#"
            INSERT INTO "ChatPermission" ("chatId", "sharePermissionId")
            VALUES ($1, $2)
        "#,
        chat_id,
        updated_share_permission.id,
    )
    .execute(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to create chat permission");
        err
    })?;

    Ok(updated_share_permission)
}

/// Creates a new share permission and attaches it to the macro
#[tracing::instrument(skip(transaction))]
pub async fn create_macro_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    macro_id: &str,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<SharePermissionV2> {
    let updated_share_permission = create_share_permission(transaction, share_permission).await?;

    sqlx::query!(
        r#"
            INSERT INTO "MacroPromptPermission" ("macro_prompt_id", "share_permission_id")
            VALUES ($1, $2)
        "#,
        macro_id,
        updated_share_permission.id,
    )
    .execute(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to create macro permission");
        err
    })?;

    Ok(updated_share_permission)
}

/// Creates a new share permission and attaches it to the document
#[tracing::instrument(skip(transaction))]
pub async fn create_thread_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
    thread_id: &str,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<EmailThreadPermission> {
    let updated_share_permission = create_share_permission(transaction, share_permission).await?;

    sqlx::query!(
        r#"
            INSERT INTO "EmailThreadPermission" ("threadId", "sharePermissionId", "userId")
            VALUES ($1, $2, $3)
        "#,
        thread_id,
        updated_share_permission.id,
        user_id,
    )
    .execute(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, document_id=?thread_id, "unable to create thread permission");
        err
    })?;

    Ok(EmailThreadPermission {
        thread_id: thread_id.to_string(),
        share_permission_id: updated_share_permission.id,
        user_id: user_id.to_string(),
        project_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("users")))]
    async fn test_create_share_permission(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        let share_permission = SharePermissionV2::default();
        let result = create_share_permission(&mut transaction, &share_permission).await?;

        assert_ne!(result.id, "".to_string());
        assert!(result.channel_share_permissions.is_none());

        let share_permission = SharePermissionV2 {
            id: "".to_string(),
            owner: "".to_string(),
            is_public: true,
            public_access_level: Some(AccessLevel::Edit),
            channel_share_permissions: Some(vec![
                ChannelSharePermission {
                    channel_id: "channel-one".to_string(),
                    access_level: AccessLevel::View,
                },
                ChannelSharePermission {
                    channel_id: "channel-two".to_string(),
                    access_level: AccessLevel::Edit,
                },
            ]),
        };
        let result = create_share_permission(&mut transaction, &share_permission).await?;

        assert_ne!(result.id, "".to_string());
        assert!(result.channel_share_permissions.is_some());

        Ok(())
    }
}
