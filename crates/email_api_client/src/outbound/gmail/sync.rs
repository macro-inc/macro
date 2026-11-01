//! Gmail mailbox-sync capability implementation.

use crate::domain::models::{AccessToken, ChangePage, EmailApiError, SyncCursor};
use crate::domain::ports::MailboxSyncClient;

use super::convert::map_history_page;
use super::{GmailApiClientRepository, map_gmail_error, map_history_error};

impl MailboxSyncClient for GmailApiClientRepository {
    async fn get_thread_count(&self, access_token: &AccessToken) -> Result<u64, EmailApiError> {
        let profile = self
            .client
            .get_profile(access_token.expose_secret())
            .await
            .map_err(map_gmail_error)?;
        u64::try_from(profile.threads_total).map_err(|_| EmailApiError::Permanent {
            message: format!(
                "Gmail profile returned a negative thread count: {}",
                profile.threads_total
            ),
        })
    }

    async fn list_changes_page(
        &self,
        access_token: &AccessToken,
        cursor: &SyncCursor,
        page_token: Option<&str>,
    ) -> Result<ChangePage, EmailApiError> {
        let history = self
            .client
            .get_history_page(access_token.expose_secret(), cursor.as_str(), page_token)
            .await
            .map_err(map_history_error)?;
        Ok(map_history_page(history))
    }
}
