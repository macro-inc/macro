//! The mention table is a default-deny read boundary, including POST reads.
use super::*;

#[test]
fn mention_lists_classify_every_read_and_only_allow_their_exact_operations() {
    assert_classified_scope(
        SessionScope::ChannelMention,
        include_str!("../mention_reads.txt"),
        include_str!("../mention_writes.txt"),
        include_str!("../mention_refused_reads.txt"),
    );
    assert!(
        list_lines(include_str!("../mention_writes.txt"))
            .next()
            .is_none()
    );
}

#[test]
fn mentions_require_the_right_service_and_refuse_capabilities_and_unlisted_routes() {
    let scope = SessionScope::ChannelMention;
    let document = "/documents/0192f1a0-0000-7000-8000-000000000001/markdown";
    assert!(scope.allows_on(Some(&["storage"]), "GET", document));
    assert!(scope.allows_on(Some(&["storage"]), "HEAD", document));
    assert!(!scope.allows_on(None, "GET", document));
    assert!(!scope.allows_on(Some(&["email"]), "GET", document));
    for (method, path) in [
        ("PUT", document),
        ("OPTIONS", document),
        ("GET", "/documents/not-an-id/markdown"),
        (
            "GET",
            "/documents/0192f1a0-0000-7000-8000-000000000001/location",
        ),
        ("GET", "/memory"),
        ("GET", "/memory/explicit"),
        ("GET", "/future-read-route"),
        ("POST", "/future-write-route"),
        (
            "POST",
            "/documents/permissions_token/0192f1a0-0000-7000-8000-000000000001",
        ),
    ] {
        assert!(
            !scope.allows_on(Some(ALL_SPECS), method, path),
            "{method} {path}"
        );
    }
    assert!(scope.allowlist().is_some());
    assert!(scope.caps_document_tokens_to_view());
    assert!(!scope.may_assign_agents());
    assert!(!scope.allows_sharing());
}
