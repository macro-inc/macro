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
        // A bearer token for a document, valid an hour after the run.
        ("POST", "/dss/documents/permissions_token/01a1"),
        ("POST", "/v1/documents/permissions_token/01a1"),
        ("POST", "/dss/collab_surfaces/01a1/token"),
        ("POST", "/v1/collab_surfaces/01a1/token"),
        // Merging or closing a pull request reaches its repository.
        ("POST", "/auth/github_pull_requests/merge"),
        ("POST", "/auth/github_pull_requests/state"),
        // Pushes to other people's open apps, and the account itself.
        ("POST", "/connection-gateway/message/broadcast"),
        ("POST", "/dss/user-api-keys"),
        ("DELETE", "/auth/user/me"),
        ("POST", "/auth/team/invite-link/join"),
        ("PATCH", "/auth/user/ai_consent"),
        ("PATCH", "/dss/webhook/webhooks/01a1"),
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

/// Every spec name, as a service serving all of them would declare.
const ALL_SPECS: &[&str] = &[
    "agent-harness",
    "auth",
    "calendar",
    "cognition",
    "connection",
    "contacts",
    "email",
    "notification",
    "properties",
    "scheduled-action",
    "search",
    "static-files",
    "storage",
    "unfurl",
];

/// The services' OpenAPI specs, by the name their lists use.
const SPECS: &[(&str, &str)] = &[
    (
        "agent-harness",
        include_str!("../../../../packages/sdk/specs/agent-harness.json"),
    ),
    (
        "auth",
        include_str!("../../../../packages/sdk/specs/auth.json"),
    ),
    (
        "calendar",
        include_str!("../../../../packages/sdk/specs/calendar.json"),
    ),
    (
        "cognition",
        include_str!("../../../../packages/sdk/specs/cognition.json"),
    ),
    (
        "connection",
        include_str!("../../../../packages/sdk/specs/connection.json"),
    ),
    (
        "contacts",
        include_str!("../../../../packages/sdk/specs/contacts.json"),
    ),
    (
        "email",
        include_str!("../../../../packages/sdk/specs/email.json"),
    ),
    (
        "notification",
        include_str!("../../../../packages/sdk/specs/notification.json"),
    ),
    (
        "properties",
        include_str!("../../../../packages/sdk/specs/properties.json"),
    ),
    (
        "scheduled-action",
        include_str!("../../../../packages/sdk/specs/scheduled-action.json"),
    ),
    (
        "search",
        include_str!("../../../../packages/sdk/specs/search.json"),
    ),
    (
        "static-files",
        include_str!("../../../../packages/sdk/specs/static-files.json"),
    ),
    (
        "storage",
        include_str!("../../../../packages/sdk/specs/storage.json"),
    ),
    (
        "unfurl",
        include_str!("../../../../packages/sdk/specs/unfurl.json"),
    ),
];

