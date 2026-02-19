//! HTTP endpoint for simple completions with streaming responses.

use crate::api::context::ApiContext;
use crate::core::constants::DEFAULT_MAX_TOKENS;
use crate::model::stream::{ChatStream, GetSimpleCompletionStreamPayload};
use crate::service::attachment::document::get_document_plaintext_content;
use ai::chat_stream::get_chat_stream;
use ai::types::{ChatStreamCompletionResponse, MessageBuilder, Model, RequestBuilder};
use async_stream::stream;
use axum::Json;
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use macro_db_client::dcs::get_document;
use macro_db_client::dcs::get_document_text;
use model::user::UserContext;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
use stream::domain::{StreamId, StreamRepoExt};
use utoipa::ToSchema;

const SIMPLE_COMPLETION_DEFAULT_MODEL: Model = Model::Claude45Haiku;

/// Response for initiating a simple completion stream
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleCompletionResponse {
    /// The completion ID that will receive the response chunks
    pub completion_id: String,
}

/// Error response for simple completion endpoint
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleCompletionError {
    pub error: String,
    pub completion_id: Option<String>,
}

impl fmt::Display for SimpleCompletionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.error)
    }
}

impl IntoResponse for SimpleCompletionError {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::BAD_REQUEST, Json(self)).into_response()
    }
}

/// Start a simple completion stream.
///
/// This endpoint initiates a completion and streams the response via the stream service.
/// The client should subscribe to the completion_id stream via connection_gateway to receive chunks.
#[utoipa::path(
    post,
    path = "/stream/completion/simple",
    request_body = GetSimpleCompletionStreamPayload,
    responses(
        (status = 200, description = "Stream initiated successfully", body = SimpleCompletionResponse),
        (status = 400, description = "Bad request", body = SimpleCompletionError),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(state, user_context, payload), fields(completion_id=?payload.completion_id), err)]
pub async fn simple_completion(
    State(state): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
    Json(payload): Json<GetSimpleCompletionStreamPayload>,
) -> Result<Json<SimpleCompletionResponse>, SimpleCompletionError> {
    let ctx = Arc::new(state);
    let completion_id = payload.completion_id.clone();

    // Build system prompt with document content if provided
    let mut system_prompt: String = payload.prompt.clone();
    if let Some(document_ids) = &payload.content_document_ids {
        let db = &ctx.db;

        for document_id in document_ids.iter() {
            let document = get_document::get_document(db, document_id)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, document_id, "failed to get document metadata");
                    SimpleCompletionError {
                        error: format!("Failed to get document: {}", e),
                        completion_id: Some(completion_id.clone()),
                    }
                })?;

            let document_content =
                if ["pdf", "docx"].contains(&document.unwrap().file_type.as_str()) {
                    get_document_text::get_pdf_docx_document_text(db.clone(), document_id)
                        .await
                        .map_err(|e| {
                            tracing::error!(error = %e, document_id, "failed to get document text");
                            SimpleCompletionError {
                                error: format!("Failed to get document text: {}", e),
                                completion_id: Some(completion_id.clone()),
                            }
                        })?
                        .content
                } else {
                    get_document_plaintext_content(&ctx, document_id)
                    .await
                    .map_err(|e| {
                        tracing::error!(error = %e, document_id, "failed to get document content");
                        SimpleCompletionError {
                            error: format!("Failed to get document content: {}", e),
                            completion_id: Some(completion_id.clone()),
                        }
                    })?
                    .text_content()
                    .map_err(|e| {
                        tracing::error!(error = %e, document_id, "failed to extract text content");
                        SimpleCompletionError {
                            error: format!("Failed to extract text content: {}", e),
                            completion_id: Some(completion_id.clone()),
                        }
                    })?
                };

            if document_content
                .chars()
                .filter(|c| !c.is_whitespace())
                .count()
                > 0
            {
                system_prompt = format!(
                    "{}\n\nDocument Content:\n{}",
                    system_prompt, document_content
                );
            }
        }
    }

    // Create stream ID for publishing
    let durable_stream_id = StreamId {
        entity_type: EntityType::User,
        entity_id: user_context.user_id.clone(),
        stream_id: completion_id.clone(),
    };

    let model = payload.model.unwrap_or(SIMPLE_COMPLETION_DEFAULT_MODEL);
    let max_tokens = payload.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    let user_request = payload.user_request.clone();
    let completion_id_for_stream = completion_id.clone();

    // Create the payload stream that yields JSON values
    let payload_stream = stream! {
        let request = RequestBuilder::new()
            .model(model)
            .max_tokens(max_tokens)
            .messages(vec![
                MessageBuilder::new().user().content(user_request).build(),
            ])
            .system_prompt(system_prompt)
            .build();

        match get_chat_stream(request).await {
            Ok(mut ai_stream) => {
                use futures::StreamExt;
                let mut cumulative_content = String::new();

                while let Some(response) = ai_stream.next().await {
                    match response {
                        Ok(parts) => {
                            for part in parts {
                                let ChatStreamCompletionResponse::Content(content) = part;
                                cumulative_content.push_str(&content.content);

                                let message = ChatStream::CompletionStreamChunk {
                                    completion_id: completion_id_for_stream.clone(),
                                    content: cumulative_content.clone(),
                                    done: false,
                                };

                                if let Ok(json) = serde_json::to_value(&message) {
                                    yield json;
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "error in AI stream");
                            let error_msg = ChatStream::CompletionStreamChunk {
                                completion_id: completion_id_for_stream.clone(),
                                content: format!("Error: {}", e),
                                done: true,
                            };
                            if let Ok(json) = serde_json::to_value(&error_msg) {
                                yield json;
                            }
                            return;
                        }
                    }
                }

                // Send final message with done: true
                let final_message = ChatStream::CompletionStreamChunk {
                    completion_id: completion_id_for_stream.clone(),
                    content: cumulative_content,
                    done: true,
                };
                if let Ok(json) = serde_json::to_value(&final_message) {
                    yield json;
                }
            }
            Err(e) => {
                tracing::error!(error=?e, "failed to create AI stream");
                let error_msg = ChatStream::CompletionStreamChunk {
                    completion_id: completion_id_for_stream.clone(),
                    content: format!("Error: {}", e),
                    done: true,
                };
                if let Ok(json) = serde_json::to_value(&error_msg) {
                    yield json;
                }
            }
        }
    };

    // Use the extension trait to handle spawning and stream management
    ctx.stream_repo.clone().from_async_stream(
        durable_stream_id,
        Box::pin(payload_stream),
        None,
        None,
    );

    Ok(Json(SimpleCompletionResponse { completion_id }))
}
