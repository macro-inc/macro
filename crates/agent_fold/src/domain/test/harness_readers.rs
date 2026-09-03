//! The per-harness readers, against the frame shapes each harness's source
//! confirms (see the research notes in the PR that added them). Where a real
//! recording exists it is pinned in `real_recordings`; these pin the readers
//! for harnesses we have read but not yet recorded.

use crate::domain::model::{
    AnsiText, Harness, MessagePart, SubagentResult, ToolDetail, ToolName, ToolStatus, ToolUseId,
};
use agent_client_protocol::schema::v1::{Meta, ToolKind};
use serde_json::{Value, json};

fn meta_of(value: Value) -> Meta {
    match value {
        Value::Object(map) => map,
        other => panic!("meta must be an object, got {other}"),
    }
}

fn native(name: &str) -> ToolName {
    ToolName::native(name)
}

// --- Codex (@agentclientprotocol/codex-acp, legacy collaboration mode) ---

#[test]
fn codex_names_mcp_tools_from_its_dotted_title_and_flag() {
    let reader = Harness::Codex.reader();
    let meta = meta_of(json!({"is_mcp_tool_call": true}));
    assert_eq!(
        reader.harness_tool_name(Some(&meta), "mcp.macro.ReadContent"),
        Some(ToolName::Mcp {
            server: "macro".to_owned(),
            tool: "ReadContent".to_owned()
        })
    );
    // Without the flag a dotted title is just a title.
    assert_eq!(
        reader.harness_tool_name(None, "mcp.macro.ReadContent"),
        None
    );
    assert_eq!(reader.harness_tool_name(Some(&meta), "Editing files"), None);
}

#[test]
fn codex_spawn_agent_is_a_subagent_and_carries_its_result_in_raw_input() {
    let reader = Harness::Codex.reader();
    let collaboration = |tool: &str| {
        meta_of(json!({"codex": {"collaboration": {
            "tool": tool, "senderThreadId": "thread-main", "receiverThreadIds": ["thread-paris"]
        }}}))
    };
    assert!(reader.is_subagent(
        &native("spawnAgent"),
        ToolKind::Other,
        Some(&collaboration("spawnAgent"))
    ));
    assert!(
        !reader.is_subagent(
            &native("wait"),
            ToolKind::Other,
            Some(&collaboration("wait"))
        ),
        "steering an existing subagent is not a delegation"
    );
    assert!(!reader.is_subagent(&native("spawnAgent"), ToolKind::Other, None));

    let raw_input = json!({
        "prompt": "Find the current weather in Paris.",
        "senderThreadId": "thread-main",
        "receiverThreadIds": ["thread-paris"],
        "agentsStates": {"thread-paris": {"status": "completed", "message": "Sunny, 24C"}},
        "model": "gpt-5.4",
        "reasoningEffort": null,
        "status": "completed"
    });
    let input = reader.subagent_input(Some(&raw_input), "spawnAgent");
    assert_eq!(
        input.prompt.as_deref(),
        Some("Find the current weather in Paris.")
    );
    let result = reader
        .subagent_result(None, Some(&raw_input), None, None)
        .expect("reported");
    assert_eq!(
        result,
        SubagentResult {
            text: Some("Sunny, 24C".to_owned()),
            agent_id: Some("thread-paris".to_owned()),
            model: Some("gpt-5.4".to_owned()),
            ..SubagentResult::default()
        }
    );

    // The opening frame: no child yet, an empty model string means none.
    let opening = json!({
        "prompt": "…", "senderThreadId": "thread-main", "receiverThreadIds": [],
        "agentsStates": {}, "model": "", "status": "inProgress"
    });
    assert_eq!(
        reader.subagent_result(None, Some(&opening), None, None),
        None
    );

    let failed = json!({
        "receiverThreadIds": ["t"], "agentsStates": {"t": {"status": "errored", "message": "boom"}},
        "status": "failed"
    });
    let result = reader
        .subagent_result(None, Some(&failed), None, None)
        .unwrap();
    assert_eq!(result.error.as_deref(), Some("boom"));
    assert_eq!(result.text, None);
}

#[test]
fn codex_is_sniffed_from_its_namespace() {
    let meta = meta_of(json!({"codex": {"collaboration": {"tool": "wait"}}}));
    assert_eq!(Harness::sniff_meta(Some(&meta)), Some(Harness::Codex));
}

// --- Cursor (cursor_cloud_agents) ---

