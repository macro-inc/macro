use async_openai::types::{
    ChatCompletionMessageToolCall, ChatCompletionRequestAssistantMessage,
    ChatCompletionRequestAssistantMessageContent, ChatCompletionRequestAssistantMessageContentPart,
    ChatCompletionRequestMessage, ChatCompletionRequestMessageContentPartImage,
    ChatCompletionRequestMessageContentPartText, ChatCompletionRequestSystemMessage,
    ChatCompletionRequestToolMessage, ChatCompletionRequestToolMessageContent,
    ChatCompletionRequestUserMessage, ChatCompletionRequestUserMessageContent,
    ChatCompletionRequestUserMessageContentPart, FunctionCall, ImageDetail, ImageUrl,
};

use crate::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, ChatMessages, Role};
use serde::Serialize;
use std::collections::HashMap;

const IMAGE_PROCESS_QUALITY: Option<ImageDetail> = Some(ImageDetail::High);

#[derive(Serialize)]
struct ToolResponseParseError {
    error: String,
    raw_response: String,
    parse_error: String,
}

impl From<ChatMessage> for Vec<ChatCompletionRequestMessage> {
    fn from(value: ChatMessage) -> Self {
        match value.content {
            ChatMessageContent::Text(text) => {
                match value.role {
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
                        // For user messages with images, we need to use array format
                        if let Some(images) = value.image_urls {
                            let mut user_message_content =
                                vec![ChatCompletionRequestUserMessageContentPart::Text(
                                    ChatCompletionRequestMessageContentPartText { text },
                                )];

                            user_message_content.extend(images.into_iter().map(|url| {
                                ChatCompletionRequestUserMessageContentPart::ImageUrl(
                                    ChatCompletionRequestMessageContentPartImage {
                                        image_url: ImageUrl {
                                            detail: IMAGE_PROCESS_QUALITY,
                                            url,
                                        },
                                    },
                                )
                            }));

                            vec![ChatCompletionRequestMessage::User(
                                ChatCompletionRequestUserMessage {
                                    name: None,
                                    content: ChatCompletionRequestUserMessageContent::Array(
                                        user_message_content,
                                    ),
                                },
                            )]
                        } else {
                            // Text-only user message
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
                            async_openai::types::ChatCompletionRequestSystemMessageContent::Text(
                                text,
                            ),
                        ..Default::default()
                    })]
                    }
                }
            }
            ChatMessageContent::AssistantMessageParts(parts) => {
                let mut messages = Vec::new();
                let mut accumulated_text = String::new();

                for part in parts {
                    match part {
                        AssistantMessagePart::Text { text } => {
                            if !accumulated_text.is_empty() {
                                accumulated_text.push(' ');
                            }
                            accumulated_text.push_str(&text);
                        }
                        AssistantMessagePart::ToolCall { name, json, id } => {
                            // If we have accumulated text, create a text message first
                            if !accumulated_text.is_empty() {
                                messages.push(ChatCompletionRequestMessage::Assistant(
                                    ChatCompletionRequestAssistantMessage {
                                        content: Some(
                                            ChatCompletionRequestAssistantMessageContent::Text(
                                                accumulated_text.clone(),
                                            ),
                                        ),
                                        tool_calls: None,
                                        ..Default::default()
                                    },
                                ));
                                accumulated_text.clear();
                            }

                            // Create a separate message for this tool call
                            let tool_call = ChatCompletionMessageToolCall {
                                function: FunctionCall {
                                    arguments: serde_json::to_string(&json)
                                        .unwrap_or(String::new()),
                                    name: name.clone(),
                                },
                                id: id.clone(),
                                r#type: async_openai::types::ChatCompletionToolType::Function,
                            };

                            messages.push(ChatCompletionRequestMessage::Assistant(
                                ChatCompletionRequestAssistantMessage {
                                    content: None,
                                    tool_calls: Some(vec![tool_call]),
                                    ..Default::default()
                                },
                            ));
                        }
                        AssistantMessagePart::ToolCallResponseJson { json, id, .. } => {
                            // If we have accumulated text, create a text message first
                            if !accumulated_text.is_empty() {
                                messages.push(ChatCompletionRequestMessage::Assistant(
                                    ChatCompletionRequestAssistantMessage {
                                        content: Some(
                                            ChatCompletionRequestAssistantMessageContent::Text(
                                                accumulated_text.clone(),
                                            ),
                                        ),
                                        tool_calls: None,
                                        ..Default::default()
                                    },
                                ));
                                accumulated_text.clear();
                            }

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
                            // If we have accumulated text, create a text message first
                            if !accumulated_text.is_empty() {
                                messages.push(ChatCompletionRequestMessage::Assistant(
                                    ChatCompletionRequestAssistantMessage {
                                        content: Some(
                                            ChatCompletionRequestAssistantMessageContent::Text(
                                                accumulated_text.clone(),
                                            ),
                                        ),
                                        tool_calls: None,
                                        ..Default::default()
                                    },
                                ));
                                accumulated_text.clear();
                            }

                            // Create a separate tool error response message with error marker
                            messages.push(ChatCompletionRequestMessage::Tool(
                                ChatCompletionRequestToolMessage {
                                    tool_call_id: id.clone(),
                                    content: ChatCompletionRequestToolMessageContent::Text(
                                        serde_json::json!({
                                            "type": "error",
                                            "description": description
                                        })
                                        .to_string(),
                                    ),
                                },
                            ));
                        }
                    }
                }

                // If there's remaining accumulated text, add it as a final message
                if !accumulated_text.is_empty() {
                    messages.push(ChatCompletionRequestMessage::Assistant(
                        ChatCompletionRequestAssistantMessage {
                            content: Some(ChatCompletionRequestAssistantMessageContent::Text(
                                accumulated_text,
                            )),
                            tool_calls: None,
                            ..Default::default()
                        },
                    ));
                }

                messages
            }
        }
    }
}

