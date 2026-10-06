use super::*;

#[test]
fn only_owner_can_share_session_view_with_channel() {
    for (access, expected) in [
        (None, None),
        (Some(AccessLevel::View), None),
        (Some(AccessLevel::Comment), None),
        (Some(AccessLevel::Edit), None),
        (Some(AccessLevel::Owner), Some(AccessLevel::View)),
    ] {
        assert_eq!(
            grant_level(ReferencedShareItemType::AgentSession, access),
            expected
        );
    }
}

#[test]
fn document_references_share_comment_access_with_channel() {
    assert_eq!(grant_level(ReferencedShareItemType::Document, None), None);
    for access in [
        AccessLevel::View,
        AccessLevel::Comment,
        AccessLevel::Edit,
        AccessLevel::Owner,
    ] {
        assert_eq!(
            grant_level(ReferencedShareItemType::Document, Some(access)),
            Some(AccessLevel::Comment)
        );
    }
}

#[test]
fn existing_reference_types_keep_view_sharing() {
    for kind in [
        ReferencedShareItemType::Database,
        ReferencedShareItemType::Chat,
        ReferencedShareItemType::Project,
        ReferencedShareItemType::EmailThread,
        ReferencedShareItemType::Call,
    ] {
        assert_eq!(grant_level(kind, None), None);
        assert_eq!(
            grant_level(kind, Some(AccessLevel::View)),
            Some(AccessLevel::View)
        );
        assert_eq!(
            grant_level(kind, Some(AccessLevel::Owner)),
            Some(AccessLevel::View)
        );
    }
}

#[test]
fn only_calendar_holders_can_share_event_view_with_channel() {
    for (access, expected) in [
        (None, None),
        (Some(AccessLevel::View), None),
        (Some(AccessLevel::Comment), None),
        (Some(AccessLevel::Edit), Some(AccessLevel::View)),
        (Some(AccessLevel::Owner), Some(AccessLevel::View)),
    ] {
        assert_eq!(
            grant_level(ReferencedShareItemType::CalendarEvent, access),
            expected
        );
    }
}

#[test]
fn database_references_round_trip_without_becoming_documents() {
    assert_eq!(
        ReferencedShareItemType::from_raw("database"),
        Some(ReferencedShareItemType::Database)
    );
    assert_eq!(ReferencedShareItemType::Database.as_str(), "database");
}
