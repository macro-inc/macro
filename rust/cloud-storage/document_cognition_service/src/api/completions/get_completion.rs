use ai::chat_completion::get_chat_completion;
use ai::types::{ChatCompletionError, MessageBuilder, Model, RequestBuilder};
use axum::{
    extract::Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct GetCompletionRequest {
    model: Option<Model>,
    max_tokens: Option<u32>,
    prompt: String,
    user_message: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct GetCompletionResponse {
    completion: String,
}

pub const DEFAULT_COMPLETION_MODEL: Model = Model::OpenAIGPT4oMini;
pub const DEFAULT_COMPLETION_MAX_TOKENS: u32 = 300;

#[utoipa::path(
    post,
    path = "/completions/get_completion",
    responses(
        (status = 200, body = GetCompletionResponse),
        (status = 400, body=String),
        (status = 422, body=String),
        (status = 401, body=String),
        (status = 500, body=String),
    )
)]
pub async fn get_completion_handler(
    Json(req): Json<GetCompletionRequest>,
) -> Result<Response, Response> {
    let request = RequestBuilder::new()
        .model(req.model.unwrap_or(DEFAULT_COMPLETION_MODEL))
        .max_tokens(req.max_tokens.unwrap_or(DEFAULT_COMPLETION_MAX_TOKENS))
        .messages(vec![
            MessageBuilder::new()
                .user()
                .content(req.user_message)
                .build(),
        ])
        .system_prompt(req.prompt)
        .build();

    let completion = get_chat_completion(request).await.map_err(|e| {
        let response = match &e {
            ChatCompletionError::RequestError(e) => (StatusCode::BAD_REQUEST, e.to_string()),
            ChatCompletionError::Refusal(_) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "AI Refusal".to_string())
            }
            ChatCompletionError::NoContent => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "AI responded with nothing".to_string(),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
        };
        tracing::error!(error = %e, "Chat completion failed");
        response.into_response()
    })?;
    Ok((StatusCode::OK, Json(GetCompletionResponse { completion })).into_response())
}
