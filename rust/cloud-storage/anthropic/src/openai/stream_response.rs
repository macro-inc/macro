use crate::client::chat::MessageCompletionResponseStream;
use crate::error::AnthropicError;
use crate::types::response::StopReason;
use crate::types::response::Usage;
use crate::types::stream_response::{ContentDeltaEvent, StreamEvent};
use crate::{client::chat::Chat, prelude::CreateMessageRequestBody};
use async_openai::error::{ApiError, OpenAIError};
use async_openai::types::{
    ChatChoiceStream, ChatCompletionMessageToolCallChunk, ChatCompletionResponseStream,
    ChatCompletionStreamResponseDelta, ChatCompletionToolType, CreateChatCompletionStreamResponse,
    FinishReason, FunctionCallStream, Role,
};
use async_stream::stream;
use futures::StreamExt;
use serde::Serialize;

// Helper functions to create stream responses
fn create_response(
    message_id: &str,
    model: &str,
    created: u32,
    index: u32,
    delta: ChatCompletionStreamResponseDelta,
    finish_reason: Option<FinishReason>,
    usage: Option<async_openai::types::CompletionUsage>,
) -> CreateChatCompletionStreamResponse {
    CreateChatCompletionStreamResponse {
        id: message_id.to_string(),
        choices: vec![ChatChoiceStream {
            index,
            delta,
            finish_reason,
            logprobs: None,
        }],
        created,
        model: model.to_string(),
        system_fingerprint: None,
        object: "chat.completion.chunk".to_string(),
        service_tier: None,
        usage,
    }
}

fn create_role_delta(role: Role) -> ChatCompletionStreamResponseDelta {
    ChatCompletionStreamResponseDelta {
        role: Some(role),
        content: None,
        tool_calls: None,
        #[allow(deprecated)]
        function_call: None,
        refusal: None,
    }
}

fn create_content_delta(content: String) -> ChatCompletionStreamResponseDelta {
    ChatCompletionStreamResponseDelta {
        role: None,
        content: Some(content),
        tool_calls: None,
        #[allow(deprecated)]
        function_call: None,
        refusal: None,
    }
}

fn create_tool_call_delta(
    index: u32,
    id: Option<String>,
    type_: Option<ChatCompletionToolType>,
    name: Option<String>,
    arguments: Option<String>,
) -> ChatCompletionStreamResponseDelta {
    ChatCompletionStreamResponseDelta {
        role: None,
        content: None,
        tool_calls: Some(vec![ChatCompletionMessageToolCallChunk {
            index,
            id,
            r#type: type_,
            function: Some(FunctionCallStream { name, arguments }),
        }]),
        #[allow(deprecated)]
        function_call: None,
        refusal: None,
    }
}

fn create_empty_delta() -> ChatCompletionStreamResponseDelta {
    ChatCompletionStreamResponseDelta {
        role: None,
        content: None,
        tool_calls: None,
        #[allow(deprecated)]
        function_call: None,
        refusal: None,
    }
}

fn map_stop_reason(stop_reason: StopReason) -> FinishReason {
    match stop_reason {
        StopReason::EndTurn => FinishReason::Stop,
        StopReason::MaxTokens => FinishReason::Length,
        StopReason::StopSequence => FinishReason::Stop,
        StopReason::ToolUse => FinishReason::ToolCalls,
        StopReason::PausTurn => FinishReason::Stop,
        StopReason::Refusal => FinishReason::ContentFilter,
    }
}

