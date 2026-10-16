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
/// writes. Its text doubles as its request id, so every prompt in a test
/// has an id of its own.
fn prompt_frame(text: &str) -> Message {
    let request = PromptRequest::new(
        acp_session(),
        vec![ContentBlock::Text(TextContent::new(text))],
    );
    let raw: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "id": text,
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
        "id": text,
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

/// The agent's answer to `prompt`, ending its turn with `stop_reason`.
fn answer(prompt: &str, stop_reason: &str) -> Message {
    Message::ToServer(ToServerMessage::Acp(AcpMessage(
        serde_json::from_value(serde_json::json!({
            "jsonrpc": "2.0", "id": prompt, "result": {"stopReason": stop_reason}
        }))
        .expect("a response frame should deserialize"),
    )))
}

/// The agent refusing `prompt` before running it.
fn refusal(prompt: &str) -> Message {
    Message::ToServer(ToServerMessage::Acp(AcpMessage(
        serde_json::from_value(serde_json::json!({
            "jsonrpc": "2.0", "id": prompt, "error": {"code": -32602, "message": "too long"}
        }))
        .expect("an error frame should deserialize"),
    )))
}

fn notification_frame(method: &str, params: serde_json::Value) -> Message {
    let raw: RawJsonRpcMessage = serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    }))
    .expect("a notification frame should deserialize");
    Message::ToServer(ToServerMessage::Acp(AcpMessage(raw)))
}

/// The record the live agent logs when a summary lands: the summary, the
/// prompt of the last turn it covers, and how many live entries that was.
fn summary_frame(text: &str, through: &str, replaces: usize) -> Message {
    notification_frame(
        "_macro/context_summary",
        serde_json::json!({
            "sessionId": "acp-1", "text": text, "through": through, "replaces": replaces
        }),
    )
}

/// The record as the agent logged it before summaries named their last
/// turn: a count of live entries alone.
fn counted_summary_frame(text: &str, replaces: usize) -> Message {
    notification_frame(
        "_macro/context_summary",
        serde_json::json!({"sessionId": "acp-1", "text": text, "replaces": replaces}),
    )
}

/// One answered turn: its prompt, the reply, and the response closing it.
fn turn(prompt: &str, reply: &str) -> Vec<Message> {
    vec![
        prompt_frame(prompt),
        update_frame(message_chunk(reply)),
        answer(prompt, "end_turn"),
    ]
}

/// The prompts of `entries`, a summary as `[summary]`.
fn said(entries: &[HistoryEntry]) -> Vec<String> {
    entries
        .iter()
        .filter_map(|entry| match entry {
            HistoryEntry::User { prompt, .. } => Some(prompt.text.clone()),
            HistoryEntry::Summary(text) => Some(format!("[{text}]")),
            HistoryEntry::Assistant(_) => None,
        })
        .collect()
}

/// Every entry of `entries`: a prompt as its text, a reply as `> ` and what
/// it says, a summary as `[summary]`.
fn shown(entries: &[HistoryEntry]) -> Vec<String> {
    entries
        .iter()
        .map(|entry| match entry {
            HistoryEntry::User { prompt, .. } => prompt.text.clone(),
            HistoryEntry::Summary(text) => format!("[{text}]"),
            HistoryEntry::Assistant(parts) => {
                let said: Vec<&str> = parts
                    .iter()
                    .map(|part| match part {
                        AssistantMessagePart::Text { text } => text.as_str(),
                        AssistantMessagePart::Thinking { .. } => "(thinking)",
                        _ => "(tool)",
                    })
                    .collect();
                format!("> {}", said.join(" "))
            }
        })
        .collect()
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
        HistoryEntry::User {
            prompt: first,
            request_id: first_id,
        },
        HistoryEntry::Assistant(first_parts),
        HistoryEntry::User { prompt: second, .. },
        HistoryEntry::Assistant(second_parts),
    ] = history.as_slice()
    else {
        panic!("two full turns should replay, got {history:#?}");
    };
    assert_eq!(first.text, "find the roadmap");
    assert_eq!(
        first_id,
        &RequestId::Str("find the roadmap".to_owned()),
        "a turn keeps the id of the request that opened it"
    );
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
fn a_compact_that_cleared_the_context_before_summaries_still_clears_it() {
    let history = replay_history(vec![
        prompt_frame("remember this"),
        update_frame(message_chunk("noted")),
        answer("remember this", "end_turn"),
        prompt_frame("/compact"),
        update_frame(message_chunk(
            "Compacted: the earlier conversation is no longer in the model's context.",
        )),
        answer("/compact", "end_turn"),
        prompt_frame("after"),
        update_frame(message_chunk("fresh")),
    ]);

    let [
        HistoryEntry::User { prompt, .. },
        HistoryEntry::Assistant(parts),
    ] = history.as_slice()
    else {
        panic!("only the turn after the clear should replay, got {history:#?}");
    };
    assert_eq!(prompt.text, "after");
    assert_eq!(
        parts.as_slice(),
        [AssistantMessagePart::Text {
            text: "fresh".to_owned()
        }]
    );
}

