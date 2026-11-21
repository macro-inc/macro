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
        ("POST", "/crm/previews"),
        ("POST", "/dss/crm/previews"),
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
        ("POST", "/crm/previews/01a1"),
        ("PUT", "/crm/previews"),
    ] {
        assert!(!scope.allows(method, path), "{method} {path}");
    }
}

/// Count previews and validation reveal no new content or sharing; policy
/// writes can contribute mail and remain outside every scoped credential.
#[test]
fn scoped_sessions_inspect_email_rules_without_changing_contribution() {
    for scope in [
        SessionScope::Generation,
        SessionScope::NoSend,
        SessionScope::DryRun,
    ] {
        for prefix in ["", "/dss/v1"] {
            for (method, path) in [
                ("GET", "/crm/email-privacy/policy"),
                ("POST", "/crm/email-privacy/policy/validate"),
                ("POST", "/crm/email-privacy/policy/preview"),
            ] {
                assert!(scope.allows(method, &format!("{prefix}{path}")));
            }
            assert!(!scope.allows("PUT", &format!("{prefix}/crm/email-privacy/policy")));
            assert_eq!(
                scope.allows(
                    "DELETE",
                    &format!("{prefix}/crm/email-privacy/policy/preview/01a1"),
                ),
                scope == SessionScope::NoSend,
            );
        }
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

/// Document storage, cognition and notification serve every route under an
/// API version too, so a template matches its versioned path, under a
/// service prefix or alone.
#[test]
fn a_template_matches_its_path_under_an_api_version() {
    assert!(matches(
        "/cognition/v1/email/send-confirmed",
        "/email/send-confirmed"
    ));
    assert!(matches(
        "/dss/v1/documents/1/comments/text",
        "/documents/{id}/comments/text"
    ));
    assert!(matches("/v2/web/fetch", "/web/fetch"));
    assert!(!matches("/cognition/v1/v1/web/fetch", "/web/fetch"));
    assert!(!matches("/cognition/vx/web/fetch", "/web/fetch"));
    assert!(!matches("/v1/cognition/web/fetch", "/web/fetch"));
}

/// Routers percent-decode the parameters they match (`/{version}`), so a
/// path is compared decoded: an encoded version, prefix or literal still
/// matches.
#[test]
fn a_template_matches_its_percent_encoded_path() {
    assert!(matches(
        "/dss/%76%31/items/soup/graphql",
        "/items/soup/graphql"
    ));
    assert!(matches(
        "/%64ss/v1/items/soup/graphql",
        "/items/soup/graphql"
    ));
    assert!(matches("/cognition/web/%66etch", "/web/fetch"));
    assert!(!SessionScope::NoSend.allows("POST", "/dss/%76%31/items/soup/graphql"));
    assert!(!SessionScope::NoSend.allows("POST", "/cognition/%76%31/email/send-confirmed"));
    assert!(!matches("/cognition/web%2Ffetch", "/web/fetch"));
}

/// A run that sends nothing is refused each of its sends under every service
/// prefix and API version.
#[test]
fn a_run_that_sends_nothing_is_refused_every_send_under_any_version() {
    for (method, template) in SessionScope::sends() {
        let path: String = template
            .split('/')
            .map(|segment| {
                if segment.starts_with('{') {
                    "x"
                } else {
                    segment
                }
            })
            .collect::<Vec<_>>()
            .join("/");
        for prefix in std::iter::once("").chain(SERVICE_PREFIXES.iter().copied()) {
            for version in ["", "/v1", "/v2"] {
                let sent = format!("{prefix}{version}{path}");
                assert!(
                    !SessionScope::NoSend.allows(method, &sent),
                    "{method} {sent}"
                );
            }
        }
    }
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
/// posts, shares, invites, pings, sets up a routine, or starts work with the
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
        // An agent may always restrict itself.
        (
            "POST",
            "/agent-harness/agents/01a1/tool-permissions/tighten",
        ),
    ] {
        assert!(scope.allows(method, path), "{method} {path}");
    }
    for (method, path) in [
        ("POST", "/email/messages"),
        ("POST", "/cognition/email/send-confirmed"),
        // Booking changes the guest or host hears of.
        ("POST", "/calendar/scheduling/bookings/01a1/approve"),
        ("POST", "/calendar/scheduling/bookings/01a1/attendance"),
        ("POST", "/calendar/scheduling/bookings/01a1/cancel"),
        ("POST", "/calendar/scheduling/public/someone/intro/book"),
        ("POST", "/calendar/scheduling/public/bookings/01a1/cancel"),
        (
            "POST",
            "/calendar/scheduling/public/bookings/01a1/reschedule",
        ),
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
        ("PUT", "/agent-harness/agents/01a1/tool-permissions"),
        ("DELETE", "/agents/01a1/tool-permissions"),
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
        ("POST", "/notification/v1/user_notifications/send"),
        ("POST", "/notification/user_notifications/send"),
        ("POST", "/user_notifications/send"),
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
    for scope in [
        SessionScope::Generation,
        SessionScope::NoSend,
        SessionScope::DryRun,
    ] {
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
        SignedScope::Known(SessionScope::DryRun),
        SignedScope::Unknown,
    ] {
        for (method, path) in [
            ("POST", "/items/soup/graphql"),
            ("POST", "/dss/items/soup/graphql"),
            ("POST", "/dss/v1/items/soup/graphql"),
            ("GET", "/items/soup/graphql/ws"),
            ("GET", "/dss/items/soup/graphql/ws"),
            ("GET", "/dss/v1/items/soup/graphql/ws"),
        ] {
            assert!(!scope.allows(method, path), "{scope:?} {method} {path}");
        }
        assert!(scope.allows("GET", "/dss/documents/01a1"), "{scope:?}");
    }
    assert!(SignedScope::Unscoped.allows("POST", "/dss/items/soup/graphql"));
}

/// A dry run reads, including the reads the SDK sends as POST, and writes
/// nothing, under any service prefix.
#[test]
fn a_dry_run_reads_and_writes_nothing() {
    let scope = SessionScope::DryRun;
    for (method, path) in [
        ("GET", "/email/threads/abc"),
        ("HEAD", "/documents/abc"),
        ("POST", "/dss/search"),
        ("POST", "/search"),
        ("POST", "/cognition/decisions"),
    ] {
        assert!(scope.allows(method, path), "{method} {path}");
    }
    for (method, path) in [
        ("POST", "/email/messages"),
        ("POST", "/email/drafts"),
        ("DELETE", "/email/drafts/01a1"),
        ("PUT", "/email/drafts/scheduled/01a1"),
        ("PATCH", "/documents/01a1"),
        ("POST", "/scheduled-action/suggestions"),
        ("POST", "/scheduled-actions"),
        ("POST", "/channels/01a1/messages"),
        ("POST", "/web/search"),
        ("POST", "/cognition/structured-completion"),
    ] {
        assert!(!scope.allows(method, path), "{method} {path}");
    }
    assert!(!scope.allows_sharing());
}
