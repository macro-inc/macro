use super::*;

fn catalog() -> Catalog {
    Catalog::from_operations([
        ("email.getThread", "GET", "/email/threads/{id}", false),
        ("email.sendMessage", "POST", "/email/messages", true),
        ("search.unifiedSearch", "POST", "/search", false),
        ("cognition.searchWeb", "POST", "/web/search", true),
        ("unfurl.getBulkUnfurl", "POST", "/unfurl/bulk", false),
        ("storage.getBot", "GET", "/bots/{bot_id}", false),
        ("storage.getMe", "GET", "/bots/me", false),
    ])
}

const PLAIN: RunPolicy = RunPolicy {
    enforce: false,
    dry_run: false,
    scoped: false,
};
const DRY_RUN: RunPolicy = RunPolicy {
    enforce: false,
    dry_run: true,
    scoped: false,
};
const SCOPED: RunPolicy = RunPolicy {
    enforce: false,
    dry_run: false,
    scoped: true,
};

/// An SDK read with a credential goes through as it is.
#[test]
fn a_credentialed_sdk_read_would_be_forwarded() {
    assert_eq!(
        decide(
            &catalog(),
            "email",
            "/email",
            "GET",
            "/email/email/threads/t1",
            PLAIN,
            true
        ),
        Decision {
            operation: Some("email.getThread"),
            refusal: None,
            uncatalogued: false,
        }
    );
    assert_eq!(
        decide(
            &catalog(),
            "email",
            "/email",
            "HEAD",
            "/email/email/threads/t1",
            PLAIN,
            true
        ),
        Decision {
            operation: Some("email.getThread"),
            refusal: None,
            uncatalogued: false,
        }
    );
    assert_eq!(
        decide(
            &catalog(),
            "search",
            "/dss",
            "POST",
            "/dss/search",
            DRY_RUN,
            true
        ),
        Decision {
            operation: Some("search.unifiedSearch"),
            refusal: None,
            uncatalogued: false,
        }
    );
    // Bulk unfurl is an SDK read for a run that isn't scoped or dry.
    assert_eq!(
        decide(
            &catalog(),
            "unfurl",
            "/unfurl",
            "POST",
            "/unfurl/unfurl/bulk",
            PLAIN,
            true
        ),
        Decision {
            operation: Some("unfurl.getBulkUnfurl"),
            refusal: None,
            uncatalogued: false,
        }
    );
}

/// What enforcement will refuse, and why.
#[test]
fn what_the_forwarder_would_refuse() {
    // `..` left the email service for another one on the same host.
    assert_eq!(
        decide(
            &catalog(),
            "email",
            "/email",
            "GET",
            "/image-proxy/proxy",
            PLAIN,
            true
        )
        .refusal,
        Some(Refusal::OutsideService)
    );
    assert_eq!(
        decide(
            &catalog(),
            "email",
            "/email",
            "GET",
            "/emailx/threads/t1",
            PLAIN,
            true
        )
        .refusal,
        Some(Refusal::OutsideService)
    );
    // Not an operation: wrong method, wrong path, or ending like one.
    for (service, base, method, path) in [
        ("email", "/email", "DELETE", "/email/email/threads/t1"),
        ("email", "/email", "GET", "/email/email/threads"),
        ("cognition", "/cognition", "POST", "/cognition/x/web/search"),
        ("email", "/email", "GET", "/email/email/threads/t1/"),
        ("email", "/email", "GET", "/email//email/threads/t1"),
    ] {
        assert_eq!(
            decide(&catalog(), service, base, method, path, PLAIN, true).refusal,
            Some(Refusal::UnknownOperation),
            "{method} {path}"
        );
    }
    assert_eq!(
        decide(
            &catalog(),
            "email",
            "/email",
            "POST",
            "/email/email/messages",
            DRY_RUN,
            true
        ),
        Decision {
            operation: Some("email.sendMessage"),
            refusal: Some(Refusal::DryRunWrite),
            uncatalogued: false,
        }
    );
    assert_eq!(
        decide(
            &catalog(),
            "email",
            "/email",
            "GET",
            "/email/email/threads/t1",
            PLAIN,
            false
        ),
        Decision {
            operation: Some("email.getThread"),
            refusal: Some(Refusal::NoCredential),
            uncatalogued: false,
        }
    );
}

/// A scoped or dry run is refused the routes anyone may call that reach
/// someone else or an outside site, credential or not; another run isn't.
#[test]
fn scoped_and_dry_runs_are_refused_anonymous_outward_routes() {
    for (service, base, method, path) in [
        (
            "calendar",
            "/calendar",
            "POST",
            "/calendar/scheduling/public/wolf/intro/book",
        ),
        (
            "calendar",
            "/calendar",
            "POST",
            "/calendar/scheduling/public/bookings/b1/cancel",
        ),
        (
            "calendar",
            "/calendar",
            "POST",
            "/calendar/scheduling/public/bookings/b1/reschedule",
        ),
        ("unfurl", "/unfurl", "GET", "/unfurl/unfurl"),
        ("unfurl", "/unfurl", "GET", "/unfurl/proxy"),
        ("storage", "/dss", "POST", "/dss/databases/webhooks/secret"),
        ("unfurl", "/unfurl", "POST", "/unfurl/unfurl/bulk"),
        ("email", "/email", "GET", "/email/opens/token"),
    ] {
        for policy in [SCOPED, DRY_RUN] {
            assert_eq!(
                decide(&catalog(), service, base, method, path, policy, true).refusal,
                Some(Refusal::AnonymousOutward),
                "{policy:?} {method} {path}"
            );
        }
        assert_ne!(
            decide(&catalog(), service, base, method, path, PLAIN, true).refusal,
            Some(Refusal::AnonymousOutward),
            "{method} {path}"
        );
    }
}

