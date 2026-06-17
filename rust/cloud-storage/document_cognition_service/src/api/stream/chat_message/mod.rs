//! HTTP endpoint for sending chat messages with streaming responses.
use super::util::chat_message::ai_request::build_chat_messages;
use super::util::chat_message::toolset::choose_tools_prompt;
use super::util::chat_message::{store_conversation_messages, store_incoming_message};
use super::util::chat_permissions;
use crate::api::context::ApiContext;
use crate::api::utils::log;
use crate::core::constants::DEFAULT_CHAT_NAME;
use crate::model::stream::{ChatStream, JwtPayload, SendChatMessagePayload, StreamError, ToolSet};
use crate::service::ai_stream_registry::CancellationSubscription;
use crate::service::chat_renamer::spawn_initial_chat_rename;
use crate::service::get_chat::get_chat;
use crate::service::notification::notify;
use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent};
use agent::{AgentLoop, StreamAccumulator};
use async_stream::stream;
use attachment::FormattedParts;
use axum::Json;
use axum::extract::{Extension, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::IntoResponse;
use chat::domain::ports::MessageService;
use chat::inbound::http::extractors::ChatModelAccess;
use futures::StreamExt;
use macro_auth::headers::AccessTokenExtractor;
use macro_db_client::dcs::create_chat;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use memory::domain::MemoryService;
use model::user::UserContext;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
use stream::domain::{StreamId, StreamRepoExt};
use utoipa::ToSchema;

/// Raw Bearer token extracted from the Authorization header.
#[derive(Clone)]
pub(crate) struct BearerToken(pub String);

/// Middleware that extracts the raw access token from request headers or cookies
/// and inserts it into request extensions.
pub(crate) async fn attach_bearer_token(
    access_token: Result<AccessTokenExtractor, StatusCode>,
    mut req: Request,
    next: Next,
) -> Result<axum::response::Response, StatusCode> {
    if cfg!(feature = "local_auth") {
        let token = access_token
            .map(|t| t.as_ref().to_string())
            .unwrap_or_default();
        req.extensions_mut().insert(BearerToken(token));
        return Ok(next.run(req).await);
    }

    let token = access_token.map_err(|_| StatusCode::UNAUTHORIZED)?;

    req.extensions_mut()
        .insert(BearerToken(token.as_ref().to_string()));
    Ok(next.run(req).await)
}

/// HTTP request payload for sending a chat message.
/// Unlike the WebSocket payload, this does not include stream_id as it's generated server-side.
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone)]
pub struct HttpSendChatMessageRequest {
    /// The content of the message
    pub content: String,
    /// Id of the chat the message belongs to (optional - if not provided, a new chat is created)
    pub chat_id: Option<String>,
    /// The model to respond with (provider api id)
    pub model: String,
    /// Additional system instructions appended to the base system prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_instructions: Option<String>,
    /// Attachments for the message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<Entity<'static>>>,
    /// Which toolset to use. Defaults to `all`
    #[serde(default)]
    pub toolset: ToolSet,
}

/// Response for initiating a chat message stream
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SendChatMessageResponse {
    /// The stream ID that will receive the response chunks (same as message_id)
    pub stream_id: String,
    /// The message ID for the AI response
    pub message_id: String,
    /// The chat ID (may differ from request if a new chat was created)
    pub chat_id: String,
}

/// Error response for chat message endpoints
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatMessageError {
    pub error: String,
    pub stream_id: Option<String>,
    #[serde(skip)]
    pub status: Option<StatusCode>,
}

impl fmt::Display for ChatMessageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.error)
    }
}

impl IntoResponse for ChatMessageError {
    fn into_response(self) -> axum::response::Response {
        let status = self.status.unwrap_or(StatusCode::BAD_REQUEST);
        (status, Json(self)).into_response()
    }
}

/// Send a new chat message and stream the AI response.
///
/// This endpoint initiates a chat message and streams the response via the stream service.
/// The client should subscribe to the returned stream_id via connection_gateway to receive chunks.
#[utoipa::path(
    post,
    path = "/stream/chat/message",
    request_body = HttpSendChatMessageRequest,
    responses(
        (status = 200, description = "Stream initiated successfully", body = SendChatMessageResponse),
        (status = 400, description = "Bad request", body = ChatMessageError),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "Payment required — user lacks access to the requested model"),
        (status = 403, description = "Forbidden"),
    )
)]
#[tracing::instrument(skip(state, model_access, user_context, bearer, request), fields(chat_id=?request.chat_id, user_id = %user_context.user_id, attachment_ids=?request.attachments.as_ref().map(|a| a.iter().map(|att| att.entity_id.as_ref()).collect::<Vec<_>>()).unwrap_or_default()), ret, err)]
pub async fn send_chat_message(
    State(state): State<ApiContext>,
    model_access: ChatModelAccess,
    Extension(user_context): Extension<UserContext>,
    Extension(bearer): Extension<BearerToken>,
    Json(request): Json<HttpSendChatMessageRequest>,
) -> Result<Json<SendChatMessageResponse>, ChatMessageError> {
    Box::pin(send_chat_message_inner(
        state,
        model_access,
        user_context,
        bearer,
        request,
    ))
    .await
}

