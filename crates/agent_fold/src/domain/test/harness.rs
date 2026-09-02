use crate::domain::harness::{HarnessReader, claude_code, command_from_raw_input, generic};
use crate::domain::model::{Harness, ToolName};
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
    assert_eq!(
        claude_code::ClaudeCode.meta_tool_name(Some(&meta)),
        Some(ToolName::native("Bash"))
    );

    let mcp = meta_of(json!({"claudeCode": {"toolName": "mcp__macro__ReadContent"}}));
    assert_eq!(
        claude_code::ClaudeCode.meta_tool_name(Some(&mcp)),
        Some(ToolName::Mcp {
            server: "macro".to_owned(),
            tool: "ReadContent".to_owned(),
        })
    );
}

#[test]
fn macro_inmem_reads_its_namespaced_tool_name() {
    let meta = meta_of(json!({"macro": {"toolName": "ReadContent"}}));
    assert_eq!(
        Harness::Macro.reader().meta_tool_name(Some(&meta)),
        Some(ToolName::native("ReadContent"))
    );
    // Another harness's namespace is not this one's.
    let other = meta_of(json!({"claudeCode": {"toolName": "Bash"}}));
    assert_eq!(Harness::Macro.reader().meta_tool_name(Some(&other)), None);
}

/// Terminal output is a client extension every harness writes the same way,
/// so the generic reader answers it for a harness the fold does not know.
#[test]
fn terminal_output_and_exit_are_read_for_any_harness() {
    let meta = meta_of(json!({
        "terminal_output": {"terminal_id": "t1", "data": "\u{1b}[0mhello"},
        "terminal_exit": {"terminal_id": "t1", "exit_code": 2, "signal": null},
    }));
    for harness in [Harness::Unknown, Harness::ClaudeCode, Harness::Macro] {
        let reader = harness.reader();
        assert_eq!(
            reader.terminal_output(Some(&meta)),
            Some("\u{1b}[0mhello".to_owned()),
            "{harness:?}"
        );
        assert_eq!(
            reader.terminal_exit_code(Some(&meta)),
            Some(2),
            "{harness:?}"
        );
    }
}

/// Missing keys, misshapen values, and absent meta all mean "no information".
#[test]
fn tolerates_absence_and_noise() {
    let reader = Harness::ClaudeCode.reader();
    assert_eq!(reader.meta_tool_name(None), None);
    assert_eq!(generic::terminal_output(None), None);
    assert_eq!(generic::terminal_exit_code(None), None);

    let noise = meta_of(json!({
        "claudeCode": "not an object",
        "terminal_output": {"data": 7},
        "terminal_exit": {"exit_code": "zero"},
    }));
    assert_eq!(reader.meta_tool_name(Some(&noise)), None);
    assert_eq!(generic::terminal_output(Some(&noise)), None);
    assert_eq!(generic::terminal_exit_code(Some(&noise)), None);
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
    }
}

#[test]
fn sniffs_a_harness_from_its_meta_namespace() {
    let claude = meta_of(json!({"claudeCode": {"toolName": "Bash"}, "terminal_output": {}}));
    assert_eq!(
        Harness::sniff_meta(Some(&claude)),
        Some(Harness::ClaudeCode)
    );
    let macro_ = meta_of(json!({"macro": {"toolName": "ReadContent"}}));
    assert_eq!(Harness::sniff_meta(Some(&macro_)), Some(Harness::Macro));
    let anonymous = meta_of(json!({"terminal_output": {"data": "x"}}));
    assert_eq!(Harness::sniff_meta(Some(&anonymous)), None);
    assert_eq!(Harness::sniff_meta(None), None);
}

/// Every harness resolves to a reader, and the unknown one reads generically.
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
    assert_eq!(Harness::Unknown.reader().meta_namespace(), None);
}
