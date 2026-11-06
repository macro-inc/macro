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
pub struct Voices<P, Flags> {
    provider: P,
    rollout: super::rollout::TeamAgentRollout<Flags>,
}

impl<P, Flags> Voices<P, Flags> {
    /// Use the shared management rollout without restricting runtime speech.
    pub fn new(provider: P, flags: Option<Flags>) -> Self {
        Self {
            provider,
            rollout: super::rollout::TeamAgentRollout::new(flags),
        }
    }
}

impl<P: VoiceProvider, Flags: feature_flags::FeatureFlags> Voices<P, Flags> {
    /// Read voices for an authorized user.
    pub async fn catalog(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<Vec<Voice>, super::models::TeamAgentError> {
        let actor = receipt
            .get_authenticated_user()
            .map_err(|_| super::models::TeamAgentError::Forbidden)?;
        if !self.rollout.enabled(actor).await {
            return Err(super::models::TeamAgentError::NotEnabled);
        }
        self.provider.catalog().await
    }

    /// Validate a known model and synthesize only the fixed sample.
    pub async fn sample(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        model: &str,
    ) -> Result<Vec<u8>, super::models::TeamAgentError> {
        let actor = receipt
            .get_authenticated_user()
            .map_err(|_| super::models::TeamAgentError::Forbidden)?;
        if !self.rollout.enabled(actor).await {
            return Err(super::models::TeamAgentError::NotEnabled);
        }
        AgentVoice {
            model: model.to_owned(),
        }
        .validate()?;
        if !self
            .provider
            .catalog()
            .await?
            .iter()
            .any(|voice| voice.model == model)
        {
            return Err(super::models::TeamAgentError::BadRequest(
                "unknown voice".to_owned(),
            ));
        }
        let team = receipt
            .entity()
            .entity_id
            .parse()
            .map_err(|_| super::models::TeamAgentError::Forbidden)?;
        self.provider.sample(actor, team, model).await
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

#[cfg(test)]
mod test {
    use super::*;
    use crate::domain::{models::TeamAgentError, rollout::TEAM_AGENTS_FLAG};
    use entity_access::domain::models::EntityType;
    use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Provider(AtomicUsize);
    impl VoiceProvider for Provider {
        async fn catalog(&self) -> Result<Vec<Voice>, TeamAgentError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(vec![Voice {
                model: "aura-2-arcas-en".to_owned(),
                name: "Arcas".to_owned(),
                accent: "American".to_owned(),
                tags: vec![],
                languages: vec!["en".to_owned()],
            }])
        }
        async fn sample(
            &self,
            _: &MacroUserIdStr<'_>,
            _: Uuid,
            _: &str,
        ) -> Result<Vec<u8>, TeamAgentError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(vec![1, 0])
        }
    }

    #[tokio::test]
    async fn voice_discovery_and_samples_require_a_completed_enabled_rollout() {
        let actor = MacroUserIdStr::try_from("macro|creator@example.com".to_owned()).unwrap();
        for enabled in [None, Some(false), Some(true)] {
            let flags = enabled.map(|value| {
                let mut flags = FakeFeatureFlags::default();
                flags.set(
                    actor.clone(),
                    Ok(FlagSnapshot::new([(
                        TEAM_AGENTS_FLAG.to_owned(),
                        FlagValue::Boolean(value),
                    )])),
                );
                flags
            });
            let voices = Voices::new(Provider(AtomicUsize::new(0)), flags);
            let receipt = || {
                EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
                    actor.clone(),
                    "00000000-0000-0000-0000-000000000001",
                    EntityType::Team,
                )
            };
            let catalog = voices.catalog(receipt()).await;
            let sample = voices.sample(receipt(), "aura-2-arcas-en").await;
            if enabled == Some(true) {
                assert_eq!(catalog.unwrap().len(), 1);
                assert_eq!(sample.unwrap(), [1, 0]);
                assert_eq!(voices.provider.0.load(Ordering::SeqCst), 3);
            } else {
                assert!(matches!(catalog, Err(TeamAgentError::NotEnabled)));
                assert!(matches!(sample, Err(TeamAgentError::NotEnabled)));
                assert_eq!(voices.provider.0.load(Ordering::SeqCst), 0);
            }
        }
    }
}