/// A spec path with each `{…}` segment filled in, as a request sends it.
fn concrete(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            if segment.starts_with('{') {
                "x"
            } else {
                segment
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// A spec path as a request sends it, with each id placeholder filled with
/// an id and each word placeholder (`WORD_PLACEHOLDERS`) with a word.
fn concrete_typed(path: &str) -> String {
    path.split('/')
        .map(|segment| match segment {
            word if WORD_PLACEHOLDERS.contains(&word) => "document",
            id if id.starts_with('{') => "0192f1a0-0000-7000-8000-000000000001",
            literal => literal,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Every write a service's OpenAPI spec declares is classified for a run
/// that sends nothing: refused, one of the scope's POST reads, or reviewed
/// as a change to the person's own or shared items in `no_send_writes.txt`.
/// The refused list is hand-kept, so a new route that reaches someone else
/// must not slip through unclassified; a reviewed line that no longer names
/// an allowed write fails too, so the list stays true.
#[test]
fn the_no_send_scope_classifies_every_write_in_the_specs() {
    let mut reviewed = std::collections::BTreeSet::new();
    let mut service = "";
    for line in include_str!("no_send_writes.txt").lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            service = name;
            continue;
        }
        reviewed.insert(format!("{service} {line}"));
    }
    let scope = SessionScope::NoSend;
    let mut unclassified = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for (name, text) in SPECS {
        let spec: serde_json::Value = serde_json::from_str(text).unwrap();
        for (path, operations) in spec["paths"].as_object().unwrap() {
            for method in operations.as_object().unwrap().keys() {
                let method = method.to_uppercase();
                if !matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE") {
                    continue;
                }
                let key = format!("{name} {method} {path}");
                let allowed = scope.allows(&method, &concrete(path));
                let read = listed(POST_READS, &method, path);
                if allowed && !read {
                    if reviewed.contains(&key) {
                        seen.insert(key);
                    } else {
                        unclassified.push(key);
                    }
                }
            }
        }
    }
    let stale: Vec<_> = reviewed.difference(&seen).collect();
    assert!(
        unclassified.is_empty(),
        "classify each write: refuse it in SENDS, or review it into no_send_writes.txt: {unclassified:#?}"
    );
    assert!(
        stale.is_empty(),
        "no_send_writes.txt names writes the scope refuses or the specs no longer have: {stale:#?}"
    );
}

/// A background job makes exactly the requests on its lists: every spec
/// operation is allowed to a job if and only if one of its lists names it,
/// so no template reaches a route it doesn't name. Every list line names a
/// spec operation, and every spec read is placed: on the job's list or on
/// its refused list.
#[test]
fn a_job_classifies_every_read_and_allows_only_its_lists() {
    let scope = SessionScope::Job;
    let listed: std::collections::BTreeSet<(&str, &str, &str)> =
        list_lines(include_str!("job_reads.txt"))
            .chain(list_lines(include_str!("job_writes.txt")))
            .collect();
    let refused_reads: std::collections::BTreeSet<(&str, &str, &str)> =
        list_lines(include_str!("job_refused_reads.txt")).collect();
    let mut operations = std::collections::BTreeSet::new();
    let mut mismatched = Vec::new();
    let mut unplaced = Vec::new();
    for (name, text) in SPECS {
        let spec: serde_json::Value = serde_json::from_str(text).unwrap();
        for (path, methods) in spec["paths"].as_object().unwrap() {
            for method in methods.as_object().unwrap().keys() {
                let method = method.to_uppercase();
                if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
                    continue;
                }
                let key = (*name, method.as_str(), path.as_str());
                let on_list = listed.contains(&key);
                if scope.allows_on(Some(&[name]), &method, &concrete_typed(path)) != on_list {
                    mismatched.push(format!("{name} {method} {path} (listed: {on_list})"));
                }
                if method == "GET" && on_list == refused_reads.contains(&key) {
                    unplaced.push(format!("{name} GET {path}"));
                }
                operations.insert(format!("{name} {method} {path}"));
            }
        }
    }
    let unknown: Vec<_> = listed
        .iter()
        .chain(&refused_reads)
        .map(|(name, method, path)| format!("{name} {method} {path}"))
        .filter(|key| !operations.contains(key))
        .collect();
    assert!(
        mismatched.is_empty(),
        "a job's lists and scope disagree: {mismatched:#?}"
    );
    assert!(
        unplaced.is_empty(),
        "place each read in job_reads.txt or job_refused_reads.txt, once: {unplaced:#?}"
    );
    assert!(
        unknown.is_empty(),
        "list lines that name no spec operation: {unknown:#?}"
    );
}

/// A job is refused what its lists don't name: routes no spec declares,
/// fetches of caller-chosen URLs, credentials and sign-in flows, under any
/// service prefix or version.
#[test]
fn a_job_is_refused_whatever_its_lists_do_not_name() {
    let scope = SessionScope::Job;
    for (method, path) in [
        // Routes without a spec: registering a push token would send the
        // owner's notifications to another device, past the job.
        ("POST", "/notification/device/register"),
        ("POST", "/notification/v1/device/register"),
        ("POST", "/device/register"),
        ("DELETE", "/notification/device/unregister"),
        (
            "POST",
            "/agent-harness/preview/agent-sessions/0192f1a0-0000-7000-8000-000000000001/open",
        ),
        (
            "POST",
            "/agent-harness/agent-git/0192f1a0-0000-7000-8000-000000000001/repo.git/git-upload-pack",
        ),
        // Fetches a caller-chosen URL from Macro's servers.
        ("GET", "/unfurl/proxy"),
        ("GET", "/unfurl/unfurl"),
        ("POST", "/unfurl/unfurl/bulk"),
        ("GET", "/agent-harness/agent-repositories/branches"),
        // Credentials and sign-in.
        ("GET", "/auth/jwt/macro_api_token"),
        (
            "GET",
            "/dss/bots/0192f1a0-0000-7000-8000-000000000001/tokens",
        ),
        (
            "GET",
            "/dss/passwords/teams/0192f1a0-0000-7000-8000-000000000001/items",
        ),
        // Writes a job doesn't make, sends included.
        ("POST", "/email/messages"),
        ("POST", "/scheduled-actions"),
        ("PATCH", "/email/settings"),
        ("PATCH", "/dss/forms/0192f1a0-0000-7000-8000-000000000001"),
        (
            "PATCH",
            "/dss/webhook/webhooks/0192f1a0-0000-7000-8000-000000000001",
        ),
        (
            "DELETE",
            "/dss/documents/0192f1a0-0000-7000-8000-000000000001/permanent",
        ),
        // Drafts can go into an inbox someone delegated; team-wide CRM
        // records and tags; GETs that change something.
        ("POST", "/email/drafts"),
        ("POST", "/dss/crm/companies"),
        ("POST", "/properties/tags"),
        (
            "GET",
            "/auth/team/join/0192f1a0-0000-7000-8000-000000000001",
        ),
        ("GET", "/dss/call/0192f1a0-0000-7000-8000-000000000001"),
        (
            "POST",
            "/dss/chats/0192f1a0-0000-7000-8000-000000000001/tool/call",
        ),
        // Connected apps: a job uses none.
        (
            "GET",
            "/agent-harness/agent-sessions/0192f1a0-0000-7000-8000-000000000001/code-executions/0192f1a0-0000-7000-8000-000000000002/connected-apps",
        ),
        ("POST", "/items/soup/graphql"),
        // Changes to existing items, the owner's own included: an item's
        // audience would read what a job writes there.
        (
            "PUT",
            "/dss/documents/0192f1a0-0000-7000-8000-000000000001/markdown",
        ),
        (
            "PUT",
            "/properties/entities/document/0192f1a0-0000-7000-8000-000000000001/0192f1a0-0000-7000-8000-000000000002",
        ),
        (
            "PATCH",
            "/email/threads/0192f1a0-0000-7000-8000-000000000001/archived",
        ),
        (
            "POST",
            "/dss/databases/0192f1a0-0000-7000-8000-000000000001/ops",
        ),
        (
            "DELETE",
            "/dss/projects/0192f1a0-0000-7000-8000-000000000001",
        ),
        (
            "PUT",
            "/agent-harness/agent-sessions/0192f1a0-0000-7000-8000-000000000001/task",
        ),
        (
            "PUT",
            "/agent-harness/agent-sessions/0192f1a0-0000-7000-8000-000000000001/pull-requests",
        ),
        // An OPTIONS request with a job's token is not a browser preflight.
        ("OPTIONS", "/notification/device/register"),
        (
            "OPTIONS",
            "/dss/documents/0192f1a0-0000-7000-8000-000000000001",
        ),
        (
            "OPTIONS",
            "/agent-harness/preview/0192f1a0-0000-7000-8000-000000000001/x",
        ),
        // Typed placeholders: a word is no id, so an unannotated route that
        // differs from a listed one by a literal is refused.
        (
            "GET",
            "/dss/documents/0192f1a0-0000-7000-8000-000000000001/duplicates",
        ),
        (
            "GET",
            "/dss/documents/0192f1a0-0000-7000-8000-000000000001/cached_snapshot_url",
        ),
        ("GET", "/agent-harness/agent-sessions/unlisted"),
    ] {
        assert!(
            !scope.allows_on(Some(ALL_SPECS), method, path),
            "{method} {path}"
        );
    }
    for (method, path) in [
        ("GET", "/dss/documents/0192f1a0-0000-7000-8000-000000000001"),
        (
            "HEAD",
            "/dss/documents/0192f1a0-0000-7000-8000-000000000001",
        ),
        (
            "GET",
            "/properties/entities/document/0192f1a0-0000-7000-8000-000000000001",
        ),
        ("POST", "/search"),
        ("POST", "/scheduled-actions/check"),
        (
            "POST",
            "/agent-harness/agent-sessions/0192f1a0-0000-7000-8000-000000000001/reviews",
        ),
        ("PATCH", "/notification/v1/user_notifications/bulk/done"),
    ] {
        assert!(
            scope.allows_on(Some(ALL_SPECS), method, path),
            "{method} {path}"
        );
    }
    assert!(!scope.allows_sharing());
    assert_eq!(SessionScope::parse(scope.as_str()), Some(scope));
}

/// A job's allowed writes can't share an item out: under its scope every
/// route that changes sharing refuses (`refuse_sharing`), and the grant
/// writer never adds a grant (`may_share`).
#[tokio::test]
async fn a_job_shares_nothing_out() {
    let job = crate::context::Attribution {
        scope: Some(SessionScope::Job),
        ..Default::default()
    };
    crate::context::scope_attribution(job, async {
        assert!(!crate::context::may_share());
        assert!(crate::context::refuse_sharing(true).is_err());
        assert!(crate::context::refuse_sharing(false).is_ok());
    })
    .await;
}

/// A job reaches no one but its owner: it writes only into its own session
/// (a review it drafts, a view it presents: items the session creates and
/// its owner decides on), its owner's notification inbox, and a tool-free AI
/// completion. It changes no existing item, shared or not, so nothing it
/// writes lands where someone else reads.
#[test]
fn a_job_writes_only_its_session_and_its_owners_inbox() {
    let writes: Vec<(&str, &str, &str)> = list_lines(include_str!("job_writes.txt")).collect();
    assert_eq!(
        writes,
        [
            (
                "agent-harness",
                "POST",
                "/agent-sessions/{session_id}/reviews"
            ),
            (
                "agent-harness",
                "POST",
                "/agent-sessions/{session_id}/views"
            ),
            ("cognition", "POST", "/structured-completion"),
            ("notification", "PATCH", "/v1/user_notifications/bulk/done"),
            ("notification", "PATCH", "/v1/user_notifications/bulk/seen"),
            (
                "notification",
                "PATCH",
                "/v1/user_notifications/bulk/undone"
            ),
        ]
    );
    // Its reads write nothing either: no POST read on its list changes an
    // item.
    for (_, method, path) in list_lines(include_str!("job_reads.txt")) {
        assert!(
            method == "GET" || listed(POST_READS, method, path),
            "{method} {path} is on a job's reads but is no read"
        );
    }
}

/// A job's list entry counts only on the service its spec belongs to: the
/// same path on another service is refused, so a template can't reach a
/// route of another service that happens to share its shape.
#[test]
fn a_jobs_entries_count_only_on_their_own_service() {
    let scope = SessionScope::Job;
    let document = "/documents/0192f1a0-0000-7000-8000-000000000001";
    assert!(scope.allows_on(Some(&["storage", "properties", "search"]), "GET", document));
    assert!(!scope.allows_on(Some(&["notification"]), "GET", document));
    assert!(!scope.allows_on(
        Some(&["agent-harness", "cognition", "scheduled-action"]),
        "GET",
        document
    ));
    let review = "/agent-sessions/0192f1a0-0000-7000-8000-000000000001/reviews";
    assert!(scope.allows_on(Some(&["agent-harness"]), "POST", review));
    assert!(!scope.allows_on(Some(&["storage"]), "POST", review));
    // A signed job scope is held to the same binding.
    assert!(!SignedScope::Known(scope).allows_on(Some(&["notification"]), "GET", document));
    // Every entry is allowed on its own spec.
    for (spec, method, path) in
        list_lines(include_str!("job_reads.txt")).chain(list_lines(include_str!("job_writes.txt")))
    {
        assert!(
            scope.allows_on(Some(&[spec]), method, &concrete_typed(path)),
            "{spec} {method} {path}"
        );
    }
}

/// A job fails closed where a service declares no specs: nothing on its
/// lists counts there, so a service that forgets to declare them refuses
/// jobs rather than matching every service's entries.
#[test]
fn a_job_is_refused_on_a_service_that_declares_no_specs() {
    let scope = SessionScope::Job;
    let document = "/documents/0192f1a0-0000-7000-8000-000000000001";
    assert!(!scope.allows("GET", document));
    assert!(!scope.allows_on(None, "GET", document));
    assert!(!SignedScope::Known(scope).allows_on(None, "GET", document));
    assert!(scope.allows_on(Some(&["storage"]), "GET", document));
}

/// Every service that validates attribution declares the specs it serves,
/// so a job's entries count only on their own service; a signed-scope-only
/// service that a job reads uses the serving variant.
#[test]
fn every_service_declares_the_specs_it_serves() {
    fn rust_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                out.push(path);
            }
        }
    }
    let services = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../services");
    let mut files = Vec::new();
    // Each service's sources only; build output and local data stay out.
    for service in std::fs::read_dir(&services).unwrap().flatten() {
        rust_files(&service.path().join("src"), &mut files);
    }
    let mut undeclared = Vec::new();
    let mut states = 0;
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        for (index, _) in text.match_indices("CorrelationState::new(") {
            states += 1;
            let rest = &text[index..text.len().min(index + 400)];
            let statement = rest.split(';').next().unwrap_or_default();
            if !statement.contains(".serving(") {
                undeclared.push(format!("{}", file.display()));
            }
        }
    }
    assert!(states >= 8, "found {states} CorrelationState constructions");
    assert!(
        undeclared.is_empty(),
        "declare `.serving(&[specs])`: {undeclared:#?}"
    );
    let static_files =
        std::fs::read_to_string(services.join("static_file_service/src/api.rs")).unwrap();
    assert!(static_files.contains("enforce_signed_scope_serving"));
}

