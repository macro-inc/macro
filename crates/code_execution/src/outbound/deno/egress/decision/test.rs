use super::*;

fn catalog() -> Catalog {
    Catalog::from_operations([
        ("email.getThread", "GET", "/email/threads/{id}", false),
        ("email.sendMessage", "POST", "/email/messages", true),
        ("search.unifiedSearch", "POST", "/search", false),
        ("cognition.searchWeb", "POST", "/web/search", true),
        ("storage.getBot", "GET", "/bots/{bot_id}", false),
        ("storage.getMe", "GET", "/bots/me", false),
    ])
}

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
            false,
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
            false,
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
            true,
            true
        ),
        Decision {
            operation: Some("search.unifiedSearch"),
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
            false,
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
            false,
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
            decide(&catalog(), service, base, method, path, false, true).refusal,
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
            true,
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
            false,
            false
        ),
        Decision {
            operation: Some("email.getThread"),
            refusal: Some(Refusal::NoCredential),
            uncatalogued: false,
        }
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
            false,
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
            false,
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
            false,
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
            true,
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
            false,
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
            false,
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
            false,
            true
        )
        .refusal,
        Some(Refusal::UnknownOperation)
    );
}
