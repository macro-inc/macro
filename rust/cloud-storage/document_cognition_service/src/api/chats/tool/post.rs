// This API is designed to suppot "user tools". These are tools that give the user
// the choice to accept/reject as well as the option to edit a tool before it's executed.
//
// The AI will generate a tool call and stub it's response with "pending" then continue
// executing.
//
// If a user likes the tool result and wants to execute the tool they'll hit this API.
// This API will execute the tool. It will use the message chain as the source of truth / storage
// which will be a bit of an ugly implementation. This means that if the user chooses to reject
// the response should be update fromp pending -> rejected. If the user chooses to execute the tool
// the response should be appropriately updated to reflect the result.
//
// The API supports edits by taking an optional "args" field that must match the shape of the named tool.
// The toolset will validate this shape for you. In the case that args are provided _both_ the response
// and call need to be updated
//
// You'll need to write some SQLX queries to do all of this. Put each query in it's own function. Put queries
// in the service module of this crate.
//
use crate::api::context::ApiContext;
use crate::service::tool::{get_chat_messages, update_message_content};
use ai::types::{AssistantMessagePart, ChatMessageContent};
use ai_tools::{RequestContext, ToolServiceContext, all_tools};
use ai_toolset::tool_object::UserToolResult;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use entity_access::domain::models::OwnerAccessLevel;
use macro_middleware::cloud_storage::ensure_access::chat::ChatAccessLevelExtractor;
use model::user::axum_extractor::MacroUserExtractor;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum ToolPostRequest {
    Reject {
        tool_id: String,
    },
    Accept {
        tool_id: String,
        args: Option<Value>,
    },
}

impl ToolPostRequest {
    pub fn tool_id(&self) -> &str {
        match self {
            Self::Accept { tool_id, .. } | Self::Reject { tool_id, .. } => tool_id,
        }
    }
}

#[derive(Serialize)]
struct ToolPostResponse {
    result: Value,
}

