//! Helpers for initializing markdown documents in sync-service.

use lexical_client::LexicalClient;
use sync_service_client::SyncServiceClient;

/// Converts markdown to a Loro snapshot using lexical-service and initializes
/// the corresponding document in sync-service.
#[tracing::instrument(skip(markdown, lexical_client, sync_service_client), err)]
pub async fn initialize_markdown_document(
    lexical_client: &LexicalClient,
    sync_service_client: &SyncServiceClient,
    document_id: &str,
    markdown: &str,
) -> anyhow::Result<()> {
    let snapshot = lexical_client.markdown_to_loro_snapshot(markdown).await?;
    sync_service_client
        .initialize_from_snapshot(document_id, &snapshot)
        .await?;
    Ok(())
}
