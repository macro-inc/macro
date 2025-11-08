use super::InsightContextConsumer;
use super::generator::generate_insights;
use crate::context::ServiceContext;
use crate::service::document::{get_plaintext_content_from_id, summarize_document};
use anyhow::{Context, Error};
use macro_db_client::insight::document::create_document_summaries;
use model::chat::{ChatHistory, Summary};
use model::document::DocumentBasic;
use model::insight_context::chat::{AttachmentInsight, ChatContext, Conversation, UserMessage};
use model::insight_context::{UserInsightRecord, document::DocumentSummary};
use std::collections::HashMap;
use std::sync::Arc;

pub const CONTEXT_SOURCE_NAME: &str = "chat";

pub struct ChatInsightContextConsumer;

#[async_trait::async_trait]
impl InsightContextConsumer for ChatInsightContextConsumer {
    fn source_name(&self) -> String {
        CONTEXT_SOURCE_NAME.to_string()
    }

    fn trigger_generation_at_n_messages(&self) -> usize {
        10
    }

    async fn generate_insights(
        &self,
        resource_ids: &[String],
        user_id: &str,
        existing_insights: &[UserInsightRecord],
        service_context: Arc<ServiceContext>,
    ) -> Result<Vec<UserInsightRecord>, Error> {
        tracing::debug!("generate chat insights");
        let history = service_context
            .content_client
            .chat
            .get_chat_history_for_messages(resource_ids, None)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get chat history: {}", e))
            .inspect_err(|err| tracing::error!(error=?err, "failed to fetch chat context"))
            .and_then(|response| {
                if response.conversation.is_empty() {
                    tracing::error!("could not find expected chat context");
                    Err(anyhow::anyhow!("Could not find expected chat context"))
                } else {
                    Ok(response)
                }
            })?;

        // let attachment_ids = deduplicate_attachment_ids(&history);
        // let attachment_insights = get_or_make_summaries(service_context, &attachment_ids)
        //     .await
        //     .context("get or make document insights")?;

        let log_description = "user chatbot conversations including, context about documents the user chose to include";

        let context = summarize_attachments(service_context.clone(), history)
            .await
            .context("failed to summarize attachments")?;

        generate_insights(
            CONTEXT_SOURCE_NAME,
            user_id,
            log_description,
            context.into(),
            existing_insights,
        )
        .await
    }
}

pub async fn summarize_attachments(
    ctx: Arc<ServiceContext>,
    chat_history: ChatHistory,
) -> Result<ChatContext, Error> {
    // helper
    let iterate_attachments = || {
        chat_history.conversation.iter().flat_map(|conversation| {
            conversation
                .messages
                .iter()
                .flat_map(|message| message.attachment_summaries.iter())
        })
    };

    // all attachment document ids
    let document_ids = iterate_attachments()
        .map(|summary| match summary {
            Summary::NoSummary { document_id } => (document_id.as_str(), None),
            Summary::Summary(summary) => (summary.document_id.as_str(), Some(summary.clone())),
        })
        .collect::<HashMap<_, _>>();

    // summarize and save anything that needs summarizing
    let summaries = futures::future::join_all(document_ids.into_iter().map(|(id, summary)| {
        let ctx = ctx.clone();
        async move {
            let summarizer = || async {
                let (text, metadata) = get_plaintext_content_from_id(ctx.clone(), id).await?;
                let summary = summarize_document(text, metadata.clone()).await?;
                let summary = DocumentSummary {
                    created_at: None,
                    id: None,
                    document_id: id.to_owned(),
                    summary,
                    version_id: "latest".to_string(), // content_lib always gets latest version
                };
                let summary = create_document_summaries(&ctx.macro_db, vec![summary])
                    .await?
                    .first()
                    .map(|first| (first.to_owned(), metadata))
                    .ok_or_else(|| anyhow::anyhow!("expected one summary"))?;
                Ok::<(DocumentSummary, DocumentBasic), Error>(summary)
            };

            match summary {
                Some(_existing_summary) => {
                    // Always regenerate summary for now since we can't easily compare versions
                    // TODO: Add version comparison logic if needed
                    summarizer().await
                }
                None => summarizer().await,
            }
        }
    }))
    .await
    .into_iter()
    .flatten()
    .map(|(summary, metadata)| (summary.document_id.clone(), (summary, metadata)))
    .collect::<HashMap<_, _>>();

    let chat_context = ChatContext(
        chat_history
            .conversation
            .into_iter()
            .map(|conversation| Conversation {
                conversation_title: conversation.title,
                messages: conversation
                    .messages
                    .into_iter()
                    .map(|message| UserMessage {
                        content: message.content,
                        date: message.date,
                        attachment_insights: message
                            .attachment_summaries
                            .into_iter()
                            .flat_map(|summary| {
                                summaries
                                    .get(summary.document_id())
                                    .ok_or_else(|| {
                                        anyhow::anyhow!(
                                            "expected summary for {}",
                                            summary.document_id()
                                        )
                                    })
                                    .map(|(summary, metadata)| AttachmentInsight::Document {
                                        file_type: metadata.file_type.clone().unwrap_or_default(),
                                        summary: summary.summary.clone(),
                                        title: metadata.document_name.clone(),
                                    })
                            })
                            .collect(),
                    })
                    .collect(),
            })
            .collect(),
    );
    Ok(chat_context)
}
