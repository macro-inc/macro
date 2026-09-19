use crate::domain::harness::{
    HarnessReader, TerminalOutput, claude_code, command_from_raw_input, generic, is_terminal,
};
use crate::domain::model::{Harness, ToolName, ToolStatus};
use crate::domain::test::util::Frame;
use agent_client_protocol::schema::v1::{Meta, ToolKind};
use serde_json::json;

fn meta_of(value: serde_json::Value) -> Meta {
    match value {
        serde_json::Value::Object(map) => map,
        other => panic!("meta must be an object, got {other}"),
    }
}

#[test]
fn claude_code_reads_its_namespaced_tool_name() {
    let meta = meta_of(json!({"claudeCode": {"toolName": "Bash"}}));
    assert_eq!(claude_code::tool_name(Some(&meta)), Some("Bash".to_owned()));
    let frame = Frame::new().meta(json!({"claudeCode": {"toolName": "Bash"}}));
    assert_eq!(
        claude_code::ClaudeCode.reported_tool_name(&frame.view()),
        Some(ToolName::native("Bash"))
    );

    let mcp = Frame::new().meta(json!({"claudeCode": {"toolName": "mcp__macro__ReadContent"}}));
    assert_eq!(
        claude_code::ClaudeCode.reported_tool_name(&mcp.view()),
        Some(ToolName::Mcp {
            server: "macro".to_owned(),
            tool: "ReadContent".to_owned(),
        })
    );
}

#[test]
fn macro_inmem_reads_its_namespaced_tool_name() {
    let frame = Frame::new().meta(json!({"macro": {"toolName": "ReadContent"}}));
    assert_eq!(
        Harness::Macro.reader().reported_tool_name(&frame.view()),
        Some(ToolName::native("ReadContent"))
    );
    // Another harness's namespace is not this one's.
    let other = Frame::new().meta(json!({"claudeCode": {"toolName": "Bash"}}));
    assert_eq!(
        Harness::Macro.reader().reported_tool_name(&other.view()),
        None
    );
}

/// Terminal output is a client extension every harness writes the same way,
/// so the generic reader answers it for a harness the fold does not know -
/// and a write is a chunk to append, the way the terminal it mirrors
/// received it.
#[test]
fn terminal_output_and_exit_are_read_for_any_harness() {
    let frame = Frame::new().meta(json!({
        "terminal_output": {"terminal_id": "t1", "data": "\u{1b}[0mhello"},
        "terminal_exit": {"terminal_id": "t1", "exit_code": 2, "signal": null},
    }));
    for harness in [
        Harness::Unknown,
        Harness::ClaudeCode,
        Harness::Macro,
        Harness::Codex,
        Harness::Cursor,
    ] {
        let reader = harness.reader();
        assert_eq!(
            reader.terminal_output(&frame.view()),
            Some(TerminalOutput::Chunk("\u{1b}[0mhello".to_owned())),
            "{harness:?}"
        );
        assert_eq!(
            reader.terminal_exit_code(&frame.view()),
            Some(2),
            "{harness:?}"
        );
    }
}

/// codex-acp spells the same stream `terminal_output_delta` for a client
/// that did not advertise the extension; it is the same chunk.
#[test]
fn terminal_output_delta_is_the_same_stream() {
    let frame = Frame::new().meta(json!({
        "terminal_output_delta": {"terminal_id": "t1", "data": "partial"},
    }));
    assert_eq!(
        generic::terminal_output(&frame.view()),
        Some(TerminalOutput::Chunk("partial".to_owned()))
    );
}

/// A harness that reports through ACP's own `content` - OpenCode while a
/// command runs - sends the output so far, which replaces what was held;
/// the same block on a call still pending is not output at all.
#[test]
fn text_content_is_a_snapshot_once_the_command_runs() {
    let running = Frame::new()
        .kind(ToolKind::Execute)
        .status(ToolStatus::Running)
        .text("line 1\nline 2\n");
    assert_eq!(
        generic::terminal_output(&running.view()),
        Some(TerminalOutput::Snapshot("line 1\nline 2\n".to_owned()))
    );

    let pending = Frame::new()
        .kind(ToolKind::Execute)
        .status(ToolStatus::Pending)
        .text("List the files");
    assert_eq!(generic::terminal_output(&pending.view()), None);
    let unknown_status = Frame::new().kind(ToolKind::Execute);
    assert_eq!(generic::terminal_output(&unknown_status.view()), None);

    // A write on the frame outranks its content: the stream is the output,
    // and a text block beside it is whatever else the harness had to say.
    let both = Frame::new()
        .status(ToolStatus::Running)
        .meta(json!({"terminal_output": {"terminal_id": "t1", "data": "x"}}))
        .text("ignored");
    assert_eq!(
        generic::terminal_output(&both.view()),
        Some(TerminalOutput::Chunk("x".to_owned()))
    );
}

