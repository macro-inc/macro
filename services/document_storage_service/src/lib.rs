#![recursion_limit = "256"]
//! Document storage service. The service binary and the OpenAPI generator both
//! link this library, so the service compiles once and caches as one rlib.

mod api;
mod config;
mod db_pools;
mod external_chat;
mod mcp_live_subscribers;
mod mcp_subscription_sweep;
pub mod model;
mod outbound;
mod passwords_cleanup;
mod released_attachments;
mod server;
mod service;

/// The service's OpenAPI document, rendered by the `*_openapi` binary.
pub use api::swagger::ApiDoc;
pub use server::run;
