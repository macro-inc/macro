#![deny(missing_docs)]
//! Facade over the split frecency crates, kept so existing imports such as
//! `frecency::domain::models` and `frecency::outbound::postgres` still work.
//!
//! New code should depend on the layer it needs: `frecency_core` for models,
//! ports and services, `frecency_outbound` for adapters, and
//! `frecency_inbound` for the polling worker.

/// Models, ports and services (`frecency_core`).
pub use frecency_core as domain;

/// The polling aggregation worker (`frecency_inbound`).
#[cfg(feature = "inbound")]
pub use frecency_inbound as inbound;

/// Storage, mock and clock adapters (`frecency_outbound`).
#[cfg(feature = "outbound")]
pub use frecency_outbound as outbound;
