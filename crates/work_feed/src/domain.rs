//! Work feed domain: models, ports, policy, stacking and the service.

pub mod models;
pub mod policy;
pub mod ports;
pub mod realtime;
pub mod service;
pub mod stacking;

/// Notification fixtures shared by the domain tests.
#[cfg(test)]
pub(crate) mod test_support;
