use super::config::OpenRouterConfig;
use crate::tool::types::StreamPart;
use crate::types::client::traits::ExtendedClient;
use crate::types::{
    AiError, ExtendedOpenAIStream, ExtendedOpenAIStreamItem, Model, ModelWithMetadataAndProvider,
};

use async_openai::Client as OpenAiClient;
use async_openai::types::{CreateChatCompletionRequest, CreateChatCompletionStreamResponse};
use futures::StreamExt;

#[derive(Clone)]
pub struct OpenRouterClient {
    inner: OpenAiClient<OpenRouterConfig>,
}

impl OpenRouterClient {
    pub fn new() -> Self {
        OpenRouterClient {
            inner: OpenAiClient::with_config(OpenRouterConfig::new()),
        }
    }
}

impl std::ops::Deref for OpenRouterClient {
    type Target = OpenAiClient<OpenRouterConfig>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl Default for OpenRouterClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenRouterClient {
    pub fn preprocess_request(
        &self,
        mut request: CreateChatCompletionRequest,
    ) -> CreateChatCompletionRequest {
        let model = serde_json::from_str::<Model>(&request.model).unwrap_or(Model::Gemini20Flash);
        let model_str = format!("{}/{}", model.provider(), model);
        request.model = model_str;
        request
    }
}

impl ExtendedClient for OpenRouterClient {
    // not yet implemented
    type ResponseExtension = ();

    async fn chat_stream(
        &self,
        request: CreateChatCompletionRequest,
    ) -> anyhow::Result<ExtendedOpenAIStream<Self::ResponseExtension>, AiError> {
        let request = self.preprocess_request(request);
        self.inner
            .chat()
            .create_stream_byot::<_, CreateChatCompletionStreamResponse>(request)
            .await
            .map(|stream| {
                Box::pin(
                    stream.map(|item_result| item_result.map(ExtendedOpenAIStreamItem::Response)),
                ) as _
            })
            .map_err(AiError::from)
    }

    // extensions are not yet supported so this will never be called
    fn handle_extension_item(&self, _: Self::ResponseExtension) -> Option<StreamPart> {
        None
    }
}
