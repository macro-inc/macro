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
use crate::domain::test::util::capturing_warnings;
use crate::testing::fixtures::{SUBAGENT_CLAUDE_CODE, SUBAGENT_OPENCODE};
use crate::testing::parse_log;
use agent_client_protocol::schema::v1::{Meta, ToolKind};
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

#[test]
fn the_fixtures_name_their_harnesses() {
    for (fixture, expected) in [
        (SUBAGENT_CLAUDE_CODE, Harness::ClaudeCode),
        (SUBAGENT_OPENCODE, Harness::OpenCode),
    ] {
        let mut machine = FoldMachineImpl::new();
        for entry in parse_log(fixture) {
            let _ = machine.push(entry);
        }
        assert_eq!(machine.metadata().harness, expected);
    }
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
    for name in ["task", "Task", "Agent"] {
        assert!(generic.is_subagent(&ToolName::native(name), ToolKind::Think, None));
        assert!(generic.is_subagent(&ToolName::native(name), ToolKind::Other, None));
        assert!(
            !generic.is_subagent(&ToolName::native(name), ToolKind::Execute, None),
            "a shell command called task is a shell command"
        );
    }
    assert!(!generic.is_subagent(&ToolName::native("Bash"), ToolKind::Think, None));

    let input = generic.subagent_input(
        Some(&json!({
            "subagent_type": "explore",
            "description": "Find it",
            "task": "Look everywhere",
            "background": true
        })),
        "",
    );
    assert_eq!(input.agent_type.as_deref(), Some("explore"));
    assert_eq!(input.description.as_deref(), Some("Find it"));
    assert_eq!(input.prompt.as_deref(), Some("Look everywhere"));
    assert_eq!(input.background, Some(true));
    assert_eq!(generic.subagent_input(None, "anything"), Default::default());

    // Without a structured result the text is whatever the call reported.
    assert_eq!(
        generic
            .subagent_result(None, None, Some(&json!("done")), None)
            .unwrap()
            .text
            .as_deref(),
        Some("done")
    );
    assert_eq!(
        generic
            .subagent_result(None, None, Some(&json!({"error": "nope"})), None)
            .unwrap()
            .error
            .as_deref(),
        Some("nope")
    );
    assert_eq!(
        generic
            .subagent_result(None, None, None, Some("from content"))
            .unwrap()
            .text
            .as_deref(),
        Some("from content")
    );
    assert_eq!(generic.subagent_result(None, None, None, None), None);
}

#[test]
fn claude_code_marks_a_subagent_by_meta_even_under_another_name() {
    let meta: Meta = match json!({"claudeCode": {"toolName": "Agent", "subagent": true}}) {
        serde_json::Value::Object(map) => map,
        _ => unreachable!(),
    };
    let claude = Harness::ClaudeCode.reader();
    assert!(claude.is_subagent(&ToolName::native("Whatever"), ToolKind::Other, Some(&meta)));
    assert!(!claude.is_subagent(&ToolName::native("Whatever"), ToolKind::Other, None));
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
