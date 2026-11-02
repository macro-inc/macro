//! Server-side product analytics for MCP traffic.
//!
//! Events use PostHog's MCP analytics schema (`$mcp_initialize`,
//! `$mcp_tool_call`, `$mcp_*` properties), so PostHog's MCP dashboards and its
//! client ("harness") bucketing read them without custom insights. Tool
//! arguments and results are never recorded: only the tool name, outcome, and
//! timing.

#[cfg(test)]
mod test;

use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use analytics_client::{AnalyticsClient, BackgroundSender, ProductEventProperties};
use entity_access::{domain::ports::AccessRepository, outbound::PgAccessRepository};
use lru::LruCache;
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_auth_proxy::inbound::middleware::McpAuthMethod;
use serde::Serialize;

/// Name the server advertises in `initialize`, recorded on every event.
pub const SERVER_NAME: &str = "macro-tools";

/// Longest header value recorded. User agents are the longest signal clients
/// send; anything past this is noise.
const MAX_HEADER_LEN: usize = 256;

/// What an MCP HTTP request says about the client that sent it.
///
/// The server runs stateless, so a tool call carries no `clientInfo`; these
/// headers are what identify the client on every call.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct McpClientSignals {
    #[serde(
        rename = "$mcp_client_user_agent",
        skip_serializing_if = "Option::is_none"
    )]
    user_agent: Option<String>,
    /// Anthropic's surfaces (Claude.ai, Claude Code, Cowork) name themselves
    /// here; PostHog's harness bucketing reads it first.
    #[serde(rename = "$mcp_vendor_client", skip_serializing_if = "Option::is_none")]
    vendor_client: Option<String>,
    #[serde(
        rename = "$mcp_protocol_version",
        skip_serializing_if = "Option::is_none"
    )]
    protocol_version: Option<String>,
    #[serde(rename = "$mcp_auth_method", skip_serializing_if = "Option::is_none")]
    auth_method: Option<&'static str>,
}

impl McpClientSignals {
    /// Reads the client signals from the HTTP request behind an MCP message.
    pub fn from_request_parts(parts: Option<&http::request::Parts>) -> Self {
        let Some(parts) = parts else {
            return Self::default();
        };
        let header = |name: &str| {
            parts
                .headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(MAX_HEADER_LEN).collect())
        };
        Self {
            user_agent: header("user-agent"),
            vendor_client: header("x-anthropic-client"),
            protocol_version: header("mcp-protocol-version"),
            auth_method: parts
                .extensions
                .get::<McpAuthMethod>()
                .map(|method| method.as_str()),
        }
    }
}

/// How a tool call ended.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolCallOutcome {
    /// The tool ran and returned a result.
    Success,
    /// The request named no registered tool, or its arguments were missing or
    /// did not match the tool's schema.
    InvalidRequest,
    /// The tool ran and reported an error to the model.
    ToolError,
}

impl ToolCallOutcome {
    /// PostHog's `$mcp_error_type` bucket. Tool errors carry no reliable
    /// cause, so they leave the bucket unset rather than guess one.
    fn error_type(self) -> Option<&'static str> {
        match self {
            Self::Success | Self::ToolError => None,
            Self::InvalidRequest => Some("validation"),
        }
    }
}

/// One MCP request worth recording.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum McpAnalyticsEvent {
    /// A client opened an MCP session.
    Initialize {
        /// `clientInfo.name`, e.g. `claude-ai`, `openai-mcp`, `cursor-vscode`.
        client_name: String,
        /// `clientInfo.version`.
        client_version: String,
        /// The protocol version the client asked for.
        protocol_version: String,
    },
    /// A client called a tool.
    ToolCall {
        /// The registered tool name, e.g. `ContentSearch`.
        tool_name: String,
        /// How the call ended.
        outcome: ToolCallOutcome,
        /// Wall-clock time spent handling the call.
        duration: Duration,
    },
}

impl McpAnalyticsEvent {
    fn name(&self) -> &'static str {
        match self {
            Self::Initialize { .. } => "$mcp_initialize",
            Self::ToolCall { .. } => "$mcp_tool_call",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum EventSpecificProperties<'a> {
    Initialize {
        #[serde(rename = "$mcp_client_name")]
        client_name: &'a str,
        #[serde(rename = "$mcp_client_version")]
        client_version: &'a str,
        #[serde(rename = "$mcp_protocol_version")]
        protocol_version: &'a str,
    },
    ToolCall {
        #[serde(rename = "$mcp_tool_name")]
        tool_name: &'a str,
        #[serde(rename = "$mcp_is_error")]
        is_error: bool,
        #[serde(rename = "$mcp_error_type", skip_serializing_if = "Option::is_none")]
        error_type: Option<&'static str>,
        #[serde(rename = "$mcp_duration_ms")]
        duration_ms: u64,
    },
}

#[derive(Debug, Serialize)]
struct EventProperties<'a> {
    // Flattened first so the request header's protocol version cannot
    // override the one `initialize` negotiated: serde keeps the last key.
    #[serde(flatten)]
    client: &'a McpClientSignals,
    #[serde(flatten)]
    event: EventSpecificProperties<'a>,
    #[serde(rename = "$mcp_server_name")]
    server_name: &'static str,
    #[serde(rename = "$mcp_server_version")]
    server_version: &'static str,
}

