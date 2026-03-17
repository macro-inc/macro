//! Analytics provider implementations.

mod google_analytics;
mod meta_conversions;
mod noop;
mod posthog;

pub use google_analytics::{GaPurchaseEvent, GaRefundEvent, GoogleAnalyticsProvider};
pub use meta_conversions::{
    MetaCancelSubscriptionEvent, MetaConversionsProvider, MetaLeadEvent, MetaPurchaseEvent,
};
pub use noop::NoopProvider;
pub use posthog::PostHogProvider;

use crate::AnalyticsError;
use std::collections::HashMap;

/// Trait for analytics providers that support generic property-bag tracking.
///
/// Note: Meta Conversions API does NOT implement this trait because it requires
/// specific structured data. Use `MetaConversionsProvider` directly with its
/// type-safe event structs.
#[async_trait::async_trait]
pub trait AnalyticsProvider: Clone + Send + Sync + 'static {
    /// Tracks an event for a user.
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError>;

    /// Identifies a user with properties/traits.
    async fn identify(
        &self,
        distinct_id: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError>;
}
