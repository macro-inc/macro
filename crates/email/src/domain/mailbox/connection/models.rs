//! Requests, outcomes and original connection error categories.

use super::super::initialization::InitializationError;
use calendar_events::domain::models::{CalendarGrantIntent, GoogleScopeSet};
use email_api_client::domain::models::EmailApiError;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub struct ConnectionRequest {
    pub actor_macro_id: MacroUserIdStr<'static>,
    pub actor_id: String,
    pub actor_fusion_id: String,
    pub attempt: Option<Uuid>,
    pub force_share: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ConnectionOutcome {
    pub link_id: Uuid,
    pub backfill_job_id: Option<Uuid>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    #[error(transparent)]
    MailboxInitialization(InitializationError),
    #[error("User is already initialized")]
    AlreadyInitialized,
    #[error("No Gmail grant available to provision from")]
    NoGmailGrant,
    #[error("Failed to enqueue backfill message")]
    EnqueueError,
    #[error("Database query error")]
    DatabaseError(#[from] anyhow::Error),
    #[error("Email provider operation failed")]
    ProviderError(EmailApiError),
    #[error("Bad request")]
    InvalidUserIdentity,
    #[error("Bad request")]
    InvalidAttemptProvider,
    #[error("Bad request")]
    AttemptOwnerMismatch,
    #[error("Bad request")]
    AttemptAuthenticationIncomplete,
    #[error("Bad request")]
    LoginEmailUnavailable,
    #[error("Invalid input")]
    Parse(#[from] macro_user_id::error::ParseErr),
    /// The mailbox is already an inbox under another account (or another
    /// FusionAuth user of this one), which holds its Google grant.
    #[error("Mailbox is already connected as an inbox in another account")]
    MailboxConnectedElsewhere,
    #[error("Inbox is already connected by another user")]
    SharedInboxConflict {
        email_address: String,
        existing_owner_email: String,
        existing_link_id: Uuid,
    },
}

impl ConnectionError {
    pub fn should_cleanup_attempt(&self) -> bool {
        !matches!(self, Self::SharedInboxConflict { .. })
    }
}

#[derive(Clone)]
pub struct GoogleConnectionAttempt {
    pub provider: String,
    pub owner: Uuid,
    pub email: Option<String>,
    pub requested_scopes: Vec<String>,
    pub granted_scopes: Vec<String>,
}

#[derive(Clone)]
pub struct CompletedGoogleGrant {
    pub intent: CalendarGrantIntent,
    pub granted_scopes: Vec<String>,
}

impl CompletedGoogleGrant {
    pub fn from_attempt(attempt: &GoogleConnectionAttempt) -> Self {
        let requested = GoogleScopeSet::from_scopes(attempt.requested_scopes.iter().cloned());
        Self {
            intent: if requested.has_calendar_capability() {
                CalendarGrantIntent::CalendarRequested
            } else {
                CalendarGrantIntent::Incidental
            },
            granted_scopes: attempt.granted_scopes.clone(),
        }
    }
}

pub struct SharedInboxPromotion {
    pub mailbox_fusion_id: Uuid,
    pub link_id: Uuid,
}

pub fn classify_provider_init_error(error: EmailApiError) -> ConnectionError {
    match error {
        EmailApiError::AuthRequired | EmailApiError::Forbidden => {
            tracing::debug!("no usable Gmail grant for requested inbox");
            ConnectionError::NoGmailGrant
        }
        error => ConnectionError::ProviderError(error),
    }
}
