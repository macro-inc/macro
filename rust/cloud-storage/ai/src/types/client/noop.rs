use super::traits::Client;
use anyhow::anyhow;
use crate::types::AiError;

#[derive(Debug, Clone, Default)]
pub struct NoOpClient;

impl Client for NoOpClient {
    async fn chat_stream(
        &self,
        _: async_openai::types::CreateChatCompletionRequest,
        _: Option<super::RequestExtensions>,
    ) -> Result<async_openai::types::ChatCompletionResponseStream, AiError> {
        Err(anyhow!("noop").into())
    }
}