/// A job cannot widen itself: no hour-long document edit token, and no
/// route that adds an agent or bot to a task's assignees, which starts an
/// unscoped agent session acting for the owner.
#[test]
fn a_job_cannot_mint_a_document_token_or_assign_an_agent() {
    const A: &str = "0192f1a0-0000-7000-8000-000000000001";
    const B: &str = "0192f1a0-0000-7000-8000-000000000002";
    const C: &str = "0192f1a0-0000-7000-8000-000000000003";
    for (method, path) in [
        ("POST", format!("/dss/documents/permissions_token/{A}")),
        (
            "POST",
            "/dss/documents/permissions_token/validate".to_owned(),
        ),
        // Assignees: one property, its options, many entities, a project
        // its tasks inherit from, and a task created with them.
        ("PUT", format!("/properties/entities/task/{A}/{B}")),
        ("PUT", format!("/properties/entities/project/{A}/{B}")),
        (
            "POST",
            format!("/properties/entities/task/{A}/{B}/options/{C}"),
        ),
        (
            "POST",
            format!("/properties/entities/task/{A}/options/bulk"),
        ),
        ("POST", "/properties/options/bulk".to_owned()),
        ("POST", "/dss/documents/create_task".to_owned()),
        ("POST", "/dss/task_templates".to_owned()),
        ("PUT", format!("/dss/task_templates/{A}")),
        ("POST", "/items/soup/graphql".to_owned()),
    ] {
        assert!(
            !SessionScope::Job.allows_on(Some(ALL_SPECS), method, &path),
            "{method} {path}"
        );
    }
}

