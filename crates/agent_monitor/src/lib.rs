//! The agent monitor's collector: a normalized model of every agent on the
//! machine, a single-writer store that reduces source observations into it,
//! and a gRPC server and client over a user-only Unix socket.
//!
//! - [`domain::model`]: the agent model and the updates viewers receive.
//! - [`domain::observation`]: what sources send, and the reducer's join keys.
//! - [`domain::source`]: the source and transcript ports.
//! - [`domain::store`]: the single-writer store and its broadcast.
//! - [`outbound::demo`]: the scripted demo fleet.
//! - [`inbound::grpc`] and [`client`]: the server and client (Unix only).
//! - [`proto`]: the generated wire types and their conversions.
#![deny(missing_docs)]

#[cfg(unix)]
pub mod client;
pub mod domain;
#[cfg(unix)]
pub mod inbound;
pub mod outbound;
pub mod proto;
pub mod trace_context;
