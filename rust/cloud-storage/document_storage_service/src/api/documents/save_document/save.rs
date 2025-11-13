use anyhow::Context;
use axum::http::StatusCode;
use macro_redis_cluster_client::Redis;
use sqlx::{Pool, Postgres};
use tracing::instrument;

use crate::{model::request::documents::save::SaveDocumentRequest, service};
use model::document::response::DocumentResponseMetadata;
use model::document::{DocumentBasic, DocumentMetadata, FileType};

/// Saves a document to the database and updates all other necessary items with the new document
/// In the event of an error, returns status code, error message and optional document id/document
/// version id pair.
/// **note** If document id is present we need to handle cleanup
#[instrument(
    skip(db, redis_client, s3_client, document_context, save_document_request),
    fields(document_name=%document_context.document_name,owner=%document_context.owner,file_type=%file_type)
)]
#[expect(clippy::type_complexity, reason = "too annoying to fix now")]
pub async fn save_document(
    db: &Pool<Postgres>,
    redis_client: &Redis,
    s3_client: &service::s3::S3,
    document_id: &str,
    file_type: FileType,
    document_context: &DocumentBasic,
    save_document_request: SaveDocumentRequest,
) -> Result<DocumentResponseMetadata, (StatusCode, String, Option<(String, i64)>)> {
    tracing::trace!("saving document");

    let document_metadata: DocumentMetadata = match macro_db_client::document::save_document(
        db,
        document_id,
        file_type,
        save_document_request.sha.as_deref(),
        save_document_request.modification_data,
        save_document_request.new_bom.clone(),
    )
    .await
    {
        Ok(document_metadata) => document_metadata,
        Err(e) => {
            tracing::error!(error=?e, "unable to save document");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to save document".to_string(),
                None,
            ));
        }
    };

    // Insert the new document mapping for docx documents
    if file_type == FileType::Docx {
        let new_bom = save_document_request
            .new_bom
            .context("new boms should be present when saving a docx")
            .map_err(|e| {
                tracing::error!(error=?e, "new boms should be present when saving a docx");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to verify document parts exist".to_string(),
                    Some((
                        document_metadata.document_id.clone(),
                        document_metadata.document_version_id,
                    )),
                )
            })?;
        let shas = new_bom
            .iter()
            .map(|b| b.sha.clone())
            .collect::<Vec<String>>();

        // Verify all shas are present in the s3 bucket
        let exists = s3_client.shas_exist(&shas).await.map_err(|e| {
            tracing::error!(error=?e, "unable to verify document parts exist");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to verify document parts exist".to_string(),
                Some((
                    document_metadata.document_id.clone(),
                    document_metadata.document_version_id,
                )),
            )
        })?;

        if !exists {
            tracing::error!("not all shas are present in s3 bucket");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "not all shas are present in s3 bucket".to_string(),
                Some((
                    document_metadata.document_id.clone(),
                    document_metadata.document_version_id,
                )),
            ));
        }

        // Incr the SHA ref count using the new_bom
        if let Err(e) = redis_client.increment_counts(shas).await {
            // We don't actually care if this fails, the sha counts being messed
            // up is not the end of the world.
            tracing::error!(error=?e, "unable to increment sha ref count");
        }
    }

    let document_response_metadata = match DocumentResponseMetadata::from_document_metadata(
        &document_metadata,
    ) {
        Ok(document_response_metadata) => document_response_metadata,
        Err(e) => {
            tracing::error!(error=?e, "unable to convert document metadata. this should never happen");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to convert document metadata".to_string(),
                Some((
                    document_metadata.document_id,
                    document_metadata.document_version_id,
                )),
            ));
        }
    };

    Ok(document_response_metadata)
}
