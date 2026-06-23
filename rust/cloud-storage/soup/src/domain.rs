/// Domain model types for soup requests, responses, grouping, and errors.
pub mod models;
#[cfg(feature = "ports")]
/// Domain traits implemented by soup repositories and services.
pub mod ports;
#[cfg(feature = "ports")]
/// Default soup service implementation.
pub mod service;
