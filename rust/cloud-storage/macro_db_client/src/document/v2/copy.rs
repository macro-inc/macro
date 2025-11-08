use crate::{
    document::copy_document::{copy_docx_document, copy_non_docx_document},
    share_permission::create::create_document_permission,
};
use model::document::{DocumentMetadata, FileType};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres};

/// Copies a given document
#[tracing::instrument(skip(db))]
pub async fn copy_document(
    db: &Pool<Postgres>,
    original_document: &DocumentMetadata,
    user_id: &str,
    new_document_name: &str,
    file_type: Option<&FileType>,
    document_share_permissions: &SharePermissionV2,
) -> anyhow::Result<DocumentMetadata> {
    let mut transaction = db.begin().await?;
    let document = match file_type {
        Some(FileType::Docx) => {
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

    crate::item_access::insert::insert_user_item_access(
        &mut transaction,
        user_id,
        document.document_id.as_str(),
        "document",
        AccessLevel::Owner,
        None,
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

#[cfg(test)]
mod tests {
    use models_permissions::share_permission::access_level::AccessLevel;

    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_copy_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_metadata = copy_document(
            &pool,
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
            Some(&FileType::Docx),
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
}
