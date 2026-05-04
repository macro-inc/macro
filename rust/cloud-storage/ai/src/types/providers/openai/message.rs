use async_openai::types::chat::{
    ChatCompletionMessageToolCall, ChatCompletionMessageToolCalls,
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestAssistantMessageContent,
    ChatCompletionRequestAssistantMessageContentPart, ChatCompletionRequestMessage,
    ChatCompletionRequestMessageContentPartImage, ChatCompletionRequestMessageContentPartText,
    ChatCompletionRequestSystemMessage, ChatCompletionRequestToolMessage,
    ChatCompletionRequestToolMessageContent, ChatCompletionRequestUserMessage,
    ChatCompletionRequestUserMessageContent, ChatCompletionRequestUserMessageContentPart,
    FunctionCall, ImageDetail, ImageUrl,
};

use crate::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, ChatMessages, Role};
use attachment::{Attachable, TextOrImage, image::ImageData};
use std::collections::HashMap;

const IMAGE_PROCESS_QUALITY: Option<ImageDetail> = Some(ImageDetail::High);

fn image_into_openai_image_url(image: ImageData) -> ImageUrl {
    match image {
        ImageData::StaticUrl(url) => ImageUrl {
            url,
            detail: IMAGE_PROCESS_QUALITY,
        },
        ImageData::Base64(base_64_image) => ImageUrl {
            url: base_64_image.to_string(),
            detail: IMAGE_PROCESS_QUALITY,
        },
    }
}

