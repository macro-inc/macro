//! Chat, completions, and integration APIs hosted by the agent harness.

mod api;
pub mod config;
mod core;
mod model;
mod server;
mod service;

#[cfg(test)]
pub(crate) use api::context::test::{ADMISSION_TEST_USER, test_api_context};
pub use api::swagger::ApiDoc;
pub use server::{CognitionRuntime, build};
/// Bounded tool-free completions, which routine suggestions use too.
pub use service::structured_completion::{
    ToolFreeCompletion, ToolFreeCompletionService, ToolFreeRequest,
};
