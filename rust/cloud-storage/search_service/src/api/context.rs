use axum::extract::FromRef;
use opensearch_client::OpensearchClient;
use readonly_pool::ReadOnlyPool;
use std::sync::Arc;

/// Minimal state required by search handlers.
/// This can be extracted from any state that implements `FromRef<SearchHandlerState>`.
#[derive(Clone, FromRef)]
pub struct SearchHandlerState {
    /// Read-only database connection for search queries
    pub db: ReadOnlyPool,
    /// OpenSearch client for full-text search
    pub opensearch_client: Arc<OpensearchClient>,
}