/// The two readings compose differently: chunks accumulate, a snapshot
/// starts over.
#[test]
fn chunks_append_and_snapshots_replace() {
    let mut held = None;
    TerminalOutput::Chunk("a".to_owned()).apply_to(&mut held);
    TerminalOutput::Chunk("b".to_owned()).apply_to(&mut held);
    assert_eq!(held.as_deref(), Some("ab"));
    TerminalOutput::Snapshot("whole".to_owned()).apply_to(&mut held);
    assert_eq!(held.as_deref(), Some("whole"));
    TerminalOutput::Chunk("!".to_owned()).apply_to(&mut held);
    assert_eq!(held.as_deref(), Some("whole!"));
}

/// Claude Code without the extension fences the output as a `console` code
/// block, a rendering hint that is not part of what the command printed.
#[test]
fn claude_code_unfences_console_output() {
    let reader = Harness::ClaudeCode.reader();
    let fenced = Frame::new()
        .status(ToolStatus::Completed)
        .text("```console\nsrc\nCargo.toml\n```");
    assert_eq!(
        reader.terminal_output(&fenced.view()),
        Some(TerminalOutput::Snapshot("src\nCargo.toml".to_owned()))
    );
    let bare = Frame::new().status(ToolStatus::Completed).text("plain");
    assert_eq!(
        reader.terminal_output(&bare.view()),
        Some(TerminalOutput::Snapshot("plain".to_owned()))
    );
    let streamed = Frame::new().meta(json!({
        "terminal_output": {"terminal_id": "t", "data": "```console\nnot a fence to strip\n```"},
    }));
    assert_eq!(
        reader.terminal_output(&streamed.view()),
        Some(TerminalOutput::Chunk(
            "```console\nnot a fence to strip\n```".to_owned()
        ))
    );
}

/// codex-acp's closing frame repeats the whole output and carries the exit
/// code in `rawOutput`, which is read when no `_meta` says otherwise.
#[test]
fn codex_reads_the_closing_raw_output() {
    let reader = Harness::Codex.reader();
    let closing = Frame::new()
        .status(ToolStatus::Completed)
        .raw_output(json!({"formatted_output": "10\n", "exit_code": 0}));
    assert_eq!(
        reader.terminal_output(&closing.view()),
        Some(TerminalOutput::Snapshot("10\n".to_owned()))
    );
    assert_eq!(reader.terminal_exit_code(&closing.view()), Some(0));

    let silent = Frame::new()
        .status(ToolStatus::Failed)
        .raw_output(json!({"formatted_output": "", "exit_code": 127}));
    assert_eq!(reader.terminal_output(&silent.view()), None);
    assert_eq!(reader.terminal_exit_code(&silent.view()), Some(127));

    // `_meta` outranks it, on both counts.
    let streamed = Frame::new()
        .status(ToolStatus::Completed)
        .meta(json!({
            "terminal_output": {"terminal_id": "t", "data": "tail"},
            "terminal_exit": {"terminal_id": "t", "exit_code": 1, "signal": null},
        }))
        .raw_output(json!({"formatted_output": "whole", "exit_code": 0}));
    assert_eq!(
        reader.terminal_output(&streamed.view()),
        Some(TerminalOutput::Chunk("tail".to_owned()))
    );
    assert_eq!(reader.terminal_exit_code(&streamed.view()), Some(1));
}

/// Cursor reports a shell command's output only in the result envelope its
/// translator writes to `rawOutput` once the command has finished.
#[test]
fn cursor_reads_shell_output_from_its_result_envelope() {
    let reader = Harness::Cursor.reader();
    let success =
        Frame::new()
            .status(ToolStatus::Completed)
            .raw_output(json!({"result": {"success": {
            "command": "echo $((5 + 5))", "stdout": "10\n", "interleavedOutput": "10\n",
            "executionTime": 367
        }, "isBackground": false}}));
    assert_eq!(
        reader.terminal_output(&success.view()),
        Some(TerminalOutput::Snapshot("10\n".to_owned()))
    );
    assert_eq!(reader.terminal_exit_code(&success.view()), Some(0));

    let failure =
        Frame::new()
            .status(ToolStatus::Failed)
            .raw_output(json!({"result": {"failure": {
                "stderr": "sh: nope: not found\n", "exitCode": 127
            }}}));
    assert_eq!(
        reader.terminal_output(&failure.view()),
        Some(TerminalOutput::Snapshot("sh: nope: not found\n".to_owned()))
    );
    assert_eq!(reader.terminal_exit_code(&failure.view()), Some(127));

    // A running frame has no result yet, and a result for something else
    // is not shell output.
    let running = Frame::new()
        .status(ToolStatus::Running)
        .raw_input(json!({"command": "sleep 1"}));
    assert_eq!(reader.terminal_output(&running.view()), None);
    assert_eq!(reader.terminal_exit_code(&running.view()), None);
    let other = Frame::new()
        .status(ToolStatus::Completed)
        .raw_output(json!({"result": {"error": "boom"}}));
    assert_eq!(reader.terminal_output(&other.view()), None);
    assert_eq!(reader.terminal_exit_code(&other.view()), None);
}

