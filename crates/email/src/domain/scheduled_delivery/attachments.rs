//! Attachment identity approved by the sender, independent of storage lifetime.

use uuid::Uuid;

/// Exact attachment sets captured by the send action.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ApprovedAttachments {
    /// Completed upload identities.
    pub uploaded: Vec<Uuid>,
    /// Original provider attachment identities selected for forwarding.
    pub forwarded: Vec<Uuid>,
}

/// The delivery payload can no longer contain exactly the approved attachments.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("approved email attachments changed; review the draft before sending")]
pub struct AttachmentSnapshotMismatch;

impl ApprovedAttachments {
    /// Refuse missing, added, or duplicated attachments before provider delivery.
    pub fn validate(
        &self,
        uploaded: &[Uuid],
        forwarded: &[Uuid],
    ) -> Result<(), AttachmentSnapshotMismatch> {
        if same_ids(&self.uploaded, uploaded) && same_ids(&self.forwarded, forwarded) {
            Ok(())
        } else {
            Err(AttachmentSnapshotMismatch)
        }
    }
}

impl From<&crate::domain::send_attempt::SendSnapshot> for ApprovedAttachments {
    fn from(snapshot: &crate::domain::send_attempt::SendSnapshot) -> Self {
        Self {
            uploaded: snapshot.attachment_ids.clone(),
            forwarded: snapshot.forwarded_attachment_ids.clone(),
        }
    }
}

fn same_ids(expected: &[Uuid], actual: &[Uuid]) -> bool {
    let mut expected = expected.to_vec();
    let mut actual = actual.to_vec();
    expected.sort_unstable();
    actual.sort_unstable();
    expected == actual
}

#[cfg(test)]
mod test;
