//! Transaction mechanics for domain-selected owner grants.

#[cfg(test)]
mod test;

use entity_registry::{BotFacts, OwnerGrantPolicy};
use model_owner::OwnerType;
use rootcause::prelude::*;
use sqlx::{Acquire, Postgres, Transaction};

use crate::{
    EntityRegistryError, EntityRegistryResult, InsertOutcome, NewEntityRecord, insert_entity,
};

/// Atomic registration of an entity and all grants selected by its owner policy.
///
/// Construct this at the composition root with historical bot facts (for
/// example `bots::outbound::pg_bots_repo::PgBotsRepo`). Callers must authorize
/// creation and resolve the recorded owner before calling this persistence API.
#[derive(Clone)]
pub struct OwnedEntityRegistrar<B> {
    policy: OwnerGrantPolicy<B>,
}

impl<B: BotFacts> OwnedEntityRegistrar<B> {
    /// Use the supplied domain policy for all registrations.
    pub fn new(policy: OwnerGrantPolicy<B>) -> Self {
        Self { policy }
    }

    /// Register a row and upsert its direct owner grants in `tx`.
    ///
    /// Never commits the caller's transaction. A savepoint prevents partial
    /// writes even if the caller handles an error and commits other work.
    /// Matching retries repair missing grants; conflicting owners/types fail
    /// without granting access to the conflicting principal. Timestamps on an
    /// existing row are preserved. This is not an ownership-transfer API.
    pub async fn register_owned_entity(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        record: NewEntityRecord,
    ) -> EntityRegistryResult<InsertOutcome> {
        let grants = self.policy.grants_for(&record.owner).await?;
        let mut savepoint = tx
            .begin()
            .await
            .context(EntityRegistryError::Infrastructure)?;
        let outcome = insert_entity(&mut savepoint, record.clone()).await?;

        // Serialize retries with ownership changes and verify the authoritative
        // row: insert_entity's AlreadyRegistered alone does not imply a match.
        let stored = sqlx::query!(
            r#"
            SELECT entity_type, owner_type AS "owner_type: OwnerType", owner_id
            FROM entity WHERE id = $1
            FOR UPDATE
            "#,
            record.id,
        )
        .fetch_one(savepoint.as_mut())
        .await
        .context(EntityRegistryError::Infrastructure)?;
        if stored.entity_type != record.entity_type.as_str()
            || stored.owner_type != record.owner.owner_type()
            || stored.owner_id != record.owner.principal_id()
        {
            return Err(EntityRegistryError::RegistrationConflict.into());
        }

        for source in grants {
            entity_access_db_utils::upsert_owner_grant(
                &mut savepoint,
                &record.id,
                record.entity_type.into(),
                &source,
            )
            .await
            .context(EntityRegistryError::Infrastructure)?;
        }
        savepoint
            .commit()
            .await
            .context(EntityRegistryError::Infrastructure)?;
        Ok(outcome)
    }
}
