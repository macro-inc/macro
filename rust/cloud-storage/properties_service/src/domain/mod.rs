//! Domain layer - core business logic, models, and port definitions

pub mod error;
pub mod models;
pub mod ports;
pub mod service_port;
pub mod services;
pub mod storage_port;

pub use error::*;
