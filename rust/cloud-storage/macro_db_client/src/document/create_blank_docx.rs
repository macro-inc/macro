use model::document::FileType;
use model::document::SaveBomPart;
use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Pool, Postgres};

use crate::document::insert_bom_parts;
use crate::history::upsert_item_last_accessed;
use crate::history::upsert_user_history;
use crate::share_permission::create::create_document_permission;
use model::document::DocumentMetadata;
use model::document::ID;
use model::document::VersionID;
use model::document::VersionIDWithTimeStamps;
use tracing::instrument;

/// Creates a blank docx document
#[instrument(skip(db))]
pub async fn create_blank_docx(
    db: Pool<Postgres>,
    document_name: &str,
    user_id: &str,
    project_id: Option<&str>,
    share_permission: &SharePermissionV2,
    bom_parts: Vec<SaveBomPart>,
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
            INSERT INTO "Document" (owner, name, "fileType", "projectId")
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        "#,
        user_id,
        document_name,
        "docx", // hard coded file type as it's create blank docx
        project_id,
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to create document");
        err
    })?;

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

    sqlx::query!(
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

    // Docx documents have their versions associated with a DocumentBom
    // whereas all other file types use DocumentInstance
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

    let document_version = VersionIDWithTimeStamps {
        id: document_bom.id,
        created_at: document_bom.created_at,
        updated_at: document_bom.updated_at,
        sha: "".to_string(), // sha is not used for docx
    };

    create_document_permission(&mut transaction, document.id.as_str(), share_permission).await?;

    let document_bom_parts = insert_bom_parts(
        &mut transaction,
        document.id.as_str(),
        document_version.id,
        bom_parts,
    )
    .await?;

    // Add item to user history for creator
    upsert_user_history(&mut transaction, user_id, &document.id, "document").await?;
    upsert_item_last_accessed(&mut transaction, &document.id, "document").await?;

    if let Err(err) = transaction.commit().await {
        tracing::error!(
            error=?err,
            document_id=?document.id,
            "transaction error",
        );
        return Err(anyhow::Error::msg("unable to create blank docx document"));
    }

    let parts_json: serde_json::Value = serde_json::to_value(document_bom_parts)?;

    Ok(DocumentMetadata {
        document_id: document.id,
        document_version_id: document_version.id,
        owner: user_id.to_string(),
        document_name: document_name.to_string(),
        file_type: Some(FileType::Docx.as_str().to_string()),
        sha: None,
        project_id: project_id.map(|s| s.to_string()),
        project_name,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: Some(document_family.id),
        document_bom: Some(parts_json),
        modification_data: None,
        created_at: document_version.created_at,
        updated_at: document_version.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_create_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // document
        let document_metadata = create_blank_docx(
            pool.clone(),
            "document-name",
            "macro|user@user.com",
            None,
            &SharePermissionV2::default(),
            vec![SaveBomPart {
                sha: "sha".to_string(),
                path: "path".to_string(),
            }],
        )
        .await?;

        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(document_metadata.document_name, "document-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());

        Ok(())
    }
}
