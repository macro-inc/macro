use super::*;

/// A generation session reads anything, writes only through its own tools
/// and drafts, and nothing else, whatever prefix the service serves under.
#[test]
fn a_generation_session_reads_and_writes_only_its_own_tools() {
    let scope = SessionScope::Generation;
    for (method, path) in [
        ("GET", "/email/threads/abc"),
        ("HEAD", "/documents/abc"),
        ("POST", "/scheduled-action/suggestions"),
        ("PATCH", "/scheduled-action/suggestions/01a1"),
        ("POST", "/dss/search"),
        ("POST", "/suggestions/01a1/retire"),
        ("POST", "/scheduled-actions/suggestions"),
        ("POST", "/scheduled-actions/suggestions/01a1/retire"),
        ("POST", "/email/drafts"),
        ("POST", "/cognition/structured-completion"),
        ("POST", "/search"),
        ("POST", "/crm/pipelines/01a1/rows"),
    ] {
        assert!(scope.allows(method, path), "{method} {path}");
    }
    for (method, path) in [
        ("POST", "/email/messages"),
        ("POST", "/email/drafts/01a1/transfer"),
        ("DELETE", "/email/drafts/01a1"),
        ("POST", "/suggestions/01a1/accept"),
        ("POST", "/suggestions/01a1/dismiss"),
        ("POST", "/scheduled-actions/suggestions/01a1/dismiss"),
        ("POST", "/scheduled-actions"),
        ("POST", "/channels/01a1/messages"),
        ("PATCH", "/documents/01a1"),
        ("PUT", "/suggestions/01a1"),
        ("POST", "/notes/search-and-delete"),
        ("POST", "/ideasx"),
        ("POST", "/web/search"),
    ] {
        assert!(!scope.allows(method, path), "{method} {path}");
    }
}

#[test]
fn a_template_matches_the_whole_path_under_at_most_one_service_prefix() {
    assert!(matches(
        "/scheduled-action/suggestions/1/retire",
        "/suggestions/{id}/retire"
    ));
    assert!(matches("/suggestions/", "/suggestions"));
    assert!(matches("/dss/search", "/search"));
    assert!(!matches("/web/search", "/search"));
    assert!(!matches("/cognition/web/search", "/search"));
    assert!(!matches("/suggestions//retire", "/suggestions/{id}/retire"));
    assert!(!matches("/myideas", "/suggestions"));
    assert!(!matches("/a/b/ideas", "/suggestions"));
    assert!(!matches("/scheduled-actionx/ideas", "/suggestions"));
}

#[test]
fn a_scope_is_stored_by_name() {
    assert_eq!(
        SessionScope::parse(SessionScope::Generation.as_str()),
        Some(SessionScope::Generation)
    );
    assert_eq!(SessionScope::parse("unknown"), None);
}
