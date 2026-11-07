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
            EntityAccessReceipt::<AdminTeamRole>::dangerously_assert_authenticated_user(
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