/// Every unfurl operation of the SDK fetches a URL it is given and takes no
/// credential, so a scoped or dry run is refused each of them: a new one
/// can't slip through unlisted.
#[test]
fn scoped_and_dry_runs_are_refused_every_unfurl_operation() {
    let catalog = Catalog::of_the_sdk();
    let mut seen = 0;
    for (key, operation) in crate::domain::operations() {
        if !key.starts_with("unfurl.") {
            continue;
        }
        seen += 1;
        let concrete = operation
            .path
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
        let path = format!("/unfurl{concrete}");
        for policy in [SCOPED, DRY_RUN] {
            assert_eq!(
                decide(&catalog, "unfurl", "/unfurl", &operation.method, &path, policy, true)
                    .refusal,
                Some(Refusal::AnonymousOutward),
                "{key} {policy:?}"
            );
        }
    }
    assert!(seen >= 3, "the SDK's unfurl operations: {seen}");
}

/// Every refusal tells the program what to do instead.
#[test]
fn every_refusal_says_what_to_do_instead() {
    assert_eq!(
        Refusal::UnknownOperation.message("DELETE", "/email/threads/t1"),
        "DELETE /email/threads/t1 isn't an operation of Macro's SDK, so this run can't send it. Use the macro SDK's methods instead of building requests by hand; DescribeCodeTools and ReadCodeDocs list them."
    );
    assert_eq!(
        Refusal::DryRunWrite.message("POST", "/email/messages"),
        "A dry run doesn't send changes. Return what the program would change instead of changing it."
    );
    assert_eq!(
        Refusal::NoCredential.message("GET", "/email/threads/t1"),
        "GET /email/threads/t1 was sent without the run's credential, so this run can't send it. Call the macro SDK, which adds it."
    );
    assert_eq!(
        Refusal::AnonymousOutward.message("GET", "/unfurl/proxy"),
        "GET /unfurl/proxy reaches someone else or an outside site without a credential, which this run may not do. Leave it out, or say what it would do in the result for a person to act on."
    );
}

/// Every operation of the SDK this build runs is in the catalog, under its
/// own service.
#[test]
fn the_catalog_holds_every_sdk_operation() {
    let catalog = Catalog::of_the_sdk();
    for (key, operation) in crate::domain::operations() {
        let (service, _) = key.split_once('.').unwrap();
        let concrete = operation
            .path
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
        let found = catalog
            .find(service, &operation.method, &concrete)
            .map(|route| route.key);
        // Filled with `x`, a templated path may also fit a literal route of
        // the same method; otherwise it is this one.
        if !concrete.contains("/x") {
            assert_eq!(found, Some(key.as_str()), "{key}");
        } else {
            assert!(found.is_some(), "{key}");
        }
    }
}

/// A literal segment wins over a `{…}` one where both fit, as a router
/// picks it; a service with no catalog isn't checked, except that a dry run
/// still sends only reads.
#[test]
fn literal_routes_win_and_uncatalogued_services_go_unchecked() {
    assert_eq!(
        decide(
            &catalog(),
            "storage",
            "/dss",
            "GET",
            "/dss/bots/me",
            PLAIN,
            true
        )
        .operation,
        Some("storage.getMe")
    );
    assert_eq!(
        decide(
            &catalog(),
            "storage",
            "/dss",
            "GET",
            "/dss/bots/b1",
            PLAIN,
            true
        )
        .operation,
        Some("storage.getBot")
    );
    assert_eq!(
        decide(
            &catalog(),
            "static-files",
            "",
            "GET",
            "/file/f1",
            PLAIN,
            false
        ),
        Decision {
            operation: None,
            refusal: None,
            uncatalogued: true,
        }
    );
    assert_eq!(
        decide(
            &catalog(),
            "static-files",
            "",
            "PUT",
            "/file/f1",
            DRY_RUN,
            true
        )
        .refusal,
        Some(Refusal::DryRunWrite)
    );
}

/// Services under one base take each other's requests: a request is
/// whichever service's operation it is.
#[test]
fn services_that_share_a_base_are_decided_together() {
    let shared = ["properties", "search", "storage"];
    assert_eq!(
        decide_across(
            &catalog(),
            &shared,
            "/dss",
            "POST",
            "/dss/search",
            PLAIN,
            true
        )
        .operation,
        Some("search.unifiedSearch")
    );
    assert_eq!(
        decide_across(
            &catalog(),
            &shared,
            "/dss",
            "GET",
            "/dss/bots/me",
            PLAIN,
            true
        )
        .operation,
        Some("storage.getMe")
    );
    assert_eq!(
        decide_across(
            &catalog(),
            &shared,
            "/dss",
            "GET",
            "/dss/nothing",
            PLAIN,
            true
        )
        .refusal,
        Some(Refusal::UnknownOperation)
    );
}
