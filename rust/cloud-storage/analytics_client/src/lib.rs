#![deny(missing_docs)]
//! Analytics client for tracking product analytics events.
//!
//! This crate provides an analytics client that can send events to multiple
//! providers (PostHog, Google Analytics, Meta Conversions API).
//!
//! # Example
//!
//! ```ignore
//! use analytics_client::{
//!     AnalyticsClient, AnalyticsClientConfig, MetaPurchaseEvent, MetaUserData,
//! };
//!
//! let client = AnalyticsClient::new(AnalyticsClientConfig {
//!     posthog: Some(PostHogConfig {
//!         api_key: "pk_xxx".to_string(),
//!         host: None,
//!     }),
//!     google_analytics: Some(GoogleAnalyticsConfig {
//!         measurement_id: "G-XXXXXX".to_string(),
//!         api_secret: "secret".to_string(),
//!     }),
//!     meta: Some(MetaConfig {
//!         pixel_id: "123456".to_string(),
//!         access_token: "token".to_string(),
//!         test_event_code: None,
//!     }),
//! });
//!
//! // Send to a specific provider
//! client.posthog().track("user@example.com", "page_view", event).await?;
//!
//! // Send to all providers
//! client.track_all("user@example.com", "some_event", event).await?;
//!
//! // For Meta, use the type-safe event structs to ensure required fields
//! let meta_event = MetaPurchaseEvent {
//!     user_data: MetaUserData::with_email("user@example.com"),
//!     value: 9.99,
//!     currency: "USD".to_string(),
//!     order_id: Some("sub_123".to_string()),
//!     content_name: Some("subscription".to_string()),
//! };
//! client.meta().track("user@example.com", "purchase", meta_event).await?;
//! ```

mod error;
mod events;
mod providers;

pub use error::AnalyticsError;
pub use events::{AnalyticsEvent, SubscriptionCancelledEvent, SubscriptionCreatedEvent};
pub use providers::{
    AnalyticsProvider, GaPurchaseEvent, GaRefundEvent, GoogleAnalyticsProvider,
    MetaCancelSubscriptionEvent, MetaConversionsProvider, MetaLeadEvent, MetaPurchaseEvent,
    NoopProvider, PostHogProvider,
};

use std::collections::HashMap;
use std::sync::Arc;

/// Configuration for PostHog provider.
#[derive(Clone, Debug)]
pub struct PostHogConfig {
    /// PostHog API key
    pub api_key: String,
    /// PostHog host URL (defaults to cloud if None)
    pub host: Option<String>,
}

/// Configuration for Google Analytics provider.
#[derive(Clone, Debug)]
pub struct GoogleAnalyticsConfig {
    /// GA4 Measurement ID (e.g., "G-XXXXXXXXXX")
    pub measurement_id: String,
    /// Measurement Protocol API secret
    pub api_secret: String,
}

/// Configuration for Meta Conversions API provider.
#[derive(Clone, Debug)]
pub struct MetaConfig {
    /// Meta Pixel ID
    pub pixel_id: String,
    /// Conversions API access token
    pub access_token: String,
    /// Test event code for testing (optional)
    pub test_event_code: Option<String>,
}

/// Configuration for the analytics client.
#[derive(Clone, Debug, Default)]
pub struct AnalyticsClientConfig {
    /// PostHog configuration (optional)
    pub posthog: Option<PostHogConfig>,
    /// Google Analytics configuration (optional)
    pub google_analytics: Option<GoogleAnalyticsConfig>,
    /// Meta Conversions API configuration (optional)
    pub meta: Option<MetaConfig>,
}

/// A handle to a specific provider that may or may not be configured.
#[derive(Clone)]
pub struct ProviderHandle<P> {
    provider: Option<Arc<P>>,
}

impl<P: AnalyticsProvider> ProviderHandle<P> {
    /// Returns true if this provider is configured.
    pub fn is_configured(&self) -> bool {
        self.provider.is_some()
    }

    /// Tracks an event if the provider is configured.
    /// Returns Ok(()) if the provider is not configured (no-op).
    #[tracing::instrument(skip(self, event), err)]
    pub async fn track<E: AnalyticsEvent>(
        &self,
        distinct_id: &str,
        event_name: &str,
        event: E,
    ) -> Result<(), AnalyticsError> {
        if let Some(ref provider) = self.provider {
            let properties = event.into_properties();
            provider.track(distinct_id, event_name, properties).await
        } else {
            tracing::debug!(event_name, "provider not configured, skipping");
            Ok(())
        }
    }

