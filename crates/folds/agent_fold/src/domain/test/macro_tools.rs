//! Macro tools reached over MCP, and the user tools among them, fold to
//! their own details with the MCP envelope removed.

use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::harness::{self, ToolShape, macro_tools, mcp};
use crate::domain::model::{
    ActivityCard, CardAction, CardItemType, Harness, MessagePart, SubagentResult, ToolDetail,
    ToolName, ToolStatus, UserToolOutcome, segments,
};
use crate::domain::ports::FoldMachine;
use crate::domain::test::util::Frame;
use crate::testing::fixtures::MACRO_MCP;
use crate::testing::parse_log;
use agent_client_protocol::schema::v1::ToolKind;
use serde_json::{Value, json};

#[test]
fn code_activity_survives_native_and_mcp_json_output() {
    let receipt = json!({
        "executionId": "019a0000-0000-7000-8000-000000000001",
        "status": "succeeded",
        "activity": [{"id": 1, "label": "Search documents", "status": "completed"}]
    });
    for (namespace, output) in [
        ("macro", receipt.clone()),
        (
            "claudeCode",
            json!([{"type": "text", "text": receipt.to_string()}]),
        ),
    ] {
        let frames = [
            json!({"direction": "to_runtime", "content": {
                "type": "acp", "jsonrpc": "2.0", "id": "prompt-1", "method": "session/prompt",
                "params": {"sessionId": "s1", "prompt": [{"type": "text", "text": "Find documents"}]}
            }}),
            json!({"direction": "to_server", "content": {
                "type": "acp", "jsonrpc": "2.0", "method": "session/update",
                "params": {"sessionId": "s1", "update": {
                    "sessionUpdate": "tool_call", "toolCallId": "code-1", "title": "Execute code",
                    "kind": "execute", "status": "completed", "rawInput": {}, "rawOutput": output,
                    "_meta": {(namespace): {"toolName": "mcp__macro_internal__ExecuteCode"}}
                }}
            }}),
            json!({"direction": "to_server", "content": {
                "type": "acp", "jsonrpc": "2.0", "id": "prompt-1", "result": {"stopReason": "end_turn"}
            }}),
        ];
        let recording = frames
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let messages = fold(parse_log(&recording));
        let agent = messages
            .iter()
            .find(|message| message.author == crate::domain::model::Author::Agent)
            .unwrap();
        let segments = crate::domain::model::segments(&agent.parts, agent.stop.is_some());
        assert_eq!(segments[0].rows[0].label, "Search documents", "{namespace}");
        assert_eq!(segments[0].rows[0].id, "code-1:1");
    }
}

#[test]
fn macro_mcp_calls_fold_to_macro_and_user_tool_details() {
    let messages = fold(parse_log(MACRO_MCP));
    let agent = messages
        .iter()
        .find(|message| message.author == crate::domain::model::Author::Agent)
        .expect("the agent answered");
    let tools: Vec<_> = agent
        .parts
        .iter()
        .filter_map(|part| match part {
            MessagePart::ToolUse {
                name,
                status,
                detail,
                ..
            } => Some((name.display(), *status, detail)),
            _ => None,
        })
        .collect();
    assert_eq!(tools.len(), 3, "three Macro calls: {tools:#?}");

    let (name, status, detail) = tools[0];
    assert_eq!(name, "ReadContent");
    assert_eq!(status, ToolStatus::Completed);
    let ToolDetail::Macro {
        input,
        output,
        error,
    } = detail
    else {
        panic!("ReadContent folds to a Macro detail: {detail:?}");
    };
    assert_eq!(
        input,
        &json!({"documentId": "4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46"}),
        "input is the tool's own arguments, filled by the patch"
    );
    assert_eq!(
        output.as_ref(),
        Some(&json!({"content": {"text": "Q3 plan: ship the fold."}, "comments": []})),
        "structuredContent wins over the text block"
    );
    assert_eq!(*error, None);

    let (name, status, detail) = tools[1];
    assert_eq!(name, "SendEmail");
    assert_eq!(status, ToolStatus::Completed);
    let ToolDetail::UserTool { input, outcome } = detail else {
        panic!("SendEmail folds to a user tool: {detail:?}");
    };
    assert_eq!(
        input["subject"], "Q3 plan (updated)",
        "the user's edits patch the draft after the turn ended"
    );
    assert_eq!(
        *outcome,
        UserToolOutcome::Sent {
            message_id: "9c4d2c6e-2f3a-4d1e-8b0a-5e6f7a8b9c0d".to_owned(),
            thread_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d".to_owned(),
        },
        "the last synthetic update records what the user did"
    );

    let (name, status, detail) = tools[2];
    assert_eq!(name, "ListEntities");
    assert_eq!(status, ToolStatus::Failed);
    let ToolDetail::Macro { output, error, .. } = detail else {
        panic!("ListEntities folds to a Macro detail: {detail:?}");
    };
    assert_eq!(
        error.as_deref(),
        Some("Failed to list entities: permission denied"),
        "isError text is the error"
    );
    assert_eq!(
        output.as_ref(),
        Some(&Value::String(
            "Failed to list entities: permission denied".to_owned()
        )),
        "non-JSON text is kept as the output string"
    );
}

