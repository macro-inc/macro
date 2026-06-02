use super::*;
use attachment::image::ImageData;
use attachment::{AttachmentContent, AttachmentPart, Attachments};
use model_entity::EntityType;
use non_empty::NonEmpty;
use rig_core::message::{AssistantContent, DocumentSourceKind, Message, UserContent};
use serde_json::json;

/// A minimal valid 1x1 PNG, used to exercise the image-normalization path.
#[rustfmt::skip]
const ONE_BY_ONE_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
    0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

/// Build a user message carrying a single resolved attachment made of `parts`.
fn user_msg_with_attachment(text: &str, parts: Vec<AttachmentPart<'static>>) -> ChatMessage {
    let content = AttachmentContent {
        reference: EntityType::StaticFile.with_entity_string(String::new()),
        name: None,
        content: NonEmpty::new(parts).expect("at least one part"),
    };
    let attachments = Attachments::new(NonEmpty::one(Ok(content)));
    ChatMessage {
        role: Role::User,
        content: ChatMessageContent::Text(text.to_owned()),
        attachments: Some(attachments),
    }
}

fn user_msg(text: &str) -> ChatMessage {
    ChatMessage {
        role: Role::User,
        content: ChatMessageContent::Text(text.to_owned()),
        attachments: None,
    }
}

fn assistant_text(text: &str) -> ChatMessage {
    ChatMessage {
        role: Role::Assistant,
        content: ChatMessageContent::Text(text.to_owned()),
        attachments: None,
    }
}

fn system_msg(text: &str) -> ChatMessage {
    ChatMessage {
        role: Role::System,
        content: ChatMessageContent::Text(text.to_owned()),
        attachments: None,
    }
}

fn assistant_parts(parts: Vec<AssistantMessagePart>) -> ChatMessage {
    ChatMessage {
        role: Role::Assistant,
        content: ChatMessageContent::AssistantMessageParts(parts),
        attachments: None,
    }
}

#[test]
fn user_message_converts_to_rig_user() {
    let messages = to_rig_messages(&[user_msg("hello")]);
    assert_eq!(messages.len(), 1);
    assert!(matches!(&messages[0], Message::User { .. }));
    let Message::User { content } = &messages[0] else {
        panic!("expected user message");
    };
    let UserContent::Text(text) = content.first() else {
        panic!("expected text content");
    };
    assert_eq!(text.text, "hello");
}

#[test]
fn assistant_text_converts_to_rig_assistant() {
    let messages = to_rig_messages(&[assistant_text("hi back")]);
    assert_eq!(messages.len(), 1);
    assert!(matches!(&messages[0], Message::Assistant { .. }));
}

#[test]
fn system_messages_are_skipped() {
    let messages = to_rig_messages(&[system_msg("you are helpful"), user_msg("hi")]);
    assert_eq!(messages.len(), 1);
    assert!(matches!(&messages[0], Message::User { .. }));
}

#[test]
fn empty_input_produces_empty_output() {
    let messages = to_rig_messages(&[]);
    assert!(messages.is_empty());
}

#[test]
fn multi_turn_conversation() {
    let messages = to_rig_messages(&[
        user_msg("what is 2+2?"),
        assistant_text("4"),
        user_msg("thanks"),
    ]);
    assert_eq!(messages.len(), 3);
    assert!(matches!(&messages[0], Message::User { .. }));
    assert!(matches!(&messages[1], Message::Assistant { .. }));
    assert!(matches!(&messages[2], Message::User { .. }));
}

#[test]
fn tool_call_produces_assistant_with_tool_use() {
    let msg = assistant_parts(vec![AssistantMessagePart::ToolCall {
        name: "search".to_owned(),
        json: json!({"query": "test"}),
        id: "call_1".to_owned(),
    }]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 1);
    let Message::Assistant { content, .. } = &messages[0] else {
        panic!("expected assistant message");
    };
    assert!(matches!(content.first(), AssistantContent::ToolCall(_)));
}

