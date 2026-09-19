use super::*;
use regex::Regex;

/// The pattern model providers enforce on every tool name they are sent. One
/// name that fails it rejects the whole request, so every mangled name we
/// produce is checked against it.
const PROVIDER_TOOL_NAME_PATTERN: &str = r"^[a-zA-Z0-9_-]{1,128}$";

fn assert_provider_valid(name: &MangledName) {
    let pattern = Regex::new(PROVIDER_TOOL_NAME_PATTERN).expect("pattern compiles");
    assert!(
        pattern.is_match(name.as_str()),
        "`{name}` does not match {PROVIDER_TOOL_NAME_PATTERN}"
    );
}

/// Mangle, assert the result is something a provider will accept, and return
/// the name plus whether sanitizing changed it.
fn mangle(server_name: &str, tool_name: &str) -> (MangledName, bool) {
    let Mangled { name, sanitized } = Mangled::new(server_name, tool_name);
    assert_provider_valid(&name);
    (name, sanitized)
}

#[test]
fn clean_names_are_left_byte_identical() {
    for (server, tool) in [
        ("Linear", "create_issue"),
        ("Notion", "search"),
        ("Slack", "post_message"),
        ("github-mcp", "list-pull-requests"),
    ] {
        let (name, sanitized) = mangle(server, tool);
        assert_eq!(name.as_str(), format!("mcp__{server}__{tool}"));
        assert!(!sanitized, "`{server}`/`{tool}` should not need sanitizing");
        assert_eq!(MangledName::parse(name.as_str()), Some((server, tool)));
    }
}

#[test]
fn spaces_in_the_server_name_become_underscores() {
    let (name, sanitized) = mangle("Google Sheets", "list_worksheets");

    assert_eq!(name.as_str(), "mcp__Google_Sheets__list_worksheets");
    assert!(sanitized);
    assert_eq!(
        MangledName::parse(name.as_str()),
        Some(("Google_Sheets", "list_worksheets"))
    );
}

#[test]
fn punctuation_and_non_ascii_are_replaced() {
    for (server, tool, expected_server, expected_tool) in [
        ("Notion.so", "search", "Notion_so", "search"),
        ("Zoom & Teams", "join(call)", "Zoom_Teams", "join_call"),
        (
            "Google Drive/Docs",
            "list.files",
            "Google_Drive_Docs",
            "list_files",
        ),
        ("Café Münster", "naïve_tool", "Caf_M_nster", "na_ve_tool"),
        ("Bücher 🇩🇪", "lesen!", "B_cher", "lesen"),
    ] {
        let (name, sanitized) = mangle(server, tool);

        assert!(sanitized, "`{server}`/`{tool}` should have been sanitized");
        assert_eq!(
            MangledName::parse(name.as_str()),
            Some((expected_server, expected_tool)),
            "unexpected mangling of `{server}`/`{tool}`: {name}"
        );
    }
}

#[test]
fn the_server_segment_never_contains_a_double_underscore() {
    // Each of these would produce `__` inside the server segment under a naive
    // one-for-one character replacement, which would make `parse` split in the
    // wrong place and report the wrong server.
    for (server, expected_server) in [
        ("A  B", "A_B"),
        ("A. B", "A_B"),
        ("A_ B", "A_B"),
        ("A__B", "A_B"),
        ("A.-B", "A_-B"),
        ("(A) (B)", "A_B"),
    ] {
        let (name, _) = mangle(server, "do_thing");

        let (parsed_server, parsed_tool) =
            MangledName::parse(name.as_str()).expect("mangled name parses");
        assert_eq!(parsed_server, expected_server, "for server `{server}`");
        assert_eq!(parsed_tool, "do_thing", "for server `{server}`");
        assert!(!parsed_server.contains("__"));
    }
}

#[test]
fn the_tool_segment_keeps_its_own_double_underscores() {
    // Only the server segment has to avoid `__`; `parse` splits on the first
    // one, so the tool segment can keep the name the server reported.
    let (name, sanitized) = mangle("Linear", "list__issues");

    assert!(!sanitized);
    assert_eq!(
        MangledName::parse(name.as_str()),
        Some(("Linear", "list__issues"))
    );
}

#[test]
fn a_long_server_name_is_truncated() {
    let server = "Very Long Connector Name ".repeat(20);
    let (name, sanitized) = mangle(&server, "list_worksheets");

    assert!(sanitized);
    assert!(name.as_str().len() <= 128);
    let (parsed_server, parsed_tool) =
        MangledName::parse(name.as_str()).expect("mangled name parses");
    assert!(parsed_server.starts_with("Very_Long_Connector_Name"));
    assert!(!parsed_server.ends_with('_'));
    assert_eq!(parsed_tool, "list_worksheets");
}

#[test]
fn a_long_tool_name_truncates_both_segments() {
    let tool = "a".repeat(200);
    let (name, sanitized) = mangle("Some Connector", &tool);

    assert!(sanitized);
    assert_eq!(name.as_str().len(), 128);
    let (parsed_server, parsed_tool) =
        MangledName::parse(name.as_str()).expect("mangled name parses");
    assert_eq!(parsed_server, "Some_Con");
    assert_eq!(parsed_tool, "a".repeat(113));
}

#[test]
fn truncation_never_leaves_a_dangling_underscore() {
    // `abcdefg_hij` cut to the 8-byte server floor lands exactly on `_`.
    let (name, _) = mangle("abcdefg hij", &"b".repeat(200));

    assert_eq!(name.as_str().len(), 5 + 7 + 2 + 114);
    assert_eq!(
        MangledName::parse(name.as_str()),
        Some(("abcdefg", "b".repeat(114).as_str()))
    );
}

#[test]
fn a_server_name_that_sanitizes_to_nothing_gets_a_placeholder() {
    for server in ["", "!!!", "   ", "日本語", "__"] {
        let (name, sanitized) = mangle(server, "do_thing");

        assert!(sanitized, "`{server}` should have been sanitized");
        assert_eq!(name.as_str(), "mcp__server__do_thing");
        assert_eq!(
            MangledName::parse(name.as_str()),
            Some(("server", "do_thing"))
        );
    }
}

#[test]
fn a_tool_name_that_sanitizes_to_nothing_gets_a_placeholder() {
    let (name, sanitized) = mangle("Linear", "###");

    assert!(sanitized);
    assert_eq!(name.as_str(), "mcp__Linear__tool");
    assert_eq!(MangledName::parse(name.as_str()), Some(("Linear", "tool")));
}

#[test]
fn sanitizing_can_collide_which_the_duplicate_check_skips() {
    // Two distinct server names can sanitize to the same segment; registration
    // relies on the equality of the mangled key to skip the second one.
    let (first, _) = mangle("Google Sheets", "list_worksheets");
    let (second, _) = mangle("Google/Sheets", "list_worksheets");

    assert_eq!(first, second);
}
