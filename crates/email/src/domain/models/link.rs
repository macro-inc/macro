use chrono::{DateTime, Utc};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The provider of this email
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserProvider {
    Gmail,
}

impl UserProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserProvider::Gmail => "GMAIL",
        }
    }
}

/// Status of the latest initial mailbox backfill, when one exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailBackfillStatus {
    /// The backfill is queued but has not started.
    Init,
    /// The backfill is currently running.
    InProgress,
    /// The backfill completed successfully.
    Complete,
    /// The backfill was cancelled.
    Cancelled,
    /// The backfill failed.
    Failed,
}

/// Coarse user-facing synchronization state for an accessible inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailSyncStatus {
    /// Initial mailbox synchronization is queued or running.
    Syncing,
    /// The inbox is active and its latest backfill is complete.
    UpToDate,
    /// The latest initial mailbox synchronization failed.
    Error,
    /// The provider grant must be reauthorized before synchronization can resume.
    NeedsReauth,
    /// Synchronization is disabled for the inbox.
    Inactive,
}

impl EmailSyncStatus {
    /// Derive the user-facing state from persisted synchronization facts.
    pub fn derive(
        is_sync_active: bool,
        needs_reauth: bool,
        latest_backfill_status: Option<EmailBackfillStatus>,
    ) -> Self {
        if !is_sync_active {
            return Self::Inactive;
        }

        if needs_reauth {
            return Self::NeedsReauth;
        }

        match latest_backfill_status {
            Some(EmailBackfillStatus::Init | EmailBackfillStatus::InProgress) => Self::Syncing,
            Some(EmailBackfillStatus::Failed | EmailBackfillStatus::Cancelled) => Self::Error,
            Some(EmailBackfillStatus::Complete) | None => Self::UpToDate,
        }
    }
}

/// Signature settings associated with an accessible inbox.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserEmailLinkSettings {
    /// Whether signatures are included on replies and forwards.
    pub signature_on_replies_forwards: bool,
    /// Saved, sanitized signature HTML, when configured.
    pub signature: Option<String>,
}

/// Persisted facts required to build an enriched user-scoped email link.
///
/// This is returned by the repository port. The domain service derives
/// [`EmailSyncStatus`] from these facts before returning a [`UserEmailLink`].
#[derive(Debug, Clone)]
pub struct EmailInboxDetails {
    /// Stable email link identifier.
    pub id: Uuid,
    /// Macro user that owns the inbox.
    pub macro_id: MacroUserIdStr<'static>,
    /// Provider email address for the inbox.
    pub email_address: EmailStr<'static>,
    /// SFS URL of the inbox's self-contact photo, when available.
    pub photo_url: Option<String>,
    /// Email provider.
    pub provider: UserProvider,
    /// Whether ongoing provider synchronization is enabled.
    pub is_sync_active: bool,
    /// Whether the provider grant must be reauthorized.
    pub needs_reauth: bool,
    /// Inbox signature settings.
    pub settings: UserEmailLinkSettings,
    /// Whether this is the owner's primary inbox.
    pub is_primary: bool,
    /// Latest initial backfill status, when one exists.
    pub latest_backfill_status: Option<EmailBackfillStatus>,
    /// Link creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Link last-updated timestamp.
    pub updated_at: DateTime<Utc>,
}

/// Enriched email link visible to an authenticated user.
///
/// The model intentionally omits the provider's authentication-system user ID,
/// which is an internal credential-linking detail rather than user-facing data.
#[derive(Debug, Clone)]
pub struct UserEmailLink {
    /// Stable email link identifier.
    pub id: Uuid,
    /// Macro user that owns the inbox.
    pub macro_id: MacroUserIdStr<'static>,
    /// Provider email address for the inbox.
    pub email_address: EmailStr<'static>,
    /// SFS URL of the inbox's self-contact photo, when available.
    pub photo_url: Option<String>,
    /// Email provider.
    pub provider: UserProvider,
    /// Whether ongoing provider synchronization is enabled.
    pub is_sync_active: bool,
    /// Coarse synchronization state derived by the email domain.
    pub sync_status: EmailSyncStatus,
    /// Whether the provider grant must be reauthorized.
    pub needs_reauth: bool,
    /// Inbox signature settings.
    pub settings: UserEmailLinkSettings,
    /// Whether this is the owner's primary inbox.
    pub is_primary: bool,
    /// Link creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Link last-updated timestamp.
    pub updated_at: DateTime<Utc>,
}

impl From<EmailInboxDetails> for UserEmailLink {
    fn from(details: EmailInboxDetails) -> Self {
        Self {
            id: details.id,
            macro_id: details.macro_id,
            email_address: details.email_address,
            photo_url: details.photo_url,
            provider: details.provider,
            is_sync_active: details.is_sync_active,
            sync_status: EmailSyncStatus::derive(
                details.is_sync_active,
                details.needs_reauth,
                details.latest_backfill_status,
            ),
            needs_reauth: details.needs_reauth,
            settings: details.settings,
            is_primary: details.is_primary,
            created_at: details.created_at,
            updated_at: details.updated_at,
        }
    }
}

#[derive(Clone)]
pub struct Link {
    pub id: Uuid,
    pub macro_id: MacroUserIdStr<'static>,
    pub fusionauth_user_id: String,
    pub email_address: EmailStr<'static>,
    pub provider: UserProvider,
    pub is_sync_active: bool,
    pub is_primary: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
