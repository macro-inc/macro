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
    #[error("the inbox is still being removed; retry once its removal finishes")]
    InboxBeingRemoved,
    #[error("mailbox initialization is temporarily unavailable")]
    Unavailable,
    /// Another transaction held the inbox's link row past the lock timeout;
    /// connecting again succeeds once it finishes.
    #[error("the inbox is busy; retry")]
    Contended,
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
    /// Deleting an account removes its inboxes later, so a link can outlive
    /// its owner's account.
    pub owner_account_exists: bool,
    /// Its disconnect or purge has started.
    pub being_removed: bool,
}

pub struct InitializationSnapshot {
    pub entitlement: crate::domain::inbox_entitlement::InboxConnectionFacts,
    pub existing: Option<ExistingMailbox>,
    pub account_for_email: Option<MacroUserIdStr<'static>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitializationDecision {
    Create {
        owner: MacroUserIdStr<'static>,
    },
    Reconnect,
    Delegate,
    /// Move the existing link to `owner`, keeping its one synced copy.
    Rehome {
        owner: MacroUserIdStr<'static>,
    },
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
            owner: address_owner(request, snapshot),
        });
    };
    // Email-address equality cannot adopt another Microsoft mailbox's content.
    // A link on its way out keeps the address until its purge deletes it: a
    // second link beside it can collide with it on credentials and address.
    if existing.tenant_id.as_deref() != Some(&grant.tenant_id)
        || existing.mailbox_id.as_deref() != Some(&grant.mailbox_id)
    {
        if existing.being_removed || !existing.owner_account_exists {
            return Err(InitializationError::InboxBeingRemoved);
        }
        return Err(InitializationError::IdentityConflict);
    }
    if existing.being_removed {
        return Err(InitializationError::InboxBeingRemoved);
    }
    if existing.owner == request.actor || existing.actor_has_access {
        return Ok(InitializationDecision::Reconnect);
    }
    // As on Gmail, a connected mailbox is shared only when its address has no
    // account: the address's own account holds its mailbox, as Create and
    // Delegate assume, and a link whose owner's account is gone has no one
    // to share it with. Both take the one link over instead of minting a
    // shared mailbox user, which would collide with the address's account.
    if !existing.owner_account_exists {
        return Ok(InitializationDecision::Rehome {
            owner: address_owner(request, snapshot),
        });
    }
    if existing.owner.email_str() == grant.email {
        return Ok(InitializationDecision::Delegate);
    }
    if let Some(account) = &snapshot.account_for_email {
        return Ok(InitializationDecision::Rehome {
            owner: account.clone(),
        });
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

/// The account a mailbox belongs to: the address's own, else the actor's.
fn address_owner(
    request: &InitializeMailbox,
    snapshot: &InitializationSnapshot,
) -> MacroUserIdStr<'static> {
    snapshot
        .account_for_email
        .clone()
        .unwrap_or_else(|| request.actor.clone())
}
