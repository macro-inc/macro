#![deny(missing_docs)]

//! Configuration, AWS SDK setup, telemetry, and HTTP tracing for Macro Connect services.

mod config;
mod http;
mod telemetry;

pub use config::{ConfigError, ConfigLoader};
pub use http::{http_trace_layer, inject_trace_headers};
pub use telemetry::{Telemetry, TelemetryError};

/// Load the default AWS SDK configuration for Connect services.
pub async fn load_aws_config() -> aws_config::SdkConfig {
    aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await
}
