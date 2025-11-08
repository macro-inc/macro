use anyhow::{Context, Result};
use axum::{extract::Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StructedOutputCompletionRequest {
    pub prompt: String,
    pub schema: Value,
    pub schema_name: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StructedOutputCompletionResponse {
    pub completion: Value,
}

#[utoipa::path(
        post,
        path = "/completions/structured_output",
        responses(
            (status = 200, body=StructedOutputCompletionResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument()]
pub async fn handler(
    request: Json<StructedOutputCompletionRequest>,
) -> Result<(StatusCode, Json<StructedOutputCompletionResponse>), (StatusCode, String)> {
    let completion = ai::structured_output::structured_output_completion(
        &request.prompt,
        ai_tools::prompts::BASE_PROMPT,
        request.schema.clone(),
        &request.schema_name,
    )
    .await
    .map_err(|err| {
        tracing::error!(
            error = %err,
            schema_name = %request.schema_name,
            "failed to complete structured output"
        );
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to complete structured output".to_string(),
        )
    })?;

    let response = StructedOutputCompletionResponse {
        completion: serde_json::from_str(&completion)
            .context("failed to parse completion")
            .map_err(|err| {
                tracing::error!(
                    error = %err,
                    schema_name = %request.schema_name,
                    "failed to parse completion"
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to parse completion".to_string(),
                )
            })?,
    };

    Ok((StatusCode::OK, Json(response)))
}
