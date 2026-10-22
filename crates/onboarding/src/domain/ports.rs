//! Ports (traits) the onboarding domain depends on.

use super::models::{OnboardingRow, PromptId};
use macro_user_id::user_id::MacroUserIdStr;
use thiserror::Error;

/// Errors surfaced by the onboarding service and repository.
#[derive(Debug, Error)]
pub enum OnboardingError {
    /// Database failure.
    #[error("database error: {0}")]
    Db(rootcause::Report),
    /// Anything else.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Result alias for onboarding operations.
pub type Result<T> = std::result::Result<T, OnboardingError>;

/// Persistence for the onboarding row.
pub trait OnboardingRepo: Send + Sync + 'static {
    /// Fetch the user's onboarding row, creating an `active` one on first
    /// touch.
    fn ensure_row(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<OnboardingRow>> + Send;

    /// Fetch the user's onboarding row without creating one. `None` means
    /// the user never entered the flow.
    fn get_row(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<OnboardingRow>>> + Send;

    /// Mark the flow completed (idempotent; keeps the earliest completion).
    fn complete(
        &self,
        user: &MacroUserIdStr<'static>,
        skipped: bool,
    ) -> impl Future<Output = Result<OnboardingRow>> + Send;

    /// Hand the account to the person's AI agent: mark it agent-led and
    /// complete the web flow so it is never shown. Only an account that has
    /// not finished web onboarding qualifies — no row yet, an `active` row,
    /// or a row that is already agent-led (idempotent; keeps the first
    /// marking and client). Returns `None` when the account already finished
    /// onboarding on the web, which leaves its row untouched.
    fn mark_agent_led(
        &self,
        user: &MacroUserIdStr<'static>,
        client: Option<&str>,
    ) -> impl Future<Output = Result<Option<OnboardingRow>>> + Send;

    /// Record that an agent-led account's setup reached its final report.
    /// Idempotent (keeps the first time); a no-op for other accounts.
    fn finish_agent_setup(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Remove the user's onboarding row and dismissed prompts, for account
    /// deletion. Idempotent: a user who never entered the flow (or whose
    /// data is already gone from an earlier attempt) is not an error.
    fn delete_row(&self, user: &MacroUserIdStr<'static>)
    -> impl Future<Output = Result<()>> + Send;

    /// The prompt ids the user dismissed, oldest first.
    fn dismissed_prompts(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<String>>> + Send;

    /// Record a dismissal (idempotent; keeps the first dismissal time).
    fn dismiss_prompt(
        &self,
        user: &MacroUserIdStr<'static>,
        prompt: &PromptId,
    ) -> impl Future<Output = Result<()>> + Send;
}
