//! Account-level IMAP configuration is available only to the owner of a current link.
use super::imap_connection::{ImapConnectionError, ImapConnectionService};
pub use imap_engine::domain::account_settings::{AccountMailSettings, UpdateFolderSettings};
use imap_engine::domain::models::{Binding, Error};
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use uuid::Uuid;

/// Current ownership and lifecycle facts from the mailbox catalog.
pub struct ImapSettingsAccess {
    /// Primary owner of this mailbox.
    pub owner: MacroUserIdStr<'static>,
    /// Whether this link uses the IMAP engine.
    pub uses_imap: bool,
    /// The link is active and has no removal request.
    pub active: bool,
    /// Current sync and grant generations.
    pub binding: Binding,
}

impl ImapSettingsAccess {
    fn authorize(self, actor: &MacroUserIdStr<'_>) -> Result<Binding, ImapConnectionError> {
        if self.owner.as_ref() == actor.as_ref() && self.uses_imap && self.active {
            Ok(self.binding)
        } else {
            Err(Error::NotFound.into())
        }
    }
}

/// Read authoritative ownership facts even when an inbox is shared with another user.
pub trait ImapSettingsAccessRepository: Send + Sync {
    fn settings_access(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Option<ImapSettingsAccess>, ImapConnectionError>> + Send;
}

/// Call the engine using the exact binding approved by the email domain.
pub trait ImapSettingsGateway: Send + Sync {
    fn settings(
        &self,
        binding: Binding,
    ) -> impl Future<Output = Result<AccountMailSettings, ImapConnectionError>> + Send;
    fn update_settings(
        &self,
        binding: Binding,
        change: &UpdateFolderSettings,
    ) -> impl Future<Output = Result<AccountMailSettings, ImapConnectionError>> + Send;
}

impl<R: ImapSettingsAccessRepository, G: ImapSettingsGateway, F> ImapConnectionService<R, G, F> {
    async fn owner_binding(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
    ) -> Result<Binding, ImapConnectionError> {
        self.repository
            .settings_access(link)
            .await?
            .ok_or(Error::NotFound)?
            .authorize(actor)
    }
    /// Read sanitized setup and routing for an owned mailbox.
    pub async fn mail_settings(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
    ) -> Result<AccountMailSettings, ImapConnectionError> {
        self.gateway
            .settings(self.owner_binding(actor, link).await?)
            .await
    }
    /// Apply one optimistic edit. Credential fields are absent from the input type.
    pub async fn edit_mail_settings(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        change: &UpdateFolderSettings,
    ) -> Result<AccountMailSettings, ImapConnectionError> {
        self.gateway
            .update_settings(self.owner_binding(actor, link).await?, change)
            .await
    }
}

#[cfg(test)]
mod test;
