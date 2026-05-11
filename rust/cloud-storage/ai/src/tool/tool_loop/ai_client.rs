use super::chat::Chat;
use crate::openai_toolset::OpenAIToolSetExt;
use crate::tool::types::{AsyncToolCollection, ToolSet};
use crate::types::AnthropicClient;
use crate::types::ExtendedClient;
use anthropic::openai::request::{AnthropicRequestExtension, AnthropicRequestExtensions};
use std::sync::Arc;

pub struct ToolLoop<I, T, S = AsyncToolCollection<T>>
where
    I: ExtendedClient + Clone + Send + Sync,
    T: Clone + Send + Sync,
{
    client: I,
    context: T,
    toolset: Arc<S>,
}

impl<T, S> ToolLoop<AnthropicClient, T, S>
where
    T: Clone + Send + Sync,
{
    pub fn new(toolset: Arc<S>, context: T) -> Self {
        let extensions = AnthropicRequestExtensions(vec![
            AnthropicRequestExtension::WebSearchTool,
            AnthropicRequestExtension::FetchTool,
            AnthropicRequestExtension::CodeExecutionTool,
        ]);
        let client = AnthropicClient::new(extensions);
        Self {
            client,
            context,
            toolset,
        }
    }
}

impl<I, T, S> ToolLoop<I, T, S>
where
    I: ExtendedClient + Clone + Send + Sync,
    T: Clone + Send + Sync,
    S: ToolSet<T> + OpenAIToolSetExt,
{
    pub fn chat(&self) -> Chat<I, T, S> {
        Chat::new(
            self.client.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }
}
