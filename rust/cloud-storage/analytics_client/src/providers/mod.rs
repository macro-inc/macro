//! Analytics provider implementations.

mod google_analytics;
mod meta_conversions;
mod noop;

pub use google_analytics::GoogleAnalyticsProvider;
pub use meta_conversions::MetaConversionsProvider;
pub use noop::NoopProvider;

use crate::AnalyticsError;

/// Trait for analytics providers.
#[async_trait::async_trait]
pub trait AnalyticsProvider: Clone + Send + Sync + 'static {
    /// Tracks an event for a user.
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: serde_json::Value,
    ) -> Result<(), AnalyticsError>;

    /// Identifies a user with properties/traits.
    async fn identify(
        &self,
        distinct_id: &str,
        properties: serde_json::Value,
    ) -> Result<(), AnalyticsError>;
}
