#![deny(missing_docs)]
//! Analytics client for tracking events to GA and Meta.

mod providers;

pub use providers::{MetaActionSource, MetaUserData};

use providers::{GoogleAnalyticsProvider, MetaProvider};
use serde::Serialize;
use std::sync::Arc;

/// Configuration for Google Analytics.
#[derive(Clone)]
pub struct GoogleAnalyticsConfig {
    /// GA4 Measurement ID (e.g., "G-XXXXXXXXXX")
    pub measurement_id: String,
    /// Measurement Protocol API secret
    pub api_secret: String,
}

/// Configuration for Meta Conversions API.
#[derive(Clone)]
pub struct MetaConfig {
    /// Meta Pixel ID
    pub pixel_id: String,
    /// Conversions API access token
    pub access_token: String,
    /// Test event code for testing (optional)
    pub test_event_code: Option<String>,
}

/// Configuration for the analytics client.
#[derive(Clone, Default)]
pub struct AnalyticsClientConfig {
    /// Google Analytics configuration (optional)
    pub google_analytics: Option<GoogleAnalyticsConfig>,
    /// Meta Conversions API configuration (optional)
    pub meta: Option<MetaConfig>,
}

/// Analytics client for tracking events to GA and Meta.
#[derive(Clone)]
pub struct AnalyticsClient {
    google: Option<Arc<GoogleAnalyticsProvider>>,
    meta: Option<Arc<MetaProvider>>,
}

impl AnalyticsClient {
    /// Creates a new analytics client with the given configuration.
    pub fn new(config: AnalyticsClientConfig) -> Self {
        let google = config
            .google_analytics
            .map(|c| Arc::new(GoogleAnalyticsProvider::new(c.measurement_id, c.api_secret)));

        let meta = config.meta.map(|c| {
            Arc::new(MetaProvider::new(
                c.pixel_id,
                c.access_token,
                c.test_event_code,
            ))
        });

        Self { google, meta }
    }

    /// Creates a no-op analytics client (no providers configured).
    pub fn noop() -> Self {
        Self {
            google: None,
            meta: None,
        }
    }

    /// Tracks an event to Google Analytics.
    ///
    /// Returns `Ok(())` if GA is not configured (no-op).
    #[tracing::instrument(skip(self, params), err)]
    pub async fn track_ga(
        &self,
        client_id: &str,
        event_name: &str,
        params: impl Serialize,
    ) -> Result<(), reqwest::Error> {
        if let Some(ref provider) = self.google {
            provider.track(client_id, event_name, params).await?;
        } else {
            tracing::warn!("ga not configured")
        }

        Ok(())
    }

    /// Tracks an event to Meta Conversions API.
    ///
    /// Returns `Ok(())` if Meta is not configured (no-op).
    ///
    /// - `event_name`: Standard event name (e.g., "Purchase", "Lead") or custom event
    /// - `user_data`: User identification data for matching
    /// - `action_source`: Where the conversion originated
    /// - `event_id`: Optional deduplication ID (recommended for server events)
    /// - `custom_data`: Additional event data
    #[tracing::instrument(skip(self, user_data, custom_data), err)]
    pub async fn track_meta(
        &self,
        event_name: &str,
        user_data: &MetaUserData,
        action_source: MetaActionSource,
        event_id: Option<&str>,
        custom_data: impl Serialize,
    ) -> Result<(), reqwest::Error> {
        if let Some(ref provider) = self.meta {
            provider
                .track(event_name, user_data, action_source, event_id, custom_data)
                .await?;
        } else {
            tracing::warn!("meta not configured")
        }

        Ok(())
    }
}
