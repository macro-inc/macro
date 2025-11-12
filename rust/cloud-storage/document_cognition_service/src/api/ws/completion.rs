/* This is misnamed - this is a pdf completion only for the "generalized popup" */
use aho_corasick::AhoCorasick;
use anyhow::{Context, Result};
use metering_service_client::{CreateUsageRecordRequest, OperationType, ServiceName};
use model::document::FileType;
use regex::Regex;
use std::{str::FromStr, sync::Arc};
use tracing::instrument;
use uuid::Uuid;

use ai::{
    chat_stream::get_chat_stream,
    types::{ChatCompletionRequest, ChatMessage, ChatStreamCompletionResponse, PromptAttachment},
};
use tokio::sync::mpsc::UnboundedSender;

use futures::{future::join_all, stream::StreamExt};

use crate::{
    api::context::ApiContext,
    core::constants::DEFAULT_MAX_TOKENS,
    core::model::{COMPLETION_CONTEXT_WINDOW, COMPLETION_MODEL},
    model::ws::{FromWebSocketMessage, SendCompletionPayload, WebSocketError},
    service::attachment::document::get_document_plaintext_content,
};

use macro_db_client::dcs::{
    get_document::get_document, get_document_text::get_pdf_docx_document_text,
};

use super::connection::ws_send;

pub fn normalize_text(text: &str) -> String {
    Regex::new(r"\[\[.*?\]\]")
        .map_or_else(
            |_| text.to_string(),
            |pattern| pattern.replace_all(text, "").to_string(),
        )
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .replace("\n", " ")
        .replace("\t", " ")
        .replace("\r", " ")
}

#[tracing::instrument(err, skip(document))]
fn find_text_context(document: &str, selected_text: &str) -> Result<Option<String>> {
    let normalized_content = normalize_text(document);
    let normalized_pattern = normalize_text(selected_text);

    let ac = AhoCorasick::builder()
        .ascii_case_insensitive(true)
        .match_kind(aho_corasick::MatchKind::Standard)
        .build(vec![&normalized_pattern])?;

    Ok(ac.find_iter(&normalized_content).next().map(|m| {
        // UTF-8 encoded special characters (like the minus sign '−') can span multiple bytes
        let bytes = normalized_content.as_bytes();
        let start = (m.start() as i32 - (COMPLETION_CONTEXT_WINDOW / 2)).max(0) as usize;
        let end = (m.end() + (COMPLETION_CONTEXT_WINDOW / 2) as usize).min(bytes.len());

        String::from_utf8_lossy(&bytes[start..end]).into_owned()
    }))
}

#[tracing::instrument(err, skip(ctx, payload))]
async fn build_completion_request(
    ctx: Arc<ApiContext>,
    payload: &SendCompletionPayload,
) -> Result<ChatCompletionRequest> {
    let mut prompt_attachments: Vec<PromptAttachment> = vec![];

    if let (Some(attachment_id), Some(selected_text)) = (
        payload.attachment_id.as_ref(),
        payload.selected_text.as_ref(),
    ) {
        let document = get_document(&ctx.db, attachment_id)
            .await
            .context("failed to get document")?;

        match document {
            Some(document) => {
                let file_type = FileType::from_str(&document.file_type);

                match file_type {
                    Err(_) => {
                        tracing::warn!(document_id=%attachment_id, "document type is missing");
                    }
                    Ok(f @ FileType::Pdf) | Ok(f @ FileType::Docx) => {
                        let document_text =
                            get_pdf_docx_document_text(ctx.db.clone(), attachment_id).await?;
                        if let Some(context) =
                            find_text_context(&document_text.content, selected_text)?
                        {
                            prompt_attachments.push(PromptAttachment {
                                id: attachment_id.to_string(),
                                file_type: f.as_str().to_string(),
                                name: document.name,
                                content: context,
                            });
                        } else {
                            tracing::warn!(
                                document_id=%attachment_id,
                                selected_text = selected_text,
                                "could not find matches for completion"
                            );
                        }
                    }
                    Ok(file_type) => {
                        let content = get_document_plaintext_content(&ctx, attachment_id)
                            .await?
                            .text_content()?;
                        if content.chars().filter(|c| !c.is_whitespace()).count() == 0 {
                            tracing::warn!(
                                document_id=%attachment_id,
                                "document content is empty"
                            );
                        } else {
                            prompt_attachments.push(PromptAttachment {
                                id: attachment_id.to_string(),
                                file_type: file_type.as_str().to_string(),
                                name: document.name,
                                content,
                            });
                        }
                    }
                }
            }
            None => {
                tracing::warn!(document_id=%attachment_id, "document does not exist");
            }
        }
    }

    let messages: Vec<ChatMessage> = vec![ChatMessage {
        role: ai::types::Role::User,
        content: ai::types::ChatMessageContent::Text(payload.prompt.clone()),
        image_urls: None,
    }];
    let request = ai::types::RequestBuilder::new()
        .system_prompt(ai_tools::prompts::BASE_PROMPT)
        .attachments(prompt_attachments)
        .messages(messages)
        .max_tokens(DEFAULT_MAX_TOKENS)
        .model(COMPLETION_MODEL)
        .build();

    Ok(request)
}

#[instrument(skip_all, err, fields(user_id, request, completion_id))]
async fn stream_completion(
    request: ChatCompletionRequest,
    sender: &UnboundedSender<FromWebSocketMessage>,
    completion_id: &str,
    user_id: &str,
    ctx: Arc<ApiContext>,
) -> Result<()> {
    let model = request.model();
    tracing::debug!("stream_completion get chat stream {:#?}", request);
    let mut stream = get_chat_stream(request)
        .await
        .context("failed to get chat stream")?;
    let mut response_message = String::new();
    let mut usage_reqs = vec![];
    while let Some(response) = stream.next().await {
        let parts = response.context("failed to get response message")?;
        for part in parts {
            let ChatStreamCompletionResponse::Content(content) = part;
            response_message.push_str(&content.content);

            let response = FromWebSocketMessage::CompletionResponse {
                completion_id: completion_id.to_string(),
                content: response_message.clone(),
                done: false,
            };

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

            ws_send(sender, response);
        }
    }
    let _ = join_all(usage_reqs).await;

    ws_send(
        sender,
        FromWebSocketMessage::CompletionResponse {
            completion_id: completion_id.to_string(),
            content: response_message,
            done: true,
        },
    );

    Ok(())
}

#[tracing::instrument(skip_all, fields(user_id, completion_id=?payload.completion_id), err)]
pub async fn send_completion_handler(
    ctx: Arc<ApiContext>,
    sender: &UnboundedSender<FromWebSocketMessage>,
    payload: &SendCompletionPayload,
    user_id: &str,
) -> Result<(), WebSocketError> {
    let completion_id = payload
        .completion_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    tracing::debug!("build completion request for send_completion_handler");
    let request = build_completion_request(ctx.clone(), payload)
        .await
        .context("build completion request")?;

    stream_completion(request, sender, &completion_id, user_id, ctx)
        .await
        .context("failed to stream completion")?;

    Ok(())
}
