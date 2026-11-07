use super::*;

#[test]
fn order_does_not_change_approved_attachments() {
    let first = macro_uuid::generate_uuid_v7();
    let second = macro_uuid::generate_uuid_v7();
    let approved = ApprovedAttachments {
        uploaded: vec![first, second],
        forwarded: vec![second, first],
    };
    assert_eq!(
        approved.validate(&[second, first], &[first, second]),
        Ok(())
    );
}

#[test]
fn missing_added_and_duplicated_attachments_are_rejected() {
    let upload = macro_uuid::generate_uuid_v7();
    let forwarded = macro_uuid::generate_uuid_v7();
    let extra = macro_uuid::generate_uuid_v7();
    let approved = ApprovedAttachments {
        uploaded: vec![upload],
        forwarded: vec![forwarded],
    };
    for (uploaded, forwarded) in [
        (vec![], vec![forwarded]),
        (vec![upload], vec![]),
        (vec![upload, extra], vec![forwarded]),
        (vec![upload], vec![forwarded, extra]),
        (vec![upload, upload], vec![forwarded]),
    ] {
        assert_eq!(
            approved.validate(&uploaded, &forwarded),
            Err(AttachmentSnapshotMismatch)
        );
    }
}

#[test]
fn uploads_and_forwarded_attachments_are_not_interchangeable() {
    let id = macro_uuid::generate_uuid_v7();
    let approved = ApprovedAttachments {
        uploaded: vec![id],
        forwarded: vec![],
    };
    assert_eq!(
        approved.validate(&[], &[id]),
        Err(AttachmentSnapshotMismatch)
    );
}
