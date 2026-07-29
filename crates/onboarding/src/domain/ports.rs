//! Ports (traits) the onboarding domain depends on.

use super::models::OnboardingRow;
use macro_user_id::user_id::MacroUserIdStr;
use thiserror::Error;

/// Errors surfaced by the onboarding service and repository.
#[derive(Debug, Error)]
pub enum OnboardingError {
    /// Database failure.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A failure in the import pipeline this flow drives.
    #[error(transparent)]
    Import(#[from] import::domain::ports::ImportError),
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
}
