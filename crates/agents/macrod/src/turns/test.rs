use super::*;

#[test]
fn a_prompt_runs_until_its_response_arrives() {
    let turns = ActiveTurns::default();

    turns.observe(
        r#"{"jsonrpc":"2.0","id":7,"method":"session/prompt","params":{"sessionId":"s1","prompt":[]}}"#,
        LineDirection::Stdin,
    );
    assert!(!turns.is_idle());

    turns.observe(
        r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{}}}"#,
        LineDirection::Stdout,
    );
    turns.observe(
        r#"{"jsonrpc":"2.0","id":8,"result":{}}"#,
        LineDirection::Stdout,
    );
    assert!(
        !turns.is_idle(),
        "only the prompt's own response ends the turn"
    );

    turns.observe(
        r#"{"jsonrpc":"2.0","id":7,"result":{"stopReason":"end_turn"}}"#,
        LineDirection::Stdout,
    );
    assert!(turns.is_idle());
}

#[test]
fn an_error_response_ends_the_turn() {
    let turns = ActiveTurns::default();

    turns.observe(
        r#"{"jsonrpc":"2.0","id":"a","method":"session/prompt","params":{}}"#,
        LineDirection::Stdin,
    );
    turns.observe(
        r#"{"jsonrpc":"2.0","id":"a","error":{"code":-32603,"message":"boom"}}"#,
        LineDirection::Stdout,
    );

    assert!(turns.is_idle());
}

#[test]
fn an_agent_request_with_a_prompt_id_does_not_end_the_turn() {
    let turns = ActiveTurns::default();

    turns.observe(
        r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{}}"#,
        LineDirection::Stdin,
    );
    turns.observe(
        r#"{"jsonrpc":"2.0","id":1,"method":"session/request_permission","params":{}}"#,
        LineDirection::Stdout,
    );

    assert!(!turns.is_idle());
}

#[test]
fn other_requests_and_plain_text_are_not_turns() {
    let turns = ActiveTurns::default();

    turns.observe(
        r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/"}}"#,
        LineDirection::Stdin,
    );
    turns.observe("not json, mentions session/prompt", LineDirection::Stdin);
    turns.observe(
        r#"{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{}}"#,
        LineDirection::Stderr,
    );

    assert!(turns.is_idle());
}

#[test]
fn clearing_ends_every_turn() {
    let turns = ActiveTurns::default();
    turns.observe(
        r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{}}"#,
        LineDirection::Stdin,
    );
    turns.observe(
        r#"{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{}}"#,
        LineDirection::Stdin,
    );

    turns.clear();

    assert!(turns.is_idle());
}
