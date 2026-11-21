//! Models, the lifecycle state machine, ports and services.

pub mod agent;
pub mod claude_sign_in;
pub mod enrollment;
#[cfg(test)]
pub(crate) mod fakes;
pub mod ids;
pub mod image;
pub mod lifecycle;
pub mod models;
pub mod moves;
#[cfg(feature = "ports")]
pub mod operator;
pub mod overcommit;
pub mod ports;
pub mod rollout;
pub mod service;
pub mod setup;
pub mod size;
pub mod usage;

/// Trace propagation and lifecycle measurements.
pub mod telemetry;
