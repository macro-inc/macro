#![recursion_limit = "256"]
//! Document cognition service. The service binary and the OpenAPI generator
//! both link this library, so the service compiles once and caches as one rlib.

mod api;
mod config;
mod core;
mod model;
mod server;
mod service;

/// The service's OpenAPI document, rendered by the `*_openapi` binary.
pub use api::swagger::ApiDoc;
pub use server::run;
