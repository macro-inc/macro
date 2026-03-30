#![deny(missing_docs)]
//! Analytics client for tracking events to GA, Meta, and PostHog.

mod providers;

pub use providers::{MetaActionSource, MetaUserData};

use providers::{GoogleAnalyticsProvider, MetaProvider, PostHogProvider};
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

/// Configuration for PostHog.
#[derive(Clone)]
pub struct PostHogConfig {
    /// PostHog project API key
    pub api_key: String,
    /// PostHog host
    pub host: String,
}

/// Configuration for the analytics client.
#[derive(Clone, Default)]
pub struct AnalyticsClientConfig {
    /// Google Analytics configuration (optional)
    pub google_analytics: Option<GoogleAnalyticsConfig>,
    /// Meta Conversions API configuration (optional)
    pub meta: Option<MetaConfig>,
    /// PostHog configuration (optional)
    pub posthog: Option<PostHogConfig>,
}

/// Analytics client for tracking events to GA, Meta, and PostHog.
#[derive(Clone)]
pub struct AnalyticsClient {
    google: Option<Arc<GoogleAnalyticsProvider>>,
    meta: Option<Arc<MetaProvider>>,
    posthog: Option<Arc<PostHogProvider>>,
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

        let posthog = config
            .posthog
            .map(|c| Arc::new(PostHogProvider::new(c.api_key, c.host)));

        Self {
            google,
            meta,
            posthog,
        }
    }

    /// Creates a no-op analytics client (no providers configured).
    pub fn noop() -> Self {
        Self {
            google: None,
            meta: None,
            posthog: None,
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

    /// Tracks an event to PostHog.
    ///
    /// Returns `Ok(())` if PostHog is not configured (no-op).
    ///
    /// - `distinct_id`: Unique identifier for the user (e.g., email or user ID)
    /// - `event_name`: Name of the event (e.g., "subscription_created")
    /// - `properties`: Additional event properties
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn track_posthog(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: impl Serialize,
    ) -> Result<(), reqwest::Error> {
        if let Some(ref provider) = self.posthog {
            provider
                .capture(distinct_id, event_name, properties)
                .await?;
        } else {
            tracing::warn!("posthog not configured")
        }

        Ok(())
    }
}
