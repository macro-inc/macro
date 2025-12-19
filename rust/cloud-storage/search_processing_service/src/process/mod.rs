mod channel;
mod chat;
pub mod context;
mod document;
mod email;
mod name;
mod project;
mod receiver;
mod user;

pub use receiver::Receiver;

use std::sync::Arc;

use anyhow::Context;
use pollux::MessageProcessor;
use sqs_client::search::SearchQueueMessage;

use crate::process::context::SearchProcessingContext;

/// The processor to process individual search queue messages
pub struct Processor {
    pub ctx: Arc<SearchProcessingContext>,
}

impl MessageProcessor<aws_sdk_sqs::types::Message> for Processor {
    async fn process_message(
        &self,
        message: &aws_sdk_sqs::types::Message,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let message_str = message.body().context("message body is empty")?;

        let search_extractor_message: SearchQueueMessage =
            serde_json::from_str(message_str).context("failed to deserialize message")?;

        tracing::trace!(
            search_extractor_message=?search_extractor_message,
            "received search extractor message"
        );

        match search_extractor_message {
            SearchQueueMessage::UpdateEntityName(message) => {
                name::upsert_name(&self.ctx.opensearch_client, &self.ctx.db, &message).await?;
            }
            SearchQueueMessage::RemoveEntityName(message) => {
                name::remove_name(&self.ctx.opensearch_client, &message).await?;
            }
            SearchQueueMessage::RemoveUserProfile(user_profile_id) => {
                tracing::trace!(user_profile_id = user_profile_id, "removing user profile");
                user::remove_user_profile(&self.ctx.opensearch_client, &user_profile_id).await?;
            }
            SearchQueueMessage::ChannelMessageUpdate(message) => {
                channel::process_channel_message_update(
                    &self.ctx.opensearch_client,
                    &self.ctx.comms_service_client,
                    &message,
                )
                .await?;
            }
            SearchQueueMessage::RemoveChannelMessage(message) => {
                channel::process_remove_channel_message(&self.ctx.opensearch_client, &message)
                    .await?;
            }
            SearchQueueMessage::RemoveEmailLink(message) => {
                email::remove::process_remove_messages_by_link_id(
                    &self.ctx.opensearch_client,
                    &message,
                )
                .await?;
            }
            SearchQueueMessage::ExtractEmailThreadMessage(message) => {
                email::upsert::process_upsert_thread_message(
                    &self.ctx.opensearch_client,
                    &self.ctx.email_client,
                    &message,
                )
                .await?;
            }
            SearchQueueMessage::RemoveEmailMessage(message) => {
                email::remove::process_remove_message(&self.ctx.opensearch_client, &message)
                    .await?;
            }
            SearchQueueMessage::ExtractEmailMessage(message) => {
                email::upsert::process_upsert_message(
                    &self.ctx.opensearch_client,
                    &self.ctx.email_client,
                    &message,
                )
                .await?;
            }
            SearchQueueMessage::RemoveDocument(message) => {
                document::process_remove_message(&self.ctx.opensearch_client, &message).await?;
            }
            SearchQueueMessage::ExtractDocumentText(message) => {
                document::process_extract_text_message(
                    &self.ctx.opensearch_client,
                    &self.ctx.db,
                    &self.ctx.s3_client,
                    &self.ctx.document_storage_bucket,
                    &message,
                )
                .await?;
            }
            SearchQueueMessage::ExtractSync(message) => {
                document::process_extract_sync_message(
                    &self.ctx.opensearch_client,
                    &self.ctx.db,
                    &self.ctx.s3_client,
                    &self.ctx.document_storage_bucket,
                    &self.ctx.lexical_client,
                    &message,
                )
                .await?;
            }
            SearchQueueMessage::ChatMessage(message) => {
                chat::insert_chat_message(&self.ctx.opensearch_client, &self.ctx.db, &message)
                    .await?;
            }
            SearchQueueMessage::RemoveChatMessage(message) => {
                chat::remove_chat_message(&self.ctx.opensearch_client, &message).await?;
            }
            SearchQueueMessage::ProjectMessage(message) => {
                project::insert_project(&self.ctx.opensearch_client, &self.ctx.db, &message)
                    .await?;
            }
            SearchQueueMessage::RemoveProjectMessage(message) => {
                project::remove_project(&self.ctx.opensearch_client, &message).await?;
            }
            SearchQueueMessage::BulkRemoveProjectMessage(message) => {
                project::remove_project_bulk(&self.ctx.opensearch_client, &message).await?;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod test;
