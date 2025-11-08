use crate::service::s3::S3;
use sqlx::{Pool, Postgres};
use std::sync::Arc;

/// spawns a thread to cleanup the copy document resources in the background
#[tracing::instrument(skip(db))]
pub(in crate::api::documents::copy_document) async fn copy_document_cleanup(
    db: &Pool<Postgres>,
    s3_client: &Arc<S3>,
    user_id: String,
    document_id: String,
) {
    // Delete from db
    let _ = macro_db_client::document::delete_document(db, &document_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to delete document"));

    let _ = s3_client
        .delete_document(&user_id, document_id.as_str())
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to delete document from s3"));
}
