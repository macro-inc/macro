/// HTTP handlers, router, DTOs, and swagger definitions.
#[cfg(feature = "axum")]
pub mod http;
/// SQS message parsing and worker.
pub mod worker;
