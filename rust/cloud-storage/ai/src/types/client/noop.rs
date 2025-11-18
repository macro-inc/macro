use super::traits::Client;
use crate::types::AiError;
use anyhow::anyhow;

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
