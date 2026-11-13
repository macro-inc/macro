//! Models, the lifecycle state machine, ports and services.

pub mod claude_sign_in;
pub mod enrollment;
#[cfg(test)]
pub(crate) mod fakes;
pub mod ids;
pub mod image;
pub mod lifecycle;
pub mod models;
#[cfg(feature = "ports")]
pub mod operator;
pub mod pool;
pub mod ports;
pub mod rollout;
pub mod service;
pub mod setup;
pub mod size;

/// Trace propagation and lifecycle measurements.
pub mod telemetry;
