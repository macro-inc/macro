//! Internal, service-to-service endpoint that runs the agent loop to
//! completion and returns the final assistant text.
//!
//! This backs Macro AI's replies in channels: the document storage service
//! detects an `@macro` mention and calls this endpoint (authenticated with the
//! internal API key) to produce a response using the same toolset the agent
//! uses everywhere else.

use std::sync::Arc;

use agent::{AgentLoop, StreamPart, to_rig_messages};
use ai_tools::ToolServiceContext;
use axum::{Json, extract::State, http::StatusCode};
use futures::StreamExt;
use macro_middleware::auth::internal_access::ValidInternalKey;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::api::context::ApiContext;

/// Request body for an internal channel agent response.
#[derive(Debug, Deserialize)]
pub struct ChannelAgentRequest {
    /// User the agent acts on behalf of (used for tool dispatch / access).
    pub user_id: String,
    /// The prompt to send to the agent (the user's message content).
    pub prompt: String,
}

/// Response body containing the final assistant text.
#[derive(Debug, Serialize)]
pub struct ChannelAgentResponse {
    /// The assistant's final text response.
    pub text: String,
}

const CHANNEL_SYSTEM_PROMPT: &str = "You are Macro, a helpful assistant participating in a Macro channel. \
You were mentioned in a message and are replying in a thread. The prompt includes channel \
messages around the mention for context, labeled by sender. \
Be concise and directly useful. Use your tools to look things up when helpful. \
Respond in Markdown.";

/// Run the agent loop to completion and return the final text.
#[tracing::instrument(skip(ctx, _valid, req), err(Debug))]
pub async fn channel_respond(
    State(ctx): State<ApiContext>,
    _valid: ValidInternalKey,
    Json(req): Json<ChannelAgentRequest>,
) -> Result<Json<ChannelAgentResponse>, (StatusCode, String)> {
    let user_id = MacroUserIdStr::try_from(req.user_id.clone())
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid user_id".to_string()))?;

    let toolset: Arc<dyn ai_toolset::ToolSet<ToolServiceContext> + Send + Sync> =
        ctx.all_tools.clone();
    let tool_context = Arc::new(ctx.tool_service_context.clone());

    let system_prompt = format!("{CHANNEL_SYSTEM_PROMPT}\n\n{}", ctx.all_tools_prompt);

    let agent_loop = AgentLoop::new();
    let mut session = agent_loop
        .session(toolset, tool_context, &system_prompt, user_id)
        .await;

    let messages = vec![agent::types::ChatMessage {
        role: agent::types::Role::User,
        content: agent::types::ChatMessageContent::Text(req.prompt),
        attachments: None,
    }];

    let mut stream = session
        .send_message(to_rig_messages(&messages))
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "failed to start channel agent stream");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to start agent".to_string(),
            )
        })?;

    let mut text = String::new();
    while let Some(part) = stream.next().await {
        match part {
            Ok(StreamPart::Content(chunk)) => text.push_str(&chunk),
            Ok(_) => {}
            Err(err) => {
                tracing::error!(error=?err, "channel agent stream error");
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "agent stream failed".to_string(),
                ));
            }
        }
    }

    Ok(Json(ChannelAgentResponse {
        text: text.trim().to_string(),
    }))
}
