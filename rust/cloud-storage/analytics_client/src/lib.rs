#![deny(missing_docs)]
//! Analytics client for tracking events to multiple providers.

mod error;
mod events;
mod providers;

pub use error::AnalyticsError;
pub use providers::{
    AnalyticsProvider, GoogleAnalyticsProvider, MetaConversionsProvider, NoopProvider,
    PostHogProvider,
};

use events::{PurchaseEvent, RefundEvent};

use serde::Serialize;
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

/// A handle to a provider that may or may not be configured.
#[derive(Clone)]
pub struct ProviderHandle<P> {
    provider: Option<Arc<P>>,
}

impl<P: AnalyticsProvider> ProviderHandle<P> {
    /// Returns true if this provider is configured.
    pub fn is_configured(&self) -> bool {
        self.provider.is_some()
    }

    /// Tracks an event. No-op if provider is not configured.
    pub async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        event: impl Serialize,
    ) -> Result<(), AnalyticsError> {
        if let Some(ref provider) = self.provider {
            let properties = serde_json::to_value(event)?;
            provider.track(distinct_id, event_name, properties).await
        } else {
            Ok(())
        }
    }

    /// Identifies a user. No-op if provider is not configured.
    pub async fn identify(
        &self,
        distinct_id: &str,
        properties: impl Serialize,
    ) -> Result<(), AnalyticsError> {
        if let Some(ref provider) = self.provider {
            let properties = serde_json::to_value(properties)?;
            provider.identify(distinct_id, properties).await
        } else {
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
                Arc::new(match c.host {
                    Some(host) => PostHogProvider::new(c.api_key, host),
                    None => PostHogProvider::new_cloud(c.api_key),
                })
            }),
        };

        let google_analytics = ProviderHandle {
            provider: config
                .google_analytics
                .map(|c| Arc::new(GoogleAnalyticsProvider::new(c.measurement_id, c.api_secret))),
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

    /// Tracks a Stripe subscription event to GA and Meta.
    ///
    /// Automatically determines whether to track a purchase or refund based on
    /// the subscription status and whether it's a new subscription.
    ///
    /// - `is_new`: true if this is a CustomerSubscriptionCreated event
    /// - `status`: the subscription status (e.g., "active", "trialing", "canceled")
    pub async fn track_stripe_subscription(
        &self,
        email: &str,
        subscription_id: &str,
        value_cents: Option<i64>,
        currency: Option<&str>,
        status: &str,
        is_new: bool,
    ) -> Result<(), AnalyticsError> {
        let (Some(value_cents), Some(currency)) = (value_cents, currency) else {
            return Ok(());
        };

        match (status, is_new) {
            ("active" | "trialing", true) => {
                let event = PurchaseEvent {
                    transaction_id: subscription_id.to_string(),
                    value: value_cents as f64 / 100.0,
                    currency: currency.to_uppercase(),
                    content_name: None,
                };
                self.google_analytics.track(email, "purchase", &event).await?;
                self.meta.track(email, "Purchase", &event).await?;
            }
            ("canceled", _) => {
                let event = RefundEvent {
                    transaction_id: subscription_id.to_string(),
                    value: Some(value_cents as f64 / 100.0),
                    currency: Some(currency.to_uppercase()),
                };
                self.google_analytics.track(email, "refund", &event).await?;
                self.meta.track(email, "CancelSubscription", &event).await?;
            }
            _ => {}
        }

        Ok(())
    }
}

#[cfg(test)]
mod test;
