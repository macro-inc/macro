//! Ports for the agent secrets domain.

use std::future::Future;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    AgentSecret, AgentSecretError, AgentSecretSummaries, AgentSecretSummary, EncryptedSecret,
    SecretName, SecretValue, StoredSecret,
};

/// Storage for encrypted secrets.
pub trait AgentSecretRepository: Send + Sync + 'static {
    /// Stores the secret, replacing one with the same name.
    fn upsert(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        encrypted: &EncryptedSecret,
    ) -> impl Future<Output = Result<AgentSecretSummary, AgentSecretError>> + Send;

    /// The secret, if stored.
    fn get(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
    ) -> impl Future<Output = Result<Option<StoredSecret>, AgentSecretError>> + Send;

    /// The agent's secrets by name, without ciphertexts.
    fn list(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<AgentSecretSummary>, AgentSecretError>> + Send;

    /// Deletes the secret. Returns whether one was stored.
    fn delete(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
    ) -> impl Future<Output = Result<bool, AgentSecretError>> + Send;
}

/// Encrypts a secret so that only the same agent and name decrypt it.
pub trait SecretCipher: Send + Sync + 'static {
    /// Encrypts `value` bound to `agent_user_id` and `name`.
    fn encrypt(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        value: &SecretValue,
    ) -> impl Future<Output = Result<EncryptedSecret, AgentSecretError>> + Send;

    /// Decrypts a secret stored for `agent_user_id` and `name`.
    fn decrypt(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        encrypted: &EncryptedSecret,
    ) -> impl Future<Output = Result<SecretValue, AgentSecretError>> + Send;
}

/// Which accounts are team agents, and on which team.
pub trait TeamAgentDirectory: Send + Sync + 'static {
    /// The agent's team, or `None` when the account is not a team agent.
    fn team_of(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Uuid>, AgentSecretError>> + Send;
}

/// Inbound port: what drivers (HTTP) can ask of agent secrets.
pub trait AgentSecretService: Send + Sync + 'static {
    /// Stores a secret for the calling agent.
    fn put(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
        value: String,
    ) -> impl Future<Output = Result<AgentSecretSummary, AgentSecretError>> + Send;

    /// One of the calling agent's secrets, decrypted.
    fn get(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
    ) -> impl Future<Output = Result<AgentSecret, AgentSecretError>> + Send;

    /// Deletes one of the calling agent's secrets. Deleting a missing one
    /// succeeds.
    fn delete(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
    ) -> impl Future<Output = Result<(), AgentSecretError>> + Send;

    /// A team admin lists an agent's secrets by name.
    fn list_for_admin(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AgentSecretSummaries, AgentSecretError>> + Send;

    /// A team admin deletes one of an agent's secrets. Deleting a missing
    /// one succeeds.
    fn delete_for_admin(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &str,
    ) -> impl Future<Output = Result<(), AgentSecretError>> + Send;
}
