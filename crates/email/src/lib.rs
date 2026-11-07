pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "http_client", feature = "s3"))]
pub mod outbound;
/// Conversions into the Soup wire models.
pub mod soup;
#[cfg(test)]
pub(crate) mod telemetry_capture;
pub mod trace_context;
