use super::chained::Chained;
use super::chat::Chat;
use crate::tool::types::AsyncToolSet;
use crate::types::{OpenRouterClient, openrouter::OpenRouterConfig};
use async_openai::Client;
use async_openai::config::Config;
use std::ops::Deref;
use std::sync::Arc;

pub struct AiClient<C, T, I, R>
where
    C: Config + Send + Sync,
    T: Clone + Send + Sync,
    I: Deref<Target = Client<C>> + Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    inner: I,
    context: T,
    toolset: Arc<AsyncToolSet<T, R>>,
}

impl<T, R> AiClient<OpenRouterConfig, T, OpenRouterClient, R>
where
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn new(toolset: AsyncToolSet<T, R>, context: T) -> Self {
        let client = OpenRouterClient::new();
        let toolset = Arc::new(toolset);
        Self {
            inner: client,
            context,
            toolset,
        }
    }
}

impl<C, T, I, R> AiClient<C, T, I, R>
where
    C: Config + Send + Sync,
    T: Clone + Send + Sync,
    I: Deref<Target = Client<C>> + Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn chat(&self) -> Chat<C, T, I, R> {
        Chat::new(
            self.inner.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }

    pub fn chained(&self) -> Chained<C, T, I, R> {
        Chained::new(
            self.inner.clone(),
            self.toolset.clone(),
            self.context.clone(),
        )
    }
}
