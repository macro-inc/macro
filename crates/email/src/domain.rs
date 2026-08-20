/// Event-to-activity mappings for this domain.
pub mod activity;
pub mod events;
pub mod models;

#[cfg(feature = "ports")]
pub mod assembler;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod service;
