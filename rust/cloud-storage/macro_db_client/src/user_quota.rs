use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use user_quota::{CreateUserQuotaRequest, UserQuota};

#[cfg(test)]
mod test;

/// Retrieves the user quota for a user
#[tracing::instrument(skip(db))]
pub async fn get_user_quota(
    db: &sqlx::PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> anyhow::Result<UserQuota> {
    let user_quota: UserQuota = sqlx::query!(
        r#"
        SELECT
            COUNT(DISTINCT cm.id) AS ai_chat_messages,
            COUNT(DISTINCT d.id) AS documents
        FROM "User" u
        LEFT JOIN "Chat" c ON c."userId" = u.id AND c."deletedAt" IS NULL
        LEFT JOIN "ChatMessage" cm ON cm."chatId" = c.id AND cm.role = 'user'
        LEFT JOIN "Document" d ON d."owner" = u.id AND d."deletedAt" IS NULL
        WHERE u.id = $1;
        "#,
        user_id.as_ref()
    )
    .map(|row| {
        CreateUserQuotaRequest {
            documents: row.documents.unwrap_or(0),
            ai_chat_messages: row.ai_chat_messages.unwrap_or(0),
        }
        .into()
    })
    .fetch_one(db)
    .await?;

    Ok(user_quota)
}
