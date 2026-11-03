//! Continuous Dialpad call sync. The user's Dialpad grant lives in Macro
//! Connect; this crate subscribes to their calls, stores signed deliveries,
//! and imports each call as a private Macro call.
pub mod domain;
pub mod inbound;
pub mod outbound;