/// Three signals make a call a terminal, and any one is enough.
#[test]
fn recognizes_a_terminal_by_kind_content_or_announcement() {
    assert!(is_terminal(&Frame::new().kind(ToolKind::Execute).view()));
    assert!(is_terminal(
        &Frame::new().kind(ToolKind::Other).terminal("t1").view()
    ));
    assert!(is_terminal(
        &Frame::new()
            .kind(ToolKind::Other)
            .meta(json!({"terminal_info": {"terminal_id": "t1"}}))
            .view()
    ));
    assert!(!is_terminal(&Frame::new().kind(ToolKind::Other).view()));
    assert!(!is_terminal(&Frame::new().view()));

    let embedded = Frame::new().terminal("t1").text("x");
    assert_eq!(embedded.view().embedded_terminal(), Some("t1"));
    assert_eq!(
        Frame::new().text("x").view().embedded_terminal(),
        None,
        "a text block embeds no terminal"
    );
}

/// Missing keys, misshapen values, and absent meta all mean "no information".
#[test]
fn tolerates_absence_and_noise() {
    let reader = Harness::ClaudeCode.reader();
    let empty = Frame::new();
    assert_eq!(reader.reported_tool_name(&empty.view()), None);
    assert_eq!(generic::terminal_output(&empty.view()), None);
    assert_eq!(generic::terminal_exit_code(&empty.view()), None);

    let noise = Frame::new().meta(json!({
        "claudeCode": "not an object",
        "terminal_output": {"data": 7},
        "terminal_exit": {"exit_code": "zero"},
    }));
    assert_eq!(reader.reported_tool_name(&noise.view()), None);
    assert_eq!(generic::terminal_output(&noise.view()), None);
    assert_eq!(generic::terminal_exit_code(&noise.view()), None);
}

#[test]
fn reads_a_command_from_raw_input() {
    let input = json!({"command": "ls -la", "description": "list"});
    assert_eq!(
        command_from_raw_input(Some(&input)),
        Some("ls -la".to_owned())
    );
    assert_eq!(command_from_raw_input(Some(&json!({}))), None);
    assert_eq!(command_from_raw_input(None), None);
}

#[test]
fn recognizes_harnesses_from_their_announced_names() {
    let cases = [
        ("@agentclientprotocol/claude-agent-acp", Harness::ClaudeCode),
        ("Claude Agent", Harness::ClaudeCode),
        ("OpenCode", Harness::OpenCode),
        ("codex-acp", Harness::Codex),
        ("cursor-acp", Harness::Cursor),
        ("macro-inmem", Harness::Macro),
        ("hermes-agent", Harness::Hermes),
        ("openclaw", Harness::OpenClaw),
        ("zed", Harness::Unknown),
        ("", Harness::Unknown),
    ];
    for (name, expected) in cases {
        assert_eq!(Harness::from_agent_info(name), expected, "{name:?}");
        if expected != Harness::Unknown {
            assert!(
                expected.reader().announces(name),
                "{expected:?} claims {name:?}"
            );
        }
        assert!(
            !Harness::Unknown.reader().announces(name),
            "Unknown is what is left, never a match"
        );
    }
}

#[test]
fn sniffs_a_harness_from_the_frames_it_wrote() {
    let claude =
        Frame::new().meta(json!({"claudeCode": {"toolName": "Bash"}, "terminal_output": {}}));
    assert_eq!(Harness::sniff(&claude.view()), Some(Harness::ClaudeCode));
    let macro_ = Frame::new().meta(json!({"macro": {"toolName": "ReadContent"}}));
    assert_eq!(Harness::sniff(&macro_.view()), Some(Harness::Macro));
    let anonymous = Frame::new().meta(json!({"terminal_output": {"data": "x"}}));
    assert_eq!(Harness::sniff(&anonymous.view()), None);
    assert_eq!(Harness::sniff(&Frame::new().view()), None);
}

/// Every harness resolves to a reader, and the unknown one reads generically
/// and claims nothing.
#[test]
fn every_harness_has_a_reader() {
    for harness in [
        Harness::ClaudeCode,
        Harness::OpenCode,
        Harness::Codex,
        Harness::Cursor,
        Harness::Macro,
        Harness::Hermes,
        Harness::OpenClaw,
        Harness::Unknown,
    ] {
        let _ = harness.reader();
    }
    let frame = Frame::new().meta(json!({"claudeCode": {}, "macro": {}, "codex": {}}));
    assert!(!Harness::Unknown.reader().wrote(&frame.view()));
}