impl From<ChatMessage> for Vec<ChatCompletionRequestMessage> {
    fn from(value: ChatMessage) -> Self {
        match value.content {
            ChatMessageContent::Text(text) => match value.role {
                Role::Assistant => {
                    vec![ChatCompletionRequestMessage::Assistant(
                        ChatCompletionRequestAssistantMessage {
                            content: Some(ChatCompletionRequestAssistantMessageContent::Text(
                                text.to_owned(),
                            )),
                            ..Default::default()
                        },
                    )]
                }
                Role::User => {
                    if let Some(attachments) = value.attachments {
                        let formatted = attachments.into_formatted_parts().compact();
                        let mut user_message_content =
                            vec![ChatCompletionRequestUserMessageContentPart::Text(
                                ChatCompletionRequestMessageContentPartText { text },
                            )];

                        for part in formatted.into_parts().into_inner() {
                            match part {
                                TextOrImage::Text(attachment_text) => {
                                    user_message_content.push(
                                        ChatCompletionRequestUserMessageContentPart::Text(
                                            ChatCompletionRequestMessageContentPartText {
                                                text: attachment_text,
                                            },
                                        ),
                                    );
                                }
                                TextOrImage::Image(image) => {
                                    user_message_content.push(
                                        ChatCompletionRequestUserMessageContentPart::ImageUrl(
                                            ChatCompletionRequestMessageContentPartImage {
                                                image_url: image_into_openai_image_url(image),
                                            },
                                        ),
                                    );
                                }
                            }
                        }

                        vec![ChatCompletionRequestMessage::User(
                            ChatCompletionRequestUserMessage {
                                name: None,
                                content: ChatCompletionRequestUserMessageContent::Array(
                                    user_message_content,
                                ),
                            },
                        )]
                    } else {
                        vec![ChatCompletionRequestMessage::User(
                            ChatCompletionRequestUserMessage {
                                name: None,
                                content: ChatCompletionRequestUserMessageContent::Text(text),
                            },
                        )]
                    }
                }
                Role::System => {
                    vec![ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
                        content:
                            async_openai::types::chat::ChatCompletionRequestSystemMessageContent::Text(
                                text,
                            ),
                        ..Default::default()
                    })]
                }
            },
            ChatMessageContent::AssistantMessageParts(parts) => {
                let mut messages = Vec::new();
                let mut pending_text = None::<String>;
                let mut pending_tool_calls: Vec<ChatCompletionMessageToolCalls> = Vec::new();

                fn flush_pending(
                    messages: &mut Vec<ChatCompletionRequestMessage>,
                    pending_text: &mut Option<String>,
                    pending_tool_calls: &mut Vec<ChatCompletionMessageToolCalls>,
                ) {
                    if pending_text.is_some() || !pending_tool_calls.is_empty() {
                        messages.push(ChatCompletionRequestMessage::Assistant(
                            ChatCompletionRequestAssistantMessage {
                                content: pending_text.as_ref().map(|v| {
                                    ChatCompletionRequestAssistantMessageContent::Text(v.to_owned())
                                }),
                                refusal: None,
                                name: None,
                                audio: None,
                                tool_calls: if !pending_tool_calls.is_empty() {
                                    Some(pending_tool_calls.to_owned())
                                } else {
                                    None
                                },
                                #[allow(deprecated)]
                                function_call: None,
                            },
                        ));
                    }
                    *pending_text = None;
                    *pending_tool_calls = vec![];
                }

                for part in parts {
                    match part {
                        AssistantMessagePart::Text { text } => {
                            if text.is_empty() {
                                continue;
                            }
                            match pending_text.as_mut() {
                                Some(pending) => pending.push_str(&text),
                                None => pending_text = Some(text),
                            }
                        }
                        AssistantMessagePart::ToolCall { name, json, id } => {
                            let tool_call = ChatCompletionMessageToolCalls::Function(
                                ChatCompletionMessageToolCall {
                                    function: FunctionCall {
                                        arguments: serde_json::to_string(&json)
                                            .unwrap_or(String::new()),
                                        name: name.clone(),
                                    },
                                    id: id.clone(),
                                },
                            );
                            pending_tool_calls.push(tool_call);
                        }
                        AssistantMessagePart::ToolCallResponseJson { json, id, .. } => {
                            // flush pending text and tool calls as an assistant message
                            flush_pending(
                                &mut messages,
                                &mut pending_text,
                                &mut pending_tool_calls,
                            );
                            // Create a separate tool response message
                            messages.push(ChatCompletionRequestMessage::Tool(
                                ChatCompletionRequestToolMessage {
                                    tool_call_id: id.clone(),
                                    content: ChatCompletionRequestToolMessageContent::Text(
                                       serde_json::to_string_pretty(&json)
                                           .inspect_err(|e| tracing::error!(err=?e, "failed to serialize tool"))
                                           .unwrap_or_default()
                                    ),
                                },
                            ));
                        }
                        AssistantMessagePart::ToolCallErr {
                            description, id, ..
                        } => {
                            flush_pending(
                                &mut messages,
                                &mut pending_text,
                                &mut pending_tool_calls,
                            );

                            messages.push(ChatCompletionRequestMessage::Tool(
                                ChatCompletionRequestToolMessage {
                                    tool_call_id: id.clone(),
                                    content: ChatCompletionRequestToolMessageContent::Text(
                                        description,
                                    ),
                                },
                            ));
                        }
                    }
                }

                flush_pending(&mut messages, &mut pending_text, &mut pending_tool_calls);

                messages
            }
        }
    }
}

