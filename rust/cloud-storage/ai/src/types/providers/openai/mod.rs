use crate::traits::Metadata;
use crate::types::openai::message::order_messages_tool_calls;
use crate::types::{ChatCompletionRequest, response::ChatStreamCompletionResponse};
use anyhow::Context;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestMessageContentPartText,
    ChatCompletionRequestSystemMessage, ChatCompletionRequestSystemMessageContent,
    ChatCompletionRequestSystemMessageContentPart, CreateChatCompletionRequest,
    CreateChatCompletionRequestArgs, CreateChatCompletionStreamResponse,
    FinishReason as OpenAIFinishReason, ReasoningEffort, ResponseFormat, ResponseFormatJsonSchema,
};
use schemars::{JsonSchema, schema_for};
use serde::Deserialize;
pub mod message;

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

/// OPENAI
impl TryFrom<ChatCompletionRequest> for CreateChatCompletionRequest {
    type Error = anyhow::Error;

    fn try_from(value: ChatCompletionRequest) -> anyhow::Result<Self> {
        let mut all_messages: Vec<ChatCompletionRequestMessage> = vec![];
        // text parts are used for anthropic caching and have no effect on other models
        let system_message_parts = value
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

        let messages: Vec<ChatCompletionRequestMessage> = value
            .messages
            .into_iter()
            .flat_map(Vec::<ChatCompletionRequestMessage>::from)
            .collect();
        let messages = order_messages_tool_calls(messages);

        all_messages.push(system_message);
        all_messages.extend(messages);

        let model = value.model.to_string();

        Ok(if value.model.to_string().starts_with("o") {
            CreateChatCompletionRequestArgs::default()
                .model(model)
                .reasoning_effort(ReasoningEffort::High)
                .messages(all_messages)
                .build()?
        } else {
            CreateChatCompletionRequestArgs::default()
                .model(model)
                .reasoning_effort(ReasoningEffort::Medium)
                .messages(all_messages)
                .build()?
        })
    }
}

// Response
impl TryFrom<CreateChatCompletionStreamResponse> for ChatStreamCompletionResponse {
    type Error = anyhow::Error;

    fn try_from(value: CreateChatCompletionStreamResponse) -> anyhow::Result<Self> {
        let choices = value.choices.first().context("no choices");
        let content = if let Ok(choices) = choices {
            let content = choices.delta.content.clone().unwrap_or("".to_string());
            if let Some(finish_reason) = choices.finish_reason {
                match finish_reason {
                    OpenAIFinishReason::Stop => {}
                    _ => {
                        tracing::error!(
                            "unexpected finish reason for openai response: {:?}",
                            finish_reason,
                        );
                    }
                }
            }
            content
        } else {
            String::new()
        };
        Ok(ChatStreamCompletionResponse::new_content(
            content,
            value.usage,
        ))
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

#[cfg(test)]
mod test {
    #[test]
    fn test_order_correction() {
        use crate::types::Model;
        use crate::types::providers::openai::message::order_messages_tool_calls;
        use crate::types::{ChatCompletionRequest, ChatMessage, Role, SystemPrompt};
        use async_openai::types::ChatCompletionRequestMessage;

        let system_prompt = SystemPrompt {
            attachments: vec![],
            content: "system message".into(),
        };

        let messages = vec![
            ChatMessage {
                role: Role::User,
                content: crate::types::ChatMessageContent::Text("First user message".to_string()),
                image_urls: None,
            },
            ChatMessage {
                role: Role::User,
                content: crate::types::ChatMessageContent::Text("Second user message".to_string()),
                image_urls: None,
            },
        ];

        let request = ChatCompletionRequest {
            system_prompt,
            messages,
            model: Model::OpenAIGPT4o,
        };

        let openai_messages = request.openai_messages();
        let ordered_messages = order_messages_tool_calls(openai_messages[1..].to_vec());

        assert_eq!(ordered_messages.len(), 2);

        if let ChatCompletionRequestMessage::User(user_msg) = &ordered_messages[0] {
            let content_str = match &user_msg.content {
                async_openai::types::ChatCompletionRequestUserMessageContent::Text(text) => text,
                _ => panic!("Expected text content"),
            };
            assert!(content_str.contains("First user message"));
        } else {
            panic!("Expected user message");
        }

        if let ChatCompletionRequestMessage::User(user_msg) = &ordered_messages[1] {
            let content_str = match &user_msg.content {
                async_openai::types::ChatCompletionRequestUserMessageContent::Text(text) => text,
                _ => panic!("Expected text content"),
            };
            assert!(content_str.contains("Second user message"));
        } else {
            panic!("Expected user message");
        }
    }
}
