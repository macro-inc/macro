//! SQS adapter for project search indexing and document deletion.

use std::sync::Arc;

use sqs_client::search::{
    SearchQueueMessage,
    chat::RemoveChatMessage,
    document::DocumentId,
    project::{RemoveProject, UpsertProject},
};

use crate::domain::ports::ProjectSearchIndexer;

/// SQS-backed project search-index and document-deletion adapter.
#[derive(Clone)]
pub struct SqsProjectSearchIndexer {
    sqs: Arc<sqs_client::SQS>,
}

impl SqsProjectSearchIndexer {
    /// Create a project search indexer from the shared SQS client.
    pub fn new(sqs: Arc<sqs_client::SQS>) -> Self {
        Self { sqs }
    }
}

impl ProjectSearchIndexer for SqsProjectSearchIndexer {
    #[tracing::instrument(skip(self), err)]
    async fn upsert_projects(&self, project_ids: Vec<String>) -> anyhow::Result<()> {
        let messages = project_ids
            .into_iter()
            .map(|project_id| {
                SearchQueueMessage::UpsertProject(UpsertProject {
                    project_id,
                    index_override: None,
                })
            })
            .collect();

        self.sqs
            .bulk_send_message_to_search_event_queue(messages)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_projects(&self, project_ids: Vec<String>) -> anyhow::Result<()> {
        let messages = project_ids
            .into_iter()
            .map(|project_id| {
                SearchQueueMessage::RemoveProject(RemoveProject {
                    project_id,
                    index_override: None,
                })
            })
            .collect();

        self.sqs
            .bulk_send_message_to_search_event_queue(messages)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_chats(&self, chat_ids: Vec<String>) -> anyhow::Result<()> {
        let messages = chat_ids
            .into_iter()
            .map(|chat_id| {
                SearchQueueMessage::RemoveChatMessage(RemoveChatMessage {
                    chat_id,
                    message_id: None,
                    index_override: None,
                })
            })
            .collect();

        self.sqs
            .bulk_send_message_to_search_event_queue(messages)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_documents(&self, document_ids: Vec<String>) -> anyhow::Result<()> {
        let messages = document_ids
            .into_iter()
            .map(|document_id| SearchQueueMessage::RemoveDocument(DocumentId { document_id }))
            .collect();

        self.sqs
            .bulk_send_message_to_search_event_queue(messages)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn enqueue_document_deletes(
        &self,
        documents: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        self.sqs
            .bulk_enqueue_document_delete_with_owner(documents)
            .await
    }
}
