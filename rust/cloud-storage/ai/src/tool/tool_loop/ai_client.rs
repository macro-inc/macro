use super::chained::Chained;
use super::chat::Chat;
use crate::tool::types::AsyncToolSet;
use crate::types::AnthropicClient;
use crate::types::ExtendedClient;
use anthropic::openai::request::AnthropicRequestExtensions;
use std::sync::Arc;

pub struct ToolLoop<I, T, R>
where
    I: ExtendedClient + Clone + Send + Sync,
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    inner: I,
    context: T,
    toolset: Arc<AsyncToolSet<T, R>>,
    extensions: I::RequestExtension,
}

impl<T, R> ToolLoop<AnthropicClient, T, R>
where
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn new(toolset: AsyncToolSet<T, R>, context: T) -> Self {
        let client = AnthropicClient::new();
        let toolset = Arc::new(toolset);
        let extensions = AnthropicRequestExtensions(vec![]);
        Self {
            inner: client,
            context,
            toolset,
            extensions,
        }
    }
}

impl<I, T, R> ToolLoop<I, T, R>
where
    I: ExtendedClient + Clone + Send + Sync,
    I::RequestExtension: Clone,
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn chat(&self) -> Chat<I, T, R> {
        Chat::new(
            self.inner.clone(),
            self.toolset.clone(),
            self.context.clone(),
            self.extensions.clone(),
        )
    }

    pub fn chained(&self) -> Chained<I, T, R> {
        Chained::new(
            self.inner.clone(),
            self.toolset.clone(),
            self.context.clone(),
            self.extensions.clone(),
        )
    }
}
