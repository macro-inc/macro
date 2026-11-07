//! Historical sponsor lookup for entity registration, owned by the bots adapter.

#[cfg(test)]
mod test;

use bot_id::BotId;
use entity_registry::{BotFacts, EntityRegistryError, EntityRegistryResult};
use model_owner::{Owner, OwnerType};
use rootcause::prelude::*;

use super::PgBotsRepo;

impl BotFacts for PgBotsRepo {
    async fn sponsor(&self, bot: BotId) -> EntityRegistryResult<Option<Owner>> {
        // Intentionally no deleted_at filter: deletion does not erase ownership.
        // created_by is attribution, not the sponsor, and must never grant access.
        let row = sqlx::query!(
            r#"
            SELECT owner_user_id, team_id
            FROM bots
            WHERE id = $1
            "#,
            bot.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context(EntityRegistryError::Infrastructure)?;
        let Some(row) = row else {
            return Ok(None);
        };
        match (row.owner_user_id, row.team_id) {
            (Some(user), None) => Owner::parse(OwnerType::User, &user)
                .map(Some)
                .context(EntityRegistryError::InvalidBotSponsor),
            (None, Some(team)) => Ok(Some(Owner::Team(team))),
            _ => Err(EntityRegistryError::InvalidBotSponsor.into()),
        }
    }
}
