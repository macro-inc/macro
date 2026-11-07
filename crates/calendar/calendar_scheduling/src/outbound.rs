//! Persistence adapters for scheduling-owned data.
#[cfg(feature = "calendar")]
pub mod macro_services;
#[cfg(feature = "calendar")]
pub mod meeting_links;
#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "client")]
pub mod administration_client;
