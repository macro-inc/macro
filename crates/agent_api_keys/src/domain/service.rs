#[cfg(test)]
mod test;

use macro_uuid::Uuid;

use super::models::{
    AgentKeyError, AgentKeyView, KeyedAgent, ModelProvider, ProviderApiKey, StoredAgentKey,
    UsableAgentKey,
};
use super::ports::{AgentKeyCipher, AgentKeyRepo, AgentKeys, KeyPlans, Result};

/// Saving, showing and using agents' own API keys.
///
/// Only an in-memory agent on an Anthropic or OpenAI model can have one, for
/// its model's provider, and only on a paid plan of the agent's owner. Who
/// may change an agent is decided by its caller, which hands over the
/// agent it authorized.
pub struct AgentKeyService<Repo, Cipher, Plans> {
    repo: Repo,
    cipher: Cipher,
    plans: Plans,
}

impl<Repo, Cipher, Plans> AgentKeyService<Repo, Cipher, Plans> {
    /// Store keys in `repo`, encrypted with `cipher`, for owners `plans`
    /// allows.
    pub fn new(repo: Repo, cipher: Cipher, plans: Plans) -> Self {
        Self {
            repo,
            cipher,
            plans,
        }
    }
}

impl<Repo: AgentKeyRepo, Cipher: AgentKeyCipher, Plans: KeyPlans>
    AgentKeyService<Repo, Cipher, Plans>
{
    /// The agent's key, and whether its owner's plan lets it run on one.
    pub async fn view(&self, agent: &KeyedAgent) -> Result<AgentKeyView> {
        Ok(AgentKeyView {
            key: self.repo.status(agent.bot_id).await?,
            plan_allows: self.plans.allows_keys(&agent.owner).await?,
        })
    }

    /// Register or replace the agent's key, for its model's provider.
    ///
    /// The key is parsed before anything else, so a malformed value never
    /// reaches KMS or the table.
    pub async fn set(&self, agent: &KeyedAgent, supplied: &str) -> Result<AgentKeyView> {
        let provider = agent
            .key_provider()
            .ok_or(AgentKeyError::UnsupportedAgent)?;
        let key =
            ProviderApiKey::parse(provider, supplied).map_err(|_| AgentKeyError::MalformedKey)?;
        if !self.plans.allows_keys(&agent.owner).await? {
            return Err(AgentKeyError::PlanRequired);
        }
        let encrypted = self.cipher.encrypt(agent.bot_id, &key).await?;
        self.repo
            .upsert(agent.bot_id, provider, &encrypted, key.prefix())
            .await?;
        self.view(agent).await
    }

    /// Forget the agent's key. Does not revoke it at the provider.
    pub async fn remove(&self, agent: &KeyedAgent) -> Result<AgentKeyView> {
        self.repo.delete(agent.bot_id).await?;
        self.view(agent).await
    }

    /// The stored key, when the agent can run on it now.
    async fn usable(&self, bot_id: Uuid) -> Result<Option<StoredAgentKey>> {
        let Some(stored) = self.repo.stored(bot_id).await? else {
            return Ok(None);
        };
        if stored.agent.key_provider() != Some(stored.provider)
            || !self.plans.allows_keys(&stored.agent.owner).await?
        {
            return Ok(None);
        }
        Ok(Some(stored))
    }
}

#[async_trait::async_trait]
impl<Repo: AgentKeyRepo, Cipher: AgentKeyCipher, Plans: KeyPlans> AgentKeys
    for AgentKeyService<Repo, Cipher, Plans>
{
    async fn usable_provider(&self, bot_id: Uuid) -> Result<Option<ModelProvider>> {
        Ok(self.usable(bot_id).await?.map(|stored| stored.provider))
    }

    async fn usable_key(&self, bot_id: Uuid) -> Result<Option<UsableAgentKey>> {
        let Some(stored) = self.usable(bot_id).await? else {
            return Ok(None);
        };
        let key = self
            .cipher
            .decrypt(bot_id, stored.provider, &stored.encrypted)
            .await?;
        Ok(Some(UsableAgentKey { bot_id, key }))
    }
}
