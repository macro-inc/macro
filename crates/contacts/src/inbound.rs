/// HTTP handlers, router, DTOs, and swagger definitions.
#[cfg(feature = "axum")]
pub mod http;
/// SQS message parsing and worker.
#[cfg(feature = "inbound")]
pub mod worker;
