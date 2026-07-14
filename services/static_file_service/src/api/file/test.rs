use super::{ANONYMOUS_OWNER_ID, can_delete_file, owner_id_for_upload};

const OWNER_ID: &str = "macro|owner@example.com";

#[test]
fn anonymous_uploads_are_owned_by_nobody() {
    assert_eq!(owner_id_for_upload(None), ANONYMOUS_OWNER_ID);
    assert_eq!(owner_id_for_upload(Some(OWNER_ID)), OWNER_ID);
}

#[test]
fn delete_access_requires_the_owner_or_an_internal_key() {
    assert!(can_delete_file(OWNER_ID, Some(OWNER_ID), false));
    assert!(can_delete_file(OWNER_ID, None, true));
    assert!(can_delete_file(
        OWNER_ID,
        Some("macro|other@example.com"),
        true,
    ));

    assert!(!can_delete_file(OWNER_ID, None, false));
    assert!(!can_delete_file(
        OWNER_ID,
        Some("macro|other@example.com"),
        false,
    ));
}
