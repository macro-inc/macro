//! Gmail teardown order and bounded retries. Microsoft grants remain lifecycle-owned.

use super::ports::{LinkDeletionAuth, LinkDeletionGmail};
use email_api_client::domain::models::EmailApiError;
use models_email::service::{
    cache::TokenCacheKey,
    link::{Link, UserProvider},
};
use std::{future::Future, time::Duration};
/// Backoff schedule for teardown provider calls: three attempts total.
const TEARDOWN_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(200), Duration::from_millis(400)];

/// Runs a teardown provider call with a bounded retry (3 attempts, 200/400ms).
///
/// Only transient failures retry. Permanent errors (revoked grants, missing
/// scopes) return immediately: retrying cannot help while tearing a link down.
async fn retry_teardown<F, Fut>(mut operation: F) -> Result<(), EmailApiError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), EmailApiError>>,
{
    let mut delays = TEARDOWN_RETRY_DELAYS.iter();
    loop {
        match operation().await {
            Ok(()) => return Ok(()),
            Err(error) if error.is_transient() => match delays.next() {
                Some(delay) => tokio::time::sleep(*delay).await,
                None => return Err(error),
            },
            Err(error) => return Err(error),
        }
    }
}

pub(super) async fn remove_provider_link<G: LinkDeletionGmail, A: LinkDeletionAuth>(
    gmail: &G,
    auth: &A,
    link: &Link,
) {
    // Microsoft grants are revoked by the lifecycle outbox after the binding
    // is frozen. Gmail owns an independent FusionAuth grant and watch.
    if link.provider != UserProvider::Gmail {
        return;
    }
    // Best effort: revoked grants and provider failures must not block local teardown.
    // Stop before evicting the token so a valid cached grant remains available for the call.
    // The health-neutral path never marks the link as needing reauth or notifies the
    // user about an inbox that is being intentionally removed.
    retry_teardown(|| gmail.stop_subscription_for_link(link))
        .await
        .inspect_err(|error| {
            tracing::warn!(error=?error, "Gmail call to stop watch failed");
        })
        .ok();

    // delete cached access token, in case user re-enables within cache window
    gmail
        .delete_gmail_access_token(&TokenCacheKey::new(
            link.fusionauth_user_id.clone(),
            link.email_address.0.as_ref(),
            UserProvider::Gmail.as_str(),
        ))
        .await
        .inspect_err(|e| {
            tracing::warn!(error=?e, "Failed to delete Gmail access token");
        })
        .ok();

    // remove google fusionauth link with gmail inbox permissions. best-effort: the FA user may
    // already be gone (e.g. account deleted before we delete their email), so we warn and keep
    // going rather than failing the message and retrying.
    auth.remove_link(
        &link.fusionauth_user_id,
        link.email_address.0.as_ref(),
        "google_gmail",
    )
    .await
    .inspect_err(|e| {
        tracing::warn!(error=?e, "Failed to remove FusionAuth IdP link");
    })
    .ok();
}

#[cfg(test)]
mod test;