// 1. the mapping between our types and openai types cringe
// 2. this mapping compresses tools into assistant messages and destroys message order
// 3. anthropic cares about this order and will fail on requests with subsequent assistant messages
type Msg = ChatCompletionRequestMessage;
pub fn order_messages_tool_calls(
    mut messages: Vec<ChatCompletionRequestMessage>,
) -> Vec<ChatCompletionRequestMessage> {
    // look for pattern of [assistant_1, assistant_2, tool]
    // replace with [assistant_2, tool, assistant_1] rotate_left(1)
    let mut i = 0;
    while i + 2 < messages.len() {
        if let (Msg::Assistant(..), Msg::Assistant(..), Msg::Tool(..)) =
            (&messages[i], &messages[i + 1], &messages[i + 2])
        {
            let slice = &mut messages[i..i + 3];
            slice.rotate_left(1);
            i += 3;
        } else {
            i += 1;
        }
    }
    messages
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
                async_openai::types::ChatCompletionRequestSystemMessageContent::Text(text) => {
                    ChatMessageContent::Text(text)
                }
                async_openai::types::ChatCompletionRequestSystemMessageContent::Array(parts) => {
                    let text_parts: Vec<String> = parts.iter().map(|part| {
                        let async_openai::types::ChatCompletionRequestSystemMessageContentPart::Text(text_part) = part;
                        text_part.text.clone()
                    }).collect();
                    ChatMessageContent::Text(text_parts.join(" "))
                }
            },
            image_urls: None,
        },
        ChatCompletionRequestMessage::User(user_msg) => {
            let (content, image_urls) = match user_msg.content {
                ChatCompletionRequestUserMessageContent::Text(text) => {
                    (ChatMessageContent::Text(text), None)
                }
                ChatCompletionRequestUserMessageContent::Array(parts) => {
                    let mut text_parts = Vec::new();
                    let mut images = Vec::new();

                    for part in parts {
                        match part {
                            ChatCompletionRequestUserMessageContentPart::Text(text_part) => {
                                text_parts.push(text_part.text.clone());
                            }
                            ChatCompletionRequestUserMessageContentPart::ImageUrl(image_part) => {
                                images.push(image_part.image_url.url.clone());
                            }
                            ChatCompletionRequestUserMessageContentPart::InputAudio(_) => {
                                // Audio input is not supported in our internal format, skip it
                            }
                        }
                    }

                    let content = ChatMessageContent::Text(text_parts.join(" "));
                    let image_urls = if images.is_empty() {
                        None
                    } else {
                        Some(images)
                    };
                    (content, image_urls)
                }
            };
            ChatMessage {
                role: Role::User,
                content,
                image_urls,
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
                    if let Ok(json_value) = serde_json::from_str(&tool_call.function.arguments) {
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
                image_urls: None,
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

            let response_json = match serde_json::from_str::<serde_json::Value>(&response_text) {
                Ok(json) => json,
                Err(e) => {
                    tracing::error!(
                        err=?e,
                        response_text=%response_text,
                        tool_call_id=%tool_msg.tool_call_id,
                        "Failed to parse tool response as JSON, creating error response"
                    );
                    // Create structured error response instead of empty JSON
                    let error_response = ToolResponseParseError {
                        error: "Invalid JSON response".to_string(),
                        raw_response: response_text,
                        parse_error: e.to_string(),
                    };
                    serde_json::to_value(error_response).unwrap_or(serde_json::Value::Null)
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

            // Check if this is an error response based on the structure
            let assistant_part = if let Some(obj) = response_json.as_object() {
                if obj.get("type").and_then(|v| v.as_str()) == Some("error") {
                    if let Some(description) = obj.get("description").and_then(|v| v.as_str()) {
                        AssistantMessagePart::ToolCallErr {
                            name: tool_name,
                            description: description.to_string(),
                            id: tool_msg.tool_call_id,
                        }
                    } else {
                        AssistantMessagePart::ToolCallResponseJson {
                            name: tool_name,
                            json: response_json,
                            id: tool_msg.tool_call_id,
                        }
                    }
                } else {
                    AssistantMessagePart::ToolCallResponseJson {
                        name: tool_name,
                        json: response_json,
                        id: tool_msg.tool_call_id,
                    }
                }
            } else {
                AssistantMessagePart::ToolCallResponseJson {
                    name: tool_name,
                    json: response_json,
                    id: tool_msg.tool_call_id,
                }
            };

            ChatMessage {
                role: Role::Assistant,
                content: ChatMessageContent::AssistantMessageParts(vec![assistant_part]),
                image_urls: None,
            }
        }
        ChatCompletionRequestMessage::Function(_) => ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::Text(String::new()),
            image_urls: None,
        },
        ChatCompletionRequestMessage::Developer(developer_msg) => ChatMessage {
            role: Role::System,
            content: ChatMessageContent::Text(format!("{:?}", developer_msg.content)),
            image_urls: None,
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

    #[test]
    fn test_system_message_roundtrip() {
        let original = ChatMessage {
            role: Role::System,
            content: ChatMessageContent::Text("You are a helpful assistant.".to_string()),
            image_urls: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();
        let converted_back = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        // assert_eq!(original.role, converted_back.role);
        // assert_eq!(original.content, converted_back.content);
        // assert_eq!(original.image_urls, converted_back.image_urls);
        assert_eq!(original, converted_back);
    }

    #[test]
    fn test_user_text_message_roundtrip() {
        let original = ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text("Hello, how are you?".to_string()),
            image_urls: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();
        let converted_back = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        assert_eq!(original.role, converted_back.role);
        assert_eq!(original.content, converted_back.content);
        assert_eq!(original.image_urls, converted_back.image_urls);
    }

    #[test]
    fn test_user_message_with_images_roundtrip() {
        let original = ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text("What's in this image?".to_string()),
            image_urls: Some(vec!["https://example.com/image.jpg".to_string()]),
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();
        let converted_back = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        assert_eq!(original, converted_back);
    }

    #[test]
    fn test_assistant_text_message_roundtrip() {
        let original = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::Text("I'm doing well, thank you!".to_string()),
            image_urls: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();
        let converted_back = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        assert_eq!(original, converted_back);
    }

    #[test]
    fn test_assistant_with_tool_call_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "get_weather".to_string();
        let original = ChatMessage {
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
            image_urls: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();

        // Create tool call mapping for conversion back
        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted_messages: Vec<ChatMessage> = openai_msgs
            .into_iter()
            .map(|msg| convert_message(msg, Some(&tool_mapping)))
            .collect();

        // Convert back to ChatMessages to merge assistant messages
        let chat_messages = ChatMessages::from(converted_messages);
        let converted_back = &chat_messages.0[0];

        assert_eq!(&original, converted_back);
    }

    #[test]
    fn test_assistant_with_tool_response_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "get_weather".to_string();
        let original = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(vec![
                AssistantMessagePart::ToolCallResponseJson {
                    name: tool_name.clone(),
                    json: json!({"temperature": "72°F", "condition": "sunny"}),
                    id: tool_call_id.clone(),
                },
            ]),
            image_urls: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();

        // Create tool call mapping for conversion back
        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted_back =
            convert_message(openai_msgs.into_iter().next().unwrap(), Some(&tool_mapping));

        assert_eq!(original, converted_back);
    }

    #[test]
    fn test_assistant_with_tool_error_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "get_weather".to_string();
        let original = ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(vec![
                AssistantMessagePart::ToolCallErr {
                    name: tool_name.clone(),
                    description: "<Error message here>".to_string(),
                    id: tool_call_id.clone(),
                },
            ]),
            image_urls: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();

        // Create tool call mapping for conversion back
        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted_back =
            convert_message(openai_msgs.into_iter().next().unwrap(), Some(&tool_mapping));
        println!("original {:#?}", original);
        println!("original {:#?}", converted_back);
        assert_eq!(original, converted_back);
    }

    #[test]
    fn test_complex_assistant_message_roundtrip() {
        let tool_call_id = "call_123".to_string();
        let tool_name = "calculate".to_string();
        let original = ChatMessage {
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
            image_urls: None,
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();

        // Create tool call mapping for conversion back
        let mut tool_mapping = HashMap::new();
        tool_mapping.insert(tool_call_id, tool_name);

        let converted_messages: Vec<ChatMessage> = openai_msgs
            .into_iter()
            .map(|msg| convert_message(msg, Some(&tool_mapping)))
            .collect();

        // Convert back to ChatMessages to merge assistant messages
        let chat_messages = ChatMessages::from(converted_messages);
        let converted_back = &chat_messages.0[0];

        assert_eq!(original.role, converted_back.role);
        assert_eq!(original.content, converted_back.content);
        assert_eq!(original.image_urls, converted_back.image_urls);
    }

    #[test]
    fn test_multiple_images_roundtrip() {
        let original = ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text("Compare these images".to_string()),
            image_urls: Some(vec![
                "https://example.com/image1.jpg".to_string(),
                "https://example.com/image2.jpg".to_string(),
            ]),
        };

        let openai_msgs: Vec<ChatCompletionRequestMessage> = original.clone().into();
        let converted_back = convert_message(openai_msgs.into_iter().next().unwrap(), None);

        assert_eq!(original.role, converted_back.role);
        assert_eq!(original.content, converted_back.content);
        assert_eq!(original.image_urls, converted_back.image_urls);
    }

    #[test]
    fn test_order_messages_tool_calls() {
        use async_openai::types::*;

        let messages = vec![
            ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
                content: Some(ChatCompletionRequestAssistantMessageContent::Text(
                    "First assistant".to_string(),
                )),
                ..Default::default()
            }),
            ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
                content: None,
                tool_calls: Some(vec![ChatCompletionMessageToolCall {
                    id: "call_123".to_string(),
                    function: FunctionCall {
                        name: "test_tool".to_string(),
                        arguments: "{}".to_string(),
                    },
                    r#type: ChatCompletionToolType::Function,
                }]),
                ..Default::default()
            }),
            ChatCompletionRequestMessage::Tool(ChatCompletionRequestToolMessage {
                tool_call_id: "call_123".to_string(),
                content: ChatCompletionRequestToolMessageContent::Text("Tool response".to_string()),
            }),
        ];

        let ordered = order_messages_tool_calls(messages);

        // Should be reordered as: [assistant_with_tool_call, tool_response, text_assistant]
        assert!(matches!(
            ordered[0],
            ChatCompletionRequestMessage::Assistant(_)
        ));
        assert!(matches!(ordered[1], ChatCompletionRequestMessage::Tool(_)));
        assert!(matches!(
            ordered[2],
            ChatCompletionRequestMessage::Assistant(_)
        ));

        if let ChatCompletionRequestMessage::Assistant(ref assistant) = ordered[0] {
            assert!(assistant.tool_calls.is_some());
        }

        if let ChatCompletionRequestMessage::Assistant(ref assistant) = ordered[2] {
            assert!(assistant.content.is_some());
        }
    }
}
