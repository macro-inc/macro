//! Authenticated engine wakeups; generation and credential policy live in the domain.

use crate::api::context::{ApiContext, AuthorizationService};
use axum::{Json, extract::State, http::StatusCode};
use email::domain::mailbox::MailboxError;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};

pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(input): Json<imap_service_client::Notification>,
) -> StatusCode {
    notification_status(ctx.imap_notifications.receive(input).await)
}

fn notification_status(result: Result<(), MailboxError>) -> StatusCode {
    match result {
        Ok(()) | Err(MailboxError::Stale) => StatusCode::NO_CONTENT,
        Err(error) => {
            tracing::warn!(%error, "IMAP notification could not be persisted");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn stale_notifications_are_acknowledged_but_persistence_errors_are_retried() {
        assert_eq!(
            notification_status(Err(MailboxError::Stale)),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            notification_status(Err(MailboxError::Persistence)),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