async fn send_chat_message_inner(
    state: ApiContext,
    model_access: ChatModelAccess,
    user_context: UserContext,
    bearer: BearerToken,
    request: HttpSendChatMessageRequest,
) -> Result<Json<SendChatMessageResponse>, ChatMessageError> {
    let now = std::time::Instant::now();
    let ctx = Arc::new(state);
    let jwt_token = bearer.0;

    // Generate message_id which also serves as the stream_id
    let message_id = uuid::Uuid::new_v4().to_string();
    let stream_id = message_id.clone();

    // Validate user ID
    let user_id =
        MacroUserIdStr::try_from(user_context.user_id.clone()).map_err(|_| ChatMessageError {
            error: "Invalid user ID".to_string(),
            stream_id: Some(stream_id.clone()),
            status: None,
        })?;
    let user_id = Arc::new(user_id);

    // Determine chat_id - use provided or we'll create a new chat
    let requested_chat_id = request.chat_id.clone().unwrap_or_default();

    // The frontend selects the model; enforce the user's entitlement here.
    // Free users get Haiku; professional users get everything.
    if !model_access.has_access(&request.model) {
        return Err(ChatMessageError {
            error: format!("No access to model {}", request.model),
            stream_id: Some(stream_id.clone()),
            status: Some(StatusCode::FORBIDDEN),
        });
    }
    let model = request.model.clone();

    // Try to get the chat first - if it doesn't exist or no chat_id provided, create it
    let (chat, actual_chat_id, created_new_chat) = if requested_chat_id.is_empty() {
        // No chat_id provided - create a new chat
        let (chat, chat_id) = create_new_chat(&ctx, &user_id, &model, &stream_id).await?;
        (chat, chat_id, true)
    } else {
        match get_chat(&ctx, &requested_chat_id, user_id.0.as_ref()).await {
            Ok(chat) => {
                // Chat exists - check permissions
                match chat_permissions::chat_access(
                    &ctx,
                    &user_context,
                    &requested_chat_id,
                    stream_id.clone(),
                )
                .await
                {
                    Err(e) => {
                        return Err(ChatMessageError {
                            error: format!("Permission check failed: {:?}", e),
                            stream_id: Some(stream_id),
                            status: None,
                        });
                    }
                    Ok(access) => match access {
                        AccessLevel::View | AccessLevel::Comment => {
                            return Err(ChatMessageError {
                                error: "Insufficient permissions to send messages".to_string(),
                                stream_id: Some(stream_id),
                                status: None,
                            });
                        }
                        _ => (),
                    },
                };
                (chat, requested_chat_id, false)
            }
            Err(_) => {
                // Chat doesn't exist - create a new one
                tracing::info!(
                    requested_chat_id = %requested_chat_id,
                    "Chat not found, creating new chat"
                );
                let (chat, chat_id) = create_new_chat(&ctx, &user_id, &model, &stream_id).await?;
                (chat, chat_id, true)
            }
        }
    };
    let should_auto_rename_chat = created_new_chat || chat.messages.is_empty();

    // Convert HTTP request to internal payload for existing functions
    let payload = SendChatMessagePayload {
        stream_id: stream_id.clone(),
        content: request.content.clone(),
        chat_id: actual_chat_id.clone(),
        model: model.clone(),
        additional_instructions: request.additional_instructions.clone(),
        attachments: request.attachments.clone(),
        toolset: request.toolset.clone(),
        jwt: JwtPayload {
            token: jwt_token.clone(),
        },
    };

    // Store the incoming user message and resolve its attachments
    let resolved = store_incoming_message(ctx.clone(), user_id.0.as_ref(), &chat, &model, &payload)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "failed to store incoming message");
            ChatMessageError {
                error: "Failed to store message".to_string(),
                stream_id: Some(stream_id.clone()),
                status: None,
            }
        })?;
    let user_message_id = resolved.message_id;

    if should_auto_rename_chat {
        spawn_initial_chat_rename(
            ctx.clone(),
            (*user_id).clone(),
            actual_chat_id.clone(),
            stream_id.clone(),
            request.content.clone(),
        );
    }

    // Fetch all resolved attachment content for the chat (current + prior messages)
    let all_resolved_parts: Vec<FormattedParts> = ctx
        .message_service
        .get_resolved_message_chain(&actual_chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to fetch resolved message chain"))
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| r.parts)
        .collect();

    // Fetch user memory (triggers background generation if stale/missing)
    let user_memory = ctx
        .memory_service
        .get_or_generate_memory((*user_id).clone())
        .await
        .inspect_err(|e| tracing::error!(error = ?e, "failed to fetch user memory"))
        .ok()
        .flatten();

    // Build the chat messages
    let tools_prompt = choose_tools_prompt(&payload, &*ctx.all_tools_prompt);
    let ai_request = build_chat_messages(&chat, &payload, all_resolved_parts).map_err(|err| {
        tracing::error!(error=?err, "failed to build chat messages");
        ChatMessageError {
            error: "Failed to build request".to_string(),
            stream_id: Some(stream_id.clone()),
            status: None,
        }
    })?;

    // Log time to send request
    log::log_timing(log::LatencyMetric::TimeToSendRequest, &model, now.elapsed());

    // Create stream ID for publishing
    let durable_stream_id = StreamId {
        entity_type: EntityType::Chat,
        entity_id: actual_chat_id.clone(),
        stream_id: stream_id.clone(),
    };

    // Subscribe to cross-instance cancellation signals. The subscription is
    // moved into the spawned stream task and dropped when it finishes.
    let cancellation_sub = ctx.ai_stream_registry.register(stream_id.clone()).await;

    // Build the system prompt for the agent session.
    let system_prompt = {
        let additional = payload
            .additional_instructions
            .as_deref()
            .unwrap_or_default();
        let mut prompt = format!("{}\n{}", tools_prompt, additional);
        if let Some(memory) = user_memory.as_deref() {
            prompt.push_str("\n\n<user_memory>\n");
            prompt.push_str(memory);
            prompt.push_str("\n</user_memory>");
        }
        prompt
    };

    // Stream the AI response, save messages when complete
    stream_and_save_message(
        ctx.clone(),
        ai_request,
        system_prompt,
        (*user_id).clone(),
        jwt_token,
        actual_chat_id.clone(),
        message_id.clone(),
        stream_id.clone(),
        model,
        now,
        request.content.clone(),
        user_message_id,
        request.attachments.clone().unwrap_or_default(),
        durable_stream_id,
        cancellation_sub,
    );

    Ok(Json(SendChatMessageResponse {
        stream_id,
        message_id,
        chat_id: actual_chat_id,
    }))
}