    /// Tracks an event with raw properties if the provider is configured.
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn track_raw(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        if let Some(ref provider) = self.provider {
            provider.track(distinct_id, event_name, properties).await
        } else {
            tracing::debug!(event_name, "provider not configured, skipping");
            Ok(())
        }
    }

    /// Identifies a user if the provider is configured.
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn identify(
        &self,
        distinct_id: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        if let Some(ref provider) = self.provider {
            provider.identify(distinct_id, properties).await
        } else {
            tracing::debug!("provider not configured, skipping identify");
            Ok(())
        }
    }
}

/// Analytics client with access to multiple providers.
#[derive(Clone)]
pub struct AnalyticsClient {
    posthog: ProviderHandle<PostHogProvider>,
    google_analytics: ProviderHandle<GoogleAnalyticsProvider>,
    meta: ProviderHandle<MetaConversionsProvider>,
}

impl AnalyticsClient {
    /// Creates a new analytics client with the given configuration.
    pub fn new(config: AnalyticsClientConfig) -> Self {
        let posthog = ProviderHandle {
            provider: config.posthog.map(|c| {
                let provider = match c.host {
                    Some(host) => PostHogProvider::new(c.api_key, host),
                    None => PostHogProvider::new_cloud(c.api_key),
                };
                Arc::new(provider)
            }),
        };

        let google_analytics = ProviderHandle {
            provider: config.google_analytics.map(|c| {
                Arc::new(GoogleAnalyticsProvider::new(c.measurement_id, c.api_secret))
            }),
        };

        let meta = ProviderHandle {
            provider: config.meta.map(|c| {
                let mut provider = MetaConversionsProvider::new(c.pixel_id, c.access_token);
                if let Some(code) = c.test_event_code {
                    provider = provider.with_test_event_code(code);
                }
                Arc::new(provider)
            }),
        };

        Self {
            posthog,
            google_analytics,
            meta,
        }
    }

    /// Creates a no-op analytics client (no providers configured).
    pub fn noop() -> Self {
        Self::new(AnalyticsClientConfig::default())
    }

    /// Returns the PostHog provider handle.
    pub fn posthog(&self) -> &ProviderHandle<PostHogProvider> {
        &self.posthog
    }

    /// Returns the Google Analytics provider handle.
    pub fn google_analytics(&self) -> &ProviderHandle<GoogleAnalyticsProvider> {
        &self.google_analytics
    }

    /// Returns the Meta Conversions API provider handle.
    pub fn meta(&self) -> &ProviderHandle<MetaConversionsProvider> {
        &self.meta
    }

    /// Tracks an event to all configured providers.
    ///
    /// Continues sending to remaining providers even if one fails.
    /// Returns the last error if any provider failed.
    #[tracing::instrument(skip(self, event), err)]
    pub async fn track_all<E: AnalyticsEvent + Clone>(
        &self,
        distinct_id: &str,
        event_name: &str,
        event: E,
    ) -> Result<(), AnalyticsError> {
        let mut last_error: Option<AnalyticsError> = None;

        if let Err(e) = self
            .posthog
            .track(distinct_id, event_name, event.clone())
            .await
        {
            tracing::warn!(error = ?e, "PostHog tracking failed");
            last_error = Some(e);
        }

        if let Err(e) = self
            .google_analytics
            .track(distinct_id, event_name, event.clone())
            .await
        {
            tracing::warn!(error = ?e, "Google Analytics tracking failed");
            last_error = Some(e);
        }

        if let Err(e) = self.meta.track(distinct_id, event_name, event).await {
            tracing::warn!(error = ?e, "Meta Conversions tracking failed");
            last_error = Some(e);
        }

        match last_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// Identifies a user to all configured providers.
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn identify_all(
        &self,
        distinct_id: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        let mut last_error: Option<AnalyticsError> = None;

        if let Err(e) = self.posthog.identify(distinct_id, properties.clone()).await {
            tracing::warn!(error = ?e, "PostHog identify failed");
            last_error = Some(e);
        }

        if let Err(e) = self
            .google_analytics
            .identify(distinct_id, properties.clone())
            .await
        {
            tracing::warn!(error = ?e, "Google Analytics identify failed");
            last_error = Some(e);
        }

        if let Err(e) = self.meta.identify(distinct_id, properties).await {
            tracing::warn!(error = ?e, "Meta Conversions identify failed");
            last_error = Some(e);
        }

        match last_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod test;
