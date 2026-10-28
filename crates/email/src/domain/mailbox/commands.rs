//! Durable desired-state commands. Unknown writes are read back before retrying.

use super::{MailboxError, MailboxGateway, MailboxKey};
use crate::domain::models::mailbox_action::{MailboxAction, PendingMailboxState};
use email_api_client::domain::models::{
    EmailApiError, FolderRole, MailFolder, MailboxOrganization, MessageAction, ProviderId,
};
use std::future::Future;
use uuid::Uuid;

pub struct CommandLease {
    pub id: Uuid,
    pub lease_id: Uuid,
    pub mailbox: MailboxKey,
    pub action: MailboxAction,
    pub attempts: i32,
}

pub struct CommandTarget {
    pub message_id: Uuid,
    pub provider_id: Option<ProviderId>,
    pub pending: PendingMailboxState,
    /// Draft creation or content synchronization must settle before organization.
    pub awaiting_draft: bool,
    /// A discarded or transferred source must never be resurrected by an old command.
    pub retired: bool,
}

pub struct CommandContext {
    pub authorized: bool,
    pub target: Option<CommandTarget>,
    pub folders: Vec<MailFolder>,
    pub has_errors: bool,
}

#[derive(Clone, Copy)]
pub enum CommandCompletion {
    Succeeded,
    Failed,
    Cancelled,
}

