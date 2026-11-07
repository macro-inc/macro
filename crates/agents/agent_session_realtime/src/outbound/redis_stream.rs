//! Appended agent session log frames over a Redis Stream.
//!
//! The harness `XADD`s each run of frames it stores to one stream,
//! [`STREAM_KEY`]. Every process serving viewers over GraphQL reads the whole
//! stream through a consumer group of its own, so each process sees every
//! run, and acknowledges a run once it has handed it to the session's
//! subscribers. A run the process received but never acknowledged - its
//! connection dropped mid-read, say - stays pending in its group and is read
//! again once the connection is back.
//!
//! The stream carries the frames themselves rather than a pointer to them, so
//! a run's size is bounded only by Redis' 512 MiB value limit. It keeps
//! [`RETENTION`] of history: trimmed on every append by entry id, which is a
//! timestamp.

#[cfg(test)]
mod test;

/// The `XREADGROUP` consumer feeding the fan-out.
pub mod consumer;
/// The `XADD` publisher wrapping the harness' realtime.
pub mod publisher;

use std::time::Duration;

use agent_session::domain::events::LogAppendedMetadata;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;

/// The one stream every run of every session is appended to.
pub const STREAM_KEY: &str = "agent_session_log:v1";

/// How long the stream keeps an entry. Long enough for a reader whose
/// connection dropped to come back and read what it missed; past it, the
/// durable log is where a viewer catches up.
pub const RETENTION: Duration = Duration::from_secs(15 * 60);

/// Prefix of every consumer group a reading process creates, so abandoned
/// groups can be told apart from anything else reading the stream.
pub const GROUP_PREFIX: &str = "agent-session-log-subscriptions:";

/// Wire format version, carried on every entry.
pub const WIRE_VERSION: u8 = 1;

/// Entry field names.
pub(crate) mod field {
    /// [`super::WIRE_VERSION`].
    pub const VERSION: &str = "v";
    /// The session the frames belong to, duplicated out of the payload so
    /// `XRANGE` in redis-cli says whose run an entry is.
    pub const SESSION: &str = "session";
    /// How many frames the payload holds.
    pub const FRAMES: &str = "frames";
    /// Unix milliseconds the publisher sent the entry at, for delivery lag.
    pub const PUBLISHED_AT_MS: &str = "published_at_ms";
    /// [`LogAppendedMetadata`] as JSON.
    pub const PAYLOAD: &str = "payload";
}

/// The JSON a run travels as.
pub(crate) fn encode(run: &LogAppendedMetadata) -> Result<String, Report> {
    Ok(serde_json::to_string(run).context("failed to encode an agent session log run")?)
}

/// A run back from its JSON.
pub(crate) fn decode(payload: &[u8]) -> Result<LogAppendedMetadata, Report> {
    Ok(serde_json::from_slice(payload).context("failed to decode an agent session log run")?)
}

/// Unix milliseconds now.
pub(crate) fn now_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or_default()
}

/// The `MINID` that trims entries older than [`RETENTION`]: entry ids start
/// with the unix milliseconds Redis added them at.
pub(crate) fn retention_floor(now_ms: u64) -> String {
    let retention_ms = u64::try_from(RETENTION.as_millis()).unwrap_or(u64::MAX);
    format!("{}-0", now_ms.saturating_sub(retention_ms))
}

/// The unix milliseconds an entry id was assigned at.
pub(crate) fn entry_id_ms(entry_id: &str) -> Option<u64> {
    entry_id.split_once('-')?.0.parse().ok()
}
