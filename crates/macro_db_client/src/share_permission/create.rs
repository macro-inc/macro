use macro_user_id::user_id::MacroUserIdStr;
use model::thread::EmailThreadPermission;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::{LinkShare, SharePermissionV2};

use super::channel_permission::create::create_channel_share_permissions;

pub(super) fn link_share_access_level_or_default(
    link_share_access_level: Option<AccessLevel>,
) -> AccessLevel {
    if let Some(access_level) = link_share_access_level {
        return access_level;
    }

    tracing::warn!(
        "link_share was enabled but link share access level was not provided, setting to view"
    );
    AccessLevel::View
}

fn normalize_link_share_access_level(
    link_share: Option<LinkShare>,
    link_share_access_level: Option<AccessLevel>,
) -> Option<AccessLevel> {
    link_share.map(|_| link_share_access_level_or_default(link_share_access_level))
}

/// Creates a new share permission
#[tracing::instrument(skip(transaction))]
pub async fn create_share_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<SharePermissionV2> {
    let link_share = share_permission.link_share;
    let link_share_access_level =
        normalize_link_share_access_level(link_share, share_permission.link_share_access_level);
    let link_share_value = link_share.map(|value| value.to_string());

    let id = sqlx::query_scalar!(
        r#"
            INSERT INTO "SharePermission" (
                "linkShare",
                "linkShareAccessLevel",
                "createdAt",
                "updatedAt"
            )
            VALUES ($1, $2, NOW(), NOW())
            RETURNING id;
        "#,
        link_share_value,
        link_share_access_level as _,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    if let Some(channel_share_permissions) = share_permission.channel_share_permissions.as_ref() {
        create_channel_share_permissions(transaction, &id, channel_share_permissions).await?;
    }

    Ok(SharePermissionV2 {
        id,
        link_share,
        link_share_access_level,
        owner: String::new(), // Owner is not stored on the share permission row.
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

/// Creates a new share permission and attaches it to the document
#[tracing::instrument(skip(transaction))]
pub async fn create_thread_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: MacroUserIdStr<'_>,
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
        user_id.as_ref(),
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
mod test;
