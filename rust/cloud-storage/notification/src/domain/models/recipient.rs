//! Recipient filtering models for the notification service.

use std::collections::HashSet;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;

/// Result of filtering recipients.
#[derive(Debug, Clone)]
pub struct FilteredRecipients<'a> {
    /// Recipients who passed all filters and should receive the notification.
    pub valid: Vec<MacroUserIdStr<'a>>,
    /// Recipients who were excluded with their reasons.
    pub excluded: Vec<RecipientExclusion<'a>>,
}

impl<'a> FilteredRecipients<'a> {
    /// Create a new FilteredRecipients with no exclusions.
    pub fn new(valid: Vec<MacroUserIdStr<'a>>) -> Self {
        Self {
            valid,
            excluded: Vec::new(),
        }
    }

    /// Returns true if there are any valid recipients.
    pub fn has_valid_recipients(&self) -> bool {
        !self.valid.is_empty()
    }

    /// Get the set of valid recipient IDs as owned ('static) values.
    pub fn valid_set_owned(&self) -> HashSet<MacroUserIdStr<'static>> {
        self.valid.iter().cloned().map(|id| id.into_owned()).collect()
    }
}

/// A recipient that was excluded from receiving a notification.
#[derive(Debug, Clone)]
pub struct RecipientExclusion<'a> {
    /// The user who was excluded.
    pub user_id: MacroUserIdStr<'a>,
    /// The reason for exclusion.
    pub reason: ExclusionReason,
}

/// Reasons why a recipient might be excluded from a notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExclusionReason {
    /// The recipient is the sender of the notification.
    IsSender,
    /// The recipient has muted notifications.
    MutedNotifications,
    /// The recipient has unsubscribed from notifications for this item.
    UnsubscribedFromItem,
    /// The recipient has unsubscribed from all notifications.
    UnsubscribedFromAll,
}

impl ExclusionReason {
    /// Get a human-readable description of the exclusion reason.
    pub fn description(&self) -> &'static str {
        match self {
            ExclusionReason::IsSender => "User is the sender",
            ExclusionReason::MutedNotifications => "User has muted notifications",
            ExclusionReason::UnsubscribedFromItem => "User has unsubscribed from this item",
            ExclusionReason::UnsubscribedFromAll => "User has unsubscribed from all notifications",
        }
    }
}
