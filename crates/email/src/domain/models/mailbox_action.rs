//! User intent and frozen targets, independent from provider label syntax.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Desired organization state. Categories never stand in for folders or flags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum MailboxAction {
    /// Mark correspondence read or unread.
    Read(bool),
    /// Set the follow-up star.
    Flagged(bool),
    /// Archive inbox messages, or restore received correspondence to the inbox.
    Archived(bool),
    /// Move to recoverable trash, or restore correspondence to Inbox (drafts to Drafts).
    Trashed(bool),
    /// Move to junk, or restore to the inbox.
    Junk(bool),
    /// Add/remove a category while preserving other provider assignments.
    Category { name: String, present: bool },
}

/// Durable outcome of an accepted organization action.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct MailboxOperation {
    pub id: Uuid,
    pub action: MailboxAction,
    pub state: MailboxOperationState,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MailboxOperationState {
    Pending,
    Applied,
    Failed,
    Cancelled,
}

/// Snapshot used to choose targets before a command is persisted.
#[derive(Debug, Clone)]
pub struct MailboxActionMessage {
    pub id: Uuid,
    pub provider_id: Option<String>,
    pub is_draft: bool,
    pub is_sent: bool,
    pub in_inbox: bool,
    pub in_trash: bool,
    pub in_junk: bool,
    pub is_present: bool,
}

/// Pending state overlays observed provider facts until a command is confirmed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PendingMailboxState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_read: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_flagged: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_inbox: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_trash: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_junk: Option<bool>,
}

/// A stable Macro message and its provider identity at command acceptance.
#[derive(Debug, Clone)]
pub struct MailboxActionTarget {
    pub message_id: Uuid,
    pub provider_id: Option<String>,
    pub pending: PendingMailboxState,
}

impl MailboxAction {
    /// Freeze eligibility now: later arrivals in the conversation are unaffected.
    pub fn targets(&self, messages: &[MailboxActionMessage]) -> Vec<MailboxActionTarget> {
        messages
            .iter()
            .filter(|m| m.is_present)
            .filter_map(|m| {
                let mut pending = PendingMailboxState::default();
                match self {
                    Self::Read(value) => pending.is_read = Some(*value),
                    Self::Flagged(value) => pending.is_flagged = Some(*value),
                    Self::Archived(true) if m.in_inbox => pending.in_inbox = Some(false),
                    Self::Archived(false) if !m.is_draft && !m.in_trash && !m.in_junk => {
                        pending.in_inbox = Some(true)
                    }
                    Self::Archived(_) => return None,
                    Self::Trashed(value) if m.in_trash != *value => {
                        pending.in_trash = Some(*value);
                        pending.in_junk = Some(false);
                        pending.in_inbox = Some(!value && !m.is_draft);
                    }
                    Self::Junk(value) if m.in_junk != *value && !m.is_draft => {
                        pending.in_junk = Some(*value);
                        pending.in_trash = Some(false);
                        pending.in_inbox = Some(!value);
                    }
                    Self::Trashed(_) | Self::Junk(_) => return None,
                    Self::Category { .. } => (),
                }
                Some(MailboxActionTarget {
                    message_id: m.id,
                    provider_id: m.provider_id.clone(),
                    pending,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn archive_scope_preserves_sent_and_custom_folder_messages() {
        let inbox = MailboxActionMessage {
            id: Uuid::now_v7(),
            provider_id: Some("inbox".into()),
            is_draft: false,
            is_sent: false,
            in_inbox: true,
            in_trash: false,
            in_junk: false,
            is_present: true,
        };
        let sent = MailboxActionMessage {
            id: Uuid::now_v7(),
            provider_id: Some("sent".into()),
            is_sent: true,
            in_inbox: false,
            ..inbox.clone()
        };
        let custom = MailboxActionMessage {
            id: Uuid::now_v7(),
            provider_id: Some("custom".into()),
            in_inbox: false,
            ..inbox.clone()
        };
        let targets = MailboxAction::Archived(true).targets(&[inbox.clone(), sent, custom]);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].message_id, inbox.id);
        assert_eq!(targets[0].pending.in_inbox, Some(false));
    }

    #[test]
    fn category_named_trash_changes_no_folder_state() {
        let message = MailboxActionMessage {
            id: Uuid::now_v7(),
            provider_id: Some("opaque".into()),
            is_draft: false,
            is_sent: false,
            in_inbox: true,
            in_trash: false,
            in_junk: false,
            is_present: true,
        };
        let targets = MailboxAction::Category {
            name: "TRASH".into(),
            present: true,
        }
        .targets(&[message]);
        assert_eq!(targets[0].pending.in_trash, None);
        assert_eq!(targets[0].pending.in_inbox, None);
    }
}

#[cfg(test)]
mod restore_test {
    use super::*;
    #[test]
    fn explicit_restore_targets_sent_correspondence_without_erasing_its_provenance() {
        let sent = MailboxActionMessage {
            id: Uuid::now_v7(),
            provider_id: Some("sent-to-self".into()),
            is_sent: true,
            is_draft: false,
            in_inbox: false,
            in_trash: true,
            in_junk: false,
            is_present: true,
        };
        let targets = MailboxAction::Trashed(false).targets(&[sent.clone()]);
        assert_eq!(targets[0].pending.in_inbox, Some(true));
        assert_eq!(targets[0].pending.in_trash, Some(false));
        let archived = MailboxActionMessage {
            in_trash: false,
            ..sent
        };
        assert_eq!(
            MailboxAction::Archived(false).targets(&[archived])[0]
                .pending
                .in_inbox,
            Some(true)
        );
    }
}
