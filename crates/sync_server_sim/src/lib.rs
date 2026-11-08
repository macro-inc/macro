#![deny(missing_docs)]
//! Native synchronization-room ports and lossless golden transcript loading.
//! Callback replay is explicitly gated until the corresponding Worker bodies move into core.
extern crate loro_server as loro;
/// Deterministic in-memory runtime capabilities.
pub mod ports;
/// Real-core room ownership and the explicit replay allowlist.
pub mod replay;
#[cfg(test)]
mod test;
/// Golden transcript parsing and comparison primitives.
pub mod transcript;

#[cfg(test)]
mod migration_test;

#[cfg(test)]
mod persistence_test;
