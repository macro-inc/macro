use agent_client_protocol::schema::v1::{
    ContentChunk, SessionId, TextContent, ToolCall as AcpToolCall, ToolCallStatus, ToolCallUpdate,
    ToolCallUpdateFields,
};
use agent_runtime_protocol::domain::schema::v0::AcpMessage;

use super::*;

fn acp_session() -> SessionId {
    SessionId::new("acp-1")
}

/// A logged `session/prompt` request, the shape the harness's deliver path
/// writes.
fn prompt_frame(text: &str) -> Message {
    let request = PromptRequest::new(
        acp_session(),
        vec![ContentBlock::Text(TextContent::new(text))],
    );
    let raw: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": serde_json::to_value(request).expect("a prompt should serialize"),
    }))
    .expect("a request frame should deserialize");
    Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(raw)))
}

/// A logged `session/update` notification, the shape the agent streams.
fn update_frame(update: SessionUpdate) -> Message {
    let notification = SessionNotification::new(acp_session(), update);
    let raw: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": serde_json::to_value(notification).expect("an update should serialize"),
    }))
    .expect("a notification frame should deserialize");
    Message::ToServer(ToServerMessage::Acp(AcpMessage(raw)))
}

fn message_chunk(text: &str) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(
        text,
    ))))
}

#[test]
fn a_logged_turn_replays_as_the_history_the_live_agent_recorded() {
    let history = replay_history(vec![
        prompt_frame("find the roadmap"),
        update_frame(SessionUpdate::AgentThoughtChunk(ContentChunk::new(
            ContentBlock::Text(TextContent::new("hmm")),
        ))),
        update_frame(message_chunk("Hel")),
        update_frame(message_chunk("lo ")),
        update_frame(SessionUpdate::ToolCall(
            AcpToolCall::new("call-1", "NameSearch")
                .status(ToolCallStatus::InProgress)
                .raw_input(serde_json::json!({"query": "roadmap"})),
        )),
        update_frame(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            "call-1",
            ToolCallUpdateFields::new()
                .status(ToolCallStatus::Completed)
                .raw_output(serde_json::json!({"hits": 1})),
        ))),
        update_frame(message_chunk("done")),
        prompt_frame("thanks"),
        update_frame(message_chunk("anytime")),
    ]);

    let [
        HistoryEntry::User(first),
        HistoryEntry::Assistant(first_parts),
        HistoryEntry::User(second),
        HistoryEntry::Assistant(second_parts),
    ] = history.as_slice()
    else {
        panic!("two full turns should replay, got {history:#?}");
    };
    assert_eq!(first, "find the roadmap");
    assert_eq!(second, "thanks");
    assert_eq!(
        second_parts.as_slice(),
        [AssistantMessagePart::Text {
            text: "anytime".to_owned()
        }]
    );

    // Chunks coalesce, the thought is dropped, and the tool call round-trips
    // with its response.
    match first_parts.as_slice() {
        [
            AssistantMessagePart::Text { text },
            AssistantMessagePart::ToolCall { name, id, .. },
            AssistantMessagePart::ToolCallResponseJson {
                json,
                id: response_id,
                ..
            },
            AssistantMessagePart::Text { text: tail },
        ] => {
            assert_eq!(text, "Hello ");
            assert_eq!(name, "NameSearch");
            assert_eq!(id, "call-1");
            assert_eq!(response_id, "call-1");
            assert_eq!(json, &serde_json::json!({"hits": 1}));
            assert_eq!(tail, "done");
        }
        parts => panic!("unexpected first-turn parts: {parts:#?}"),
    }
}

#[test]
fn a_compact_prompt_drops_everything_recorded_before_it() {
    let history = replay_history(vec![
        prompt_frame("remember this"),
        update_frame(message_chunk("noted")),
        prompt_frame("/compact"),
        // The live agent acknowledges compaction outside any turn; the
        // acknowledgement must not replay as conversation.
        update_frame(message_chunk("Compacted.")),
        prompt_frame("after"),
        update_frame(message_chunk("fresh")),
    ]);

    let [HistoryEntry::User(prompt), HistoryEntry::Assistant(parts)] = history.as_slice() else {
        panic!("only the post-compact turn should replay, got {history:#?}");
    };
    assert_eq!(prompt, "after");
    assert_eq!(
        parts.as_slice(),
        [AssistantMessagePart::Text {
            text: "fresh".to_owned()
        }]
    );
}

#[test]
fn a_call_the_log_never_answered_is_closed_rather_than_left_dangling() {
    let history = replay_history(vec![
        prompt_frame("run something"),
        update_frame(SessionUpdate::ToolCall(
            AcpToolCall::new("call-9", "BashCodeExecution").status(ToolCallStatus::InProgress),
        )),
    ]);

    let [HistoryEntry::User(_), HistoryEntry::Assistant(parts)] = history.as_slice() else {
        panic!("the interrupted turn should still replay, got {history:#?}");
    };
    assert!(
        parts.iter().any(|part| matches!(
            part,
            AssistantMessagePart::ToolCallErr { id, description, .. }
                if id == "call-9" && description == "cancelled"
        )),
        "the dangling call must be closed: {parts:#?}"
    );
}

#[test]
fn an_empty_log_replays_to_an_empty_conversation() {
    assert!(replay_history(Vec::new()).is_empty());
}
