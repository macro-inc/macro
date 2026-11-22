//! The connectors domain: which connection counts for each app, and the
//! services that are the only way to use one.
//!
//! [`models`] holds the public types and [`service`] the exported service
//! traits and their implementation. The ports every source implements, the
//! catalog lookups, the flag policy and the resolver that applies the rules
//! stay inside the crate, so no other crate can name a source or tell which
//! one holds a connection.

pub(crate) mod catalog;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the sources and composition use these in the next step; remove this then"
    )
)]
pub mod models;
pub(crate) mod policy;
pub(crate) mod ports;
pub(crate) mod resolve;
pub mod service;
