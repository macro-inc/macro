use crate::types::openai::message::order_messages_tool_calls;
use crate::types::{ChatCompletionRequest, response::ChatStreamCompletionResponse};
use anyhow::Context;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestMessageContentPartText,
    ChatCompletionRequestSystemMessage, ChatCompletionRequestSystemMessageContent,
    ChatCompletionRequestSystemMessageContentPart, CreateChatCompletionRequest,
    CreateChatCompletionRequestArgs, CreateChatCompletionStreamResponse,
    FinishReason as OpenAIFinishReason, ReasoningEffort,
};

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
