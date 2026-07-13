use anyhow::Result;
use axum::extract::{Json, State};
use axum::{extract, http::StatusCode};
use model::chat::preview::{ChatPreview, ChatPreviewData, ChatPreviewV2, WithChatId};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashSet;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetBatchPreviewRequest {
    pub chat_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetBatchPreviewResponse {
    pub previews: Vec<ChatPreview>,
}

#[utoipa::path(
        post,
        path = "/preview",
        operation_id = "get_batch_preview",
        responses(
            (status = 200, body=GetBatchPreviewResponse),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db))]
pub async fn handler(
    State(db): State<PgPool>,
    req: extract::Json<GetBatchPreviewRequest>,
) -> Result<(StatusCode, Json<GetBatchPreviewResponse>), (StatusCode, String)> {
    // Ensure the document ids are unique to prevent duplicate work
    let unique_chat_ids: HashSet<String> = req.chat_ids.iter().cloned().collect();
    let chat_ids: Vec<String> = unique_chat_ids.into_iter().collect();

    let chat_preview_results =
        macro_db_client::chat::preview::batch_get_document_preview_v2(&db, &chat_ids)
            .await
            .map_err(|e| {
                tracing::error!(error = %e,  "unable to get batch preview");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to get chat previews".to_string(),
                )
            })?;

    let result: Vec<ChatPreview> = chat_preview_results
        .iter()
        .map(|preview| match preview {
            ChatPreviewV2::DoesNotExist(preview_data) => ChatPreview::DoesNotExist(WithChatId {
                chat_id: preview_data.chat_id.clone(),
            }),
            ChatPreviewV2::Found(preview_data) => ChatPreview::Access(ChatPreviewData {
                chat_id: preview_data.chat_id.clone(),
                chat_name: preview_data.chat_name.clone(),
                owner: preview_data.owner.clone(),
                updated_at: preview_data.updated_at,
            }),
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(GetBatchPreviewResponse { previews: result }),
    ))
}
