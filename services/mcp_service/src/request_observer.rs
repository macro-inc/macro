//! Watches MCP requests for analytics: who connected with which client, and
//! how each tool call went.
//!
//! Observation happens off the response path: the tool service hands over an
//! owned record and moves on, so a slow attribution lookup or analytics call
//! never delays an agent.

#[cfg(test)]
mod test;

use std::{pin::Pin, sync::Arc, time::Duration};

use serde_json::Value;

use crate::{
    client_attribution::{ClientAttribution, ClientStore},
    telemetry::{ClientInfo, McpTelemetry, ToolCallOutcome},
};

/// Boxed future returned by observers.
pub type ObserveFuture = Pin<Box<dyn Future<Output = ()> + Send>>;

/// A client handshake.
#[derive(Debug, Clone)]
pub struct InitializeSeen {
    /// The person's profile id.
    pub user_id: String,
    /// The bearer token the client connected with.
    pub token: Option<String>,
    /// The client as it reported itself, plus its `User-Agent`.
    pub client: ClientInfo,
    /// The protocol version the client asked for.
    pub protocol_version: String,
}

/// A finished tool call.
#[derive(Debug, Clone)]
pub struct ToolCallSeen {
    /// The person's profile id.
    pub user_id: String,
    /// The bearer token the call carried.
    pub token: Option<String>,
    /// The request's `User-Agent`.
    pub user_agent: Option<String>,
    /// The tool's name.
    pub tool_name: String,
    /// How long the call took.
    pub duration: Duration,
    /// How it ended.
    pub outcome: ToolCallOutcome,
    /// The structured result of a setup handoff tool, read only for the apps
    /// it handed off; `None` for every other tool.
    pub handoff_result: Option<Value>,
}

/// Something that wants to know about MCP requests.
pub trait RequestObserver: Send + Sync + 'static {
    /// A client finished its handshake.
    fn initialized(self: Arc<Self>, seen: InitializeSeen) -> ObserveFuture;
    /// A tool call finished.
    fn tool_called(self: Arc<Self>, seen: ToolCallSeen) -> ObserveFuture;
}

/// An observer that ignores everything.
pub struct NoObserver;

impl RequestObserver for NoObserver {
    fn initialized(self: Arc<Self>, _seen: InitializeSeen) -> ObserveFuture {
        Box::pin(async {})
    }

    fn tool_called(self: Arc<Self>, _seen: ToolCallSeen) -> ObserveFuture {
        Box::pin(async {})
    }
}

/// Tools whose results are handoffs to a Macro page the person opens.
pub const HANDOFF_TOOLS: [&str; 1] = ["SetupConnect"];

/// The `(app, kind)` of each handoff in a handoff tool's result.
fn handoffs(result: &Value) -> Vec<(String, String)> {
    result
        .get("handoffs")
        .and_then(Value::as_array)
        .map(|handoffs| {
            handoffs
                .iter()
                .filter_map(|handoff| {
                    let app = handoff.get("app")?.as_str()?;
                    let kind = handoff
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("connect");
                    Some((app.to_owned(), kind.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Sends requests to analytics, attributing each to its client.
pub struct TelemetryObserver<S> {
    telemetry: McpTelemetry,
    attribution: ClientAttribution<S>,
}

impl<S> TelemetryObserver<S> {
    /// An observer over the telemetry sink and the attribution store.
    pub fn new(telemetry: McpTelemetry, attribution: ClientAttribution<S>) -> Self {
        Self {
            telemetry,
            attribution,
        }
    }
}

impl<S: ClientStore> RequestObserver for TelemetryObserver<S> {
    fn initialized(self: Arc<Self>, seen: InitializeSeen) -> ObserveFuture {
        Box::pin(async move {
            if let Some(token) = &seen.token {
                self.attribution
                    .remember(token, &seen.user_id, &seen.client)
                    .await;
            }
            self.telemetry
                .initialize(&seen.user_id, &seen.client, &seen.protocol_version);
        })
    }

    fn tool_called(self: Arc<Self>, seen: ToolCallSeen) -> ObserveFuture {
        Box::pin(async move {
            let remembered = match &seen.token {
                Some(token) => self.attribution.client_for(token, &seen.user_id).await,
                None => None,
            };
            let client = ClientInfo {
                user_agent: seen.user_agent.clone(),
                ..remembered.unwrap_or_default()
            };
            self.telemetry.tool_call(
                &seen.user_id,
                &seen.tool_name,
                &client,
                seen.duration,
                &seen.outcome,
            );
            if let Some(result) = &seen.handoff_result {
                for (app, kind) in handoffs(result) {
                    self.telemetry
                        .handoff_issued(&seen.user_id, &client, &app, &kind);
                }
            }
        })
    }
}
