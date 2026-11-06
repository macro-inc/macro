//! Outbound adapters for the system status crate.

#[cfg(feature = "connection_gateway")]
pub mod connection_gateway_broadcaster;

#[cfg(feature = "postgres")]
pub mod pg_system_status_repo;
