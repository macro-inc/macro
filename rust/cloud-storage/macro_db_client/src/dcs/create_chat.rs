use super::append_attachment_to_chat::append_attachment_to_chat;
use crate::history::{upsert_item_last_accessed, upsert_user_history};
use ai::types::Model;
use model::{IDWithTimeStamps, chat::NewChatAttachment};
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres};

// this has types that should not become dependencies of macro_db_client
#[tracing::instrument(skip(db))]
#[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
pub async fn create_chat_v2(
    db: &Pool<Postgres>,
    user_id: &str,
    name: &str,
    model: Model,
    project_id: Option<&str>,
    share_permission: &models_permissions::share_permission::SharePermissionV2,
    attachments: Vec<NewChatAttachment>,
    attachment_token_count: i64,
    is_persistent: bool,
) -> anyhow::Result<String> {
    let mut transaction: sqlx::Transaction<'_, Postgres> = db.begin().await?;
    // move this as a standalone query to macro_db_client/dcs/create_empty_chat
    // create a row in chat table
    let chat = sqlx::query_as!(
        IDWithTimeStamps,
        r#"
                INSERT INTO "Chat" ("userId", name, model, "projectId", "isPersistent")
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
        &user_id,
        &name,
        model.to_string(),
        project_id,
        is_persistent
    )
    .fetch_one(&mut *transaction)
    .await?;

    let attachments = attachments
        .into_iter()
        .map(|attachment| NewChatAttachment {
            attachment_id: attachment.attachment_id,
            attachment_type: attachment.attachment_type,
            chat_id: chat.id.clone(),
        })
        .collect::<Vec<_>>();

    // create row in chat permissions
    crate::share_permission::create::create_chat_permission(
        &mut transaction,
        &chat.id,
        share_permission,
    )
    .await?;

    // tracking
    upsert_user_history(&mut transaction, user_id, &chat.id, "chat").await?;
    upsert_item_last_accessed(&mut transaction, &chat.id, "chat").await?;

    // add attachment rows
    for attachment in attachments {
        append_attachment_to_chat(&mut transaction, attachment).await?;
    }

    crate::item_access::insert::insert_user_item_access(
        &mut transaction,
        user_id,
        &chat.id,
        "chat",
        AccessLevel::Owner,
        None,
    )
    .await?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "create_chat transaction error");
        anyhow::Error::from(e)
    })?;
    Ok(chat.id)
}
