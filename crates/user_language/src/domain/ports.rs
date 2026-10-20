//! Ports (trait contracts) for the user language domain.

use macro_user_id::user_id::MacroUserIdStr;
use model_user::Language;

use crate::domain::models::UserLanguageError;

/// Outbound persistence port for user languages.
pub trait UserLanguageRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The user's language. The outer `None` means the user does not exist;
    /// the inner `None` means they follow their team.
    fn get_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Option<Language>>, Self::Err>> + Send;

    /// Store the user's language. Returns `false` when the user does not exist.
    fn set_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
        language: Option<Language>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Inbound service port: the user language API used by drivers (HTTP).
pub trait UserLanguageService: Send + Sync + 'static {
    /// The user's language, or `None` when they follow their team.
    fn get_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Language>, UserLanguageError>> + Send;

    /// Set the user's language, or clear it to follow their team.
    fn set_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
        language: Option<Language>,
    ) -> impl Future<Output = Result<(), UserLanguageError>> + Send;
}