/// Convert ChatCompletionRequestMessage to ChatMessage with optional tool call name mapping
/// This function provides a way to preserve tool names that would otherwise be lost in conversion
pub fn convert_message(
    msg: ChatCompletionRequestMessage,
    tool_call_id_name_mapping: Option<&HashMap<String, String>>,
) -> ChatMessage {
    match msg {
        ChatCompletionRequestMessage::System(system_msg) => ChatMessage {
            role: Role::System,
            content: match system_msg.content {
                async_openai::types::chat::ChatCompletionRequestSystemMessageContent::Text(
                    text,
                ) => ChatMessageContent::Text(text),
                async_openai::types::chat::ChatCompletionRequestSystemMessageContent::Array(
                    parts,
                ) => {
                    let text_parts: Vec<String> = parts.iter().map(|part| {
                        let async_openai::types::chat::ChatCompletionRequestSystemMessageContentPart::Text(text_part) = part;
                        text_part.text.clone()
                    }).collect();
                    ChatMessageContent::Text(text_parts.join(" "))
                }
            },
            attachments: None,
        },
        ChatCompletionRequestMessage::User(user_msg) => {
            let content = match user_msg.content {
                ChatCompletionRequestUserMessageContent::Text(text) => {
                    ChatMessageContent::Text(text)
                }
                ChatCompletionRequestUserMessageContent::Array(parts) => {
                    let text_parts: Vec<String> = parts
                        .into_iter()
                        .filter_map(|part| match part {
                            ChatCompletionRequestUserMessageContentPart::Text(text_part) => {
                                Some(text_part.text)
                            }
                            _ => None,
                        })
                        .collect();
                    ChatMessageContent::Text(text_parts.join(" "))
                }
            };

            ChatMessage {
                role: Role::User,
                content,
                attachments: None,
            }
        }
        ChatCompletionRequestMessage::Assistant(assistant_msg) => {
            let mut parts = Vec::new();

            if let Some(content) = assistant_msg.content {
                match content {
                    ChatCompletionRequestAssistantMessageContent::Text(text) => {
                        if !text.is_empty() {
                            parts.push(AssistantMessagePart::Text { text });
                        }
                    }
                    ChatCompletionRequestAssistantMessageContent::Array(content_parts) => {
                        // Collect all text parts and combine them into a single text part
                        let mut combined_text = String::new();
                        for part in content_parts {
                            match part {
                                ChatCompletionRequestAssistantMessageContentPart::Text(
                                    text_part,
                                ) => {
                                    if !text_part.text.is_empty() {
                                        if !combined_text.is_empty() {
                                            combined_text.push(' ');
                                        }
                                        combined_text.push_str(&text_part.text);
                                    }
                                }
                                ChatCompletionRequestAssistantMessageContentPart::Refusal(_) => {}
                            }
                        }
                        if !combined_text.is_empty() {
                            parts.push(AssistantMessagePart::Text {
                                text: combined_text,
                            });
                        }
                    }
                }
            }

            if let Some(tool_calls) = assistant_msg.tool_calls {
                for tool_call in tool_calls {
                    if let async_openai::types::chat::ChatCompletionMessageToolCalls::Function(
                        tool_call,
                    ) = tool_call
                        && let Ok(json_value) = serde_json::from_str(&tool_call.function.arguments)
                    {
                        parts.push(AssistantMessagePart::ToolCall {
                            name: tool_call.function.name,
                            json: json_value,
                            id: tool_call.id,
                        });
                    }
                }
            }

            let content = if parts.len() == 1 {
                if let AssistantMessagePart::Text { text } = &parts[0] {
                    ChatMessageContent::Text(text.clone())
                } else {
                    ChatMessageContent::AssistantMessageParts(parts)
                }
            } else if parts.is_empty() {
                ChatMessageContent::Text(String::new())
            } else {
                ChatMessageContent::AssistantMessageParts(parts)
            };

            ChatMessage {
                role: Role::Assistant,
                content,
                attachments: None,
            }
        }
        ChatCompletionRequestMessage::Tool(tool_msg) => {
            let response_text = match tool_msg.content {
                ChatCompletionRequestToolMessageContent::Text(text) => text,
                ChatCompletionRequestToolMessageContent::Array(_) => {
                    tracing::error!("Multi part tool messages are unsupported");
                    serde_json::to_string(&serde_json::json!({"error": "Unexpected tool response"}))
                        .expect("json")
                }
            };

            // Use the mapping to recover the original tool name
            let tool_name = tool_call_id_name_mapping
                .and_then(|mapping| mapping.get(&tool_msg.tool_call_id).cloned())
                .unwrap_or_else(|| {
                    tracing::warn!(
                        "No mapping found for tool_call_id: {}",
                        tool_msg.tool_call_id
                    );
                    // fallback to ID
                    tool_msg.tool_call_id.clone()
                });

            let assistant_part = match serde_json::from_str::<serde_json::Value>(&response_text) {
                Ok(json) => AssistantMessagePart::ToolCallResponseJson {
                    name: tool_name,
                    json,
                    id: tool_msg.tool_call_id,
                },
                Err(_) => AssistantMessagePart::ToolCallErr {
                    name: tool_name,
                    description: response_text,
                    id: tool_msg.tool_call_id,
                },
            };

            ChatMessage {
                role: Role::Assistant,
                content: ChatMessageContent::AssistantMessageParts(vec![assistant_part]),
                attachments: None,
            }
        }
        ChatCompletionRequestMessage::Function(_) => ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::Text(String::new()),
            attachments: None,
        },
        ChatCompletionRequestMessage::Developer(developer_msg) => ChatMessage {
            role: Role::System,
            content: ChatMessageContent::Text(format!("{:?}", developer_msg.content)),
            attachments: None,
        },
    }
}

