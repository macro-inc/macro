//! Native channel policy consumed through the owning domain.
use uuid::Uuid;

/// Native channel policy consumed by calls without querying another domain's tables.
/// Object-safe so composition roots can supply the owning domain adapter.
#[async_trait::async_trait]
pub trait ChannelCallPolicy: Send + Sync {
    /// Adapter failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Missing and provider-managed group channels fail closed.
    async fn allows_calls(&self, channel: Uuid) -> Result<bool, Self::Err>;
}
