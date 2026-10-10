use agent_client_protocol::schema::v1::{
    ContentChunk, ResourceLink, SessionConfigValueId, SessionId, SetSessionConfigOptionRequest,
    TextContent, ToolCall as AcpToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields,
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
    notification_frame(notification)
}

fn notification_frame(notification: SessionNotification) -> Message {
    let raw: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": serde_json::to_value(notification).expect("an update should serialize"),
    }))
    .expect("a notification frame should deserialize");
    Message::ToServer(ToServerMessage::Acp(AcpMessage(raw)))
}

/// The notification the live agent sends once it has summarized: the
/// summary, and the recent entries it kept whole.
fn checkpoint_frame(text: &str, retained: Vec<HistoryEntry>) -> Message {
    let mut meta = agent_client_protocol::schema::v1::Meta::new();
    meta.insert(
        "macro".to_owned(),
        serde_json::json!({
            "contextSummary": {"text": text, "retained": retained}
        }),
    );
    notification_frame(SessionNotification::new(acp_session(), message_chunk("")).meta(meta))
}

fn kept_turn(prompt: &str, answer: &str) -> Vec<HistoryEntry> {
    vec![
        HistoryEntry::User(UserPrompt::text(prompt)),
        HistoryEntry::Assistant(vec![AssistantMessagePart::Text {
            text: answer.to_owned(),
        }]),
    ]
}

#[test]
fn a_saved_summary_restores_recent_turns_and_the_prompt_that_triggered_compaction() {
    let history = replay_history(vec![
        prompt_frame("Email the report"),
        update_frame(message_chunk("Sent")),
        prompt_frame("Use concise replies"),
        update_frame(message_chunk("Understood")),
        prompt_frame("What next?"),
        checkpoint_frame(
            "The report was already emailed.",
            kept_turn("Use concise replies", "Understood"),
        ),
        update_frame(message_chunk("Review the result")),
    ]);
    let messages =
        crate::domain::session::messages_for_turn(&history, &UserPrompt::text("continue"));
    let texts: Vec<_> = messages
        .iter()
        .map(|message| message.content.message_text())
        .collect();
    assert_eq!(
        &texts[1..],
        [
            "The report was already emailed.",
            "Use concise replies",
            "Understood",
            "What next?",
            "Review the result",
            "continue"
        ]
    );
}

/// A logged `session/prompt` whose text is followed by one file link.
fn prompt_frame_with_file(text: &str, name: &str, uri: &str) -> Message {
    let request = PromptRequest::new(
        acp_session(),
        vec![
            ContentBlock::Text(TextContent::new(text)),
            ContentBlock::ResourceLink(ResourceLink::new(name, uri)),
        ],
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

fn config_frame(config_id: &str, value: &str) -> Message {
    let request = SetSessionConfigOptionRequest::new(
        acp_session(),
        config_id.to_owned(),
        SessionConfigValueId::new(value.to_owned()),
    );
    let raw: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "session/set_config_option",
        "params": serde_json::to_value(request).expect("a config change should serialize"),
    }))
    .expect("a request frame should deserialize");
    Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(raw)))
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
    assert_eq!(first.text, "find the roadmap");
    assert_eq!(second.text, "thanks");
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
fn a_compact_request_without_a_saved_summary_preserves_history() {
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

    let [
        HistoryEntry::User(before),
        _,
        HistoryEntry::User(prompt),
        HistoryEntry::Assistant(parts),
    ] = history.as_slice()
    else {
        panic!("the full conversation should replay, got {history:#?}");
    };
    assert_eq!(before.text, "remember this");
    assert_eq!(prompt.text, "after");
    assert_eq!(
        parts.as_slice(),
        [AssistantMessagePart::Text {
            text: "fresh".to_owned()
        }]
    );
}

