//! Chat, completions, and integration APIs hosted by the agent harness.

mod api;
pub mod config;
mod core;
mod model;
mod refresh;
mod server;
mod service;

pub use api::swagger::ApiDoc;
pub use api::tool_selection::{
    AI_DB_ASSISTANT_CODE_MODE, DatabaseCodeModePolicy, DirectDatabaseTools, FlaggedDatabaseCodeMode,
};
pub use server::{CognitionRuntime, DatabaseAssistantCodeMode, build};
/// Bounded tool-free completions, which routine suggestions use too.
pub use service::structured_completion::{
    ToolFreeCompletion, ToolFreeCompletionService, ToolFreeRequest,
};
