use sqlx::{Pool, Postgres};
use tracing::instrument;

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
