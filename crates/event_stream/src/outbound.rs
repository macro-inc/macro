//! Outbound adapters.

/// Entity accessors from `entity_access`.
#[cfg(feature = "outbound")]
pub mod entity_access;
/// Team membership from MacroDB.
#[cfg(feature = "outbound")]
pub mod pg_teams;
/// The `public-event-stream` flag.
#[cfg(feature = "outbound")]
pub mod preview_flag;
/// The public event log over a Redis Stream.
#[cfg(feature = "outbound")]
pub mod redis_log;
/// The log writer's service switches.
#[cfg(feature = "outbound")]
pub mod service_switches;
/// Concurrent-stream leases.
#[cfg(feature = "outbound")]
pub mod stream_limiter;
