//! Maps document lifecycle events to search-index actions and processes them.

use documents::domain::events::{DocumentMacroEvent, DocumentTopicEvent};
use macro_event_broker::MacroEvent as _;
use model::document::FileType;
use sqs_client::search::document::SearchExtractorMessage;

use super::{Attempted, Attempts, Handled, KafkaProcessingContext};
use crate::process::document::{
    process_extract_sync_message, process_extract_text_message, process_release_email_attachments,
    process_remove_message, process_update_name_message,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum DocumentIndexAction {
    ExtractText {
        owner: String,
        file_type: FileType,
        document_version_id: Option<String>,
    },
    ExtractSync {
        file_type: FileType,
        document_version_id: Option<String>,
    },
    RefreshName,
    Remove,
    /// The documents stopped being email attachments.
    ReleaseEmailAttachments {
        document_ids: Vec<String>,
    },
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DocumentEventDescription {
    pub(super) action: DocumentIndexAction,
    pub(super) document_id: String,
    pub(super) event_type: &'static str,
}

pub(super) fn describe_document_event(event: &DocumentTopicEvent) -> DocumentEventDescription {
    match event {
        DocumentTopicEvent::Created(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::Ignore,
            document_id: metadata.document_id.clone(),
            event_type: "document.created",
        },
        DocumentTopicEvent::Updated(metadata) => DocumentEventDescription {
            action: if metadata.document_name.is_some() {
                DocumentIndexAction::RefreshName
            } else {
                DocumentIndexAction::Ignore
            },
            document_id: metadata.document_id.clone(),
            event_type: "document.updated",
        },
        DocumentTopicEvent::Deleted(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::Ignore,
            document_id: metadata.document_id.clone(),
            event_type: "document.deleted",
        },
        DocumentTopicEvent::ContentUploaded(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::ExtractText {
                owner: metadata.owner.to_string(),
                file_type: metadata.file_type,
                document_version_id: metadata.document_version_id.clone(),
            },
            document_id: metadata.document_id.clone(),
            event_type: "document.content_uploaded",
        },
        DocumentTopicEvent::SyncContentUpdated(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::ExtractSync {
                file_type: metadata.file_type,
                document_version_id: metadata.document_version_id.clone(),
            },
            document_id: metadata.document_id.clone(),
            event_type: "document.sync_content_updated",
        },
        DocumentTopicEvent::Purged(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::Remove,
            document_id: metadata.document_id.clone(),
            event_type: "document.purged",
        },
        DocumentTopicEvent::Copied(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::Ignore,
            document_id: metadata.document_id.clone(),
            event_type: "document.copied",
        },
        DocumentTopicEvent::Interaction(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::Ignore,
            document_id: metadata.document_id.clone(),
            event_type: "document.interaction",
        },
        // Trashed and kept documents alike lost their last email link; the
        // trash itself leaves the index alone, as document.deleted does.
        DocumentTopicEvent::EmailAttachmentsReleased(metadata) => DocumentEventDescription {
            action: DocumentIndexAction::ReleaseEmailAttachments {
                document_ids: metadata
                    .trashed_document_ids
                    .iter()
                    .chain(&metadata.kept_document_ids)
                    .cloned()
                    .collect(),
            },
            document_id: metadata
                .trashed_document_ids
                .first()
                .or(metadata.kept_document_ids.first())
                .cloned()
                .unwrap_or_default(),
            event_type: "document.email_attachments_released",
        },
    }
}

pub(super) fn stored_extractor_message(
    document_id: &str,
    owner: String,
    file_type: FileType,
    document_version_id: Option<String>,
) -> SearchExtractorMessage {
    SearchExtractorMessage {
        user_id: owner,
        document_id: document_id.to_string(),
        file_type,
        document_version_id,
        index_override: None,
    }
}

pub(super) fn sync_extractor_message(
    document_id: &str,
    file_type: FileType,
    document_version_id: Option<String>,
) -> SearchExtractorMessage {
    SearchExtractorMessage {
        user_id: String::new(),
        document_id: document_id.to_string(),
        file_type,
        document_version_id,
        index_override: None,
    }
}

async fn process_document_index_action(
    context: &KafkaProcessingContext,
    document_id: &str,
    action: DocumentIndexAction,
) -> anyhow::Result<()> {
    let opensearch_client = context.opensearch_client.as_ref();

    match action {
        DocumentIndexAction::ExtractText {
            owner,
            file_type,
            document_version_id,
        } => {
            let message =
                stored_extractor_message(document_id, owner, file_type, document_version_id);
            process_extract_text_message(
                opensearch_client,
                &context.db,
                context.s3_client.as_ref(),
                &context.document_storage_bucket,
                &message,
            )
            .await
        }
        DocumentIndexAction::ExtractSync {
            file_type,
            document_version_id,
        } => {
            let message = sync_extractor_message(document_id, file_type, document_version_id);
            process_extract_sync_message(
                opensearch_client,
                &context.db,
                context.s3_client.as_ref(),
                &context.document_storage_bucket,
                context.lexical_client.as_ref(),
                &message,
            )
            .await
        }
        DocumentIndexAction::RefreshName => {
            process_update_name_message(opensearch_client, &context.db, document_id).await
        }
        DocumentIndexAction::Remove => process_remove_message(opensearch_client, document_id).await,
        DocumentIndexAction::ReleaseEmailAttachments { document_ids } => {
            process_release_email_attachments(opensearch_client, &document_ids).await
        }
        DocumentIndexAction::Ignore => Ok(()),
    }
}

pub(super) async fn process_document_event(
    context: &KafkaProcessingContext,
    event: &DocumentMacroEvent,
    partition: i32,
    offset: i64,
    attempts: &Attempts,
) -> Attempted {
    let description = describe_document_event(&event.event().event);
    let document_id = description.document_id.as_str();
    let event_type = description.event_type;

    if description.action == DocumentIndexAction::Ignore {
        tracing::trace!(
            document_id,
            event_type,
            partition,
            offset,
            "ignoring document event without a search-index action"
        );
        return Ok((Handled::Ignored, 0));
    }

    attempts
        .run(|attempt| {
            let action = description.action.clone();
            async move {
                tracing::trace!(
                    document_id,
                    event_type,
                    partition,
                    offset,
                    attempt,
                    "processing document search-index event"
                );
                process_document_index_action(context, document_id, action).await
            }
        })
        .await
}
