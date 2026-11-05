pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "http_client", feature = "s3"))]
pub mod outbound;
#[cfg(test)]
pub(crate) mod telemetry_capture;


#[doc(hidden)]
#[allow(dead_code)]
const CI_INTEGRATE_NONCE: &str = "493a4db8e88a4eeb990986b16c2f9540";
