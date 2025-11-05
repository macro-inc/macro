use crate::types::request::{self, SystemPrompt};
use async_openai::types::{
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestDeveloperMessage,
    ChatCompletionRequestFunctionMessage, ChatCompletionRequestMessage,
    ChatCompletionRequestSystemMessage, ChatCompletionRequestSystemMessageContentPart,
    ChatCompletionRequestToolMessage, ChatCompletionRequestUserMessage, ChatCompletionTool,
    ChatCompletionToolChoiceOption, CreateChatCompletionRequest,
};

#[derive(Debug, Clone)]
pub enum MessageConversionError {
    /// System messages are not messages in anthropic api
    SystemPrompt(ChatCompletionRequestSystemMessage),
    /// Assistant messages may fail if all fields are None
    MalformedAssistantMessage {
        message: ChatCompletionRequestAssistantMessage,
        reason: String,
    },
    /// Developer messages should be appended to the system prompt
    DeveloperMessage(ChatCompletionRequestDeveloperMessage),
    /// Function messges are deprecated / unsupported
    FunctionMessage(ChatCompletionRequestFunctionMessage),
}

impl From<CreateChatCompletionRequest> for request::CreateMessageRequestBody {
    fn from(msg: CreateChatCompletionRequest) -> Self {
        let mut request = Self::default();
        if let Some(tokens) = msg.max_completion_tokens {
            request.max_tokens = tokens;
        }
        if let Some(user) = msg.metadata.and_then(|meta| {
            meta.get("user_id")
                .and_then(|user| user.as_str())
                .map(|s| s.to_string())
        }) {
            request.metadata = Some(request::Metadata {
                user_id: Some(user.to_owned()),
            })
        }
        if let Some(stop_sequences) = msg.stop {
            match stop_sequences {
                async_openai::types::Stop::String(text) => {
                    request.stop_sequences = Some(vec![text])
                }
                async_openai::types::Stop::StringArray(parts) => {
                    request.stop_sequences = Some(parts)
                }
            }
        }
        request.model = msg.model;
        request.stream = msg.stream;
        request.temperature = msg.temperature;
        request.tool_choice = msg.tool_choice.map(Into::into);
        request.tools = msg
            .tools
            .map(|tools| tools.into_iter().map(Into::into).collect());
        request.top_p = msg.top_p;

        let mut prompt_messages = Vec::new();
        let mut dev_messages = Vec::new();
        request.messages = msg
            .messages
            .into_iter()
            .filter_map(|message| {
                let ant_msg = request::RequestMessage::try_from(message);
                if let Err(MessageConversionError::DeveloperMessage(dev_msg)) = ant_msg {
                    dev_messages.push(dev_msg);
                    None
                } else if let Err(MessageConversionError::SystemPrompt(sys_msg)) = ant_msg {
                    prompt_messages.push(sys_msg);
                    None
                } else if ant_msg.is_err() {
                    None
                } else {
                    Some(ant_msg.unwrap())
                }
            })
            .collect();
        let mut system_prompt = SystemPrompt::from(prompt_messages);
        for msg in dev_messages {
            for text in developer_message_as_text_parts(&msg) {
                system_prompt.push_text(text)
            }
        }
        request.system = Some(system_prompt);
        request
    }
}

impl From<Vec<ChatCompletionRequestSystemMessage>> for request::SystemPrompt {
    fn from(value: Vec<ChatCompletionRequestSystemMessage>) -> Self {
        if value.is_empty() {
            Self::Text(String::new())
        } else if value.len() == 1 {
            let parts = system_message_as_text_pars(&value[0]);
            if parts.len() == 1 {
                SystemPrompt::Text(parts[0].to_owned())
            } else {
                SystemPrompt::Blocks(
                    parts
                        .into_iter()
                        .map(|part| request::SystemContent {
                            r#type: "text".into(),
                            text: part.to_owned(),
                            cache_control: None,
                            citations: None,
                        })
                        .collect(),
                )
            }
        } else {
            let mut messages = Vec::new();
            value.into_iter().for_each(|msg| {
                let parts = system_message_as_text_pars(&msg);
                let sys_parts = parts.into_iter().map(|part| request::SystemContent {
                    r#type: "text".into(),
                    text: part.to_owned(),
                    cache_control: None,
                    citations: None,
                });
                messages.extend(sys_parts);
            });
            SystemPrompt::Blocks(messages)
        }
    }
}

