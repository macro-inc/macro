use crate::{
    SQS,
    search::{
        channel::{ChannelMessageUpdate, RemoveChannelMessage},
        chat::{ChatMessage, RemoveChatMessage, UpdateChatMessageMetadata},
        document::{DocumentId, SearchExtractorMessage},
        email::{EmailLinkMessage, EmailMessage, EmailThreadMessage},
        name::UpdateEntityName,
        project::{BulkRemoveProjectMessage, ProjectMessage},
    },
};
use anyhow::Context;
use aws_sdk_sqs::{self as sqs, types::SendMessageBatchRequestEntry};
use strum::Display;

pub mod channel;
pub mod chat;
pub mod document;
pub mod email;
pub mod name;
pub mod project;

use crate::{MAX_BATCH_SIZE, PrimaryId};

impl SQS {
    pub fn search_event_queue(mut self, search_event_queue: &str) -> Self {
        self.search_event_queue = Some(search_event_queue.to_string());
        self
    }

    pub async fn send_message_to_search_event_queue(
        &self,
        message: SearchQueueMessage,
    ) -> anyhow::Result<String> {
        if let Some(search_event_queue) = &self.search_event_queue {
            enqueue_search_text_extractor(&self.inner, search_event_queue, message).await
        } else {
            Err(anyhow::anyhow!("search_event_queue is not configured"))
        }
    }

    pub async fn bulk_send_message_to_search_event_queue(
        &self,
        items: Vec<SearchQueueMessage>,
    ) -> Result<(), anyhow::Error> {
        if let Some(search_event_queue) = &self.search_event_queue {
            bulk_enqueue_search_text_extractor(&self.inner, search_event_queue, items).await
        } else {
            Err(anyhow::anyhow!("search_event_queue is not configured"))
        }
    }
}

#[derive(serde::Serialize, Debug, Display, strum::EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Operation {
    /// Extract text from a particular source to be processed into OpenSearch
    ExtractText,
    /// Updates the metadata for a given item
    UpdateMetadata,
    /// Remove an item from the search index
    Remove,
    /// Extract text from live collab documents to be processed into OpenSearch
    ExtractSync,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub enum SearchQueueMessage {
    // Document
    ExtractDocumentText(SearchExtractorMessage),
    RemoveDocument(DocumentId),
    ExtractSync(SearchExtractorMessage),
    UpdateDocumentMetadata(DocumentId),
    // Chat
    ChatMessage(ChatMessage),
    RemoveChatMessage(RemoveChatMessage),
    UpdateChatMessageMetadata(UpdateChatMessageMetadata),
    // Email
    ExtractEmailMessage(EmailMessage),
    RemoveEmailMessage(EmailMessage),
    ExtractEmailThreadMessage(EmailThreadMessage),
    RemoveEmailLink(EmailLinkMessage),
    // Channel
    ChannelMessageUpdate(ChannelMessageUpdate),
    RemoveChannelMessage(RemoveChannelMessage),
    //  Project
    ProjectMessage(ProjectMessage),
    RemoveProjectMessage(ProjectMessage),
    BulkRemoveProjectMessage(BulkRemoveProjectMessage),

    // User
    RemoveUserProfile(String),

    // Entity Name
    UpdateEntityName(UpdateEntityName),
}

impl PrimaryId for SearchQueueMessage {
    fn id(&self) -> String {
        match self {
            SearchQueueMessage::ExtractDocumentText(message) => message.document_id.clone(),
            SearchQueueMessage::RemoveDocument(message) => message.document_id.clone(),
            SearchQueueMessage::ExtractSync(message) => message.document_id.clone(),
            SearchQueueMessage::ChatMessage(message) => message.message_id.clone(), // needs
            SearchQueueMessage::UpdateChatMessageMetadata(message) => {
                format!("{}update", message.chat_id.clone())
            }
            SearchQueueMessage::UpdateDocumentMetadata(message) => message.document_id.clone(),
            // to be the message id to ensure it's unique for batch
            SearchQueueMessage::RemoveChatMessage(message) => message.chat_id.clone(),
            SearchQueueMessage::ExtractEmailMessage(message)
            | SearchQueueMessage::RemoveEmailMessage(message) => message.message_id.clone(),
            SearchQueueMessage::ExtractEmailThreadMessage(message) => message.thread_id.clone(),
            SearchQueueMessage::RemoveEmailLink(message) => message.link_id.clone(),
            SearchQueueMessage::ChannelMessageUpdate(message) => message.message_id.clone(),
            SearchQueueMessage::RemoveChannelMessage(message) => {
                format!(
                    "{}{}",
                    message.channel_id,
                    message.message_id.clone().unwrap_or_default()
                )
            }
            SearchQueueMessage::ProjectMessage(message) => message.project_id.clone(),
            SearchQueueMessage::RemoveProjectMessage(message) => message.project_id.clone(),
            // NOTE: this trait might not make sense for bulk remove
            SearchQueueMessage::BulkRemoveProjectMessage(message) => message.project_ids[0].clone(),

            SearchQueueMessage::RemoveUserProfile(message) => message.clone(),
            SearchQueueMessage::UpdateEntityName(message) => message.entity_id.clone(),
        }
    }
}

