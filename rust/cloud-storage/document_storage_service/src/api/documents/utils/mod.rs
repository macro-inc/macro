use sqlx::{PgPool, Pool, Postgres};
use tracing::instrument;

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
