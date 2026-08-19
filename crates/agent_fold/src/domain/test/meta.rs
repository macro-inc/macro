use crate::domain::meta::{claude_code, command_from_raw_input};
use agent_client_protocol::schema::v1::Meta;
use serde_json::json;

fn meta_of(value: serde_json::Value) -> Meta {
    match value {
        serde_json::Value::Object(map) => map,
        other => panic!("meta must be an object, got {other}"),
    }
}

#[test]
fn reads_the_harness_tool_name() {
    let meta = meta_of(json!({"claudeCode": {"toolName": "Bash"}}));
    assert_eq!(claude_code::tool_name(Some(&meta)), Some("Bash".to_owned()));
}

#[test]
fn reads_terminal_output_and_exit() {
    let meta = meta_of(json!({
        "terminal_output": {"terminal_id": "t1", "data": "\u{1b}[0mhello"},
        "terminal_exit": {"terminal_id": "t1", "exit_code": 2, "signal": null},
    }));
    assert_eq!(
        claude_code::terminal_output(Some(&meta)),
        Some("\u{1b}[0mhello".to_owned())
    );
    assert_eq!(claude_code::terminal_exit_code(Some(&meta)), Some(2));
}

/// Missing keys, misshapen values, and absent meta all mean "no information".
#[test]
fn tolerates_absence_and_noise() {
    assert_eq!(claude_code::tool_name(None), None);
    assert_eq!(claude_code::terminal_output(None), None);
    assert_eq!(claude_code::terminal_exit_code(None), None);

    let noise = meta_of(json!({
        "claudeCode": "not an object",
        "terminal_output": {"data": 7},
        "terminal_exit": {"exit_code": "zero"},
    }));
    assert_eq!(claude_code::tool_name(Some(&noise)), None);
    assert_eq!(claude_code::terminal_output(Some(&noise)), None);
    assert_eq!(claude_code::terminal_exit_code(Some(&noise)), None);
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
