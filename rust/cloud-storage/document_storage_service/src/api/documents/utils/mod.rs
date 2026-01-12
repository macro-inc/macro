use std::sync::Arc;

use sqlx::{PgPool, Pool, Postgres};
use tracing::instrument;

use crate::service::s3::S3;

/// Deletes the document
/// This is to only be used if document creation fails
/// Normal document deletion is a "soft delete"
#[instrument(skip(db))]
pub(in crate::api::documents) async fn handle_document_creation_error_cleanup(
    db: &PgPool,
    document_id: String,
) {
    // Delete from db
    let _ = macro_db_client::document::delete_document(db, &document_id)
        .await
        .map_err(|e| tracing::error!(error=?e, "failed to delete document"));
}

/// Deletes the document from s3
#[instrument(skip(s3_client))]
pub(in crate::api::documents) async fn delete_document_s3(
    s3_client: Arc<S3>,
    owner: &str,
    document_id: &str,
) {
    // Delete from s3
    if let Err(e) = s3_client.delete_document(owner, document_id).await {
        tracing::error!(error=?e,"unable to delete document from s3");
    }
}

/// Deletes a given document version if there was an error saving it
#[instrument(skip(db))]
pub(in crate::api::documents) async fn cleanup_document_version_on_error(
    db: &Pool<Postgres>,
    document_id: &str,
    document_version_id: i64,
    file_type: &str,
) {
    tracing::trace!("deleting document version");
    let _ = macro_db_client::document::delete_document_version(
        db,
        document_id,
        document_version_id,
        file_type,
    )
    .await
    .map_err(|e| tracing::error!(error=?e, "unable to delete document version"));
}
