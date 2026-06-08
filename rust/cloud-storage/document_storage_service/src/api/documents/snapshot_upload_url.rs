use crate::api::context::ApiContext;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use s3_key::SYNC_SERVICE_SNAPSHOT_PREFIX;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Accepts raw snapshot bytes from the sync service and stores them in S3.
#[tracing::instrument(skip(ctx, body))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(Params { document_id }): Path<Params>,
    body: Bytes,
) -> impl IntoResponse {
    let key = format!("{SYNC_SERVICE_SNAPSHOT_PREFIX}/{document_id}");
    match ctx.s3_client.upload_document(&key, body.to_vec()).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => {
            tracing::error!(error=?e, document_id=document_id, "failed to upload snapshot");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
