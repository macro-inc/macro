#![deny(missing_docs)]
//! Wire types and helpers shared by the calendar watch relay.
//!
//! Google requires an `events.watch` channel's address to be public HTTPS on
//! a domain verified in the Cloud project owning the OAuth client, which a
//! laptop can never satisfy. The relay closes that gap for local stacks:
//! their channels open against the dev-deployed
//! `calendar-event-local-tunnel` service's public address with a
//! per-instance token, and the stack's pubsub workers connect OUT to that
//! service and subscribe (SSE) to deliveries addressed to their token:
//!
//! ```text
//! Google ──POST──▶ calendar-event-local-tunnel (dev)
//!                    │ route by x-goog-channel-token
//!                    ▼ SSE (outbound connection from the laptop)
//!            local stack re-injects the ping into its own
//!            `handle_watch_notification` flow
//! ```
//!
//! This crate carries what both ends must agree on — the wire model, the
//! subscriber's SSE parsing, the secret comparison, and the env-var readers
//! — while the tunnel service owns delivery fan-out and the email service
//! owns the subscriber loop.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// One relayed push notification: the meaningful subset of Google's
/// `x-goog-*` headers, in the wire shape shared by the tunnel's SSE stream
/// and its subscribers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelayedWatchNotification {
    /// `x-goog-resource-state`: `sync`, `exists`, or `not_exists`.
    pub state: String,
    /// `x-goog-channel-id`.
    pub channel_id: String,
    /// `x-goog-resource-id`.
    pub resource_id: String,
}

/// Subscriber-side relay configuration, present only on stacks that consume
/// relayed deliveries (local).
pub struct WatchRelaySubscriberConfig {
    /// Base URL of the tunnel deployment, e.g.
    /// `https://calendar-event-local-tunnel-dev.macro.com`.
    pub url: String,
    /// Shared secret presented when subscribing.
    pub secret: String,
}

/// Read one environment variable, treating blank as unset like every other
/// watch variable.
pub fn read_env(name: &'static str) -> Option<String> {
    macro_env_var::maybe_read_env(name)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Read the subscriber-side configuration.
pub fn watch_relay_subscriber_config() -> Option<WatchRelaySubscriberConfig> {
    let url = read_env("CALENDAR_WATCH_RELAY_URL")?;
    let secret = read_env("CALENDAR_WATCH_RELAY_SECRET")?;
    Some(WatchRelaySubscriberConfig {
        url: url.trim_end_matches('/').to_owned(),
        secret,
    })
}

/// Compare two secrets without early exit on the first differing byte.
pub fn secrets_match(presented: &str, expected: &str) -> bool {
    Sha256::digest(presented.as_bytes()) == Sha256::digest(expected.as_bytes())
}

/// Incremental parser extracting `data:` payloads from an SSE byte stream.
/// Comment lines (keep-alives) and other fields are ignored; multi-line data
/// is joined with `\n` per the SSE specification.
#[derive(Default)]
pub struct SseDataParser {
    buffer: String,
    data_lines: Vec<String>,
}

impl SseDataParser {
    /// Feed one chunk, returning every event payload it completed.
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buffer.push_str(chunk);
        let mut completed = Vec::new();
        while let Some(newline) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..=newline).collect();
            let line = line.trim_end_matches(['\n', '\r']);
            if line.is_empty() {
                if !self.data_lines.is_empty() {
                    completed.push(self.data_lines.join("\n"));
                    self.data_lines.clear();
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data_lines
                    .push(data.strip_prefix(' ').unwrap_or(data).to_owned());
            }
        }
        completed
    }
}

#[cfg(test)]
mod test;
