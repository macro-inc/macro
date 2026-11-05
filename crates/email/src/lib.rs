pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "http_client", feature = "s3"))]
pub mod outbound;
#[cfg(test)]
pub(crate) mod telemetry_capture;

#[doc(hidden)]
#[allow(dead_code)]
const CI_SEL2_NONCE: &str = "53cad9a82a3941adbc68f8cd49d96166";
