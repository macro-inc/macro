//! Display verbs supplied by code-mode SDK requests.

use serde::{Deserialize, Serialize};

/// Closed vocabulary for an agent's resource activity. This is display-only.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum AgentVerb {
    /// Created a resource.
    Created,
    /// Copied a resource.
    Copied,
    /// Generated a resource.
    Generated,
    /// Uploaded a resource.
    Uploaded,
    /// Imported a resource.
    Imported,
    /// Edited a resource.
    Edited,
    /// Renamed a resource.
    Renamed,
    /// Moved a resource.
    Moved,
    /// Reordered resources.
    Reordered,
    /// Archived a resource.
    Archived,
    /// Deleted a resource.
    Deleted,
    /// Restored a resource.
    Restored,
    /// Shared a resource.
    Shared,
    /// Removed sharing.
    Unshared,
    /// Invited a participant.
    Invited,
    /// Added a resource.
    Added,
    /// Removed a resource.
    Removed,
    /// Linked a resource.
    Linked,
    /// Removed a link.
    Unlinked,
    /// Sent a message.
    Sent,
    /// Posted content.
    Posted,
    /// Reacted to content.
    Reacted,
    /// Submitted a resource.
    Submitted,
    /// Scheduled work.
    Scheduled,
    /// Cancelled work.
    Cancelled,
    /// Confirmed work.
    Confirmed,
    /// Approved work.
    Approved,
    /// Rejected work.
    Rejected,
    /// Enabled a resource.
    Enabled,
    /// Disabled a resource.
    Disabled,
    /// Ran work.
    Ran,
    /// Stopped work.
    Stopped,
    /// Joined a resource.
    Joined,
    /// Left a resource.
    Left,
    /// Blocked a resource.
    Blocked,
    /// Unblocked a resource.
    Unblocked,
    /// Labeled a resource.
    Labeled,
    /// Marked a resource.
    Marked,
    /// Requested a resource.
    Requested,
    /// Registered a resource.
    Registered,
    /// Read a resource.
    Read,
    /// Listed resources.
    Listed,
    /// Searched resources.
    Searched,
    /// Queried resources.
    Queried,
    /// Checked a resource.
    Checked,
}
