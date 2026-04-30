/// Connection gateway notifier adapter.
#[cfg(feature = "outbound")]
pub mod gateway;
/// SQS-backed contacts ingress queue adapter.
#[cfg(feature = "outbound")]
pub mod ingress;
/// Database-backed contacts repository.
#[cfg(feature = "outbound")]
pub mod repository;
