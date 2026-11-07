use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::models::{
    AgentKeyError, AgentKeyStatus, AgentOwner, EncryptedProviderApiKey, ModelProvider,
    ProviderApiKey, StoredAgentKey, UsableAgentKey,
};

/// Result alias for this crate.
pub type Result<T> = std::result::Result<T, AgentKeyError>;

/// Encrypts a key so only its agent and provider can decrypt it.
#[async_trait::async_trait]
pub trait AgentKeyCipher: Send + Sync + 'static {
    /// Encrypt `key` for the agent `bot_id`.
    async fn encrypt(&self, bot_id: Uuid, key: &ProviderApiKey) -> Result<EncryptedProviderApiKey>;

    /// Decrypt the `provider` key of the agent `bot_id`.
    async fn decrypt(
        &self,
        bot_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
    ) -> Result<ProviderApiKey>;
}

/// Where agents' keys are stored. Never decrypts.
#[async_trait::async_trait]
pub trait AgentKeyRepo: Send + Sync + 'static {
    /// Register or replace the agent's key.
    async fn upsert(
        &self,
        bot_id: Uuid,
        provider: ModelProvider,
        encrypted: &EncryptedProviderApiKey,
        key_prefix: &str,
    ) -> Result<AgentKeyStatus>;

    /// The agent's key, if it has one.
    async fn status(&self, bot_id: Uuid) -> Result<Option<AgentKeyStatus>>;

    /// Forget the agent's key, reporting whether there was one.
    async fn delete(&self, bot_id: Uuid) -> Result<bool>;

    /// The agent's key with the agent as it is configured now, for a live,
    /// undeleted agent.
    async fn stored(&self, bot_id: Uuid) -> Result<Option<StoredAgentKey>>;

    /// Whether `user` is currently a member of `team_id`.
    async fn is_team_member(&self, user: &MacroUserIdStr<'_>, team_id: Uuid) -> Result<bool>;
}

/// Whether an agent owner's plan includes agents' own API keys.
#[async_trait::async_trait]
pub trait KeyPlans: Send + Sync + 'static {
    /// Whether agents `owner` owns may save keys and run turns on them.
    async fn allows_keys(&self, owner: &AgentOwner) -> Result<bool>;
}

/// What the in-memory runtime asks before a turn of an agent in a session
/// owned by `user`.
///
/// A key counts only while the agent is an in-memory agent whose model's
/// provider matches the key, its owner's plan includes keys, and the session
/// is its owner's: the person's own for a personal agent, a current member's
/// for a team agent. Otherwise the agent runs on Macro usage as if it had
/// none, so nobody else spends a person's or a team's key.
#[async_trait::async_trait]
pub trait AgentKeys: Send + Sync + 'static {
    /// The provider of the key the agent's turns run on, without decrypting.
    async fn usable_provider(
        &self,
        bot_id: Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<ModelProvider>>;

    /// The key the agent's next turn runs on, decrypted for that turn.
    async fn usable_key(
        &self,
        bot_id: Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<UsableAgentKey>>;
}

/// A deployment where no agent has a key: every turn runs on Macro usage.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoAgentKeys;

#[async_trait::async_trait]
impl AgentKeys for NoAgentKeys {
    async fn usable_provider(
        &self,
        _bot_id: Uuid,
        _user: &MacroUserIdStr<'_>,
    ) -> Result<Option<ModelProvider>> {
        Ok(None)
    }

    async fn usable_key(
        &self,
        _bot_id: Uuid,
        _user: &MacroUserIdStr<'_>,
    ) -> Result<Option<UsableAgentKey>> {
        Ok(None)
    }
}
