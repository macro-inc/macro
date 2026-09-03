use crate::domain::harness::{self, macro_tools};
use crate::domain::model::{Harness, ToolName};
use crate::domain::test::util::Frame;
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
        macro_tools::mcp_tool(&parse("mcp__macro__ReadContent")),
        Some("ReadContent")
    );
    assert_eq!(
        macro_tools::mcp_tool(&parse("mcp__deepwiki__ReadContent")),
        None
    );
    assert_eq!(macro_tools::mcp_tool(&parse("ReadContent")), None);
}

#[test]
fn empty_is_the_name_of_a_call_that_named_nothing_yet() {
    assert!(parse("").is_empty());
    assert!(!parse("Bash").is_empty());
}

#[test]
fn a_harness_name_in_meta_outranks_the_title() {
    let named = Frame::new()
        .meta(json!({"claudeCode": {"toolName": "Bash"}}))
        .title("ls examples");
    let claude = Harness::ClaudeCode.reader();
    assert_eq!(
        harness::tool_name(claude, &named.view()),
        ToolName::native("Bash")
    );
    assert_eq!(
        harness::tool_name(claude, &Frame::new().title("ls examples").view()),
        parse("ls examples")
    );
    assert_eq!(
        harness::tool_name(
            claude,
            &Frame::new().title("mcp__macro__ReadContent").view()
        ),
        mcp("macro", "ReadContent")
    );
    // A harness that does not write that namespace reads only the title.
    let unknown = Harness::Unknown.reader();
    assert_eq!(
        harness::tool_name(unknown, &named.view()),
        parse("ls examples")
    );
    // A frame with neither names nothing, which a later patch may fill.
    assert!(harness::tool_name(claude, &Frame::new().view()).is_empty());
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
