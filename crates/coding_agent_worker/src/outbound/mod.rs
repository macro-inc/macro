//! The daemon's adapters to the Macro backend.
//!
//! Everything here is a client this daemon calls out with, and every request
//! and response body is the server's own type imported from the owning crate
//! rather than a copy declared here. That is the point of the module: a
//! server-side field rename becomes a compile error on this side instead of a
//! runtime surprise on someone's laptop.

pub mod agent_session;
pub mod link;
pub mod pairing;
pub mod stream;