/// A user tool's outcome walks pending → edited → sent as patches arrive,
/// each restating the whole outcome.
#[test]
fn a_user_tool_outcome_follows_the_patches() {
    let frames = parse_log(MACRO_MCP);
    // Fold up to (not including) the two post-turn patches.
    let before_user: Vec<_> = frames.iter().take(frames.len() - 2).cloned().collect();
    let pending = user_tool_outcome(&fold(before_user));
    assert_eq!(pending, UserToolOutcome::Pending);

    let edited: Vec<_> = frames.iter().take(frames.len() - 1).cloned().collect();
    assert_eq!(user_tool_outcome(&fold(edited)), UserToolOutcome::Edited);
}

fn user_tool_outcome(messages: &[crate::domain::model::FoldedMessage]) -> UserToolOutcome {
    messages
        .iter()
        .flat_map(|message| message.parts.iter())
        .find_map(|part| match part {
            MessagePart::ToolUse {
                detail: ToolDetail::UserTool { outcome, .. },
                ..
            } => Some(outcome.clone()),
            _ => None,
        })
        .expect("a user tool part")
}

#[test]
fn the_fixture_names_its_harness() {
    let mut machine = FoldMachineImpl::new();
    for entry in parse_log(MACRO_MCP) {
        let _ = machine.push(entry);
    }
    assert_eq!(machine.metadata().harness, Harness::ClaudeCode);
}

#[test]
fn unwraps_call_tool_results() {
    // structuredContent wins.
    let enveloped = json!({
        "content": [{"type": "text", "text": "{\"a\":1}"}],
        "structuredContent": {"a": 2},
        "isError": false
    });
    assert_eq!(mcp::unwrap_call_result(&enveloped), (json!({"a": 2}), None));

    // Else the first JSON-parsable text block.
    let text_json = json!({"content": [{"type": "text", "text": "\"PendingUserExecution\""}]});
    assert_eq!(
        mcp::unwrap_call_result(&text_json),
        (json!("PendingUserExecution"), None)
    );

    // Else the text, joined; an error envelope reports it as the error too.
    let plain = json!({"content": [{"type": "text", "text": "nope"}, {"type": "text", "text": "really"}], "isError": true});
    assert_eq!(
        mcp::unwrap_call_result(&plain),
        (json!("nope\nreally"), Some("nope\nreally".to_owned()))
    );

    // A bare array of blocks (how Claude Code copies `content`) reads the same.
    let blocks = json!([{"type": "text", "text": "{\"ok\":true}"}]);
    assert_eq!(
        mcp::unwrap_call_result(&blocks),
        (json!({"ok": true}), None)
    );

    // A tool's own JSON with a `content` field is not an envelope: only an
    // array of typed blocks is. `ReadContent` returns exactly this shape.
    let read_content = json!({"content": {"text": "Q3 plan"}, "comments": []});
    assert_eq!(
        mcp::unwrap_call_result(&read_content),
        (read_content.clone(), None)
    );
    let string_content = json!({"content": "document text"});
    assert_eq!(
        mcp::unwrap_call_result(&string_content),
        (string_content.clone(), None)
    );
    let untyped_items = json!({"content": [{"text": "no type"}]});
    assert_eq!(
        mcp::unwrap_call_result(&untyped_items),
        (untyped_items.clone(), None)
    );

    // Anything else is already bare.
    let bare = json!({"result": "done"});
    assert_eq!(mcp::unwrap_call_result(&bare), (bare.clone(), None));
    assert_eq!(mcp::unwrap_call_result(&json!("10")), (json!("10"), None));
    // An empty content array carries nothing.
    assert_eq!(
        mcp::unwrap_call_result(&json!({"content": []})),
        (Value::Null, None)
    );
}

