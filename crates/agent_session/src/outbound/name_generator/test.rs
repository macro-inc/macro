use super::clean_agent_session_name;

#[test]
fn trims_quotes_and_collapses_whitespace() {
    assert_eq!(
        clean_agent_session_name("  \"Fix   Flaky\nTests\"  "),
        "Fix Flaky Tests"
    );
}

#[test]
fn limits_length() {
    let raw = "a".repeat(120);
    assert_eq!(clean_agent_session_name(&raw).len(), 100);
}
