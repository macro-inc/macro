/// Connection gateway notifier adapter.
#[cfg(feature = "outbound")]
pub mod gateway;
/// SQS-backed contacts ingress queue adapter.
#[cfg(feature = "outbound")]
pub mod ingress;
/// Existing viewer-aware user-name resolution behind the directory's name port.
#[cfg(feature = "directory-names")]
pub mod names;
/// Database-backed contacts repository.
#[cfg(feature = "outbound")]
pub mod repository;