#[test]
fn tool_call_with_response_splits_into_two_messages() {
    let msg = assistant_parts(vec![
        AssistantMessagePart::ToolCall {
            name: "search".to_owned(),
            json: json!({"query": "test"}),
            id: "call_1".to_owned(),
        },
        AssistantMessagePart::ToolCallResponseJson {
            name: "search".to_owned(),
            json: json!({"results": []}),
            id: "call_1".to_owned(),
        },
    ]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 2);
    assert!(matches!(&messages[0], Message::Assistant { .. }));
    assert!(matches!(&messages[1], Message::User { .. }));

    let Message::User { content } = &messages[1] else {
        panic!("expected user message with tool result");
    };
    assert!(matches!(content.first(), UserContent::ToolResult(_)));
}

#[test]
fn multiple_tool_calls_with_responses_stay_grouped() {
    let msg = assistant_parts(vec![
        AssistantMessagePart::ToolCall {
            name: "search".to_owned(),
            json: json!({"query": "a"}),
            id: "call_1".to_owned(),
        },
        AssistantMessagePart::ToolCall {
            name: "read".to_owned(),
            json: json!({"id": "doc_1"}),
            id: "call_2".to_owned(),
        },
        AssistantMessagePart::ToolCallResponseJson {
            name: "search".to_owned(),
            json: json!({"results": ["x"]}),
            id: "call_1".to_owned(),
        },
        AssistantMessagePart::ToolCallResponseJson {
            name: "read".to_owned(),
            json: json!({"content": "hello"}),
            id: "call_2".to_owned(),
        },
    ]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 2, "should be one assistant + one user");

    let Message::Assistant { content, .. } = &messages[0] else {
        panic!("expected assistant");
    };
    assert_eq!(content.len(), 2, "two tool calls in assistant message");

    let Message::User { content } = &messages[1] else {
        panic!("expected user");
    };
    assert_eq!(content.len(), 2, "two tool results in user message");
}

#[test]
fn tool_call_error_becomes_tool_result() {
    let msg = assistant_parts(vec![
        AssistantMessagePart::ToolCall {
            name: "delete".to_owned(),
            json: json!({"id": "x"}),
            id: "call_1".to_owned(),
        },
        AssistantMessagePart::ToolCallErr {
            name: "delete".to_owned(),
            description: "permission denied".to_owned(),
            id: "call_1".to_owned(),
        },
    ]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 2);

    let Message::User { content } = &messages[1] else {
        panic!("expected user message with tool result");
    };
    let UserContent::ToolResult(result) = content.first() else {
        panic!("expected tool result");
    };
    assert_eq!(result.id, "call_1");
}

#[test]
fn mcp_tool_call_converts_like_regular_tool_call() {
    let msg = assistant_parts(vec![AssistantMessagePart::McpToolCall {
        name: "slack_search".to_owned(),
        service: "slack".to_owned(),
        display_name: Some("Search Slack".to_owned()),
        json: json!({"query": "standup"}),
        id: "call_mcp".to_owned(),
    }]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 1);

    let Message::Assistant { content, .. } = &messages[0] else {
        panic!("expected assistant");
    };
    let AssistantContent::ToolCall(tc) = content.first() else {
        panic!("expected tool call");
    };
    assert_eq!(tc.function.name, "slack_search");
}

#[test]
fn adjacent_text_parts_are_merged() {
    let msg = assistant_parts(vec![
        AssistantMessagePart::Text {
            text: "I'll dem".to_owned(),
        },
        AssistantMessagePart::Text {
            text: "o a few tools.".to_owned(),
        },
        AssistantMessagePart::Text {
            text: " Here we go.".to_owned(),
        },
    ]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 1);

    let Message::Assistant { content, .. } = &messages[0] else {
        panic!("expected assistant");
    };
    assert_eq!(content.len(), 1);
    let AssistantContent::Text(text) = content.first() else {
        panic!("expected text");
    };
    assert_eq!(text.text, "I'll demo a few tools. Here we go.");
}

