use super::*;

#[test]
fn a_code_mode_program_or_an_agent_token_counts_as_an_agent_run() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    assert!(
        is_agent_run(CredentialAttribution::Person, &program),
        "a public MCP code-mode run"
    );
    assert!(
        is_agent_run(CredentialAttribution::Agent, &browser),
        "an agent-attributed token"
    );
    assert!(
        !is_agent_run(CredentialAttribution::Routine, &browser),
        "an owner routine step may still send and create"
    );
    assert!(
        !is_agent_run(CredentialAttribution::Person, &browser),
        "a person in the app"
    );
}

#[test]
fn every_program_counts_as_a_program_run() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    assert!(is_program_run(CredentialAttribution::Person, &program));
    assert!(is_program_run(CredentialAttribution::Agent, &browser));
    assert!(is_program_run(CredentialAttribution::Routine, &browser));
    assert!(!is_program_run(CredentialAttribution::Person, &browser));
}