#[test]
fn a_compact_prompt_carrying_a_file_replays_as_an_ordinary_turn() {
    // Serving the turn kept the conversation (the files make it a real
    // prompt), so a cold attach must rebuild it the same way - replaying it
    // as compaction would drop context the live session still had.
    let history = replay_history(vec![
        prompt_frame("remember this"),
        update_frame(message_chunk("noted")),
        prompt_frame_with_file("/compact", "notes.txt", "https://static.example/file/9"),
        update_frame(message_chunk("read it")),
    ]);

    let [
        HistoryEntry::User(first),
        HistoryEntry::Assistant(_),
        HistoryEntry::User(second),
        HistoryEntry::Assistant(_),
    ] = history.as_slice()
    else {
        panic!("both turns should replay, got {history:#?}");
    };
    assert_eq!(first.text, "remember this");
    assert_eq!(second.text, "/compact");
    assert_eq!(second.attachments.len(), 1);
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

fn config_response(result: serde_json::Value) -> Message {
    Message::ToServer(ToServerMessage::Acp(AcpMessage(
        serde_json::from_value(serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "result": result
        }))
        .unwrap(),
    )))
}

#[test]
fn only_confirmed_effort_replays_and_removal_resets_it() {
    let mut frames = vec![config_frame(REASONING_EFFORT_CONFIG_ID, "low")];
    assert_eq!(replay_reasoning_effort(&frames), ReasoningEffort::Default);
    let options = crate::domain::model_options::session_config_options(
        "anthropic/claude-sonnet-5-5",
        &["anthropic/claude-sonnet-5-5"],
        ReasoningEffort::Low,
        agent::ModelSpeed::Standard,
    );
    frames.push(config_response(
        serde_json::json!({ "configOptions": options }),
    ));
    frames.push(config_frame(REASONING_EFFORT_CONFIG_ID, "medium"));
    frames.push(Message::ToServer(ToServerMessage::Acp(AcpMessage(
        serde_json::from_value(serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "error": { "code": -32602, "message": "unsupported" }
        }))
        .unwrap(),
    ))));
    assert_eq!(replay_reasoning_effort(&frames), ReasoningEffort::Low);
    frames.push(config_frame("model", "other-model"));
    frames.push(config_response(serde_json::json!({ "configOptions": [] })));
    assert_eq!(replay_reasoning_effort(&frames), ReasoningEffort::Default);
}

#[test]
fn speed_replays_only_from_confirmed_configuration() {
    use agent::ModelSpeed;
    let mut frames = vec![config_frame("speed", "ultrafast")];
    assert_eq!(replay_speed(&frames), ModelSpeed::Standard);
    let options = crate::domain::model_options::session_config_options(
        "openai/gpt-6-astra",
        &["openai/gpt-6-astra"],
        ReasoningEffort::Default,
        ModelSpeed::Ultrafast,
    );
    frames.push(config_response(
        serde_json::json!({"configOptions":options}),
    ));
    assert_eq!(replay_speed(&frames), ModelSpeed::Ultrafast);
    frames.push(config_frame("model", "other-model"));
    frames.push(config_response(serde_json::json!({"configOptions":[]})));
    assert_eq!(replay_speed(&frames), ModelSpeed::Standard);
}

/// A prompt that failed before it ran is in the log but was never part of
/// the live conversation; the summary keeps what the live agent kept.
#[test]
fn a_saved_summary_keeps_the_live_window_around_a_prompt_that_never_ran() {
    let history = replay_history(vec![
        prompt_frame("Email the report"),
        update_frame(message_chunk("Sent")),
        prompt_frame("Use concise replies"),
        update_frame(message_chunk("Understood")),
        prompt_frame("A message far too long to run"),
        prompt_frame("What next?"),
        checkpoint_frame(
            "The report was already emailed.",
            kept_turn("Use concise replies", "Understood"),
        ),
        update_frame(message_chunk("Review the result")),
    ]);
    let messages =
        crate::domain::session::messages_for_turn(&history, &UserPrompt::text("continue"));
    let texts: Vec<_> = messages
        .iter()
        .map(|message| message.content.message_text())
        .collect();
    assert_eq!(
        &texts[1..],
        [
            "The report was already emailed.",
            "Use concise replies",
            "Understood",
            "What next?",
            "Review the result",
            "continue"
        ]
    );
}
