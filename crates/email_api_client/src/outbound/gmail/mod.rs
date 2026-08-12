//! Gmail implementation of the provider-neutral email API capabilities.

mod attachments;
mod blocklist;
mod contacts;
pub(crate) mod convert;

pub use convert::sanitizer::{sanitize_email_html, sanitize_html_fragment};
mod labels;
mod messages;
mod send;
mod subscription;
mod sync;

#[cfg(test)]
mod test;

use gmail_client::{GmailApiHttpError, GmailClient};
use models_email::gmail::inbox_sync::{
    GoogleJwtClaims, GooglePublicKeys, JwtVerificationError, KeyMap,
};

use crate::domain::models::{EmailApiError, RateLimitOrigin};

const WATCH_CONFLICT_BODY_FRAGMENT: &str = "push notification client allowed";

/// Gmail-backed implementation of the email API capability ports.
///
/// The raw Gmail client remains encapsulated by this adapter. Composition roots
/// that only need email capabilities can construct the repository directly from
/// a subscription topic.
#[derive(Clone, Debug)]
pub struct GmailApiClientRepository {
    client: GmailClient,
}

impl GmailApiClientRepository {
    /// Creates a repository from an existing Gmail wire client.
    pub fn new(client: GmailClient) -> Self {
        Self { client }
    }

    /// Creates a repository configured to publish watch events to `subscription_topic`.
    pub fn from_subscription_topic(subscription_topic: impl Into<String>) -> Self {
        Self::new(GmailClient::new(subscription_topic.into()))
    }

    /// Fetches Google's public keys used to verify Gmail webhook JWTs.
    ///
    /// Webhook authentication is intentionally exposed as an inherent adapter
    /// operation rather than as a provider-neutral mailbox capability.
    pub async fn get_google_public_keys(&self) -> Result<GooglePublicKeys, EmailApiError> {
        self.client
            .get_google_public_keys()
            .await
            .map_err(map_gmail_error)
    }

    /// Verifies a Gmail webhook JWT with previously fetched Google public keys.
    ///
    /// This provider-specific authentication operation does not belong to the
    /// neutral email capability traits.
    pub fn verify_google_token(
        &self,
        token: &str,
        public_keys: KeyMap,
    ) -> Result<GoogleJwtClaims, JwtVerificationError> {
        self.client.verify_google_token(token, public_keys)
    }
}

/// Gmail signals per-user quota exhaustion as HTTP 403 with one of these
/// `reason` strings; 429 is only one of its rate-limit forms.
const QUOTA_403_REASONS: [&str; 4] = [
    "userRateLimitExceeded",
    "rateLimitExceeded",
    "dailyLimitExceeded",
    "quotaExceeded",
];

fn is_quota_403_body(body: &str) -> bool {
    QUOTA_403_REASONS.iter().any(|reason| body.contains(reason))
}

pub(crate) fn map_gmail_error(error: GmailApiHttpError) -> EmailApiError {
    match error {
        GmailApiHttpError::Http {
            status,
            body,
            retry_after,
        } => match status.as_u16() {
            401 => EmailApiError::AuthRequired,
            403 if is_quota_403_body(&body) => EmailApiError::RateLimited {
                retry_after,
                origin: RateLimitOrigin::Provider,
            },
            403 => EmailApiError::Forbidden,
            404 => EmailApiError::NotFound,
            409 => EmailApiError::Conflict,
            429 => EmailApiError::RateLimited {
                retry_after,
                origin: RateLimitOrigin::Provider,
            },
            500..=599 => EmailApiError::Transient {
                message: format!("Gmail API returned {status}: {body}"),
            },
            _ => EmailApiError::Permanent {
                message: format!("Gmail API returned {status}: {body}"),
            },
        },
        GmailApiHttpError::Transport(error) => EmailApiError::Transient {
            message: format!("Gmail API transport error: {error}"),
        },
        GmailApiHttpError::Decode(error) => EmailApiError::Permanent {
            message: format!("Gmail API response decode error: {error}"),
        },
        GmailApiHttpError::InvalidResponse(message) => EmailApiError::Permanent {
            message: format!("Gmail API returned an invalid response: {message}"),
        },
    }
}

pub(crate) fn map_history_error(error: GmailApiHttpError) -> EmailApiError {
    if error.status().is_some_and(|status| status.as_u16() == 404) {
        return EmailApiError::OutdatedCursor;
    }

    map_gmail_error(error)
}

pub(crate) fn is_watch_conflict(error: &GmailApiHttpError) -> bool {
    error.status().is_some_and(|status| status.as_u16() == 400)
        && error.body().is_some_and(|body| {
            body.to_ascii_lowercase()
                .contains(WATCH_CONFLICT_BODY_FRAGMENT)
        })
}

/// People API reports an expired contacts sync token (~7-day expiry) as
/// HTTP 400 with this reason; it is a stale cursor, not a permanent failure.
const EXPIRED_SYNC_TOKEN_FRAGMENT: &str = "EXPIRED_SYNC_TOKEN";

pub(crate) fn map_contacts_error(error: GmailApiHttpError) -> EmailApiError {
    if error.status().is_some_and(|status| status.as_u16() == 400)
        && error
            .body()
            .is_some_and(|body| body.contains(EXPIRED_SYNC_TOKEN_FRAGMENT))
    {
        return EmailApiError::OutdatedCursor;
    }

    map_gmail_error(error)
}

pub(crate) fn map_watch_error(error: GmailApiHttpError) -> EmailApiError {
    if is_watch_conflict(&error) {
        return EmailApiError::Conflict;
    }

    map_gmail_error(error)
}
