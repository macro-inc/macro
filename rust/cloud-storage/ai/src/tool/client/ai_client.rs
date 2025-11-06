use super::chained::Chained;
use super::chat::Chat;
use crate::tool::types::AsyncToolSet;
use crate::types::AnthropicClient;
use crate::types::Client;
use std::sync::Arc;

pub struct AiClient<I, T, R>
where
    I: Client + Clone + Send + Sync,
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    inner: I,
    context: T,
    toolset: Arc<AsyncToolSet<T, R>>,
}

impl<T, R> AiClient<AnthropicClient, T, R>
where
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn new(toolset: AsyncToolSet<T, R>, context: T) -> Self {
        let client = AnthropicClient::new();
        let toolset = Arc::new(toolset);
        Self {
            inner: client,
            context,
            toolset,
        }
    }
}

impl<I, T, R> AiClient<I, T, R>
where
    I: Client + Clone + Send + Sync,
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn chat(&self) -> Chat<I, T, R> {
        Chat::new(
            self.inner.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }

    pub fn chained(&self) -> Chained<I, T, R> {
        Chained::new(
            self.inner.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }
}
