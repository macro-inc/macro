use super::*;
use crate::openai_toolset::OpenAIToolSetExt;
use crate::tool::types::{
    AsyncToolSet, PartialToolCall, RequestContext, StreamPart, ToolCall, ToolResult,
};
use crate::tool::types::{ChatCompletionStream, ExtendedPartStream, PartOrExt, ToolResponse};
use crate::types::noop::NoOpClient;
use crate::types::openai::message::convert_message;
use crate::types::traits::{ExtendedOpenAIStream, ExtendedOpenAIStreamItem};
use crate::types::{AssistantMessagePart, ChatMessageContent, Role};
use crate::types::{ChatCompletionRequest, ChatMessage, ChatMessages};
use crate::types::{ExtendedClient, Result};
use async_openai::types::chat::{
    ChatCompletionMessageToolCall, ChatCompletionMessageToolCalls,
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestAssistantMessageContent,
    ChatCompletionRequestMessage, ChatCompletionRequestToolMessage,
    ChatCompletionRequestToolMessageContent, ChatCompletionStreamOptions,
    CreateChatCompletionRequest, FinishReason, FunctionCall,
};
use async_stream::stream;
use futures::stream::StreamExt;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

// Chat test infrastructure — used by #[cfg(test)] mod tests below.
#[cfg(test)]
#[allow(dead_code)]
struct ProcessedStream {
    pub new_messages: Vec<ChatCompletionRequestMessage>,
    pub tool_responses: Vec<ToolResponse>,
}

#[cfg(test)]
#[allow(dead_code)]
pub struct Chat<I, T>
where
    I: ExtendedClient + Send + Sync,
    T: Clone + Send + Sync + 'static,
{
    client: I,
    toolset: Arc<AsyncToolSet<T>>,
    request: CreateChatCompletionRequest,
    messages: Vec<ChatCompletionRequestMessage>,
    context: T,
    initial_message_count: usize,
    tool_call_id_name_mapping: HashMap<String, String>, // tool_call_id -> tool_name
    user_id: String,
}