#[test]
fn reads_user_tool_responses() {
    let email = "SendEmail";
    assert_eq!(
        macro_tools::user_tool_outcome(email, &json!("PendingUserExecution")),
        UserToolOutcome::Pending
    );
    assert_eq!(
        macro_tools::user_tool_outcome(email, &json!("Rejected")),
        UserToolOutcome::Rejected
    );
    assert_eq!(
        macro_tools::user_tool_outcome(email, &json!({"UserAction": "userEdited"})),
        UserToolOutcome::Edited
    );
    assert_eq!(
        macro_tools::user_tool_outcome(
            email,
            &json!({"UserAction": {"sent": {"message_id": "m", "thread_id": "t"}}})
        ),
        UserToolOutcome::Sent {
            message_id: "m".to_owned(),
            thread_id: "t".to_owned()
        }
    );
    assert_eq!(
        macro_tools::user_tool_outcome(
            email,
            &json!({"UserAction": {"convertedToDraft": {"draft_id": "d"}}})
        ),
        UserToolOutcome::Draft {
            draft_id: "d".to_owned(),
            thread_id: None
        }
    );
    // Another user tool's action is carried whole.
    let event = json!({"id": "evt", "title": "Sync"});
    assert_eq!(
        macro_tools::user_tool_outcome("CreateCalendarEvent", &json!({"UserAction": event})),
        UserToolOutcome::Completed {
            result: event.clone()
        }
    );
    // Shapes this fold does not know are named as such, never dropped.
    assert_eq!(
        macro_tools::user_tool_outcome(email, &json!({"UserAction": {"teleported": true}})),
        UserToolOutcome::Unrecognized
    );
    assert_eq!(
        macro_tools::user_tool_outcome(email, &json!({"other": 1})),
        UserToolOutcome::Unrecognized
    );
    assert_eq!(
        macro_tools::user_tool_outcome(email, &json!(42)),
        UserToolOutcome::Unrecognized
    );
    assert_eq!(
        macro_tools::user_tool_outcome(email, &Value::Null),
        UserToolOutcome::Pending
    );
    // A host with no composer runs `CreateCalendarEvent` at once and
    // returns the event bare; only that tool's event reads as done.
    let created = json!({"eventId": "evt", "title": "Sync"});
    assert_eq!(
        macro_tools::user_tool_outcome("CreateCalendarEvent", &created),
        UserToolOutcome::Completed {
            result: created.clone()
        }
    );
    assert_eq!(
        macro_tools::user_tool_outcome(email, &created),
        UserToolOutcome::Unrecognized
    );
    assert_eq!(
        macro_tools::user_tool_outcome("CreateCalendarEvent", &json!({"title": "Sync"})),
        UserToolOutcome::Unrecognized
    );
}

