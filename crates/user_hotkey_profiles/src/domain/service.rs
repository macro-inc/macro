//! User hotkey profiles service implementation.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    EmailHotkeyProfile, TasksHotkeyProfile, UserHotkeyProfiles, UserHotkeyProfilesError,
};
use crate::domain::ports::{UserHotkeyProfilesRepo, UserHotkeyProfilesService};

/// Concrete user hotkey profiles service backed by a [UserHotkeyProfilesRepo].
#[derive(Debug, Clone)]
pub struct UserHotkeyProfilesServiceImpl<R> {
    repo: R,
}

impl<R: UserHotkeyProfilesRepo> UserHotkeyProfilesServiceImpl<R> {
    /// Create a user hotkey profiles service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: UserHotkeyProfilesRepo> UserHotkeyProfilesService for UserHotkeyProfilesServiceImpl<R> {
    #[tracing::instrument(err, skip_all)]
    async fn get_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<UserHotkeyProfiles, UserHotkeyProfilesError> {
        let profiles = self
            .repo
            .get_profiles(user_id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Ok(profiles.unwrap_or_default())
    }

    #[tracing::instrument(
        err,
        skip_all,
        fields(
            email = profiles.email.map(EmailHotkeyProfile::as_str),
            tasks = profiles.tasks.map(TasksHotkeyProfile::as_str),
        )
    )]
    async fn set_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
        profiles: UserHotkeyProfiles,
    ) -> Result<UserHotkeyProfiles, UserHotkeyProfilesError> {
        let stored = self
            .repo
            .set_profiles(user_id, profiles)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        if !stored {
            return Err(UserHotkeyProfilesError::UserNotFound);
        }
        Ok(profiles)
    }
}
