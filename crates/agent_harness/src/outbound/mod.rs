//! Outbound adapters: the concrete providers, stores, and carriers the domain
//! ports are satisfied by.

pub mod channel_announcer;
pub mod daytona;
pub mod namespace;
pub(crate) mod provision;
pub mod sidecar;
