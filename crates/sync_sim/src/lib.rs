//! Deterministic, dev-only simulation of the real synchronization cores.
#![deny(missing_docs)]

mod facts;
mod replay;
mod stats;
pub use facts::*;
mod defaults;
pub use defaults::*;
mod model;
pub use model::*;
mod clock;
pub use clock::SimClock;
mod document;
mod network;
pub use network::SimNetwork;
mod storage;
pub use storage::{SimStorage, StoreImage};
mod router;
/// Reusable transaction cases and an independent IndexedDB-style reference model.
pub mod storage_reference;
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