#[allow(dead_code)]
impl<I, T> Chat<I, T>
where
    I: ExtendedClient + Send + Sync,
    T: Clone + Send + Sync,
{
    pub fn new(client: I, toolset: Arc<AsyncToolSet<T>>, context: T) -> Chat<I, T> {
        Chat {
            client,
            toolset,
            messages: vec![],
            context,
            request: CreateChatCompletionRequest::default(),
            initial_message_count: 0,
            tool_call_id_name_mapping: HashMap::new(),
            user_id: "Uninitialized".into(),
        }
    }

    #[tracing::instrument(skip(self, request_context), err)]
    pub async fn send_message(
        &mut self,
        request: ChatCompletionRequest,
        request_context: RequestContext,
        user_id: String,
    ) -> Result<ChatCompletionStream<'_>> {
        self.request = request.try_into()?;
        self.messages = self.request.messages.clone();
        self.initial_message_count = self.messages.len();
        self.user_id = user_id;

        self.make_chat_completion_stream(request_context).await
    }

    pub fn get_new_conversation_messages(&self) -> Vec<ChatMessage> {
        let messages: ChatMessages = self
            .messages
            .iter()
            .skip(self.initial_message_count)
            .map(|msg| convert_message(msg.clone(), Some(&self.tool_call_id_name_mapping)))
            .collect::<Vec<_>>()
            .into();
        messages.0
    }

    #[tracing::instrument(err, skip_all)]
    async fn make_chat_completion_stream(
        &mut self,
        request_context: RequestContext,
    ) -> Result<ChatCompletionStream<'_>> {
        let item_stream = stream!({
            let mut stream_parts = vec![];
            'outer: for _ in 0..MAX_RECURSIONS {
                let stream = match self.make_openai_chat_completion_stream().await {
                    Ok(stream) => stream,
                    Err(err) => {
                        yield Err(err);
                        break;
                    }
                };
                {
                    let mut stream = Self::map_stream(stream);
                    // consume stream
                    // accumulate to stream_parts
                    while let Some(item) = stream.next().await {
                        if let Err(e) = item {
                            yield Err(e);
                            break 'outer;
                        }

                        let part_or_ext = item.unwrap();
                        match part_or_ext {
                            ref part @ PartOrExt::Part(ref p) => {
                                yield Ok(p.to_owned());
                                stream_parts.push(part.to_owned());
                            }
                            ref part @ PartOrExt::Ext(ref e) => {
                                if let Some(p) = self.client.handle_extension_item(e.to_owned()) {
                                    yield Ok(p);
                                }
                                stream_parts.push(part.to_owned());
                            }
                        }
                    }
                }
                // call tools, aggregate response to a new request
                let mut processed = self
                    .process_stream_parts(stream_parts, request_context.clone())
                    .await;

                for response in &processed.tool_responses {
                    yield Ok(StreamPart::ToolResponse(response.clone()));
                }

                self.messages.append(&mut processed.new_messages);
                // if there are no tool calls, then done
                if processed.tool_responses.is_empty() {
                    break;
                }
                stream_parts = vec![];
            }
        });
        Ok(Box::pin(item_stream))
    }

    async fn process_stream_parts(
        &mut self,
        stream_parts: Vec<PartOrExt<I::ResponseExtension>>,
        request_context: RequestContext,
    ) -> ProcessedStream {
        let mut messages: Vec<ChatCompletionRequestMessage> = vec![];
        let mut tool_stream_parts: Vec<ToolResponse> = vec![];

        // Current assistant segment being built
        let mut content = String::new();
        let mut tool_calls: Vec<ChatCompletionMessageToolCalls> = vec![];
        let mut pending_tool_messages: Vec<ChatCompletionRequestMessage> = vec![];

        for item in stream_parts {
            match item {
                PartOrExt::Ext(ext) => {
                    if let Some(stream_part) = self.client.handle_extension_item(ext) {
                        match stream_part {
                            StreamPart::ToolCall(call) => {
                                self.tool_call_id_name_mapping
                                    .insert(call.id.clone(), call.name.clone());
                                tool_calls.push(ChatCompletionMessageToolCalls::Function(
                                    ChatCompletionMessageToolCall {
                                        id: call.id.clone(),
                                        function: FunctionCall {
                                            arguments: call.json.to_string(),
                                            name: call.name.clone(),
                                        },
                                    },
                                ));
                            }
                            StreamPart::Content(text) => content.push_str(text.as_str()),
                            StreamPart::ToolResponse(ToolResponse::Json { id, json, .. }) => {
                                // Server-side tool response - flush current assistant and start new segment
                                if !content.is_empty() || !tool_calls.is_empty() {
                                    messages.push(
                                        self.make_assistant_message(&mut content, &mut tool_calls),
                                    );
                                    messages.append(&mut pending_tool_messages);
                                }
                                let content_text = serde_json::to_string_pretty(&json)
                                    .unwrap_or_else(|_| "internal error parsing".into());
                                messages.push(ChatCompletionRequestMessage::Tool(
                                    ChatCompletionRequestToolMessage {
                                        content: async_openai::types::chat::ChatCompletionRequestToolMessageContent::Text(
                                            content_text,
                                        ),
                                        tool_call_id: id,
                                    },
                                ));
                            }
                            StreamPart::Usage { .. } | StreamPart::ToolResponse(_) => {}
                        }
                    }
                }
                PartOrExt::Part(part) => match part {
                    StreamPart::ToolCall(call) => {
                        self.tool_call_id_name_mapping
                            .insert(call.id.clone(), call.name.clone());
                        tool_calls.push(ChatCompletionMessageToolCalls::Function(
                            ChatCompletionMessageToolCall {
                                id: call.id.clone(),
                                function: FunctionCall {
                                    arguments: call.json.to_string(),
                                    name: call.name.clone(),
                                },
                            },
                        ));

                        let tool_response = match self
                            .toolset
                            .try_tool_call(
                                self.context.clone(),
                                request_context.clone(),
                                &call.name,
                                &call.json,
                            )
                            .await
                        {
                            Ok(ToolResult::Ok(output)) => {
                                let content_text = serde_json::to_string_pretty(&output)
                                    .unwrap_or_else(|_| {
                                        "internal error formatting response".to_string()
                                    });
                                tool_stream_parts.push(ToolResponse::Json {
                                    id: call.id.clone(),
                                    json: output,
                                    name: call.name.clone(),
                                });
                                content_text
                            }
                            Ok(ToolResult::Err(fail)) => {
                                tool_stream_parts.push(ToolResponse::Err {
                                    id: call.id.clone(),
                                    description: fail.description.clone(),
                                    name: call.name.clone(),
                                });
                                fail.description
                            }
                            Err(err) => {
                                tracing::error!(error=?err, "error calling tool");
                                let desc = format!("Error calling tool: {}", err);
                                tool_stream_parts.push(ToolResponse::Err {
                                    id: call.id.clone(),
                                    description: desc.clone(),
                                    name: call.name.clone(),
                                });
                                desc
                            }
                        };

                        pending_tool_messages.push(ChatCompletionRequestMessage::Tool(
                            ChatCompletionRequestToolMessage {
                                content: async_openai::types::chat::ChatCompletionRequestToolMessageContent::Text(
                                    tool_response,
                                ),
                                tool_call_id: call.id,
                            },
                        ));
                    }
                    StreamPart::Content(text) => content.push_str(text.as_str()),
                    StreamPart::Usage { .. } | StreamPart::ToolResponse(_) => {}
                },
            }
        }

        // Flush remaining assistant content
        messages.push(self.make_assistant_message(&mut content, &mut tool_calls));
        messages.append(&mut pending_tool_messages);

        ProcessedStream {
            new_messages: messages,
            tool_responses: tool_stream_parts,
        }
    }

    fn make_assistant_message(
        &self,
        content: &mut String,
        tool_calls: &mut Vec<ChatCompletionMessageToolCalls>,
    ) -> ChatCompletionRequestMessage {
        ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
            content: if content.is_empty() {
                None
            } else {
                Some(ChatCompletionRequestAssistantMessageContent::Text(
                    std::mem::take(content),
                ))
            },
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(std::mem::take(tool_calls))
            },
            ..Default::default()
        })
    }

    fn map_stream<'a>(
        mut stream: ExtendedOpenAIStream<I::ResponseExtension>,
    ) -> ExtendedPartStream<'a, I::ResponseExtension> {
        let stream = stream!({
            let mut tool_calls: HashMap<u32, PartialToolCall> = HashMap::new();
            while let Some(item) = stream.next().await {
                match item {
                    Ok(ExtendedOpenAIStreamItem::Response(part)) => {
                        if let Some(usage) = &part.usage {
                            yield Ok(PartOrExt::Part(StreamPart::Usage(usage.clone().into())))
                        }
                        let first = part.choices.first();
                        if first.is_none() {
                            continue;
                        }
                        let first = first.unwrap();
                        if let Some(content) = &first.delta.content {
                            yield Ok(PartOrExt::Part(StreamPart::Content(content.clone())));
                        }

                        if let Some(calls) = &first.delta.tool_calls {
                            for call in calls {
                                if let Some(function) = &call.function {
                                    tool_calls
                                        .entry(call.index)
                                        .and_modify(|partial| {
                                            if let Some(n) = &function.name {
                                                partial.name = n.to_owned();
                                            }
                                            if let Some(a) = &function.arguments.clone() {
                                                partial.json = format!("{}{}", partial.json, a);
                                            }
                                            if let Some(id) = &call.id {
                                                partial.id = id.clone();
                                            }
                                        })
                                        .or_insert_with(|| {
                                            let mut partial = PartialToolCall::default();
                                            if let Some(n) = function.name.clone() {
                                                partial.name = n;
                                            }
                                            if let Some(a) = function.arguments.clone() {
                                                partial.json = a;
                                            }
                                            if let Some(id) = &call.id {
                                                partial.id = id.clone();
                                            }
                                            partial
                                        });
                                }
                            }
                        }
                        if let Some(FinishReason::ToolCalls) = first.finish_reason {
                            for call in tool_calls.into_values() {
                                match ToolCall::try_from(call.clone()) {
                                    Ok(call) => {
                                        yield Ok(PartOrExt::Part(StreamPart::ToolCall(call)))
                                    }
                                    Err(e) => {
                                        tracing::error!(
                                            err=?e,
                                            "ToolCall::try_from failed from {:#?}",
                                            call
                                        );
                                    }
                                }
                            }
                            tool_calls = HashMap::new();
                        }
                    }
                    Ok(ExtendedOpenAIStreamItem::Extension(ext)) => {
                        // Handle provider-specific extension items (Anthropic server tools)
                        yield Ok(PartOrExt::Ext(ext));
                    }
                    Err(error) => yield Err(error.into()),
                }
            }
        });
        Box::pin(stream)
    }

    #[tracing::instrument(err, skip(self))]
    async fn make_openai_chat_completion_stream(
        &mut self,
    ) -> Result<ExtendedOpenAIStream<I::ResponseExtension>> {
        self.request.messages = self.messages.clone();
        self.request.tools = Some(self.toolset.openai_chatcompletion_toolset());
        self.request.stream = Some(true);
        self.request.stream_options = Some(ChatCompletionStreamOptions {
            include_usage: Some(true),
            include_obfuscation: None,
        });

        self.client.chat_stream(self.request.clone()).await
    }
}

