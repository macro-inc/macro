#![deny(missing_docs)]
//! Continuous Dialpad call sync. The user's Dialpad grant lives in Macro
//! Connect; this crate subscribes to their calls, stores signed deliveries,
//! and imports each call as a private Macro call.
/// Sync use cases, models and ports.
pub mod domain;
/// HTTP routes and the background worker.
pub mod inbound;
/// Postgres, Dialpad, Macro Connect and signature adapters.
pub mod outbound;
