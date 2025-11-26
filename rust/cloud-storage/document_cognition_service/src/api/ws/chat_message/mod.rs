mod ai_request;
mod toolset;

use crate::api::ws::connection::{MESSAGE_ABORT_MAP, ws_send};
use crate::core::model::FALLBACK_MODEL;
use crate::model::chats::ChatResponse;
use crate::model::ws::{StreamError, StreamWebSocketError};
use crate::{
    api::{
        context::ApiContext,
        utils::{log, search},
    },
    model::ws::{FromWebSocketMessage, SendChatMessagePayload},
    service::{ai::name::maybe_rename_chat, get_chat::get_chat},
};

use macro_db_client::dcs::create_chat_message::create_chat_message;

use ai::tool::AiClient;
use ai::tool::types::StreamPart;
use ai::types::Role;
use ai::types::{AssistantMessagePart, ChatCompletionRequest, Model};
use ai::types::{ChatMessage, ChatMessageContent};
use ai_request::build_chat_completion_request;
use ai_tools::{AiToolSet, RequestContext, ToolServiceContext};
use anyhow::{Context, Result};
use futures::{future::join_all, stream::StreamExt};
use metering_service_client::{CreateUsageRecordRequest, OperationType, ServiceName};
use model::chat::{NewAttachment, NewChatMessage};
use models_opensearch::SearchEntityType;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::name::EntityName;
use std::sync::Arc;
use tokio;
use tokio::sync::mpsc::UnboundedSender;

// Stores the incoming user message in the database
#[tracing::instrument(err, skip(ctx, chat, incoming_message), fields(chat_id=?incoming_message.chat_id))]
pub async fn store_incoming_message(
    ctx: Arc<ApiContext>,
    user_id: &str,
    chat: &ChatResponse,
    model: Model,
    incoming_message: &SendChatMessagePayload,
) -> Result<String> {
    let created_at = chrono::Utc::now();
    let new_chat_message = NewChatMessage {
        content: ChatMessageContent::Text(incoming_message.content.clone()),
        role: Role::User,
        // Attach the current chat attachments to the user message
        attachments: incoming_message.attachments.as_ref().map(|attachments| {
            attachments
                .iter()
                .cloned()
                .map(|attachment| NewAttachment {
                    attachment_id: attachment.attachment_id,
                    attachment_type: attachment.attachment_type,
                })
                .collect()
        }),
        created_at,
        updated_at: created_at,
        model,
    };

    let user_message_id =
        create_chat_message(ctx.db.clone(), &incoming_message.chat_id, new_chat_message)
            .await
            .context("failed to create chat message")?;

    // Send chat message for search processing
    search::send_chat_message_to_search(
        &ctx,
        &chat.id,
        &user_message_id,
        user_id,
        created_at,
        created_at, // updated_at = created_at
    );

    Ok(user_message_id)
}

pub struct StreamChatResponse {
    pub new_messages: Vec<ChatMessage>,
}

