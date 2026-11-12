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
fn refuse_agent_run_forbids_programs_and_admits_people() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    for (agent_attributed, headers) in [(true, &browser), (false, &program)] {
        let refused = refuse_agent_run(agent_attributed, headers, "do this in the app").unwrap_err();
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(refused.message, "do this in the app");
    }
    assert!(refuse_agent_run(false, &browser, "do this in the app").is_ok());
}