impl From<Vec<ChatMessage>> for ChatMessages {
    fn from(messages: Vec<ChatMessage>) -> Self {
        fn make_content_multipart(content: ChatMessageContent) -> Vec<AssistantMessagePart> {
            match content {
                ChatMessageContent::AssistantMessageParts(parts) => parts,
                ChatMessageContent::Text(text) => vec![AssistantMessagePart::Text { text }],
            }
        }

        let (mut messages, current) = messages.into_iter().fold(
            (vec![], None::<ChatMessage>),
            |(mut messages, current), msg| match (msg.role, current) {
                (Role::Assistant, Some(mut current)) => {
                    // 1. transform both assistant messages to multi part messages;
                    let mut current_content =
                        make_content_multipart(std::mem::take(&mut current.content));
                    let mut msg_content = make_content_multipart(msg.content);
                    // 2. append msg parts to current parts
                    current_content.append(&mut msg_content);
                    current.content = ChatMessageContent::AssistantMessageParts(current_content);
                    (messages, Some(current))
                }
                (Role::Assistant, None) => (messages, Some(msg)),
                (_, Some(current)) => {
                    messages.push(current);
                    messages.push(msg);
                    (messages, None)
                }
                (_, None) => {
                    messages.push(msg);
                    (messages, None)
                }
            },
        );
        if let Some(current) = current {
            messages.push(current);
        }
        ChatMessages(messages)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn assert_msg(msg: &ChatMessage, role: Role, content: ChatMessageContent) {
        assert_eq!(msg.role, role);
        assert_eq!(msg.content, content);
        assert!(msg.attachments.is_none());
    }

    #[test]
    fn test_system_message_roundtrip() {
        let msg = ChatMessage {
            role: Role::System,
            content: ChatMessageContent::Text("You are a helpful assistant.".to_string()),
            attachments: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = msg.into();
        let converted = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        assert_msg(
            &converted,
            Role::System,
            ChatMessageContent::Text("You are a helpful assistant.".to_string()),
        );
    }

    #[test]
    fn test_user_text_message_roundtrip() {
        let msg = ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text("Hello, how are you?".to_string()),
            attachments: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = msg.into();
        let converted = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        assert_msg(
            &converted,
            Role::User,
            ChatMessageContent::Text("Hello, how are you?".to_string()),
        );
    }

    #[test]
    fn test_assistant_text_message_roundtrip() {
        let msg = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::Text("I'm doing well, thank you!".to_string()),
            attachments: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = msg.into();
        let converted = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        assert_msg(
            &converted,
            Role::Assistant,
            ChatMessageContent::Text("I'm doing well, thank you!".to_string()),
        );
    }

    #[test]
    fn test_assistant_with_tool_call_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "get_weather".to_string();
        let expected_content = ChatMessageContent::AssistantMessageParts(vec![
            AssistantMessagePart::Text {
                text: "Let me check the weather for you.".to_string(),
            },
            AssistantMessagePart::ToolCall {
                name: tool_name.clone(),
                json: json!({"location": "San Francisco"}),
                id: tool_call_id.clone(),
            },
        ]);

        let msg = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(vec![
                AssistantMessagePart::Text {
                    text: "Let me check the weather for you.".to_string(),
                },
                AssistantMessagePart::ToolCall {
                    name: tool_name.clone(),
                    json: json!({"location": "San Francisco"}),
                    id: tool_call_id.clone(),
                },
            ]),
            attachments: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = msg.into();

        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted_messages: Vec<ChatMessage> = openai_msgs
            .into_iter()
            .map(|msg| convert_message(msg, Some(&tool_mapping)))
            .collect();

        let chat_messages = ChatMessages::from(converted_messages);
        let converted = &chat_messages.0[0];

        assert_eq!(converted.role, Role::Assistant);
        assert_eq!(converted.content, expected_content);
    }

    #[test]
    fn test_assistant_with_tool_response_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "get_weather".to_string();
        let expected_content = ChatMessageContent::AssistantMessageParts(vec![
            AssistantMessagePart::ToolCallResponseJson {
                name: tool_name.clone(),
                json: json!({"temperature": "72°F", "condition": "sunny"}),
                id: tool_call_id.clone(),
            },
        ]);

        let msg = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(vec![
                AssistantMessagePart::ToolCallResponseJson {
                    name: tool_name.clone(),
                    json: json!({"temperature": "72°F", "condition": "sunny"}),
                    id: tool_call_id.clone(),
                },
            ]),
            attachments: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = msg.into();

        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted =
            convert_message(openai_msgs.into_iter().next().unwrap(), Some(&tool_mapping));

        assert_eq!(converted.role, Role::Assistant);
        assert_eq!(converted.content, expected_content);
    }