pub trait MailboxCommandRepository: Send + Sync + 'static {
    fn claim_command(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<CommandLease>, MailboxError>> + Send;
    fn renew_command(
        &self,
        lease: &CommandLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn command_context(
        &self,
        lease: &CommandLease,
    ) -> impl Future<Output = Result<CommandContext, MailboxError>> + Send;
    fn defer_for_draft(
        &self,
        lease: &CommandLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Advance only a draft baseline matching the exact version our PATCH changed.
    fn record_write_version(
        &self,
        lease: &CommandLease,
        target: &CommandTarget,
        previous: &str,
        current: &str,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn confirm_target(
        &self,
        lease: &CommandLease,
        target: &CommandTarget,
        snapshot: Option<&MailboxOrganization>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn fail_target(
        &self,
        lease: &CommandLease,
        target: &CommandTarget,
        conflict: bool,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_command(
        &self,
        lease: &CommandLease,
        seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn finish_command(
        &self,
        lease: &CommandLease,
        completion: CommandCompletion,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

pub trait MailboxCommandGateway: MailboxGateway {
    fn organization(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        folders: &[MailFolder],
    ) -> impl Future<Output = Result<Option<MailboxOrganization>, EmailApiError>> + Send;

    fn apply(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        action: &MessageAction,
        expected_version: Option<&str>,
    ) -> impl Future<
        Output = Result<email_api_client::domain::models::MessageWriteReceipt, EmailApiError>,
    > + Send;
}

pub struct MailboxCommandService<R, G> {
    repo: R,
    provider: G,
}
impl<R, G> MailboxCommandService<R, G> {
    pub fn new(repo: R, provider: G) -> Self {
        Self { repo, provider }
    }
}
impl<R: MailboxCommandRepository, G: MailboxCommandGateway> MailboxCommandService<R, G> {
    pub async fn execute_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_command(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let result =
            super::maintain_lease(self.execute(&lease), || self.repo.renew_command(&lease)).await;
        if let Err(error) = &result {
            self.repo
                .release_command(
                    &lease,
                    match error {
                        MailboxError::Provider(e) => super::retry_seconds(e),
                        _ => 30,
                    },
                )
                .await?;
        }
        result.map(|()| true)
    }

    async fn execute(&self, lease: &CommandLease) -> Result<(), MailboxError> {
        let context = self.repo.command_context(lease).await?;
        if !context.authorized {
            return self
                .repo
                .finish_command(lease, CommandCompletion::Cancelled)
                .await;
        }
        let Some(target) = context.target else {
            return self
                .repo
                .finish_command(
                    lease,
                    if context.has_errors {
                        CommandCompletion::Failed
                    } else {
                        CommandCompletion::Succeeded
                    },
                )
                .await;
        };
        if target.retired {
            self.repo.fail_target(lease, &target, false).await?;
            return self.repo.release_command(lease, 0).await;
        }
        if target.awaiting_draft {
            return self.repo.defer_for_draft(lease).await;
        }
        let result = self
            .reconcile_target(lease, &target, &context.folders)
            .await;
        match result {
            Ok(()) => self.repo.release_command(lease, 0).await,
            Err(MailboxError::Provider(EmailApiError::Conflict)) if lease.attempts < 8 => {
                self.repo.release_command(lease, 2).await
            }
            Err(MailboxError::Provider(EmailApiError::NotFound)) if lease.attempts < 3 => {
                self.repo.release_command(lease, 5).await
            }
            Err(MailboxError::Provider(EmailApiError::Conflict | EmailApiError::NotFound)) => {
                self.repo.fail_target(lease, &target, true).await?;
                self.repo.release_command(lease, 0).await
            }
            Err(MailboxError::Provider(
                EmailApiError::Permanent { .. } | EmailApiError::Forbidden,
            )) => {
                self.repo.fail_target(lease, &target, false).await?;
                self.repo.release_command(lease, 0).await
            }
            other => other,
        }
    }

    async fn reconcile_target(
        &self,
        lease: &CommandLease,
        target: &CommandTarget,
        folders: &[MailFolder],
    ) -> Result<(), MailboxError> {
        let Some(id) = &target.provider_id else {
            // Macro-only drafts have no provider side effect to acknowledge.
            return self.repo.confirm_target(lease, target, None).await;
        };
        let snapshot = self
            .provider
            .organization(lease.mailbox, id, folders)
            .await?
            .ok_or(EmailApiError::NotFound)?;
        if let Some(action) = provider_action(&lease.action, &snapshot, folders)? {
            // No optimistic acknowledgement. After a successful or interrupted
            // write, the next attempt reads current state before doing anything.
            let receipt = self
                .provider
                .apply(lease.mailbox, id, &action, snapshot.version.as_deref())
                .await?;
            if &receipt.id != id {
                // Public-cloud immutable IDs must survive supported folder moves.
                // Keep the pending intent visible instead of rebinding by guesswork.
                return Err(EmailApiError::Conflict.into());
            }
            if let (Some(previous), Some(current)) =
                (snapshot.version.as_deref(), receipt.version.as_deref())
            {
                self.repo
                    .record_write_version(lease, target, previous, current)
                    .await?;
            }
            return Ok(());
        }
        self.repo
            .confirm_target(lease, target, Some(&snapshot))
            .await
    }
}

fn provider_action(
    action: &MailboxAction,
    current: &MailboxOrganization,
    folders: &[MailFolder],
) -> Result<Option<MessageAction>, EmailApiError> {
    let destination = match action {
        MailboxAction::Read(value) => {
            return Ok((current.state.is_read != *value).then_some(MessageAction::SetRead(*value)));
        }
        MailboxAction::Flagged(value) => {
            return Ok(
                (current.state.is_flagged != *value).then_some(MessageAction::SetFlagged(*value))
            );
        }
        MailboxAction::Category { name, present } => {
            let contains = current.tags.contains(name);
            if contains == *present {
                return Ok(None);
            }
            let mut tags = current.tags.clone();
            if *present {
                tags.push(name.clone());
            } else {
                tags.retain(|tag| tag != name);
            }
            return Ok(Some(MessageAction::SetTags(tags)));
        }
        MailboxAction::Archived(true) if current.state.in_inbox => FolderRole::Archive,
        MailboxAction::Archived(false) if !current.state.in_inbox => FolderRole::Inbox,
        MailboxAction::Trashed(true) if !current.state.in_trash => FolderRole::Trash,
        MailboxAction::Trashed(false) if current.state.in_trash => {
            if current.state.is_draft {
                FolderRole::Drafts
            } else {
                FolderRole::Inbox
            }
        }
        MailboxAction::Junk(true) if !current.state.in_junk => FolderRole::Junk,
        MailboxAction::Junk(false) if current.state.in_junk => FolderRole::Inbox,
        _ => return Ok(None),
    };
    if destination == FolderRole::Archive && !folders.iter().any(|f| f.role == FolderRole::Archive)
    {
        return Ok(Some(MessageAction::Archive));
    }
    let folder = folders
        .iter()
        .find(|f| f.role == destination)
        .ok_or(EmailApiError::Conflict)?;
    Ok(Some(MessageAction::MoveToFolder(folder.id.clone())))
}
