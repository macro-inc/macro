use model_entity::EntityType;
use sqlx::{Pool, Postgres, Transaction};

/// Hard deletes a document from the database.
/// Removing the history and pins for the document as well.
#[tracing::instrument(skip(db))]
pub async fn delete_document(db: &Pool<Postgres>, document_id: &str) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
        "#,
        document_id,
        "document",
    )
    .execute(&mut *transaction)
    .await?;

    sqlx::query!(
        r#"
        DELETE FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = $2
        "#,
        document_id,
        "document",
    )
    .execute(&mut *transaction)
    .await?;

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
        sqlx::query!(
            r#"
            DELETE FROM "SharePermission" WHERE id = $1"#,
            share_permission
        )
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document_id)
        .execute(&mut *transaction)
        .await?;

    crate::item_access::delete::delete_user_entity_access_by_item(
        &mut transaction,
        &macro_uuid::string_to_uuid(document_id).unwrap(),
        EntityType::Document,
    )
    .await?;

    if let Ok(document_uuid) = macro_uuid::string_to_uuid(document_id) {
        entity_registry_db_utils::delete_entity(&mut transaction, document_uuid).await?;
    }

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

    crate::item_access::delete::delete_user_entity_access_bulk(
        transaction,
        &document_ids
            .iter()
            .filter_map(|p| macro_uuid::string_to_uuid(p).ok())
            .collect::<Vec<uuid::Uuid>>(),
        EntityType::Document,
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
    use macro_user_id::cowlike::CowLike;
    use sqlx::{Pool, Postgres};

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

    async fn insert_uuid_document(pool: &Pool<Postgres>) -> uuid::Uuid {
        let document_id = uuid::Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO "Document" (id, name, "fileType", owner)
            VALUES ($1, 'uuid-doc', 'md', 'macro|user@user.com')
            "#,
        )
        .bind(document_id.to_string())
        .execute(pool)
        .await
        .unwrap();
        document_id
    }

    async fn insert_entity_row(pool: &Pool<Postgres>, document_id: uuid::Uuid) {
        let mut transaction = pool.begin().await.unwrap();
        entity_registry_db_utils::insert_entity(
            &mut transaction,
            entity_registry_db_utils::NewEntityRecord::new(
                document_id,
                entity_registry_db_utils::RegisteredEntityType::Document,
                model_owner::Owner::User(
                    macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
                        .unwrap()
                        .into_owned(),
                ),
            ),
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();
    }

    async fn count_entity_rows(pool: &Pool<Postgres>, document_id: uuid::Uuid) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM entity WHERE id = $1")
            .bind(document_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document")))]
    async fn delete_document_removes_entity_row(pool: Pool<Postgres>) {
        let document_id = insert_uuid_document(&pool).await;
        insert_entity_row(&pool, document_id).await;

        delete_document(&pool, &document_id.to_string())
            .await
            .unwrap();

        assert_eq!(count_entity_rows(&pool, document_id).await, 0);
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document")))]
    async fn delete_document_succeeds_without_entity_row(pool: Pool<Postgres>) {
        let document_id = insert_uuid_document(&pool).await;

        delete_document(&pool, &document_id.to_string())
            .await
            .unwrap();

        assert_eq!(count_entity_rows(&pool, document_id).await, 0);
        let remaining: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Document" WHERE id = $1"#)
            .bind(document_id.to_string())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining, 0);
    }
}
