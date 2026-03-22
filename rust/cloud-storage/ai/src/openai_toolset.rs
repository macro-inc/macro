//! OpenAI API integration for toolsets.
//!
//! This module provides conversions to OpenAI's tool types for use with
//! the `async-openai` crate.

use ai_toolset::ToolSet;
use ai_toolset::tool_object::ToolObject;
use async_openai::types::{ChatCompletionTool, ChatCompletionToolType, FunctionObject};

/// Converts a ToolObject to an OpenAI ChatCompletionTool.
pub fn tool_object_to_chat_completion_tool<T>(value: &ToolObject<T>) -> ChatCompletionTool {
    ChatCompletionTool {
        r#type: ChatCompletionToolType::Function,
        function: FunctionObject {
            name: value.name.clone(),
            description: Some(value.description.clone()),
            parameters: Some(serde_json::Value::Object(value.input_schema.clone())),
            strict: Some(true),
        },
    }
}

/// Extension trait for ToolSet to convert to OpenAI chat completion tools.
pub trait OpenAIToolSetExt {
    /// Converts this toolset to a vector of OpenAI chat completion tools.
    ///
    /// Returns tool definitions suitable for use with OpenAI's function calling API.
    fn openai_chatcompletion_toolset(&self) -> Vec<ChatCompletionTool>;
}

impl<T> OpenAIToolSetExt for ToolSet<ToolObject<T>> {
    fn openai_chatcompletion_toolset(&self) -> Vec<ChatCompletionTool> {
        self.tools
            .values()
            .map(tool_object_to_chat_completion_tool)
            .collect()
    }
}
