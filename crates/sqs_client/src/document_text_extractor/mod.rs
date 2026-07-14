use aws_sdk_sqs::{self as sqs, types::SendMessageBatchRequestEntry};
use std::collections::HashMap;

use crate::{SQS, message_attribute::build_string_message_attribute};

impl SQS {
    /// Sets the document_text_extractor_queue.
    pub fn document_text_extractor_queue(mut self, document_text_extractor_queue: &str) -> Self {
        self.document_text_extractor_queue = Some(document_text_extractor_queue.to_string());
        self
    }

    /// Enqueues a document for text extraction
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_documents_for_extraction(
        &self,
        // Vec<(document_id [String], bucket [String], key [String])>
        documents: Vec<(String, String, String)>,
    ) -> anyhow::Result<()> {
        if let Some(document_text_extractor_queue) = &self.document_text_extractor_queue {
            return enqueue_documents_for_extraction(
                &self.inner,
                document_text_extractor_queue,
                documents,
            )
            .await;
        }

        Err(anyhow::anyhow!(
            "document_text_extractor_queue is not configured"
        ))
    }
}

#[tracing::instrument(skip(key))]
fn construct_message_attributes(
    bucket: &str,
    key: &str,
) -> anyhow::Result<HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>> {
    let mut message_attributes = HashMap::new();
    message_attributes.insert("key".to_string(), build_string_message_attribute(key)?);
    message_attributes.insert(
        "bucket".to_string(),
        build_string_message_attribute(bucket)?,
    );

    Ok(message_attributes)
}

#[tracing::instrument(skip(sqs_client))]
/// Enqueues a batch of documents for text extraction
/// Can only batch up to 10 documents at a time
pub async fn enqueue_documents_for_extraction(
    sqs_client: &sqs::Client,
    queue_url: &str,
    // Vec<(document_id [String], bucket [String], key [String])>
    documents: Vec<(String, String, String)>,
) -> anyhow::Result<()> {
    let mut entries: Vec<SendMessageBatchRequestEntry> = vec![];
    for (document_id, bucket, key) in documents.iter() {
        let message_attributes = construct_message_attributes(bucket, key)?;
        let batch_requesst = SendMessageBatchRequestEntry::builder()
            .id(document_id)
            .message_body(document_id)
            .set_message_attributes(Some(message_attributes))
            .build()?;

        entries.push(batch_requesst);
    }

    if entries.is_empty() {
        tracing::warn!("no entries to enqueue");
        return Ok(());
    }

    sqs_client
        .send_message_batch()
        .set_entries(Some(entries))
        .queue_url(queue_url)
        .send()
        .await?;

    Ok(())
}
