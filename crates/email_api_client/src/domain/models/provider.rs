//! Provider identities and normalized mailbox state, independent of wire formats.

use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{EmailApiError, MessageWithCalendarParts};

/// Identity required to acquire a credential for a persisted mailbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MailboxAccess {
    /// Macro mailbox link, resolved and authorized by the owning email domain.
    pub link_id: uuid::Uuid,
    /// Mailbox binding generation, also changed when credential custody moves.
    pub sync_generation: i64,
    /// Exact grant generation bound to that link.
    pub grant_generation: i64,
}

#[cfg(test)]
mod test;

/// An opaque, case-sensitive identity assigned by a mailbox provider.
///
/// The mailbox link is always part of its database key. An ID by itself confers
/// no access and must never be used to deduplicate across mailboxes.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ProviderId(String);

impl ProviderId {
    /// Validate an opaque identifier without interpreting provider syntax.
    pub fn new(value: impl Into<String>) -> Result<Self, EmailApiError> {
        let value = value.into();
        if value.is_empty() || value.chars().any(char::is_control) {
            return Err(EmailApiError::Permanent {
                message: "invalid provider identifier".into(),
            });
        }
        Ok(Self(value))
    }

    /// Borrow the original, unmodified identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProviderId([REDACTED])")
    }
}

impl TryFrom<String> for ProviderId {
    type Error = EmailApiError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<ProviderId> for String {
    fn from(value: ProviderId) -> Self {
        value.0
    }
}

/// The semantic purpose of a provider's physical folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderRole {
    /// Incoming messages.
    Inbox,
    /// Sent copies.
    Sent,
    /// Provider drafts.
    Drafts,
    /// Archived mail.
    Archive,
    /// Recoverable deleted mail.
    Trash,
    /// Junk mail.
    Junk,
    /// A user-created or otherwise unclassified folder.
    Other,
}

/// A physical folder; tags/categories are modeled separately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MailFolder {
    /// Mailbox-scoped provider identity.
    pub id: ProviderId,
    /// Parent identity, when exposed.
    pub parent_id: Option<ProviderId>,
    /// Display-only name, never used to infer the role.
    pub name: String,
    /// Role resolved through the provider's well-known folder identifiers.
    pub role: FolderRole,
    /// Whether the folder has children that must also be enumerated.
    pub has_children: bool,
}

impl MailFolder {
    /// Deleted Items contains deleted folder subtrees, not only direct messages.
    /// Keep catalog roles unchanged so write destinations still resolve the root.
    pub fn effective_role(folders: &[Self], id: Option<&ProviderId>) -> FolderRole {
        let own = folders.iter().find(|folder| Some(&folder.id) == id);
        let role = own.map(|folder| folder.role).unwrap_or(FolderRole::Other);
        let mut next = own;
        for _ in 0..folders.len() {
            let Some(folder) = next else { break };
            if folder.role == FolderRole::Trash {
                return FolderRole::Trash;
            }
            next = folder
                .parent_id
                .as_ref()
                .and_then(|parent| folders.iter().find(|candidate| &candidate.id == parent));
        }
        role
    }
}

/// Provider-supplied attention evidence; user policy has higher precedence.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Attention {
    /// The provider supplied no usable classification.
    #[default]
    Unknown,
    /// Provider classification favors the primary/foreground inbox.
    Primary,
    /// Provider classification favors the background inbox.
    Other,
}

/// Independent mailbox facts. Folder moves do not erase message provenance.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MailboxState {
    /// Read state.
    pub is_read: bool,
    /// Star/follow-up flag state.
    pub is_flagged: bool,
    /// Draft state.
    pub is_draft: bool,
    /// Inbox membership.
    pub in_inbox: bool,
    /// Recoverable trash membership.
    pub in_trash: bool,
    /// Junk membership.
    pub in_junk: bool,
    /// Provider attention evidence.
    pub attention: Attention,
}