/// Macro's MCP server has no composer, so its `CreateCalendarEvent` is an
/// ordinary tool that creates the event at once: the step still earns the
/// event's card.
#[test]
fn an_event_created_over_mcp_is_carded_like_one_the_user_finished() {
    let event =
        json!({"eventId": "evt-1", "title": "Design review", "start": "2026-10-09T15:00:00Z"});
    let log = [
        r#"{"direction":"to_server","content":{"type":"event","event":"acp_ready"}}"#.to_owned(),
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"init-1","method":"initialize","params":{"protocolVersion":1}}}"#.to_owned(),
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"init-1","result":{"protocolVersion":1,"agentCapabilities":{},"agentInfo":{"name":"@agentclientprotocol/claude-agent-acp","version":"0.64.2"}}}}"#.to_owned(),
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"prompt-1","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"book the design review"}]}}}"#.to_owned(),
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"_meta":{"claudeCode":{"toolName":"mcp__macro__CreateCalendarEvent"}},"toolCallId":"tc-event","sessionUpdate":"tool_call","rawInput":{"title":"Design review"},"status":"pending","title":"mcp__macro__CreateCalendarEvent","kind":"other","content":[]}}}}"#.to_owned(),
        format!(
            r#"{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"s1","update":{{"_meta":{{"claudeCode":{{"toolName":"mcp__macro__CreateCalendarEvent"}}}},"toolCallId":"tc-event","sessionUpdate":"tool_call_update","status":"completed","rawOutput":{{"content":[{{"type":"text","text":{text}}}],"structuredContent":{event},"isError":false}}}}}}}}}}"#,
            text = serde_json::to_string(&event.to_string()).expect("a JSON string"),
        ),
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"prompt-1","result":{"stopReason":"end_turn"}}}"#.to_owned(),
    ]
    .join("\n");
    let messages = fold(parse_log(&log));
    let agent = messages
        .iter()
        .find(|message| message.author == crate::domain::model::Author::Agent)
        .expect("the agent answered");
    let Some(MessagePart::ToolUse {
        detail: ToolDetail::UserTool { outcome, .. },
        ..
    }) = agent.parts.first()
    else {
        panic!("the call folds to a user tool: {:#?}", agent.parts);
    };
    assert_eq!(
        *outcome,
        UserToolOutcome::Completed {
            result: event.clone()
        }
    );
    let row = &segments(&agent.parts, true)[0].rows[0];
    assert_eq!(row.label, "Created event");
    assert!(
        matches!(
            &row.card,
            Some(ActivityCard::Item {
                item_type: CardItemType::CalendarEvent,
                item_id,
                action: CardAction::Created,
                ..
            }) if item_id == "evt-1"
        ),
        "{:?}",
        row.card
    );
}

/// Whose shape a call is in is decided by name first, then by the harness.
#[test]
fn tool_shape_puts_macro_tools_first_and_leaves_the_rest_to_the_harness() {
    let parse = |name: &str| -> ToolName { name.parse().unwrap_or_else(|never| match never {}) };
    let other = Frame::new().kind(ToolKind::Other);
    let claude = Harness::ClaudeCode.reader();
    assert_eq!(
        harness::tool_shape(claude, &parse("mcp__macro__ReadContent"), &other.view()),
        ToolShape::Macro("ReadContent")
    );
    assert_eq!(
        harness::tool_shape(claude, &parse("mcp__macro__SendEmail"), &other.view()),
        ToolShape::UserTool("SendEmail")
    );
    assert_eq!(
        harness::tool_shape(claude, &parse("mcp__macro__Subagent"), &other.view()),
        ToolShape::Subagent
    );
    // Another server's tool, whatever it is called, is the harness's to read.
    assert_eq!(
        harness::tool_shape(claude, &parse("mcp__deepwiki__Subagent"), &other.view()),
        ToolShape::Harness
    );
    assert_eq!(
        harness::tool_shape(
            claude,
            &parse("Bash"),
            &Frame::new().kind(ToolKind::Execute).view()
        ),
        ToolShape::Harness
    );
    // The harness's own delegation tool is a subagent by its rule.
    assert_eq!(
        harness::tool_shape(
            claude,
            &parse("Task"),
            &Frame::new().kind(ToolKind::Think).view()
        ),
        ToolShape::Subagent
    );
    // Macro's own agent calls its tools by bare name.
    let inmem = Harness::Macro.reader();
    assert_eq!(
        harness::tool_shape(inmem, &parse("SendEmail"), &other.view()),
        ToolShape::UserTool("SendEmail")
    );
    assert_eq!(
        harness::tool_shape(inmem, &parse("Subagent"), &other.view()),
        ToolShape::Subagent
    );
    // Any other harness only knows a bare `SendEmail` as its own.
    assert_eq!(
        harness::tool_shape(claude, &parse("SendEmail"), &other.view()),
        ToolShape::Harness
    );
}

