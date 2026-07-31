use super::*;
use agent_client_protocol::schema::v1::{ContentChunk, TextContent, ToolCallUpdateFields};

fn text_block(text: &str) -> ContentBlock {
    ContentBlock::Text(TextContent::new(text))
}

#[test]
fn agent_message_chunk_translates_to_text() {
    let update = SessionUpdate::AgentMessageChunk(ContentChunk::new(text_block("hello")));
    assert_eq!(
        translate_session_update(update),
        Some(AssistantMessagePart::Text {
            text: "hello".to_string()
        })
    );
}

#[test]
fn agent_thought_chunk_translates_to_thinking() {
    let update = SessionUpdate::AgentThoughtChunk(ContentChunk::new(text_block("pondering")));
    assert_eq!(
        translate_session_update(update),
        Some(AssistantMessagePart::Thinking {
            thinking: "pondering".to_string()
        })
    );
}

#[test]
fn tool_call_translates_with_raw_input() {
    let tool_call = ToolCall::new("call-1", "Read file").raw_input(serde_json::json!({
        "path": "/tmp/x"
    }));
    let update = SessionUpdate::ToolCall(tool_call);
    assert_eq!(
        translate_session_update(update),
        Some(AssistantMessagePart::ToolCall {
            name: "Read file".to_string(),
            json: serde_json::json!({"path": "/tmp/x"}),
            id: "call-1".to_string(),
        })
    );
}

#[test]
fn completed_tool_call_update_translates_to_response() {
    let update = SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
        "call-1",
        ToolCallUpdateFields::new()
            .status(ToolCallStatus::Completed)
            .title("Read file".to_string())
            .raw_output(serde_json::json!({"ok": true})),
    ));
    assert_eq!(
        translate_session_update(update),
        Some(AssistantMessagePart::ToolCallResponseJson {
            name: "Read file".to_string(),
            json: serde_json::json!({"ok": true}),
            id: "call-1".to_string(),
        })
    );
}

#[test]
fn in_progress_tool_call_update_is_not_persisted() {
    let update = SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
        "call-1",
        ToolCallUpdateFields::new().status(ToolCallStatus::InProgress),
    ));
    assert_eq!(translate_session_update(update), None);
}

#[test]
fn accumulator_merges_consecutive_chunks() {
    let mut accumulator = TurnAccumulator::default();
    accumulator.push(AssistantMessagePart::Thinking {
        thinking: "let me ".to_string(),
    });
    accumulator.push(AssistantMessagePart::Thinking {
        thinking: "think".to_string(),
    });
    accumulator.push(AssistantMessagePart::Text {
        text: "hello ".to_string(),
    });
    accumulator.push(AssistantMessagePart::Text {
        text: "world".to_string(),
    });
    accumulator.push(AssistantMessagePart::ToolCall {
        name: "tool".to_string(),
        json: serde_json::Value::Null,
        id: "1".to_string(),
    });
    accumulator.push(AssistantMessagePart::Text {
        text: "done".to_string(),
    });

    let parts = accumulator.take();
    assert!(accumulator.is_empty());
    assert_eq!(
        parts,
        vec![
            AssistantMessagePart::Thinking {
                thinking: "let me think".to_string()
            },
            AssistantMessagePart::Text {
                text: "hello world".to_string()
            },
            AssistantMessagePart::ToolCall {
                name: "tool".to_string(),
                json: serde_json::Value::Null,
                id: "1".to_string(),
            },
            AssistantMessagePart::Text {
                text: "done".to_string()
            },
        ]
    );
}

#[test]
fn content_blocks_concatenate() {
    let blocks = vec![text_block("a"), text_block("b")];
    assert_eq!(content_blocks_text(&blocks), "ab");
}
