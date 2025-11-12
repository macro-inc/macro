use crate::{document::v2::create::create_document, instructions::get::get_instructions_document};
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
    user_id: &str,
) -> Result<String, CreateInstructionsError> {
    tracing::trace!("creating instructions document");

    let document_metadata = create_document(
        db,
        crate::document::v2::create::CreateDocumentArgs {
            id: None,
            sha: "",
            document_name: INSTRUCTIONS_FILE_NAME,
            user_id,
            file_type: Some(FileType::Md),
            project_id: None,
            project_name: None,
            share_permission: &SharePermissionV2::user_only(),
            skip_history: false,
            created_at: None,
        },
    )
    .await?;

    let document_id = document_metadata.document_id;

    let insert_result = insert_instructions_document(db, user_id, &document_id).await;

    match insert_result {
        Ok(_) => (),
        Err(err) => {
            match err {
                CreateInstructionsError::UserAlreadyHasInstructions => {
                    // Check if the instructions document has been deleted but the instructions table row still exists
                    let exists = get_instructions_document(db, user_id)
                        .await
                        .map(|doc_id| doc_id.is_some())?;

                    // If the instructions document exists, we can't create a new one
                    if exists {
                        return Err(CreateInstructionsError::UserAlreadyHasInstructions);
                    }

                    // Otherwise we can safely delete the instructions row
                    sqlx::query!(
                        r#"DELETE FROM "InstructionsDocuments" WHERE "userId" = $1"#,
                        user_id
                    )
                    .execute(db)
                    .await
                    .map_err(|e| {
                        CreateInstructionsError::DatabaseError(anyhow::anyhow!(
                            "unable to delete instructions document: {}",
                            e
                        ))
                    })?;

                    // try again
                    insert_instructions_document(db, user_id, &document_id).await?;
                }
                _ => return Err(err),
            }
        }
    }

    Ok(document_id)
}

/// Insert a new instructions document for a user
#[instrument(skip(db))]
pub async fn insert_instructions_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    document_id: &str,
) -> Result<(), CreateInstructionsError> {
    tracing::trace!("inserting instructions document");

    let result = sqlx::query!(
        r#"
            INSERT INTO "InstructionsDocuments" ("documentId", "userId")
            VALUES ($1, $2)
        "#,
        document_id,
        user_id,
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
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_instructions_document_success(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user@user.com";

        let result = create_instructions_document(&pool, user_id).await;

        match result {
            Ok(document_id) => {
                // Verify document was created
                assert!(!document_id.is_empty());

                // Verify it's in the instructions table
                let instructions_doc = sqlx::query!(
                    r#"SELECT "documentId" as "document_id" FROM "InstructionsDocuments" WHERE "userId" = $1"#,
                    user_id
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
                assert_eq!(document.owner, user_id);

                Ok(())
            }
            Err(e) => panic!("Expected success but got error: {:?}", e),
        }
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_instructions_document_duplicate_user(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user_id = "macro|user@user.com";

        // First creation should succeed
        let result1 = create_instructions_document(&pool, user_id).await;
        match result1 {
            Ok(document_id) => {
                // Verify the document exists
                assert!(!document_id.is_empty());
            }
            Err(e) => panic!("First creation should succeed but got: {:?}", e),
        }

        // Second creation should fail with UserAlreadyHasInstructions
        let result2 = create_instructions_document(&pool, user_id).await;

        match result2 {
            Err(CreateInstructionsError::UserAlreadyHasInstructions) => {
                // This is expected
                Ok(())
            }
            Err(e) => panic!("Expected UserAlreadyHasInstructions but got: {:?}", e),
            Ok(document_id) => panic!(
                "Expected error but got success with document_id: {}",
                document_id
            ),
        }
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_instructions_document_different_users(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user1 = "macro|user@user.com";
        let user2 = "macro|user2@user.com";

        // Add second user to the database (only if it doesn't exist)
        let _ = sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING"#,
            user2,
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
