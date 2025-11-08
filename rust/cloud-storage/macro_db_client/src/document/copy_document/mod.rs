use crate::{
    document::document_bom::create_bom_parts, share_permission::create::create_document_permission,
};
use model::document::{
    BomPart, DocumentMetadata, FileType, IDWithTimeStamps, VersionIDWithTimeStamps,
    VersionIDWithTimeStampsNoSha,
};
use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Pool, Postgres, Transaction};

pub mod copy_pdf_parts;

/// Copies a given document
#[tracing::instrument(skip(db))]
pub async fn copy_document(
    db: Pool<Postgres>,
    original_document: &DocumentMetadata,
    user_id: &str,
    new_document_name: &str,
    file_type: &FileType,
    document_share_permissions: &SharePermissionV2,
) -> anyhow::Result<DocumentMetadata> {
    let mut transaction = db.begin().await?;
    let document = match file_type {
        FileType::Docx => {
            copy_docx_document(
                &mut transaction,
                original_document,
                user_id,
                new_document_name,
            )
            .await
        }
        _ => {
            copy_non_docx_document(
                &mut transaction,
                original_document,
                user_id,
                new_document_name,
            )
            .await
        }
    }?;

    // Create documet permissions
    let _ = create_document_permission(
        &mut transaction,
        document.document_id.as_str(),
        document_share_permissions,
    )
    .await?;

    if let Err(transaction_err) = transaction.commit().await {
        tracing::error!(
            error=?transaction_err,
            "copy_document transaction error",
        );
        return Err(transaction_err.into());
    }

    Ok(document)
}

/// Copies a given docx document
#[tracing::instrument(skip(transaction))]
pub(in crate::document) async fn copy_docx_document(
    transaction: &mut Transaction<'_, Postgres>,
    original_document: &DocumentMetadata,
    user_id: &str,
    new_document_name: &str,
) -> anyhow::Result<DocumentMetadata> {
    let original_document_id = &original_document.document_id;
    let original_document_version_id = original_document.document_version_id;
    // Create document
    let document = sqlx::query_as!(
        IDWithTimeStamps,
        r#"
                INSERT INTO "Document" (owner, name, "fileType", "documentFamilyId", "branchedFromId", "branchedFromVersionId", "projectId")
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
        &user_id,
        &new_document_name,
        original_document.file_type,
        original_document.document_family_id,
        &original_document_id,
        &original_document_version_id,
        original_document.project_id,
    )
    .fetch_one(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to copy document");
        let no_user_found = "error returned from database: insert or update on table \"Document\" violates foreign key constraint \"Document_owner_fkey\"";
        let err_string = err.to_string();
        if err_string.contains(no_user_found) {
                return anyhow::Error::msg("no user found");
        }
        anyhow::Error::msg("unable to copy document")
    })?;

    // Create document bom id
    let document_bom = sqlx::query_as!(
        VersionIDWithTimeStampsNoSha,
        r#"
                INSERT INTO "DocumentBom" ("documentId")
                VALUES ($1)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
        &document.id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    // Create document bom
    // We error out in the copy_document_handler if the document bom is missing
    let document_bom_parts: Vec<BomPart> =
        serde_json::from_value(original_document.document_bom.as_ref().unwrap().clone())?;

    let saved_bom_parts: Vec<BomPart> = create_bom_parts(
        transaction,
        document_bom.id,
        document_bom_parts.into_iter().map(|b| b.into()).collect(),
    )
    .await?;

    let saved_bom_parts = serde_json::to_value(saved_bom_parts)?;

    Ok(DocumentMetadata {
        document_id: document.id.clone(),
        owner: user_id.to_string(),
        document_name: new_document_name.to_string(),
        file_type: original_document.file_type.clone(),
        sha: None,
        modification_data: None,
        branched_from_id: Some(original_document_id.to_string()),
        branched_from_version_id: Some(original_document_version_id),
        document_family_id: original_document.document_family_id,
        project_id: original_document.project_id.clone(),
        project_name: original_document.project_name.clone(),
        document_version_id: document_bom.id,
        document_bom: Some(saved_bom_parts),
        created_at: document.created_at,
        updated_at: document.updated_at,
    })
}