fn create_mock_chat() -> Chat<NoOpClient, String> {
    let client = NoOpClient;
    let toolset = Arc::new(AsyncToolSet::new());
    Chat::new(client, toolset, "test_context".to_string())
}

#[test]
fn test_get_new_conversation_messages_empty() {
    let chat = create_mock_chat();
    let messages = chat.get_new_conversation_messages();
    assert!(messages.is_empty());
}

#[test]
fn test_get_new_conversation_messages_skips_initial() {
    let mut chat = create_mock_chat();

    // Add some initial messages
    chat.messages = vec![
        ChatCompletionRequestMessage::System(
            async_openai::types::chat::ChatCompletionRequestSystemMessage {
                content: async_openai::types::chat::ChatCompletionRequestSystemMessageContent::Text(
                    "System message".to_string(),
                ),
                ..Default::default()
            },
        ),
        ChatCompletionRequestMessage::User(
            async_openai::types::chat::ChatCompletionRequestUserMessage {
                content: async_openai::types::chat::ChatCompletionRequestUserMessageContent::Text(
                    "User message".to_string(),
                ),
                ..Default::default()
            },
        ),
    ];
    chat.initial_message_count = 2;

    // Add new messages
    chat.messages.push(ChatCompletionRequestMessage::Assistant(
        ChatCompletionRequestAssistantMessage {
            content: Some(ChatCompletionRequestAssistantMessageContent::Text(
                "New assistant response".to_string(),
            )),
            ..Default::default()
        },
    ));

    let new_messages = chat.get_new_conversation_messages();

    assert_eq!(new_messages.len(), 1);
    assert_eq!(new_messages[0].role, Role::Assistant);
    if let ChatMessageContent::Text(text) = &new_messages[0].content {
        assert_eq!(text, "New assistant response");
    } else {
        panic!("Expected text content");
    }
}

