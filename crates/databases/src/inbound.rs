//! Driving adapters: the Axum database and starter provisioning routers.

#[cfg(feature = "inbound")]
pub mod axum_router;

/// Authenticated starter provisioning endpoint.
#[cfg(feature = "inbound")]
pub mod starter_router;
