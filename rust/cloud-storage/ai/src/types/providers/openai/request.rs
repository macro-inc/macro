use crate::traits::Metadata;
use crate::types::ChatCompletionRequest;
use anyhow::Context;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
    ChatCompletionRequestSystemMessageContent, CreateChatCompletionRequest,
    CreateChatCompletionRequestArgs, ResponseFormat, ResponseFormatJsonSchema,
};
use schemars::{JsonSchema, schema_for};
use serde::Deserialize;

impl ChatCompletionRequest {
    pub fn openai_messages(self) -> Vec<ChatCompletionRequestMessage> {
        let system_message =
            ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
                content: ChatCompletionRequestSystemMessageContent::Text(
                    self.system_prompt.to_string(),
                ),
                name: None,
            });

        let mut all_messages = vec![system_message];
        all_messages.extend(
            self.messages
                .into_iter()
                .flat_map(Vec::<ChatCompletionRequestMessage>::from),
        );
        all_messages
    }
}

impl ChatCompletionRequest {
    /// misnomer this actually uses the -- tools api
    pub fn as_structured_request<S>(
        self,
        stream: bool,
    ) -> anyhow::Result<CreateChatCompletionRequest>
    where
        S: JsonSchema + Metadata + for<'de> Deserialize<'de>,
    {
        let schema = schema_for!(S);
        let json_schema = serde_json::to_value(schema).context("failed to form json_schema")?;
        tracing::debug!(
            "{}",
            serde_json::to_string_pretty(&json_schema).expect("json_string")
        );

        let response_format = ResponseFormat::JsonSchema {
            json_schema: ResponseFormatJsonSchema {
                description: S::description(),
                name: S::name(),
                schema: Some(json_schema),
                strict: Some(true),
            },
        };

        CreateChatCompletionRequestArgs::default()
            .stream(stream)
            .model(format!(
                "{}/{}",
                self.model.to_provider_model_string().0,
                self.model
            ))
            .messages(self.openai_messages())
            .response_format(response_format)
            .build()
            .context("Could not build openai request")
    }
}
