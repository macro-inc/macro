#![recursion_limit = "256"]
//! Authentication service. The service binary, the OpenAPI generator, and the
//! Doppler config check all link this library, so the service compiles once
//! and caches as one rlib.

mod account_link_state;
mod api;
mod config;
mod generate_password;
mod microsoft_token_cipher;
pub mod outbound;
mod rate_limit_config;
mod server;
pub mod service;

/// The service's OpenAPI document, rendered by the `*_openapi` binary.
pub use api::swagger::ApiDoc;
/// The service configuration, loaded from Doppler by the config check binary.
pub use config::Config;
pub use server::run;
