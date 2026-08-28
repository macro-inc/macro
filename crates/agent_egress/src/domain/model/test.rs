use super::*;
use http::Method;

fn header_map(pairs: &[(&str, &str)]) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (name, value) in pairs {
        headers.append(
            HeaderName::from_bytes(name.as_bytes()).expect("header name"),
            HeaderValue::from_str(value).expect("header value"),
        );
    }
    headers
}

fn names(headers: &HeaderMap) -> Vec<&str> {
    headers.keys().map(HeaderName::as_str).collect()
}

/// A slug is a Pipedream `app_slug`, taken as-is: repairing input would let a
/// sandbox name one server and reach another, and there is no derivation for
/// the two ends to disagree over.
#[test]
fn parsing_rejects_rather_than_repairs() {
    assert_eq!(McpServerSlug::parse("Datadog"), None);
    assert_eq!(McpServerSlug::parse("data dog"), None);
    assert_eq!(McpServerSlug::parse(""), None);
    for verbatim in ["datadog-us5", "google_sheets", "linear"] {
        assert_eq!(
            McpServerSlug::parse(verbatim).map(|slug| slug.as_str().to_owned()),
            Some(verbatim.to_owned()),
            "{verbatim}"
        );
    }
}

/// A slug is a single path segment. Anything that could climb out of one -
/// dots, slashes, encoded slashes - is not a slug.
#[test]
fn parsing_rejects_path_traversal() {
    for segment in ["..", "../datadog", "datadog/../slack", "datadog%2f..", "."] {
        assert_eq!(McpServerSlug::parse(segment), None, "accepted {segment}");
    }
}

#[test]
fn allows_only_the_verbs_mcp_speaks() {
    for method in [Method::GET, Method::POST, Method::DELETE] {
        assert!(ensure_method_allowed(&method).is_ok(), "refused {method}");
    }

    for method in [Method::PUT, Method::PATCH, Method::CONNECT, Method::TRACE] {
        assert!(
            matches!(
                ensure_method_allowed(&method),
                Err(EgressError::MethodNotAllowed(_))
            ),
            "allowed {method}"
        );
    }
}

#[test]
fn strips_the_sandboxs_own_credentials_from_a_forwarded_request() {
    let mut headers = header_map(&[
        ("authorization", "Bearer session-token"),
        ("cookie", "macro_session=abc"),
        ("content-type", "application/json"),
    ]);

    sanitize_request_headers(&mut headers);

    assert_eq!(names(&headers), ["content-type"]);
}

/// `HeaderMap` is case-insensitive by construction, so this is really a test
/// that we are leaning on it rather than comparing strings ourselves.
#[test]
fn strips_regardless_of_header_case() {
    let mut headers = header_map(&[
        ("Authorization", "Bearer session-token"),
        ("Host", "egress"),
    ]);

    sanitize_request_headers(&mut headers);

    assert!(headers.is_empty());
}

/// A header sent twice has two values under one name, and stripping has to
/// drain them - removing once would forward the rest.
#[test]
fn strips_every_value_of_a_repeated_header() {
    let mut headers = header_map(&[
        ("authorization", "Bearer one"),
        ("authorization", "Bearer two"),
        ("accept", "text/event-stream"),
    ]);

    sanitize_request_headers(&mut headers);

    assert_eq!(names(&headers), ["accept"]);
}

/// The `x-pd-*` headers are Pipedream's authorization vocabulary -
/// `x-pd-external-user-id` alone picks whose account a request spends - so
/// none of them may ride through from the sandbox, including ones this proxy
/// never stamps itself.
#[test]
fn strips_every_pipedream_scoping_header() {
    let mut headers = header_map(&[
        ("x-pd-external-user-id", "somebody-else"),
        ("X-PD-Tool-Mode", "full-config"),
        ("x-pd-anything-future", "1"),
        ("accept", "text/event-stream"),
    ]);

    sanitize_request_headers(&mut headers);

    assert_eq!(names(&headers), ["accept"]);
}

