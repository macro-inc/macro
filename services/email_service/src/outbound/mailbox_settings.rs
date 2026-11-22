use email::domain::mailbox::settings::*;
use email_api_client::domain::{models::*, ports::*, service::mailbox::MailboxApiService};
use models_email::service::{label::Label, link::UserProvider};
use uuid::Uuid;

pub struct ProviderMailboxSettings<R, T, L> {
    pub db: sqlx::PgPool,
    pub imap: super::email_api::imap::ImapMailboxGateway,
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
            UserProvider::Imap => {
                email_db_client::labels::get::fetch_labels_by_link_id(&self.db, mailbox.key.link_id)
                    .await
                    .map_err(|_| EmailApiError::Transient {
                        message: "IMAP keyword catalog unavailable".into(),
                    })
            }
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
            // IMAP keywords have no standalone server catalog; creating one records
            // its name locally until it is first assigned with UID STORE.
            UserProvider::Imap => Ok(Label {
                id: None,
                link_id: mailbox.key.link_id,
                provider_label_id: name.into(),
                name: Some(name.into()),
                created_at: chrono::Utc::now(),
                message_list_visibility: None,
                label_list_visibility: None,
                type_: Some(models_email::service::label::LabelType::User),
            }),
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
            UserProvider::Imap => Ok(()),
        }
    }
    async fn category_messages(
        &self,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> Result<Vec<CategoryMessage>, EmailApiError> {
        if mailbox.provider == UserProvider::Imap {
            return imap_category_messages(&self.imap, mailbox.key, name).await;
        }
        self.outlook.category_messages(access(mailbox), name).await
    }
    async fn remove_category(
        &self,
        mailbox: SettingsMailbox,
        message: &CategoryMessage,
        remaining: Vec<String>,
    ) -> Result<(), EmailApiError> {
        if mailbox.provider == UserProvider::Imap {
            use email::domain::mailbox::commands::MailboxCommandGateway;
            return self
                .imap
                .apply(
                    mailbox.key,
                    &message.id,
                    &MessageAction::SetTags(remaining),
                    message.version.as_deref(),
                )
                .await
                .map(|_| ());
        }
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
        if mailbox.provider == UserProvider::Imap {
            return Ok(Vec::new());
        }
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

async fn imap_category_messages(
    gateway: &super::email_api::imap::ImapMailboxGateway,
    mailbox: email::domain::mailbox::MailboxKey,
    name: &str,
) -> Result<Vec<CategoryMessage>, EmailApiError> {
    use email::domain::mailbox::{MailboxGateway, commands::MailboxCommandGateway};
    let folders = match gateway.folders(mailbox).await? {
        MailFolderCatalog::Folders(folders) => folders,
        MailFolderCatalog::NoMailbox { .. } => return Err(EmailApiError::NotFound),
    };
    let mut result = Vec::new();
    for folder in &folders {
        let mut position = None;
        loop {
            let page = gateway
                .changes(
                    mailbox,
                    &folder.id,
                    position.as_ref(),
                    RoundStart::Unordered,
                )
                .await?;
            for id in page.changed {
                if let Some(message) = gateway.organization(mailbox, &id, &folders).await?
                    && message.tags.iter().any(|tag| tag == name)
                {
                    result.push(CategoryMessage {
                        id,
                        categories: message.tags,
                        version: message.version,
                    });
                    if result.len() >= 100 {
                        return Ok(result);
                    }
                }
            }
            match page.position {
                StreamPosition::Continue(next) => position = Some(next),
                StreamPosition::Checkpoint(_) => break,
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod test;
