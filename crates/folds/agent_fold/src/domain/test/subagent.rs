//! Delegated agents fold to one `Subagent` detail whichever harness reported
//! them, with the subagent's own calls nested when the harness attributes
//! them.

use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::harness::opencode::task_result_text;
use crate::domain::model::{
    Author, FoldedMessage, Harness, MessagePart, SubagentResult, ToolDetail, ToolName, ToolStats,
    ToolStatus,
};
use crate::domain::ports::FoldMachine;
use crate::domain::test::util::{Frame, capturing_warnings};
use crate::testing::fixtures::{
    SUBAGENT_CLAUDE_CODE, SUBAGENT_CURSOR, SUBAGENT_MACRO_INMEM, SUBAGENT_OPENCODE,
};
use crate::testing::parse_log;
use agent_client_protocol::schema::v1::ToolKind;
use serde_json::json;

fn agent_message(messages: &[FoldedMessage]) -> &FoldedMessage {
    messages
        .iter()
        .find(|message| message.author == Author::Agent)
        .expect("the agent answered")
}

fn subagent_parts(message: &FoldedMessage) -> Vec<&MessagePart> {
    message
        .parts
        .iter()
        .filter(|part| {
            matches!(
                part,
                MessagePart::ToolUse {
                    detail: ToolDetail::Subagent { .. },
                    ..
                }
            )
        })
        .collect()
}

#[test]
fn claude_code_nests_the_subagents_calls_and_reports_its_stats() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(SUBAGENT_CLAUDE_CODE)));
    assert_eq!(warnings, vec![], "a clean recording should not warn");
    let agent = agent_message(&messages);

    // The Bash call the subagent made is nested, not a sibling.
    let top_level_terminals = agent
        .parts
        .iter()
        .filter(|part| {
            matches!(
                part,
                MessagePart::ToolUse {
                    detail: ToolDetail::Terminal { .. },
                    ..
                }
            )
        })
        .count();
    assert_eq!(top_level_terminals, 0, "the child's Bash is not top level");

    let [part] = subagent_parts(agent)[..] else {
        panic!("exactly one subagent: {:#?}", agent.parts);
    };
    let MessagePart::ToolUse {
        name,
        status,
        detail:
            ToolDetail::Subagent {
                title,
                agent_type,
                description,
                prompt,
                background,
                children,
                result,
            },
        ..
    } = part
    else {
        unreachable!()
    };
    assert_eq!(*name, ToolName::native("Agent"));
    assert_eq!(title, "Add 5+5 with Python", "the description is the title");
    assert_eq!(*status, ToolStatus::Completed);
    assert_eq!(agent_type.as_deref(), Some("general-purpose"));
    assert_eq!(description.as_deref(), Some("Add 5+5 with Python"));
    assert_eq!(
        prompt.as_deref(),
        Some("Run `python3 -c \"print(5+5)\"` in bash and report the output.")
    );
    assert!(!background);

    let [child] = &children[..] else {
        panic!("one child call: {children:#?}");
    };
    let MessagePart::ToolUse {
        name,
        status,
        detail:
            ToolDetail::Terminal {
                command,
                output,
                exit_code,
            },
        ..
    } = child
    else {
        panic!("the child is the Bash terminal: {child:?}");
    };
    assert_eq!(*name, ToolName::native("Bash"));
    assert_eq!(*status, ToolStatus::Completed);
    assert_eq!(command.as_deref(), Some("python3 -c \"print(5+5)\""));
    assert_eq!(output.as_ref().map(|o| o.as_str()), Some("10"));
    assert_eq!(*exit_code, Some(0));

    let result = result.as_deref().expect("the subagent reported back");
    assert_eq!(
        *result,
        SubagentResult {
            text: Some("Output: `10`".to_owned()),
            error: None,
            agent_id: Some("af2647314187b6bf1".to_owned()),
            model: Some("claude-opus-5[1m]".to_owned()),
            duration_ms: Some(3485),
            tokens: Some(26077),
            tool_uses: Some(1),
            stats: Some(ToolStats {
                commands: 1,
                ..ToolStats::default()
            }),
        },
        "the rich toolResponse is kept; the later rawOutput text does not replace its answer"
    );
}

