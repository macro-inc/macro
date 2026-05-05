use super::MAX_RECURSIONS;
use crate::openai_toolset::OpenAIToolSetExt;
use crate::tool::types::{
    AsyncToolSet, PartialToolCall, RequestContext, StreamPart, ToolCall, ToolResult,
};
use crate::tool::types::{ChatCompletionStream, ExtendedPartStream, PartOrExt, ToolResponse};
use crate::types::openai::message::convert_message;
use crate::types::traits::{ExtendedOpenAIStream, ExtendedOpenAIStreamItem};
use crate::types::{ChatCompletionRequest, ChatMessage, ChatMessages};
use crate::types::{ExtendedClient, Result};
use async_openai::types::chat::{
    ChatCompletionMessageToolCall, ChatCompletionMessageToolCalls,
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestAssistantMessageContent,
    ChatCompletionRequestMessage, ChatCompletionRequestToolMessage, ChatCompletionStreamOptions,
    CreateChatCompletionRequest, FinishReason, FunctionCall,
};
use async_stream::stream;
use futures::stream::StreamExt;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

struct ProcessedStream {
    pub new_messages: Vec<ChatCompletionRequestMessage>,
    pub tool_responses: Vec<ToolResponse>,
}

pub struct Chat<I, T>
where
    I: ExtendedClient + Send + Sync,
    T: Clone + Send + Sync + 'static,
{
    client: I,
    toolset: Arc<AsyncToolSet<T>>,
    request: CreateChatCompletionRequest,
    pub(crate) messages: Vec<ChatCompletionRequestMessage>,
    context: T,
    pub(crate) initial_message_count: usize,
    pub(crate) tool_call_id_name_mapping: HashMap<String, String>, // tool_call_id -> tool_name
    user_id: String,
}

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
}

impl<I, T> Chat<I, T>
where
    I: ExtendedClient + Send + Sync,
    T: Clone + Send + Sync,
{
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
        let mut new_messages: Vec<ChatCompletionRequestMessage> = vec![];
        // yielded to consumer
        let mut tool_responses: Vec<ToolResponse> = vec![];

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
                                    new_messages.push(
                                        self.make_assistant_message(&mut content, &mut tool_calls),
                                    );
                                    new_messages.append(&mut pending_tool_messages);
                                }
                                let content_text = serde_json::to_string_pretty(&json)
                                    .unwrap_or_else(|_| "internal error parsing".into());
                                new_messages.push(ChatCompletionRequestMessage::Tool(
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

                        let tool_response_text = match self
                            .toolset
                            .try_tool_call(
                                self.context.clone(),
                                request_context.clone(),
                                &call.name,
                                &call.json,
                            )
                            .await
                        {
                            // found tool and call success
                            Ok(ToolResult::Ok(output)) => {
                                let json_string = serde_json::to_string_pretty(&output)
                                    .unwrap_or_else(|_| {
                                        "internal error formatting response".to_string()
                                    });
                                tool_responses.push(ToolResponse::Json {
                                    id: call.id.clone(),
                                    json: output,
                                    name: call.name.clone(),
                                });
                                json_string
                            }
                            // found tool and call fail
                            Ok(ToolResult::Err(fail)) => {
                                tracing::error!(error=?fail, "tool execution error");
                                tool_responses.push(ToolResponse::Err {
                                    id: call.id.clone(),
                                    description: fail.description.clone(),
                                    name: call.name.clone(),
                                });
                                fail.description
                            }
                            // tool call not found | malformed json
                            Err(err) => {
                                tracing::error!(error=?err, "error calling tool");
                                let desc = format!("Error calling tool: {}", err);
                                tool_responses.push(ToolResponse::Err {
                                    id: call.id.clone(),
                                    description: desc.clone(),
                                    name: call.name.clone(),
                                });
                                desc
                            }
                        };

                        // response message in message chain
                        pending_tool_messages.push(ChatCompletionRequestMessage::Tool(
                            ChatCompletionRequestToolMessage {
                                content: async_openai::types::chat::ChatCompletionRequestToolMessageContent::Text(
                                    tool_response_text,
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
        new_messages.push(self.make_assistant_message(&mut content, &mut tool_calls));
        new_messages.append(&mut pending_tool_messages);

        ProcessedStream {
            new_messages,
            tool_responses,
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
        self.request.messages = correct_message_chain(self.messages.clone());
        self.request.tools = Some(self.toolset.openai_chatcompletion_toolset());
        self.request.stream = Some(true);
        self.request.stream_options = Some(ChatCompletionStreamOptions {
            include_usage: Some(true),
            include_obfuscation: None,
        });

        self.client.chat_stream(self.request.clone()).await
    }
}

// anthropic sometimes doesn't return responses for their servier tools. this causes 400's
#[tracing::instrument(skip_all)]
fn correct_message_chain(
    messages: Vec<ChatCompletionRequestMessage>,
) -> Vec<ChatCompletionRequestMessage> {
    let mut corrected = vec![];
    let mut pending_tool_call_ids: Option<Vec<String>> = None;
    let mut i = 0;

    while i < messages.len() {
        let msg = &messages[i];

        if let Some(expected_ids) = pending_tool_call_ids.take() {
            // Consume as many matching tool responses as we can
            let mut responded: HashSet<String> = HashSet::new();
            while i < messages.len() {
                if let ChatCompletionRequestMessage::Tool(tool_msg) = &messages[i] {
                    responded.insert(tool_msg.tool_call_id.clone());
                    corrected.push(messages[i].clone());
                    i += 1;
                } else {
                    break;
                }
            }
            // Backfill any missing tool responses
            for id in &expected_ids {
                if !responded.contains(id) {
                    tracing::warn!(call_id=?id, "missing tool response");
                    corrected.push(ChatCompletionRequestMessage::Tool(
                        ChatCompletionRequestToolMessage {
                            tool_call_id: id.clone(),
                            content:
                                async_openai::types::chat::ChatCompletionRequestToolMessageContent::Text(
                                    "No response from server".into(),
                                ),
                        },
                    ));
                }
            }
        } else {
            if let ChatCompletionRequestMessage::Assistant(assistant) = msg {
                pending_tool_call_ids = assistant.tool_calls.as_ref().map(|calls| {
                    calls
                        .iter()
                        .filter_map(|c| match c {
                            ChatCompletionMessageToolCalls::Function(f) => Some(f.id.clone()),
                            _ => None,
                        })
                        .collect()
                });
            }
            corrected.push(messages[i].clone());
            i += 1;
        }
    }

    // Handle trailing assistant with tool_calls but no responses at end of messages
    if let Some(expected_ids) = pending_tool_call_ids {
        for id in &expected_ids {
            tracing::warn!(call_id=?id, "missing tool response");
            corrected.push(ChatCompletionRequestMessage::Tool(
                ChatCompletionRequestToolMessage {
                    tool_call_id: id.clone(),
                    content:
                        async_openai::types::chat::ChatCompletionRequestToolMessageContent::Text(
                            "No response from server".into(),
                        ),
                },
            ));
        }
    }
    corrected
}
