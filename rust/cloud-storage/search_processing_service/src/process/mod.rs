mod channel;
mod chat;
pub mod context;
mod document;
mod email;
mod project;
mod user;
pub mod worker;

use anyhow::Context;
use sqs_client::search::SearchQueueMessage;

use crate::process::context::SearchProcessingContext;

/// Processes a message from the search text extractor queue.
/// If the processing  is successful, the message is deleted.
#[tracing::instrument(skip(ctx, message), fields(message_id=message.message_id))]
pub async fn process_message(
    ctx: &SearchProcessingContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    let start_time = std::time::Instant::now();

    let message_str = message.body().context("message body is empty")?;

    let search_extractor_message: SearchQueueMessage =
        serde_json::from_str(message_str).context("failed to deserialize message")?;

    tracing::trace!(
        search_extractor_message=?search_extractor_message,
        "received search extractor message"
    );

    match search_extractor_message {
        SearchQueueMessage::UpdateEntityName(_message) => {
            todo!()
        }
        SearchQueueMessage::RemoveUserProfile(user_profile_id) => {
            tracing::trace!(user_profile_id = user_profile_id, "removing user profile");
            user::remove_user_profile(&ctx.opensearch_client, &user_profile_id).await?;
        }
        SearchQueueMessage::UpdateDocumentMetadata(message) => {
            document::process_update_metadata_message(
                &ctx.opensearch_client,
                &ctx.db,
                &message.document_id,
            )
            .await?;
        }
        SearchQueueMessage::ChannelMessageUpdate(message) => {
            channel::process_channel_message_update(
                &ctx.opensearch_client,
                &ctx.comms_service_client,
                &message,
            )
            .await?;
        }
        SearchQueueMessage::RemoveChannelMessage(message) => {
            channel::process_remove_channel_message(&ctx.opensearch_client, &message).await?;
        }
        SearchQueueMessage::RemoveEmailLink(message) => {
            email::remove::process_remove_messages_by_link_id(&ctx.opensearch_client, &message)
                .await?;
        }
        SearchQueueMessage::ExtractEmailThreadMessage(message) => {
            email::upsert::process_upsert_thread_message(
                &ctx.opensearch_client,
                &ctx.email_client,
                &message,
            )
            .await?;
        }
        SearchQueueMessage::RemoveEmailMessage(message) => {
            email::remove::process_remove_message(&ctx.opensearch_client, &message).await?;
        }
        SearchQueueMessage::ExtractEmailMessage(message) => {
            email::upsert::process_upsert_message(
                &ctx.opensearch_client,
                &ctx.email_client,
                &message,
            )
            .await?;
        }
        SearchQueueMessage::RemoveDocument(message) => {
            document::process_remove_message(&ctx.opensearch_client, &message).await?;
        }
        SearchQueueMessage::ExtractDocumentText(message) => {
            document::process_extract_text_message(
                &ctx.opensearch_client,
                &ctx.db,
                &ctx.s3_client,
                &ctx.document_storage_bucket,
                &message,
            )
            .await?;
        }
        SearchQueueMessage::ExtractSync(message) => {
            document::process_extract_sync_message(
                &ctx.opensearch_client,
                &ctx.db,
                &ctx.s3_client,
                &ctx.document_storage_bucket,
                &ctx.lexical_client,
                &message,
            )
            .await?;
        }
        SearchQueueMessage::ChatMessage(message) => {
            chat::insert_chat_message(&ctx.opensearch_client, &ctx.db, &message).await?;
        }
        SearchQueueMessage::RemoveChatMessage(message) => {
            chat::remove_chat_message(&ctx.opensearch_client, &message).await?;
        }
        SearchQueueMessage::UpdateChatMessageMetadata(message) => {
            chat::update_chat_message_metadata(&ctx.opensearch_client, &ctx.db, &message).await?;
        }
        SearchQueueMessage::ProjectMessage(message) => {
            project::insert_project(&ctx.opensearch_client, &ctx.db, &message).await?;
        }
        SearchQueueMessage::RemoveProjectMessage(message) => {
            project::remove_project(&ctx.opensearch_client, &message).await?;
        }
        SearchQueueMessage::BulkRemoveProjectMessage(message) => {
            project::remove_project_bulk(&ctx.opensearch_client, &message).await?;
        }
    }

    ctx.worker.cleanup_message(message).await?;

    tracing::trace!(time_elapsed=?start_time.elapsed(), "message processed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::document::FileType;
    use sqs_client::search::document::SearchExtractorMessage;

    #[test]
    fn test_deserialize_search_extractor_message() {
        let message = serde_json::json!({
            "user_id": "user_id",
            "document_id": "document_id",
            "file_type": "pdf"
        });
        let message: SearchExtractorMessage = serde_json::from_value(message).unwrap();

        assert_eq!(
            message,
            SearchExtractorMessage {
                user_id: "user_id".to_string(),
                document_id: "document_id".to_string(),
                file_type: FileType::Pdf,
                document_version_id: None,
            }
        );

        let message = serde_json::json!({
            "user_id": "user_id",
            "document_id": "document_id",
            "file_type": "docx",
            "document_version_id": "1"
        });
        let message: SearchExtractorMessage = serde_json::from_value(message).unwrap();

        assert_eq!(
            message,
            SearchExtractorMessage {
                user_id: "user_id".to_string(),
                document_id: "document_id".to_string(),
                file_type: FileType::Docx,
                document_version_id: Some("1".to_string()),
            }
        );

        let message = serde_json::json!({
            "user_id": "user_id",
            "document_id": "document_id",
            "file_type": "BAD ONE"
        });
        let error = serde_json::from_value::<SearchExtractorMessage>(message).unwrap_err();

        assert!(error.to_string().starts_with("unknown variant `BAD ONE`"));
    }

    #[test]
    fn test_deserialize_search_queue_message() -> anyhow::Result<()> {
        let message_str = r#"{"ExtractDocumentText":{"user_id":"macro|teo@macro.com","document_id":"253880fb-77d4-4e6c-856d-9f52c2d9a8b0","file_type":"md","document_version_id":"565533"}}"#;

        let search_extractor_message: SearchQueueMessage =
            serde_json::from_str(message_str).context("failed to deserialize message")?;

        assert_eq!(
            search_extractor_message,
            SearchQueueMessage::ExtractDocumentText(SearchExtractorMessage {
                user_id: "macro|teo@macro.com".to_string(),
                document_id: "253880fb-77d4-4e6c-856d-9f52c2d9a8b0".to_string(),
                file_type: FileType::Md,
                document_version_id: Some("565533".to_string()),
            })
        );

        Ok(())
    }
}