pub fn map_stream(mut stream: MessageCompletionResponseStream) -> ChatCompletionResponseStream {
    Box::pin(stream! {
        let mut message_id: Option<String> = None;
        let mut model: Option<String> = None;
        let created = chrono::Utc::now().timestamp();
        let mut streaming_tool_name = String::new();
        let mut streaming_tool_id = String::new();

        while let Some(part) = stream.next().await {
            let result = if let Err(e) = part {
                Err(match e {
                    AnthropicError::JsonDeserialize(e) => OpenAIError::JSONDeserialize(e),
                    AnthropicError::Reqwest(e) => OpenAIError::Reqwest(e),
                    AnthropicError::StreamError(e) => OpenAIError::StreamError(e),
                })
            } else {
                match part.unwrap() {
                    StreamEvent::MessageStart { message } => {
                        message_id = message.id.clone();
                        model = message.model.clone();

                        Ok(create_response(
                            &message_id.clone().unwrap_or_default(),
                            &model.clone().unwrap_or_default(),
                            created as u32,
                            0,
                            create_role_delta(Role::Assistant),
                            None,
                            None,
                        ))
                    }
                    StreamEvent::ContentBlockStart { content_block, ..} => {
                        if let ContentDeltaEvent::ToolUse { name, id, .. } = content_block {
                            streaming_tool_name = name;
                            streaming_tool_id = id;
                        }
                        // Skip content block start events
                        continue;
                    }
                    StreamEvent::ContentBlockDelta { index, delta } => {
                        match delta {
                            ContentDeltaEvent::TextDelta { text } | ContentDeltaEvent::StartTextDelta { text } => {
                                Ok(create_response(
                                    &message_id.clone().unwrap_or_default(),
                                    &model.clone().unwrap_or_default(),
                                    created as u32,
                                    index,
                                    create_content_delta(text),
                                    None,
                                    None,
                                ))
                            }
                            ContentDeltaEvent::ThinkingDelta { thinking } => {
                                // OpenAI doesn't have thinking blocks, skip or include as content
                                Ok(create_response(
                                    &message_id.clone().unwrap_or_default(),
                                    &model.clone().unwrap_or_default(),
                                    created as u32,
                                    index,
                                    create_content_delta(format!("[Thinking] {}", thinking)),
                                    None,
                                    None,
                                ))
                            }
                            ContentDeltaEvent::ToolUse { id, name, input } => {
                                // Map to OpenAI tool call
                                Ok(create_response(
                                    &message_id.clone().unwrap_or_default(),
                                    &model.clone().unwrap_or_default(),
                                    created as u32,
                                    index,
                                    create_tool_call_delta(
                                        index,
                                        Some(id),
                                        Some(ChatCompletionToolType::Function),
                                        Some(name),
                                        Some(input.to_string()),
                                    ),
                                    None,
                                    None,
                                ))
                            }
                            ContentDeltaEvent::InputJsonDelta { partial_json } => {
                                // Stream partial JSON for tool call arguments
                                Ok(create_response(
                                    &message_id.clone().unwrap_or_default(),
                                    &model.clone().unwrap_or_default(),
                                    created as u32,
                                    index,
                                    create_tool_call_delta(
                                        index,
                                        Some(streaming_tool_id.clone()),
                                        None,
                                        Some(streaming_tool_name.clone()),
                                        Some(partial_json),
                                    ),
                                    None,
                                    None,
                                ))
                            }
                            ContentDeltaEvent::SignatureDelta { .. } => {
                                // Skip signature deltas as OpenAI doesn't have an equivalent
                                continue;
                            }
                        }
                    }
                    StreamEvent::ContentBlockStop { .. } => {
                        // Skip content block stop events
                        continue;
                    }
                    StreamEvent::MessageDelta { delta , usage } => {
                        let finish_reason = delta.stop_reason.map(map_stop_reason);

                        Ok(create_response(
                            &message_id.clone().unwrap_or_default(),
                            &model.clone().unwrap_or_default(),
                            created as u32,
                            0,
                            create_empty_delta(),
                            finish_reason,
                            usage.map(Into::into),
                        ))
                    }
                    StreamEvent::MessageStop => {
                        Ok(create_response(
                            &message_id.clone().unwrap_or_default(),
                            &model.clone().unwrap_or_default(),
                            created as u32,
                            0,
                            create_empty_delta(),
                            Some(FinishReason::Stop),
                            None,
                        ))
                    }
                    StreamEvent::Ping => {
                        // Skip ping events
                        continue;
                    }
                    StreamEvent::Error { error } => {
                        Err(OpenAIError::ApiError(ApiError {
                            message: format!("{:?}", error),
                            r#type: None,
                            param: None,
                            code: None,
                        }))
                    }
                }
            };
            yield result;
        }
    })
}

impl From<Usage> for async_openai::types::CompletionUsage {
    fn from(value: Usage) -> async_openai::types::CompletionUsage {
        Self {
            prompt_tokens: value.input_tokens,
            completion_tokens: value.output_tokens,
            total_tokens: value.input_tokens + value.output_tokens,
            prompt_tokens_details: None,
            completion_tokens_details: None,
        }
    }
}

impl<'c> Chat<'c> {
    pub async fn create_stream_openai<I>(&self, request: I) -> ChatCompletionResponseStream
    where
        I: Into<CreateMessageRequestBody>,
    {
        let mut request = request.into();
        request.stream = Some(true);
        self.create_stream_openai_unchecked(request).await
    }

    pub async fn create_stream_openai_unchecked<I>(
        &self,
        request: I,
    ) -> ChatCompletionResponseStream
    where
        I: Serialize,
    {
        map_stream(self.inner.post_stream("/v1/messages", request).await)
    }
}
