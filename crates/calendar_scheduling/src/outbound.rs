//! Persistence adapters for scheduling-owned data.
#[cfg(feature = "calendar")]
pub mod macro_services;
#[cfg(feature = "postgres")]
pub mod postgres;
