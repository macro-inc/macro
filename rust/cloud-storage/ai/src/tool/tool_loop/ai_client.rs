use super::chained::Chained;
use super::chat::Chat;
use crate::tool::types::AsyncToolSet;
use crate::types::AnthropicClient;
use crate::types::ExtendedClient;
use anthropic::openai::request::{AnthropicRequestExtension, AnthropicRequestExtensions};
use std::sync::Arc;

pub struct ToolLoop<I, T, R>
where
    I: ExtendedClient + Clone + Send + Sync,
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    client: I,
    context: T,
    toolset: Arc<AsyncToolSet<T, R>>,
}

impl<T, R> ToolLoop<AnthropicClient, T, R>
where
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn new(toolset: AsyncToolSet<T, R>, context: T) -> Self {
        let extensions = AnthropicRequestExtensions(vec![AnthropicRequestExtension::WebSearchTool]);
        let client = AnthropicClient::new(extensions);
        let toolset = Arc::new(toolset);
        Self {
            client,
            context,
            toolset,
        }
    }
}

impl<I, T, R> ToolLoop<I, T, R>
where
    I: ExtendedClient + Clone + Send + Sync,
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn chat(&self) -> Chat<I, T, R> {
        Chat::new(
            self.client.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }

    pub fn chained(&self) -> Chained<I, T, R> {
        Chained::new(
            self.client.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }
}
