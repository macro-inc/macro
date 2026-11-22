//! The connectors domain: which connection counts for each app, and the
//! services that are the only way to use one.
//!
//! [`models`] holds the public types and [`service`] the exported service
//! traits and their implementation. The ports every source implements, the
//! catalog lookups, the flag policy and the resolver that applies the rules
//! stay inside the crate, so no other crate can name a source or tell which
//! one holds a connection.

pub(crate) mod catalog;
// Until composition builds the services over the real sources, only the
// tests and the shared fake construct what composition will.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the sources and composition use these in the next step; remove this then"
    )
)]
pub mod models;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "composition reads the flag through this in the next step; remove this then"
    )
)]
pub(crate) mod policy;
pub(crate) mod ports;
pub(crate) mod resolve;
#[cfg_attr(
    not(any(test, feature = "test-fakes")),
    expect(
        dead_code,
        reason = "composition constructs the services in the next step; remove this then"
    )
)]
pub mod service;
