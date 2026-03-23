use super::chained::Chained;
use super::chat::Chat;
use crate::tool::types::AsyncToolSet;
use crate::types::AnthropicClient;
use crate::types::ExtendedClient;
use anthropic::openai::request::{AnthropicRequestExtension, AnthropicRequestExtensions};
use std::sync::Arc;

pub struct ToolLoop<I, T>
where
    I: ExtendedClient + Clone + Send + Sync,
    T: Clone + Send + Sync,
{
    client: I,
    context: T,
    toolset: Arc<AsyncToolSet<T>>,
}

impl<T> ToolLoop<AnthropicClient, T>
where
    T: Clone + Send + Sync,
{
    pub fn new(toolset: Arc<AsyncToolSet<T>>, context: T) -> Self {
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

impl<I, T> ToolLoop<I, T>
where
    I: ExtendedClient + Clone + Send + Sync,
    T: Clone + Send + Sync,
{
    pub fn chat(&self) -> Chat<I, T> {
        Chat::new(
            self.client.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }

    pub fn chained(&self) -> Chained<I, T> {
        Chained::new(
            self.client.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }
}
