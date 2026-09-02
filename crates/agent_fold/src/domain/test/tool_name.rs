use crate::domain::harness;
use crate::domain::model::ToolName;
use agent_client_protocol::schema::v1::Meta;
use serde_json::json;

fn parse(name: &str) -> ToolName {
    name.parse().unwrap_or_else(|never| match never {})
}

fn mcp(server: &str, tool: &str) -> ToolName {
    ToolName::Mcp {
        server: server.to_owned(),
        tool: tool.to_owned(),
    }
}

#[test]
fn splits_claude_code_mcp_names_at_the_server_boundary() {
    assert_eq!(parse("mcp__macro__SendEmail"), mcp("macro", "SendEmail"));
    assert_eq!(parse("mcp__deepwiki__ask"), mcp("deepwiki", "ask"));
    // Single underscores inside either half are part of the name.
    assert_eq!(
        parse("mcp__macro__Bulk_Set_Options"),
        mcp("macro", "Bulk_Set_Options")
    );
    assert_eq!(parse("mcp__my_server__Tool"), mcp("my_server", "Tool"));
}

#[test]
fn everything_else_is_a_native_name() {
    for name in [
        "Bash", "Read", "Task", "mcp", "mcp__", "mcp__x", "mcp____x", "",
    ] {
        assert_eq!(parse(name), ToolName::native(name), "{name:?}");
    }
}

#[test]
fn display_drops_the_server_namespace() {
    assert_eq!(parse("mcp__macro__ReadContent").display(), "ReadContent");
    assert_eq!(parse("Bash").display(), "Bash");
}

#[test]
fn only_macro_mcp_names_are_macro_tools() {
    assert_eq!(
        parse("mcp__macro__ReadContent").macro_mcp_tool(),
        Some("ReadContent")
    );
    assert_eq!(parse("mcp__deepwiki__ReadContent").macro_mcp_tool(), None);
    assert_eq!(parse("ReadContent").macro_mcp_tool(), None);
}

#[test]
fn empty_is_the_name_of_a_call_that_named_nothing_yet() {
    assert!(parse("").is_empty());
    assert!(!parse("Bash").is_empty());
}

#[test]
fn a_harness_name_in_meta_outranks_the_title() {
    let meta: Meta = match json!({"claudeCode": {"toolName": "Bash"}}) {
        serde_json::Value::Object(map) => map,
        _ => unreachable!(),
    };
    assert_eq!(
        harness::tool_name(Some(&meta), "ls examples"),
        ToolName::native("Bash")
    );
    assert_eq!(
        harness::tool_name(None, "ls examples"),
        parse("ls examples")
    );
    assert_eq!(
        harness::tool_name(None, "mcp__macro__ReadContent"),
        mcp("macro", "ReadContent")
    );
}

#[test]
fn a_patch_names_the_tool_only_when_it_carries_a_name() {
    assert_eq!(harness::patched_tool_name(None, None), None);
    assert_eq!(
        harness::patched_tool_name(None, Some("Add 5+5")),
        Some(ToolName::native("Add 5+5"))
    );
}

#[test]
fn wire_form_is_a_tagged_union() {
    assert_eq!(
        serde_json::to_value(parse("Bash")).unwrap(),
        json!({"kind": "native", "name": "Bash"})
    );
    assert_eq!(
        serde_json::to_value(parse("mcp__macro__SendEmail")).unwrap(),
        json!({"kind": "mcp", "server": "macro", "tool": "SendEmail"})
    );
}
