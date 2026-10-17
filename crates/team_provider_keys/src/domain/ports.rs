use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::models::{
    EncryptedProviderApiKey, ModelProvider, ProviderApiKey, StoredMemberKey, TeamProviderKeyError,
    TeamProviderKeyStatus, UsableProviderKey,
};

/// Result alias for this crate.
pub type Result<T> = std::result::Result<T, TeamProviderKeyError>;

/// Encrypts a key so only its team and provider can decrypt it.
#[async_trait::async_trait]
pub trait ProviderKeyCipher: Send + Sync + 'static {
    /// Encrypt `key` for `team_id`.
    async fn encrypt(&self, team_id: Uuid, key: &ProviderApiKey)
    -> Result<EncryptedProviderApiKey>;

    /// Decrypt a `provider` key that belongs to `team_id`.
    async fn decrypt(
        &self,
        team_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
    ) -> Result<ProviderApiKey>;
}

/// Where team keys are stored. Never decrypts.
#[async_trait::async_trait]
pub trait ProviderKeyRepo: Send + Sync + 'static {
    /// Register or replace the team's key for `provider`.
    async fn upsert(
        &self,
        team_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
        key_prefix: &str,
    ) -> Result<TeamProviderKeyStatus>;

    /// The providers the team has a key for.
    async fn list(&self, team_id: Uuid) -> Result<Vec<TeamProviderKeyStatus>>;

    /// Forget the team's key for `provider`, reporting whether there was one.
    async fn delete(&self, team_id: Uuid, provider: ModelProvider) -> Result<bool>;

    /// The `provider` key of a team `user` is currently a member of.
    async fn for_member(
        &self,
        user: &MacroUserIdStr<'_>,
        provider: ModelProvider,
    ) -> Result<Option<StoredMemberKey>>;

    /// The providers the teams `user` is currently a member of have keys for.
    async fn providers_for_member(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<ModelProvider>>;
}

/// What AI chat asks before running a turn on a team's key.
///
/// Every answer reflects current team membership: a user removed from the
/// team gets `None` on their next turn.
#[async_trait::async_trait]
pub trait TeamModelKeys: Send + Sync + 'static {
    /// The `provider` key `user` may run a turn on, decrypted.
    async fn usable_key(
        &self,
        user: &MacroUserIdStr<'_>,
        provider: ModelProvider,
    ) -> Result<Option<UsableProviderKey>>;

    /// The providers `user` has a team key for, without decrypting anything.
    async fn usable_providers(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<ModelProvider>>;
}

/// A deployment with no team keys: every turn runs on Macro's allowance.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoTeamModelKeys;

#[async_trait::async_trait]
impl TeamModelKeys for NoTeamModelKeys {
    async fn usable_key(
        &self,
        _user: &MacroUserIdStr<'_>,
        _provider: ModelProvider,
    ) -> Result<Option<UsableProviderKey>> {
        Ok(None)
    }

    async fn usable_providers(&self, _user: &MacroUserIdStr<'_>) -> Result<Vec<ModelProvider>> {
        Ok(Vec::new())
    }
}
