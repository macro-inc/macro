//! Inbox removal is distinct from leaving a shared inbox. Credentials remain
//! with their consenting principal; a participant's departure cannot silently
//! delete the other participants' mailbox.

use super::*;
use crate::domain::models::UserProvider;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::pubsub::DeletionReason;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum InboxLifecycleError {
    #[error("inbox not found")]
    NotFound,
    #[error("not authorized for this inbox")]
    Forbidden,
    #[error("inbox is disconnecting; wait for removal to finish")]
    Disconnecting,
    #[error("inbox changed; retry the operation")]
    Changed,
    #[error("inbox lifecycle is temporarily unavailable")]
    Unavailable,
}
#[derive(Clone)]
pub struct InboxActor {
    pub macro_id: MacroUserIdStr<'static>,
    pub credential_owner: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MailboxCustodian {
    pub actor_id: String,
    pub credential_owner: String,
    pub grant_id: Uuid,
    pub grant_generation: i64,
    pub scopes: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxLifecycleSnapshot {
    pub link_id: Uuid,
    pub owner: String,
    pub provider: UserProvider,
    pub promoted: bool,
    pub delegates: Vec<String>,
    pub sync_generation: i64,
    pub grant_id: Option<Uuid>,
    pub grant_generation: i64,
    pub credential_owner: String,
    pub disconnecting: bool,
    pub custodians: Vec<MailboxCustodian>,
}
impl InboxLifecycleSnapshot {
    fn accessible(&self, actor: &str) -> bool {
        self.owner == actor || self.delegates.iter().any(|delegate| delegate == actor)
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InboxRemoval {
    Disconnect,
    Detach {
        replace_custodian: bool,
        replacement: Option<MailboxCustodian>,
    },
}
#[derive(Debug, Clone)]
pub struct InboxResync {
    pub run_id: Uuid,
    pub already_in_progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InboxLifecycleEffect {
    GmailHistory {
        work: super::gmail_history::HistoryWork,
    },
    /// Remove only subscriptions reserved for this binding. Missing/revoked
    /// credentials are terminal cleanup outcomes; transient failures retry.
    CleanupMicrosoftWatches {
        grant_generation: i64,
        sync_generation: i64,
        attempt_ids: Vec<Uuid>,
        provider_ids: Vec<String>,
    },
    RevokeMicrosoftGrant {
        grant_id: Uuid,
        generation: i64,
        owner: String,
    },
    DeleteMailbox {
        reason: DeletionReason,
    },
    GmailBackfill {
        job_id: Uuid,
    },
    AccessRemoved {
        viewer: String,
    },
}
pub struct InboxLifecycleLease {
    pub id: Uuid,
    pub lease_id: Uuid,
    pub link_id: Uuid,
    pub effect: InboxLifecycleEffect,
}

pub trait InboxLifecycleRepository: Send + Sync + 'static {
    fn snapshot(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<InboxLifecycleSnapshot, InboxLifecycleError>> + Send;
    /// Compare the complete snapshot under a mailbox lock, detach the caller,
    /// fence obsolete work, and commit downstream work in the same transaction.
    fn remove(
        &self,
        actor: &InboxActor,
        expected: &InboxLifecycleSnapshot,
        decision: &InboxRemoval,
        reason: DeletionReason,
    ) -> impl Future<Output = Result<(), InboxLifecycleError>> + Send;
    fn resync(
        &self,
        actor: &InboxActor,
        expected: &InboxLifecycleSnapshot,
    ) -> impl Future<Output = Result<InboxResync, InboxLifecycleError>> + Send;
    /// Includes consenting participants whose delegation edge was removed by
    /// account deletion. This input comes only from the internal deletion queue.
    fn bindings_for_deleted_user(
        &self,
        owner: &str,
    ) -> impl Future<Output = Result<Vec<(InboxActor, Uuid)>, InboxLifecycleError>> + Send;
    fn ready_for_delete(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<bool, InboxLifecycleError>> + Send;
    fn claim_effect(
        &self,
        lease: Uuid,
    ) -> impl Future<Output = Result<Option<InboxLifecycleLease>, MailboxError>> + Send;
    fn finish_effect(
        &self,
        lease: &InboxLifecycleLease,
        success: bool,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
pub trait InboxLifecycleEffects: Send + Sync + 'static {
    fn apply(
        &self,
        link: Uuid,
        effect: &InboxLifecycleEffect,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
pub struct InboxLifecycleService<R, E> {
    repo: R,
    effects: E,
}
impl<R, E> InboxLifecycleService<R, E> {
    pub fn new(repo: R, effects: E) -> Self {
        Self { repo, effects }
    }
}
impl<R: InboxLifecycleRepository, E: InboxLifecycleEffects> InboxLifecycleService<R, E> {
    pub async fn remove(&self, actor: &InboxActor, link: Uuid) -> Result<(), InboxLifecycleError> {
        let snapshot = self.repo.snapshot(link).await?;
        if !snapshot.accessible(actor.macro_id.as_ref()) {
            return Err(InboxLifecycleError::Forbidden);
        }
        let decision = removal(&snapshot, actor);
        self.repo
            .remove(
                actor,
                &snapshot,
                &decision,
                DeletionReason::ManuallyDisabled,
            )
            .await
    }
    pub async fn resync(
        &self,
        actor: &InboxActor,
        link: Uuid,
    ) -> Result<InboxResync, InboxLifecycleError> {
        let snapshot = self.repo.snapshot(link).await?;
        if !snapshot.accessible(actor.macro_id.as_ref()) {
            return Err(InboxLifecycleError::Forbidden);
        }
        if snapshot.disconnecting {
            return Err(InboxLifecycleError::Disconnecting);
        }
        self.repo.resync(actor, &snapshot).await
    }
    pub async fn deleted_user(&self, owner: &str) -> Result<(), InboxLifecycleError> {
        for (actor, link) in self.repo.bindings_for_deleted_user(owner).await? {
            let snapshot = match self.repo.snapshot(link).await {
                Ok(snapshot) => snapshot,
                Err(InboxLifecycleError::NotFound) => continue,
                Err(error) => return Err(error),
            };
            let decision = removal(&snapshot, &actor);
            self.repo
                .remove(&actor, &snapshot, &decision, DeletionReason::UserDeleted)
                .await?;
        }
        Ok(())
    }
    /// Internal deletion queue entrypoint. The first delivery freezes the link
    /// and records cleanup durably; a later delivery performs physical teardown.
    pub async fn prepare_delete(
        &self,
        link: Uuid,
        reason: DeletionReason,
    ) -> Result<bool, InboxLifecycleError> {
        let snapshot = self.repo.snapshot(link).await?;
        if snapshot.disconnecting {
            return self.repo.ready_for_delete(link).await;
        }
        let actor = InboxActor {
            macro_id: MacroUserIdStr::try_from(snapshot.owner.clone())
                .map_err(|_| InboxLifecycleError::Unavailable)?,
            credential_owner: snapshot.credential_owner.clone(),
        };
        self.repo
            .remove(&actor, &snapshot, &InboxRemoval::Disconnect, reason)
            .await?;
        Ok(false)
    }
    pub async fn publish_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_effect(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let result = self.effects.apply(lease.link_id, &lease.effect).await;
        self.repo.finish_effect(&lease, result.is_ok()).await?;
        result.map(|()| true)
    }
}

fn removal(snapshot: &InboxLifecycleSnapshot, actor: &InboxActor) -> InboxRemoval {
    if snapshot.owner == actor.macro_id.as_ref()
        || (snapshot.promoted
            && !snapshot
                .delegates
                .iter()
                .any(|delegate| delegate != actor.macro_id.as_ref()))
    {
        return InboxRemoval::Disconnect;
    }
    let replace_custodian = snapshot.provider == UserProvider::Outlook
        && snapshot.credential_owner == actor.credential_owner;
    let replacement = replace_custodian
        .then(|| {
            snapshot
                .custodians
                .iter()
                .find(|candidate| {
                    candidate.actor_id != actor.macro_id.as_ref()
                        && snapshot.accessible(&candidate.actor_id)
                })
                .cloned()
        })
        .flatten();
    InboxRemoval::Detach {
        replace_custodian,
        replacement,
    }
}

#[cfg(test)]
mod test;
