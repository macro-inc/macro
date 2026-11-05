pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "http_client", feature = "s3"))]
pub mod outbound;
#[cfg(test)]
pub(crate) mod telemetry_capture;

/// CI proof salt.
#[allow(dead_code)]
pub const CI_PROOF_SALT: &str = "medium-8";