/// A normalized provider snapshot plus organization and concurrency metadata.
#[derive(Debug, Clone)]
pub struct MailboxMessage {
    /// App correlation carried by a provider draft; validated against pending work.
    pub draft_correlation: Option<uuid::Uuid>,
    /// Existing content and invitation representation consumed by ingestion.
    pub content: MessageWithCalendarParts,
    /// Normalized mailbox facts.
    pub state: MailboxState,
    /// Physical parent folder, if the provider uses folders.
    pub folder_id: Option<ProviderId>,
    /// Nonexclusive category/tag names in the provider's catalog.
    pub tags: Vec<String>,
    /// Opaque provider version for detecting changes, not a sortable timestamp.
    pub version: Option<String>,
}

/// Lightweight facts for command reconciliation, without body or attachment IO.
#[derive(Debug, Clone)]
pub struct MailboxOrganization {
    /// Observed provider state.
    pub state: MailboxState,
    /// Physical parent folder.
    pub folder_id: Option<ProviderId>,
    /// Current category assignments.
    pub tags: Vec<String>,
    /// Concurrency token returned by the provider.
    pub version: Option<String>,
    /// Provenance independent of the current folder.
    pub is_sent: bool,
}

impl From<MailboxMessage> for MailboxOrganization {
    fn from(message: MailboxMessage) -> Self {
        Self {
            state: message.state,
            folder_id: message.folder_id,
            tags: message.tags,
            version: message.version,
            is_sent: message.content.message.is_sent,
        }
    }
}

/// A provider-neutral desired-state operation on a single message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", content = "value", rename_all = "snake_case")]
pub enum MessageAction {
    /// Set read state.
    SetRead(bool),
    /// Set star/follow-up state.
    SetFlagged(bool),
    /// Move to a resolved physical folder.
    MoveToFolder(ProviderId),
    /// Resolve the native archive or provision a recoverable application archive.
    Archive,
    /// Replace categories after the coordinator merges the current provider state.
    SetTags(Vec<String>),
}

/// One bounded page in a durable provider enumeration stream.
#[derive(Debug, Clone)]
pub struct MailboxChangePage {
    /// Message identities needing current-state reconciliation.
    pub changed: Vec<ProviderId>,
    /// Removals from this stream, not proof of mailbox-wide deletion.
    pub removed: Vec<ProviderId>,
    /// The continuation or committed checkpoint returned by the provider.
    pub position: StreamPosition,
}

/// An opaque continuation/checkpoint which must be validated by its adapter.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StreamToken(String);

impl StreamToken {
    /// Retain the complete opaque provider token without modifying it.
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// Borrow the token only for persistence or an outbound request.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for StreamToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("StreamToken([REDACTED])")
    }
}

/// Progress through a stream distinguishes partial enumeration from catch-up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StreamPosition {
    /// More pages must be durably consumed before the stream is caught up.
    Continue(StreamToken),
    /// The round completed; persist this checkpoint for the next round.
    Checkpoint(StreamToken),
}

/// A notification subscription independent from the mailbox's sync checkpoints.
#[derive(Debug, Clone)]
pub struct MailboxSubscription {
    /// Provider subscription identifier used for renewal and removal.
    pub id: ProviderId,
    /// Actual expiry returned by the provider.
    pub expires_at: DateTime<Utc>,
}

/// Read-back facts for recovering a subscription creation with a lost response.
pub struct MailboxWatchDetails {
    /// Provider identity and actual expiry.
    pub subscription: MailboxSubscription,
    /// Callback URL includes a persisted, non-secret creation correlation ID.
    pub notification_url: String,
    /// Lifecycle URL must agree before a recovered subscription is adopted.
    pub lifecycle_url: Option<String>,
    /// Resource to which the subscription belongs.
    pub resource: String,
}

/// Submission facts; accepted does not mean delivered to a recipient.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmissionOutcome {
    /// The provider acknowledged submission; reconcile the sent copy.
    Accepted,
    /// Submission may have happened; the command must not be blindly resubmitted.
    Unknown,
}

/// Identity and version returned by one acknowledged organization write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageWriteReceipt {
    /// Provider identity after the operation.
    pub id: ProviderId,
    /// Exact response ETag, when a conditional PATCH supplied one.
    pub version: Option<String>,
}
