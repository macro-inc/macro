use crate::api::context::ApiContext;
use crate::model::stream::ToolSet;
use agent::structured_output::DynamicSchema;
use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, AgentModel, StreamAccumulator};
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
    pub model: AgentModel,
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

    // Phase 1: Run agent loop to gather information
    let mcp_store = ctx.mcp_state.store();
    let mcp_records = mcp_store.list(&user_id).await.unwrap_or_default();
    let toolset: Arc<dyn ai_toolset::ToolSet<_> + Send + Sync> = Arc::new(
        mcp_client::domain::service::CombinedToolSet::new(ctx.all_tools.clone(), &mcp_records)
            .await,
    );

    let user_message = ChatMessage {
        role: Role::User,
        content: ChatMessageContent::Text(request.prompt.clone()),
        attachments: None,
    };
    let rig_messages = agent::to_rig_messages(&[user_message]);

    let agent_loop = AgentLoop::new().with_model(request.model);
    let mut session = agent_loop
        .session(
            toolset,
            Arc::new(ctx.tool_service_context.clone()),
            &system_prompt,
            user_id,
        )
        .await;

    let mut ai_stream =
        session
            .send_message(rig_messages)
            .await
            .map_err(|e| StructuredCompletionError {
                error: format!("Agent loop failed: {e}"),
                status: StatusCode::INTERNAL_SERVER_ERROR,
            })?;

    let mut accumulator = StreamAccumulator::new();
    while let Some(item) = ai_stream.next().await {
        match item {
            Ok(part) => {
                accumulator.push(part);
            }
            Err(e) => {
                return Err(StructuredCompletionError {
                    error: format!("Agent loop error: {e}"),
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                });
            }
        }
    }
    drop(ai_stream);
    let yielded_parts = accumulator.into_parts();

    // Phase 2: Structured completion with the gathered context
    let conversation: Vec<ChatMessage> = vec![
        ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text(request.prompt),
            attachments: None,
        },
        ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(yielded_parts),
            attachments: None,
        },
        ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text(
                "Based on the information gathered above, produce a structured response matching the required schema.".to_string(),
            ),
            attachments: None,
        },
    ];
    let rig_messages = agent::to_rig_messages(&conversation);

    let result = agent::structured_output::dynamic_structured_completion(
        request.model,
        &system_prompt,
        rig_messages,
        request.output_schema,
    )
    .await
    .map_err(|e| StructuredCompletionError {
        error: format!("Structured completion failed: {e}"),
        status: StatusCode::INTERNAL_SERVER_ERROR,
    })?;

    Ok(Json(StructuredCompletionResponse { result }))
}
