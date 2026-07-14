/// Deletes all documents for a user and returns all document ids that were deleted
/// Does not commit the transaction
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_documents(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    let user_documents = sqlx::query!(
        r#"
        SELECT id FROM "Document" WHERE "owner" = $1
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
        &user_documents,
        "document"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete user history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" 
        WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        &user_documents,
        "document"
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete permissions
    sqlx::query!(
        r#"
        DELETE FROM "SharePermission" sp
        USING "DocumentPermission" dp 
        WHERE dp."sharePermissionId" = sp.id
        AND dp."documentId" = ANY($1)
    "#,
        &user_documents
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete chats
    sqlx::query!(
        r#"
        DELETE FROM "Document" 
        WHERE id = ANY($1)
        "#,
        &user_documents
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(user_documents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("basic_user_with_lots_of_documents")
    ))]
    async fn test_delete_user_documents(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        let mut result = delete_user_documents(&mut transaction, "macro|user@user.com").await?;

        result.sort();

        assert_eq!(
            result,
            vec![
                "document-deleted".to_string(),
                "document-five".to_string(),
                "document-four".to_string(),
                "document-one".to_string(),
                "document-seven".to_string(),
                "document-six".to_string(),
                "document-three".to_string(),
                "document-two".to_string()
            ]
        );

        Ok(())
    }
}
