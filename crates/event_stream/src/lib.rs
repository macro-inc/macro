#![deny(missing_docs)]
//! Public event streams: one core for live streams (SSE with cursors) and
//! the audience and filter rules persisted webhooks share.
//!
//! Broker events become public through their declared exposure
//! ([`domain::normalize`]). The `public-event-log` consumer appends them,
//! with their audience, to a short-retention log every API process tails;
//! each process resolves an event's audience once for all its open streams
//! ([`domain::fan_out`]). See `AGENTS.md`.

pub mod domain;
pub mod inbound;
pub mod metrics;
pub mod outbound;
pub mod topics;
