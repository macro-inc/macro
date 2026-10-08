//! Clearing everything a team owns before the team row is deleted.
//!
//! A team owns entities directly ([`Owner::Team`]) and through its bots
//! ([`Owner::Bot`]). `bots.team_id` cascades with the team row, so once the
//! team is deleted nothing can find bot-owned content again. [`clear_team`]
//! runs first, and the [`ClearedTeam`] it returns is the only way to delete
//! the team row.
//!
//! The entity registry is the work queue. An owning service removes an
//! entity's registry row only after it has enqueued that entity's physical
//! cleanup, so a failure at any point leaves exactly the unfinished entities
//! listed for the next attempt.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::fmt::{self, Display, Formatter};

use bot_id::BotId;
use model_owner::Owner;
use shared_entity_registry::RegisteredEntityType;
use uuid::Uuid;

/// Discovery passes [`clear_team`] runs before it gives up on a team whose
/// content keeps reappearing. Every pass but the last purges what it found.
pub(crate) const MAX_DISCOVERY_PASSES: u8 = 4;

/// An owner whose entities are deleted with the team. A user cannot be one,
/// because deleting a team never purges a person's content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TeamDeletionOwner {
    /// The team itself.
    Team(Uuid),
    /// One of the team's bots, soft-deleted or not.
    Bot(BotId),
}

impl TeamDeletionOwner {
    /// The registry owner this is.
    pub fn as_owner(&self) -> Owner {
        match *self {
            Self::Team(team_id) => Owner::Team(team_id),
            Self::Bot(bot_id) => Owner::Bot(bot_id),
        }
    }
}

impl Display for TeamDeletionOwner {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        Display::fmt(&self.as_owner(), formatter)
    }
}

/// One entity a team owns, directly or through one of its bots.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnedEntityRef {
    /// The entity's id.
    pub id: Uuid,
    /// The entity's kind, which decides the owning service that purges it.
    pub entity_type: RegisteredEntityType,
    /// The entity's recorded owner.
    pub owner: TeamDeletionOwner,
}

