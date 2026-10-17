use std::sync::Mutex;

use ai_billing::domain::DenyReason;
use macro_user_id::user_id::MacroUserIdStr;
use team_provider_keys::domain::{ProviderApiKey, TeamProviderKeyError};

use super::*;
use crate::testing::TestAdmission;

const ANTHROPIC_MODEL: &str = "anthropic/claude-sonnet-5-5";
const SPENT: Result<(), AiAdmissionError> =
    Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted));

fn owner() -> Owner {
    Owner::User(MacroUserIdStr::try_from_email("owner@macro.com").expect("valid email"))
}

/// A team with an Anthropic key, or none; records the providers asked for.
#[derive(Default)]
struct TeamKeys {
    anthropic: bool,
    asked: Mutex<Vec<ModelProvider>>,
}

#[async_trait::async_trait]
impl TeamModelKeys for TeamKeys {
    async fn usable_key(
        &self,
        _user: &MacroUserIdStr<'_>,
        provider: ModelProvider,
    ) -> Result<Option<UsableProviderKey>, TeamProviderKeyError> {
        self.asked.lock().expect("lock").push(provider);
        Ok(
            (self.anthropic && provider == ModelProvider::Anthropic).then(|| UsableProviderKey {
                id: macro_uuid::generate_uuid_v7(),
                team_id: macro_uuid::generate_uuid_v7(),
                key: ProviderApiKey::parse(provider, "sk-ant-api03-abc").expect("valid key"),
            }),
        )
    }

    async fn usable_providers(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> Result<Vec<ModelProvider>, TeamProviderKeyError> {
        Ok(self
            .anthropic
            .then_some(ModelProvider::Anthropic)
            .into_iter()
            .collect())
    }
}

fn with_key() -> TeamKeys {
    TeamKeys {
        anthropic: true,
        ..TeamKeys::default()
    }
}

#[tokio::test]
async fn an_admitted_turn_runs_on_macro_without_touching_team_keys() {
    let keys = with_key();
    let funding = fund_turn(
        &TestAdmission::new(Ok(())),
        &keys,
        &owner(),
        ANTHROPIC_MODEL,
        Funding::Macro,
        true,
    )
    .await;
    assert!(matches!(funding, Ok(TurnFunding::Macro)));
    assert!(keys.asked.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_spent_allowance_moves_a_new_conversation_to_the_team_key() {
    let funding = fund_turn(
        &TestAdmission::new(SPENT),
        &with_key(),
        &owner(),
        ANTHROPIC_MODEL,
        Funding::Macro,
        false,
    )
    .await;
    assert!(matches!(funding, Ok(TurnFunding::TeamKey(_))));
}

#[tokio::test]
async fn a_spent_allowance_mid_conversation_asks_before_using_the_team_key() {
    let funding = fund_turn(
        &TestAdmission::new(SPENT),
        &with_key(),
        &owner(),
        ANTHROPIC_MODEL,
        Funding::Macro,
        true,
    )
    .await;
    assert!(matches!(funding, Err(FundingRefusal::ContinueOnTeamKey)));
}

#[tokio::test]
async fn without_a_key_for_the_model_the_denial_stands() {
    for (keys, model) in [
        (TeamKeys::default(), ANTHROPIC_MODEL),
        (with_key(), "openai/gpt-6-astra"),
        (with_key(), "google/gemini-3.8-flash"),
    ] {
        let funding = fund_turn(
            &TestAdmission::new(SPENT),
            &keys,
            &owner(),
            model,
            Funding::Macro,
            false,
        )
        .await;
        assert!(
            matches!(funding, Err(FundingRefusal::Admission(denial)) if Err(denial) == SPENT),
            "{model} should keep the denial"
        );
    }
}

#[tokio::test]
async fn a_session_on_the_team_key_skips_admission() {
    let admission = TestAdmission::new(SPENT);
    let funding = fund_turn(
        &admission,
        &with_key(),
        &owner(),
        ANTHROPIC_MODEL,
        Funding::TeamApiKey,
        true,
    )
    .await;
    assert!(matches!(funding, Ok(TurnFunding::TeamKey(_))));
    assert!(admission.calls.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_session_on_the_team_key_refuses_a_model_no_key_serves() {
    for (keys, model) in [
        (TeamKeys::default(), ANTHROPIC_MODEL),
        (with_key(), "google/gemini-3.8-flash"),
    ] {
        let funding = fund_turn(
            &TestAdmission::new(Ok(())),
            &keys,
            &owner(),
            model,
            Funding::TeamApiKey,
            true,
        )
        .await;
        assert!(matches!(funding, Err(FundingRefusal::TeamKeyUnavailable)));
    }
}

#[tokio::test]
async fn non_user_owners_never_reach_a_team_key() {
    let keys = with_key();
    let funding = fund_turn(
        &TestAdmission::new(Ok(())),
        &keys,
        &Owner::Team(macro_uuid::generate_uuid_v7()),
        ANTHROPIC_MODEL,
        Funding::TeamApiKey,
        true,
    )
    .await;
    assert!(matches!(
        funding,
        Err(FundingRefusal::Admission(AiAdmissionError::Unavailable))
    ));
    assert!(keys.asked.lock().expect("lock").is_empty());
}
