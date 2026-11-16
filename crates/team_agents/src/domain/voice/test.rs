use std::sync::Mutex;

use entity_access::domain::models::EntityType;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_user_id::cowlike::CowLike;
use rootcause::Report;

use super::*;
use crate::domain::service::AGENT_TEAMMATES_FLAG;

const ADMIN: &str = "macro|admin@example.com";
const TEAM: &str = "0193a1b2-0000-7000-8000-0000000000aa";

/// One voice, and every sample it was asked for.
#[derive(Default)]
struct Provider {
    samples: Mutex<Vec<(String, Uuid, String)>>,
}

impl VoiceProvider for Provider {
    async fn catalog(&self) -> Result<Vec<Voice>, TeamAgentError> {
        Ok(vec![Voice {
            model: VoiceModel::parse("aura-2-thalia-en").unwrap(),
            name: "Thalia".to_owned(),
            accent: "American".to_owned(),
            tags: vec!["feminine".to_owned()],
            languages: vec!["en".to_owned()],
        }])
    }

    async fn sample(
        &self,
        actor: &MacroUserIdStr<'_>,
        team: Uuid,
        model: &VoiceModel,
    ) -> Result<Vec<u8>, TeamAgentError> {
        self.samples.lock().unwrap().push((
            actor.as_ref().to_owned(),
            team,
            model.as_str().to_owned(),
        ));
        Ok(b"RIFF".to_vec())
    }
}

struct Flags(bool);

impl FeatureFlags for Flags {
    async fn load(&self, _: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        Ok(FlagSnapshot::new([(
            AGENT_TEAMMATES_FLAG.to_owned(),
            FlagValue::Boolean(self.0),
        )]))
    }
}

fn receipt() -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(ADMIN).unwrap().into_owned(),
        TEAM,
        EntityType::Team,
    )
}

#[tokio::test]
async fn admins_hear_only_catalog_voices_billed_to_their_team() {
    let voices = Voices::new(Provider::default(), Some(Flags(true)));

    assert_eq!(voices.catalog(receipt()).await.unwrap().len(), 1);
    assert_eq!(
        voices
            .sample(receipt(), &VoiceModel::parse("aura-2-thalia-en").unwrap())
            .await
            .unwrap(),
        b"RIFF"
    );
    assert!(matches!(
        voices
            .sample(receipt(), &VoiceModel::parse("aura-2-zeus-en").unwrap())
            .await,
        Err(TeamAgentError::UnknownVoice)
    ));
    assert_eq!(
        *voices.provider.samples.lock().unwrap(),
        [(
            ADMIN.to_owned(),
            Uuid::parse_str(TEAM).unwrap(),
            "aura-2-thalia-en".to_owned()
        )]
    );
}

#[tokio::test]
async fn voices_stay_closed_without_the_rollout() {
    for flags in [None, Some(Flags(false))] {
        let voices = Voices::new(Provider::default(), flags);

        assert!(matches!(
            voices.catalog(receipt()).await,
            Err(TeamAgentError::NotEnabled)
        ));
        assert!(matches!(
            voices
                .sample(receipt(), &VoiceModel::parse("aura-2-thalia-en").unwrap())
                .await,
            Err(TeamAgentError::NotEnabled)
        ));
        assert!(voices.provider.samples.lock().unwrap().is_empty());
    }
}
