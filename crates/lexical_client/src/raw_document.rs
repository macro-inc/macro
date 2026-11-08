//! Sync transport boundary used only by local document-ID exports.
use anyhow::Result;
use sync_service_client::SyncServiceClient;

/// Read a live stored document. Callers must already hold document access.
// Object safety lets each composition root supply the existing sync client or
// a hand-written fake without adding runtime generics to every domain port.
#[async_trait::async_trait]
pub trait RawDocumentSource: Send + Sync {
    /// Fetch the serialized editor state using the caller's internal capability.
    async fn get_raw(&self, document_id: &str) -> Result<String>;
}
#[async_trait::async_trait]
impl RawDocumentSource for SyncServiceClient {
    async fn get_raw(&self, document_id: &str) -> Result<String> {
        SyncServiceClient::get_raw(self, document_id).await
    }
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) struct RawDocumentConfig {
    pub(crate) sync_service_auth_key: String,
}

/// Local document export was selected without its live document source.
#[derive(Debug, thiserror::Error)]
#[error("in-process lexical document exports require a configured sync service")]
pub struct MissingDocumentSource;

#[cfg(test)]
mod test;
