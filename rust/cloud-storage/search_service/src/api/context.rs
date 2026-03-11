use axum::extract::FromRef;
use opensearch_client::OpensearchClient;
use sqlx::PgPool;
use std::sync::Arc;

/// Minimal state required by search handlers.
/// This can be extracted from any state that implements `FromRef<SearchHandlerState>`.
#[derive(Clone, FromRef)]
pub struct SearchHandlerState {
    /// Macrodb database connection
    pub db: PgPool,
    /// OpenSearch client for full-text search
    pub opensearch_client: Arc<OpensearchClient>,
}
