use std::collections::HashSet;

use crate::api::context::ApiContext;
use crate::model::{
    request::documents::preview::GetBatchPreviewRequest,
    response::documents::preview::GetBatchPreviewResponse,
};
use anyhow::Result;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::{Extension, extract::Json};
use model::document::{DocumentPreview, DocumentPreviewData, DocumentPreviewV2, WithDocumentId};
use model::response::{GenericErrorResponse, GenericResponse};
use model::user::UserContext;
use reqwest::StatusCode;

#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=?user_context.user_id))]
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/preview",
    responses(
        (status = 200, body=GetBatchPreviewResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 404, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
pub async fn get_batch_preview_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<GetBatchPreviewRequest>,
) -> Result<(StatusCode, Json<GetBatchPreviewResponse>), Response> {
    // Ensure the document ids are unique to prevent duplicate work
    let unique_document_ids: HashSet<String> = req.document_ids.iter().cloned().collect();
    let document_ids: Vec<String> = unique_document_ids.into_iter().collect();

    let document_preview_results =
        macro_db_client::document::preview::batch_get_document_preview_v2(&ctx.db, &document_ids)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "unable to get document preview");
                GenericResponse::builder()
                    .message("failed to retrive document previews")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR)
                    .into_response()
            })?;

    let result: Vec<DocumentPreview> = document_preview_results
        .iter()
        .map(|d| match d {
            DocumentPreviewV2::Found(preview_data) => {
                DocumentPreview::Access(DocumentPreviewData {
                    document_id: preview_data.document_id.clone(),
                    document_name: preview_data.document_name.clone(),
                    file_type: preview_data.file_type.clone(),
                    owner: preview_data.owner.clone(),
                    updated_at: preview_data.updated_at,
                })
            }
            DocumentPreviewV2::DoesNotExist(preview_data) => {
                DocumentPreview::DoesNotExist(WithDocumentId {
                    document_id: preview_data.document_id.clone(),
                })
            }
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(GetBatchPreviewResponse { previews: result }),
    ))
}
