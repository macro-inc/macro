//! Owner-only server and folder settings adapters.
use super::imap_connection::{ImapConnectionClient, PgImapConnections};
use email::domain::mailbox::{imap_connection::ImapConnectionError, imap_settings::*};
use imap_service_client::Binding;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

impl ImapSettingsAccessRepository for PgImapConnections {
    async fn settings_access(
        &self,
        link: Uuid,
    ) -> Result<Option<ImapSettingsAccess>, ImapConnectionError> {
        let row = sqlx::query!(
            r#"
            SELECT
                macro_id,
                provider = 'IMAP' AS "uses_imap!",
                is_sync_active
                AND disconnect_requested_at IS NULL
                AND deleting_at IS NULL AS "active!",
                sync_generation,
                grant_generation
            FROM
                email_links
            WHERE
                id = $1
            "#,
            link,
        )
        .fetch_optional(&self.0)
        .await
        .map_err(super::imap_connection::failure)?;
        row.map(|row| {
            Ok(ImapSettingsAccess {
                owner: MacroUserIdStr::try_from(row.macro_id)
                    .map_err(|_| ImapConnectionError::Unavailable)?,
                uses_imap: row.uses_imap,
                active: row.active,
                binding: Binding {
                    link_id: link,
                    sync_generation: row.sync_generation,
                    grant_generation: row.grant_generation,
                },
            })
        })
        .transpose()
    }
}

impl ImapSettingsGateway for ImapConnectionClient {
    async fn settings(&self, binding: Binding) -> Result<AccountMailSettings, ImapConnectionError> {
        Ok(self.client.account_mail_settings(binding).await?)
    }
    async fn update_settings(
        &self,
        binding: Binding,
        change: &UpdateFolderSettings,
    ) -> Result<AccountMailSettings, ImapConnectionError> {
        Ok(self.client.update_mail_settings(binding, change).await?)
    }
}
