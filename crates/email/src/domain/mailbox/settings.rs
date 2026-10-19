//! Mailbox settings belong to the inbox, including after its credential custodian changes.
//! Accepted work is durable; provider reads precede retries of uncertain writes.

use super::*;
use email_api_client::domain::models::{CategoryMessage, OwnedSenderRule};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{label::Label, link::UserProvider};

#[derive(Clone, Copy)]
pub struct SettingsMailbox {
    pub key: MailboxKey,
    pub provider: UserProvider,
}
pub struct SettingsLease {
    pub id: Uuid,
    pub lease_id: Uuid,
    pub mailbox: SettingsMailbox,
    pub revision: i64,
    pub kind: String,
    pub resource: String,
    pub desired: bool,
}
pub struct SenderRuleIntent {
    pub id: Uuid,
    pub sender: String,
    pub desired: bool,
    pub pending: bool,
}

/// An accepted inbox configuration change awaiting provider confirmation.
#[derive(Clone, Debug, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct MailboxSettingsOperation {
    pub id: Uuid,
    pub kind: MailboxSettingsChange,
    pub resource: String,
    pub enabled: bool,
    pub needs_attention: bool,
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MailboxSettingsChange {
    CreateLabel,
    DeleteLabel,
    SenderBlock,
}

pub trait MailboxSettingsRepository: Send + Sync + 'static {
    fn accessible(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
    ) -> impl Future<Output = Result<SettingsMailbox, MailboxError>> + Send;
    fn store_label(
        &self,
        actor: &MacroUserIdStr<'_>,
        mailbox: SettingsMailbox,
        label: Label,
    ) -> impl Future<Output = Result<Label, MailboxError>> + Send;
    /// Atomically records an optimistic category and durable provider creation.
    fn queue_label_creation(
        &self,
        actor: &MacroUserIdStr<'_>,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> impl Future<Output = Result<Label, MailboxError>> + Send;
    /// Commits the provider result only for the still-current creation lease.
    fn commit_created_label(
        &self,
        lease: &SettingsLease,
        label: Label,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn delete_label(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        label: Uuid,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn sender_block(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        sender: &str,
        blocked: bool,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn sender_intents(
        &self,
        mailbox: SettingsMailbox,
    ) -> impl Future<Output = Result<Vec<SenderRuleIntent>, MailboxError>> + Send;
    fn pending_operations(
        &self,
        mailbox: SettingsMailbox,
    ) -> impl Future<Output = Result<Vec<MailboxSettingsOperation>, MailboxError>> + Send;
    fn claim_settings(
        &self,
        lease_id: Uuid,
        outlook_sync: bool,
        outlook_writes: bool,
    ) -> impl Future<Output = Result<Option<SettingsLease>, MailboxError>> + Send;
    fn renew_settings(
        &self,
        lease: &SettingsLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn commit_labels(
        &self,
        lease: &SettingsLease,
        labels: &[Label],
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn reconcile_settings_message(
        &self,
        lease: &SettingsLease,
        message: &ProviderId,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn finish_settings(
        &self,
        lease: &SettingsLease,
        complete: bool,
        delay: u32,
        failure: Option<&str>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
pub trait MailboxSettingsGateway: Send + Sync + 'static {
    fn labels(
        &self,
        mailbox: SettingsMailbox,
    ) -> impl Future<Output = Result<Vec<Label>, EmailApiError>> + Send;
    fn create_label(
        &self,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> impl Future<Output = Result<Label, EmailApiError>> + Send;
    fn delete_label(
        &self,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    fn category_messages(
        &self,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> impl Future<Output = Result<Vec<CategoryMessage>, EmailApiError>> + Send;
    fn remove_category(
        &self,
        mailbox: SettingsMailbox,
        message: &CategoryMessage,
        remaining: Vec<String>,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    fn sender_rules(
        &self,
        mailbox: SettingsMailbox,
    ) -> impl Future<Output = Result<Vec<OwnedSenderRule>, EmailApiError>> + Send;
    fn create_sender_rule(
        &self,
        mailbox: SettingsMailbox,
        id: Uuid,
        sender: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    fn remove_sender_rule(
        &self,
        mailbox: SettingsMailbox,
        id: &ProviderId,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    fn gmail_blocked(
        &self,
        mailbox: SettingsMailbox,
    ) -> impl Future<Output = Result<Vec<String>, EmailApiError>> + Send;
    fn gmail_set_block(
        &self,
        mailbox: SettingsMailbox,
        sender: &str,
        blocked: bool,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}

pub struct MailboxSettingsService<R, G> {
    outlook_sync: bool,
    outlook_writes: bool,
    repository: R,
    gateway: G,
}
impl<R, G> MailboxSettingsService<R, G> {
    pub fn with_outlook_runtime(mut self, sync: bool, writes: bool) -> Self {
        self.outlook_sync = sync;
        self.outlook_writes = writes;
        self
    }
    pub fn new(repository: R, gateway: G) -> Self {
        Self {
            repository,
            gateway,
            outlook_sync: true,
            outlook_writes: true,
        }
    }
}
impl<R: MailboxSettingsRepository, G: MailboxSettingsGateway> MailboxSettingsService<R, G> {
    pub async fn create_label(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        name: &str,
    ) -> Result<Label, MailboxError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 255 || name.chars().any(char::is_control) {
            return Err(MailboxError::InvalidInput("invalid label name"));
        }
        let mailbox = self.repository.accessible(actor, link).await?;
        if mailbox.provider == UserProvider::Outlook {
            return self
                .repository
                .queue_label_creation(actor, mailbox, name)
                .await;
        }
        // The provider's unique category name is the natural idempotency key.
        // A lost response or failed local commit is recovered by the next read.
        let existing = self
            .gateway
            .labels(mailbox)
            .await?
            .into_iter()
            .find(|label| label.name.as_deref() == Some(name));
        let label = match existing {
            Some(label) => label,
            None => self.gateway.create_label(mailbox, name).await?,
        };
        self.repository.store_label(actor, mailbox, label).await
    }
    pub async fn delete_label(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        label: Uuid,
    ) -> Result<(), MailboxError> {
        self.repository.accessible(actor, link).await?;
        self.repository.delete_label(actor, link, label).await
    }
    pub async fn sender_block(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        sender: &str,
        blocked: bool,
    ) -> Result<(), MailboxError> {
        let sender = sender.trim().to_ascii_lowercase();
        if sender.len() > 254
            || sender.chars().any(char::is_whitespace)
            || sender.chars().any(char::is_control)
            || macro_user_id::email::EmailStr::try_from(sender.clone()).is_err()
        {
            return Err(MailboxError::InvalidInput("invalid sender address"));
        }
        self.repository.accessible(actor, link).await?;
        self.repository
            .sender_block(actor, link, &sender, blocked)
            .await
    }
    pub async fn blocked_senders(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
    ) -> Result<Vec<String>, MailboxError> {
        let mailbox = self.repository.accessible(actor, link).await?;
        let intents = self.repository.sender_intents(mailbox).await?;
        let mut result = match mailbox.provider {
            UserProvider::Gmail => self.gateway.gmail_blocked(mailbox).await?,
            UserProvider::Outlook => self
                .gateway
                .sender_rules(mailbox)
                .await?
                .into_iter()
                .filter(|rule| {
                    rule.enabled
                        && intents
                            .iter()
                            .any(|i| i.id == rule.correlation && i.sender == rule.sender)
                })
                .map(|r| r.sender)
                .collect(),
        };
        result.sort();
        result.dedup();
        Ok(result)
    }
    pub async fn pending_operations(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
    ) -> Result<Vec<MailboxSettingsOperation>, MailboxError> {
        let mailbox = self.repository.accessible(actor, link).await?;
        self.repository.pending_operations(mailbox).await
    }
    pub async fn execute_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repository
            .claim_settings(
                macro_uuid::generate_uuid_v7(),
                self.outlook_sync,
                self.outlook_writes,
            )
            .await?
        else {
            return Ok(false);
        };
        let result = super::maintain_lease(self.execute(&lease), || {
            self.repository.renew_settings(&lease)
        })
        .await;
        if let Err(error) = &result {
            let delay = match error {
                MailboxError::Provider(e) => super::retry_seconds(e),
                _ => 30,
            };
            self.repository
                .finish_settings(&lease, false, delay, Some("provider_settings_unavailable"))
                .await?;
        }
        result.map(|()| true)
    }
    async fn execute(&self, lease: &SettingsLease) -> Result<(), MailboxError> {
        match lease.kind.as_str() {
            "catalog" => {
                let labels = self.gateway.labels(lease.mailbox).await?;
                self.repository.commit_labels(lease, &labels).await?;
                self.repository
                    .finish_settings(lease, true, 300, None)
                    .await
            }
            "create_label" => {
                // A lost creation response is recovered by the category's unique name.
                let existing = self
                    .gateway
                    .labels(lease.mailbox)
                    .await?
                    .into_iter()
                    .find(|label| label.name.as_deref() == Some(&lease.resource));
                self.repository.renew_settings(lease).await?;
                let label = match existing {
                    Some(label) => label,
                    None => {
                        self.gateway
                            .create_label(lease.mailbox, &lease.resource)
                            .await?
                    }
                };
                self.repository.commit_created_label(lease, label).await
            }
            "delete_label" => {
                if lease.mailbox.provider == UserProvider::Outlook {
                    let messages = self
                        .gateway
                        .category_messages(lease.mailbox, &lease.resource)
                        .await?;
                    if !messages.is_empty() {
                        for message in messages {
                            self.repository.renew_settings(lease).await?;
                            let remaining = message
                                .categories
                                .iter()
                                .filter(|c| *c != &lease.resource)
                                .cloned()
                                .collect();
                            self.gateway
                                .remove_category(lease.mailbox, &message, remaining)
                                .await?;
                            self.repository
                                .reconcile_settings_message(lease, &message.id)
                                .await?;
                        }
                        return self.repository.finish_settings(lease, false, 0, None).await;
                    }
                }
                self.gateway
                    .delete_label(lease.mailbox, &lease.resource)
                    .await?;
                self.repository.finish_settings(lease, true, 0, None).await
            }
            "sender_block" if lease.mailbox.provider == UserProvider::Gmail => {
                self.gateway
                    .gmail_set_block(lease.mailbox, &lease.resource, lease.desired)
                    .await?;
                self.repository.finish_settings(lease, true, 0, None).await
            }
            "sender_block" => {
                let rules = self.gateway.sender_rules(lease.mailbox).await?;
                let owned: Vec<_> = rules
                    .into_iter()
                    .filter(|rule| {
                        rule.correlation == lease.id
                            && rule.sender.eq_ignore_ascii_case(&lease.resource)
                    })
                    .collect();
                let keep = if lease.desired {
                    owned.iter().find(|r| r.enabled).map(|r| r.id.clone())
                } else {
                    None
                };
                // Keep one enabled rule and clean redundant owned creations
                // following an interrupted provider response.
                for rule in owned {
                    if keep.as_ref() != Some(&rule.id) {
                        self.repository.renew_settings(lease).await?;
                        self.gateway
                            .remove_sender_rule(lease.mailbox, &rule.id)
                            .await?;
                    }
                }
                if lease.desired && keep.is_none() {
                    self.repository.renew_settings(lease).await?;
                    self.gateway
                        .create_sender_rule(lease.mailbox, lease.id, &lease.resource)
                        .await?;
                }
                self.repository.finish_settings(lease, true, 0, None).await
            }
            _ => Err(MailboxError::Persistence),
        }
    }
}
