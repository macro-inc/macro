//! Product analytics for the connections (catalog apps and servers added by
//! URL) users connect and disconnect.
//!
//! Recorded server-side so every surface that connects an app — onboarding,
//! settings, the agent chat, mobile — is counted the same way.

#[cfg(test)]
mod test;

use connectors::ConnectorKey;
use connectors::inbound::ConnectorChange;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use sqlx::PgPool;

use crate::{cognition::config::Config, product_analytics::ProductAnalytics};

/// Whether a connection was made or removed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntegrationChange {
    /// The user finished a connect flow for an app or a server added by
    /// URL. Re-authorizing an app that is already
    /// connected finishes another flow and is recorded again, so count
    /// distinct (person, provider) pairs for connected apps.
    Connected,
    /// The user removed a connected app.
    Disconnected,
}

impl IntegrationChange {
    fn event_name(self) -> &'static str {
        match self {
            Self::Connected => "integration_connected",
            Self::Disconnected => "integration_disconnected",
        }
    }
}

/// One app a user connected or removed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct IntegrationEvent {
    /// The app: a catalog app slug (`linear`, `stripe`, `granola`, ...) or
    /// the host of a server added by URL (`mcp.example.com`).
    provider: String,
    /// What was connected: `app` or `mcp_server`. Which source holds a
    /// connection is not recorded: nothing outside the connectors can tell.
    connection_type: &'static str,
}

impl IntegrationEvent {
    /// The app or server a connection is to.
    pub fn of(key: &ConnectorKey) -> Self {
        match key {
            ConnectorKey::App(app) => Self {
                provider: app.as_str().to_owned(),
                connection_type: "app",
            },
            ConnectorKey::Server(url) => Self::mcp_server(url.as_str()),
        }
    }

    /// A server added by URL, identified by its host only: paths and
    /// queries of user-added server URLs can carry tokens.
    fn mcp_server(server_url: &str) -> Self {
        let provider = url::Url::parse(server_url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".to_owned());
        Self {
            provider,
            connection_type: "mcp_server",
        }
    }
}

/// Records integration changes to PostHog, or nothing when PostHog is not
/// configured.
#[derive(Clone)]
pub struct IntegrationAnalytics {
    analytics: ProductAnalytics,
}

impl IntegrationAnalytics {
    /// PostHog analytics when `POSTHOG_API_KEY` is set, attributing each event
    /// to the user's team; otherwise analytics that record nothing.
    pub fn from_config(config: &Config, db: &PgPool) -> Self {
        let analytics = ProductAnalytics::new(
            config.posthog_api_key.value(),
            config.posthog_host.value(),
            config.environment,
            db,
        );
        if !analytics.is_enabled() {
            tracing::info!("POSTHOG_API_KEY unset; integration analytics disabled");
        }
        Self { analytics }
    }

    /// Records `change` in the background so analytics never delays or fails
    /// the connect or disconnect request.
    pub fn record(
        &self,
        user_id: MacroUserIdStr<'static>,
        change: IntegrationChange,
        event: IntegrationEvent,
    ) {
        self.analytics.track(user_id, change.event_name(), event);
    }

    /// A connectors hook recording `change` for each connection it reports.
    pub fn hook(&self, change: IntegrationChange) -> connectors::inbound::ConnectorHook {
        let analytics = self.clone();
        std::sync::Arc::new(move |connection: ConnectorChange| {
            analytics.record(
                connection.user,
                change,
                IntegrationEvent::of(&connection.key),
            );
            Box::pin(async {})
        })
    }
}
