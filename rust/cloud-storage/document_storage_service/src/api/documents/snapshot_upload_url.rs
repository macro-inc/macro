use crate::api::context::ApiContext;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use s3_key::SYNC_SERVICE_SNAPSHOT_PREFIX;
use serde::Serialize;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[derive(Serialize)]
pub struct SnapshotUploadUrlResponse {
    pub url: String,
}

/// Returns a presigned S3 PUT URL the sync service can use to upload a Loro snapshot.
/// The snapshot is stored at `sync_service_snapshot/{document_id}` in the document storage bucket.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    let key = format!("{SYNC_SERVICE_SNAPSHOT_PREFIX}/{document_id}");
    match ctx.s3_client.put_snapshot_presigned_url(&key).await {
        Ok(url) => (StatusCode::OK, Json(SnapshotUploadUrlResponse { url })).into_response(),
        Err(e) => {
            tracing::error!(error=?e, document_id=document_id, "failed to generate snapshot upload url");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