/// The headers MCP needs to work across a proxy at all: the server's session
/// id, event-stream resumption, and the accept header that asks for a stream.
#[test]
fn keeps_the_headers_mcp_runs_on() {
    let mut headers = header_map(&[
        ("mcp-session-id", "abc123"),
        ("last-event-id", "42"),
        ("accept", "text/event-stream"),
        ("connection", "keep-alive"),
    ]);

    sanitize_request_headers(&mut headers);

    assert_eq!(
        names(&headers),
        ["mcp-session-id", "last-event-id", "accept"]
    );
}

#[test]
fn keeps_the_upstreams_session_id_on_the_way_back() {
    let mut headers = header_map(&[
        ("mcp-session-id", "abc123"),
        ("content-type", "text/event-stream"),
        ("set-cookie", "upstream=1"),
        ("transfer-encoding", "chunked"),
    ]);

    sanitize_response_headers(&mut headers);

    assert_eq!(names(&headers), ["mcp-session-id", "content-type"]);
}

/// The scoping strip is symmetric: an upstream that echoes its `x-pd-*`
/// vocabulary does not report whose account was spent to the sandbox.
#[test]
fn echoed_scoping_headers_never_reach_the_sandbox() {
    let mut headers = header_map(&[
        ("x-pd-external-user-id", "macro|owner@macro.com"),
        ("x-pd-project-id", "proj_abc"),
        ("content-type", "application/json"),
    ]);

    sanitize_response_headers(&mut headers);

    assert_eq!(names(&headers), ["content-type"]);
}

#[test]
fn secrets_do_not_print() {
    let session = SessionToken::new("header.payload.signature");
    let bearer = BearerToken::new("dd-oauth-token");
    let basic = UpstreamCredential::Basic {
        username: "x-access-token".to_owned(),
        secret: "ghs-installation-token".to_owned(),
    };

    assert_eq!(format!("{session:?}"), "SessionToken([REDACTED])");
    assert_eq!(format!("{bearer:?}"), "BearerToken([REDACTED])");
    assert_eq!(
        format!("{:?}", UpstreamCredential::Bearer(bearer)),
        "Bearer([REDACTED])"
    );
    assert_eq!(format!("{basic:?}"), "Basic(x-access-token, [REDACTED])");
}

/// git's credential helper has no way to carry a bearer, so GitHub's git
/// endpoints take the installation token as a Basic *password*.
#[test]
fn a_basic_credential_renders_as_github_expects() {
    let value = UpstreamCredential::Basic {
        username: "x-access-token".to_owned(),
        secret: "ghs-installation-token".to_owned(),
    }
    .header_value()
    .expect("header value");

    assert!(value.is_sensitive());
    assert_eq!(
        value.to_str().expect("ascii"),
        format!(
            "Basic {}",
            BASE64.encode("x-access-token:ghs-installation-token")
        )
    );
}

#[test]
fn a_repo_slug_rejects_rather_than_repairs() {
    let slug = RepoSlug::parse("Macro-Inc", "wolf.1_x").expect("slug");
    assert_eq!(slug.owner(), "Macro-Inc");
    assert_eq!(slug.name(), "wolf.1_x");
    assert_eq!(slug.to_string(), "Macro-Inc/wolf.1_x");

    for (owner, name) in [
        ("", "repo"),
        ("owner", ""),
        ("..", "repo"),
        ("owner", ".."),
        ("owner", "."),
        ("owner/other", "repo"),
        ("owner", "re po"),
        ("owner", "repo%2f.."),
    ] {
        assert_eq!(
            RepoSlug::parse(owner, name),
            None,
            "accepted {owner}/{name}"
        );
    }
}

/// The allowlist is the whole point: anything not one of the three smart-HTTP
/// routes - the dumb protocol's object endpoints most of all - is not a target
/// this crate can name.
#[test]
fn git_endpoints_are_an_allowlist() {
    assert_eq!(
        GitEndpoint::parse("info/refs", Some("service=git-upload-pack")),
        Some(GitEndpoint::InfoRefs {
            service: GitService::UploadPack
        })
    );
    assert_eq!(
        GitEndpoint::parse("git-receive-pack", None),
        Some(GitEndpoint::ReceivePack)
    );

    for (path, query) in [
        ("info/refs", None),
        ("info/refs", Some("service=git-fetch-pack")),
        ("info/packs", None),
        ("objects/info/alternates", None),
        ("objects/ab/cdef0123456789", None),
        ("HEAD", None),
        ("", None),
    ] {
        assert_eq!(
            GitEndpoint::parse(path, query),
            None,
            "accepted {path} {query:?}"
        );
    }
}