/// A job's writes go only into its own session: a write's `{session_id}` is
/// the credential's session, and with no session known it is refused. Its
/// reads of a session are not bound.
#[test]
fn a_job_writes_only_into_its_own_session() {
    let own = uuid::Uuid::from_u128(0xa);
    let other = uuid::Uuid::from_u128(0xb);
    let view = |session: uuid::Uuid| format!("/agent-harness/agent-sessions/{session}/views");
    let job = SessionScope::Job;
    let specs = Some(ALL_SPECS);
    assert!(job.allows_within(specs, OwnSession::Is(own), "POST", &view(own)));
    assert!(!job.allows_within(specs, OwnSession::Is(own), "POST", &view(other)));
    assert!(!job.allows_within(specs, OwnSession::Unknown, "POST", &view(own)));
    let review = format!("/agent-harness/agent-sessions/{other}/reviews");
    assert!(!job.allows_within(specs, OwnSession::Is(own), "POST", &review));
    // A signed-only check defers the binding to the correlation's.
    assert!(SignedScope::Known(job).allows_within(
        specs,
        OwnSession::Unchecked,
        "POST",
        &view(other)
    ));
    assert!(!SignedScope::Known(job).allows_within(
        specs,
        OwnSession::Is(own),
        "POST",
        &view(other)
    ));
}

