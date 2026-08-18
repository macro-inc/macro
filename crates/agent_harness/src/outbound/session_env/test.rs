use agent_session::domain::model::AgentSessionId;

use super::*;

fn command(repo_url: Option<&str>, system_prompt: Option<&str>) -> SpawnContainer {
    SpawnContainer {
        session_id: AgentSessionId::TEST_A,
        repo_url: repo_url.map(str::to_owned),
        system_prompt: system_prompt.map(str::to_owned),
    }
}

/// The same clone credentials every provider injects, so the readiness recipe
/// runs against the environment a deployed sandbox sees.
#[test]
fn carries_the_repo_and_github_token() {
    let env = session_env(
        &command(Some("https://github.com/macro-inc/macro"), None),
        "test-token",
    );

    assert!(env.contains(&(
        "REPO_URL".to_owned(),
        "https://github.com/macro-inc/macro".to_owned()
    )));
    assert!(env.contains(&("GITHUB_TOKEN".to_owned(), "test-token".to_owned())));
}

/// A persona that named no repository must leave `REPO_URL` unset rather than
/// empty: absence is what tells the bootstrap to skip the clone and leave an
/// empty workspace.
#[test]
fn omits_the_repo_url_when_the_persona_named_none() {
    let env = session_env(&command(None, None), "test-token");

    assert!(!env.iter().any(|(key, _)| key == "REPO_URL"));
}

/// The prompt file is always written, so the variable is always set — empty
/// when the persona has no instructions.
#[test]
fn always_sets_the_persona_prompt() {
    let with = session_env(&command(None, Some("u r burger bot")), "test-token");
    assert!(with.contains(&(
        "MACRO_PERSONA_PROMPT".to_owned(),
        "u r burger bot".to_owned()
    )));

    let without = session_env(&command(None, None), "test-token");
    assert!(without.contains(&("MACRO_PERSONA_PROMPT".to_owned(), String::new())));
}
