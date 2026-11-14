//! The agent monitor's collector: a normalized model of every agent on the
//! machine, a single-writer store that reduces source observations into it,
//! and a gRPC server and client over a user-only Unix socket.
//!
//! - [`domain::model`]: the agent model and the updates viewers receive.
//! - [`domain::observation`]: what sources send, and the reducer's join keys.
//! - [`domain::source`]: the source and transcript ports.
//! - [`proto`]: the generated wire types and their conversions.
#![deny(missing_docs)]

pub mod domain;
pub mod proto;
