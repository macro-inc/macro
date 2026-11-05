pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "http_client", feature = "s3"))]
pub mod outbound;
#[cfg(test)]
pub(crate) mod telemetry_capture;

#[doc(hidden)]
#[allow(dead_code)]
const CI_SEL2_NONCE: &str = "2cb10e92ef4645058fa90500ba2e1bb4";
