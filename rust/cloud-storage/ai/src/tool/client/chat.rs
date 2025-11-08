use super::constant::MAX_RECURSIONS;
use crate::tool::types::{AsyncToolSet, PartialToolCall, StreamPart, ToolCall, ToolResult};
use crate::tool::types::{ChatCompletionStream, ToolResponse};

use crate::types::openai::message::convert_message;
use crate::types::{ChatCompletionRequest, ChatMessage, ChatMessages};
use anyhow::{Context, Result};
use async_openai::Client;
use async_openai::config::Config;
use async_openai::types::{
    ChatCompletionMessageToolCall, ChatCompletionRequestAssistantMessage,
    ChatCompletionRequestAssistantMessageContent, ChatCompletionRequestMessage,
    ChatCompletionRequestToolMessage, ChatCompletionResponseStream, ChatCompletionStreamOptions,
    CreateChatCompletionRequest, FinishReason, FunctionCall,
};
use async_stream::stream;
use futures::stream::StreamExt;
use std::collections::HashMap;
use std::ops::Deref;
use std::sync::Arc;

struct ProcessedStream {
    pub new_messages: Vec<ChatCompletionRequestMessage>,
    pub tool_responses: Vec<ToolResponse>,
}

pub struct Chat<C, T, I, R>
where
    C: Config + Send + Sync,
    T: Clone + Send + Sync + 'static,
    I: Deref<Target = Client<C>> + Send + Sync,
    R: Send + Sync + 'static,
{
    inner: I,
    toolset: Arc<AsyncToolSet<T, R>>,
    request: CreateChatCompletionRequest,
    messages: Vec<ChatCompletionRequestMessage>,
    context: T,
    initial_message_count: usize,
    tool_call_id_name_mapping: HashMap<String, String>, // tool_call_id -> tool_name
    user_id: String,
}

