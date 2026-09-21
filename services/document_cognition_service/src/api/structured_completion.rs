use crate::api::context::{ApiContext, DcsAuthorizationService, DcsChatModelAccess};
use crate::api::tool_selection::select_tools;
use crate::model::stream::ToolSet;
use agent::structured_output::DynamicSchema;
use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, StreamAccumulator};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures::StreamExt;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
use utoipa::ToSchema;

mod activity;
#[cfg(test)]
mod test;
use activity::{StructuredToolActivity, has_database_changes, tool_activity};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StructuredCompletionRequest {
    pub prompt: String,
    pub model: String,
    pub output_schema: DynamicSchema,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_instructions: Option<String>,
    #[serde(default)]
    pub toolset: ToolSet,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StructuredCompletionResponse {
    pub result: serde_json::Value,
    /// Actual completed tools, independent of the model's claims.
    #[serde(rename = "toolActivity")]
    pub tool_activity: Vec<StructuredToolActivity>,
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
#[tracing::instrument(skip(state, model_access, user, request), fields(user_id = %user.authorization.user.macro_user_id), err)]
pub async fn structured_completion(
    State(state): State<ApiContext>,
    model_access: DcsChatModelAccess,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    Json(request): Json<StructuredCompletionRequest>,
) -> Result<Json<StructuredCompletionResponse>, StructuredCompletionError> {
    let ctx = Arc::new(state);
    let model = model_access.best_model();

    let user_id = user.authorization.user.macro_user_id.clone();

    let tools_prompt: &(dyn std::fmt::Display + Sync) = match request.toolset {
        ToolSet::All => &ctx.all_tools_prompt,
        ToolSet::None | ToolSet::DatabasesReadOnly => &prompt::BASE_PROMPT,
        ToolSet::Databases => &prompt::DATABASE_TOOL_USE_PROMPT,
    };

    let system_prompt = match &request.additional_instructions {
        Some(instructions) => format!("{}\n{}", tools_prompt, instructions),
        None => tools_prompt.to_string(),
    };

    // Tool-free completions (for example, query proposals) must not discover
    // connectors or execute built-in tools. Omitting the tool prompt alone
    // does not remove the agent's capabilities.
    let toolset = select_tools(
        &request.toolset,
        async {
            let tools: Arc<dyn ai_toolset::ToolSet<_> + Send + Sync> =
                Arc::new(ai_tools::database_tools());
            tools
        },
        async {
            let tools: Arc<dyn ai_toolset::ToolSet<_> + Send + Sync> =
                Arc::new(ai_tools::database_read_only_tools());
            tools
        },
        async {
            use mcp_select::ConnectorSelect;
            let mcp_tools = ctx.mcp_selector.user_toolset(&user_id).await;
            let tools: Arc<dyn ai_toolset::ToolSet<_> + Send + Sync> = Arc::new(
                mcp_select::CombinedToolSet::new(ctx.all_tools.clone(), mcp_tools),
            );
            tools
        },
    )
    .await;

    let user_message = ChatMessage {
        role: Role::User,
        content: ChatMessageContent::Text(request.prompt.clone()),
        attachments: None,
    };
    let rig_messages = agent::to_rig_messages(&[user_message]);

    let agent_loop = AgentLoop::new(ctx.tool_service_context.recorder.clone()).with_model(model);
    let usage_ctx =
        ai_usage::UsageContext::new(ai_usage::AiFeature::DynamicCompletionsApi, user_id.clone());
    // Carry the feature on the context so tool-spawned subagents attribute to it.
    let mut tool_context = ctx.tool_service_context.clone();
    tool_context.usage_context = usage_ctx.clone();
    let mut session = agent_loop
        .session(toolset, Arc::new(tool_context), &system_prompt, usage_ctx)
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
    let mut stream_error = None;
    while let Some(item) = ai_stream.next().await {
        match item {
            Ok(part) => {
                accumulator.push(part);
            }
            Err(e) => {
                stream_error = Some(StructuredCompletionError {
                    error: format!("Agent loop error: {e}"),
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                });
                break;
            }
        }
    }
    drop(ai_stream);
    let yielded_parts = accumulator.into_parts();
    let activity = tool_activity(&yielded_parts);
    if let Some(error) = stream_error {
        return partial_completion_or_error(
            activity,
            error,
            matches!(request.toolset, ToolSet::Databases),
        );
    }

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
        model,
        &system_prompt,
        rig_messages,
        request.output_schema,
        ctx.tool_service_context.recorder.as_ref(),
        ai_usage::UsageContext::new(ai_usage::AiFeature::DynamicCompletionsApi, user_id),
    )
    .await;
    match result {
        Ok(result) => Ok(Json(StructuredCompletionResponse {
            result,
            tool_activity: activity,
        })),
        Err(error) => partial_completion_or_error(
            activity,
            StructuredCompletionError {
                error: format!("Structured completion failed: {error}"),
                status: StatusCode::INTERNAL_SERVER_ERROR,
            },
            matches!(request.toolset, ToolSet::Databases),
        ),
    }
}

/// Do not conceal committed edits behind a failed follow-up model request.
fn partial_completion_or_error(
    tool_activity: Vec<StructuredToolActivity>,
    error: StructuredCompletionError,
    database_answer: bool,
) -> Result<Json<StructuredCompletionResponse>, StructuredCompletionError> {
    if !database_answer || !has_database_changes(&tool_activity) {
        return Err(error);
    }
    tracing::warn!(error = %error, "Completion interrupted after database changes");
    Ok(Json(StructuredCompletionResponse {
        result: serde_json::json!({
            "answerable": false,
            "sql": "",
            "explanation": "Some changes were saved, but the assistant could not finish. Review the updated table before requesting further changes."
        }),
        tool_activity,
    }))
}
