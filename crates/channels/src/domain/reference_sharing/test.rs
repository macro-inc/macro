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
            grant_level(ReferencedShareItemType::AgentSession, None, access),
            expected
        );
    }
}

#[test]
fn existing_reference_types_keep_view_sharing() {
    for kind in [
        ReferencedShareItemType::Database,
        ReferencedShareItemType::Document,
        ReferencedShareItemType::Chat,
        ReferencedShareItemType::Project,
        ReferencedShareItemType::EmailThread,
        ReferencedShareItemType::Call,
    ] {
        assert_eq!(grant_level(kind, None, None), None);
        assert_eq!(
            grant_level(kind, None, Some(AccessLevel::View)),
            Some(AccessLevel::View)
        );
        assert_eq!(
            grant_level(kind, None, Some(AccessLevel::Owner)),
            Some(AccessLevel::View)
        );
    }
}

#[test]
fn pdf_references_grant_comment_up_to_the_sharers_access() {
    for (access, expected) in [
        (None, None),
        (Some(AccessLevel::View), Some(AccessLevel::View)),
        (Some(AccessLevel::Comment), Some(AccessLevel::Comment)),
        (Some(AccessLevel::Edit), Some(AccessLevel::Comment)),
        (Some(AccessLevel::Owner), Some(AccessLevel::Comment)),
    ] {
        assert_eq!(
            grant_level(
                ReferencedShareItemType::Document,
                Some(FileType::Pdf),
                access
            ),
            expected
        );
    }
}

#[test]
fn other_document_file_types_keep_view_sharing() {
    for file_type in [FileType::Md, FileType::Docx, FileType::Png] {
        assert_eq!(
            grant_level(
                ReferencedShareItemType::Document,
                Some(file_type),
                Some(AccessLevel::Owner)
            ),
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
            grant_level(ReferencedShareItemType::CalendarEvent, None, access),
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

#[test]
fn posting_a_form_grants_the_channel_view_and_never_more() {
    for (access, expected) in [
        (None, None),
        (Some(AccessLevel::View), Some(AccessLevel::View)),
        (Some(AccessLevel::Comment), Some(AccessLevel::View)),
        (Some(AccessLevel::Edit), Some(AccessLevel::View)),
        (Some(AccessLevel::Owner), Some(AccessLevel::View)),
    ] {
        assert_eq!(
            grant_level(ReferencedShareItemType::Form, None, access),
            expected
        );
    }
}

#[test]
fn form_references_round_trip_without_becoming_documents() {
    assert_eq!(
        ReferencedShareItemType::from_raw("form"),
        Some(ReferencedShareItemType::Form)
    );
    assert_eq!(ReferencedShareItemType::Form.as_str(), "form");
}
