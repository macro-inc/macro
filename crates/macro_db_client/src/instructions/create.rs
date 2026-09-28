use crate::{
    document::v2::create::{CreateDocumentArgs, create_document_txn},
    instructions::get::get_instructions_document,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::document::FileType;
use models_dcs::constants::INSTRUCTIONS_FILE_NAME;
use models_permissions::share_permission::SharePermissionV2;
use tracing::instrument;

#[derive(Debug, thiserror::Error)]
pub enum CreateInstructionsError {
    #[error("User already has an instructions document")]
    UserAlreadyHasInstructions,
    #[error("Database error: {0}")]
    DatabaseError(#[from] anyhow::Error),
}

/// Creates a new instructions document for a user
#[instrument(skip(db))]
pub async fn create_instructions_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: MacroUserIdStr<'static>,
) -> Result<String, CreateInstructionsError> {
    tracing::trace!("creating instructions document");

    let mut cleared_stale_mapping = false;
    loop {
        match create_instructions_document_once(db, user_id.clone()).await {
            Ok(document_id) => return Ok(document_id),
            Err(CreateInstructionsError::UserAlreadyHasInstructions) => {
                let exists = get_instructions_document(db, user_id.copied())
                    .await
                    .map(|doc_id| doc_id.is_some())?;
                if exists {
                    return Err(CreateInstructionsError::UserAlreadyHasInstructions);
                }
                if cleared_stale_mapping {
                    return Err(CreateInstructionsError::UserAlreadyHasInstructions);
                }

                sqlx::query!(
                    r#"DELETE FROM "InstructionsDocuments" WHERE "userId" = $1"#,
                    user_id.as_ref()
                )
                .execute(db)
                .await
                .map_err(|e| {
                    CreateInstructionsError::DatabaseError(anyhow::anyhow!(
                        "unable to delete instructions document: {}",
                        e
                    ))
                })?;
                cleared_stale_mapping = true;
            }
            Err(err) => return Err(err),
        }
    }
}

#[instrument(skip(db))]
async fn create_instructions_document_once(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: MacroUserIdStr<'static>,
) -> Result<String, CreateInstructionsError> {
    let mut transaction = db.begin().await.map_err(|error| {
        CreateInstructionsError::DatabaseError(anyhow::anyhow!(
            "unable to create transaction: {error}"
        ))
    })?;

    let document_metadata = create_document_txn(
        &mut transaction,
        CreateDocumentArgs {
            id: None,
            sha: "",
            document_name: INSTRUCTIONS_FILE_NAME,
            user_id: user_id.clone(),
            file_type: Some(FileType::Md),
            project_id: None,
            project_name: None,
            // System-created singleton, not a user "creating an item": the
            // team default link-share preference intentionally does not apply.
            share_permission: &SharePermissionV2::new_document_share_permission(
                Some(FileType::Md),
                None,
            ),
            skip_history: false,
            email_attachment_id: None,
            created_at: None,
            is_task: false,
        },
    )
    .await?;
    let document_id = document_metadata.document_id;

    if let Err(err) =
        insert_instructions_document_on(&mut *transaction, user_id.copied(), &document_id).await
    {
        if let Err(rollback_err) = transaction.rollback().await {
            return Err(CreateInstructionsError::DatabaseError(anyhow::anyhow!(
                "unable to roll back instructions document create after {err}: {rollback_err}"
            )));
        }
        return Err(err);
    }

    transaction.commit().await.map_err(|error| {
        CreateInstructionsError::DatabaseError(anyhow::anyhow!(
            "unable to commit instructions document create: {error}"
        ))
    })?;

    Ok(document_id)
}

/// Insert a new instructions document for a user
#[instrument(skip(db))]
pub async fn insert_instructions_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: MacroUserIdStr<'_>,
    document_id: &str,
) -> Result<(), CreateInstructionsError> {
    insert_instructions_document_on(db, user_id, document_id).await
}

