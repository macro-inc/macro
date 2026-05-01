use super::traits::{ExtendedClient, ExtendedOpenAIStream};
use crate::tool::StreamPart;
use crate::types::AiError;
use anyhow::anyhow;

#[derive(Debug, Clone, Default)]
pub struct NoOpClient;

#[derive(Debug, Clone)]
pub enum NoOpExtension {}

impl ExtendedClient for NoOpClient {
    type ResponseExtension = NoOpExtension;

    async fn chat_stream(
        &self,
        _: async_openai::types::chat::CreateChatCompletionRequest,
    ) -> Result<ExtendedOpenAIStream<Self::ResponseExtension>, AiError> {
        Err(anyhow!("noop").into())
    }

    fn handle_extension_item(&self, _: Self::ResponseExtension) -> Option<StreamPart> {
        None
    }
}