/// What team deletion needs from outside the teams crate: the team's bots,
/// what each owner holds, and a purge through each entity's owning service.
pub trait OwnedEntityCleanup: Clone + Send + Sync + 'static {
    /// Error returned when a listing or a purge fails.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Every bot whose team is `team_id`, soft-deleted bots included.
    fn team_bots(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<BotId>, Self::Err>> + Send;

    /// Every entity recorded as owned by `owner`, trashed entities included.
    fn owned_by(
        &self,
        owner: &TeamDeletionOwner,
    ) -> impl Future<Output = Result<Vec<OwnedEntityRef>, Self::Err>> + Send;

    /// Permanently delete `entity` through its owning service, provided
    /// `entity.owner` still owns it.
    ///
    /// `Ok` means the entity is gone, or was already gone, and its physical
    /// cleanup is enqueued. An entity its owning service records under another
    /// owner is an error, and nothing is deleted.
    fn purge(&self, entity: &OwnedEntityRef) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The cleanup of a team service that was never given one.
///
/// Every call fails, so such a service refuses to delete teams instead of
/// deleting the team row and orphaning its content.
#[derive(Clone, Copy, Debug, Default)]
pub struct UnwiredOwnedEntityCleanup;

/// The error [`UnwiredOwnedEntityCleanup`] returns from every call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("team deletion needs an owned-entity cleanup and none is wired")]
pub struct OwnedEntityCleanupUnwired;

impl OwnedEntityCleanup for UnwiredOwnedEntityCleanup {
    type Err = OwnedEntityCleanupUnwired;

    async fn team_bots(&self, _team_id: Uuid) -> Result<Vec<BotId>, Self::Err> {
        Err(OwnedEntityCleanupUnwired)
    }

    async fn owned_by(&self, _owner: &TeamDeletionOwner) -> Result<Vec<OwnedEntityRef>, Self::Err> {
        Err(OwnedEntityCleanupUnwired)
    }

    async fn purge(&self, _entity: &OwnedEntityRef) -> Result<(), Self::Err> {
        Err(OwnedEntityCleanupUnwired)
    }
}

/// Proof that a team, and every bot it has had, owns nothing.
///
/// Only [`clear_team`] constructs one, from a listing that came back empty.
#[derive(Debug)]
pub struct ClearedTeam {
    team_id: Uuid,
    bot_ids: Vec<BotId>,
    purged: Vec<OwnedEntityRef>,
}

impl ClearedTeam {
    /// The team that owns nothing.
    pub fn team_id(&self) -> Uuid {
        self.team_id
    }

    /// Every bot the team has had, soft-deleted ones included, in id order.
    pub fn bot_ids(&self) -> &[BotId] {
        &self.bot_ids
    }

    /// What this attempt purged, in purge order. Entities an earlier, failed
    /// attempt purged are absent, because they were already gone when this
    /// one listed.
    pub fn purged(&self) -> &[OwnedEntityRef] {
        &self.purged
    }

    /// A proof for repository tests that exercise the row delete on its own.
    #[cfg(test)]
    pub(crate) fn assume_cleared(team_id: Uuid, bot_ids: Vec<BotId>) -> Self {
        Self {
            team_id,
            bot_ids,
            purged: Vec::new(),
        }
    }
}

/// Why a team's content could not be cleared.
///
/// Whatever the variant, the team row, its bots, and its subscription are
/// untouched. Entities purged before the failure stay purged, and the next
/// [`clear_team`] resumes with what is left.
#[derive(Debug, thiserror::Error)]
pub enum OwnedEntityCleanupError {
    /// The team's bots could not be listed.
    #[error("unable to list the team's bots")]
    ListBots {
        /// The port's error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },
    /// The entities one owner holds could not be listed.
    #[error("unable to list the entities owned by {owner}")]
    ListEntities {
        /// The team or bot whose entities were being listed.
        owner: TeamDeletionOwner,
        /// The port's error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },
    /// An owning service did not purge an entity.
    #[error("unable to purge {entity_type} {id}")]
    Purge {
        /// The kind of the entity that is still there.
        entity_type: RegisteredEntityType,
        /// The id of the entity that is still there.
        id: Uuid,
        /// The port's error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },
    /// Entities were still owned after the last discovery pass, for example
    /// because members kept creating team content during the deletion.
    #[error("{remaining} entities were still owned after {passes} discovery passes")]
    StillOwned {
        /// How many entities the last pass listed.
        remaining: usize,
        /// How many discovery passes ran.
        passes: u8,
    },
    /// A listing for one owner returned an entity recorded under another.
    #[error("listing the entities owned by {requested} returned {id}, which it does not own")]
    OwnerMismatch {
        /// The owner whose entities were listed.
        requested: TeamDeletionOwner,
        /// The entity recorded under another owner.
        id: Uuid,
    },
}

/// Permanently delete everything `team_id` owns, directly or through any bot
/// it has had, and return the proof that it now owns nothing.
///
/// Each pass lists the team's bots, then what the team and each bot own. An
/// empty listing ends the run. Otherwise the pass purges what it listed, one
/// entity at a time, scheduled actions and agent sessions first and projects
/// last. The first failure ends the run.
#[tracing::instrument(skip(cleanup), err)]
pub async fn clear_team<C: OwnedEntityCleanup>(
    cleanup: &C,
    team_id: Uuid,
) -> Result<ClearedTeam, OwnedEntityCleanupError> {
    let mut purged = Vec::new();
    let mut purged_ids = HashSet::new();
    let mut passes: u8 = 0;
    loop {
        passes += 1;
        let Census { bot_ids, mut owned } = take_census(cleanup, team_id).await?;
        if owned.is_empty() {
            return Ok(ClearedTeam {
                team_id,
                bot_ids,
                purged,
            });
        }
        if passes == MAX_DISCOVERY_PASSES {
            return Err(OwnedEntityCleanupError::StillOwned {
                remaining: owned.len(),
                passes,
            });
        }
        owned.sort_unstable_by_key(|entity| (purge_rank(entity.entity_type), entity.id));
        for entity in owned {
            cleanup
                .purge(&entity)
                .await
                .map_err(|source| OwnedEntityCleanupError::Purge {
                    entity_type: entity.entity_type,
                    id: entity.id,
                    source: Box::new(source),
                })?;
            if purged_ids.insert(entity.id) {
                purged.push(entity);
            }
        }
    }
}

/// Producers go before what they produce, so a running session or a firing
/// scheduled action cannot add content behind the purge. Projects go last.
/// Their tree purge deletes nested items of any owner, so the team's own
/// nested documents and chats take their owner-checked, retry-safe purge first.
fn purge_rank(entity_type: RegisteredEntityType) -> u8 {
    match entity_type {
        RegisteredEntityType::ScheduledAction => 0,
        RegisteredEntityType::AgentSession => 1,
        RegisteredEntityType::Chat => 2,
        RegisteredEntityType::Document => 3,
        RegisteredEntityType::Project => 4,
    }
}

struct Census {
    bot_ids: Vec<BotId>,
    owned: Vec<OwnedEntityRef>,
}

async fn take_census<C: OwnedEntityCleanup>(
    cleanup: &C,
    team_id: Uuid,
) -> Result<Census, OwnedEntityCleanupError> {
    let mut bot_ids =
        cleanup
            .team_bots(team_id)
            .await
            .map_err(|source| OwnedEntityCleanupError::ListBots {
                source: Box::new(source),
            })?;
    bot_ids.sort_unstable_by_key(|bot_id| bot_id.as_uuid());
    bot_ids.dedup();

    let owners = std::iter::once(TeamDeletionOwner::Team(team_id))
        .chain(bot_ids.iter().copied().map(TeamDeletionOwner::Bot));
    let mut owned = Vec::new();
    for owner in owners {
        let listed = cleanup.owned_by(&owner).await.map_err(|source| {
            OwnedEntityCleanupError::ListEntities {
                owner,
                source: Box::new(source),
            }
        })?;
        if let Some(stray) = listed.iter().find(|entity| entity.owner != owner) {
            return Err(OwnedEntityCleanupError::OwnerMismatch {
                requested: owner,
                id: stray.id,
            });
        }
        owned.extend(listed);
    }
    Ok(Census { bot_ids, owned })
}
