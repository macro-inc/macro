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

pub(crate) fn authorize_email_event_filters(
    principal: &MacroAuthorization,
    filters: &[WebhookFilter],
) -> Result<(), EmailEventsForbidden> {
    if !filters.iter().any(|filter| {
        filter
            .events
            .iter()
            .any(|event| event.starts_with(EMAIL_EVENT_PREFIX))
    }) {
        return Ok(());
    }

    UserOrInternal::narrow(principal.clone())
        .map(|_| ())
        .map_err(|_| EmailEventsForbidden)
}