/// A GET that writes (joining a team, turning an attachment into a
/// document, recording an open) is refused to every scope, a newer one
/// included, though they otherwise read by method.
#[test]
fn no_scope_makes_a_get_that_writes() {
    let id = "0192f1a0-0000-7000-8000-000000000001";
    for path in [
        format!("/auth/team/join/{id}"),
        format!("/email/attachments/{id}/document_id"),
        // A token that doesn't look like an id is refused too.
        "/email/opens/abc".to_owned(),
    ] {
        for scope in [
            SessionScope::Generation,
            SessionScope::NoSend,
            SessionScope::DryRun,
            SessionScope::Job,
        ] {
            assert!(
                !scope.allows_on(Some(ALL_SPECS), "GET", &path),
                "{scope:?} {path}"
            );
        }
        assert!(!SignedScope::Unknown.allows("GET", &path), "{path}");
    }
    // Suggestion generation reads memory; only allowlisted scopes may not.
    assert!(SessionScope::Generation.allows("GET", "/cognition/memory/explicit"));
    assert!(!SessionScope::Job.allows_on(Some(ALL_SPECS), "GET", "/cognition/memory/explicit"));
    assert!(SessionScope::NoSend.allows("GET", "/dss/call/meetings"));
    assert!(!SessionScope::NoSend.allows("GET", &format!("/dss/call/{id}")));
    assert!(SessionScope::NoSend.allows("GET", &format!("/dss/call/join/{id}")));
}

