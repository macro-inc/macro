/// Deletes all chats for a user
/// Does not commit the transaction
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_chats(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<()> {
    let user_chats = sqlx::query!(
        r#"
        SELECT id FROM "Chat" WHERE "userId" = $1
    "#,
        user_id
    )
    .map(|row| row.id)
    .fetch_all(transaction.as_mut())
    .await?;

    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" 
        WHERE "pinnedItemId" = ANY($1) AND "pinnedItemType" = $2
        "#,
        &user_chats,
        "chat"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete user history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" 
        WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        &user_chats,
        "chat"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete permissions
    sqlx::query!(
        r#"
        DELETE FROM "SharePermission" sp
        USING "ChatPermission" cp 
        WHERE cp."sharePermissionId" = sp.id
        AND cp."chatId" = ANY($1)
    "#,
        &user_chats
    )
    .execute(transaction.as_mut())
    .await?;

    crate::item_access::delete::delete_user_item_access_bulk(transaction, &user_chats, "chat")
        .await?;

    // Delete chats
    sqlx::query!(
        r#"
        DELETE FROM "Chat" 
        WHERE id = ANY($1)
        "#,
        &user_chats
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("basic_user_with_lots_of_documents")
    ))]
    async fn test_delete_user_chats(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        delete_user_chats(&mut transaction, "macro|user@user.com").await?;
        transaction.commit().await?;

        let chats = sqlx::query!(
            r#"
            SELECT
                c.id
            FROM
                "Chat" c
            WHERE
                c."userId" = $1
            "#,
            "macro|user@user.com"
        )
        .fetch_all(&pool)
        .await?;

        assert_eq!(chats.len(), 0);

        Ok(())
    }
}
