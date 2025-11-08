use anyhow::Context;
use sqlx::{Pool, Postgres, Transaction};

/// Soft deletes a document from the database.
/// Removing the history and pins for the document as well
#[tracing::instrument(skip(db))]
pub async fn soft_delete_document(db: &Pool<Postgres>, document_id: &str) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;
    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
        "#,
        document_id,
        "document",
    )
    .execute(&mut *transaction)
    .await?;

    // Delete from history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
        "#,
        document_id,
        "document",
    )
    .execute(&mut *transaction)
    .await?;

    // Delete document
    sqlx::query!(
        r#"
        UPDATE "Document"
        SET "deletedAt" = NOW()
        WHERE id = $1"#,
        document_id
    )
    .execute(&mut *transaction)
    .await?;

    transaction
        .commit()
        .await
        .context("unable to soft delete document")?;

    Ok(())
}

/// Hard deletes a document from the database.
/// Removing the history and pins for the document as well.
#[tracing::instrument(skip(db))]
pub async fn delete_document(db: &Pool<Postgres>, document_id: &str) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;
    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
        "#,
        document_id,
        "document",
    )
    .execute(&mut *transaction)
    .await?;

    // Delete from history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
        "#,
        document_id,
        "document",
    )
    .execute(&mut *transaction)
    .await?;

    // Get share permission if present
    let share_permission: Option<String> = sqlx::query!(
        r#"
            SELECT "sharePermissionId" as share_permission_id
            FROM "DocumentPermission"
            WHERE "documentId"=$1"#,
        document_id
    )
    .map(|row| row.share_permission_id)
    .fetch_optional(&mut *transaction)
    .await?;

    if let Some(share_permission) = share_permission {
        // Delete share permission
        sqlx::query!(
            r#"
            DELETE FROM "SharePermission" WHERE id = $1"#,
            share_permission
        )
        .execute(&mut *transaction)
        .await?;
    }

    // Delete document
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document_id)
        .execute(&mut *transaction)
        .await?;

    crate::item_access::delete::delete_user_item_access_by_item(
        &mut transaction,
        document_id,
        "document",
    )
    .await?;

    if let Err(e) = transaction.commit().await {
        tracing::error!(error=?e, "unable to commit transaction");
        return Err(anyhow::Error::from(e));
    }
    Ok(())
}

/// Hard deletes documents in bulk from the database.
#[tracing::instrument(skip(transaction))]
pub async fn delete_document_bulk_tsx(
    transaction: &mut Transaction<'_, Postgres>,
    document_ids: &[impl ToString + std::fmt::Debug],
) -> anyhow::Result<()> {
    let document_ids: Vec<String> = document_ids.iter().map(|s| s.to_string()).collect();
    // Delete pins
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = ANY($1) AND "pinnedItemType" = $2
        "#,
        &document_ids,
        "document",
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete from history
    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = ANY($1) AND "itemType" = $2
        "#,
        &document_ids,
        "document",
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete SharePermissions
    sqlx::query!(
        r#"
        DELETE FROM "SharePermission" sp
        USING "DocumentPermission" dp 
        WHERE dp."sharePermissionId" = sp.id
        AND dp."documentId" = ANY($1)
    "#,
        &document_ids,
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete chats
    sqlx::query!(
        r#"
        DELETE FROM "Document" 
        WHERE id = ANY($1)
        "#,
        &document_ids,
    )
    .execute(transaction.as_mut())
    .await?;

    crate::item_access::delete::delete_user_item_access_bulk(
        transaction,
        &document_ids,
        "document",
    )
    .await?;

    Ok(())
}

/// Deletes a document version from the database.
#[tracing::instrument(skip(db))]
pub async fn delete_document_version(
    db: &Pool<Postgres>,
    document_id: &str,
    document_version_id: i64,
    file_type: &str,
) -> anyhow::Result<()> {
    let total_count = sqlx::query!(
        r#"
        SELECT
            (SELECT COUNT(*) FROM "DocumentInstance" WHERE "documentId" = $1) +
            (SELECT COUNT(*) FROM "DocumentBom" WHERE "documentId" = $1) AS total_count
        "#,
        document_id
    )
    .fetch_one(db)
    .await?;

    if let Some(total_count) = total_count.total_count {
        // We need to delete the entire document
        if total_count == 1 {
            tracing::debug!("document total count is 1, deleting entire document");
            return delete_document(db, document_id).await;
        }
    }

    match file_type {
        "docx" => {
            sqlx::query!(
                r#"DELETE FROM "DocumentBom" WHERE id = $2 and "documentId" = $1"#,
                document_id,
                document_version_id
            )
            .execute(db)
            .await?;
        }
        _ => {
            sqlx::query!(
                r#"DELETE FROM "DocumentInstance" WHERE id = $2 and "documentId" = $1"#,
                document_id,
                document_version_id
            )
            .execute(db)
            .await?;
        }
    }

    Ok(())
}

/// Gets all the shas of a given document bom that are to be deleted.
pub async fn get_shas_for_deletion(
    db: Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT bp.sha
        FROM "BomPart" bp
        JOIN "DocumentBom" db ON bp."documentBomId" = db.id
        WHERE db."documentId" = $1
        "#,
        document_id,
    )
    .fetch_all(&db)
    .await
    .map_err(|err| anyhow::Error::msg(format!("unable to fetch shas for deletion: {:?}", err)))?;

    Ok(result.into_iter().map(|s| s.sha).collect::<Vec<String>>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_soft_delete_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        soft_delete_document(&pool, "document-one").await?;

        let deleted_at = sqlx::query!(
            r#"
            SELECT
                d."createdAt"::timestamptz as deleted_at
            FROM
                "Document" d
            WHERE
                d.id = $1
        "#,
            "document-one"
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(deleted_at.deleted_at.is_some(), true);

        // get pins
        let pins = sqlx::query!(
            r#"SELECT COUNT(*) as count FROM "Pin" WHERE "pinnedItemId"=$1"#,
            "document-one"
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(pins.count.unwrap(), 0);

        // get history
        let history = sqlx::query!(
            r#"SELECT COUNT(*) as count FROM "UserHistory" WHERE "itemId"=$1"#,
            "document-one"
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(history.count.unwrap(), 0);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("docx_example")))]
    async fn test_get_shas_for_deletion(pool: Pool<Postgres>) {
        let mut shas = get_shas_for_deletion(pool.clone(), "document-one")
            .await
            .unwrap();
        shas.sort();

        assert_eq!(
            shas,
            vec!["sha-1", "sha-1", "sha-2", "sha-2", "sha-3", "sha-4"]
        );
    }
}
