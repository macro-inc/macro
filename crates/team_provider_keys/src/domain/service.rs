#[cfg(test)]
mod test;

use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, EntityType, MemberTeamRole, RequiredPermission,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::models::{
    ModelProvider, ProviderApiKey, TeamProviderKeyError, TeamProviderKeyStatus, UsableProviderKey,
};
use super::ports::{ProviderKeyCipher, ProviderKeyRepo, Result, TeamModelKeys};

/// Registering, listing and using a team's provider keys.
///
/// Members can see which providers have a key and run turns on them; only
/// admins and the owner can register or remove one. Both rules come from the
/// receipt's type, minted by the team access extractor.
pub struct TeamProviderKeyService<Repo, Cipher> {
    repo: Repo,
    cipher: Cipher,
}

impl<Repo, Cipher> TeamProviderKeyService<Repo, Cipher> {
    /// Store keys in `repo`, encrypted with `cipher`.
    pub fn new(repo: Repo, cipher: Cipher) -> Self {
        Self { repo, cipher }
    }
}

impl<Repo: ProviderKeyRepo, Cipher: ProviderKeyCipher> TeamProviderKeyService<Repo, Cipher> {
    /// Which providers the caller's team has a key for.
    pub async fn list(
        &self,
        team: &EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<Vec<TeamProviderKeyStatus>> {
        self.repo.list(team_id(team)?).await
    }

    /// Register or replace the team's key for `provider`, returning every
    /// provider the team now has a key for.
    ///
    /// The key is parsed before anything else, so a malformed value never
    /// reaches KMS or the table.
    pub async fn register(
        &self,
        team: &EntityAccessReceipt<AdminTeamRole>,
        provider: ModelProvider,
        supplied: &str,
    ) -> Result<Vec<TeamProviderKeyStatus>> {
        let team_id = team_id(team)?;
        let key = ProviderApiKey::parse(provider, supplied)
            .map_err(|_| TeamProviderKeyError::MalformedKey)?;
        let encrypted = self.cipher.encrypt(team_id, &key).await?;
        self.repo
            .upsert(team_id, provider, &encrypted, key.prefix())
            .await?;
        self.repo.list(team_id).await
    }

    /// Forget the team's key for `provider`, returning the providers that
    /// still have one. Does not revoke the key at the provider.
    pub async fn remove(
        &self,
        team: &EntityAccessReceipt<AdminTeamRole>,
        provider: ModelProvider,
    ) -> Result<Vec<TeamProviderKeyStatus>> {
        let team_id = team_id(team)?;
        self.repo.delete(team_id, provider).await?;
        self.repo.list(team_id).await
    }
}

#[async_trait::async_trait]
impl<Repo: ProviderKeyRepo, Cipher: ProviderKeyCipher> TeamModelKeys
    for TeamProviderKeyService<Repo, Cipher>
{
    async fn usable_key(
        &self,
        user: &MacroUserIdStr<'_>,
        provider: ModelProvider,
    ) -> Result<Option<UsableProviderKey>> {
        let Some(stored) = self.repo.for_member(user, provider).await? else {
            return Ok(None);
        };
        let key = self
            .cipher
            .decrypt(stored.team_id, provider, &stored.encrypted)
            .await?;
        Ok(Some(UsableProviderKey {
            id: stored.id,
            team_id: stored.team_id,
            key,
        }))
    }

    async fn usable_providers(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<ModelProvider>> {
        self.repo.providers_for_member(user).await
    }
}

fn team_id<T: RequiredPermission>(receipt: &EntityAccessReceipt<T>) -> Result<Uuid> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::Team {
        return Err(TeamProviderKeyError::Forbidden);
    }
    entity
        .entity_id
        .parse()
        .map_err(|_| TeamProviderKeyError::Forbidden)
}
