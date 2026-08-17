//! Gmail mailbox-subscription capability implementation.

use chrono::{TimeZone, Utc};

use crate::domain::models::{AccessToken, EmailApiError, ProviderSubscription, SyncCursor};
use crate::domain::ports::MailboxSubscriptionClient;

use super::{GmailApiClientRepository, is_watch_conflict, map_gmail_error, map_watch_error};

impl MailboxSubscriptionClient for GmailApiClientRepository {
    async fn subscribe(
        &self,
        access_token: &AccessToken,
    ) -> Result<ProviderSubscription, EmailApiError> {
        let token = access_token.expose_secret();
        let watch = match self.client.register_watch(token).await {
            Ok(watch) => watch,
            Err(error) if is_watch_conflict(&error) => {
                tracing::warn!(
                    error = %error,
                    "Gmail watch conflict; stopping the existing watch and retrying once"
                );
                self.client
                    .stop_watch(token)
                    .await
                    .map_err(map_gmail_error)?;
                self.client
                    .register_watch(token)
                    .await
                    .map_err(map_watch_error)?
            }
            Err(error) => return Err(map_watch_error(error)),
        };

        let expiration =
            watch
                .expiration
                .parse::<i64>()
                .map_err(|error| EmailApiError::Permanent {
                    message: format!("Gmail watch returned an invalid expiration: {error}"),
                })?;
        let expires_at = Utc
            .timestamp_millis_opt(expiration)
            .single()
            .ok_or_else(|| EmailApiError::Permanent {
                message: "Gmail watch returned an out-of-range expiration".to_string(),
            })?;

        Ok(ProviderSubscription::new(
            SyncCursor::gmail(watch.history_id),
            expires_at,
        ))
    }

    async fn unsubscribe(&self, access_token: &AccessToken) -> Result<(), EmailApiError> {
        self.client
            .stop_watch(access_token.expose_secret())
            .await
            .map_err(map_gmail_error)
    }
}
