//! Product analytics for the MCP server, broken down by client.
//!
//! Tool calls and handshakes use PostHog's MCP Analytics event shape
//! (`$mcp_tool_call`, `$mcp_initialize` and their `$mcp_*` properties) so they
//! land in its MCP Analytics views without an SDK. Setup milestones are plain
//! product events. The distinct id is the Macro profile id (`macro|{email}`),
//! the same id the web app and the auth service's `sign_up` event use, so MCP
//! activity joins the person's web activity.
//!
//! Tool arguments and results are content, so they are never captured.
//! Capture is fire-and-forget: a slow or failing analytics endpoint must never
//! hold up or fail a tool call.

#[cfg(test)]
mod test;

use std::{sync::Arc, time::Duration};
use tracing::Instrument;

use analytics_client::{AnalyticsClient, AnalyticsClientConfig, PostHogConfig};
use serde_json::{Map, Value, json};

/// `$mcp_source` value PostHog's MCP Analytics filters on.
const MCP_ANALYTICS_SOURCE: &str = "posthog_mcp_analytics";
/// Server name reported on every MCP event.
const SERVER_NAME: &str = "macro";
/// PostHog host used when `POSTHOG_HOST` is unset.
pub const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";

/// The MCP client a request came from, as well as it can be told.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClientInfo {
    /// Name the client reported (`clientInfo.name`, e.g. `claude-code`) or,
    /// failing that, the name it registered under.
    pub name: Option<String>,
    /// Version the client reported, when it did.
    pub version: Option<String>,
    /// The request's `User-Agent`, a last resort when the client is unknown.
    pub user_agent: Option<String>,
}

impl ClientInfo {
    /// The best single label for the client, for breakdowns.
    pub fn label(&self) -> &str {
        self.name
            .as_deref()
            .or(self.user_agent.as_deref())
            .unwrap_or("unknown")
    }

    fn insert_into(&self, properties: &mut Map<String, Value>) {
        properties.insert("$mcp_client_name".into(), json!(self.label()));
        if let Some(version) = &self.version {
            properties.insert("$mcp_client_version".into(), json!(version));
        }
        if let Some(user_agent) = &self.user_agent {
            properties.insert("$mcp_client_user_agent".into(), json!(user_agent));
        }
    }
}

/// How a tool call ended, as far as analytics is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolCallOutcome {
    /// The tool returned a result.
    Success,
    /// The tool, or the request around it, failed. Only the class is
    /// recorded: error text can quote the person's content.
    Error {
        /// A coarse error class (e.g. `tool_error`, `invalid_params`).
        kind: &'static str,
    },
}

/// Sends MCP server events to PostHog, or nowhere when it is not configured.
#[derive(Clone)]
pub struct McpTelemetry {
    analytics: Option<Arc<AnalyticsClient>>,
    server_version: &'static str,
}

impl McpTelemetry {
    /// Telemetry backed by PostHog when an API key is configured; a no-op
    /// otherwise, so environments without the key still serve requests.
    pub fn new(posthog_api_key: Option<&str>, posthog_host: Option<&str>) -> Self {
        let analytics = posthog_api_key
            .filter(|key| !key.trim().is_empty())
            .map(|api_key| {
                Arc::new(AnalyticsClient::new(AnalyticsClientConfig {
                    posthog: Some(PostHogConfig {
                        api_key: api_key.to_owned(),
                        host: posthog_host.unwrap_or(DEFAULT_POSTHOG_HOST).to_owned(),
                    }),
                    ..AnalyticsClientConfig::default()
                }))
            });
        if analytics.is_none() {
            tracing::warn!("POSTHOG_API_KEY is unset: MCP analytics events are not sent");
        }
        Self {
            analytics,
            server_version: env!("CARGO_PKG_VERSION"),
        }
    }

    /// Whether events are sent anywhere.
    pub fn is_enabled(&self) -> bool {
        self.analytics.is_some()
    }

    /// Telemetry that sends nothing.
    #[cfg(test)]
    pub fn disabled() -> Self {
        Self {
            analytics: None,
            server_version: env!("CARGO_PKG_VERSION"),
        }
    }