#[test]
fn opencode_reports_the_child_session_and_strips_the_task_wrapper() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(SUBAGENT_OPENCODE)));
    assert_eq!(warnings, vec![]);
    let agent = agent_message(&messages);
    let [part] = subagent_parts(agent)[..] else {
        panic!("exactly one subagent: {:#?}", agent.parts);
    };
    let MessagePart::ToolUse {
        name,
        detail:
            ToolDetail::Subagent {
                agent_type,
                description,
                prompt,
                children,
                result,
                ..
            },
        ..
    } = part
    else {
        unreachable!()
    };
    assert_eq!(*name, ToolName::native("task"));
    assert_eq!(agent_type.as_deref(), Some("general"));
    assert_eq!(description.as_deref(), Some("Add numbers with Python"));
    assert!(prompt.as_deref().unwrap().starts_with("Use Python"));
    assert!(children.is_empty(), "OpenCode never streams the child");
    let result = result.as_deref().expect("reported");
    assert_eq!(result.text.as_deref(), Some("10"));
    assert_eq!(
        result.agent_id.as_deref(),
        Some("ses_f9bd7ee76ffeshjLOLx06ArVK7")
    );
    assert_eq!(result.model.as_deref(), Some("openai/gpt-5.6-terra"));
    assert_eq!(result.error, None);
}

/// Macro's own agent delegates through its `Subagent` tool, which by name is
/// a Macro tool; the fold still folds it to the subagent detail, with the
/// tool's `{ "result" }` response read as the answer rather than shown as
/// JSON.
#[test]
fn the_inmem_agents_subagent_tool_folds_to_a_subagent_not_a_macro_tool() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(SUBAGENT_MACRO_INMEM)));
    assert_eq!(warnings, vec![]);
    let agent = agent_message(&messages);
    let [part] = subagent_parts(agent)[..] else {
        panic!("exactly one subagent: {:#?}", agent.parts);
    };
    let MessagePart::ToolUse {
        name,
        status,
        detail:
            ToolDetail::Subagent {
                title,
                agent_type,
                description,
                prompt,
                children,
                result,
                ..
            },
        ..
    } = part
    else {
        unreachable!()
    };
    assert_eq!(*name, ToolName::native("Subagent"));
    assert_eq!(*status, ToolStatus::Completed);
    assert_eq!(*agent_type, None);
    assert_eq!(*description, None);
    assert!(prompt.as_deref().unwrap().starts_with("Compute 5 + 5"));
    assert_eq!(
        title,
        "Compute 5 + 5 in Python by executing the code, and report the exact numeric result that Python outputs.",
        "with no description, the brief's first line is the title"
    );
    assert!(children.is_empty(), "the child is not streamed");
    let result = result.as_deref().expect("reported");
    assert!(result.text.as_deref().unwrap().contains("**10**"));
    assert_eq!(result.error, None);
    assert!(
        !agent.parts.iter().any(|part| matches!(
            part,
            MessagePart::ToolUse {
                detail: ToolDetail::Macro { .. },
                ..
            }
        )),
        "the delegation must not also fold as a Macro tool"
    );
}

/// Any other harness reaches the same tool over Macro's MCP server, with the
/// response inside MCP's envelope; it is a delegation there too.
#[test]
fn the_subagent_tool_over_mcp_folds_to_a_subagent() {
    let log = r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"go"}]}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"_meta":{"claudeCode":{"toolName":"mcp__macro__Subagent"}},"toolCallId":"a","sessionUpdate":"tool_call","rawInput":{"task":"Find the frog poem"},"status":"in_progress","title":"Subagent","kind":"other"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"toolCallId":"a","sessionUpdate":"tool_call_update","status":"completed","rawOutput":{"content":[{"type":"text","text":"{\"result\":\"where quiet frogs go off to sleep.\"}"}]}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","result":{"stopReason":"end_turn"}}}"#;
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(log)));
    assert_eq!(warnings, vec![]);
    let agent = agent_message(&messages);
    let [part] = subagent_parts(agent)[..] else {
        panic!("exactly one subagent: {:#?}", agent.parts);
    };
    let MessagePart::ToolUse {
        name,
        detail: ToolDetail::Subagent { prompt, result, .. },
        ..
    } = part
    else {
        unreachable!()
    };
    assert_eq!(
        *name,
        ToolName::Mcp {
            server: "macro".to_owned(),
            tool: "Subagent".to_owned()
        }
    );
    assert_eq!(prompt.as_deref(), Some("Find the frog poem"));
    assert_eq!(
        result.as_deref().and_then(|result| result.text.as_deref()),
        Some("where quiet frogs go off to sleep.")
    );
}