/// Macro's `Subagent` answers in Macro's shape through every harness's
/// wrapper; a harness's own delegation tool is read by its reader.
#[test]
fn subagent_result_reads_macro_subagent_through_the_harness_wrapper() {
    let parse = |name: &str| -> ToolName { name.parse().unwrap_or_else(|never| match never {}) };
    let answer = |text: &str| {
        Some(SubagentResult {
            text: Some(text.to_owned()),
            ..SubagentResult::default()
        })
    };
    // Over MCP: the response is a JSON text block inside the envelope.
    let claude = Harness::ClaudeCode.reader();
    let enveloped = Frame::new()
        .raw_output(json!({"content": [{"type": "text", "text": "{\"result\":\"ten\"}"}]}));
    assert_eq!(
        harness::subagent_result(claude, &parse("mcp__macro__Subagent"), &enveloped.view()),
        answer("ten")
    );
    // Natively: bare.
    let inmem = Harness::Macro.reader();
    let bare = Frame::new().raw_output(json!({"result": "ten"}));
    assert_eq!(
        harness::subagent_result(inmem, &parse("Subagent"), &bare.view()),
        answer("ten")
    );
    // An in-process failure is the wrapper's error, not an answer.
    let failed = Frame::new().raw_output(json!({"error": "pool exhausted"}));
    assert_eq!(
        harness::subagent_result(inmem, &parse("Subagent"), &failed.view()),
        Some(SubagentResult {
            error: Some("pool exhausted".to_owned()),
            ..SubagentResult::default()
        })
    );
    // No output yet, nothing reported - not even the streamed echo.
    let streaming = Frame::new().text("echo").status(ToolStatus::Running);
    assert_eq!(
        harness::subagent_result(inmem, &parse("Subagent"), &streaming.view()),
        None
    );
    // The same `{ "result" }` from the harness's own tool is not Macro's
    // shape: the generic reading shows it as JSON text.
    assert_eq!(
        harness::subagent_result(claude, &parse("Task"), &bare.view()),
        answer(r#"{"result":"ten"}"#)
    );
}

/// Macro's in-process agent calls the same tools natively, with bare output.
#[test]
fn the_inmem_harness_reads_native_names_as_macro_tools_with_bare_output() {
    let reader = Harness::Macro.reader();
    assert_eq!(
        reader.macro_tool(&ToolName::native("SendEmail")),
        Some("SendEmail")
    );
    assert_eq!(
        reader.macro_tool(&ToolName::Mcp {
            server: "deepwiki".to_owned(),
            tool: "ask".to_owned()
        }),
        None
    );
    assert_eq!(
        reader.unwrap_tool_output(&json!({"result": "done"})),
        (json!({"result": "done"}), None)
    );
    assert_eq!(
        reader.unwrap_tool_output(&json!({"error": "boom"})),
        (Value::Null, Some("boom".to_owned()))
    );
    // Other harnesses only know Macro's tools through its MCP server.
    assert_eq!(
        Harness::ClaudeCode
            .reader()
            .macro_tool(&ToolName::native("SendEmail")),
        None
    );
}