    fn base_properties(&self, client: &ClientInfo) -> Map<String, Value> {
        let mut properties = Map::new();
        properties.insert("$mcp_source".into(), json!(MCP_ANALYTICS_SOURCE));
        properties.insert("$mcp_server_name".into(), json!(SERVER_NAME));
        properties.insert("$mcp_server_version".into(), json!(self.server_version));
        client.insert_into(&mut properties);
        properties
    }

    /// The `$mcp_tool_call` event for one `tools/call`.
    pub fn tool_call_event(
        &self,
        tool_name: &str,
        client: &ClientInfo,
        duration: Duration,
        outcome: &ToolCallOutcome,
    ) -> Map<String, Value> {
        let mut properties = self.base_properties(client);
        properties.insert("$mcp_tool_name".into(), json!(tool_name));
        properties.insert(
            "$mcp_duration_ms".into(),
            json!(u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)),
        );
        properties.insert(
            "$mcp_is_error".into(),
            json!(matches!(outcome, ToolCallOutcome::Error { .. })),
        );
        if let ToolCallOutcome::Error { kind } = outcome {
            properties.insert("$mcp_error_type".into(), json!(kind));
        }
        properties
    }

    /// Records one tool call: name, success or error, latency and client.
    pub fn tool_call(
        &self,
        distinct_id: &str,
        tool_name: &str,
        client: &ClientInfo,
        duration: Duration,
        outcome: &ToolCallOutcome,
    ) {
        let properties = self.tool_call_event(tool_name, client, duration, outcome);
        self.capture(distinct_id, "$mcp_tool_call", properties);
    }

    /// Records a client handshake, tying the client name and version to the
    /// person.
    pub fn initialize(&self, distinct_id: &str, client: &ClientInfo, protocol_version: &str) {
        let mut properties = self.base_properties(client);
        properties.insert("$mcp_protocol_version".into(), json!(protocol_version));
        properties.insert("$set".into(), json!({ "mcp_last_client": client.label() }));
        properties.insert(
            "$set_once".into(),
            json!({ "mcp_first_client": client.label() }),
        );
        self.capture(distinct_id, "$mcp_initialize", properties);
    }

    /// Records a completed MCP sign-in.
    pub fn signed_in(&self, distinct_id: &str, sign_in: &SignInEvent) {
        let client = ClientInfo {
            name: sign_in.client_name.clone(),
            ..ClientInfo::default()
        };
        let mut properties = self.base_properties(&client);
        properties.insert("agent_led".into(), json!(sign_in.agent_led));
        properties.insert("inbox".into(), json!(sign_in.inbox));
        properties.insert(
            "$set_once".into(),
            json!({ "mcp_first_client": client.label() }),
        );
        self.capture(distinct_id, "mcp_signed_in", properties);
    }

    /// Records a handoff to a Macro page the agent gave the person (a connect
    /// link, for example).
    pub fn handoff_issued(&self, distinct_id: &str, client: &ClientInfo, app: &str, kind: &str) {
        let mut properties = self.base_properties(client);
        properties.insert("app".into(), json!(app));
        properties.insert("handoff_kind".into(), json!(kind));
        self.capture(distinct_id, "mcp_setup_handoff_issued", properties);
    }

    fn capture(&self, distinct_id: &str, event: &'static str, properties: Map<String, Value>) {
        let Some(analytics) = self.analytics.clone() else {
            return;
        };
        let distinct_id = distinct_id.to_owned();
        tokio::spawn(
            async move {
                if let Err(error) = analytics
                    .track_posthog(&distinct_id, event, Value::Object(properties))
                    .await
                {
                    tracing::warn!(error=?error, event, "failed to send MCP analytics event");
                }
            }
            .in_current_span(),
        );
    }
}

/// What a sign-in did, for the `mcp_signed_in` event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInEvent {
    /// The client the person signed in through, when known.
    pub client_name: Option<String>,
    /// Whether this sign-in handed the account to the agent (a new account,
    /// or one that never finished web onboarding).
    pub agent_led: bool,
    /// What happened to the inbox: `provisioned`, `skipped` (already set up,
    /// or no Gmail grant) or `failed`.
    pub inbox: &'static str,
}
