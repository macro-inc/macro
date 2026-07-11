use super::request::AnthropicRequestExtensions;
use super::stream_extension::{ExtendedAnthropicStreamItem, ExtendedStream};
use crate::client::chat::MessageCompletionResponseStream;
use crate::error::AnthropicError;
use crate::openai::stream_extension::AnthropicResponseExtension;
use crate::prelude::{ServerToolUse, transform_request_web_fetch};
use crate::types::response::{ContentDeltaEvent, StopReason, StreamEvent, Usage};
use crate::{client::chat::Chat, prelude::CreateMessageRequestBody};
use async_openai::error::{ApiError, OpenAIError};
use async_openai::types::chat::{
    ChatChoiceStream, ChatCompletionMessageToolCallChunk, ChatCompletionResponseStream,
    ChatCompletionStreamResponseDelta, CreateChatCompletionStreamResponse, FinishReason,
    FunctionCallStream, FunctionType, Role,
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
    usage: Option<async_openai::types::chat::CompletionUsage>,
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
        #[allow(deprecated)]
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
    type_: Option<FunctionType>,
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

struct PartialTool {
    pub name: String,
    pub id: String,
    pub input: String,
}

impl TryFrom<PartialTool> for ServerToolUse {
    type Error = OpenAIError;
    fn try_from(value: PartialTool) -> Result<Self, Self::Error> {
        let any = serde_json::from_str::<serde_json::Value>(&value.input)
            .map_err(|e| OpenAIError::JSONDeserialize(e, String::new()))?;
        Ok(Self {
            id: value.id,
            name: value.name,
            input: any,
        })
    }
}

impl From<ServerToolUse> for PartialTool {
    fn from(value: ServerToolUse) -> Self {
        Self {
            id: value.id,
            name: value.name,
            input: "".into(),
        }
    }
}

enum ToolState {
    Streaming,
    StreamingTool { name: String, id: String },
    StreamingServerTool(PartialTool),
}

fn map_stream_extended(mut stream: MessageCompletionResponseStream) -> ExtendedStream {
    Box::pin(stream! {
        let mut message_id: Option<String> = None;
        let mut model: Option<String> = None;
        let created = chrono::Utc::now().timestamp();
        let mut tool_state = ToolState::Streaming;

        while let Some(part) = stream.next().await {
            if let Err(e) = part {
                yield Err(match e {
                    AnthropicError::JsonDeserialize(e) => OpenAIError::JSONDeserialize(e, String::new()),
                    AnthropicError::Reqwest(e) => OpenAIError::StreamError(Box::new(async_openai::error::StreamError::EventStream(e.to_string()))),
                    AnthropicError::StreamError(e) => OpenAIError::StreamError(Box::new(async_openai::error::StreamError::EventStream(e))),
                    AnthropicError::ApiError { status_code, api_error } =>  {
                        OpenAIError::ApiError(ApiError {
                            message: api_error.error.message,
                            r#type: Some(api_error.r#type),
                            param: None,
                            code: Some(status_code.to_string())
                        })
                    }
                })
            } else {
                match part.unwrap() {
                    StreamEvent::MessageStart { message } => {
                        message_id = message.id.clone();
                        model = message.model.clone();
                        yield Ok(create_response(
                            &message_id.clone().unwrap_or_default(),
                            &model.clone().unwrap_or_default(),
                            created as u32,
                            0,
                            create_role_delta(Role::Assistant),
                            None,
                            None,
                        ).into());
                    }
                    StreamEvent::ContentBlockStart { content_block, index } => {
                        match content_block {
                            ContentDeltaEvent::ToolUse { name, id, .. } => {
                                yield Ok(create_response(
                                        &message_id.clone().unwrap_or_default(),
                                        &model.clone().unwrap_or_default(),
                                        created as u32,
                                        index,
                                        create_tool_call_delta(
                                            index,
                                            Some(id.clone()),
                                            Some(FunctionType::Function),
                                            Some(name.clone()),
                                            Some(String::new()),
                                        ),
                                        None,
                                        None,
                                        ).into());
                                tool_state = ToolState::StreamingTool { name, id };
                            }
                            ContentDeltaEvent::ServerToolUse(server_tool) => {
                                tool_state = ToolState::StreamingServerTool(server_tool.into())
                            }
                            ContentDeltaEvent::WebSearchToolResult(web_search_response) => {
                                yield Ok(AnthropicResponseExtension::WebSearchToolResponse(web_search_response).into());
                            }
                            ContentDeltaEvent::WebFetchToolResult(web_fetch_response) => {
                                yield Ok(AnthropicResponseExtension::WebFetchToolResponse(web_fetch_response).into());
                            }
                            ContentDeltaEvent::BashCodeExecutionToolResult(bash_response) => {
                                yield Ok(AnthropicResponseExtension::BashCodeExecutionToolResponse(bash_response).into());
                            }
                            ContentDeltaEvent::TextEditorCodeExecutionToolResult(text_editor_response) => {
                                yield Ok(AnthropicResponseExtension::TextEditorCodeExecutionToolResponse(text_editor_response).into());
                            }
                            _ => {}
                        }
                        // Skip content block start events
                        continue;
                    }
                    StreamEvent::ContentBlockDelta { index, delta } => {
                        match delta {
                            ContentDeltaEvent::CitationsDelta { citation } => {
                                yield Ok(
                                    AnthropicResponseExtension::Citation(citation).into()
                                );
                            }
                            ContentDeltaEvent::WebSearchToolResult(web_search_response) => {
                                yield Ok(AnthropicResponseExtension::WebSearchToolResponse(web_search_response).into());
                            }
                            ContentDeltaEvent::WebFetchToolResult(web_fetch_response) => {
                                yield Ok(AnthropicResponseExtension::WebFetchToolResponse(web_fetch_response).into());
                            }
                            ContentDeltaEvent::BashCodeExecutionToolResult(bash_response) => {
                                yield Ok(AnthropicResponseExtension::BashCodeExecutionToolResponse(bash_response).into());
                            }
                            ContentDeltaEvent::TextEditorCodeExecutionToolResult(text_editor_response) => {
                                yield Ok(AnthropicResponseExtension::TextEditorCodeExecutionToolResponse(text_editor_response).into());
                            }
                            ContentDeltaEvent::TextDelta { text } | ContentDeltaEvent::StartTextDelta { text } => {
                                yield Ok(create_response(
                                    &message_id.clone().unwrap_or_default(),
                                    &model.clone().unwrap_or_default(),
                                    created as u32,
                                    index,
                                    create_content_delta(text),
                                    None,
                                    None,
                                ).into());
                            }
                            ContentDeltaEvent::ThinkingDelta { thinking } => {
                                // OpenAI doesn't have thinking blocks, skip or include as content
                                yield Ok(create_response(
                                    &message_id.clone().unwrap_or_default(),
                                    &model.clone().unwrap_or_default(),
                                    created as u32,
                                    index,
                                    create_content_delta(format!("[Thinking] {}", thinking)),
                                    None,
                                    None,
                                ).into());
                            }
                            ContentDeltaEvent::InputJsonDelta { partial_json } => {
                                match &mut tool_state {
                                    ToolState::Streaming => {},
                                    ToolState::StreamingTool {name, id} => {
                                        yield Ok(create_response(
                                            &message_id.clone().unwrap_or_default(),
                                            &model.clone().unwrap_or_default(),
                                            created as u32,
                                            index,
                                            create_tool_call_delta(
                                                index,
                                                Some(id.clone()),
                                                None,
                                                Some(name.clone()),
                                                Some(partial_json),
                                            ),
                                            None,
                                            None,
                                        ).into());
                                    }
                                    ToolState::StreamingServerTool(server_tool) => {
                                        server_tool.input.push_str(partial_json.as_str());
                                    }
                                }
                            }
                            // signature events are uneeded + unsupported
                            ContentDeltaEvent::SignatureDelta{..}
                            // server tool deltas are emitted in content block start events
                            | ContentDeltaEvent::ServerToolUse(_)
                            // tool use deltas are emitted in content block start events
                            | ContentDeltaEvent::ToolUse { .. }
                            => {
                                continue;
                            }
                        }
                    }
                    StreamEvent::ContentBlockStop { .. } => {
                            if let ToolState::StreamingServerTool(partial_tool) = tool_state {
                                yield ServerToolUse::try_from(partial_tool)
                                    .map(|tool| {
                                        AnthropicResponseExtension::ServerToolUse(tool).into()
                                    });
                            }
                        tool_state = ToolState::Streaming;
                        continue;
                    }
                    StreamEvent::MessageDelta { delta , usage } => {
                        let finish_reason = delta.stop_reason.map(map_stop_reason);

                        yield Ok(create_response(
                            &message_id.clone().unwrap_or_default(),
                            &model.clone().unwrap_or_default(),
                            created as u32,
                            0,
                            create_empty_delta(),
                            finish_reason,
                            usage.map(Into::into),
                        ).into());
                    }
                    StreamEvent::MessageStop => {
                        yield Ok(create_response(
                            &message_id.clone().unwrap_or_default(),
                            &model.clone().unwrap_or_default(),
                            created as u32,
                            0,
                            create_empty_delta(),
                            Some(FinishReason::Stop),
                            None,
                        ).into());
                    }
                    StreamEvent::Ping => {
                        // Skip ping events
                        continue;
                    }
                    StreamEvent::Error { error } => {
                        yield Err(OpenAIError::ApiError(ApiError {
                            message: format!("{:?}", error),
                            r#type: None,
                            param: None,
                            code: None,
                        }));
                    }
                }
            };
        }
    })
}

/// Discard items that are unsupported by openai
fn map_stream_lossy(stream: MessageCompletionResponseStream) -> ChatCompletionResponseStream {
    Box::pin(map_stream_extended(stream).filter_map(|item| async move {
        match item {
            Err(e) => Some(Err(e)),
            Ok(ExtendedAnthropicStreamItem::OpenAI(item)) => Some(Ok(item)),
            Ok(_) => None,
        }
    }))
}

impl From<Usage> for async_openai::types::chat::CompletionUsage {
    fn from(value: Usage) -> async_openai::types::chat::CompletionUsage {
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
    /// create an openai/completions/v1 compatible stream discarding events that are unsupported
    pub async fn create_stream_openai_lossy<I>(&self, request: I) -> ChatCompletionResponseStream
    where
        I: Into<CreateMessageRequestBody>,
    {
        let mut request = request.into();
        request.stream = Some(true);
        let request = transform_request_web_fetch(request);
        self.create_stream_openai_unchecked(request).await
    }

    /// create an openai/completion/v1 compatible stream wrapping items in [`ExtendedAnthropicStreamItem`]
    pub async fn create_stream_openai_extended<I>(
        &self,
        request: I,
        extensions: &AnthropicRequestExtensions,
    ) -> ExtendedStream
    where
        I: Into<CreateMessageRequestBody>,
    {
        let mut request = request.into();
        request.stream = Some(true);
        let request = extensions.extend_request(request);
        let request = transform_request_web_fetch(request);
        self.create_stream_extended_unchecked(request).await
    }

    pub(crate) async fn create_stream_extended_unchecked<I>(&self, request: I) -> ExtendedStream
    where
        I: Serialize + std::fmt::Debug,
    {
        map_stream_extended(self.inner.post_stream("/v1/messages", request).await)
    }

    pub(crate) async fn create_stream_openai_unchecked<I>(
        &self,
        request: I,
    ) -> ChatCompletionResponseStream
    where
        I: Serialize + std::fmt::Debug,
    {
        map_stream_lossy(self.inner.post_stream("/v1/messages", request).await)
    }
}
