use crate::client::chat::MessageCompletionResponseStream;
use crate::error::AnthropicError;
use crate::types::response::StopReason;
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

                        Ok(CreateChatCompletionStreamResponse {
                            id: message_id.clone().unwrap_or_default(),
                            choices: vec![ChatChoiceStream {
                                index: 0,
                                delta: ChatCompletionStreamResponseDelta {
                                    role: Some(Role::Assistant),
                                    content: None,
                                    tool_calls: None,
                                    #[allow(deprecated)]
                                    function_call: None,
                                    refusal: None,
                                },
                                finish_reason: None,
                                logprobs: None,
                            }],
                            created: created as u32,
                            model: model.clone().unwrap_or_default(),
                            system_fingerprint: None,
                            object: "chat.completion.chunk".to_string(),
                            service_tier: None,
                            usage: None,
                        })
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
                                Ok(CreateChatCompletionStreamResponse {
                                    id: message_id.clone().unwrap_or_default(),
                                    choices: vec![ChatChoiceStream {
                                        index,
                                        delta: ChatCompletionStreamResponseDelta {
                                            role: None,
                                            content: Some(text),
                                            tool_calls: None,
                                            #[allow(deprecated)]
                                            function_call: None,
                                            refusal: None,
                                        },
                                        finish_reason: None,
                                        logprobs: None,
                                    }],
                                    created: created as u32,
                                    model: model.clone().unwrap_or_default(),
                                    system_fingerprint: None,
                                    object: "chat.completion.chunk".to_string(),
                                    service_tier: None,
                                    usage: None,
                                })
                            }
                            ContentDeltaEvent::ThinkingDelta { thinking } => {
                                // OpenAI doesn't have thinking blocks, skip or include as content
                                Ok(CreateChatCompletionStreamResponse {
                                    id: message_id.clone().unwrap_or_default(),
                                    choices: vec![ChatChoiceStream {
                                        index,
                                        delta: ChatCompletionStreamResponseDelta {
                                            role: None,
                                            content: Some(format!("[Thinking] {}", thinking)),
                                            tool_calls: None,
                                            #[allow(deprecated)]
                                            function_call: None,
                                            refusal: None,
                                        },
                                        finish_reason: None,
                                        logprobs: None,
                                    }],
                                    created: created as u32,
                                    model: model.clone().unwrap_or_default(),
                                    system_fingerprint: None,
                                    object: "chat.completion.chunk".to_string(),
                                    service_tier: None,
                                    usage: None,
                                })
                            }
                            ContentDeltaEvent::ToolUse { id, name, input } => {
                                // Map to OpenAI tool call
                                Ok(CreateChatCompletionStreamResponse {
                                    id: message_id.clone().unwrap_or_default(),
                                    choices: vec![ChatChoiceStream {
                                        index,
                                        delta: ChatCompletionStreamResponseDelta {
                                            role: None,
                                            content: None,
                                            tool_calls: Some(vec![ChatCompletionMessageToolCallChunk {
                                                index,
                                                id: Some(id),
                                                r#type: Some(ChatCompletionToolType::Function),
                                                function: Some(FunctionCallStream {
                                                    name: Some(name),
                                                    arguments: Some(input.to_string()),
                                                }),
                                            }]),
                                            #[allow(deprecated)]
                                            function_call: None,
                                            refusal: None,
                                        },
                                        finish_reason: None,
                                        logprobs: None,
                                    }],
                                    created: created as u32,
                                    model: model.clone().unwrap_or_default(),
                                    system_fingerprint: None,
                                    object: "chat.completion.chunk".to_string(),
                                    service_tier: None,
                                    usage: None,
                                })
                            }
                            ContentDeltaEvent::InputJsonDelta { partial_json } => {
                                // Stream partial JSON for tool call arguments
                                Ok(CreateChatCompletionStreamResponse {
                                    id: message_id.clone().unwrap_or_default(),
                                    choices: vec![ChatChoiceStream {
                                        index,
                                        delta: ChatCompletionStreamResponseDelta {
                                            role: None,
                                            content: None,
                                            tool_calls: Some(vec![ChatCompletionMessageToolCallChunk {
                                                index,
                                                id: Some(streaming_tool_id.clone()),
                                                r#type: None,
                                                function: Some(FunctionCallStream {
                                                    name: Some(streaming_tool_name.clone()),
                                                    arguments: Some(partial_json),
                                                }),
                                            }]),
                                            #[allow(deprecated)]
                                            function_call: None,
                                            refusal: None,
                                        },
                                        finish_reason: None,
                                        logprobs: None,
                                    }],
                                    created: created as u32,
                                    model: model.clone().unwrap_or_default(),
                                    system_fingerprint: None,
                                    object: "chat.completion.chunk".to_string(),
                                    service_tier: None,
                                    usage: None,
                                })
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
                    StreamEvent::MessageDelta { delta } => {
                        let finish_reason = delta.stop_reason.map(|sr| match sr {
                            StopReason::EndTurn => FinishReason::Stop,
                            StopReason::MaxTokens => FinishReason::Length,
                            StopReason::StopSequence => FinishReason::Stop,
                            StopReason::ToolUse => FinishReason::ToolCalls,
                            StopReason::PausTurn => FinishReason::Stop,
                            StopReason::Refusal => FinishReason::ContentFilter,
                        });

                        Ok(CreateChatCompletionStreamResponse {
                            id: message_id.clone().unwrap_or_default(),
                            choices: vec![ChatChoiceStream {
                                index: 0,
                                delta: ChatCompletionStreamResponseDelta {
                                    role: None,
                                    content: None,
                                    tool_calls: None,
                                    #[allow(deprecated)]
                                    function_call: None,
                                    refusal: None,
                                },
                                finish_reason,
                                logprobs: None,
                            }],
                            created: created as u32,
                            model: model.clone().unwrap_or_default(),
                            system_fingerprint: None,
                            object: "chat.completion.chunk".to_string(),
                            service_tier: None,
                            usage: None,
                        })
                    }
                    StreamEvent::MessageStop => {
                        Ok(CreateChatCompletionStreamResponse {
                            id: message_id.clone().unwrap_or_default(),
                            choices: vec![ChatChoiceStream {
                                index: 0,
                                delta: ChatCompletionStreamResponseDelta {
                                    role: None,
                                    content: None,
                                    tool_calls: None,
                                    #[allow(deprecated)]
                                    function_call: None,
                                    refusal: None,
                                },
                                finish_reason: Some(FinishReason::Stop),
                                logprobs: None,
                            }],
                            created: created as u32,
                            model: model.clone().unwrap_or_default(),
                            system_fingerprint: None,
                            object: "chat.completion.chunk".to_string(),
                            service_tier: None,
                            usage: None,
                        })
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
