//! Transport adapters for administrator import use cases.

#[cfg(feature = "inbound")]
pub mod axum_router;
#[cfg(feature = "worker")]
pub mod worker;