#[test]
fn text_after_tool_calls_splits_into_new_assistant_message() {
    let msg = assistant_parts(vec![
        AssistantMessagePart::Text {
            text: "Let me ".to_owned(),
        },
        AssistantMessagePart::Text {
            text: "search.".to_owned(),
        },
        AssistantMessagePart::ToolCall {
            name: "search".to_owned(),
            json: json!({"q": "x"}),
            id: "c1".to_owned(),
        },
        AssistantMessagePart::Text {
            text: "Found ".to_owned(),
        },
        AssistantMessagePart::Text {
            text: "results.".to_owned(),
        },
    ]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(
        messages.len(),
        2,
        "first assistant (text+tool), second assistant (text)"
    );

    let Message::Assistant { content, .. } = &messages[0] else {
        panic!("expected first assistant");
    };
    assert_eq!(content.len(), 2, "merged text + tool call");

    let Message::Assistant { content, .. } = &messages[1] else {
        panic!("expected second assistant");
    };
    assert_eq!(content.len(), 1);
    let AssistantContent::Text(text) = content.first() else {
        panic!("expected text");
    };
    assert_eq!(text.text, "Found results.");
}

#[test]
fn text_and_tool_calls_coexist_in_assistant_message() {
    let msg = assistant_parts(vec![
        AssistantMessagePart::Text {
            text: "Let me search for that.".to_owned(),
        },
        AssistantMessagePart::ToolCall {
            name: "search".to_owned(),
            json: json!({"q": "foo"}),
            id: "call_1".to_owned(),
        },
    ]);
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 1);

    let Message::Assistant { content, .. } = &messages[0] else {
        panic!("expected assistant");
    };
    assert_eq!(content.len(), 2);
    assert!(matches!(
        &content.iter().next().unwrap(),
        AssistantContent::Text(_)
    ));
}

#[test]
fn full_conversation_with_tool_round_trip() {
    let messages = to_rig_messages(&[
        user_msg("search for cats"),
        assistant_parts(vec![
            AssistantMessagePart::Text {
                text: "Searching...".to_owned(),
            },
            AssistantMessagePart::ToolCall {
                name: "search".to_owned(),
                json: json!({"query": "cats"}),
                id: "c1".to_owned(),
            },
            AssistantMessagePart::ToolCallResponseJson {
                name: "search".to_owned(),
                json: json!({"results": ["cat1", "cat2"]}),
                id: "c1".to_owned(),
            },
            AssistantMessagePart::Text {
                text: "Found 2 cats.".to_owned(),
            },
        ]),
        user_msg("tell me more about cat1"),
    ]);

    // The flattened assistant message splits into 3 messages:
    // assistant(text + tool_call), user(tool_result), assistant(text)
    assert_eq!(messages.len(), 5);
    assert!(matches!(&messages[0], Message::User { .. }));
    assert!(matches!(&messages[1], Message::Assistant { .. }));
    assert!(matches!(&messages[2], Message::User { .. }));
    assert!(matches!(&messages[3], Message::Assistant { .. }));
    assert!(matches!(&messages[4], Message::User { .. }));

    let Message::User { content } = &messages[2] else {
        panic!("expected tool result user message");
    };
    assert!(matches!(content.first(), UserContent::ToolResult(_)));

    let Message::Assistant { content, .. } = &messages[3] else {
        panic!("expected second assistant message");
    };
    let AssistantContent::Text(text) = content.first() else {
        panic!("expected text");
    };
    assert_eq!(text.text, "Found 2 cats.");
}

#[test]
fn user_message_with_image_url_attachment_includes_image_content() {
    let msg = user_msg_with_attachment(
        "what is in this image?",
        vec![AttachmentPart::Image(ImageData::StaticUrl(
            "https://example.com/cat.png".to_owned(),
        ))],
    );
    let messages = to_rig_messages(&[msg]);
    assert_eq!(messages.len(), 1);

    let Message::User { content } = &messages[0] else {
        panic!("expected user message");
    };
    // text block + image block
    assert_eq!(content.len(), 2);

    let mut iter = content.iter();
    let UserContent::Text(text) = iter.next().unwrap() else {
        panic!("expected leading text");
    };
    assert_eq!(text.text, "what is in this image?");

    let UserContent::Image(image) = iter.next().unwrap() else {
        panic!("expected image content");
    };
    assert!(matches!(
        &image.data,
        DocumentSourceKind::Url(url) if url == "https://example.com/cat.png"
    ));
}

