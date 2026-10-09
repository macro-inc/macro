//! Session code-mode use cases.
/// Bounded AI generation with host-owned usage admission and recording.
pub mod ai;
mod models;
mod ports;
mod sdk;
mod service;

pub use models::*;
pub use ports::*;
pub use sdk::*;
pub use service::*;