impl<'a> EventProperties<'a> {
    fn new(event: &'a McpAnalyticsEvent, client: &'a McpClientSignals) -> Self {
        let event = match event {
            McpAnalyticsEvent::Initialize {
                client_name,
                client_version,
                protocol_version,
            } => EventSpecificProperties::Initialize {
                client_name,
                client_version,
                protocol_version,
            },
            McpAnalyticsEvent::ToolCall {
                tool_name,
                outcome,
                duration,
            } => EventSpecificProperties::ToolCall {
                tool_name,
                is_error: *outcome != ToolCallOutcome::Success,
                error_type: outcome.error_type(),
                duration_ms: u64::try_from(duration.as_millis()).unwrap_or(u64::MAX),
            },
        };
        Self {
            client,
            event,
            server_name: SERVER_NAME,
            server_version: env!("CARGO_PKG_VERSION"),
        }
    }
}

/// Most MCP analytics sends in flight at once; past it, events are dropped.
const MAX_IN_FLIGHT_SENDS: usize = 64;

/// How long a user's team is reused before it is read again. Tool calls are
/// frequent and share the harness database pool, while team membership
/// rarely changes.
const TEAM_TTL: Duration = Duration::from_secs(10 * 60);

/// Users whose team is remembered at once.
const TEAM_CACHE_CAPACITY: usize = 10_000;

/// Records MCP product analytics to PostHog, or nothing when PostHog is not
/// configured.
#[derive(Clone)]
pub struct McpAnalytics {
    sink: Option<Arc<PostHogSink>>,
}

struct PostHogSink {
    sender: BackgroundSender,
    teams: PgAccessRepository,
    team_cache: TeamCache,
    environment: Environment,
}

impl McpAnalytics {
    /// Analytics that records nothing.
    pub fn disabled() -> Self {
        Self { sink: None }
    }

    /// Analytics that records to PostHog, attributing each event to the
    /// user's team when they belong to one.
    pub fn posthog(
        client: AnalyticsClient,
        teams: PgAccessRepository,
        environment: Environment,
    ) -> Self {
        Self {
            sink: Some(Arc::new(PostHogSink {
                sender: BackgroundSender::new(client, MAX_IN_FLIGHT_SENDS),
                teams,
                team_cache: TeamCache::new(TEAM_CACHE_CAPACITY),
                environment,
            })),
        }
    }

    /// Records `event` for `user_id` in the background, so analytics never
    /// delays or fails an MCP response.
    pub fn record(
        &self,
        user_id: MacroUserIdStr<'static>,
        client: McpClientSignals,
        event: McpAnalyticsEvent,
    ) {
        let Some(sink) = &self.sink else {
            return;
        };
        let task_sink = sink.clone();
        sink.sender.spawn(move |posthog| async move {
            task_sink.capture(&posthog, user_id, client, event).await;
        });
    }
}

impl PostHogSink {
    async fn capture(
        &self,
        posthog: &AnalyticsClient,
        user_id: MacroUserIdStr<'static>,
        client: McpClientSignals,
        event: McpAnalyticsEvent,
    ) {
        let team_id = self.team_id(&user_id).await;
        let properties = ProductEventProperties::new(
            EventProperties::new(&event, &client),
            self.environment,
            team_id,
        );
        let _ = posthog
            .track_posthog(user_id.as_ref(), event.name(), &properties)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, event = event.name(), "failed to track MCP analytics event");
            });
    }

    /// The user's team, from the cache when it is fresh. A failed read is not
    /// cached, so the next event tries again.
    async fn team_id(&self, user_id: &MacroUserIdStr<'static>) -> Option<uuid::Uuid> {
        if let Some(team_id) = self.team_cache.get(user_id, Instant::now()) {
            return team_id;
        }
        let team_id = self
            .teams
            .get_user_team(&user_id.0)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, "failed to resolve team for MCP analytics");
            })
            .ok()?
            .map(|team| team.team_id);
        self.team_cache
            .put(user_id.clone(), team_id, Instant::now());
        team_id
    }
}

/// Each user's team (or none), remembered for [`TEAM_TTL`].
struct TeamCache {
    entries: Mutex<LruCache<MacroUserIdStr<'static>, CachedTeam>>,
}

#[derive(Clone, Copy)]
struct CachedTeam {
    team_id: Option<uuid::Uuid>,
    read_at: Instant,
}

impl TeamCache {
    fn new(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(LruCache::new(
                NonZeroUsize::new(capacity).expect("a nonzero capacity"),
            )),
        }
    }

    /// The user's team as read within [`TEAM_TTL`] of `now`, or `None` when
    /// it has to be read again.
    fn get(&self, user_id: &MacroUserIdStr<'static>, now: Instant) -> Option<Option<uuid::Uuid>> {
        let mut entries = self.entries.lock().expect("team cache poisoned");
        let cached = *entries.get(user_id)?;
        if now.saturating_duration_since(cached.read_at) < TEAM_TTL {
            return Some(cached.team_id);
        }
        entries.pop(user_id);
        None
    }

    fn put(&self, user_id: MacroUserIdStr<'static>, team_id: Option<uuid::Uuid>, read_at: Instant) {
        self.entries
            .lock()
            .expect("team cache poisoned")
            .put(user_id, CachedTeam { team_id, read_at });
    }
}
