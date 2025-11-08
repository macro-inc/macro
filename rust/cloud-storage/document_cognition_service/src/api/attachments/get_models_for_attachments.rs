use crate::{
    api::context::ApiContext,
    core::constants::{DEFAULT_CHANNEL_TOKENS, DEFAULT_EMAIL_TOKENS, DEFAULT_IMAGE_TOKENS},
    core::model::CHAT_MODELS,
    model::request::chats::NewAttachment,
    service::attachment::document::get_document_token_count,
};

use ai::{model_selection::select_model, types::Model};
use anyhow::Result;
use axum::{Extension, Json, extract::State, http::StatusCode, response::IntoResponse};
use macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2;
use model::chat::AttachmentType;
use model::user::UserContext;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct GetModelsForAttachmentsResponse {
    pub available_models: Vec<Model>,
    pub new_model: Option<Model>,
}

#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct GetModelsForAttachmentsRequest {
    pub attachments: Vec<NewAttachment>,
    pub active_model: Option<Model>,
}

#[utoipa::path(
        post,
        path = "/attachments/get_models_for_attachments",
        responses(
            (status = 200, body=GetModelsForAttachmentsResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
    )]
#[tracing::instrument(err(Debug), skip(state, user_context))]
pub async fn get_models_for_attachments_handler(
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    req: Json<GetModelsForAttachmentsRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut attachment_tokens = 0;
    for attachment in &req.attachments {
        if attachment.attachment_type == AttachmentType::Document {
            get_users_access_level_v2(
                &state.db,
                &state.comms_service_client,
                &user_context.user_id,
                &attachment.attachment_id,
                "document",
            )
            .await
            .map_err(|err| {
                tracing::error!(error = ?err, user_id = %user_context.user_id, attachment_id = %attachment.attachment_id, attachment_type = "document", "failed to check document access level");
                err
            })?
            .ok_or_else(|| (StatusCode::UNAUTHORIZED, "permission".to_string()))?;
        } else if attachment.attachment_type == AttachmentType::Channel {
            get_users_access_level_v2(
                &state.db,
                &state.comms_service_client,
                &user_context.user_id,
                &attachment.attachment_id,
                "channel",
            )
            .await
            .map_err(|err| {
                tracing::error!(error = ?err, user_id = %user_context.user_id, attachment_id = %attachment.attachment_id, attachment_type = "channel", "failed to check channel access level");
                err
            })?
            .ok_or_else(|| (StatusCode::UNAUTHORIZED, "permission".to_string()))?;
        }
    }

    for attachment in &req.attachments {
        let token_count =
        match attachment.attachment_type {
            AttachmentType::Document => {
                get_document_token_count(&state, attachment.attachment_id.as_str())
                    .await
                    .map_err(|err: anyhow::Error| {
                        tracing::error!(error = %err, attachment_id = %attachment.attachment_id, "failed to get document token count");
                        (StatusCode::NOT_FOUND, "could not find data for attachment id".to_string())
                    })?
            }
            AttachmentType::Image => {
                DEFAULT_IMAGE_TOKENS
            }
            AttachmentType::Channel => {
                DEFAULT_CHANNEL_TOKENS
            }
            AttachmentType::Email => {
                DEFAULT_EMAIL_TOKENS
            }
    };
        attachment_tokens += token_count;
    }
    let models =
        select_model(req.active_model, attachment_tokens, CHAT_MODELS.to_vec()).map_err(|err| {
            tracing::error!(error = %err, attachment_tokens = attachment_tokens, "failed to select model");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error".to_string(),
            )
        })?;
    Ok(Json::<GetModelsForAttachmentsResponse>(
        GetModelsForAttachmentsResponse {
            available_models: models.available_models,
            new_model: models.new_model,
        },
    ))
}