#[test]
fn user_message_with_base64_image_is_sent_as_webp() {
    // A non-WebP source is normalized to a downscaled WebP, so the model
    // always receives base64 WebP content.
    let image = ImageData::try_from_bytes(ONE_BY_ONE_PNG.to_vec()).expect("valid image");
    assert!(matches!(image, ImageData::Base64(_)));

    let msg = user_msg_with_attachment("look", vec![AttachmentPart::Image(image)]);
    let messages = to_rig_messages(&[msg]);

    let Message::User { content } = &messages[0] else {
        panic!("expected user message");
    };
    let UserContent::Image(image) = content.iter().nth(1).unwrap() else {
        panic!("expected image content");
    };
    assert_eq!(image.media_type, Some(ImageMediaType::WEBP));
    let DocumentSourceKind::Base64(data) = &image.data else {
        panic!("expected base64 image data");
    };
    assert!(!data.is_empty(), "base64 payload should not be empty");
}

#[test]
fn user_message_with_text_attachment_appends_text_block() {
    let msg = user_msg_with_attachment(
        "summarize",
        vec![AttachmentPart::Content("attached document body".to_owned())],
    );
    let messages = to_rig_messages(&[msg]);

    let Message::User { content } = &messages[0] else {
        panic!("expected user message");
    };
    assert_eq!(content.len(), 2);
    let UserContent::Text(text) = content.iter().nth(1).unwrap() else {
        panic!("expected attachment text");
    };
    assert_eq!(text.text, "attached document body");
}

#[test]
fn user_message_with_only_attachment_and_empty_text_omits_text_block() {
    let mut msg = user_msg_with_attachment(
        "",
        vec![AttachmentPart::Image(ImageData::StaticUrl(
            "https://example.com/x.png".to_owned(),
        ))],
    );
    msg.content = ChatMessageContent::Text(String::new());

    let messages = to_rig_messages(&[msg]);
    let Message::User { content } = &messages[0] else {
        panic!("expected user message");
    };
    assert_eq!(content.len(), 1);
    assert!(matches!(content.first(), UserContent::Image(_)));
}

mod merge_consecutive_parts_tests {
    use super::*;

    fn part_text(s: &str) -> AssistantMessagePart {
        AssistantMessagePart::Text { text: s.into() }
    }
    fn part_thinking(s: &str) -> AssistantMessagePart {
        AssistantMessagePart::Thinking { thinking: s.into() }
    }
    fn part_call(id: &str) -> AssistantMessagePart {
        AssistantMessagePart::ToolCall {
            name: "t".into(),
            json: json!({}),
            id: id.into(),
        }
    }

    #[test]
    fn merges_consecutive_text() {
        let parts = vec![part_text("a"), part_text("b"), part_text("c")];
        assert_eq!(merge_consecutive_parts(parts), vec![part_text("abc")]);
    }

    #[test]
    fn merges_consecutive_thinking() {
        let parts = vec![part_thinking("a"), part_thinking("b")];
        assert_eq!(merge_consecutive_parts(parts), vec![part_thinking("ab")]);
    }

    #[test]
    fn does_not_merge_across_different_types() {
        let parts = vec![part_text("a"), part_call("1"), part_text("b")];
        assert_eq!(merge_consecutive_parts(parts.clone()), parts);
    }

    #[test]
    fn thinking_then_text_stays_separate() {
        let parts = vec![part_thinking("t"), part_text("a")];
        assert_eq!(merge_consecutive_parts(parts.clone()), parts);
    }

    #[test]
    fn empty_input() {
        assert!(merge_consecutive_parts(vec![]).is_empty());
    }
}
