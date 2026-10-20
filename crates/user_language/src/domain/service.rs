//! User language service implementation.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use model_user::Language;

use crate::domain::models::UserLanguageError;
use crate::domain::ports::{UserLanguageRepo, UserLanguageService};

/// Concrete user language service backed by a [UserLanguageRepo].
#[derive(Debug, Clone)]
pub struct UserLanguageServiceImpl<R> {
    repo: R,
}

impl<R: UserLanguageRepo> UserLanguageServiceImpl<R> {
    /// Create a user language service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: UserLanguageRepo> UserLanguageService for UserLanguageServiceImpl<R> {
    #[tracing::instrument(err, skip_all)]
    async fn get_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<Language>, UserLanguageError> {
        self.repo
            .get_language(user_id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?
            .ok_or(UserLanguageError::UserNotFound)
    }

    #[tracing::instrument(err, skip_all, fields(language = language.map(Language::as_str)))]
    async fn set_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
        language: Option<Language>,
    ) -> Result<(), UserLanguageError> {
        let updated = self
            .repo
            .set_language(user_id, language)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        if !updated {
            return Err(UserLanguageError::UserNotFound);
        }
        Ok(())
    }
}