#[test]
fn a_compact_sent_since_is_a_message_like_any_other() {
    let frames = [
        turn("remember this", "noted"),
        turn("/compact", "There is no /compact here; what should I do?"),
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(said(&history), ["remember this", "/compact"]);
}

#[test]
fn a_compact_prompt_carrying_a_file_replays_as_an_ordinary_turn() {
    // Even before summaries, a `/compact` with files was a prompt about
    // them, and the live agent kept the conversation.
    let history = replay_history(vec![
        prompt_frame("remember this"),
        update_frame(message_chunk("noted")),
        prompt_frame_with_file("/compact", "notes.txt", "https://static.example/file/9"),
        update_frame(message_chunk("read it")),
    ]);

    let [
        HistoryEntry::User { prompt: first, .. },
        HistoryEntry::Assistant(_),
        HistoryEntry::User { prompt: second, .. },
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

    let [HistoryEntry::User { .. }, HistoryEntry::Assistant(parts)] = history.as_slice() else {
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
    let history = replay_history(Vec::new());
    assert!(history.is_empty());
}

#[test]
fn a_logged_summary_replaces_what_it_covered() {
    let frames = [
        turn("plan the launch", "drafted"),
        turn("add pricing", "added"),
        vec![
            prompt_frame("and the FAQ?"),
            // The summary started before this turn and landed during it,
            // covering the first turn.
            summary_frame("Planned the launch.", "plan the launch", 2),
            update_frame(message_chunk("FAQ added")),
            answer("and the FAQ?", "end_turn"),
        ],
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(
        said(&history),
        ["[Planned the launch.]", "add pricing", "and the FAQ?"]
    );
}

#[test]
fn a_summary_landing_between_turns_keeps_the_turns_after_what_it_covered() {
    let frames = [
        turn("one", "1"),
        turn("two", "2"),
        turn("three", "3"),
        vec![summary_frame("One and two happened.", "two", 4)],
        turn("four", "4"),
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(said(&history), ["[One and two happened.]", "three", "four"]);
}

#[test]
fn a_later_summary_takes_in_the_earlier_one() {
    let frames = [
        turn("one", "1"),
        turn("two", "2"),
        vec![summary_frame("One happened.", "one", 2)],
        turn("three", "3"),
        // The earlier summary and turn two.
        vec![summary_frame("One and two happened.", "two", 3)],
        turn("four", "4"),
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(said(&history), ["[One and two happened.]", "three", "four"]);
}

#[test]
fn a_prompt_the_agent_refused_never_entered_the_conversation() {
    let frames = [
        turn("first", "ok"),
        vec![prompt_frame("far too long"), refusal("far too long")],
        turn("second", "ok"),
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(said(&history), ["first", "second"]);
}

// Each of the next three logs a turn the live agent kept differently from
// how replay rebuilds it, ahead of where a summary ends. The live history
// the summary counted `replaces` in is in each test's comment; going by
// that count would cut the rebuilt history in the wrong place.

#[test]
fn a_prompt_stopped_before_it_ran_does_not_move_where_a_summary_ends() {
    // Live: one, 1, two, 2, three, 3, four, 4. A stop reached "waited"
    // while it queued, so it never entered the live history; the log still
    // holds it, answered as cancelled.
    let frames = [
        turn("one", "1"),
        turn("two", "2"),
        vec![prompt_frame("waited"), answer("waited", "cancelled")],
        turn("three", "3"),
        vec![
            prompt_frame("four"),
            summary_frame("Up to three.", "three", 6),
        ],
        vec![update_frame(message_chunk("4")), answer("four", "end_turn")],
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(shown(&history), ["[Up to three.]", "four", "> 4"]);
}

#[test]
fn a_turn_that_failed_before_any_output_does_not_move_where_a_summary_ends() {
    // Live: one, 1, two, three, 3, four. Turn two failed before the model
    // said anything, so the live agent kept its prompt alone; the log holds
    // the error the agent told the user, which replays as a reply.
    let frames = [
        turn("one", "1"),
        vec![
            prompt_frame("two"),
            update_frame(message_chunk("The agent stopped on an error: overloaded")),
            answer("two", "end_turn"),
        ],
        turn("three", "3"),
        vec![
            prompt_frame("four"),
            summary_frame("Up to three.", "three", 5),
        ],
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(shown(&history), ["[Up to three.]", "four"]);
}

#[test]
fn a_turn_that_only_reasoned_does_not_move_where_a_summary_ends() {
    // Live: one, 1, two, (reasoning), three, 3. Replay leaves reasoning
    // out, so turn two has no reply here, and counting four entries would
    // take in the message that followed the summary's last turn.
    let frames = [
        turn("one", "1"),
        vec![
            prompt_frame("two"),
            update_frame(SessionUpdate::AgentThoughtChunk(ContentChunk::new(
                ContentBlock::Text(TextContent::new("weighing it")),
            ))),
            answer("two", "end_turn"),
        ],
        turn("three", "3"),
        vec![summary_frame("Up to two.", "two", 4)],
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(shown(&history), ["[Up to two.]", "three", "> 3"]);
}

#[test]
fn a_summary_logged_before_summaries_named_their_last_turn_replaces_what_it_counted() {
    let frames = [
        turn("one", "1"),
        turn("two", "2"),
        vec![counted_summary_frame("One happened.", 2)],
        turn("three", "3"),
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(said(&history), ["[One happened.]", "two", "three"]);
}

#[test]
fn a_summary_naming_a_turn_the_log_does_not_hold_is_left_out() {
    let frames = [
        turn("one", "1"),
        vec![summary_frame("Something else.", "elsewhere", 2)],
        turn("two", "2"),
    ]
    .concat();

    let history = replay_history(frames);
    assert_eq!(said(&history), ["one", "two"]);
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
