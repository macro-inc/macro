use super::{delete_chats, delete_documents, delete_projects};

/// Delete a user's document, chat, and project records in one retryable transaction.
/// External cleanup must be queued by the caller after this succeeds.
pub async fn delete_user_items(pool: &sqlx::PgPool, user_id: &str) -> anyhow::Result<Vec<String>> {
    entity_access_db_utils::transaction_retry::on_conflict(
        || async {
            let mut transaction = pool.begin().await?;
            let documents =
                delete_documents::delete_user_documents(&mut transaction, user_id).await?;
            delete_chats::delete_user_chats(&mut transaction, user_id).await?;
            delete_projects::delete_user_projects(&mut transaction, user_id).await?;
            transaction.commit().await?;
            Ok(documents)
        },
        |error: &anyhow::Error| {
            entity_access_db_utils::transaction_retry::is_transaction_conflict(error.as_ref())
        },
    )
    .await
}
