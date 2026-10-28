use crate::domain::harness::{HarnessReader, claude_code, command_from_raw_input, generic};
use crate::domain::model::{Harness, ToolName};
use crate::domain::test::util::Frame;
use agent_client_protocol::schema::v1::Meta;
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
/// so the generic reader answers it for a harness the fold does not know.
#[test]
fn terminal_output_and_exit_are_read_for_any_harness() {
    let frame = Frame::new().meta(json!({
        "terminal_output": {"terminal_id": "t1", "data": "\u{1b}[0mhello"},
        "terminal_exit": {"terminal_id": "t1", "exit_code": 2, "signal": null},
    }));
    for harness in [Harness::Unknown, Harness::ClaudeCode, Harness::Macro] {
        let reader = harness.reader();
        assert_eq!(
            reader.terminal_output(&frame.view()),
            Some("\u{1b}[0mhello".to_owned()),
            "{harness:?}"
        );
        assert_eq!(
            reader.terminal_exit_code(&frame.view()),
            Some(2),
            "{harness:?}"
        );
    }
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
