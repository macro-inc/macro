//! Handing an account's setup to the person's own AI agent.
//!
//! An account the agent sets up skips the web onboarding flow (decision:
//! agent-led accounts go straight to a "here's what your agent built" first
//! visit). Two things make that so: the onboarding row is marked agent-led and
//! completed, so nothing auto-imports behind the plan the agent agrees with
//! the person, and the account's tutorial is completed, so the web app stops
//! forcing `/onboarding`.
//!
//! Only accounts that never finished web onboarding qualify. Someone who
//! already onboarded on the web and later adds Macro to their agent keeps
//! their account exactly as it was. At sign-in, only an account the sign-in
//! itself created qualifies: people who already had Macro keep it as it was
//! until they ask their agent to set it up.

#[cfg(test)]
mod test;

use std::{sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
use onboarding::domain::service::OnboardingService;
use sqlx::PgPool;

/// How long to wait for the account row a brand-new sign-in creates. The
/// identity provider's user-created webhook writes it, and a sign-in can
/// complete before that lands.
const ACCOUNT_ROW_RETRY_DELAYS: [Duration; 4] = [
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
];

/// How recently an account must have been created for a sign-in to count as
/// the sign-up itself. The account row lands seconds before the sign-in
/// completes; an hour covers slow consent screens without reaching accounts
/// people already had.
pub const NEW_ACCOUNT_WINDOW: Duration = Duration::from_secs(60 * 60);

/// What the legacy account record says about an account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountFacts {
    /// Whether the account finished the web tutorial
    /// (`"User"."tutorialComplete"`), which the web app reads to decide
    /// whether to force `/onboarding`.
    pub tutorial_complete: bool,
    /// When the account was created; `None` for accounts that predate the
    /// column.
    pub created_at: Option<DateTime<Utc>>,
}

impl AccountFacts {
    /// Whether the account was created within [`NEW_ACCOUNT_WINDOW`] of `now`
    /// and never finished the web tutorial.
    pub fn is_new(&self, now: DateTime<Utc>) -> bool {
        let window = chrono::Duration::from_std(NEW_ACCOUNT_WINDOW).unwrap_or_default();
        !self.tutorial_complete
            && self
                .created_at
                .is_some_and(|created| now - created <= window)
    }
}

/// The legacy account record, which holds the web app's onboarding bit.
pub trait AccountDirectory: Send + Sync + 'static {
    /// The account's facts. `None` when the account row does not exist (yet).
    fn account(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = anyhow::Result<Option<AccountFacts>>> + Send;

    /// Marks the web tutorial done so the web app stops forcing onboarding.
    fn complete_tutorial(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// [`AccountDirectory`] on MacroDB, through the queries that own the table.
#[derive(Clone)]
pub struct PgAccountDirectory {
    db: PgPool,
}

impl PgAccountDirectory {
    /// A directory on the MacroDB pool.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl AccountDirectory for PgAccountDirectory {
    async fn account(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Option<AccountFacts>> {
        let user_id = MacroUserId::parse_from_str(user.as_ref())?.lowercase();
        match macro_db_client::user::get::get_legacy_user_info(&self.db, &user_id).await {
            Ok(info) => Ok(Some(AccountFacts {
                tutorial_complete: info.tutorial_complete,
                created_at: info.created_at,
            })),
            Err(error) if is_row_not_found(&error) => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn complete_tutorial(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<()> {
        let user_id = MacroUserId::parse_from_str(user.as_ref())?.lowercase();
        macro_db_client::user::patch::patch_user_tutorial(&self.db, &user_id, true).await
    }
}

fn is_row_not_found(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<sqlx::Error>(),
        Some(sqlx::Error::RowNotFound)
    )
}

/// What handing an account to the agent did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Handover {
    /// The account is agent-led (newly, or it already was).
    AgentLed,
    /// The account finished web onboarding; nothing changed.
    WebOnboarded,
    /// The account existed before this sign-in; nothing changed.
    Existing,
}

/// Marks accounts agent-led. Shared by the sign-in hook and the setup tools,
/// which also reach accounts that signed in some other way.
pub struct AgentHandover<O, A> {
    onboarding: Arc<O>,
    accounts: A,
    retry_delays: &'static [Duration],
}

impl<O, A: Clone> Clone for AgentHandover<O, A> {
    fn clone(&self) -> Self {
        Self {
            onboarding: Arc::clone(&self.onboarding),
            accounts: self.accounts.clone(),
            retry_delays: self.retry_delays,
        }
    }
}

impl<O: OnboardingService, A: AccountDirectory> AgentHandover<O, A> {
    /// A handover over the onboarding service and the account directory.
    pub fn new(onboarding: Arc<O>, accounts: A) -> Self {
        Self {
            onboarding,
            accounts,
            retry_delays: &ACCOUNT_ROW_RETRY_DELAYS,
        }
    }

    #[cfg(test)]
    fn without_retry_delays(mut self) -> Self {
        self.retry_delays = &[];
        self
    }

    /// The account's facts, waiting briefly for the row a brand-new sign-in
    /// creates.
    async fn account(&self, user: &MacroUserIdStr<'static>) -> anyhow::Result<AccountFacts> {
        for delay in self.retry_delays {
            if let Some(facts) = self.accounts.account(user).await? {
                return Ok(facts);
            }
            tokio::time::sleep(*delay).await;
        }
        self.accounts
            .account(user)
            .await?
            .ok_or_else(|| anyhow::anyhow!("account row for the signed-in user does not exist"))
    }

    /// Whether the account was created moments ago and never onboarded on the
    /// web, without waiting for a row that hasn't landed yet.
    pub async fn is_new_account(
        &self,
        user: &MacroUserIdStr<'static>,
        now: DateTime<Utc>,
    ) -> anyhow::Result<bool> {
        Ok(self
            .accounts
            .account(user)
            .await?
            .is_some_and(|facts| facts.is_new(now)))
    }

    /// Hands the account to the agent `client` if this sign-in created it.
    /// Accounts people already had are left alone until they ask for setup.
    /// Idempotent.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn hand_over_new_sign_up(
        &self,
        user: &MacroUserIdStr<'static>,
        client: Option<&str>,
        now: DateTime<Utc>,
    ) -> anyhow::Result<Handover> {
        let agent_led = self
            .onboarding
            .row(user.clone())
            .await?
            .is_some_and(|row| row.is_agent_led());
        if !agent_led && !self.account(user).await?.is_new(now) {
            return Ok(Handover::Existing);
        }
        self.hand_over(user, client).await
    }

    /// Hands the account's setup to the agent `client`, if it never finished
    /// web onboarding. Idempotent.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn hand_over(
        &self,
        user: &MacroUserIdStr<'static>,
        client: Option<&str>,
    ) -> anyhow::Result<Handover> {
        let account = self.account(user).await?;
        if let Some(row) = self.onboarding.row(user.clone()).await?
            && row.is_agent_led()
        {
            // An earlier handover can stop between the two writes; finish it.
            if !account.tutorial_complete {
                self.accounts.complete_tutorial(user).await?;
            }
            return Ok(Handover::AgentLed);
        }
        if account.tutorial_complete {
            return Ok(Handover::WebOnboarded);
        }
        let marked = self
            .onboarding
            .mark_agent_led(user.clone(), client.map(str::to_owned))
            .await?;
        if marked.is_none() {
            return Ok(Handover::WebOnboarded);
        }
        self.accounts.complete_tutorial(user).await?;
        Ok(Handover::AgentLed)
    }
}