impl<C, T, I, R> Chat<C, T, I, R>
where
    C: Config + Send + Sync,
    T: Clone + Send + Sync,
    I: Deref<Target = Client<C>> + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn new(client: I, toolset: Arc<AsyncToolSet<T, R>>, context: T) -> Chat<C, T, I, R> {
        Chat {
            inner: client,
            toolset,
            messages: vec![],
            context,
            request: CreateChatCompletionRequest::default(),
            initial_message_count: 0,
            tool_call_id_name_mapping: HashMap::new(),
            user_id: "Uninitialized".into(),
        }
    }

    pub async fn send_message(
        &mut self,
        request: ChatCompletionRequest,
        request_context: R,
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

    async fn make_chat_completion_stream(
        &mut self,
        request_context: R,
    ) -> Result<ChatCompletionStream<'_>> {
        let item_stream = stream!({
            let mut stream_parts = vec![];
            for _ in 0..MAX_RECURSIONS {
                let mut stream = match self
                    .make_openai_chat_completion_stream()
                    .await
                    .map(Self::map_stream)
                {
                    Ok(stream) => stream,
                    Err(err) => {
                        yield Err(err);
                        break;
                    }
                };

                // consume stream
                // accumulate to stream_parts
                while let Some(item) = stream.next().await {
                    if item.is_err() {
                        yield item;
                        break;
                    }
                    let stream_part = item.unwrap();
                    yield Ok(stream_part.clone());
                    stream_parts.push(stream_part);
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
        stream_parts: Vec<StreamPart>,
        request_context: R,
    ) -> ProcessedStream {
        // list of all tool calls
        let mut tool_calls = vec![];
        // list of all tool responses as openai items
        let mut tool_responses = vec![];
        // aggregated response string
        let mut response = String::new();
        // list of tool responses as stream parts (send these to frontend)
        let mut tool_stream_parts = vec![];
        for item in stream_parts {
            match item {
                StreamPart::ToolCall(call) => {
                    // Store the tool call ID -> name mapping for later use in message conversion
                    self.tool_call_id_name_mapping
                        .insert(call.id.clone(), call.name.clone());

                    match self
                        .toolset
                        .try_tool_call(
                            self.context.clone(),
                            request_context.clone(),
                            &call.name,
                            &call.json,
                        )
                        .await
                    {
                        Ok(response) => {
                            tool_calls.push(ChatCompletionMessageToolCall {
                                id: call.id.clone(),
                                r#type: async_openai::types::ChatCompletionToolType::Function,
                                function: FunctionCall {
                                    arguments: call.json.to_string(),
                                    name: call.name.clone(),
                                },
                            });
                            if let ToolResult::Ok(tool_output) = response {
                                let content_text = serde_json::to_string_pretty(&tool_output)
                                    .unwrap_or_else(|_| {
                                        "internal error formatting response".to_string()
                                    });
                                tool_stream_parts.push(ToolResponse::Json {
                                    id: call.id.clone(),
                                    json: tool_output,
                                    name: call.name.clone(),
                                });
                                let content =
                                    async_openai::types::ChatCompletionRequestToolMessageContent::Text(
                                        content_text,
                                    );
                                tool_responses.push(ChatCompletionRequestMessage::Tool(
                                    ChatCompletionRequestToolMessage {
                                        content,
                                        tool_call_id: call.id,
                                    },
                                ));
                            } else {
                                let fail = response.unwrap_err();
                                tool_stream_parts.push(ToolResponse::Err {
                                    id: call.id.clone(),
                                    description: fail.description.clone(),
                                    name: call.name.clone(),
                                });
                                tool_responses.push(ChatCompletionRequestMessage::Tool(
                                    ChatCompletionRequestToolMessage {
                                      content: async_openai::types::ChatCompletionRequestToolMessageContent::Text(
                                          fail.description
                                      ),
                                      tool_call_id: call.id
                                    },
                                ));
                            }
                        }
                        Err(err) => {
                            tracing::error!(error=?err, "error calling tool");
                            // Still add the tool call so the LLM knows we tried
                            tool_calls.push(ChatCompletionMessageToolCall {
                                id: call.id.clone(),
                                r#type: async_openai::types::ChatCompletionToolType::Function,
                                function: FunctionCall {
                                    arguments: call.json.to_string(),
                                    name: call.name.clone(),
                                },
                            });
                            // Send error response to both frontend and LLM
                            let error_description = format!("Error calling tool: {}", err);
                            tool_stream_parts.push(ToolResponse::Err {
                                id: call.id.clone(),
                                description: error_description.clone(),
                                name: call.name.clone(),
                            });
                            tool_responses.push(ChatCompletionRequestMessage::Tool(
                                ChatCompletionRequestToolMessage {
                                    content: async_openai::types::ChatCompletionRequestToolMessageContent::Text(
                                        error_description
                                    ),
                                    tool_call_id: call.id
                                },
                            ));
                        }
                    }
                }
                StreamPart::Content(text) => response.push_str(text.as_str()),
                StreamPart::Usage { .. } => (),
                StreamPart::ToolResponse(_) => (),
            };
        }

        let assistant_response =
            ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
                content: if response.is_empty() {
                    None
                } else {
                    Some(ChatCompletionRequestAssistantMessageContent::Text(response))
                },
                tool_calls: if tool_calls.is_empty() {
                    None
                } else {
                    Some(tool_calls)
                },
                ..Default::default()
            });
        let mut messages = vec![assistant_response];
        messages.append(&mut tool_responses);
        ProcessedStream {
            new_messages: messages,
            tool_responses: tool_stream_parts,
        }
    }

    fn map_stream<'a>(mut stream: ChatCompletionResponseStream) -> ChatCompletionStream<'a> {
        Box::pin(stream!({
            let mut tool_calls: HashMap<u32, PartialToolCall> = HashMap::new();
            while let Some(part) = stream.next().await {
                match part {
                    Ok(part) => {
                        if let Some(usage) = &part.usage {
                            yield Ok(StreamPart::Usage(usage.clone().into()))
                        }
                        let first = part.choices.first();
                        if first.is_none() {
                            continue;
                        }
                        let first = first.unwrap();
                        if let Some(content) = &first.delta.content {
                            yield Ok(StreamPart::Content(content.clone()));
                        }

                        if let Some(calls) = &first.delta.tool_calls {
                            for call in calls {
                                if let Some(function) = &call.function {
                                    tool_calls
                                        .entry(call.index)
                                        .and_modify(|partial| {
                                            if let Some(n) = &function.name {
                                                partial.name = format!("{}{}", partial.name, n);
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
                                if let Ok(call) = ToolCall::try_from(call) {
                                    yield Ok(StreamPart::ToolCall(call));
                                }
                            }
                            tool_calls = HashMap::new();
                        }
                    }
                    Err(error) => yield Err(anyhow::Error::from(error)),
                }
            }
        }))
    }

    async fn make_openai_chat_completion_stream(&mut self) -> Result<ChatCompletionResponseStream> {
        self.request.messages = self.messages.clone();
        self.request.tools = Some(self.toolset.openai_chatcompletion_toolset());
        self.request.stream = Some(true);
        self.request.stream_options = Some(ChatCompletionStreamOptions {
            include_usage: true,
        });

        let mut request = serde_json::to_value(&self.request).context("jsonify request")?;

        if let serde_json::Value::Object(ref mut r) = request {
            r.insert(
                "user".into(),
                serde_json::Value::String(self.user_id.clone()),
            );
        }

        self.inner
            .chat()
            .create_stream_byot(request)
            .await
            .map_err(anyhow::Error::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AssistantMessagePart, ChatMessageContent, Role};
    use async_openai::config::OpenAIConfig;
    use async_openai::types::{
        ChatCompletionMessageToolCall, ChatCompletionRequestAssistantMessage,
        ChatCompletionRequestAssistantMessageContent, ChatCompletionRequestMessage,
        ChatCompletionRequestToolMessage, ChatCompletionRequestToolMessageContent,
        ChatCompletionToolType, FunctionCall,
    };
    use serde_json::json;

    fn create_mock_chat() -> Chat<OpenAIConfig, String, Box<Client<OpenAIConfig>>, String> {
        let client = Box::new(Client::new());
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
                async_openai::types::ChatCompletionRequestSystemMessage {
                    content: async_openai::types::ChatCompletionRequestSystemMessageContent::Text(
                        "System message".to_string(),
                    ),
                    ..Default::default()
                },
            ),
            ChatCompletionRequestMessage::User(
                async_openai::types::ChatCompletionRequestUserMessage {
                    content: async_openai::types::ChatCompletionRequestUserMessageContent::Text(
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
                tool_calls: Some(vec![ChatCompletionMessageToolCall {
                    id: tool_call_id.clone(),
                    function: FunctionCall {
                        name: tool_name.clone(),
                        arguments: json!({"param": "value"}).to_string(),
                    },
                    r#type: ChatCompletionToolType::Function,
                }]),
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
                content: ChatCompletionRequestToolMessageContent::Text(
                    json!({"type": "error", "description": "Tool execution failed"}).to_string(),
                ),
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
                panic!("Expected tool error part");
            }
        } else {
            panic!("Expected assistant message parts");
        }
    }
}
