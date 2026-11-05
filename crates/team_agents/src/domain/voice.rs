//! Voice selection owned by the user and persisted in the repo.

use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One Aura-2 voice returned by the provider catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Voice {
    /// Exact model selector.
    pub model: String,
    /// Provider's voice name.
    pub name: String,
    /// Provider's accent label.
    pub accent: String,
    /// Provider's gender and character tags.
    pub tags: Vec<String>,
    /// Languages this voice supports.
    pub languages: Vec<String>,
}

/// Provider discovery and fixed-line synthesis, implemented by the gateway.
pub trait VoiceProvider: Send + Sync + 'static {
    /// Cached provider catalog, without provider credentials.
    fn catalog(
        &self,
    ) -> impl Future<Output = Result<Vec<Voice>, super::models::TeamAgentError>> + Send;
    /// Synthesize the fixed sample and attribute any uncached synthesis to this team.
    fn sample(
        &self,
        actor: &MacroUserIdStr<'_>,
        team: Uuid,
        model: &str,
    ) -> impl Future<Output = Result<Vec<u8>, super::models::TeamAgentError>> + Send;
}

/// Team voice discovery. Access arrives as a capability.
pub struct Voices<P>(pub P);

impl<P: VoiceProvider> Voices<P> {
    /// Read voices for an authorized user.
    pub async fn catalog(
        &self,
        _receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<Vec<Voice>, super::models::TeamAgentError> {
        self.0.catalog().await
    }

    /// Validate a known model and synthesize only the fixed sample.
    pub async fn sample(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        model: &str,
    ) -> Result<Vec<u8>, super::models::TeamAgentError> {
        AgentVoice {
            model: model.to_owned(),
        }
        .validate()?;
        if !self
            .0
            .catalog()
            .await?
            .iter()
            .any(|voice| voice.model == model)
        {
            return Err(super::models::TeamAgentError::BadRequest(
                "unknown voice".to_owned(),
            ));
        }
        let actor = receipt
            .get_authenticated_user()
            .map_err(|_| super::models::TeamAgentError::Forbidden)?;
        let team = receipt
            .entity()
            .entity_id
            .parse()
            .map_err(|_| super::models::TeamAgentError::Forbidden)?;
        self.0.sample(actor, team, model).await
    }
}

/// A provider voice setting, serialized as `config/voice.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct AgentVoice {
    /// Exact Aura-2 voice model.
    pub model: String,
}

impl AgentVoice {
    /// Validate the bounded Aura-2 model identifier before storing or synthesizing.
    pub fn validate(&self) -> Result<(), super::models::TeamAgentError> {
        let Some(name) = self.model.strip_prefix("aura-2-") else {
            return Err(super::models::TeamAgentError::BadRequest(
                "choose an Aura-2 voice".to_owned(),
            ));
        };
        let valid = name.rsplit_once('-').is_some_and(|(name, language)| {
            !name.is_empty()
                && self.model.len() <= 100
                && name.bytes().all(|c| c.is_ascii_lowercase())
                && language.len() == 2
                && language.bytes().all(|c| c.is_ascii_lowercase())
        });
        if !valid {
            return Err(super::models::TeamAgentError::BadRequest(
                "invalid Aura-2 voice".to_owned(),
            ));
        }
        Ok(())
    }
}