#[test]
fn cursor_task_reads_its_oneof_subagent_type_and_ids() {
    let reader = Harness::Cursor.reader();
    assert!(reader.is_subagent(&native("task"), ToolKind::Other, None));

    let raw_input = json!({
        "description": "Find SSE decoding",
        "prompt": "Find where SSE decoding happens.",
        "subagentType": {"explore": {}},
        "model": "composer-2.5-fast",
        "agentId": "bc-f6167deb"
    });
    let input = reader.subagent_input(Some(&raw_input), "task");
    assert_eq!(input.agent_type.as_deref(), Some("explore"));
    assert_eq!(input.description.as_deref(), Some("Find SSE decoding"));
    assert_eq!(
        input.prompt.as_deref(),
        Some("Find where SSE decoding happens.")
    );

    let result = reader
        .subagent_result(None, Some(&raw_input), None, None)
        .expect("ids are a result even before the answer");
    assert_eq!(result.agent_id.as_deref(), Some("bc-f6167deb"));
    assert_eq!(result.model.as_deref(), Some("composer-2.5-fast"));
    assert_eq!(result.text, None);

    // The other spellings of the oneof.
    let kinded = json!({"subagentType": {"kind": "custom", "name": "reviewer"}});
    assert_eq!(
        reader
            .subagent_input(Some(&kinded), "task")
            .agent_type
            .as_deref(),
        Some("reviewer")
    );
    let bare_kind = json!({"subagentType": {"kind": "explore"}});
    assert_eq!(
        reader
            .subagent_input(Some(&bare_kind), "task")
            .agent_type
            .as_deref(),
        Some("explore")
    );

    // Proto defaults say nothing: no agent type, no model.
    let defaults =
        json!({"subagentType": {"unspecified": {}}, "model": "default", "agentId": "bc-1"});
    assert_eq!(
        reader.subagent_input(Some(&defaults), "task").agent_type,
        None
    );
    let result = reader
        .subagent_result(None, Some(&defaults), None, None)
        .unwrap();
    assert_eq!(result.model, None);
    assert_eq!(result.agent_id.as_deref(), Some("bc-1"));
}

/// The finished `task` call carries the child's transcript whole; it folds to
/// nested parts, and the closing prose is the answer rather than a child.
#[test]
fn cursor_task_result_unfolds_the_childs_transcript() {
    let reader = Harness::Cursor.reader();
    let raw_output = json!({"result": {"success": {
        "agentId": "bc-child",
        "durationMs": "12978",
        "conversationSteps": [
            {"thinkingMessage": {"text": "Use the shell.", "durationMs": 1168}},
            {"assistantMessage": {"text": "Computing."}},
            {"toolCall": {
                "toolCallId": "call_1\nfc_1",
                "shellToolCall": {
                    "args": {"command": "python3 -c 'import sympy'"},
                    "result": {"failure": {"stderr": "No module named 'sympy'\n", "exitCode": 1}, "isBackground": false}
                }
            }},
            {"toolCall": {
                "toolCallId": "call_2\nfc_2",
                "shellToolCall": {
                    "args": {"command": "python3 -c 'print(124/3)'"},
                    "result": {"success": {"stdout": "41.3\n", "interleavedOutput": "41.3\n"}}
                }
            }},
            {"toolCall": {
                "toolCallId": "call_3",
                "readToolCall": {"args": {"path": "/workspace/README.md"}, "result": {"success": {"path": "/workspace/README.md"}}}
            }},
            {"toolCall": {
                "toolCallId": "call_4",
                "brandNewToolCall": {"args": {"anything": 1}, "result": {"success": {}}}
            }},
            {"somethingElse": {"text": "a step kind this reader has never seen"}},
            {"assistantMessage": {"text": "The exact value is **124/3**."}}
        ]
    }}});

    let result = reader
        .subagent_result(None, None, Some(&raw_output), None)
        .unwrap();
    assert_eq!(
        result,
        SubagentResult {
            text: Some("The exact value is **124/3**.".to_owned()),
            agent_id: Some("bc-child".to_owned()),
            duration_ms: Some(12978),
            tool_uses: Some(4),
            ..SubagentResult::default()
        }
    );

    let children = reader.subagent_transcript(Some(&raw_output));
    assert_eq!(
        children,
        vec![
            MessagePart::Thought {
                text: "Use the shell.".to_owned()
            },
            MessagePart::Text {
                text: "Computing.".to_owned()
            },
            MessagePart::ToolUse {
                id: ToolUseId("call_1 fc_1".to_owned()),
                name: native("shell"),
                status: ToolStatus::Failed,
                detail: ToolDetail::Terminal {
                    command: Some("python3 -c 'import sympy'".to_owned()),
                    output: Some(AnsiText("No module named 'sympy'\n".to_owned())),
                    exit_code: Some(1),
                },
            },
            MessagePart::ToolUse {
                id: ToolUseId("call_2 fc_2".to_owned()),
                name: native("shell"),
                status: ToolStatus::Completed,
                detail: ToolDetail::Terminal {
                    command: Some("python3 -c 'print(124/3)'".to_owned()),
                    output: Some(AnsiText("41.3\n".to_owned())),
                    exit_code: Some(0),
                },
            },
            MessagePart::ToolUse {
                id: ToolUseId("call_3".to_owned()),
                name: native("read"),
                status: ToolStatus::Completed,
                detail: ToolDetail::Read {
                    paths: vec!["/workspace/README.md".into()],
                },
            },
            // An unknown tool is kept by name; an unknown step kind is skipped.
            MessagePart::ToolUse {
                id: ToolUseId("call_4".to_owned()),
                name: native("brandNew"),
                status: ToolStatus::Pending,
                detail: ToolDetail::Other {
                    kind: "other".to_owned(),
                    output: None,
                    input: None,
                },
            },
        ]
    );

    // A failed task is an error, with nothing to nest.
    let failed = json!({"result": {"error": "agent crashed"}});
    let result = reader
        .subagent_result(None, None, Some(&failed), None)
        .unwrap();
    assert_eq!(result.error.as_deref(), Some("agent crashed"));
    assert_eq!(result.text, None);
    assert_eq!(reader.subagent_transcript(Some(&failed)), vec![]);

    // The opening frame carries no result and so no transcript.
    assert_eq!(reader.subagent_transcript(None), vec![]);
}