#[test]
fn test_get_new_conversation_messages_with_tool_calls() {
    let mut chat = create_mock_chat();
    chat.initial_message_count = 0;

    let tool_call_id = "call_123".to_string();
    let tool_name = "test_tool".to_string();

    // Add tool call mapping
    chat.tool_call_id_name_mapping
        .insert(tool_call_id.clone(), tool_name.clone());

    // Add messages with tool calls
    chat.messages = vec![
        ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
            content: Some(ChatCompletionRequestAssistantMessageContent::Text(
                "I'll help you with that.".to_string(),
            )),
            tool_calls: Some(vec![ChatCompletionMessageToolCalls::Function(
                ChatCompletionMessageToolCall {
                    id: tool_call_id.clone(),
                    function: FunctionCall {
                        name: tool_name.clone(),
                        arguments: json!({"param": "value"}).to_string(),
                    },
                },
            )]),
            ..Default::default()
        }),
        ChatCompletionRequestMessage::Tool(ChatCompletionRequestToolMessage {
            tool_call_id: tool_call_id.clone(),
            content: ChatCompletionRequestToolMessageContent::Text(
                json!({"result": "success"}).to_string(),
            ),
        }),
    ];

    let new_messages = chat.get_new_conversation_messages();

    // The ChatMessages conversion merges adjacent assistant messages into one
    assert_eq!(new_messages.len(), 1);

    // The message should be assistant with merged parts (text + tool call + tool response)
    assert_eq!(new_messages[0].role, Role::Assistant);
    if let ChatMessageContent::AssistantMessageParts(parts) = &new_messages[0].content {
        assert_eq!(parts.len(), 3);

        // Should have text part
        if let AssistantMessagePart::Text { text } = &parts[0] {
            assert_eq!(text, "I'll help you with that.");
        } else {
            panic!("Expected text part at index 0");
        }

        // Should have tool call part with correct name from mapping
        if let AssistantMessagePart::ToolCall { name, id, json } = &parts[1] {
            assert_eq!(name, &tool_name);
            assert_eq!(id, &tool_call_id);
            assert_eq!(json["param"], "value");
        } else {
            panic!("Expected tool call part at index 1");
        }

        // Should have tool response part
        if let AssistantMessagePart::ToolCallResponseJson { name, id, json } = &parts[2] {
            assert_eq!(name, &tool_name);
            assert_eq!(id, &tool_call_id);
            assert_eq!(json["result"], "success");
        } else {
            panic!("Expected tool response part at index 2");
        }
    } else {
        panic!("Expected assistant message parts");
    }
}

