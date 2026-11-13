//! Agents' call voices: the provider catalog and spoken samples team admins
//! pick from, and the voice an agent speaks with (committed to its repo).

use std::future::Future;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{TeamAgentError, VoiceModel};
use super::service::ensure_enabled;

/// The voice an agent speaks with on calls.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentVoice {
    /// The Aura-2 model, `aura-2-<name>-<language>`.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub model: VoiceModel,
}

/// One voice of the provider's catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    /// The model to save as the agent's voice.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub model: VoiceModel,
    /// The provider's name for the voice.
    pub name: String,
    /// The provider's accent label.
    pub accent: String,
    /// The provider's gender and character tags.
    pub tags: Vec<String>,
    /// Languages the voice speaks.
    pub languages: Vec<String>,
}

/// The speech provider: its voice catalog and a fixed spoken sample.
pub trait VoiceProvider: Send + Sync + 'static {
    /// Every Aura-2 voice the provider offers.
    fn catalog(&self) -> impl Future<Output = Result<Vec<Voice>, TeamAgentError>> + Send;

    /// WAV audio of `model` saying a fixed line; usage is billed to `actor`
    /// on `team`.
    fn sample(
        &self,
        actor: &MacroUserIdStr<'_>,
        team: Uuid,
        model: &VoiceModel,
    ) -> impl Future<Output = Result<Vec<u8>, TeamAgentError>> + Send;
}

/// Voice discovery for team admins, behind the agent teammates rollout.
pub struct Voices<Provider, Flags> {
    provider: Provider,
    flags: Option<Flags>,
}

impl<Provider, Flags> Voices<Provider, Flags> {
    /// Without `flags`, discovery stays off.
    pub fn new(provider: Provider, flags: Option<Flags>) -> Self {
        Self { provider, flags }
    }
}

impl<Provider: VoiceProvider, Flags: FeatureFlags + 'static> Voices<Provider, Flags> {
    /// The voices an admin can choose from.
    #[tracing::instrument(name = "team_agents.voices.catalog", skip_all, fields(team_id = %receipt.entity().entity_id), err)]
    pub async fn catalog(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Vec<Voice>, TeamAgentError> {
        let actor = receipt.acting_user_id().ok_or(TeamAgentError::NotEnabled)?;
        ensure_enabled(self.flags.as_ref(), actor).await?;
        self.provider.catalog().await
    }

    /// A catalog voice saying the fixed sample line.
    #[tracing::instrument(name = "team_agents.voices.sample", skip_all, fields(team_id = %receipt.entity().entity_id, voice = %model), err)]
    pub async fn sample(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        model: &VoiceModel,
    ) -> Result<Vec<u8>, TeamAgentError> {
        let actor = receipt.acting_user_id().ok_or(TeamAgentError::NotEnabled)?;
        ensure_enabled(self.flags.as_ref(), actor).await?;
        let team =
            Uuid::parse_str(&receipt.entity().entity_id).map_err(TeamAgentError::internal)?;

        let known = self
            .provider
            .catalog()
            .await?
            .iter()
            .any(|voice| &voice.model == model);
        if !known {
            return Err(TeamAgentError::UnknownVoice);
        }

        self.provider.sample(actor, team, model).await
    }
}

#[cfg(test)]
mod test;
