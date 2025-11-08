use crate::context::ServiceContext;
use anyhow::Error;
use model::document::DocumentBasic;
use std::sync::Arc;

pub async fn get_plaintext_content_from_id(
    service_context: Arc<ServiceContext>,
    document_id: &str,
) -> Result<(String, DocumentBasic), Error> {
    service_context
        .content_client
        .document
        .fetch(document_id)
        .document_content()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get document content: {}", e))
        .and_then(|document| {
            let metadata = document.metadata().clone();
            document.content.text_content().map(|text| (text, metadata))
        })
}
