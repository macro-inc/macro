use super::*;

#[test]
fn only_owner_can_share_session_control_with_channel() {
    for (access, expected) in [
        (None, None),
        (Some(AccessLevel::View), None),
        (Some(AccessLevel::Comment), None),
        (Some(AccessLevel::Edit), None),
        (Some(AccessLevel::Owner), Some(AccessLevel::Edit)),
    ] {
        assert_eq!(
            grant_level(ReferencedShareItemType::AgentSession, access),
            expected
        );
    }
}

#[test]
fn existing_reference_types_keep_view_sharing() {
    for kind in [
        ReferencedShareItemType::Document,
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
