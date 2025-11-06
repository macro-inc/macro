use super::traits::Client;
use anyhow::anyhow;

#[derive(Debug, Clone, Default)]
pub struct NoOpClient;

impl Client for NoOpClient {
    async fn chat_stream(
        &self,
        _: async_openai::types::CreateChatCompletionRequest,
        _: Option<super::RequestExtensions>,
    ) -> anyhow::Result<async_openai::types::ChatCompletionResponseStream> {
        Err(anyhow!("noop"))
    }
}