    #[test]
    fn test_assistant_with_tool_error_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "get_weather".to_string();
        let expected_content =
            ChatMessageContent::AssistantMessageParts(vec![AssistantMessagePart::ToolCallErr {
                name: tool_name.clone(),
                description: "<Error message here>".to_string(),
                id: tool_call_id.clone(),
            }]);

        let msg = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(vec![
                AssistantMessagePart::ToolCallErr {
                    name: tool_name.clone(),
                    description: "<Error message here>".to_string(),
                    id: tool_call_id.clone(),
                },
            ]),
            attachments: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = msg.into();

        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted =
            convert_message(openai_msgs.into_iter().next().unwrap(), Some(&tool_mapping));

        assert_eq!(converted.role, Role::Assistant);
        assert_eq!(converted.content, expected_content);
    }

    #[test]
    fn test_complex_assistant_message_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "calculate".to_string();
        let expected_content = ChatMessageContent::AssistantMessageParts(vec![
            AssistantMessagePart::Text {
                text: "Let me calculate that for you.".to_string(),
            },
            AssistantMessagePart::ToolCall {
                name: tool_name.clone(),
                json: json!({"expression": "2 + 2"}),
                id: tool_call_id.clone(),
            },
            AssistantMessagePart::ToolCallResponseJson {
                name: tool_name.clone(),
                json: json!({"result": 4}),
                id: tool_call_id.clone(),
            },
            AssistantMessagePart::Text {
                text: "The answer is 4.".to_string(),
            },
        ]);

        let msg = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(vec![
                AssistantMessagePart::Text {
                    text: "Let me calculate that for you.".to_string(),
                },
                AssistantMessagePart::ToolCall {
                    name: tool_name.clone(),
                    json: json!({"expression": "2 + 2"}),
                    id: tool_call_id.clone(),
                },
                AssistantMessagePart::ToolCallResponseJson {
                    name: tool_name.clone(),
                    json: json!({"result": 4}),
                    id: tool_call_id.clone(),
                },
                AssistantMessagePart::Text {
                    text: "The answer is 4.".to_string(),
                },
            ]),
            attachments: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = msg.into();

        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted_messages: Vec<ChatMessage> = openai_msgs
            .into_iter()
            .map(|msg| convert_message(msg, Some(&tool_mapping)))
            .collect();

        let chat_messages = ChatMessages::from(converted_messages);
        let converted = &chat_messages.0[0];

        assert_eq!(converted.role, Role::Assistant);
        assert_eq!(converted.content, expected_content);
    }
}
