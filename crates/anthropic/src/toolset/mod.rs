mod bash_code_execution;
#[cfg(test)]
mod test;
mod text_editor_code_execution;
mod web_fetch;
mod web_search;

pub use bash_code_execution::BashCodeExecution;
pub use text_editor_code_execution::TextEditorCodeExecution;
pub use web_fetch::WebFetch;
pub use web_search::WebSearch;

use crate::client::Client;
use crate::types::request::{
    CreateMessageRequestBody, RequestContent, RequestMessage, Role, ServerTool, SystemPrompt, Tool,
};
use crate::types::response::{Content, MessageResponse, ResponseContentKind};
use ai_toolset::{AsyncToolCollection, ToolCallError};
use std::sync::Arc;

/// Service context for Anthropic server tools.
pub struct AnthropicToolContext {
    /// The Anthropic API client.
    pub client: Arc<Client>,
    /// The model to use for server tool invocations.
    pub model: String,
}

impl Clone for AnthropicToolContext {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
            model: self.model.clone(),
        }
    }
}

impl AnthropicToolContext {
    /// Create a new context from a client and model name.
    pub fn new(client: Client, model: String) -> Self {
        Self {
            client: Arc::new(client),
            model,
        }
    }
}

/// Create the Anthropic server tools toolset.
pub fn anthropic_toolset() -> AsyncToolCollection<AnthropicToolContext> {
    AsyncToolCollection::new()
        .add_tool::<WebSearch, AnthropicToolContext>()
        .add_tool::<WebFetch, AnthropicToolContext>()
        .add_tool::<BashCodeExecution, AnthropicToolContext>()
        .add_tool::<TextEditorCodeExecution, AnthropicToolContext>()
}

pub(crate) async fn invoke_server_tool(
    client: &Client,
    model: &str,
    server_tool: ServerTool,
    input: &str,
) -> Result<Vec<ResponseContentKind>, ToolCallError> {
    let request = CreateMessageRequestBody {
        model: model.to_string(),
        messages: vec![RequestMessage {
            role: Role::User,
            content: RequestContent::Text(input.to_string()),
        }],
        max_tokens: 16000,
        tools: Some(vec![Tool::Server(server_tool)]),
        system: Some(SystemPrompt::Text(
            "Use the provided tool to fulfill the user's request.".into(),
        )),
        ..Default::default()
    };

    let response: MessageResponse =
        client
            .chat()
            .create(request)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Anthropic API error: {e:?}"),
                internal_error: e.into(),
            })?;

    match response.content {
        Some(Content::Array(blocks)) => Ok(blocks),
        _ => Ok(Vec::new()),
    }
}
