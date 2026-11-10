//! Email belongs to its inbox owner. The email API admits only `UserOrInternal`,
//! while webhook management and stream routes admit the wider `ActingUser` policy.

#[cfg(test)]
mod test;

use crate::domain::models::WebhookFilter;
use macro_authorization::{AuthorizationPolicy, MacroAuthorization, UserOrInternal};

pub(crate) const EMAIL_EVENT_PREFIX: &str = "email.";

#[derive(Debug, thiserror::Error)]
#[error("email events require the inbox owner's own credential")]
pub(crate) struct EmailEventsForbidden;

/// Whether `principal` is a credential the email API would let read mail.
pub(crate) fn admits_email_events(principal: &MacroAuthorization) -> bool {
    UserOrInternal::narrow(principal.clone()).is_ok()
}

pub(crate) fn authorize_email_event_filters(
    principal: &MacroAuthorization,
    filters: &[WebhookFilter],
) -> Result<(), EmailEventsForbidden> {
    let names_email_event = filters.iter().any(|filter| {
        filter
            .events
            .iter()
            .any(|event| event.starts_with(EMAIL_EVENT_PREFIX))
    });
    if names_email_event && !admits_email_events(principal) {
        return Err(EmailEventsForbidden);
    }
    Ok(())
}