#[tracing::instrument(err, skip(context, user_id, request, sender, jwt_token), fields(chat_id=?chat_id, message_id=?message_id))]
#[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
// Handles streaming the response from the provider back to the
// client over the websocket connection. Returns the response string
pub async fn stream_chat_response(
    context: Arc<ApiContext>,
    user_id: &str,
    request: ChatCompletionRequest,
    toolset: AiToolSet,
    sender: &UnboundedSender<FromWebSocketMessage>,
    chat_id: &str,
    message_id: &str,
    connection_id: &str,
    stream_id: &str,
    jwt_token: &str,
) -> Result<StreamChatResponse, ai::types::AiError> {
    if MESSAGE_ABORT_MAP.contains_key(stream_id) {
        MESSAGE_ABORT_MAP.remove(stream_id);
        return Ok(StreamChatResponse {
            new_messages: Vec::new(), // Return empty for aborted streams
        });
    }
    tracing::trace!(request=?request, "streaming chat request");
    let model = request.model();

    let tool_context = ToolServiceContext {
        email_service_client: context.email_service_client_external.clone(),
        search_service_client: context.search_service_client.clone(),
        scribe: context.scribe.clone(),
    };

    let request_context = RequestContext {
        user_id: user_id.to_string(),
        jwt_token: jwt_token.to_string(),
    };

    let client = AiClient::new(toolset, tool_context);
    let mut chat = client.chat();
    let now = std::time::Instant::now();
    let mut stream = chat
        .send_message(request, request_context, user_id.to_owned())
        .await?;

    // Process the stream completely
    let mut usage_reqs = vec![];
    let mut is_first_token = false;
    while let Some(response) = stream.next().await {
        tracing::trace!("{:#?}", response);
        if !is_first_token {
            is_first_token = true;
            log::log_timing(log::LatencyMetric::TimeToFirstToken, model, now.elapsed());
        }
        let response_chunk = response?;
        // Abort streaming for a message if it has been stopped
        if MESSAGE_ABORT_MAP.contains_key(stream_id) {
            MESSAGE_ABORT_MAP.remove(stream_id);
            return Ok(StreamChatResponse {
                new_messages: Vec::new(), // Return empty for aborted streams
            });
        }

        // We need this in the near future
        match response_chunk {
            StreamPart::Content(content) => {
                if content.is_empty() {
                    continue;
                }

                let message_part = AssistantMessagePart::Text { text: content };

                // Send to websocket
                let response = FromWebSocketMessage::ChatMessageResponse {
                    stream_id: stream_id.to_string(),
                    chat_id: chat_id.to_string(),
                    message_id: message_id.to_string(),
                    content: message_part,
                };
                ws_send(sender, response);
            }
            StreamPart::ToolCall(call) => {
                let message_part = AssistantMessagePart::ToolCall {
                    name: call.name,
                    json: call.json,
                    id: call.id,
                };

                let response = FromWebSocketMessage::ChatMessageResponse {
                    stream_id: stream_id.to_string(),
                    chat_id: chat_id.to_string(),
                    message_id: message_id.to_string(),
                    content: message_part,
                };
                ws_send(sender, response);
            }
            StreamPart::Usage(usage) => {
                tracing::debug!(record=?usage, "usage");
                usage_reqs.push(context.metering_client.record_usage(
                    CreateUsageRecordRequest::new(
                        usage.clone(),
                        true,
                        model,
                        user_id.to_string(),
                        ServiceName::DocumentCognitionService,
                        OperationType::Chat,
                    ),
                ));
            }
            StreamPart::ToolResponse(ai::tool::types::ToolResponse::Json { id, json, name }) => {
                let message_part = AssistantMessagePart::ToolCallResponseJson { name, json, id };

                ws_send(
                    sender,
                    FromWebSocketMessage::ChatMessageResponse {
                        stream_id: stream_id.to_string(),
                        message_id: message_id.to_string(),
                        chat_id: chat_id.to_string(),
                        content: message_part,
                    },
                )
            }
            StreamPart::ToolResponse(ai::tool::types::ToolResponse::Err {
                id,
                name,
                description,
            }) => {
                let message_part = AssistantMessagePart::ToolCallErr {
                    name,
                    description,
                    id,
                };

                ws_send(
                    sender,
                    FromWebSocketMessage::ChatMessageResponse {
                        stream_id: stream_id.to_string(),
                        message_id: message_id.to_string(),
                        chat_id: chat_id.to_string(),
                        content: message_part,
                    },
                )
            }
        }
    }
    let _ = join_all(usage_reqs).await;

    // Explicitly drop the stream to release the mutable borrow
    drop(stream);

    // Get new messages - no finalization needed since we only save on disconnect
    let new_messages = chat.get_new_conversation_messages();

    Ok(StreamChatResponse { new_messages })
}

/// Stores multiple conversation messages to the database
#[tracing::instrument(err, skip(ctx, messages), fields(chat_id=?chat_id, message_count=messages.len()))]
pub async fn store_conversation_messages(
    ctx: Arc<ApiContext>,
    user_id: &str,
    chat_id: &str,
    messages: Vec<ChatMessage>,
    model: Model,
) -> Result<Vec<String>> {
    if messages.is_empty() {
        return Ok(vec![]);
    }

    let mut message_ids = Vec::new();

    let created_at = chrono::Utc::now();

    for message in messages {
        let new_chat_message = model::chat::NewChatMessage {
            content: message.content,
            role: message.role,
            attachments: None, // New messages from streaming don't have attachments (they are asssistant messages)
            model,
            created_at,
            updated_at: created_at,
        };

        let message_id = create_chat_message(ctx.db.clone(), chat_id, new_chat_message)
            .await
            .context("failed to create chat message")?;

        message_ids.push(message_id.clone());

        // Send each message for search processing
        search::send_chat_message_to_search(
            &ctx,
            chat_id,
            &message_id,
            user_id,
            created_at,
            created_at, // updated_at = created_at
        );
    }

    Ok(message_ids)
}

