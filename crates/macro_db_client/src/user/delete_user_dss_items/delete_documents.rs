use model_entity::EntityType;

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

    let document_uuids = user_documents
        .iter()
        .filter_map(|id| macro_uuid::string_to_uuid(id).ok())
        .collect::<Vec<_>>();
    crate::item_access::delete::delete_user_entity_access_bulk(
        transaction,
        &document_uuids,
        EntityType::Document,
    )
    .await?;

    // Delete documents
    sqlx::query!(
        r#"
        DELETE FROM "Document" 
        WHERE id = ANY($1)
        "#,
        &user_documents
    )
    .execute(transaction.as_mut())
    .await?;

    for document_uuid in document_uuids {
        entity_registry_db_utils::delete_entity(transaction, document_uuid).await?;
    }

    Ok(user_documents)
}