#[test]
fn the_fixtures_name_their_harnesses() {
    for (fixture, expected) in [
        (SUBAGENT_CLAUDE_CODE, Harness::ClaudeCode),
        (SUBAGENT_OPENCODE, Harness::OpenCode),
        (SUBAGENT_CURSOR, Harness::Cursor),
        (SUBAGENT_MACRO_INMEM, Harness::Macro),
    ] {
        let mut machine = FoldMachineImpl::new();
        for entry in parse_log(fixture) {
            let _ = machine.push(entry);
        }
        assert_eq!(machine.metadata().harness, expected);
    }
}

/// A harness that delivers the child's transcript whole and re-announces the
/// call with it (Cursor sends the same `tool_call` event for every progress
/// report) replaces the children rather than doubling them.
#[test]
fn a_reannounced_transcript_replaces_the_children() {
    let announce = |status: &str| {
        format!(
            r#"{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"s","update":{{"toolCallId":"t","sessionUpdate":"tool_call","rawInput":{{"prompt":"add"}},"status":"{status}","title":"task","kind":"other","rawOutput":{{"result":{{"success":{{"agentId":"bc-1","conversationSteps":[{{"toolCall":{{"toolCallId":"c","shellToolCall":{{"args":{{"command":"echo 10"}},"result":{{"success":{{"stdout":"10\n"}}}}}}}}}},{{"assistantMessage":{{"text":"10"}}}}]}}}}}}}}}}}}}}"#
        )
    };
    let log = [
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"i","method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}}"#.to_owned(),
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"i","result":{"protocolVersion":1,"agentCapabilities":{},"agentInfo":{"name":"cursor-acp","version":"0"}}}}"#.to_owned(),
        r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"go"}]}}}"#.to_owned(),
        announce("in_progress"),
        announce("completed"),
        r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","result":{"stopReason":"end_turn"}}}"#.to_owned(),
    ]
    .join("\n");
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(&log)));
    assert_eq!(warnings, vec![]);
    let agent = agent_message(&messages);
    let [part] = subagent_parts(agent)[..] else {
        panic!("exactly one subagent: {:#?}", agent.parts);
    };
    let MessagePart::ToolUse {
        detail: ToolDetail::Subagent {
            children, result, ..
        },
        ..
    } = part
    else {
        unreachable!()
    };
    assert_eq!(children.len(), 1, "one shell call, not two: {children:#?}");
    assert_eq!(
        result.as_deref().and_then(|result| result.text.as_deref()),
        Some("10")
    );
}

/// A harness that re-announces a subagent call (a repeated `tool_call` for the
/// same id) does not re-send the children's frames, so they are kept.
#[test]
fn a_reannounced_subagent_keeps_its_children() {
    let log = r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"go"}]}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"_meta":{"claudeCode":{"toolName":"Agent","subagent":true}},"toolCallId":"a","sessionUpdate":"tool_call","rawInput":{"prompt":"do it"},"status":"in_progress","title":"Task","kind":"think"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"_meta":{"claudeCode":{"toolName":"Bash","parentToolUseId":"a"}},"toolCallId":"c","sessionUpdate":"tool_call","rawInput":{"command":"ls"},"status":"completed","title":"ls","kind":"execute"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"_meta":{"claudeCode":{"toolName":"Agent","subagent":true}},"toolCallId":"a","sessionUpdate":"tool_call","rawInput":{"prompt":"do it","description":"Do it"},"status":"completed","title":"Do it","kind":"think"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","result":{"stopReason":"end_turn"}}}"#;
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(log)));
    assert_eq!(warnings, vec![]);
    let agent = agent_message(&messages);
    let [part] = subagent_parts(agent)[..] else {
        panic!("one subagent: {:#?}", agent.parts);
    };
    let MessagePart::ToolUse {
        status,
        detail:
            ToolDetail::Subagent {
                description,
                children,
                ..
            },
        ..
    } = part
    else {
        unreachable!()
    };
    assert_eq!(*status, ToolStatus::Completed);
    assert_eq!(description.as_deref(), Some("Do it"));
    assert_eq!(children.len(), 1, "the child survived the re-announcement");
}

/// A child whose parent the fold never saw lands at top level, with a
/// warning, rather than vanishing.
#[test]
fn an_orphaned_child_folds_at_top_level_and_warns() {
    let log = r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"go"}]}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"_meta":{"claudeCode":{"toolName":"Bash","parentToolUseId":"never-opened"}},"toolCallId":"c","sessionUpdate":"tool_call","rawInput":{"command":"ls"},"status":"completed","title":"ls","kind":"execute"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","result":{"stopReason":"end_turn"}}}"#;
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(log)));
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    let agent = agent_message(&messages);
    assert!(matches!(
        &agent.parts[0],
        MessagePart::ToolUse {
            detail: ToolDetail::Terminal { .. },
            ..
        }
    ));
}

