pub (crate) mod message;
mod request;
mod response;
mod error;

#[cfg(test)]
mod test {
    #[test]
    fn test_order_correction() {
        use crate::types::Model;
        use crate::types::providers::openai::message::order_messages_tool_calls;
        use crate::types::{ChatCompletionRequest, ChatMessage, Role, SystemPrompt};
        use async_openai::types::ChatCompletionRequestMessage;

        let system_prompt = SystemPrompt {
            attachments: vec![],
            content: "system message".into(),
        };

        let messages = vec![
            ChatMessage {
                role: Role::User,
                content: crate::types::ChatMessageContent::Text("First user message".to_string()),
                image_urls: None,
            },
            ChatMessage {
                role: Role::User,
                content: crate::types::ChatMessageContent::Text("Second user message".to_string()),
                image_urls: None,
            },
        ];

        let request = ChatCompletionRequest {
            system_prompt,
            messages,
            model: Model::OpenAIGPT4o,
        };

        let openai_messages = request.openai_messages();
        let ordered_messages = order_messages_tool_calls(openai_messages[1..].to_vec());

        assert_eq!(ordered_messages.len(), 2);

        if let ChatCompletionRequestMessage::User(user_msg) = &ordered_messages[0] {
            let content_str = match &user_msg.content {
                async_openai::types::ChatCompletionRequestUserMessageContent::Text(text) => text,
                _ => panic!("Expected text content"),
            };
            assert!(content_str.contains("First user message"));
        } else {
            panic!("Expected user message");
        }

        if let ChatCompletionRequestMessage::User(user_msg) = &ordered_messages[1] {
            let content_str = match &user_msg.content {
                async_openai::types::ChatCompletionRequestUserMessageContent::Text(text) => text,
                _ => panic!("Expected text content"),
            };
            assert!(content_str.contains("Second user message"));
        } else {
            panic!("Expected user message");
        }
    }
}
