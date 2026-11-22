//! The connectors domain: which connection counts for each app, and the
//! services that are the only way to use one.
//!
//! [`models`] holds the public types and [`service`] the exported service
//! traits. The ports every source implements, the catalog lookups and the
//! resolver that applies the rules stay inside the crate, so no other crate
//! can name a source or tell which one holds a connection.

// Until the services are implemented, only the tests call the resolver and
// nothing calls the ports.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the services in service.rs are implemented over these in the next step; remove this then"
    )
)]
mod catalog;
#[expect(
    dead_code,
    reason = "the services in service.rs are implemented over these in the next step; remove this then"
)]
pub mod models;
#[expect(
    dead_code,
    reason = "the services in service.rs are implemented over these in the next step; remove this then"
)]
pub(crate) mod ports;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the services in service.rs are implemented over these in the next step; remove this then"
    )
)]
mod resolve;
pub mod service;