#[test]
fn a_git_endpoint_round_trips_to_its_path() {
    for endpoint in [
        GitEndpoint::InfoRefs {
            service: GitService::UploadPack,
        },
        GitEndpoint::InfoRefs {
            service: GitService::ReceivePack,
        },
        GitEndpoint::UploadPack,
        GitEndpoint::ReceivePack,
    ] {
        let rendered = endpoint.path_and_query();
        let (path, query) = match rendered.split_once('?') {
            Some((path, query)) => (path, Some(query)),
            None => (rendered.as_str(), None),
        };
        assert_eq!(GitEndpoint::parse(path, query), Some(endpoint));
    }
}

/// `HeaderValue` marks the credential sensitive, which is what keeps it out
/// of the http stack's own `Debug` output - a hand-rolled `String` header
/// could not say this at all.
#[test]
fn the_stamped_credential_is_marked_sensitive() {
    let value = UpstreamCredential::Bearer(BearerToken::new("dd-oauth-token"))
        .header_value()
        .expect("header value");

    assert!(value.is_sensitive());
    assert_eq!(value.to_str().expect("ascii"), "Bearer dd-oauth-token");
    assert_eq!(format!("{value:?}"), "Sensitive");
}

/// A credential that could carry a newline could inject a header of its own
/// choosing into the upstream request. `HeaderValue` refuses it.
#[test]
fn a_credential_that_could_inject_a_header_is_refused() {
    let error = UpstreamCredential::Bearer(BearerToken::new("token\r\nx-injected: yes"))
        .header_value()
        .expect_err("refused");

    assert!(matches!(error, EgressError::Internal(_)));
}

/// `authorization` is not a response header, which is precisely why it is on
/// the response strip list: an upstream that echoes back what it received
/// would hand the owner's credential to the sandbox.
#[test]
fn an_echoed_credential_never_reaches_the_sandbox() {
    let mut headers = header_map(&[
        ("authorization", "Bearer dd-oauth-token"),
        ("proxy-authorization", "Basic c2VjcmV0"),
        ("content-type", "application/json"),
    ]);

    sanitize_response_headers(&mut headers);

    assert_eq!(names(&headers), ["content-type"]);
}

/// The staff gate is an exact match on the parsed domain part, and the
/// parser behind `MacroUserIdStr` is what makes the lookalikes
/// unrepresentable - a suffixed domain is a different domain, a second `@`
/// or a trailing dot is not an email, and casing normalizes before the
/// compare rather than defeating it.
#[test]
fn the_staff_gate_admits_exactly_the_macro_domain() {
    for staff in ["wolf@macro.com", "wolf@MACRO.COM", "wolf+agents@macro.com"] {
        let owner = MacroUserIdStr::try_from_email(staff).expect(staff);
        assert!(is_macro_staff(&owner), "refused {staff}");
    }

    for visitor in [
        "visitor@example.com",
        "evil@macro.com.attacker.net",
        "evil@xmacro.com",
        "evil@macro.org",
    ] {
        let owner = MacroUserIdStr::try_from_email(visitor).expect(visitor);
        assert!(!is_macro_staff(&owner), "admitted {visitor}");
    }

    for not_an_email in [
        "wolf@macro.com@evil.com",
        "wolf@macro.com.",
        "wolf@macro com",
        "wolf@macrо.com", // Cyrillic 'о': non-ASCII labels are not emails here.
        "not-an-email",
    ] {
        assert!(
            MacroUserIdStr::try_from_email(not_an_email).is_err(),
            "parsed {not_an_email}"
        );
    }
}

/// A repeated `service=` cannot smuggle a second verb: the first pair decides,
/// and the upstream query is rebuilt from the parsed endpoint, never echoed.
#[test]
fn a_repeated_git_service_parameter_does_not_escalate() {
    assert_eq!(
        GitEndpoint::parse(
            "info/refs",
            Some("service=git-upload-pack&service=git-receive-pack")
        ),
        Some(GitEndpoint::InfoRefs {
            service: GitService::UploadPack
        })
    );
}