/// Handles incoming messages of type `send_message`
#[tracing::instrument(skip(ctx, sender, incoming_message, jwt_token), fields(chat_id=?incoming_message.chat_id, stream_id=?incoming_message.stream_id))]
pub async fn handle_send_chat_message(
    sender: &UnboundedSender<FromWebSocketMessage>,
    ctx: Arc<ApiContext>,
    message_id: String,
    incoming_message: SendChatMessagePayload,
    user_id: &str,
    connection_id: &str,
    jwt_token: &str,
) -> Result<(), StreamWebSocketError> {
    let now = std::time::Instant::now();
    let chat = get_chat(&ctx, &incoming_message.chat_id, user_id)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "failed to get chat");
            StreamError::InternalError {
                stream_id: incoming_message.stream_id.clone(),
            }
        })?;
    let is_first_message = chat.messages.is_empty();
    let model = FALLBACK_MODEL;

    let user_message_id =
        store_incoming_message(ctx.clone(), user_id, &chat, model, &incoming_message)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "failed to store incoming message");
                StreamError::InternalError {
                    stream_id: incoming_message.stream_id.clone(),
                }
            })?;

    let toolset = toolset::choose_toolset(&incoming_message);
    let request =
        build_chat_completion_request(ctx.clone(), &chat, &incoming_message, toolset.prompt)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "failed to build chat completion request");
                StreamError::InternalError {
                    stream_id: incoming_message.stream_id.clone(),
                }
            })?;

    log::log_timing(log::LatencyMetric::TimeToSendRequest, model, now.elapsed());
    let StreamChatResponse { new_messages } = stream_chat_response(
        ctx.clone(),
        user_id,
        request.clone(),
        toolset.toolset,
        sender,
        incoming_message.chat_id.as_str(),
        message_id.as_str(),
        connection_id,
        incoming_message.stream_id.as_str(),
        jwt_token,
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "failed to stream chat response");
        match err {
            ai::types::AiError::ContextWindowExceeded => StreamError::ModelContextOverflow {
                stream_id: incoming_message.stream_id.clone(),
            },
            ai::types::AiError::Generic(_) => StreamError::InternalError {
                stream_id: incoming_message.stream_id.clone(),
            },
        }
    })?;

    ws_send(
        sender,
        FromWebSocketMessage::StreamEnd {
            stream_id: incoming_message.stream_id.clone(),
        },
    );

    store_conversation_messages(
        ctx.clone(),
        user_id,
        &incoming_message.chat_id,
        new_messages,
        model,
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "failed to store conversation messages");
        StreamError::InternalError {
            stream_id: incoming_message.stream_id.clone(),
        }
    })?;

    // The chat is empty and we want to auto generate a name for the chat
    if is_first_message {
        let _ = maybe_rename_chat(&incoming_message.chat_id, &ctx, user_id)
            .await
            .inspect_err(|err| tracing::error!(error=?err, "failed to rename chat"))
            .map(|new_name| {
                ws_send(
                    sender,
                    FromWebSocketMessage::ChatRenamed {
                        chat_id: incoming_message.chat_id.clone(),
                        stream_id: incoming_message.stream_id.clone(),
                        name: new_name,
                    },
                )
            });

        // Send the message to the search event queue for setting chat name
        match macro_uuid::string_to_uuid(&incoming_message.chat_id) {
            Ok(chat_id) => {
                let _ = ctx.sqs_client.send_message_to_search_event_queue(
                    SearchQueueMessage::UpdateEntityName(EntityName {
                        entity_id: chat_id,
                        entity_type: SearchEntityType::Chats,
                    }),
                ).await.inspect_err(|err| tracing::error!(error=?err, "failed to send message to search event queue"));
            }
            Err(err) => {
                tracing::error!(error=?err, "failed to convert chat_id to uuid");
            }
        }
    }
    ctx.context_provider_client
        .provide_context(user_id, &user_message_id)
        .await;
    Ok(())
}
