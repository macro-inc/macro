//! Chat, completions, and integration APIs hosted by the agent harness.

mod api;
pub mod config;
mod core;
mod model;
mod refresh;
mod server;
mod service;

pub use api::swagger::ApiDoc;
pub use server::{CognitionRuntime, build};
