//! Product analytics for the agent connections (native MCP servers and
//! Pipedream apps) users connect and disconnect.
//!
//! Recorded server-side so every surface that connects an app — onboarding,
//! settings, the agent chat, mobile — is counted the same way.

#[cfg(test)]
mod test;

use std::sync::Arc;

use analytics_client::{
    AnalyticsClient, AnalyticsClientConfig, BackgroundSender, PostHogConfig, ProductEventProperties,
};
use entity_access::{domain::ports::AccessRepository, outbound::PgAccessRepository};
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::models::McpServerRecord;
use serde::Serialize;
use sqlx::PgPool;

use crate::cognition::config::Config;

/// Whether a connection was made or removed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntegrationChange {
    /// The user finished a connect flow: OAuth for a native MCP server, or
    /// Pipedream Connect for an app. Re-authorizing an app that is already
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
    /// The app: a Pipedream app slug (`linear`, `stripe`, `granola`, ...) or
    /// the host of a native MCP server (`mcp.notion.com`). The same product
    /// can appear both ways; `connection_type` tells them apart.
    provider: String,
    /// How the app is connected: `pipedream` or `mcp_server`.
    connection_type: &'static str,
}

impl IntegrationEvent {
    /// An app connected through Pipedream Connect.
    pub fn pipedream(app_slug: &str) -> Self {
        Self {
            provider: app_slug.to_owned(),
            connection_type: "pipedream",
        }
    }

    /// A native MCP server the user removed, or `None` when it never
    /// finished OAuth. A server counts as connected when OAuth completes, so
    /// only an authenticated one counts as disconnected.
    pub fn removed_mcp_server(record: &McpServerRecord) -> Option<Self> {
        record
            .credentials
            .as_ref()
            .map(|_| Self::mcp_server(&record.url))
    }

    /// A native MCP server, identified by its host only: paths and queries
    /// of user-added server URLs can carry tokens.
    pub fn mcp_server(server_url: &str) -> Self {
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

/// Most integration analytics sends in flight at once; past it, events are
/// dropped.
const MAX_IN_FLIGHT_SENDS: usize = 16;

/// Records integration changes to PostHog, or nothing when PostHog is not
/// configured.
#[derive(Clone)]
pub struct IntegrationAnalytics {
    sink: Option<Arc<PostHogSink>>,
}

struct PostHogSink {
    sender: BackgroundSender,
    teams: PgAccessRepository,
    environment: Environment,
}

impl IntegrationAnalytics {
    /// PostHog analytics when `POSTHOG_API_KEY` is set, attributing each event
    /// to the user's team; otherwise analytics that record nothing.
    pub fn from_config(config: &Config, db: &PgPool) -> Self {
        let Some(api_key) = config.posthog_api_key.value() else {
            tracing::info!("POSTHOG_API_KEY unset; integration analytics disabled");
            return Self { sink: None };
        };
        let client = AnalyticsClient::new(AnalyticsClientConfig {
            posthog: Some(PostHogConfig {
                api_key: api_key.to_owned(),
                host: config
                    .posthog_host
                    .value()
                    .unwrap_or("https://us.i.posthog.com")
                    .to_owned(),
            }),
            ..AnalyticsClientConfig::default()
        });
        Self {
            sink: Some(Arc::new(PostHogSink {
                sender: BackgroundSender::new(client, MAX_IN_FLIGHT_SENDS),
                teams: PgAccessRepository::new(db.clone()),
                environment: config.environment,
            })),
        }
    }

    /// Records `change` in the background so analytics never delays or fails
    /// the connect or disconnect request.
    pub fn record(
        &self,
        user_id: MacroUserIdStr<'static>,
        change: IntegrationChange,
        event: IntegrationEvent,
    ) {
        let Some(sink) = &self.sink else {
            return;
        };
        let task_sink = sink.clone();
        sink.sender.spawn(move |posthog| async move {
            task_sink.capture(&posthog, user_id, change, event).await;
        });
    }
}

impl PostHogSink {
    async fn capture(
        &self,
        posthog: &AnalyticsClient,
        user_id: MacroUserIdStr<'static>,
        change: IntegrationChange,
        event: IntegrationEvent,
    ) {
        let team_id = self
            .teams
            .get_user_team(&user_id.0)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, "failed to resolve team for integration analytics");
            })
            .ok()
            .flatten()
            .map(|team| team.team_id);
        let properties = ProductEventProperties::new(event, self.environment, team_id);
        let _ = posthog
            .track_posthog(user_id.as_ref(), change.event_name(), &properties)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, event = change.event_name(), "failed to track integration analytics event");
            });
    }
}
