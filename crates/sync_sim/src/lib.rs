//! Deterministic, dev-only simulation of the real synchronization cores.
#![deny(missing_docs)]

mod facts;
pub use facts::*;
mod model;
pub use model::*;
mod clock;
pub use clock::SimClock;
mod document;
mod network;
pub use network::SimNetwork;
mod storage;
pub use storage::SimStorage;
mod router;
pub use router::SimRouter;
mod server;
pub use server::SimServer;
mod client;
pub use client::SimClient;
mod world;
pub use world::Sim;
/// Fact-based safety and liveness queries; no running-world access.
pub mod invariants;

#[cfg(test)]
mod test;