impl TryFrom<ChatCompletionRequestMessage> for request::RequestMessage {
    type Error = MessageConversionError;
    fn try_from(value: ChatCompletionRequestMessage) -> Result<Self, Self::Error> {
        match value {
            ChatCompletionRequestMessage::User(user_msg) => Self::try_from(user_msg),
            ChatCompletionRequestMessage::Assistant(assistant_msg) => Self::try_from(assistant_msg),
            ChatCompletionRequestMessage::Tool(tool_msg) => Self::try_from(tool_msg),
            ChatCompletionRequestMessage::System(prompt) => {
                Err(MessageConversionError::SystemPrompt(prompt))
            }
            ChatCompletionRequestMessage::Developer(dev_msg) => {
                Err(MessageConversionError::DeveloperMessage(dev_msg))
            }
            ChatCompletionRequestMessage::Function(function_msg) => {
                Err(MessageConversionError::FunctionMessage(function_msg))
            }
        }
    }
}

/// openai:tool_result_message -> anthropic:user_message
impl TryFrom<ChatCompletionRequestToolMessage> for request::RequestMessage {
    type Error = MessageConversionError;
    fn try_from(tool_msg: ChatCompletionRequestToolMessage) -> Result<Self, Self::Error> {
        let tool = request::RequestContentKind::ToolResponse {
            tool_use_id: tool_msg.tool_call_id,
            cache_control: None,
            content: match tool_msg.content {
                async_openai::types::ChatCompletionRequestToolMessageContent::Array(parts) => parts
                    .into_iter()
                    .map(|part| match part {
                        async_openai::types::ChatCompletionRequestToolMessageContentPart::Text(
                            text,
                        ) => text.text,
                    })
                    .collect::<String>(),
                async_openai::types::ChatCompletionRequestToolMessageContent::Text(text) => text,
            },
            is_err: false,
        };
        // ???
        Ok(Self {
            role: request::Role::User,
            content: request::RequestContent::Blocks(vec![tool]),
        })
    }
}

/// openai::user_msg -> anthropic::user_msg
impl TryFrom<ChatCompletionRequestUserMessage> for request::RequestMessage {
    type Error = MessageConversionError;
    fn try_from(user: ChatCompletionRequestUserMessage) -> Result<Self, Self::Error> {
        match user.content {
            async_openai::types::ChatCompletionRequestUserMessageContent::Array(arr) => {
                let content: Vec<request::RequestContentKind> = arr.into_iter()
                    .filter_map(|part| {
                        match part {
                            async_openai::types::ChatCompletionRequestUserMessageContentPart::ImageUrl(url) => {
                                Some(if is_url(&url.image_url.url)  {
                                    request::RequestContentKind::Url { url: url.image_url.url }
                                } else {
                                    let kind = media_type(&url.image_url.url);
                                    request::RequestContentKind::Base64 { data: url.image_url.url, media_type: kind }
                                })
                            },
                            async_openai::types::ChatCompletionRequestUserMessageContentPart::Text(text) =>
                            Some(request::RequestContentKind::Text { text: text.text, cache_control: None, citations: vec![] }),
                            // sound is unsupported and will fail silently
                            async_openai::types::ChatCompletionRequestUserMessageContentPart::InputAudio(_) => None
                        }
                    })
                    .collect();
                Ok(request::RequestMessage {
                    content: request::RequestContent::Blocks(content),
                    role: request::Role::User,
                })
            }
            async_openai::types::ChatCompletionRequestUserMessageContent::Text(text) => Ok(Self {
                role: request::Role::User,
                content: request::RequestContent::Text(text),
            }),
        }
    }
}

