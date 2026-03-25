//! Recipient filtering models for the notification service.

use macro_user_id::user_id::MacroUserIdStr;

/// Result of filtering a recipient.
pub enum FilteredRecipient<'a> {
    /// Recipient is allowed to receive the notification.
    Allowed(MacroUserIdStr<'a>),
    /// Recipient was excluded from receiving the notification.
    Excluded(RecipientExclusion<'a>),
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
    /// The recipient has disabled this notification type.
    DisabledNotificationType,
}

impl ExclusionReason {
    /// Get a human-readable description of the exclusion reason.
    pub fn description(&self) -> &'static str {
        match self {
            ExclusionReason::IsSender => "User is the sender",
            ExclusionReason::MutedNotifications => "User has muted notifications",
            ExclusionReason::UnsubscribedFromItem => "User has unsubscribed from this item",
            ExclusionReason::DisabledNotificationType => "User has disabled this notification type",
        }
    }
}
