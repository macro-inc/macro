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
        ("PUT", "/suggestions/01a1/draft"),
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
        ("POST", "/suggestionsx"),
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
    assert!(!matches("/mysuggestions", "/suggestions"));
    assert!(!matches("/a/b/suggestions", "/suggestions"));
    assert!(!matches("/scheduled-actionx/suggestions", "/suggestions"));
}

#[test]
fn a_scope_is_stored_by_name() {
    assert_eq!(
        SessionScope::parse(SessionScope::Generation.as_str()),
        Some(SessionScope::Generation)
    );
    assert_eq!(SessionScope::parse("unknown"), None);
}

/// A run that sends nothing changes the person's own items but never sends,
/// posts, shares, invites, sets up a routine, or starts work with the
/// person's full access.
#[test]
fn a_run_that_sends_nothing_reaches_nobody() {
    let scope = SessionScope::NoSend;
    for (method, path) in [
        ("GET", "/email/threads/abc"),
        ("POST", "/documents"),
        ("PATCH", "/documents/01a1"),
        ("POST", "/email/drafts"),
        ("POST", "/dss/search"),
        ("PATCH", "/email/threads/01a1/archived"),
        // Presenting a review asks the person; removing a queued prompt
        // starts nothing.
        ("POST", "/agent-harness/agent-sessions/01a1/reviews"),
        ("DELETE", "/agent-sessions/01a1/queue/02b2"),
    ] {
        assert!(scope.allows(method, path), "{method} {path}");
    }
    for (method, path) in [
        ("POST", "/email/messages"),
        ("POST", "/cognition/email/send-confirmed"),
        // Work that runs with the person's full access.
        ("POST", "/agent-harness/agent-sessions"),
        ("POST", "/agent-sessions/01a1/control"),
        ("PUT", "/agent-sessions/01a1/queue/02b2"),
        ("POST", "/agent-sessions/01a1/queue/02b2/steer"),
        ("POST", "/agent-sessions/01a1/tool-approvals/02b2"),
        ("POST", "/agent-sessions/01a1/reviews/02b2"),
        ("PATCH", "/agent-sessions/01a1/permissions"),
        ("POST", "/agent-harness/agent-sessions/warm"),
        ("POST", "/agent-sessions/01a1/app-connections"),
        ("POST", "/cognition/chats/01a1/tool/call"),
        ("POST", "/cognition/chats/01a1/tool/update"),
        ("POST", "/cognition/chats/01a1/tool/response/update"),
        // Agents and bots act later, with the person's access.
        ("POST", "/agents"),
        ("PUT", "/agents/01a1"),
        ("PATCH", "/agents/01a1"),
        ("PUT", "/auth/agents/01a1/api-key"),
        ("POST", "/bots"),
        ("PATCH", "/bots/01a1"),
        ("DELETE", "/bots/01a1"),
        ("DELETE", "/bots/01a1/tokens/02b2"),
        // Credentials, also refused to any credential that signs a scope.
        ("POST", "/bots/01a1/tokens"),
        ("POST", "/harness-pairings/ABCD-1234/approve"),
        // The computers agents run on.
        ("PATCH", "/harnesses/01a1"),
        ("DELETE", "/harnesses/me"),
        ("PUT", "/harnesses/01a1/team-access"),
        ("POST", "/agent-harness/harnesses/01a1/claude-sign-out"),
        // Shares and access requests.
        ("PATCH", "/external-chats/01a1/permissions"),
        ("PATCH", "/crm/pipelines/01a1/permissions"),
        ("PATCH", "/databases/01a1/permissions"),
        ("PATCH", "/forms/01a1/permissions"),
        ("PUT", "/entities/document/01a1/direct-access/02b2"),
        ("DELETE", "/entities/document/01a1/direct-access/02b2"),
        ("PUT", "/entities/document/01a1/access-requests/mine"),
        (
            "POST",
            "/entities/document/01a1/access-requests/02b2/resolve",
        ),
        ("PUT", "/email/drafts/scheduled/01a1"),
        ("POST", "/dss/messages/channel/01a1"),
        ("POST", "/channels/01a1/shares"),
        ("POST", "/events"),
        ("POST", "/scheduled-actions"),
        (
            "POST",
            "/agent-sessions/a/code-executions/b/connected-apps/slack/send/calls",
        ),
        ("POST", "/team/invite"),
    ] {
        assert!(!scope.allows(method, path), "{method} {path}");
    }
    assert_eq!(SessionScope::parse(scope.as_str()), Some(scope));
}

/// A service with no database reads the scope from the credential's signed
/// claim; a name it doesn't know allows only reads.
#[test]
fn a_signed_scope_is_read_from_its_claim() {
    assert_eq!(SignedScope::from_claim(None), SignedScope::Unscoped);
    for scope in [SessionScope::Generation, SessionScope::NoSend] {
        assert_eq!(
            SignedScope::from_claim(Some(scope.as_str())),
            SignedScope::Known(scope)
        );
    }
    let unknown = SignedScope::from_claim(Some("newer"));
    assert_eq!(unknown, SignedScope::Unknown);
    assert!(unknown.allows("GET", "/api/file/01a1/presigned-url"));
    for (method, path) in [
        ("DELETE", "/api/file/01a1"),
        ("PUT", "/api/file"),
        ("POST", "/dss/search"),
    ] {
        assert!(!unknown.allows(method, path), "{method} {path}");
    }

    let generation = SignedScope::Known(SessionScope::Generation);
    assert!(!generation.allows("DELETE", "/api/file/01a1"));
    assert!(!generation.allows("POST", "/internal/file/bulk-delete"));
    assert!(generation.allows("POST", "/dss/search"));
    assert!(SignedScope::Unscoped.allows("DELETE", "/api/file/01a1"));
}

/// GraphQL runs mutations behind one path, by POST or over a WebSocket that
/// opens with a GET, so no scope reaches it, under any service prefix.
#[test]
fn no_scope_reaches_graphql() {
    for scope in [
        SignedScope::Known(SessionScope::Generation),
        SignedScope::Known(SessionScope::NoSend),
        SignedScope::Unknown,
    ] {
        for (method, path) in [
            ("POST", "/soup/graphql"),
            ("POST", "/dss/soup/graphql"),
            ("GET", "/soup/graphql/ws"),
            ("GET", "/dss/soup/graphql/ws"),
        ] {
            assert!(!scope.allows(method, path), "{scope:?} {method} {path}");
        }
        assert!(scope.allows("GET", "/dss/documents/01a1"), "{scope:?}");
    }
    assert!(SignedScope::Unscoped.allows("POST", "/dss/soup/graphql"));
}
