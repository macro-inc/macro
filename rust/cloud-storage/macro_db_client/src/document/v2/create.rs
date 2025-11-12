use crate::history::upsert_item_last_accessed;
use crate::history::upsert_user_history;
use crate::share_permission::create::create_document_permission;
use model::document::DocumentMetadata;
use model::document::FileType;
use model::document::ID;
use model::document::VersionIDWithTimeStamps;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::Pool;
use sqlx::Postgres;
use sqlx::Transaction;
use tracing::instrument;

/// struct for creating a document
#[derive(Debug)]
pub struct CreateDocumentArgs<'a> {
    pub id: Option<&'a str>,
    pub sha: &'a str,
    pub document_name: &'a str,
    pub user_id: &'a str,
    pub file_type: Option<FileType>,
    pub project_id: Option<&'a str>,
    pub project_name: Option<&'a str>,
    pub share_permission: &'a SharePermissionV2,
    pub skip_history: bool,
    /// Optional value. defaults to now if not included
    pub created_at: Option<&'a chrono::DateTime<chrono::Utc>>,
}

/// Creates a new document
#[instrument(skip(db))]
pub async fn create_document(
    db: &Pool<Postgres>,
    args: CreateDocumentArgs<'_>,
) -> anyhow::Result<DocumentMetadata> {
    let mut transaction = db.begin().await.inspect_err(|e| {
        tracing::error!(error=?e, "unable to create transaction");
    })?;

    let document_metadata = create_document_txn(&mut transaction, args).await?;

    transaction.commit().await.inspect_err(|e| {
        tracing::error!(error=?e, "unable to commit transaction");
    })?;

    Ok(document_metadata)
}

/// Creates a new document in a transaction without committing
#[instrument(skip(transaction))]
pub async fn create_document_txn(
    transaction: &mut Transaction<'_, Postgres>,
    args: CreateDocumentArgs<'_>,
) -> anyhow::Result<DocumentMetadata> {
    tracing::trace!("creating document");
    let CreateDocumentArgs {
        id,
        sha,
        document_name,
        user_id,
        file_type,
        project_id,
        project_name: provided_project_name,
        share_permission,
        skip_history,
        created_at: _, // overwritten below
    } = args;

    // default to now if created_at argument not included
    let now = chrono::Utc::now();
    let created_at = args.created_at.unwrap_or(&now);

    // Fetches project name for provided project_id if name is not provided
    let fetched_project_name: Option<String> = match (provided_project_name, project_id) {
        (None, Some(proj_id)) => {
            let name: String = sqlx::query_scalar!(
                r#"
                    SELECT name FROM "Project" WHERE id = $1
                "#,
                proj_id,
            )
            .fetch_one(transaction.as_mut())
            .await
            .map_err(|err| {
                tracing::error!(error=?err, project_id=%proj_id, "unable to get project");
                err
            })?;

            Some(name)
        }
        _ => None,
    };

    let project_name: Option<&str> = provided_project_name.or(fetched_project_name.as_deref());

    // insert document with id if included in request
    let document_id = if let Some(id) = id {
        insert_document_with_id(
            transaction,
            id,
            user_id,
            document_name,
            file_type,
            project_id,
            created_at,
        )
        .await?;
        id.to_string()
    } else {
        insert_document_no_id(
            transaction,
            user_id,
            document_name,
            file_type,
            project_id,
            created_at,
        )
        .await?
        .id
    };

    // Docx documents have their versions associated with a DocumentBom
    // whereas all other file types use DocumentInstance
    let document_version = match file_type {
        Some(FileType::Docx) => {
            let document_bom = sqlx::query!(
            r#"
                INSERT INTO "DocumentBom" ("documentId", "createdAt", "updatedAt")
                VALUES ($1, $2, $2)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
                &document_id,
                created_at.naive_utc(),
            )
            .fetch_one(transaction.as_mut())
            .await?;

            VersionIDWithTimeStamps {
                id: document_bom.id,
                created_at: document_bom.created_at,
                updated_at: document_bom.updated_at,
                sha: sha.to_string(),
            }
        }
        _ => {
            sqlx::query_as!(
                VersionIDWithTimeStamps,
                r#"
                    INSERT INTO "DocumentInstance" ("documentId", "sha", "createdAt", "updatedAt")
                    VALUES ($1, $2, $3, $3)
                    RETURNING id, sha, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
                "#,
                &document_id,
                sha,
                created_at.naive_utc()
        )
        .fetch_one(transaction.as_mut())
        .await?
        }
    };

    // create document permission
    create_document_permission(transaction, &document_id, share_permission).await?;

    // Add item to user history for creator
    if !skip_history {
        upsert_user_history(transaction, user_id, &document_id, "document").await?;
        upsert_item_last_accessed(transaction, &document_id, "document").await?;
    }

    crate::item_access::insert::insert_user_item_access(
        transaction,
        user_id,
        &document_id,
        "document",
        AccessLevel::Owner,
        None,
    )
    .await?;

    Ok(DocumentMetadata::new_document(
        &document_id,
        document_version.id,
        user_id,
        document_name,
        file_type,
        document_version.sha.as_str(),
        None,
        None,
        None,
        project_id,
        project_name,
        document_version.created_at,
        document_version.updated_at,
    ))
}

