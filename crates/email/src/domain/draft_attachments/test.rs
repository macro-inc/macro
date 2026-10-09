use super::*;

fn facts() -> AttachmentEditFacts {
    AttachmentEditFacts {
        authorized: true,
        editable: true,
        scheduled: false,
        provider: UserProvider::Outlook,
        total_bytes: 10_000_000,
    }
}

#[test]
fn limits_follow_the_destination_inbox_and_include_existing_files() {
    let mut state = facts();
    assert!(validate_attachment_edit(&state, 100_000_000).is_ok());
    assert!(validate_attachment_edit(&state, 150_000_000).is_err());
    state.provider = UserProvider::Gmail;
    assert!(validate_attachment_edit(&state, 8_000_000).is_ok());
    assert!(validate_attachment_edit(&state, 8_000_001).is_err());
    assert!(validate_attachment_edit(&state, u64::MAX).is_err());
}

#[test]
fn revocation_or_a_scheduled_delivery_blocks_even_attachment_removal() {
    let mut state = facts();
    state.authorized = false;
    assert!(matches!(
        validate_attachment_edit(&state, 0),
        Err(AttachmentError::Forbidden)
    ));
    state.authorized = true;
    state.scheduled = true;
    assert!(matches!(
        validate_attachment_edit(&state, 0),
        Err(AttachmentError::DeliveryConflict)
    ));
    state.scheduled = false;
    state.editable = false;
    assert!(matches!(
        validate_attachment_edit(&state, 0),
        Err(AttachmentError::NotFound)
    ));
}

#[test]
fn malformed_upload_metadata_is_rejected_before_storage() {
    let sha = "a".repeat(64);
    assert!(validate_upload("report.pdf", &sha, 1).is_ok());
    for (name, hash, size) in [
        ("", sha.as_str(), 1),
        ("bad\r\nname", sha.as_str(), 1),
        ("report", "z", 1),
        ("report", sha.as_str(), 0),
    ] {
        assert!(validate_upload(name, hash, size).is_err());
    }
}