/// execute a saved tool
#[utoipa::path(
    post,
    path = "/chats/{chat_id}/tool",
    request_body = Value,
    responses(
        (status = 200, body = Value),
        (status = 404, body = String),
        (status = 500, body = String),
    ),
    params(
        ("chat_id" = String, Path, description = "Chat id")
    )
)]
#[tracing::instrument(skip(state, user, _access), fields(user_id=?user.macro_user_id))]
pub async fn handler(
    _access: ChatAccessLevelExtractor<OwnerAccessLevel>,
    State(state): State<ApiContext>,
    user: MacroUserExtractor,
    Path(chat_id): Path<String>,
    Json(request): Json<ToolPostRequest>,
) -> Result<Response, Response> {
    let messages = get_chat_messages(&state.db, &chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to fetch chat messages"))
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to fetch chat messages",
            )
                .into_response()
        })?;

    let tool_id = request.tool_id().to_owned();

    // Find the message containing the tool call with this ID
    let (message_id, mut parts) = messages
        .into_iter()
        .find_map(|msg| match msg.content {
            ChatMessageContent::AssistantMessageParts(parts) => {
                let has_tool = parts.iter().any(|part| {
                    matches!(
                        part,
                        AssistantMessagePart::ToolCall { id, .. } if *id == tool_id
                    )
                });
                if has_tool {
                    Some((msg.id, parts))
                } else {
                    None
                }
            }
            _ => None,
        })
        .ok_or_else(|| (StatusCode::NOT_FOUND, "tool call not found").into_response())?;

    // Extract tool name and original args from the tool call
    let (tool_name, original_args) = parts
        .iter()
        .find_map(|part| match part {
            AssistantMessagePart::ToolCall { name, json, id } if *id == tool_id => {
                Some((name.clone(), json.clone()))
            }
            _ => None,
        })
        .expect("tool call must exist since we found the message above");

    match request {
        ToolPostRequest::Reject { .. } => {
            // Update the tool response from Pending -> Rejected
            let rejected = serde_json::to_value(UserToolResult::<Value>::Rejected)
                .expect("UserToolResult serialization cannot fail");
            update_tool_response(&mut parts, &tool_id, rejected);

            let content = ChatMessageContent::AssistantMessageParts(parts);
            update_message_content(&state.db, &message_id, &content)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to update message content"))
                .map_err(|_| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "failed to update message",
                    )
                        .into_response()
                })?;

            Ok(StatusCode::OK.into_response())
        }
        ToolPostRequest::Accept { args, .. } => {
            let exec_args = args.as_ref().unwrap_or(&original_args);

            // If user provided custom args, update the tool call args
            if let Some(ref custom_args) = args {
                update_tool_call_args(&mut parts, &tool_id, custom_args.clone());
            }

            // Construct toolset and execute
            let toolset = all_tools().toolset;

            let tool_context = ToolServiceContext {
                email_service_client: state.email_service_client_external.clone(),
                search_service_client: state.search_service_client.clone(),
                scribe: state.scribe.clone(),
                soup_service: state.soup_service.clone(),
                document_tool_context: state.document_tool_context.clone(),
                properties_tool_context: state.properties_tool_context.clone(),
            };

            #[expect(deprecated)]
            let request_context = RequestContext {
                user_id: user.macro_user_id,
                jwt: Arc::new(String::new()),
            };

            let tool_result = toolset
                .try_user_tool_call(tool_context, request_context, &tool_name, exec_args)
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "toolset error");
                    (StatusCode::BAD_REQUEST, e.to_string()).into_response()
                })?;

            let response_json = match tool_result {
                Ok(result) => serde_json::to_value(UserToolResult::Executed(result))
                    .expect("UserToolResult serialization cannot fail"),
                Err(tool_err) => {
                    tracing::error!(error=?tool_err.internal_error, "tool execution failed");

                    // Replace the response with a ToolCallErr
                    replace_tool_response_with_err(
                        &mut parts,
                        &tool_id,
                        &tool_name,
                        &tool_err.description,
                    );

                    let content = ChatMessageContent::AssistantMessageParts(parts);
                    update_message_content(&state.db, &message_id, &content)
                        .await
                        .inspect_err(
                            |e| tracing::error!(error=?e, "failed to update message after tool error"),
                        )
                        .map_err(|_| {
                            (StatusCode::INTERNAL_SERVER_ERROR, "failed to update message")
                                .into_response()
                        })?;

                    return Err(
                        (StatusCode::UNPROCESSABLE_ENTITY, tool_err.description).into_response()
                    );
                }
            };

            update_tool_response(&mut parts, &tool_id, response_json.clone());

            let content = ChatMessageContent::AssistantMessageParts(parts);
            update_message_content(&state.db, &message_id, &content)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to update message content"))
                .map_err(|_| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "failed to update message",
                    )
                        .into_response()
                })?;

            Ok((
                StatusCode::OK,
                Json(ToolPostResponse {
                    result: response_json,
                }),
            )
                .into_response())
        }
    }
}

/// Updates the json field of the ToolCallResponseJson part matching the given tool_id.
fn update_tool_response(parts: &mut [AssistantMessagePart], tool_id: &str, new_json: Value) {
    for part in parts.iter_mut() {
        if let AssistantMessagePart::ToolCallResponseJson { id, json, .. } = part
            && id == tool_id
        {
            *json = new_json;
            return;
        }
    }
}

/// Updates the json (args) field of the ToolCall part matching the given tool_id.
fn update_tool_call_args(parts: &mut [AssistantMessagePart], tool_id: &str, new_args: Value) {
    for part in parts.iter_mut() {
        if let AssistantMessagePart::ToolCall { id, json, .. } = part
            && id == tool_id
        {
            *json = new_args;
            return;
        }
    }
}

/// Replaces a ToolCallResponseJson with a ToolCallErr for the given tool_id.
fn replace_tool_response_with_err(
    parts: &mut [AssistantMessagePart],
    tool_id: &str,
    tool_name: &str,
    description: &str,
) {
    for part in parts.iter_mut() {
        if let AssistantMessagePart::ToolCallResponseJson { id, .. } = part
            && id == tool_id
        {
            *part = AssistantMessagePart::ToolCallErr {
                name: tool_name.to_string(),
                description: description.to_string(),
                id: tool_id.to_string(),
            };
            return;
        }
    }
}