// --- Hermes (hermes-agent) ---

#[test]
fn hermes_delegations_are_recognized_from_their_titles() {
    let reader = Harness::Hermes.reader();
    for title in [
        "delegate: Find the flaky test",
        "delegate batch (3 tasks)",
        "delegate task",
    ] {
        let name = reader
            .harness_tool_name(None, title)
            .unwrap_or_else(|| panic!("{title:?} names delegate_task"));
        assert_eq!(name, native("delegate_task"));
        assert!(
            reader.is_subagent(&name, ToolKind::Execute, None),
            "{title:?} is a delegation despite kind execute"
        );
    }
    assert_eq!(reader.harness_tool_name(None, "ls -la"), None);
    assert!(!reader.is_subagent(&native("ls -la"), ToolKind::Execute, None));

    let input = reader.subagent_input(None, "delegate: Find the flaky test");
    assert_eq!(input.prompt.as_deref(), Some("Find the flaky test"));
    assert_eq!(
        input.description.as_deref(),
        Some("delegate: Find the flaky test")
    );

    let ok = reader
        .subagent_result(
            None,
            None,
            None,
            Some("Delegation results: 1 task(s) in 4s"),
        )
        .unwrap();
    assert_eq!(
        ok.text.as_deref(),
        Some("Delegation results: 1 task(s) in 4s")
    );
    let failed = reader
        .subagent_result(None, None, None, Some("Delegation failed: pool exhausted"))
        .unwrap();
    assert_eq!(failed.error.as_deref(), Some("pool exhausted"));
    assert_eq!(failed.text, None);
}

// --- OpenClaw (openclaw-acp) ---

#[test]
fn openclaw_names_tools_from_its_titles_and_reads_spawns() {
    let reader = Harness::OpenClaw.reader();
    let title =
        "sessions_spawn: task: Investigate flaky test, label: flaky-test, runtime: subagent";
    assert_eq!(
        reader.harness_tool_name(None, title),
        Some(native("sessions_spawn"))
    );
    assert_eq!(
        reader.harness_tool_name(None, "read: path: /etc/hosts"),
        Some(native("read"))
    );
    assert_eq!(reader.harness_tool_name(None, "Plain title"), None);
    assert!(reader.is_subagent(&native("sessions_spawn"), ToolKind::Other, None));
    assert!(!reader.is_subagent(&native("sessions_send"), ToolKind::Other, None));

    let raw_input = json!({
        "task": "Investigate flaky test",
        "label": "flaky-test",
        "runtime": "subagent"
    });
    let input = reader.subagent_input(Some(&raw_input), title);
    assert_eq!(input.prompt.as_deref(), Some("Investigate flaky test"));
    assert_eq!(input.description.as_deref(), Some("flaky-test"));
    assert_eq!(input.agent_type.as_deref(), Some("subagent"));

    let raw_output = json!({
        "content": [{"type": "text", "text": "{\"status\":\"accepted\",\"childSessionKey\":\"agent:main:subagent:1f2e\",\"runId\":\"r1\"}"}],
        "details": {"status": "accepted", "childSessionKey": "agent:main:subagent:1f2e", "runId": "r1"}
    });
    let result = reader
        .subagent_result(None, Some(&raw_input), Some(&raw_output), None)
        .unwrap();
    assert_eq!(result.agent_id.as_deref(), Some("agent:main:subagent:1f2e"));
    assert_eq!(result.text, None, "an accepted spawn has no answer yet");

    // Without `details`, the text block's JSON is read instead.
    let text_only = json!({"content": [{"type": "text", "text": "{\"childSessionKey\":\"k\"}"}]});
    assert_eq!(
        reader
            .subagent_result(None, None, Some(&text_only), None)
            .unwrap()
            .agent_id
            .as_deref(),
        Some("k")
    );
}

/// The harnesses that write no `_meta` namespace on tool frames cannot be
/// sniffed; they are recognized from `initialize` alone.
#[test]
fn title_only_harnesses_are_not_sniffed() {
    let anonymous = meta_of(json!({"terminal_output": {"data": "x"}}));
    assert_eq!(Harness::sniff_meta(Some(&anonymous)), None);
    for harness in [
        Harness::OpenCode,
        Harness::Cursor,
        Harness::Hermes,
        Harness::OpenClaw,
    ] {
        assert_eq!(harness.reader().meta_namespace(), None, "{harness:?}");
    }
}