/// Copies a given non-docx document
#[tracing::instrument(skip(transaction))]
pub(in crate::document) async fn copy_non_docx_document(
    transaction: &mut Transaction<'_, Postgres>,
    original_document: &DocumentMetadata,
    user_id: &str,
    new_document_name: &str,
) -> anyhow::Result<DocumentMetadata> {
    let original_document_id = &original_document.document_id;
    let original_document_version_id = original_document.document_version_id;
    let sha = match &original_document.sha {
        Some(sha) => sha.as_str(),
        None => {
            tracing::error!("unable to copy pdf document, sha is missing");
            return Err(anyhow::Error::msg("unable to copy document"));
        }
    };

    // Create document
    let document = sqlx::query_as!(
        IDWithTimeStamps,
        r#"
                INSERT INTO "Document" (owner, name, "fileType", "documentFamilyId", "branchedFromId", "branchedFromVersionId", "projectId")
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
        &user_id,
        &new_document_name,
        original_document.file_type,
        original_document.document_family_id,
        &original_document_id,
        &original_document_version_id,
        original_document.project_id,
    )
    .fetch_one(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to copy document");
        let no_user_found = "error returned from database: insert or update on table \"Document\" violates foreign key constraint \"Document_owner_fkey\"";
        let err_string = err.to_string();
        if err_string.contains(no_user_found) {
                return anyhow::Error::msg("no user found");
        }
        anyhow::Error::msg("unable to copy document")
    })?;

    // Create document bom id
    let document_instance = sqlx::query_as!(
        VersionIDWithTimeStamps,
        r#"
                INSERT INTO "DocumentInstance" ("documentId", "sha")
                VALUES ($1, $2)
                RETURNING id, sha, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
        &document.id,
        sha,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    let original_document_modification = sqlx::query!(
        r#"
            SELECT "modificationData" as modification_data
            FROM "DocumentInstanceModificationData"
            WHERE "documentInstanceId" = $1
        "#,
        original_document_version_id
    )
    .fetch_optional(transaction.as_mut())
    .await?;

    let original_modification_data = if let Some(original_document_modification) =
        original_document_modification
    {
        sqlx::query!(
            r#"
            INSERT INTO "DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
            VALUES ($1, $2);
        "#,
            document_instance.id,
            original_document_modification.modification_data
        ).execute(transaction.as_mut()).await?;

        Some(original_document_modification.modification_data)
    } else {
        None
    };

    Ok(DocumentMetadata {
        document_id: document.id.clone(),
        owner: user_id.to_string(),
        document_name: new_document_name.to_string(),
        file_type: original_document.file_type.clone(),
        sha: Some(document_instance.sha),
        branched_from_id: Some(original_document_id.to_string()),
        branched_from_version_id: Some(original_document_version_id),
        document_family_id: original_document.document_family_id,
        document_version_id: document_instance.id,
        document_bom: None,
        project_id: original_document.project_id.clone(),
        project_name: original_document.project_name.clone(),
        modification_data: original_modification_data,
        created_at: document.created_at,
        updated_at: document.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_copy_non_docx_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await.unwrap();
        let document_metadata = copy_non_docx_document(
            &mut transaction,
            &DocumentMetadata::new_document(
                "document-one",
                1,
                "macro|user@user.com",
                "name",
                Some(FileType::Txt),
                "sha",
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            "macro|user@user.com",
            "new name",
        )
        .await?;

        if let Err(e) = transaction.commit().await {
            return Err(e.into());
        }

        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(document_metadata.sha.unwrap(), "sha");
        assert_eq!(document_metadata.document_name, "new name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        assert_eq!(document_metadata.branched_from_id.unwrap(), "document-one");
        assert_eq!(document_metadata.branched_from_version_id.unwrap(), 1);
        assert_eq!(
            document_metadata.modification_data.unwrap().to_string(),
            "{\"testing\":true}"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_copy_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_metadata = copy_document(
            pool.clone(),
            &DocumentMetadata::new_docx(
                "document-one",
                1,
                "macro|user@user.com",
                "name",
                "docx",
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            "macro|user@user.com",
            "new name",
            &FileType::Docx,
            &SharePermissionV2::new(Some(true), Some(AccessLevel::View)),
        )
        .await?;

        assert!(!document_metadata.document_id.is_empty());
        assert!(document_metadata.sha.is_none());
        assert_eq!(document_metadata.document_name, "new name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        assert_eq!(document_metadata.branched_from_id.unwrap(), "document-one");
        assert_eq!(document_metadata.branched_from_version_id.unwrap(), 1);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_copy_docx_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await.unwrap();
        let document_metadata = copy_docx_document(
            &mut transaction,
            &DocumentMetadata::new_docx(
                "document-one",
                1,
                "macro|user@user.com",
                "name",
                "docx",
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            "macro|user@user.com",
            "new name",
        )
        .await?;

        if let Err(e) = transaction.commit().await {
            return Err(e.into());
        }

        assert!(!document_metadata.document_id.is_empty());
        assert!(document_metadata.sha.is_none());
        assert_eq!(document_metadata.document_name, "new name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        assert_eq!(document_metadata.branched_from_id.unwrap(), "document-one");
        assert_eq!(document_metadata.branched_from_version_id.unwrap(), 1);

        Ok(())
    }
}