#[instrument(skip(db))]
async fn insert_instructions_document_on<'e, E>(
    db: E,
    user_id: MacroUserIdStr<'_>,
    document_id: &str,
) -> Result<(), CreateInstructionsError>
where
    E: sqlx::PgExecutor<'e>,
{
    tracing::trace!("inserting instructions document");

    let result = sqlx::query!(
        r#"
            INSERT INTO "InstructionsDocuments" ("documentId", "userId")
            VALUES ($1, $2)
        "#,
        document_id,
        user_id.as_ref(),
    )
    .execute(db)
    .await;

    match result {
        Ok(_) => (),
        Err(err) => {
            // Check for unique constraint violation
            if let sqlx::Error::Database(db_err) = &err
                && db_err.is_unique_violation()
            {
                tracing::warn!(user_id=%user_id, "user already has instructions document");
                return Err(CreateInstructionsError::UserAlreadyHasInstructions);
            }

            tracing::error!(error=?err, user_id=%user_id, document_id=%document_id, "unable to insert instructions document entry");
            return Err(CreateInstructionsError::DatabaseError(anyhow::anyhow!(
                "unable to insert instructions document entry: {}",
                err
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres, Row};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_instructions_document_success(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

        let result = create_instructions_document(&pool, user_id.clone()).await;

        match result {
            Ok(document_id) => {
                // Verify document was created
                assert!(!document_id.is_empty());

                // Verify it's in the instructions table
                let instructions_doc = sqlx::query!(
                    r#"SELECT "documentId" as "document_id" FROM "InstructionsDocuments" WHERE "userId" = $1"#,
                    user_id.as_ref()
                )
                .fetch_one(&pool)
                .await?;

                assert_eq!(instructions_doc.document_id, document_id);

                // Verify the document exists in the Document table with correct properties
                let document = sqlx::query!(
                    r#"SELECT name, "fileType" as "file_type", owner FROM "Document" WHERE id = $1"#,
                    &document_id
                )
                .fetch_one(&pool)
                .await?;

                assert_eq!(document.name, INSTRUCTIONS_FILE_NAME);
                assert_eq!(document.file_type.as_deref(), Some("md"));
                assert_eq!(document.owner.as_str(), user_id.as_ref());

                let entity = sqlx::query(
                    r#"
                    SELECT
                        owner_type::text AS owner_type,
                        owner_id,
                        entity_type,
                        deleted_at
                    FROM entity
                    WHERE id = $1
                    "#,
                )
                .bind(macro_uuid::string_to_uuid(&document_id)?)
                .fetch_one(&pool)
                .await?;
                assert_eq!(entity.get::<String, _>("owner_type"), "user");
                assert_eq!(entity.get::<String, _>("owner_id"), user_id.as_ref());
                assert_eq!(entity.get::<String, _>("entity_type"), "document");
                assert_eq!(
                    entity.get::<Option<chrono::DateTime<chrono::Utc>>, _>("deleted_at"),
                    None
                );

                Ok(())
            }
            Err(e) => panic!("Expected success but got error: {:?}", e),
        }
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_instructions_document_duplicate_user(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();

        let first_id = create_instructions_document(&pool, user_id.clone())
            .await
            .expect("first creation should succeed");
        assert!(!first_id.is_empty());

        let result2 = create_instructions_document(&pool, user_id.clone()).await;
        match result2 {
            Err(CreateInstructionsError::UserAlreadyHasInstructions) => {}
            Err(e) => panic!("Expected UserAlreadyHasInstructions but got: {:?}", e),
            Ok(document_id) => panic!(
                "Expected error but got success with document_id: {}",
                document_id
            ),
        }

        let documents = sqlx::query!(
            r#"SELECT id FROM "Document" WHERE owner = $1 AND name = $2"#,
            user_id.as_ref(),
            INSTRUCTIONS_FILE_NAME,
        )
        .fetch_all(&pool)
        .await?;
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].id, first_id);

        let entity_count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM entity
            WHERE owner_id = $1
              AND entity_type = 'document'
              AND id = $2
            "#,
        )
        .bind(user_id.as_ref())
        .bind(macro_uuid::string_to_uuid(&first_id)?)
        .fetch_one(&pool)
        .await?;
        assert_eq!(entity_count, 1);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_instructions_document_replaces_stale_mapping(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();
        let stale_id = create_instructions_document(&pool, user_id.clone())
            .await
            .expect("first creation should succeed");

        sqlx::query!(
            r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
            stale_id
        )
        .execute(&pool)
        .await?;

        let replacement_id = create_instructions_document(&pool, user_id.clone())
            .await
            .expect("stale mapping should be replaced");
        assert_ne!(replacement_id, stale_id);

        let mapping = sqlx::query!(
            r#"SELECT "documentId" as "document_id" FROM "InstructionsDocuments" WHERE "userId" = $1"#,
            user_id.as_ref()
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(mapping.document_id, replacement_id);

        let live_documents = sqlx::query!(
            r#"
            SELECT id
            FROM "Document"
            WHERE owner = $1
              AND name = $2
              AND "deletedAt" IS NULL
            "#,
            user_id.as_ref(),
            INSTRUCTIONS_FILE_NAME,
        )
        .fetch_all(&pool)
        .await?;
        assert_eq!(live_documents.len(), 1);
        assert_eq!(live_documents[0].id, replacement_id);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_instructions_document_different_users(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user1 = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();
        let user2 = MacroUserIdStr::parse_from_str("macro|user2@user.com").unwrap();

        // Add second user to the database (only if it doesn't exist)
        let _ = sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING"#,
            user2.as_ref(),
            "user2@user.com"
        )
        .execute(&pool)
        .await;

        // Both users should be able to create instructions
        let result1 = create_instructions_document(&pool, user1).await;
        let result2 = create_instructions_document(&pool, user2).await;

        assert!(result1.is_ok());
        assert!(result2.is_ok());

        // Verify both documents exist
        let count = sqlx::query!(r#"SELECT COUNT(*) as "count!" FROM "InstructionsDocuments""#)
            .fetch_one(&pool)
            .await?;

        assert_eq!(count.count, 2);

        Ok(())
    }
}
