#![deny(missing_docs)]
//! Wake telemetry for agent accounts (`User."isAgent"`).
//!
//! An agent teammate built on muppet records every time it is woken as a
//! `WakeRecord` (version 1, the format of muppet's telemetry utility) and
//! uploads a redacted trace of the wake's model session. This crate stores
//! the latest record per wake in `agent_wakes` and one trace blob per wake in
//! object storage, and serves them to the agent and the owners and admins of
//! its teams. Everything is gated by `enable-agent-dashboards`.

/// Models, ports and the wake service.
pub mod domain;
/// HTTP routes.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Postgres, S3 and feature-flag adapters.
#[cfg(feature = "outbound")]
pub mod outbound;
