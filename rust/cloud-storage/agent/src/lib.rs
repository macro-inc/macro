#![deny(missing_docs)]

//! Agent crate — agentic loop

mod accumulator;
mod agent_loop;
mod anthropic_model;
mod completion;
mod convert;
mod error;
mod hook;
mod model;
mod stream;
/// Structured output via prompted JSON generation.
pub mod structured_output;
mod tool_adapter;
pub mod types;

pub use accumulator::StreamAccumulator;
pub use agent_loop::{AgentLoop, Session};
pub use completion::{complete, complete_with_history};
pub use convert::{merge_consecutive_parts, to_rig_messages};
pub use error::AgentError;
pub use hook::StreamBridge;
pub use model::AgentModel;
pub use stream::{ChatCompletionStream, McpInfo, StreamPart, ToolCall, ToolResponse, Usage};
pub use tool_adapter::{DynToolSetAdapter, ToolsetToolAdapter};

pub use rig_core::message::Message;
pub use rig_core::tool::{Tool, ToolDyn};