/// Inserts a new document record into the database
#[instrument(skip(transaction))]
async fn insert_document_no_id(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
    document_name: &str,
    file_type: Option<FileType>,
    project_id: Option<&str>,
    created_at: &chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<ID> {
    sqlx::query_as!(
        ID,
        r#"
            INSERT INTO "Document" (owner, name, "fileType", "projectId", "createdAt", "updatedAt") 
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING id;
        "#,
        user_id,
        document_name,
        file_type.map(|file_type| file_type.as_str().to_string()),
        project_id,
        created_at.naive_utc()
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to create document");
        anyhow::anyhow!("unable to create document: {}", err)
    })
}

#[instrument(skip(transaction))]
async fn insert_document_with_id(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: &str,
    user_id: &str,
    document_name: &str,
    file_type: Option<FileType>,
    project_id: Option<&str>,
    created_at: &chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
            INSERT INTO "Document" (id, owner, name, "fileType", "projectId", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $6)
        "#,
        id,
        user_id,
        document_name,
        file_type.map(|file_type| file_type.as_str().to_string()),
        project_id,
        created_at.naive_utc()
    )
    .execute(&mut **transaction)
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(err) => {
            // Check for duplicate key violation
            if let sqlx::Error::Database(db_err) = &err
                && db_err.is_unique_violation()
            {
                tracing::warn!(error=?err, "document with ID already exists");
                return Err(anyhow::anyhow!("document with ID already exists: {}", id));
            }

            // All other errors
            tracing::error!(error=?err, "unable to create document with specified ID");
            Err(anyhow::anyhow!(
                "unable to create document with specified ID: {}",
                err
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_document_no_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        sqlx::query!(
            r#"INSERT INTO "Project" ("id", "name", "userId") VALUES ($1, $2, $3)"#,
            "project-one",
            "name",
            "macro|user@user.com"
        )
        .execute(&pool)
        .await?;

        // document exists
        let document_metadata = create_document(
            &pool,
            CreateDocumentArgs {
                id: None,
                sha: "sha",
                document_name: "document-name",
                user_id: "macro|user@user.com",
                file_type: Some(FileType::Pdf),
                project_id: Some("project-one"),
                project_name: None,
                share_permission: &SharePermissionV2::default(),
                skip_history: false,
                created_at: None,
            },
        )
        .await?;

        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(document_metadata.document_name, "document-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        assert_eq!(document_metadata.project_id.as_deref(), Some("project-one"));
        assert_eq!(document_metadata.project_name.as_deref(), Some("name"));

        // document exists
        let document_metadata = create_document(
            &pool,
            CreateDocumentArgs {
                id: None,
                sha: "sha",
                document_name: "document-name",
                user_id: "macro|user@user.com",
                file_type: Some(FileType::Docx),
                project_id: None,
                project_name: None,
                share_permission: &SharePermissionV2::default(),
                skip_history: false,
                created_at: None,
            },
        )
        .await?;

        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(document_metadata.document_name, "document-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_document_with_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        sqlx::query!(
            r#"INSERT INTO "Project" ("id", "name", "userId") VALUES ($1, $2, $3)"#,
            "project-one",
            "name",
            "macro|user@user.com"
        )
        .execute(&pool)
        .await?;

        // document exists
        let document_metadata = create_document(
            &pool,
            CreateDocumentArgs {
                id: Some("20f603c2-99db-aaaa-0000-1d8b9f95a52f"),
                sha: "sha",
                document_name: "document-name",
                user_id: "macro|user@user.com",
                file_type: Some(FileType::Pdf),
                project_id: Some("project-one"),
                project_name: None,
                share_permission: &SharePermissionV2::default(),
                skip_history: false,
                created_at: None,
            },
        )
        .await?;

        assert_eq!(
            document_metadata.document_id,
            "20f603c2-99db-aaaa-0000-1d8b9f95a52f"
        );
        assert_eq!(document_metadata.document_name, "document-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        assert_eq!(document_metadata.project_id.as_deref(), Some("project-one"));
        assert_eq!(document_metadata.project_name.as_deref(), Some("name"));

        // document exists
        let document_metadata = create_document(
            &pool,
            CreateDocumentArgs {
                id: Some("20f603c2-99db-4f02-aaaa-1d8b9f95a52f"),
                sha: "sha",
                document_name: "document-name",
                user_id: "macro|user@user.com",
                file_type: Some(FileType::Docx),
                project_id: None,
                project_name: None,
                share_permission: &SharePermissionV2::default(),
                skip_history: false,
                created_at: None,
            },
        )
        .await?;

        assert_eq!(
            document_metadata.document_id,
            "20f603c2-99db-4f02-aaaa-1d8b9f95a52f"
        );
        assert_eq!(document_metadata.document_name, "document-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());

        Ok(())
    }
    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_document_no_user(pool: Pool<Postgres>) {
        // document exists
        let document_metadata = create_document(
            &pool,
            CreateDocumentArgs {
                id: None,
                sha: "sha",
                document_name: "document-name",
                user_id: "macro|non-existent-user@fake.com",
                file_type: Some(FileType::Pdf),
                project_id: None,
                project_name: None,
                share_permission: &SharePermissionV2::default(),
                skip_history: false,
                created_at: None,
            },
        )
        .await;

        assert!(document_metadata.is_err());
        assert_eq!(
            document_metadata.err().unwrap().to_string(),
            "unable to create document: error returned from database: insert or update on table \"Document\" violates foreign key constraint \"Document_owner_fkey\"".to_string()
        );
    }

    // should return appropriate error if we try to insert a document with a duplicate ID
    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_insert_document_with_duplicate_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let test_id = "duplicate-document-id";
        let user_id = "macro|user@user.com";

        // First, create a document with the test ID
        let mut transaction = pool.begin().await?;

        // Insert the first document
        insert_document_with_id(
            &mut transaction,
            test_id,
            user_id,
            "First Document",
            Some(FileType::Pdf),
            None,
            None,
        )
        .await?;

        transaction.commit().await?;

        // Now try to insert another document with the same ID
        let mut transaction = pool.begin().await?;

        let result = insert_document_with_id(
            &mut transaction,
            test_id,
            user_id,
            "Second Document with Same ID",
            Some(FileType::Pdf),
            None,
            None,
        )
        .await;

        // Don't commit the transaction since we expect it to fail

        // Check that the function returned an error
        assert!(result.is_err());

        // Check that the error message contains our expected text about duplicate ID
        let error_message = result.unwrap_err().to_string();
        assert!(
            error_message.contains("document with ID already exists"),
            "Error message '{}' does not contain expected text about duplicate ID",
            error_message
        );

        // Verify that only one document with this ID exists in the database
        let count = sqlx::query!(
            r#"SELECT COUNT(*) as "count!" FROM "Document" WHERE id = $1"#,
            test_id
        )
        .fetch_one(&pool)
        .await?
        .count;

        assert_eq!(
            count, 1,
            "There should be exactly one document with ID '{}'",
            test_id
        );

        Ok(())
    }
}
