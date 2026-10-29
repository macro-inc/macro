use email::domain::mailbox::settings::*;
use email_api_client::domain::{models::*, ports::*, service::mailbox::MailboxApiService};
use models_email::service::{label::Label, link::UserProvider};
use uuid::Uuid;

pub struct ProviderMailboxSettings<R, T, L> {
    pub gmail: super::email_api::GmailApi,
    pub outlook: MailboxApiService<R, T, L>,
}
fn access(mailbox: SettingsMailbox) -> MailboxAccess {
    MailboxAccess {
        link_id: mailbox.key.link_id,
        sync_generation: mailbox.key.sync_generation,
        grant_generation: mailbox.key.grant_generation,
    }
}
impl<R, T, L> MailboxSettingsGateway for ProviderMailboxSettings<R, T, L>
where
    R: MailboxSettingsClient + MailboxLabelClient + MailboxActionWriter + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
{
    async fn labels(&self, mailbox: SettingsMailbox) -> Result<Vec<Label>, EmailApiError> {
        match mailbox.provider {
            UserProvider::Gmail => self.gmail.list_labels(mailbox.key.link_id).await,
            UserProvider::Outlook => self.outlook.labels(access(mailbox)).await,
        }
    }
    async fn create_label(
        &self,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> Result<Label, EmailApiError> {
        match mailbox.provider {
            UserProvider::Gmail => self.gmail.create_label(mailbox.key.link_id, name).await,
            UserProvider::Outlook => self.outlook.create_label(access(mailbox), name).await,
        }
    }
    async fn delete_label(
        &self,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> Result<(), EmailApiError> {
        match mailbox.provider {
            UserProvider::Gmail => self.gmail.delete_label(mailbox.key.link_id, name).await,
            UserProvider::Outlook => self.outlook.delete_label(access(mailbox), name).await,
        }
    }
    async fn category_messages(
        &self,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> Result<Vec<CategoryMessage>, EmailApiError> {
        self.outlook.category_messages(access(mailbox), name).await
    }
    async fn remove_category(
        &self,
        mailbox: SettingsMailbox,
        message: &CategoryMessage,
        remaining: Vec<String>,
    ) -> Result<(), EmailApiError> {
        self.outlook
            .apply(
                access(mailbox),
                &message.id,
                &MessageAction::SetTags(remaining),
                message.version.as_deref(),
            )
            .await
            .map(|_| ())
    }
    async fn sender_rules(
        &self,
        mailbox: SettingsMailbox,
    ) -> Result<Vec<OwnedSenderRule>, EmailApiError> {
        self.outlook.sender_rules(access(mailbox)).await
    }
    async fn create_sender_rule(
        &self,
        mailbox: SettingsMailbox,
        id: Uuid,
        sender: &str,
    ) -> Result<(), EmailApiError> {
        self.outlook
            .create_sender_rule(access(mailbox), id, sender)
            .await
            .map(|_| ())
    }
    async fn remove_sender_rule(
        &self,
        mailbox: SettingsMailbox,
        id: &ProviderId,
    ) -> Result<(), EmailApiError> {
        self.outlook.remove_sender_rule(access(mailbox), id).await
    }
    async fn gmail_blocked(&self, mailbox: SettingsMailbox) -> Result<Vec<String>, EmailApiError> {
        self.gmail.list_blocked_senders(mailbox.key.link_id).await
    }
    async fn gmail_set_block(
        &self,
        mailbox: SettingsMailbox,
        sender: &str,
        blocked: bool,
    ) -> Result<(), EmailApiError> {
        if blocked {
            self.gmail.block_sender(mailbox.key.link_id, sender).await
        } else {
            self.gmail.unblock_sender(mailbox.key.link_id, sender).await
        }
    }
}
