//! No-op provider for local development and testing.

use super::AnalyticsProvider;
use crate::AnalyticsError;
use std::collections::HashMap;

/// A no-op provider that does nothing. Useful for local development or testing.
#[derive(Clone, Debug, Default)]
pub struct NoopProvider;

#[async_trait::async_trait]
impl AnalyticsProvider for NoopProvider {
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        _properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        tracing::debug!(distinct_id, event_name, "NoopProvider: track (no-op)");
        Ok(())
    }

    async fn identify(
        &self,
        distinct_id: &str,
        _properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        tracing::debug!(distinct_id, "NoopProvider: identify (no-op)");
        Ok(())
    }
}
