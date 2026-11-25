use uuid::Uuid;

use super::merge_error;
use crate::domain::record_merge::{MergeBlock, MergeError, SameAddressPerson};

#[test]
fn refusals_lead_with_their_code() {
    let blocked = merge_error(MergeError::Conflict(MergeBlock::SameAddressPeople {
        people: vec![SameAddressPerson {
            address: "pat@acme.example.com".into(),
            contact_id: Uuid::from_u128(1),
            name: None,
            record_id: Uuid::from_u128(2),
            archived: true,
        }],
    }));
    assert!(blocked.description.starts_with("merge_conflict:"));

    let merged = merge_error(MergeError::AlreadyMerged {
        record_id: Uuid::from_u128(3),
        current_id: Uuid::from_u128(4),
    });
    assert!(merged.description.starts_with("record_already_merged:"));
    assert!(merged.description.contains(&Uuid::from_u128(4).to_string()));

    assert!(
        merge_error(MergeError::PreviewStale)
            .description
            .starts_with("merge_preview_stale:")
    );
    assert!(
        merge_error(MergeError::PermissionRequired)
            .description
            .starts_with("merge_permission_required:")
    );
}
