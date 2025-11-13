use crate::traits::Metadata;
use crate::types::ChatCompletionRequest;
use anyhow::Context;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestMessageContentPartText,
    ChatCompletionRequestSystemMessage, ChatCompletionRequestSystemMessageContent,
    ChatCompletionRequestSystemMessageContentPart, CreateChatCompletionRequest,
    CreateChatCompletionRequestArgs,
    ResponseFormat, ResponseFormatJsonSchema,
};
use schemars::{JsonSchema, schema_for};
use serde::Deserialize;

impl ChatCompletionRequest {
    pub fn openai_messages(&self) -> Vec<ChatCompletionRequestMessage> {
        let mut all_messages = vec![];
        let system_message_parts = self
            .system_prompt
            .clone()
            .format_for_caching(4)
            .into_iter()
            .map(|part| {
                ChatCompletionRequestSystemMessageContentPart::Text(
                    ChatCompletionRequestMessageContentPartText { text: part },
                )
            })
            .collect::<Vec<_>>();

        let system_message =
            ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
                content: ChatCompletionRequestSystemMessageContent::Array(system_message_parts),
                name: None,
            });

        let messages: Vec<ChatCompletionRequestMessage> = self
            .messages
            .clone()
            .into_iter()
            .flat_map(Vec::<ChatCompletionRequestMessage>::from)
            .collect();

        all_messages.push(system_message);
        all_messages.extend(messages);
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
            .model(self.model.to_string())
            .messages(self.openai_messages())
            .response_format(response_format)
            .build()
            .context("Could not build openai request")
    }
}