#[test]
fn the_generic_reader_recognizes_the_task_tool_convention() {
    let generic = Harness::Unknown.reader();
    let kinded = |kind: ToolKind| Frame::new().kind(kind);
    for name in ["task", "Task", "Agent"] {
        assert!(generic.is_subagent(&ToolName::native(name), &kinded(ToolKind::Think).view()));
        assert!(generic.is_subagent(&ToolName::native(name), &kinded(ToolKind::Other).view()));
        assert!(
            !generic.is_subagent(&ToolName::native(name), &kinded(ToolKind::Execute).view()),
            "a shell command called task is a shell command"
        );
    }
    assert!(!generic.is_subagent(&ToolName::native("Bash"), &kinded(ToolKind::Think).view()));

    let frame = Frame::new().raw_input(json!({
        "subagent_type": "explore",
        "description": "Find it",
        "task": "Look everywhere",
        "background": true
    }));
    let input = generic.subagent_input(&frame.view());
    assert_eq!(input.agent_type.as_deref(), Some("explore"));
    assert_eq!(input.description.as_deref(), Some("Find it"));
    assert_eq!(input.prompt.as_deref(), Some("Look everywhere"));
    assert_eq!(input.background, Some(true));
    assert_eq!(
        generic.subagent_input(&Frame::new().title("anything").view()),
        Default::default()
    );

    // Without a structured result the text is whatever the call reported.
    let text_of = |frame: Frame| generic.subagent_result(&frame.view()).unwrap().text;
    assert_eq!(
        text_of(Frame::new().raw_output(json!("done"))).as_deref(),
        Some("done")
    );
    assert_eq!(
        generic
            .subagent_result(&Frame::new().raw_output(json!({"error": "nope"})).view())
            .unwrap()
            .error
            .as_deref(),
        Some("nope")
    );
    assert_eq!(
        text_of(Frame::new().text("from content")).as_deref(),
        Some("from content")
    );
    assert_eq!(generic.subagent_result(&Frame::new().view()), None);
}

/// While a delegation streams, Claude Code echoes the brief into the content
/// blocks; that text is the question, not the answer, until the call ends.
#[test]
fn content_text_is_an_answer_only_once_the_call_has_finished() {
    let generic = Harness::Unknown.reader();
    let streaming = Frame::new()
        .text("Find the frog poem")
        .status(ToolStatus::Running);
    assert_eq!(generic.subagent_result(&streaming.view()), None);
    let finished = Frame::new()
        .text("Find the frog poem")
        .status(ToolStatus::Completed);
    assert_eq!(
        generic
            .subagent_result(&finished.view())
            .unwrap()
            .text
            .as_deref(),
        Some("Find the frog poem")
    );
}

#[test]
fn claude_code_marks_a_subagent_by_meta_even_under_another_name() {
    let claude = Harness::ClaudeCode.reader();
    let flagged = Frame::new()
        .kind(ToolKind::Other)
        .meta(json!({"claudeCode": {"toolName": "Agent", "subagent": true}}));
    assert!(claude.is_subagent(&ToolName::native("Whatever"), &flagged.view()));
    let unflagged = Frame::new().kind(ToolKind::Other);
    assert!(!claude.is_subagent(&ToolName::native("Whatever"), &unflagged.view()));
}

#[test]
fn opencode_task_wrapper_is_stripped() {
    assert_eq!(
        task_result_text(
            "<task id=\"ses_1\" state=\"completed\">\n<task_result>\n10\n</task_result>\n</task>"
        ),
        "10"
    );
    assert_eq!(
        task_result_text(
            "<task id=\"ses_1\" state=\"error\">\n<task_error>\nboom\n</task_error>\n</task>"
        ),
        "boom"
    );
    assert_eq!(task_result_text("plain"), "plain");
}

#[test]
fn a_subagent_result_merges_later_reports_without_losing_its_answer() {
    let mut first = SubagentResult {
        text: Some("answer".to_owned()),
        agent_id: Some("a".to_owned()),
        ..SubagentResult::default()
    };
    first.merge(SubagentResult {
        text: Some("boilerplate".to_owned()),
        model: Some("m".to_owned()),
        tool_uses: Some(2),
        ..SubagentResult::default()
    });
    assert_eq!(first.text.as_deref(), Some("answer"));
    assert_eq!(first.agent_id.as_deref(), Some("a"));
    assert_eq!(first.model.as_deref(), Some("m"));
    assert_eq!(first.tool_uses, Some(2));
}
