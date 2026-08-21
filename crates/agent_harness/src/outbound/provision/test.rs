use super::ENSURE_READY_SCRIPT;

#[test]
fn clone_uses_session_egress_without_a_github_token() {
    assert!(ENSURE_READY_SCRIPT.contains("${MACRO_EGRESS_URL%/}/git"));
    assert!(ENSURE_READY_SCRIPT.contains("$MACRO_SESSION_TOKEN"));
    assert!(!ENSURE_READY_SCRIPT.contains("GITHUB_TOKEN"));
    assert!(!ENSURE_READY_SCRIPT.contains("REPO_URL"));
    assert!(!ENSURE_READY_SCRIPT.contains("gh auth"));
}
