use super::*;

#[test]
fn a_code_mode_program_or_an_agent_token_counts_as_an_agent_run() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    assert!(is_agent_run(false, &program), "a public MCP code-mode run");
    assert!(is_agent_run(true, &browser), "an agent-attributed token");
    assert!(!is_agent_run(false, &browser), "a person in the app");
}

#[test]
fn programs_and_routine_runs_may_not_receive_a_new_secret() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    assert!(
        is_program_minting(true, false, &browser),
        "an agent-attributed token"
    );
    assert!(
        is_program_minting(false, true, &browser),
        "an owner-identity routine run"
    );
    assert!(
        is_program_minting(false, false, &program),
        "the code-mode runtime"
    );
    assert!(
        !is_program_minting(false, false, &browser),
        "a person's session or API key"
    );
}
