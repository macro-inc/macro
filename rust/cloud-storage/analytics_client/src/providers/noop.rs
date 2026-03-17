//! No-op analytics provider for testing.

use super::AnalyticsProvider;
use crate::AnalyticsError;

/// A no-op provider that does nothing.
#[derive(Clone, Debug, Default)]
pub struct NoopProvider;

#[async_trait::async_trait]
impl AnalyticsProvider for NoopProvider {
    async fn track(
        &self,
        _distinct_id: &str,
        _event_name: &str,
        _properties: serde_json::Value,
    ) -> Result<(), AnalyticsError> {
        Ok(())
    }

    async fn identify(
        &self,
        _distinct_id: &str,
        _properties: serde_json::Value,
    ) -> Result<(), AnalyticsError> {
        Ok(())
    }
}