impl SearchQueueMessage {
    pub fn operation(&self) -> Operation {
        match self {
            // Document
            SearchQueueMessage::ExtractDocumentText(_) => Operation::ExtractText,
            SearchQueueMessage::RemoveDocument(_) => Operation::Remove,
            SearchQueueMessage::ExtractSync(_) => Operation::ExtractSync,
            SearchQueueMessage::UpdateDocumentMetadata(_) => Operation::UpdateMetadata,
            // Chat
            SearchQueueMessage::ChatMessage(_) => Operation::ExtractText,
            SearchQueueMessage::RemoveChatMessage(_) => Operation::Remove,
            SearchQueueMessage::UpdateChatMessageMetadata(_) => Operation::UpdateMetadata,
            // Email
            SearchQueueMessage::ExtractEmailMessage(_) => Operation::ExtractText,
            SearchQueueMessage::RemoveEmailMessage(_) => Operation::Remove,
            SearchQueueMessage::ExtractEmailThreadMessage(_) => Operation::ExtractText,
            SearchQueueMessage::RemoveEmailLink(_) => Operation::Remove,
            // Channels
            SearchQueueMessage::ChannelMessageUpdate(_) => Operation::ExtractText,
            SearchQueueMessage::RemoveChannelMessage(_) => Operation::Remove,
            // Projects
            SearchQueueMessage::ProjectMessage(_) => Operation::UpdateMetadata,
            SearchQueueMessage::RemoveProjectMessage(_) => Operation::Remove,
            SearchQueueMessage::BulkRemoveProjectMessage(_) => Operation::Remove,
            // Users
            SearchQueueMessage::RemoveUserProfile(_) => Operation::Remove,
            // Entity Name
            SearchQueueMessage::UpdateEntityName(_) => Operation::UpdateMetadata,
        }
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_search_text_extractor(
    sqs_client: &sqs::Client,
    queue_url: &str,
    message: SearchQueueMessage,
) -> anyhow::Result<String> {
    let message_str = serde_json::to_string(&message)?;

    let result = sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;

    Ok(result
        .message_id
        .context("expected a message id")?
        .to_string())
}

/// Bulk enqueues items to the search text extractor queue
#[tracing::instrument(skip(sqs_client, items))]
pub async fn bulk_enqueue_search_text_extractor(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    items: Vec<SearchQueueMessage>,
) -> anyhow::Result<()> {
    let mut entries: Vec<SendMessageBatchRequestEntry> = vec![];
    for item in items {
        tracing::trace!(item=?item, "enqueueing search text extractor");

        let message_str = serde_json::to_string(&item)?;
        let batch_requesst = SendMessageBatchRequestEntry::builder()
            .id(item.id())
            .message_body(message_str)
            .build()?;

        entries.push(batch_requesst);
    }

    if entries.is_empty() {
        tracing::warn!("no entries to enqueue");
        return Ok(());
    }

    // Batch the entries in chunks of 10 and send each batch separately
    for chunk in entries.chunks(MAX_BATCH_SIZE) {
        let chunk_to_send = chunk.to_vec();

        // Send the batch
        sqs_client
            .send_message_batch()
            .set_entries(Some(chunk_to_send))
            .queue_url(queue_url)
            .send()
            .await?;
    }

    Ok(())
}
