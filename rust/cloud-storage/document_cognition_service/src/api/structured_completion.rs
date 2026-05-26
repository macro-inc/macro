use crate::api::context::ApiContext;
use crate::core::constants::DEFAULT_MAX_TOKENS;
use crate::model::stream::ToolSet;
use ai::structured_output_v2::DynamicSchema;
use ai::tool::ToolLoop;
use ai::types::{MessageBuilder, Model, RequestBuilder, Role};
use ai_tools::RequestContext;
use axum::Json;
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use chat::inbound::http::extractors::ChatModelAccess;
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use model::user::UserContext;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StructuredCompletionRequest {
    pub prompt: String,
    pub model: Model,
    pub output_schema: DynamicSchema,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_instructions: Option<String>,
    #[serde(default)]
    pub toolset: ToolSet,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StructuredCompletionResponse {
    pub result: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StructuredCompletionError {
    pub error: String,
    #[serde(skip)]
    pub status: StatusCode,
}

impl fmt::Display for StructuredCompletionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.error)
    }
}

impl IntoResponse for StructuredCompletionError {
    fn into_response(self) -> axum::response::Response {
        (self.status, Json(self)).into_response()
    }
}

#[utoipa::path(
    post,
    path = "/structured-completion",
    request_body = StructuredCompletionRequest,
    responses(
        (status = 200, description = "Structured completion result", body = StructuredCompletionResponse),
        (status = 400, description = "Bad request", body = StructuredCompletionError),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "Payment required"),
        (status = 500, description = "Internal error", body = StructuredCompletionError),
    )
)]
#[tracing::instrument(skip(state, _model_access, user_context, request), fields(user_id = %user_context.user_id), err)]
pub async fn structured_completion(
    State(state): State<ApiContext>,
    _model_access: ChatModelAccess,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<StructuredCompletionRequest>,
) -> Result<Json<StructuredCompletionResponse>, StructuredCompletionError> {
    let ctx = Arc::new(state);

    let user_id = MacroUserIdStr::try_from(user_context.user_id.clone()).map_err(|_| {
        StructuredCompletionError {
            error: "Invalid user ID".to_string(),
            status: StatusCode::BAD_REQUEST,
        }
    })?;

    let tools_prompt = match request.toolset {
        ToolSet::All => ctx.all_tools_prompt,
        ToolSet::None => ai_tools::prompts::BASE_PROMPT,
    };

    let system_prompt = match &request.additional_instructions {
        Some(instructions) => format!("{}\n{}", tools_prompt, instructions),
        None => tools_prompt.to_string(),
    };

    let ai_request = RequestBuilder::new()
        .model(request.model)
        .user_message(&request.prompt)
        .system_prompt(system_prompt.clone())
        .max_tokens(DEFAULT_MAX_TOKENS)
        .build();

    // Phase 1: Run agent loop to gather information
    let mcp_store = ctx.mcp_state.store();
    let mcp_records = mcp_store.list(&user_id).await.unwrap_or_default();
    let toolset = Arc::new(
        mcp_client::domain::service::CombinedToolSet::new(ctx.all_tools.clone(), &mcp_records)
            .await,
    );
    let client = ToolLoop::new(toolset, ctx.tool_service_context.clone());
    let mut chat = client.chat();

    let request_context = RequestContext {
        user_id: user_id.clone(),
    };
    let mut stream = chat
        .send_message(ai_request, request_context, user_id.as_ref().to_string())
        .await
        .map_err(|e| StructuredCompletionError {
            error: format!("Agent loop failed: {e}"),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        })?;

    while let Some(item) = stream.next().await {
        if let Err(e) = item {
            return Err(StructuredCompletionError {
                error: format!("Agent loop error: {e}"),
                status: StatusCode::INTERNAL_SERVER_ERROR,
            });
        }
    }
    drop(stream);

    // Phase 2: Structured completion with the gathered context
    let new_messages = chat.get_new_conversation_messages();

    let mut all_messages = vec![
        MessageBuilder::new()
            .role(Role::User)
            .content(request.prompt)
            .build(),
    ];
    all_messages.extend(new_messages);
    all_messages.push(
        MessageBuilder::new()
            .role(Role::User)
            .content("Based on the information gathered above, produce a structured response matching the required schema.")
            .build(),
    );

    let structured_request = RequestBuilder::new()
        .model(request.model)
        .messages(all_messages)
        .system_prompt(system_prompt)
        .max_tokens(DEFAULT_MAX_TOKENS)
        .build();

    let result = ai::structured_output_v2::dynamic_structured_completion(
        structured_request,
        request.output_schema,
    )
    .await
    .map_err(|e| StructuredCompletionError {
        error: format!("Structured completion failed: {e}"),
        status: StatusCode::INTERNAL_SERVER_ERROR,
    })?;

    Ok(Json(StructuredCompletionResponse { result }))
}
