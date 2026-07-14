use axum::extract::FromRef;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use opensearch_client::OpensearchClient;
use readonly_pool::ReadOnlyPool;
use std::sync::Arc;

/// Concrete entity-access service backing the team receipt extractor. Same
/// type the parent app constructs, so its `Arc` can be passed in directly.
pub type SearchEntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;

/// Minimal state required by search handlers.
/// This can be extracted from any state that implements `FromRef<SearchHandlerState>`.
#[derive(Clone, FromRef)]
pub struct SearchHandlerState {
    /// Read-only database connection for search queries
    pub db: ReadOnlyPool,
    /// OpenSearch client for full-text search
    pub opensearch_client: Arc<OpensearchClient>,
    /// Resolves the caller's team membership to mint CRM capability receipts.
    pub entity_access_service: Arc<SearchEntityAccessService>,
}