/// Under every scope, a write to an agent session goes only into the
/// credential's own session: no review card, view, app command, rename,
/// archive, task link or delete in another session its person can edit.
#[test]
fn every_scope_writes_only_into_its_own_session() {
    let own = uuid::Uuid::from_u128(0xa);
    let other = uuid::Uuid::from_u128(0xb);
    for scope in [
        SessionScope::NoSend,
        SessionScope::Generation,
        SessionScope::DryRun,
        SessionScope::Job,
    ] {
        for (method, route) in [
            ("POST", "reviews"),
            ("POST", "views"),
            ("POST", "ui-commands"),
            ("PUT", "name"),
            ("PUT", "archived"),
            ("PUT", "task"),
        ] {
            let path = format!("/agent-harness/agent-sessions/{other}/{route}");
            assert!(
                !scope.allows_within(Some(ALL_SPECS), OwnSession::Is(own), method, &path),
                "{scope:?} {method} {path}"
            );
            assert!(
                !scope.allows_within(Some(ALL_SPECS), OwnSession::Unknown, method, &path),
                "{scope:?} {method} {path} with no session"
            );
        }
        let delete = format!("/agent-harness/agent-sessions/{other}");
        assert!(!scope.allows_within(Some(ALL_SPECS), OwnSession::Is(own), "DELETE", &delete));
    }
    // Its own session's: a NoSend run may rename its own session.
    let rename = format!("/agent-sessions/{own}/name");
    assert!(SessionScope::NoSend.allows_within(None, OwnSession::Is(own), "PUT", &rename));
    // Reads are not bound.
    let read = format!("/agent-sessions/{other}");
    assert!(SessionScope::NoSend.allows_within(None, OwnSession::Is(own), "GET", &read));
}

/// Every `GET_WRITES` entry refuses a GET some spec really declares, so none
/// is a stale or misspelled entry that refuses nothing.
#[test]
fn every_get_write_names_a_real_route() {
    let gets: Vec<String> = SPECS
        .iter()
        .flat_map(|(_, spec)| {
            let spec: serde_json::Value = serde_json::from_str(spec).unwrap();
            spec["paths"]
                .as_object()
                .unwrap()
                .iter()
                .filter(|(_, operations)| operations.get("get").is_some())
                .map(|(path, _)| path.clone())
                .collect::<Vec<_>>()
        })
        .collect();
    for (method, template) in GET_WRITES.iter().chain(TYPED_GET_WRITES) {
        assert_eq!(*method, "GET");
        assert!(
            gets.iter().any(|path| {
                let path = concrete_typed(path);
                is_get_write("GET", &path) && matches(&path, template)
            }),
            "GET_WRITES names {template}, which no spec declares"
        );
    }
}

/// No scope edits what every later agent turn reads into its prompt, nor
/// answers an invitation: a scoped run plants nothing a later full-access
/// turn acts on.
#[test]
fn no_scope_edits_what_later_turns_read() {
    for (method, path) in [
        ("PATCH", "/cognition/memory/explicit"),
        ("PUT", "/agent-harness/agent-coding-preferences"),
        (
            "DELETE",
            "/auth/team/join/0192f1a0-0000-7000-8000-000000000001",
        ),
    ] {
        for scope in [
            SessionScope::NoSend,
            SessionScope::Generation,
            SessionScope::DryRun,
            SessionScope::Job,
        ] {
            assert!(
                !scope.allows_on(Some(ALL_SPECS), method, path),
                "{scope:?} {method} {path}"
            );
        }
    }
}
