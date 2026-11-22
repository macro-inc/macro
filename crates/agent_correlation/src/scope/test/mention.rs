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

#[test]
fn mentions_never_export_email_attachment_download_capabilities() {
    assert!(!SessionScope::ChannelMention.allows_on(
        Some(ALL_SPECS),
        "GET",
        "/email/attachments/0192f1a0-0000-7000-8000-000000000001",
    ));
}

#[test]
fn mentions_do_not_read_email_or_private_chat_history() {
    for path in [
        "/email/contacts",
        "/email/labels",
        "/email/messages/0192f1a0-0000-7000-8000-000000000001",
        "/email/messages/0192f1a0-0000-7000-8000-000000000001/eml",
        "/email/threads/previews/cursor/inbox",
        "/email/threads/0192f1a0-0000-7000-8000-000000000001/messages",
        "/email/threads/0192f1a0-0000-7000-8000-000000000001",
        "/email/threads/0192f1a0-0000-7000-8000-000000000001/calendar-invitations",
        "/chats/0192f1a0-0000-7000-8000-000000000001",
        "/chats/history/0192f1a0-0000-7000-8000-000000000001",
        "/attachments/0192f1a0-0000-7000-8000-000000000001/chats",
    ] {
        assert!(
            !SessionScope::ChannelMention.allows_on(Some(&["email", "cognition"]), "GET", path),
            "{path}"
        );
    }
}

#[test]
fn mentions_do_not_query_unified_search_through_any_service_prefix() {
    for path in [
        "/search",
        "/search/simple",
        "/dss/v1/search",
        "/dss/v1/search/simple",
    ] {
        assert!(
            !SessionScope::ChannelMention.allows_on(Some(ALL_SPECS), "POST", path),
            "{path}"
        );
    }
}

#[test]
fn mentions_do_not_list_contacts() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(Some(&["contacts"]), "GET", "/contacts"));
}

#[test]
fn mentions_do_not_search_contacts() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(
        Some(&["contacts"]),
        "GET",
        "/contacts/search"
    ));
}

#[test]
fn mentions_do_not_read_calendar_availability() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(
        Some(&["calendar"]),
        "GET",
        "/availability-calendars"
    ));
}

#[test]
fn mentions_do_not_list_calendars() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(Some(&["calendar"]), "GET", "/calendars"));
}

#[test]
fn mentions_do_not_read_calendar_provider_links() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(
        Some(&["calendar"]),
        "GET",
        "/events/0192f1a0-0000-7000-8000-000000000001/provider-url"
    ));
}

#[test]
fn mentions_do_not_list_calendar_occurrences() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(Some(&["storage"]), "GET", "/calendar-events"));
}

#[test]
fn mentions_do_not_export_calendar_ics() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/calendar-events/0192f1a0-0000-7000-8000-000000000001/ics"
    ));
}

#[test]
fn mentions_do_not_read_routine_run_history() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(
        Some(&["scheduled-action"]),
        "GET",
        "/scheduled-actions/0192f1a0-0000-7000-8000-000000000001/history"
    ));
}

#[test]
fn mentions_do_not_enumerate_documents() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(Some(&["storage"]), "GET", "/documents"));
}

#[test]
fn mentions_do_not_list_documents() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "GET",
        "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
    ));
    assert!(!SessionScope::ChannelMention.allows_on(Some(&["storage"]), "GET", "/documents/list"));
}