/// Helper function to create a new chat
async fn create_new_chat(
    ctx: &Arc<ApiContext>,
    user_id: &Arc<MacroUserIdStr<'static>>,
    model: &str,
    stream_id: &str,
) -> Result<(crate::model::chats::ChatResponse, String), ChatMessageError> {
    let share_permission = SharePermissionV2::new_chat_share_permission();
    let new_chat_id = create_chat::create_chat_v2(
        &ctx.db,
        (**user_id).clone(),
        DEFAULT_CHAT_NAME,
        model,
        None, // project_id
        &share_permission,
        vec![], // attachments
        0,      // attachment_token_count
        true,   // is_persistent
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "failed to create chat");
        ChatMessageError {
            error: "Failed to create chat".to_string(),
            stream_id: Some(stream_id.to_string()),
            status: None,
        }
    })?;

    // Get the newly created chat
    let chat = get_chat(ctx, &new_chat_id, user_id.0.as_ref())
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "failed to get newly created chat");
            ChatMessageError {
                error: "Failed to get chat".to_string(),
                stream_id: Some(stream_id.to_string()),
                status: None,
            }
        })?;

    Ok((chat, new_chat_id))
}

/// For every `ToolCall` in `parts` that has no matching response, insert a
/// synthetic `ToolCallErr { description: "cancelled", .. }` immediately after
/// it. Used on cancellation so the persisted assistant message stays
/// well-formed: every tool call has a matching response (so future
/// conversation turns don't break on an unmatched `tool_call_id`) and the UI
/// can render the cancellation via the existing `ToolCallErr` variant.
fn resolve_pending_tool_calls(parts: Vec<AssistantMessagePart>) -> Vec<AssistantMessagePart> {
    use std::collections::HashSet;
    let mut pending: HashSet<String> = HashSet::new();
    for part in &parts {
        match part {
            AssistantMessagePart::ToolCall { id, .. }
            | AssistantMessagePart::McpToolCall { id, .. } => {
                pending.insert(id.clone());
            }
            AssistantMessagePart::ToolCallResponseJson { id, .. }
            | AssistantMessagePart::ToolCallErr { id, .. } => {
                pending.remove(id);
            }
            _ => {}
        }
    }
    if pending.is_empty() {
        return parts;
    }
    let mut out: Vec<AssistantMessagePart> = Vec::with_capacity(parts.len() + pending.len());
    for part in parts {
        let synthetic = match &part {
            AssistantMessagePart::ToolCall { id, name, .. }
            | AssistantMessagePart::McpToolCall { id, name, .. }
                if pending.contains(id) =>
            {
                Some(AssistantMessagePart::ToolCallErr {
                    name: name.clone(),
                    id: id.clone(),
                    description: "cancelled".to_string(),
                })
            }
            _ => None,
        };
        out.push(part);
        if let Some(s) = synthetic {
            out.push(s);
        }
    }
    out
}

