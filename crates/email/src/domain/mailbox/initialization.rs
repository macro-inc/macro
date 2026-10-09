//! Verified-grant adoption and Macro sharing policy, separate from provider sync.

use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Debug, thiserror::Error)]
pub enum InitializationError {
    #[error("a professional subscription is required to link an additional inbox")]
    PaymentRequired,
    #[error("the linking attempt is not valid for this user")]
    InvalidAttempt,
    #[error("the mailbox identity differs from the connected inbox")]
    IdentityConflict,
    #[error("sharing this inbox requires confirmation")]
    SharingConfirmation {
        link_id: Uuid,
        email: String,
        owner_email: String,
    },
    #[error("the mailbox changed while connecting; retry")]
    Changed,
    #[error("mailbox initialization is temporarily unavailable")]
    Unavailable,
}

#[derive(Debug, Clone)]
pub struct VerifiedMailboxGrant {
    pub scopes: Vec<String>,
    pub calendar_requested: bool,
    pub id: Uuid,
    pub generation: i64,
    pub owner: Uuid,
    pub email: String,
    pub tenant_id: String,
    pub mailbox_id: String,
}

#[derive(Debug, Clone)]
pub struct InitializeMailbox {
    pub attempt: Uuid,
    pub actor: MacroUserIdStr<'static>,
    pub actor_fusion_id: Uuid,
    pub force_share: bool,
}

/// A complete concurrency comparison, revalidated when committing a decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExistingMailbox {
    pub id: Uuid,
    pub owner: MacroUserIdStr<'static>,
    pub grant_id: Option<Uuid>,
    pub grant_generation: i64,
    pub sync_generation: i64,
    pub tenant_id: Option<String>,
    pub mailbox_id: Option<String>,
    pub actor_has_access: bool,
}

pub struct InitializationSnapshot {
    pub entitlement: crate::domain::inbox_entitlement::InboxConnectionFacts,
    pub existing: Option<ExistingMailbox>,
    pub account_for_email: Option<MacroUserIdStr<'static>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitializationDecision {
    Create { owner: MacroUserIdStr<'static> },
    Reconnect,
    Delegate,
    Promote,
}

pub trait CompletedMailboxGrantSource: Send + Sync + 'static {
    fn completed_grant(
        &self,
        attempt: Uuid,
        owner: Uuid,
    ) -> impl Future<Output = Result<VerifiedMailboxGrant, InitializationError>> + Send;
}

pub trait MailboxInitializationRepository: Send + Sync + 'static {
    fn recognizes(
        &self,
        request: &InitializeMailbox,
    ) -> impl Future<Output = Result<bool, InitializationError>> + Send;
    /// A receipt is usable only while the actor still has access to its link.
    fn completed(
        &self,
        request: &InitializeMailbox,
    ) -> impl Future<Output = Result<Option<Uuid>, InitializationError>> + Send;
    fn inspect(
        &self,
        request: &InitializeMailbox,
        grant: &VerifiedMailboxGrant,
    ) -> impl Future<Output = Result<InitializationSnapshot, InitializationError>> + Send;
    /// Under a mailbox lock, revalidate the snapshot and consume the OAuth
    /// attempt with the link, access edges, import stream and receipt atomically.
    fn commit(
        &self,
        request: &InitializeMailbox,
        grant: &VerifiedMailboxGrant,
        snapshot: &InitializationSnapshot,
        decision: InitializationDecision,
    ) -> impl Future<Output = Result<Uuid, InitializationError>> + Send;
}

pub struct MailboxInitializationService<R, G> {
    repo: R,
    grants: G,
    connections_enabled: bool,
}

impl<R, G> MailboxInitializationService<R, G> {
    pub fn new(repo: R, grants: G) -> Self {
        Self {
            repo,
            grants,
            connections_enabled: true,
        }
    }
    /// Disable adoption of new mailboxes while keeping verified reconnects available.
    pub fn with_connections_enabled(mut self, enabled: bool) -> Self {
        self.connections_enabled = enabled;
        self
    }
}

impl<R: MailboxInitializationRepository, G: CompletedMailboxGrantSource>
    MailboxInitializationService<R, G>
{
    pub async fn recognizes(
        &self,
        request: &InitializeMailbox,
    ) -> Result<bool, InitializationError> {
        self.repo.recognizes(request).await
    }
    pub async fn initialize(
        &self,
        request: InitializeMailbox,
    ) -> Result<Uuid, InitializationError> {
        if let Some(id) = self.repo.completed(&request).await? {
            return Ok(id);
        }
        let grant = self
            .grants
            .completed_grant(request.attempt, request.actor_fusion_id)
            .await?;
        if grant.owner != request.actor_fusion_id
            || grant.generation < 1
            || grant.tenant_id.is_empty()
            || grant.mailbox_id.is_empty()
            || macro_user_id::email::EmailStr::try_from(grant.email.clone()).is_err()
        {
            return Err(InitializationError::InvalidAttempt);
        }
        for _ in 0..3 {
            let snapshot = self.repo.inspect(&request, &grant).await?;
            if !self.connections_enabled && !snapshot.entitlement.reconnecting {
                return Err(InitializationError::Unavailable);
            }
            let decision = decide(&request, &grant, &snapshot)?;
            match self
                .repo
                .commit(&request, &grant, &snapshot, decision)
                .await
            {
                Err(InitializationError::Changed) => {
                    if let Some(id) = self.repo.completed(&request).await? {
                        return Ok(id);
                    }
                }
                result => return result,
            }
        }
        Err(InitializationError::Changed)
    }
}

fn decide(
    request: &InitializeMailbox,
    grant: &VerifiedMailboxGrant,
    snapshot: &InitializationSnapshot,
) -> Result<InitializationDecision, InitializationError> {
    if !snapshot.entitlement.permits_connection() {
        return Err(InitializationError::PaymentRequired);
    }
    let Some(existing) = &snapshot.existing else {
        return Ok(InitializationDecision::Create {
            owner: snapshot
                .account_for_email
                .clone()
                .unwrap_or_else(|| request.actor.clone()),
        });
    };
    // Email-address equality cannot adopt another Microsoft mailbox's content.
    if existing.tenant_id.as_deref() != Some(&grant.tenant_id)
        || existing.mailbox_id.as_deref() != Some(&grant.mailbox_id)
    {
        return Err(InitializationError::IdentityConflict);
    }
    if existing.owner == request.actor || existing.actor_has_access {
        return Ok(InitializationDecision::Reconnect);
    }
    if existing.owner.email_str() == grant.email {
        return Ok(InitializationDecision::Delegate);
    }
    if request.force_share {
        return Ok(InitializationDecision::Promote);
    }
    Err(InitializationError::SharingConfirmation {
        link_id: existing.id,
        email: grant.email.clone(),
        owner_email: existing.owner.email_str().to_string(),
    })
}
