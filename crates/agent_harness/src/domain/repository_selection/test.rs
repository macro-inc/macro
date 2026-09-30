use super::*;
use agent_session::domain::model::AgentSessionId;

fn candidates() -> Vec<String> {
    vec![
        "https://github.com/macro-inc/macro".into(),
        "https://github.com/macro-inc/infra".into(),
    ]
}

fn session(url: Option<&str>) -> AgentSession {
    let mut session = agent_session::testing::test_agent_session(AgentSessionId::new());
    session.repo_url = url.map(str::to_owned);
    session
}

#[test]
fn fallback_uses_the_most_recent_accessible_repository() {
    let recent = vec![
        session(None),
        session(Some("https://github.com/other/private")),
        session(Some("https://github.com/MACRO-INC/infra.git")),
        session(Some("https://github.com/macro-inc/macro")),
    ];
    assert_eq!(
        fallback_repository(&candidates(), &recent).unwrap(),
        "https://github.com/macro-inc/infra"
    );
}

#[test]
fn first_time_users_get_the_first_candidate() {
    assert_eq!(
        fallback_repository(&candidates(), &[]).unwrap(),
        "https://github.com/macro-inc/macro"
    );
}

#[test]
fn stale_history_cannot_grant_repository_access() {
    let recent = vec![session(Some("https://github.com/other/private"))];
    assert_eq!(
        fallback_repository(&candidates(), &recent).unwrap(),
        "https://github.com/macro-inc/macro"
    );
    assert!(fallback_repository(&[], &recent).is_err());
}

/// An answer naming something nobody offered is an error, not a pick: the
/// schema already excluded it, so a miss is a model ignoring the list.
#[test]
fn a_repository_outside_the_candidates_is_refused() {
    let error = intent(&candidates(), "https://github.com/someone-else/secrets")
        .expect_err("a non-candidate is refused");
    assert!(
        error
            .to_string()
            .contains("not one of this user's repositories"),
        "{error}"
    );
}

#[test]
fn a_selected_repository_enables_automatic_pull_requests() {
    let chosen =
        intent(&candidates(), "https://github.com/macro-inc/infra").expect("a candidate is taken");
    assert_eq!(
        chosen.repository.as_ref().map(RepoUrl::as_str),
        Some("https://github.com/macro-inc/infra")
    );
    assert!(chosen.open_pull_request);
}
