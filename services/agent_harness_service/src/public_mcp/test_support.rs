//! Fakes shared by the MCP server's unit tests.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use macro_user_id::user_id::MacroUserIdStr;
use onboarding::domain::{
    models::{OnboardingRow, OnboardingState, OnboardingStatus},
    ports::Result as OnboardingResult,
    service::OnboardingService,
};

use crate::public_mcp::{
    agent_led::{AccountDirectory, AccountFacts},
    client_attribution::ClientStore,
    telemetry::ClientInfo,
};

/// A profile id for tests.
pub fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|founder@startup.example".to_string()).expect("valid user id")
}

/// An onboarding row in `status`, agent-led or not.
pub fn onboarding_row(status: OnboardingStatus, agent_led: bool) -> OnboardingRow {
    OnboardingRow {
        status,
        skipped: false,
        started_at: chrono::Utc::now(),
        completed_at: None,
        agent_led_at: agent_led.then(chrono::Utc::now),
        agent_client: None,
        agent_setup_done_at: None,
    }
}

/// Onboarding service holding at most one row, applying the repository's
/// agent-led eligibility rule.
#[derive(Default)]
pub struct FakeOnboarding {
    /// The user's row, if any.
    pub existing: Option<OnboardingRow>,
    /// Clients passed to every `mark_agent_led` call.
    pub markings: Mutex<Vec<Option<String>>>,
    /// How many times setup was recorded as finished.
    pub finished: Mutex<u32>,
}

impl OnboardingService for FakeOnboarding {
    async fn get_state(&self, _user: MacroUserIdStr<'static>) -> OnboardingResult<OnboardingState> {
        unreachable!("never read in these tests")
    }

    async fn dismissed_prompts(
        &self,
        _user: MacroUserIdStr<'static>,
    ) -> OnboardingResult<onboarding::domain::models::DismissedPrompts> {
        unreachable!("never read in these tests")
    }

    async fn dismiss_prompt(
        &self,
        _user: MacroUserIdStr<'static>,
        _prompt: onboarding::domain::models::PromptId,
    ) -> OnboardingResult<()> {
        unreachable!("never dismissed in these tests")
    }

    async fn row(&self, _user: MacroUserIdStr<'static>) -> OnboardingResult<Option<OnboardingRow>> {
        Ok(self.existing.clone())
    }

    async fn mark_agent_led(
        &self,
        _user: MacroUserIdStr<'static>,
        client: Option<String>,
    ) -> OnboardingResult<Option<OnboardingRow>> {
        self.markings.lock().unwrap().push(client);
        let eligible = match &self.existing {
            None => true,
            Some(existing) => {
                existing.status == OnboardingStatus::Active || existing.is_agent_led()
            }
        };
        Ok(eligible.then(|| onboarding_row(OnboardingStatus::Completed, true)))
    }

    async fn finish_agent_setup(&self, _user: MacroUserIdStr<'static>) -> OnboardingResult<()> {
        *self.finished.lock().unwrap() += 1;
        Ok(())
    }

    async fn complete(
        &self,
        _user: MacroUserIdStr<'static>,
        _skipped: bool,
    ) -> OnboardingResult<OnboardingRow> {
        unreachable!("never completed in these tests")
    }
}

/// Account directory answering `tutorial_complete` from a script.
#[derive(Clone, Default)]
pub struct FakeAccounts {
    /// Answers to successive `tutorial_complete` reads; the last one repeats.
    pub tutorial: Arc<Mutex<Vec<Option<bool>>>>,
    /// When the account was created. Defaults to just now: a new sign-up.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// How many times the tutorial was completed.
    pub completed: Arc<Mutex<u32>>,
    /// Whether the account is on a team.
    pub on_team: bool,
}

impl FakeAccounts {
    /// A just-created account whose tutorial reads answer `answers` in order,
    /// repeating the last.
    pub fn with_tutorial(answers: &[Option<bool>]) -> Self {
        Self {
            tutorial: Arc::new(Mutex::new(answers.to_vec())),
            created_at: Some(chrono::Utc::now()),
            completed: Arc::default(),
            on_team: false,
        }
    }

    /// An account someone already had: created `days` days ago.
    pub fn existing(answers: &[Option<bool>], days: i64) -> Self {
        Self {
            created_at: Some(chrono::Utc::now() - chrono::Duration::days(days)),
            ..Self::with_tutorial(answers)
        }
    }
}

impl AccountDirectory for FakeAccounts {
    async fn account(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Option<AccountFacts>> {
        let mut answers = self.tutorial.lock().unwrap();
        let tutorial = if answers.len() > 1 {
            answers.remove(0)
        } else {
            answers[0]
        };
        Ok(tutorial.map(|tutorial_complete| AccountFacts {
            tutorial_complete,
            created_at: self.created_at,
        }))
    }

    async fn complete_tutorial(&self, _user: &MacroUserIdStr<'static>) -> anyhow::Result<()> {
        *self.completed.lock().unwrap() += 1;
        Ok(())
    }

    async fn has_team(&self, _user: &MacroUserIdStr<'static>) -> anyhow::Result<bool> {
        Ok(self.on_team)
    }
}

/// In-memory stand-in for Redis, shareable the way instances share Redis.
#[derive(Clone, Default)]
pub struct MemoryStore {
    /// Stored entries by key.
    pub entries: Arc<Mutex<HashMap<String, ClientInfo>>>,
}

impl ClientStore for MemoryStore {
    async fn put(&self, key: String, client: &ClientInfo, _ttl: Duration) -> anyhow::Result<()> {
        self.entries.lock().unwrap().insert(key, client.clone());
        Ok(())
    }

    async fn get(&self, key: String) -> anyhow::Result<Option<ClientInfo>> {
        Ok(self.entries.lock().unwrap().get(&key).cloned())
    }
}
