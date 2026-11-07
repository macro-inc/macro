//! Direct owner grants derived from the recorded owner, not the creating actor.

#[cfg(test)]
mod test;

use model_owner::Owner;
use shared_entity_registry::{EntityRegistryError, EntityRegistryResult};

use super::ports::BotFacts;

/// Expands ownership into direct owner-level grant sources.
///
/// This is not creation authorization. In particular, assigning a system bot as
/// owner is supported; an autonomous system bot creating an entity must be
/// rejected upstream before calling registration. An acting user's identity
/// must never be substituted for the recorded owner or the bot's sponsor.
#[derive(Clone)]
pub struct OwnerGrantPolicy<B> {
    bots: B,
}

impl<B: BotFacts> OwnerGrantPolicy<B> {
    /// Construct a policy over bot facts supplied by the composition root.
    pub fn new(bots: B) -> Self {
        Self { bots }
    }

    /// Return typed `(source_type, source_id)` pairs as [`Owner`] principals.
    ///
    /// Users and teams receive one grant; owned bots receive a bot grant and a
    /// sponsor grant. Known system bots receive only their own grant and require
    /// no persisted bot row. Missing or invalid sponsors fail closed.
    pub async fn grants_for(&self, owner: &Owner) -> EntityRegistryResult<Vec<Owner>> {
        let mut grants = vec![owner.clone()];
        if let Owner::Bot(bot) = owner
            && !bot_id::is_system_bot(*bot)
        {
            let sponsor = self.bots.sponsor(*bot).await?;
            match sponsor {
                Some(sponsor @ (Owner::User(_) | Owner::Team(_))) => grants.push(sponsor),
                Some(Owner::Bot(_)) | None => {
                    return Err(EntityRegistryError::InvalidBotSponsor.into());
                }
            }
        }
        Ok(grants)
    }
}
