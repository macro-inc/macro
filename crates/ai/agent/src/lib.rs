#![deny(missing_docs)]

//! Agent crate — agentic loop

mod accumulator;
mod agent_loop;
mod completion;
mod convert;
mod error;
mod hook;
mod model;
mod stream;
/// Structured output via prompted JSON generation.
pub mod structured_output;
mod telemetry;
mod tool_adapter;
mod tool_media;
mod tool_result_limit;

#[cfg(test)]
mod test;
pub mod types;

pub use accumulator::StreamAccumulator;
pub use agent_loop::{AgentLoop, Session, SystemPrompt};
pub use completion::{
    complete, complete_about_image, complete_with_history, complete_with_history_and_params,
};
pub use convert::{merge_consecutive_parts, to_rig_messages, to_rig_messages_limited};
pub use error::AgentError;
pub use hook::{FinishedUserTool, PendingUserTool, UserToolFinisher};
pub use model::metering::{MeteringContext, MeteringError, ProviderSupport, WireProtocol};
pub use model::{ModelSpeed, PredefinedModel, ReasoningEffort};
pub use stream::{
    ChatCompletionStream, McpInfo, StreamPart, ToolCall, ToolCallStart, ToolResponse, Usage,
};
pub use tool_adapter::{DynToolSetAdapter, ToolsetToolAdapter, normalize_request_schema};
pub use tool_result_limit::{ReadToolResult, ToolResultLimit};

pub use rig_core::completion::CompletionError;
pub use rig_core::message::Message;
