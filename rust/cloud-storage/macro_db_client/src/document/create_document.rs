use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Pool, Postgres};

use crate::history::upsert_item_last_accessed;
use crate::history::upsert_user_history;
use crate::share_permission::create::create_document_permission;
use model::document::DocumentMetadata;
use model::document::FileType;
use model::document::ID;
use model::document::VersionID;
use model::document::VersionIDWithTimeStamps;
use tracing::instrument;

/// Creates a new document
/// This includes a document, document instance, share permission, document
/// permission and document family.
#[instrument(skip(db))]
#[expect(clippy::too_many_arguments, reason = "too annoying to fix right now")]
pub async fn create_document(
    db: Pool<Postgres>,
    sha: &str,
    document_name: &str,
    user_id: &str,
    file_type: Option<FileType>,
    document_family_id: Option<i64>,
    branched_from_id: Option<&str>,
    branched_from_version_id: Option<i64>,
    project_id: Option<&str>,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<DocumentMetadata> {
    tracing::trace!("creating document");
    let mut transaction = db.begin().await?;

    // Get project name if the project id exists
    let project_name = if let Some(project_id) = project_id {
        let project = sqlx::query!(
            r#"
                SELECT name FROM "Project" WHERE id = $1
            "#,
            project_id,
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, project_id=%project_id, "unable to get project");
            err
        })?;

        Some(project.name)
    } else {
        None
    };

    let document = sqlx::query_as!(
        ID,
        r#"
            INSERT INTO "Document" (owner, name, "fileType", "documentFamilyId", "branchedFromId", "branchedFromVersionId", "projectId")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id;
        "#,
        user_id,
        document_name,
        file_type.map(|file_type| file_type.clone().as_str().to_string()),
        document_family_id,
        branched_from_id,
        branched_from_version_id,
        project_id,
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to create document");
        err
    })?;

    let updated_document_family_id = match document_family_id {
        Some(document_family_id) => document_family_id,
        None => {
            let document_family = sqlx::query_as!(
                VersionID,
                r#"
                INSERT INTO "DocumentFamily" ("rootDocumentId")
                VALUES ($1)
                RETURNING id;
                "#,
                &document.id,
            )
            .fetch_one(&mut *transaction)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, document_id=?document.id, "unable to create document family");
                anyhow::Error::msg("unable to create document family")
            })?;

            let _ = sqlx::query!(
                r#"
                UPDATE "Document" SET "documentFamilyId" = $1 WHERE id = $2;
                "#,
                document_family.id,
                document.id
            )
            .execute(&mut *transaction)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, document_id=?document.id, "unable to update document family for document");
                anyhow::Error::msg("unable to update document family")
            })?;
            document_family.id
        }
    };

    // Docx documents have their versions associated with a DocumentBom
    // whereas all other file types use DocumentInstance
    let document_version = match file_type {
        Some(FileType::Docx) => {
            let document_bom = sqlx::query!(
            r#"
                INSERT INTO "DocumentBom" ("documentId")
                VALUES ($1)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
            &document.id,
            )
            .fetch_one(&mut *transaction)
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
                    INSERT INTO "DocumentInstance" ("documentId", "sha")
                    VALUES ($1, $2)
                    RETURNING id, sha, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
                "#,
            &document.id,
            sha,
        )
        .fetch_one(&mut *transaction)
        .await?
        }
    };

    create_document_permission(&mut transaction, &document.id, share_permission).await?;

    // Add item to user history for creator
    upsert_user_history(&mut transaction, user_id, &document.id, "document").await?;
    upsert_item_last_accessed(&mut transaction, &document.id, "document").await?;

    if let Err(err) = transaction.commit().await {
        tracing::error!(
            error=?err,
            document_id=?document.id,
            "transaction error",
        );
        return Err(anyhow::Error::msg("unable to create document"));
    }

    Ok(DocumentMetadata::new_document(
        &document.id,
        document_version.id,
        user_id,
        document_name,
        file_type,
        document_version.sha.as_str(),
        Some(updated_document_family_id),
        branched_from_id,
        branched_from_version_id,
        project_id,
        project_name.as_deref(),
        document_version.created_at,
        document_version.updated_at,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
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
            pool.clone(),
            "sha",
            "document-name",
            "macro|user@user.com",
            Some(FileType::Pdf),
            None,
            None,
            None,
            Some("project-one"),
            &SharePermissionV2::default(),
        )
        .await?;

        assert_eq!(document_metadata.document_id.is_empty(), false);
        assert_eq!(document_metadata.document_name, "document-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        assert_eq!(document_metadata.project_id.as_deref(), Some("project-one"));
        assert_eq!(document_metadata.project_name.as_deref(), Some("name"));

        // document exists
        let document_metadata = create_document(
            pool.clone(),
            "sha",
            "document-name",
            "macro|user@user.com",
            Some(FileType::Docx),
            None,
            None,
            None,
            None,
            &SharePermissionV2::default(),
        )
        .await?;

        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(document_metadata.document_name, "document-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());

        Ok(())
    }
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_document_no_user(pool: Pool<Postgres>) {
        // document exists
        let document_metadata = create_document(
            pool.clone(),
            "sha",
            "document-name",
            "macro|non-existent-user@fake.com",
            Some(FileType::Pdf),
            None,
            None,
            None,
            None,
            &SharePermissionV2::default(),
        )
        .await;

        assert_eq!(document_metadata.is_err(), true);
        assert_eq!(
            document_metadata.err().unwrap().to_string(),
            "error returned from database: insert or update on table \"Document\" violates foreign key constraint \"Document_owner_fkey\"".to_string()
        );
    }
}