/// openai::assistant_msg -> anthropci::assistant_msg
impl TryFrom<ChatCompletionRequestAssistantMessage> for request::RequestMessage {
    type Error = MessageConversionError;
    fn try_from(assistant_msg: ChatCompletionRequestAssistantMessage) -> Result<Self, Self::Error> {
        if let Some(content) = assistant_msg.content {
            match content {
                async_openai::types::ChatCompletionRequestAssistantMessageContent::Text(text) => {
                    Ok(Self {
                        content: request::RequestContent::Text(text),
                        role: request::Role::Assistant,
                    })
                }
                async_openai::types::ChatCompletionRequestAssistantMessageContent::Array(parts) => {
                    let parts = parts.into_iter()
                                        .map(|part| match part {
                                            async_openai::types::ChatCompletionRequestAssistantMessageContentPart::Text(text) => {
                                                request::RequestContentKind::Text { text: text.text, cache_control: None, citations: vec![]}
                                            }
                                            async_openai::types::ChatCompletionRequestAssistantMessageContentPart::Refusal(message) => {
                                                request::RequestContentKind::Text { text: message.refusal, cache_control: None, citations: vec![] }
                                            }

                                        }).collect();
                    Ok(Self {
                        content: request::RequestContent::Blocks(parts),
                        role: request::Role::Assistant,
                    })
                }
            }
        }
        // TODO. likely need to supporg both text and tool calls
        else if let Some(tools) = assistant_msg.tool_calls {
            let parts = tools
                .into_iter()
                .map(|tool_call| request::RequestContentKind::ToolUse {
                    id: tool_call.id,
                    input: tool_call.function.arguments,
                    name: tool_call.function.name,
                    cache_control: None,
                })
                .collect();
            Ok(Self {
                content: request::RequestContent::Blocks(parts),
                role: request::Role::Assistant,
            })
        } else {
            Err(MessageConversionError::MalformedAssistantMessage {
                message: assistant_msg,
                reason: "Expected one of tool_calls or content to be Some".into(),
            })
        }
    }
}

impl From<ChatCompletionToolChoiceOption> for request::ToolChoice {
    fn from(value: ChatCompletionToolChoiceOption) -> Self {
        match value {
            ChatCompletionToolChoiceOption::Auto => Self::Auto {
                disable_parallel_tool_use: false,
            },
            ChatCompletionToolChoiceOption::Named(named) => Self::Tool {
                name: named.function.name,
                disable_parallel_tool_use: false,
            },
            ChatCompletionToolChoiceOption::None => Self::None,
            ChatCompletionToolChoiceOption::Required => Self::Any {
                disable_parallel_tool_use: false,
            },
        }
    }
}

impl From<ChatCompletionTool> for request::Tool {
    fn from(value: ChatCompletionTool) -> Self {
        Self {
            description: value.function.description,
            input_schema: value.function.parameters.unwrap_or_default(),
            name: value.function.name,
        }
    }
}

fn system_message_as_text_pars(sys_msg: &ChatCompletionRequestSystemMessage) -> Vec<&str> {
    match sys_msg.content {
        async_openai::types::ChatCompletionRequestSystemMessageContent::Array(ref parts) => parts
            .iter()
            .map(|part| match part {
                ChatCompletionRequestSystemMessageContentPart::Text(text) => text.text.as_str(),
            })
            .collect(),
        async_openai::types::ChatCompletionRequestSystemMessageContent::Text(ref text) => {
            vec![text.as_str()]
        }
    }
}

fn developer_message_as_text_parts(dev_msg: &ChatCompletionRequestDeveloperMessage) -> Vec<&str> {
    match dev_msg.content {
        async_openai::types::ChatCompletionRequestDeveloperMessageContent::Array(ref parts) => {
            parts.iter().map(|part| part.text.as_str()).collect()
        }
        async_openai::types::ChatCompletionRequestDeveloperMessageContent::Text(ref t) => vec![t],
    }
}

fn is_url(s: &str) -> bool {
    s.starts_with("http")
}

fn media_type(b64: &str) -> String {
    b64.strip_prefix("data:")
        .and_then(|d| d.split(';').next())
        .map(|s| s.to_owned())
        .unwrap_or_else(|| "image/png".into())
}
