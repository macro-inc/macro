///
/// The chained API is identical to the chat API
///
/// This client doesn't send tool JSON schema to the selected model.
/// Instead this client sends (name, description) data of each tool,
/// then gives the primary model a tool to call a tool with
/// (name, instructions). This tool call is then used to send a single
/// tool to a secondary model that makes the tool call.
///
/// This is done transparently so the calls to the `ChainedTool` are not
/// persisted to the database or presented to the frontend. This is
/// intended to be a drop-in replacement for the `Chat` client
///
use crate::generate_tool_input_schema;
use crate::tool::client::constant::{MAX_RECURSIONS, TOOL_GENERATOR};
use crate::tool::completion::tool_completion;
use crate::tool::types::{AsyncToolSet, PartialToolCall, StreamPart, ToolCall, ToolResult};
use crate::tool::types::{ChatCompletionStream, ToolResponse};

use crate::types::Client;
use crate::types::openai::message::convert_message;
use crate::types::{
    ChatCompletionRequest, ChatMessage, ChatMessages, MessageBuilder, Result, SystemPrompt,
};
use async_openai::types::{
    ChatCompletionMessageToolCall, ChatCompletionRequestAssistantMessage,
    ChatCompletionRequestAssistantMessageContent, ChatCompletionRequestMessage,
    ChatCompletionRequestToolMessage, ChatCompletionResponseStream, ChatCompletionStreamOptions,
    ChatCompletionTool, ChatCompletionToolType, CreateChatCompletionRequest, FinishReason,
    FunctionCall, FunctionObject,
};
use async_stream::stream;
use futures::stream::StreamExt;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

struct ProcessedStream {
    pub new_messages: Vec<ChatCompletionRequestMessage>,
    pub tool_responses: Vec<ToolResponse>,
}

#[derive(Debug, JsonSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChainedTool {
    #[schemars(description = "name of tool to use")]
    pub tool_name: String,
    #[schemars(
        description = "instructions to use tool. Include all needed context including ids, names, and user instructiomns"
    )]
    pub instructions: String,
}

impl ChainedTool {
    pub fn as_openai_tool() -> ChatCompletionTool {
        let schema = generate_tool_input_schema!(ChainedTool);
        ChatCompletionTool {
            r#type: ChatCompletionToolType::Function,
            function: FunctionObject {
                name: "chainedTool".into(),
                description: Some(
                    "Call a tool by naming it and describing how it should be called".into(),
                ),
                strict: Some(true),
                parameters: Some(schema.to_value()),
            },
        }
    }
}

fn build_tool_prompt<T, R>(toolset: &AsyncToolSet<T, R>) -> String {
    toolset
        .tools
        .values()
        .map(|v| {
            format!(
                r#"[CHAINED TOOL]
name: {},
description: {}
[END CHAINED TOOL]"#,
                v.name, v.description
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub struct Chained<I, T, R>
where
    I: Client + Send + Sync,
    T: Clone + Send + Sync + 'static,
    R: Send + Sync + 'static,
{
    inner: I,
    toolset: Arc<AsyncToolSet<T, R>>,
    request: CreateChatCompletionRequest,
    messages: Vec<ChatCompletionRequestMessage>,
    context: T,
    initial_message_count: usize,
    tool_call_id_name_mapping: HashMap<String, String>, // tool_call_id -> tool_name
    tool_call_count: usize,
}

impl<I, T, R> Chained<I, T, R>
where
    I: Client + Send + Sync,
    T: Clone + Send + Sync,
    R: Clone + Send + Sync,
{
    pub fn new(client: I, toolset: Arc<AsyncToolSet<T, R>>, context: T) -> Chained<I, T, R> {
        Chained {
            inner: client,
            toolset,
            messages: vec![],
            context,
            request: CreateChatCompletionRequest::default(),
            initial_message_count: 0,
            tool_call_id_name_mapping: HashMap::new(),
            tool_call_count: 0,
        }
    }

    pub async fn send_message(
        &mut self,
        mut request: ChatCompletionRequest,
        request_context: R,
    ) -> Result<ChatCompletionStream<'_>> {
        // tell the primary model how all the tools will work
        request
            .system_prompt
            .content
            .push_str(&build_tool_prompt(&self.toolset));

        self.request = request.try_into()?;
        self.messages = self.request.messages.clone();
        self.initial_message_count = self.messages.len();

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

    async fn route_chained_calls(&self, part: ToolCall) -> Result<ToolCall> {
        tracing::debug!("route chained call {:#?}", part);
        let chained: ChainedTool = serde_json::from_value(part.json)
            .inspect_err(|_| tracing::warn!("AI returned an invalid chained tool"))
            .map_err(anyhow::Error::from)?;

        let selected_tool = self
            .toolset
            .tools
            .get(&chained.tool_name)
            .ok_or(anyhow::anyhow!("AI returned an uknown tool"))
            .inspect_err(|err| tracing::warn!(err=?err))?;

        tool_completion(
            ChatCompletionRequest {
                model: TOOL_GENERATOR,
                messages: vec![
                    MessageBuilder::new()
                        .user()
                        .content(chained.instructions.clone())
                        .build(),
                ],
                system_prompt: SystemPrompt {
                    attachments: vec![],
                    content: "Use the tool provided in context following the user instructions"
                        .into(),
                },
            },
            selected_tool,
        )
        .await
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

                    let stream_part = match item.unwrap() {
                        StreamPart::ToolCall(call) => {
                            StreamPart::ToolCall(self.route_chained_calls(call).await?)
                        }
                        other => other,
                    };

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
                    self.tool_call_count += 1;
                    // Gemini uses tool call ids that are incompatible with openai
                    let tool_call_id = format!("toolu_{}", self.tool_call_count);
                    self.tool_call_id_name_mapping
                        .insert(tool_call_id.clone(), call.name.clone());

                    if let Ok(response) = self
                        .toolset
                        .try_tool_call(
                            self.context.clone(),
                            request_context.clone(),
                            &call.name,
                            &call.json,
                        )
                        .await
                        .inspect_err(|err| eprintln!("error: {:?}", err))
                    {
                        tool_calls.push(ChatCompletionMessageToolCall {
                            id: tool_call_id.clone(),
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
                                id: tool_call_id.clone(),
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
                                    tool_call_id: tool_call_id.clone(),
                                },
                            ));
                        } else {
                            let fail = response.unwrap_err();
                            tool_stream_parts.push(ToolResponse::Err {
                                id: tool_call_id.clone(),
                                description: fail.description.clone(),
                                name: call.name.clone(),
                            });
                            tool_responses.push(ChatCompletionRequestMessage::Tool(
                                ChatCompletionRequestToolMessage {
                                  content: async_openai::types::ChatCompletionRequestToolMessageContent::Text(
                                      fail.description
                                  ),
                                  tool_call_id: tool_call_id.clone()
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
                    Err(error) => yield Err(error.into()),
                }
            }
        }))
    }

    async fn make_openai_chat_completion_stream(&mut self) -> Result<ChatCompletionResponseStream> {
        self.request.messages = self.messages.clone();
        // don't send the tools
        self.request.tools = Some(vec![ChainedTool::as_openai_tool()]);
        self.request.stream = Some(true);
        self.request.stream_options = Some(ChatCompletionStreamOptions {
            include_usage: true,
        });

        tracing::trace!("{:#?}", self.request);

        self.inner.chat_stream(self.request.clone(), None).await
    }
}