/// Streams the AI response and saves conversation messages when complete.
///
/// Creates a payload stream, publishes it via `from_async_stream`, and stores
/// the conversation messages after the stream finishes.
#[expect(clippy::too_many_arguments, reason = "matches WS handler signature")]
#[tracing::instrument(skip(ctx, request, user_message_content, cancellation_sub))]
fn stream_and_save_message(
    ctx: Arc<ApiContext>,
    request: Vec<ChatMessage>,
    system_prompt: String,
    user_id: MacroUserIdStr<'static>,
    jwt_token: String,
    chat_id: String,
    message_id: String,
    stream_id: String,
    model: String,
    now: std::time::Instant,
    user_message_content: String,
    user_message_id: String,
    user_message_attachments: Vec<Entity<'static>>,
    durable_stream_id: StreamId,
    cancellation_sub: CancellationSubscription,
) {
    tracing::trace!(request=?request, "streaming chat request");
    let tool_context = ctx.tool_service_context.clone();
    let static_tools = ctx.all_tools.clone();
    let mcp_store = ctx.mcp_state.store();

    let ctx_outer = ctx.clone();
    // Pull the token out so the select below can reference it without moving
    // the whole subscription; the subscription itself is moved into the
    // stream closure so the Redis subscriber task is aborted when the stream
    // finishes.
    let cancellation_token = cancellation_sub.token.clone();

    let payload_stream = stream! {
        // Keep the subscription alive for the duration of the stream. When
        // the stream closure drops, `cancellation_sub` drops, and its `Drop`
        // impl aborts the Redis subscriber task.
        let _cancellation_sub = cancellation_sub;

        // Yield the user message as the first item so other clients can display it
        let user_msg = ChatStream::ChatUserMessage {
            stream_id: stream_id.clone(),
            chat_id: chat_id.clone(),
            message_id: user_message_id,
            content: user_message_content,
            attachments: user_message_attachments,
        };
        if let Ok(json) = serde_json::to_value(&user_msg) {
            yield json;
        }

        let mcp_records = mcp_store.list(&user_id).await.unwrap_or_default();
        let toolset: Arc<dyn ai_toolset::ToolSet<_> + Send + Sync> = Arc::new(
            mcp_client::domain::service::CombinedToolSet::new(static_tools, &mcp_records).await,
        );
        let agent_loop =
            AgentLoop::new(tool_context.recorder.clone()).with_model(&model);
        let rig_messages = agent::to_rig_messages(&request);
        let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::Chat, user_id.clone())
            .with_entity(macro_uuid::string_to_uuid(&chat_id).ok());
        // Carry the feature on the context so tool-spawned subagents attribute to it.
        let mut tool_context = tool_context;
        tool_context.usage_context = usage_ctx.clone();
        let mut session = agent_loop
            .session(toolset, Arc::new(tool_context), &system_prompt, usage_ctx)
            .await;

        // Create the AI stream - yield error if it fails
        let mut ai_stream = match session.send_message(rig_messages).await {
            Ok(stream) => stream,
            Err(e) => {
                tracing::error!(error=?e, chat_id = %chat_id, user_id = %user_id, stream_id = %stream_id, "failed to create AI stream");
                let stream_error = StreamError::InternalError {
                    stream_id: stream_id.clone(),
                };
                if let Ok(json) = serde_json::to_value(ChatStream::Error(stream_error)) {
                    yield json;
                }
                return;
            }
        };

        let mut is_first_token = false;
        let idle_timeout = std::time::Duration::from_secs(3 * 60);
        let mut was_cancelled = false;
        let mut accumulator = StreamAccumulator::new();

        loop {
            let next_item = tokio::select! {
                biased;
                _ = cancellation_token.cancelled() => {
                    tracing::info!(chat_id = %chat_id, user_id = %user_id, stream_id = %stream_id, "AI stream cancelled by user");
                    was_cancelled = true;
                    None
                }
                timed = tokio::time::timeout(idle_timeout, ai_stream.next()) => {
                    match timed {
                        Ok(item) => item,
                        Err(_) => {
                            tracing::error!(chat_id = %chat_id, user_id = %user_id, stream_id = %stream_id, "AI stream idle timeout: no token received within {idle_timeout:?}");
                            let stream_error = StreamError::InternalError {
                                stream_id: stream_id.clone(),
                            };
                            if let Ok(json) = serde_json::to_value(ChatStream::Error(stream_error)) {
                                yield json;
                            }
                            None
                        }
                    }
                }
            };

            let Some(response) = next_item else { break; };
            tracing::trace!("{:#?}", response);

            if !is_first_token {
                is_first_token = true;
                log::log_timing(log::LatencyMetric::TimeToFirstToken, &model, now.elapsed());
            }

            match response {
                Ok(response_chunk) => {
                    // Accumulate the part for persistence; the accumulator merges
                    // consecutive text/thinking when accessed below. Parts with no
                    // persistable content (usage, empty deltas) are skipped here and
                    // are not forwarded to the client.
                    let Some(message_part) = accumulator.push(response_chunk).cloned() else {
                        continue;
                    };

                    let response = ChatStream::ChatMessageResponse {
                        stream_id: stream_id.clone(),
                        chat_id: chat_id.clone(),
                        message_id: message_id.clone(),
                        content: message_part,
                    };

                    if let Ok(json) = serde_json::to_value(&response) {
                        yield json;
                    }
                }
                Err(e) => {
                    tracing::error!(error=?e, chat_id = %chat_id, user_id = %user_id, stream_id = %stream_id, "error in AI stream");
                    let stream_error = StreamError::InternalError {
                        stream_id: stream_id.clone(),
                    };
                    if let Ok(json) = serde_json::to_value(ChatStream::Error(stream_error)) {
                        yield json;
                    }
                    break;
                }
            }
        }

        drop(ai_stream);

        // Send stream end message
        let end_msg = ChatStream::StreamEnd {
            stream_id: stream_id.clone(),
        };
        if let Ok(json) = serde_json::to_value(&end_msg) {
            yield json;
        }
        // Build the set of messages to persist from the parts we yielded.
        // This matches exactly what the user saw in the streamed chunks.
        let new_messages = {
            let resolved_parts = resolve_pending_tool_calls(accumulator.into_parts());
            if resolved_parts.is_empty() {
                vec![]
            } else {
                vec![agent::types::ChatMessage {
                    role: agent::types::Role::Assistant,
                    content: ChatMessageContent::AssistantMessageParts(resolved_parts),
                    attachments: None,
                }]
            }
        };

        // Extract assistant response text before moving new_messages into store
        let assistant_text = new_messages
            .iter()
            .find(|m| m.role == agent::types::Role::Assistant)
            .and_then(|m| m.content.assistant_message_text());

        if let Err(err) = store_conversation_messages(
            ctx.clone(),
            user_id.0.as_ref(),
            &chat_id,
            new_messages,
            &model,
            Some(message_id.clone()),
        )
        .await
        {
            tracing::error!(error=?err, chat_id = %chat_id, user_id = %user_id, stream_id = %stream_id, was_cancelled = was_cancelled, "failed to store conversation messages");
        }

        // Summarize and send notification in a background task. Skip if the
        // stream was cancelled — the user already knows the response stopped
        // and we don't want to notify on a partial reply.
        if !was_cancelled
            && let Some(text) = assistant_text
        {
            notify(
                ctx.connection_repo.clone(),
                ctx.notification_ingress_service.clone(),
                chat_id.clone(),
                message_id.clone(),
                text,
                user_id.clone(),
            );
        }

    };

    ctx_outer.stream_repo.clone().from_async_stream(
        durable_stream_id,
        Box::pin(payload_stream),
        Some(std::time::Duration::from_secs(30 * 60)),
    );
}

#[cfg(test)]
mod test;
