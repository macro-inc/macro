/* A completion without a chat or attachments */
use crate::api::context::ApiContext;
use crate::core::constants::DEFAULT_MAX_TOKENS;
use crate::model::ws::{FromWebSocketMessage, GetSimpleCompletionStreamPayload, WebSocketError};
use crate::service::attachment::document::get_document_plaintext_content;
use ai::chat_stream::get_chat_stream;
use ai::types::{ChatStreamCompletionResponse, MessageBuilder, Model, RequestBuilder};
use anyhow::Result;
use futures::StreamExt;
use futures::future::join_all;
use metering_service_client::{CreateUsageRecordRequest, OperationType, ServiceName};
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedSender;

use macro_db_client::dcs::get_document;
use macro_db_client::dcs::get_document_text;

const SIMPLE_COMPLETION_DEFAULT_MODEL: Model = Model::OpenAIGPT4oMini;

pub async fn handle_simple_completion(
    ctx: Arc<ApiContext>,
    sender: &UnboundedSender<FromWebSocketMessage>,
    payload: &GetSimpleCompletionStreamPayload,
    user_id: &str,
) -> Result<(), WebSocketError> {
    // Fetch document content if document_id is provided
    let mut system_prompt: String = payload.prompt.clone();
    if let Some(document_ids) = &payload.content_document_ids {
        let db = &ctx.db;

        // This might have to be reworked when we have use cases that have multiple attachments
        for document_id in document_ids.iter() {
            let document = get_document::get_document(db, document_id)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, document_id, "failed to get document metadata");
                    e
                })?;
            let document_content =
                if ["pdf", "docx"].contains(&document.unwrap().file_type.as_str()) {
                    get_document_text::get_pdf_docx_document_text(db.clone(), document_id)
                        .await
                        .map_err(|e| {
                            tracing::error!(error = %e, document_id, "failed to get document text");
                            anyhow::Error::new(e)
                        })?
                        .content
                } else {
                    get_document_plaintext_content(&ctx, document_id)
                        .await?
                        .text_content()?
                };
            // check if document content is empty
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

    let model = payload.model.unwrap_or(SIMPLE_COMPLETION_DEFAULT_MODEL);
    let request = RequestBuilder::new()
        .model(model)
        .max_tokens(payload.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS))
        .messages(vec![
            MessageBuilder::new()
                .user()
                .content(payload.user_request.clone())
                .build(),
        ])
        .system_prompt(system_prompt)
        .build();

    let mut stream = get_chat_stream(request).await?;
    let mut cumulative_content = String::new();
    let mut usage_reqs = vec![];
    while let Some(response) = stream.next().await {
        let parts = response?;
        for part in parts {
            let ChatStreamCompletionResponse::Content(content) = part;
            cumulative_content.push_str(&content.content);
            let message = FromWebSocketMessage::CompletionStreamChunk {
                completion_id: payload.completion_id.clone(),
                content: cumulative_content.clone(),
                done: false,
            };
            sender.send(message).map_err(|err| {
                tracing::error!(error = %err, "failed to send completion message");
                WebSocketError::FailedToSendWebsocketMessage {
                    details: Some(err.to_string()),
                }
            })?;
            if let Some(usage) = &content.usage {
                usage_reqs.push(
                    ctx.metering_client
                        .record_usage(CreateUsageRecordRequest::new(
                            usage.clone(),
                            true,
                            model,
                            user_id.to_string(),
                            ServiceName::DocumentCognitionService,
                            OperationType::SimpleStreamCompletion,
                        )),
                );
            }
        }
    }
    let _ = join_all(usage_reqs).await;
    let message = FromWebSocketMessage::CompletionStreamChunk {
        completion_id: payload.completion_id.clone(),
        content: cumulative_content.clone(),
        done: true,
    };
    sender.send(message).map_err(|err| {
        tracing::error!(error = %err, "failed to send completion message");
        WebSocketError::FailedToSendWebsocketMessage {
            details: Some(err.to_string()),
        }
    })?;
    Ok(())
}