#[test]
fn test_get_new_conversation_messages_preserves_tool_mapping() {
    let mut chat = create_mock_chat();
    chat.initial_message_count = 0;

    let tool_call_id = "call_456".to_string();
    let tool_name = "search_documents".to_string();

    // Add tool call mapping
    chat.tool_call_id_name_mapping
        .insert(tool_call_id.clone(), tool_name.clone());

    // Add tool response message
    chat.messages = vec![ChatCompletionRequestMessage::Tool(
        ChatCompletionRequestToolMessage {
            tool_call_id: tool_call_id.clone(),
            content: ChatCompletionRequestToolMessageContent::Text(
                json!({"documents": ["doc1", "doc2"]}).to_string(),
            ),
        },
    )];

    let new_messages = chat.get_new_conversation_messages();

    assert_eq!(new_messages.len(), 1);
    assert_eq!(new_messages[0].role, Role::Assistant);

    if let ChatMessageContent::AssistantMessageParts(parts) = &new_messages[0].content {
        assert_eq!(parts.len(), 1);

        if let AssistantMessagePart::ToolCallResponseJson { name, id, json } = &parts[0] {
            assert_eq!(name, &tool_name); // Verify tool name is preserved from mapping
            assert_eq!(id, &tool_call_id);
            assert_eq!(json["documents"][0], "doc1");
            assert_eq!(json["documents"][1], "doc2");
        } else {
            panic!("Expected tool response part");
        }
    } else {
        panic!("Expected assistant message parts");
    }
}

#[test]
fn test_get_new_conversation_messages_with_error_response() {
    let mut chat = create_mock_chat();
    chat.initial_message_count = 0;

    let tool_call_id = "call_error".to_string();
    let tool_name = "failing_tool".to_string();

    // Add tool call mapping
    chat.tool_call_id_name_mapping
        .insert(tool_call_id.clone(), tool_name.clone());

    // Add tool error response message
    chat.messages = vec![ChatCompletionRequestMessage::Tool(
        ChatCompletionRequestToolMessage {
            tool_call_id: tool_call_id.clone(),
            content: ChatCompletionRequestToolMessageContent::Text("Tool execution failed".into()),
        },
    )];

    let new_messages = chat.get_new_conversation_messages();

    assert_eq!(new_messages.len(), 1);
    assert_eq!(new_messages[0].role, Role::Assistant);

    if let ChatMessageContent::AssistantMessageParts(parts) = &new_messages[0].content {
        assert_eq!(parts.len(), 1);

        if let AssistantMessagePart::ToolCallErr {
            name,
            id,
            description,
        } = &parts[0]
        {
            assert_eq!(name, &tool_name);
            assert_eq!(id, &tool_call_id);
            assert_eq!(description, "Tool execution failed");
        } else {
            eprintln!("{:#?}", parts[0]);
            panic!("Expected tool error part");
        }
    } else {
        panic!("Expected assistant message parts");
    }
}
