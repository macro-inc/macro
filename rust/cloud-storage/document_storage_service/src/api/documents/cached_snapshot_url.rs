use crate::api::context::ApiContext;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use s3_key::SYNC_SERVICE_SNAPSHOT_PREFIX;
use serde::Serialize;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[derive(Serialize)]
pub struct CachedSnapshotUrlResponse {
    pub url: String,
}

/// Returns a presigned S3 GET URL for the cached Loro snapshot, or 404 if none exists.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    let key = format!("{SYNC_SERVICE_SNAPSHOT_PREFIX}/{document_id}");

    match ctx.s3_client.exists(&key).await {
        Ok(false) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!(error=?e, document_id=document_id, "failed to check snapshot existence");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        Ok(true) => {}
    }

    match ctx.s3_client.get_snapshot_presigned_url(&key).await {
        Ok(url) => (StatusCode::OK, Json(CachedSnapshotUrlResponse { url })).into_response(),
        Err(e) => {
            tracing::error!(error=?e, document_id=document_id, "failed to generate snapshot download url");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
